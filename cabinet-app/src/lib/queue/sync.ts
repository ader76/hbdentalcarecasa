// Moteur de synchronisation. Il ne dépend pas d'une synchronisation silencieuse
// en arrière-plan : il est lancé à l'ouverture de l'application, au retour du
// réseau, périodiquement tant que l'application est ouverte, et par le bouton
// « Réessayer ». Chaque étape est idempotente côté serveur.
import {
  getDb, getPages, markSyncedAndPurge, notifyQueueChange, removePendingPatient, updateDoc,
  type PendingPatient, type QueueDoc, type QueuePage, type SyncErrorKind,
} from "./db";

export class SyncError extends Error {
  constructor(public kind: SyncErrorKind, message: string) {
    super(message);
  }
}

export interface SyncTransport {
  createPatient(p: PendingPatient): Promise<void>;
  createDocument(d: QueueDoc): Promise<void>;
  /** Doit renvoyer l'empreinte calculée par le serveur sur les octets reçus. */
  uploadPage(d: QueueDoc, page: QueuePage, pageNumber: number): Promise<{ receivedSha256: string }>;
  /** Doit renvoyer l'état confirmé par le serveur. */
  finalizeDocument(id: string): Promise<{ syncStatus: string; pageCount: number }>;
}

export interface SyncOptions {
  isOnline?: () => boolean;
  now?: () => number;
  /** Ignore le délai d'attente entre deux essais (bouton « Réessayer »). */
  force?: boolean;
  onlyDocId?: string;
  /** Seules les fiches de ce compte sont envoyées (téléphone partagé). */
  userId?: string;
}

export interface SyncReport {
  synced: string[];
  failed: string[];
  skipped: string[];
  authRequired: boolean;
  ran: boolean;
}

export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 15 * 60_000);
}

export const ERROR_MESSAGES: Record<SyncErrorKind, string> = {
  network: "Réseau indisponible. Nouvel essai automatique.",
  auth: "Session expirée : reconnectez-vous pour envoyer.",
  rejected: "Fichier refusé par le serveur.",
  conflict: "Conflit avec une version déjà reçue.",
  server: "Erreur du serveur. Nouvel essai automatique.",
};

/** À l'ouverture : un envoi resté « en cours » a été interrompu (fermeture, redémarrage). */
export async function recoverInterrupted(): Promise<number> {
  const db = await getDb();
  const stuck = await db.getAllFromIndex("docs", "status", "uploading");
  for (const d of stuck) await updateDoc(d.id, { status: "pending" });
  return stuck.length;
}

/** Même chose, mais seulement si aucun envoi n'est en cours (dans cet onglet ou un autre). */
export async function recoverIfIdle(): Promise<number> {
  return (await withLock(recoverInterrupted)) ?? 0;
}

async function withLock<T>(fn: () => Promise<T>): Promise<T | null> {
  // Un seul envoi à la fois, même si l'application est ouverte dans plusieurs onglets.
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks) return fn();
  return locks.request("cabinet-fiches-sync", { ifAvailable: true }, async (lock) => (lock ? fn() : null));
}

export async function runSync(transport: SyncTransport, opts: SyncOptions = {}): Promise<SyncReport> {
  const res = await withLock(() => runSyncUnlocked(transport, opts));
  return res ?? { synced: [], failed: [], skipped: [], authRequired: false, ran: false };
}

async function runSyncUnlocked(transport: SyncTransport, opts: SyncOptions): Promise<SyncReport> {
  const isOnline = opts.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const now = opts.now ?? Date.now;
  const report: SyncReport = { synced: [], failed: [], skipped: [], authRequired: false, ran: true };

  await recoverInterrupted();
  if (!isOnline()) return report;

  const db = await getDb();
  const candidates = (await db.getAll("docs"))
    .filter((d) => d.status === "pending" || d.status === "failed")
    .filter((d) => !opts.onlyDocId || d.id === opts.onlyDocId)
    .filter((d) => !opts.userId || d.userId === opts.userId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const doc of candidates) {
    if (!opts.force && doc.status === "failed" && doc.nextAttemptAt && Date.parse(doc.nextAttemptAt) > now()) {
      report.skipped.push(doc.id);
      continue;
    }
    try {
      await syncOne(doc, transport);
      report.synced.push(doc.id);
    } catch (e) {
      const err = e instanceof SyncError ? e : new SyncError("server", e instanceof Error ? e.message : String(e));
      const attempts = doc.attempts + 1;
      if (err.kind === "auth") {
        // Pas un échec de la fiche : elle reste en attente jusqu'à la reconnexion.
        await updateDoc(doc.id, { status: "pending", lastError: ERROR_MESSAGES.auth, errorKind: "auth" });
        report.authRequired = true;
        break;
      }
      await updateDoc(doc.id, {
        status: "failed",
        attempts,
        errorKind: err.kind,
        lastError: err.kind === "rejected" || err.kind === "conflict" ? `${ERROR_MESSAGES[err.kind]} ${err.message}` : ERROR_MESSAGES[err.kind],
        nextAttemptAt: new Date(now() + backoffMs(attempts)).toISOString(),
      });
      report.failed.push(doc.id);
      if (err.kind === "network") break; // inutile d'essayer les suivantes
    }
  }
  notifyQueueChange();
  return report;
}

async function syncOne(doc: QueueDoc, transport: SyncTransport): Promise<void> {
  await updateDoc(doc.id, { status: "uploading" });

  try {
    await syncSteps(doc, transport);
  } catch (e) {
    // Fiche ou patient absent du serveur (ex. restauration d'une sauvegarde antérieure) :
    // on repartira de zéro au prochain essai, sans risque de doublon.
    if (e instanceof SyncError && /introuvable/.test(e.message)) {
      await updateDoc(doc.id, { serverCreated: false, uploadedPageIds: [] });
    }
    throw e;
  }
}

async function syncSteps(doc: QueueDoc, transport: SyncTransport): Promise<void> {
  const db = await getDb();
  // 1. Patient créé hors connexion : le créer d'abord (idempotent). Il reste dans la
  //    file jusqu'à la confirmation de la fiche.
  const pendingPatient = await db.get("pendingPatients", doc.patientId);
  if (pendingPatient) await transport.createPatient(pendingPatient);

  // 2. Document (idempotent : même identifiant → pas de doublon).
  const pages = await getPages(doc.id);
  if (pages.length !== doc.pageIds.length || pages.length === 0) {
    throw new SyncError("conflict", "pages locales manquantes");
  }
  if (!doc.serverCreated) {
    await transport.createDocument(doc);
    doc = (await updateDoc(doc.id, { serverCreated: true }))!;
  }

  // 3. Pages dans l'ordre ; chaque page reçue est mémorisée pour reprendre après une coupure.
  const uploaded = new Set(doc.uploadedPageIds);
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (uploaded.has(page.id)) continue;
    const { receivedSha256 } = await transport.uploadPage(doc, page, i + 1);
    if (receivedSha256 !== page.sha256) {
      throw new SyncError("server", "empreinte différente après envoi");
    }
    uploaded.add(page.id);
    doc = (await updateDoc(doc.id, { uploadedPageIds: [...uploaded] }))!;
  }

  // 4. Confirmation serveur : seule condition pour afficher « Synchronisée ».
  let fin: { syncStatus: string; pageCount: number };
  try {
    fin = await transport.finalizeDocument(doc.id);
  } catch (e) {
    // Le serveur ne possède pas toutes les pages (ex. restauration de sauvegarde) :
    // on renverra toutes les pages au prochain essai (sans risque de doublon).
    if (e instanceof SyncError && /incomplet/.test(e.message)) await updateDoc(doc.id, { uploadedPageIds: [] });
    throw e;
  }
  if (fin.syncStatus !== "synced" || fin.pageCount !== pages.length) {
    throw new SyncError("server", "confirmation serveur incomplète");
  }
  await markSyncedAndPurge(doc.id);
  if (pendingPatient) await removePendingPatient(pendingPatient.id);
}

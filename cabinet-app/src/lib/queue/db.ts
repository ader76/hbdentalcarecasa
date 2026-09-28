// File locale persistante (IndexedDB). Les photos y sont écrites AVANT toute
// tentative réseau : fermer l'application, perdre le réseau ou redémarrer le
// téléphone ne les fait pas disparaître.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * draft     : fiche en cours de capture (non envoyée)
 * pending   : enregistrée, en attente d'envoi
 * uploading : envoi en cours
 * synced    : le serveur a confirmé la réception complète et vérifiée
 * failed    : dernier essai en échec (réessai automatique ou manuel)
 */
export type DocStatus = "draft" | "pending" | "uploading" | "synced" | "failed";

export type ImageOp = { type: "rotate"; deg: 90 | -90 } | { type: "crop"; x: number; y: number; width: number; height: number };

export interface QueueDoc {
  id: string;                 // identifiant unique généré sur l'appareil = clé d'idempotence serveur
  userId: string;             // compte qui a pris les photos : seul ce compte peut les envoyer
  cabinetId: string;
  patientId: string;
  patientLabel: string;       // affichage local uniquement
  documentDate: string;       // AAAA-MM-JJ
  note: string;
  pageIds: string[];          // ordre des pages
  status: DocStatus;
  createdAt: string;
  updatedAt: string;
  attempts: number;
  lastError?: string;
  errorKind?: SyncErrorKind;
  nextAttemptAt?: string;
  serverCreated: boolean;
  uploadedPageIds: string[];
  syncedAt?: string;
}

export type SyncErrorKind = "network" | "auth" | "rejected" | "conflict" | "server";

export interface QueuePage {
  id: string;
  docId: string;
  source: Blob;               // photo traitée (orientation corrigée, métadonnées retirées)
  ops: ImageOp[];             // rotations / recadrages appliqués à la source
  blob: Blob;                 // image finale envoyée
  thumb: Blob;
  sha256: string;             // empreinte de l'image finale
  width: number;
  height: number;
}

export interface PendingPatient {
  id: string;
  userId: string;
  cabinetId: string;
  lastName: string;
  firstName: string;
  phone: string | null;
  birthDate: string | null;
  createdAt: string;
}

export interface CachedPatient {
  id: string;
  last_name: string;
  first_name: string;
  phone: string | null;
  birth_date: string | null;
  file_number: string | null;   // null tant que le patient n'est pas créé sur le serveur
  pending?: boolean;
}

interface FichesDB extends DBSchema {
  docs: { key: string; value: QueueDoc; indexes: { status: DocStatus } };
  pages: { key: string; value: QueuePage; indexes: { docId: string } };
  pendingPatients: { key: string; value: PendingPatient };
  patientCache: { key: string; value: CachedPatient };
  meta: { key: string; value: unknown };
}

export type FichesDb = IDBPDatabase<FichesDB>;

let dbPromise: Promise<FichesDb> | null = null;

export function getDb(name = "cabinet-fiches"): Promise<FichesDb> {
  if (!dbPromise) {
    dbPromise = openDB<FichesDB>(name, 1, {
      upgrade(db) {
        const docs = db.createObjectStore("docs", { keyPath: "id" });
        docs.createIndex("status", "status");
        const pages = db.createObjectStore("pages", { keyPath: "id" });
        pages.createIndex("docId", "docId");
        db.createObjectStore("pendingPatients", { keyPath: "id" });
        db.createObjectStore("patientCache", { keyPath: "id" });
        db.createObjectStore("meta");
      },
    });
  }
  return dbPromise;
}

/** Réservé aux tests : repart d'une base neuve. */
export function resetDbForTests(): void {
  dbPromise = null;
}

/** Demande au navigateur de ne pas purger ces données en cas de manque d'espace. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* non supporté */ }
  return false;
}

// ---------------------------------------------------------------------------
// Notifications de changement (même onglet + autres onglets)
// ---------------------------------------------------------------------------
type Listener = () => void;
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel("cabinet-fiches-queue");
    channel.onmessage = () => listeners.forEach((l) => l());
  }
  return channel;
}

export function onQueueChange(l: Listener): () => void {
  listeners.add(l);
  getChannel();
  return () => listeners.delete(l);
}

export function notifyQueueChange(): void {
  listeners.forEach((l) => l());
  getChannel()?.postMessage("change");
}

// ---------------------------------------------------------------------------
// Opérations
// ---------------------------------------------------------------------------
export async function saveDraft(doc: QueueDoc, pages: QueuePage[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["docs", "pages"], "readwrite");
  const existing = await tx.objectStore("pages").index("docId").getAllKeys(doc.id);
  const keep = new Set(pages.map((p) => p.id));
  for (const k of existing) if (!keep.has(k)) await tx.objectStore("pages").delete(k);
  for (const p of pages) await tx.objectStore("pages").put(p);
  await tx.objectStore("docs").put({ ...doc, pageIds: pages.map((p) => p.id), updatedAt: new Date().toISOString() });
  await tx.done;
  notifyQueueChange();
}

export async function putPage(page: QueuePage): Promise<void> {
  const db = await getDb();
  await db.put("pages", page);
}

export async function getPages(docId: string): Promise<QueuePage[]> {
  const db = await getDb();
  const doc = await db.get("docs", docId);
  const pages = await db.getAllFromIndex("pages", "docId", docId);
  const order = new Map((doc?.pageIds ?? []).map((id, i) => [id, i]));
  return pages.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

export async function listDocs(): Promise<QueueDoc[]> {
  const db = await getDb();
  const docs = await db.getAll("docs");
  return docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getDoc(id: string): Promise<QueueDoc | undefined> {
  return (await getDb()).get("docs", id);
}

export async function updateDoc(id: string, patch: Partial<QueueDoc>): Promise<QueueDoc | undefined> {
  const db = await getDb();
  const tx = db.transaction("docs", "readwrite");
  const cur = await tx.store.get(id);
  if (!cur) { await tx.done; return undefined; }
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  await tx.store.put(next);
  await tx.done;
  notifyQueueChange();
  return next;
}

/** « Enregistrer et synchroniser » : le brouillon devient un envoi en attente. */
export async function commitDraft(id: string, patch: Pick<QueueDoc, "note" | "documentDate">): Promise<void> {
  const pages = await getPages(id);
  if (pages.length === 0) throw new Error("Aucune page à enregistrer");
  await updateDoc(id, { ...patch, status: "pending", attempts: 0, lastError: undefined, errorKind: undefined, nextAttemptAt: undefined });
}

/**
 * Supprime les images locales d'un document confirmé par le serveur, et le marque
 * « synced » dans la même transaction.
 */
export async function markSyncedAndPurge(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["docs", "pages"], "readwrite");
  const doc = await tx.objectStore("docs").get(id);
  if (doc) {
    const keys = await tx.objectStore("pages").index("docId").getAllKeys(id);
    for (const k of keys) await tx.objectStore("pages").delete(k);
    const now = new Date().toISOString();
    await tx.objectStore("docs").put({ ...doc, status: "synced", syncedAt: now, updatedAt: now, lastError: undefined, errorKind: undefined, nextAttemptAt: undefined });
  }
  await tx.done;
  notifyQueueChange();
}

/** Suppression volontaire d'un brouillon ou d'un envoi (après confirmation de l'utilisateur). */
export async function deleteDoc(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["docs", "pages"], "readwrite");
  const keys = await tx.objectStore("pages").index("docId").getAllKeys(id);
  for (const k of keys) await tx.objectStore("pages").delete(k);
  await tx.objectStore("docs").delete(id);
  await tx.done;
  notifyQueueChange();
}

/** Les entrées synchronisées depuis plus de `days` jours sont retirées de l'historique local. */
export async function pruneSynced(days = 3): Promise<void> {
  const db = await getDb();
  const limit = Date.now() - days * 86_400_000;
  for (const d of await db.getAllFromIndex("docs", "status", "synced")) {
    if (d.syncedAt && Date.parse(d.syncedAt) < limit) await deleteDoc(d.id);
  }
}

/** Retire un patient de la file une fois sa fiche confirmée par le serveur. */
export async function removePendingPatient(id: string): Promise<void> {
  const db = await getDb();
  await db.delete("pendingPatients", id);
}

export async function addPendingPatient(p: PendingPatient): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["pendingPatients", "patientCache"], "readwrite");
  await tx.objectStore("pendingPatients").put(p);
  await tx.objectStore("patientCache").put({
    id: p.id, last_name: p.lastName.toUpperCase(), first_name: p.firstName, phone: p.phone,
    birth_date: p.birthDate, file_number: null, pending: true,
  });
  await tx.done;
  notifyQueueChange();
}

export async function replacePatientCache(rows: CachedPatient[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["patientCache", "pendingPatients"], "readwrite");
  const pending = await tx.objectStore("pendingPatients").getAll();
  await tx.objectStore("patientCache").clear();
  for (const r of rows) await tx.objectStore("patientCache").put(r);
  for (const p of pending) {
    if (!rows.some((r) => r.id === p.id)) {
      await tx.objectStore("patientCache").put({
        id: p.id, last_name: p.lastName.toUpperCase(), first_name: p.firstName, phone: p.phone,
        birth_date: p.birthDate, file_number: null, pending: true,
      });
    }
  }
  await tx.done;
}

export async function listCachedPatients(): Promise<CachedPatient[]> {
  return (await getDb()).getAll("patientCache");
}

/**
 * Déconnexion : efface le cache des patients, mais JAMAIS les fiches non envoyées
 * (elles seront envoyées à la prochaine connexion).
 */
export async function clearSensitiveCache(): Promise<void> {
  const db = await getDb();
  await db.clear("patientCache");
}

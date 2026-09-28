// Moteur de synchronisation : coupures, reprises, doublons, confirmation serveur.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addPendingPatient, commitDraft, getDb, getDoc, getPages, listDocs, resetDbForTests, saveDraft, updateDoc,
  type QueueDoc, type QueuePage,
} from "@/lib/queue/db";
import { recoverInterrupted, runSync, SyncError, type SyncTransport } from "@/lib/queue/sync";

// Serveur simulé, idempotent comme le vrai (clé = identifiants générés par l'appareil).
class FakeServer implements SyncTransport {
  patients = new Set<string>();
  docs = new Map<string, { pageCount: number; patientId: string; synced: boolean }>();
  pages = new Map<string, { docId: string; n: number; sha: string }>();
  calls: string[] = [];
  failNext: Partial<Record<"createDocument" | "uploadPage" | "finalizeDocument" | "createPatient", SyncError>> = {};
  failUploadAt: number | null = null;       // coupe le réseau à la N-ième page envoyée
  corruptEcho = false;
  finalizeLies = false;
  uploads = 0;

  private maybeFail(k: keyof FakeServer["failNext"]) {
    const e = this.failNext[k];
    if (e) { delete this.failNext[k]; throw e; }
  }
  async createPatient(p: { id: string }) { this.calls.push("patient"); this.maybeFail("createPatient"); this.patients.add(p.id); }
  async createDocument(d: QueueDoc) {
    this.calls.push("doc"); this.maybeFail("createDocument");
    if (!this.docs.has(d.id)) this.docs.set(d.id, { pageCount: d.pageIds.length, patientId: d.patientId, synced: false });
  }
  async uploadPage(d: QueueDoc, page: QueuePage, n: number) {
    this.calls.push(`page${n}`); this.maybeFail("uploadPage");
    this.uploads++;
    if (this.failUploadAt !== null && this.uploads === this.failUploadAt) throw new SyncError("network", "coupure");
    const ex = this.pages.get(page.id);
    if (ex && ex.sha !== page.sha256) throw new SyncError("conflict", "contenu différent");
    this.pages.set(page.id, { docId: d.id, n, sha: page.sha256 });
    return { receivedSha256: this.corruptEcho ? "0".repeat(64) : page.sha256 };
  }
  async finalizeDocument(id: string) {
    this.calls.push("finalize"); this.maybeFail("finalizeDocument");
    const d = this.docs.get(id)!;
    const received = [...this.pages.values()].filter((p) => p.docId === id).length;
    if (received !== d.pageCount) throw new SyncError("server", "incomplet");
    d.synced = !this.finalizeLies;
    return { syncStatus: this.finalizeLies ? "receiving" : "synced", pageCount: d.pageCount };
  }
  pagesOf(docId: string) { return [...this.pages.values()].filter((p) => p.docId === docId); }
}

let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const ME = "user-moi";

async function makeDoc(pageCount: number, patientId = "p-1", userId = ME): Promise<QueueDoc> {
  const now = new Date(Date.now() + seq).toISOString();
  const doc: QueueDoc = {
    id: id(), userId, cabinetId: "cab-1", patientId, patientLabel: "PATIENT FICTIF", documentDate: "2026-09-28", note: "", pageIds: [],
    status: "draft", createdAt: now, updatedAt: now, attempts: 0, serverCreated: false, uploadedPageIds: [],
  };
  const pages: QueuePage[] = Array.from({ length: pageCount }, (_, i) => {
    const blob = new Blob([`page-${doc.id}-${i}`], { type: "image/jpeg" });
    return { id: id(), docId: doc.id, source: blob, ops: [], blob, thumb: blob, sha256: `${i}`.padStart(64, "a"), width: 100, height: 100 };
  });
  await saveDraft(doc, pages);
  await commitDraft(doc.id, { note: "", documentDate: "2026-09-28" });
  return (await getDoc(doc.id))!;
}

const online = { isOnline: () => true, userId: ME };

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbForTests();
});

describe("synchronisation", () => {
  it("fiche d'une page : « synced » seulement après confirmation, copie locale supprimée", async () => {
    const s = new FakeServer();
    const d = await makeDoc(1);
    const r = await runSync(s, online);
    expect(r.synced).toEqual([d.id]);
    expect(s.calls).toEqual(["doc", "page1", "finalize"]);
    expect((await getDoc(d.id))!.status).toBe("synced");
    expect(await getPages(d.id)).toHaveLength(0);
  });

  it("fiche de plusieurs pages : ordre conservé", async () => {
    const s = new FakeServer();
    const d = await makeDoc(4);
    await runSync(s, online);
    expect(s.pagesOf(d.id).map((p) => p.n)).toEqual([1, 2, 3, 4]);
  });

  it("sans réseau : aucune tentative, la fiche reste « en attente » avec ses photos", async () => {
    const s = new FakeServer();
    const d = await makeDoc(2);
    await runSync(s, { isOnline: () => false });
    expect(s.calls).toEqual([]);
    expect((await getDoc(d.id))!.status).toBe("pending");
    expect(await getPages(d.id)).toHaveLength(2);
  });

  it("coupure pendant l'envoi puis reprise : seules les pages manquantes sont renvoyées, aucun doublon", async () => {
    const s = new FakeServer();
    s.failUploadAt = 2;
    const d = await makeDoc(3);
    await runSync(s, online);
    const after = (await getDoc(d.id))!;
    expect(after.status).toBe("failed");
    expect(after.errorKind).toBe("network");
    expect(after.uploadedPageIds).toHaveLength(1);
    expect(await getPages(d.id)).toHaveLength(3);          // rien n'est perdu

    s.failUploadAt = null;
    await runSync(s, { ...online, force: true });
    expect((await getDoc(d.id))!.status).toBe("synced");
    expect(s.pagesOf(d.id)).toHaveLength(3);
    expect(s.calls.filter((c) => c === "page1")).toHaveLength(1);
    expect(s.calls.filter((c) => c === "doc")).toHaveLength(1);
  });

  it("fermeture forcée pendant l'envoi : l'état « en cours » est repris à l'ouverture", async () => {
    const s = new FakeServer();
    const d = await makeDoc(2);
    await updateDoc(d.id, { status: "uploading" });           // simulation du crash
    expect(await recoverInterrupted()).toBe(1);
    expect((await getDoc(d.id))!.status).toBe("pending");
    await runSync(s, online);
    expect((await getDoc(d.id))!.status).toBe("synced");
  });

  it("envoi répété (page déjà reçue mais réponse perdue) : pas de doublon", async () => {
    const s = new FakeServer();
    const d = await makeDoc(2);
    // 1er passage : le serveur reçoit tout mais la confirmation se perd
    s.failNext.finalizeDocument = new SyncError("network", "réponse perdue");
    await runSync(s, online);
    expect((await getDoc(d.id))!.status).toBe("failed");
    // l'appareil « oublie » qu'il a envoyé les pages (pire cas)
    await updateDoc(d.id, { uploadedPageIds: [], serverCreated: false });
    await runSync(s, { ...online, force: true });
    expect((await getDoc(d.id))!.status).toBe("synced");
    expect(s.pagesOf(d.id)).toHaveLength(2);
    expect(s.docs.size).toBe(1);
  });

  it("le statut n'est jamais « synced » si le serveur ne confirme pas", async () => {
    const s = new FakeServer();
    s.finalizeLies = true;
    const d = await makeDoc(1);
    await runSync(s, online);
    expect((await getDoc(d.id))!.status).toBe("failed");
    expect(await getPages(d.id)).toHaveLength(1);
  });

  it("empreinte différente renvoyée par le serveur : échec, photos conservées", async () => {
    const s = new FakeServer();
    s.corruptEcho = true;
    const d = await makeDoc(1);
    await runSync(s, online);
    expect((await getDoc(d.id))!.status).toBe("failed");
    expect(await getPages(d.id)).toHaveLength(1);
  });

  it("session expirée : la fiche reste en attente (pas d'échec), reconnexion demandée", async () => {
    const s = new FakeServer();
    s.failNext.createDocument = new SyncError("auth", "expirée");
    const d = await makeDoc(1);
    const r = await runSync(s, online);
    expect(r.authRequired).toBe(true);
    const after = (await getDoc(d.id))!;
    expect(after.status).toBe("pending");
    expect(after.errorKind).toBe("auth");
  });

  it("délai entre deux essais automatiques, ignoré par « Réessayer »", async () => {
    const s = new FakeServer();
    s.failNext.createDocument = new SyncError("server", "500");
    const d = await makeDoc(1);
    await runSync(s, online);
    const r2 = await runSync(s, online);
    expect(r2.skipped).toContain(d.id);
    const r3 = await runSync(s, { ...online, force: true });
    expect(r3.synced).toContain(d.id);
  });

  it("patient créé hors connexion : créé sur le serveur avant la fiche", async () => {
    const s = new FakeServer();
    await addPendingPatient({ id: "p-new", userId: ME, cabinetId: "cab-1", lastName: "Fictif", firstName: "Nouveau", phone: null, birthDate: null, createdAt: new Date().toISOString() });
    await makeDoc(1, "p-new");
    await runSync(s, online);
    expect(s.calls.slice(0, 2)).toEqual(["patient", "doc"]);
    expect(await (await getDb()).get("pendingPatients", "p-new")).toBeUndefined();
  });

  it("journée chargée : 100 photos réparties sur 25 fiches, toutes synchronisées sans doublon", async () => {
    const s = new FakeServer();
    for (let i = 0; i < 25; i++) await makeDoc(4, `p-${i}`);
    s.failUploadAt = 37;                                      // une coupure au milieu
    await runSync(s, online);
    await runSync(s, { ...online, force: true });
    const docs = await listDocs();
    expect(docs.filter((d) => d.status === "synced")).toHaveLength(25);
    expect(s.pages.size).toBe(100);
    expect(s.docs.size).toBe(25);
  });

  it("téléphone partagé : les fiches d'un autre compte ne sont pas envoyées sous le compte connecté", async () => {
    const s = new FakeServer();
    const other = await makeDoc(1, "p-1", "user-autre");
    const mine = await makeDoc(1);
    const r = await runSync(s, online);
    expect(r.synced).toEqual([mine.id]);
    expect((await getDoc(other.id))!.status).toBe("pending");
    expect(s.docs.has(other.id)).toBe(false);
  });

  it("serveur restauré sans la fiche : l'appareil la recrée et renvoie tout, sans intervention", async () => {
    const s = new FakeServer();
    const d = await makeDoc(2);
    s.failNext.finalizeDocument = new SyncError("network", "coupure");
    await runSync(s, online);                       // fiche + pages reçues, confirmation perdue
    s.docs.clear();
    s.pages.clear();                                // restauration d'une sauvegarde plus ancienne
    const origFinalize = s.finalizeDocument.bind(s);
    s.finalizeDocument = async (docId: string) => {
      if (!s.docs.has(docId)) throw new SyncError("server", "introuvable");
      return origFinalize(docId);
    };
    await runSync(s, { ...online, force: true });   // échoue : introuvable → réinitialisation
    expect((await getDoc(d.id))!.serverCreated).toBe(false);
    await runSync(s, { ...online, force: true });
    expect((await getDoc(d.id))!.status).toBe("synced");
    expect(s.pagesOf(d.id)).toHaveLength(2);
  });

  it("patient créé hors connexion : conservé dans la file jusqu'à la confirmation de la fiche", async () => {
    const s = new FakeServer();
    await addPendingPatient({ id: "p-off", userId: ME, cabinetId: "cab-1", lastName: "Fictif", firstName: "Hors", phone: null, birthDate: null, createdAt: new Date().toISOString() });
    await makeDoc(1, "p-off");
    s.failNext.finalizeDocument = new SyncError("server", "500");
    await runSync(s, online);
    expect(await (await getDb()).get("pendingPatients", "p-off")).toBeDefined();
    await runSync(s, { ...online, force: true });
    expect(await (await getDb()).get("pendingPatients", "p-off")).toBeUndefined();
  });

  it("les brouillons ne sont jamais envoyés", async () => {
    const s = new FakeServer();
    const now = new Date().toISOString();
    await saveDraft({ id: "draft-1", userId: ME, cabinetId: "cab-1", patientId: "p", patientLabel: "X", documentDate: "2026-09-28", note: "", pageIds: [],
      status: "draft", createdAt: now, updatedAt: now, attempts: 0, serverCreated: false, uploadedPageIds: [] }, []);
    await runSync(s, online);
    expect(s.calls).toEqual([]);
  });
});

// Isolation des cabinets, rôles, accès anonyme, stockage privé, journal immuable.
import { describe, expect, it } from "vitest";
import {
  A_PATIENT_JEAN, B_PATIENT, BASE_URL, anon, db, login, newDocument, service, uploadPage, uuid,
} from "./helpers";
import { fakeSheet } from "../helpers/images";

describe("isolation entre cabinets", () => {
  it("un cabinet ne voit ni les patients, ni les fiches, ni les pages, ni le journal d'un autre", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const b = await login("dentiste@cabinet-b.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    const img = await fakeSheet("isolation");
    expect((await uploadPage(a.token, doc.id, uuid(), 1, img)).status).toBe(201);

    const { data: pats } = await b.client.from("patients").select("id");
    expect(pats!.map((p) => p.id)).toEqual([B_PATIENT]);
    expect((await b.client.from("documents").select("id").eq("id", doc.id)).data).toEqual([]);
    expect((await b.client.from("pages").select("id").eq("document_id", doc.id)).data).toEqual([]);
    const { data: audit } = await b.client.from("audit_log").select("cabinet_id");
    expect(new Set(audit!.map((r) => r.cabinet_id)).size).toBeLessThanOrEqual(1);
    expect(audit!.some((r) => r.cabinet_id === "a0000000-0000-4000-8000-00000000000a")).toBe(false);

    // Accès direct par l'API aux images d'un autre cabinet : refusé
    const res = await fetch(`${BASE_URL}/api/documents/${doc.id}/images`, { headers: { Authorization: `Bearer ${b.token}` } });
    expect(res.status).toBe(404);
    // Envoi d'une page dans le document d'un autre cabinet : refusé
    expect((await uploadPage(b.token, doc.id, uuid(), 1, img)).status).toBe(404);
  });

  it("un cabinet ne peut pas créer une fiche pour le patient d'un autre cabinet", async () => {
    const b = await login("dentiste@cabinet-b.test");
    const { error } = await b.client.rpc("create_document", {
      p_id: uuid(), p_patient_id: A_PATIENT_JEAN, p_document_date: "2026-09-28", p_note: null, p_page_count: 1,
    });
    expect(error).not.toBeNull();
  });

  it("un cabinet ne peut pas déplacer ou archiver la fiche d'un autre", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const b = await login("dentiste@cabinet-b.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    expect((await b.client.rpc("move_document", { p_id: doc.id, p_new_patient_id: B_PATIENT, p_reason: "tentative" })).error).not.toBeNull();
    expect((await b.client.rpc("archive_document", { p_id: doc.id, p_reason: "tentative" })).error).not.toBeNull();
    const [row] = await db<{ patient_id: string; status: string }>("select patient_id, status from documents where id = $1", [doc.id]);
    expect(row).toEqual({ patient_id: A_PATIENT_JEAN, status: "active" });
  });

  it("aucune écriture directe dans les tables, même pour un membre", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const ins = await a.client.from("patients").insert({ id: uuid(), cabinet_id: "a0000000-0000-4000-8000-00000000000a", file_number: "X", last_name: "X", first_name: "Y" });
    expect(ins.error).not.toBeNull();
    const upd = await a.client.from("documents").update({ sync_status: "synced" }).neq("id", uuid());
    expect(upd.error).not.toBeNull();
    const pg = await a.client.from("pages").insert({ id: uuid() });
    expect(pg.error).not.toBeNull();
    // l'enregistrement d'une page est réservé au serveur
    const reg = await a.client.rpc("server_register_page", {
      p_actor: a.userId, p_id: uuid(), p_document_id: uuid(), p_page_number: 1, p_storage_path: "x", p_thumb_path: "x",
      p_size: 1, p_width: 1, p_height: 1, p_sha256: "0".repeat(64),
    });
    expect(reg.error).not.toBeNull();
  });
});

describe("rôles", () => {
  it("l'assistant peut créer patients et fiches, mais ni déplacer, ni archiver, ni lire le journal", async () => {
    const as = await login("assistant@cabinet-a.test");
    const pid = uuid();
    const { error: e1 } = await as.client.rpc("create_patient", { p_id: pid, p_last_name: "Fictif", p_first_name: "Assistant" });
    expect(e1).toBeNull();
    const doc = await newDocument(as, pid, 1);
    const mv = await as.client.rpc("move_document", { p_id: doc.id, p_new_patient_id: A_PATIENT_JEAN, p_reason: "test role" });
    expect(mv.error?.code).toBe("42501");
    const ar = await as.client.rpc("archive_document", { p_id: doc.id, p_reason: "test role" });
    expect(ar.error?.code).toBe("42501");
    expect((await as.client.from("audit_log").select("id")).data).toEqual([]);
    expect((await as.client.rpc("admin_set_member_status", { p_user_id: as.userId, p_status: "disabled" })).error?.code).toBe("42501");
  });
});

describe("accès anonyme", () => {
  it("aucune donnée ni fonction accessible sans connexion", async () => {
    const c = anon();
    for (const t of ["cabinets", "members", "patients", "documents", "pages", "audit_log"]) {
      const { data } = await c.from(t).select("*");
      expect(data ?? []).toEqual([]);
    }
    expect((await c.rpc("search_patients", { p_query: "dupont" })).error).not.toBeNull();
    expect((await c.rpc("dashboard_summary")).error).not.toBeNull();
    const res = await fetch(`${BASE_URL}/api/pages?documentId=${uuid()}&pageId=${uuid()}&pageNumber=1`, { method: "PUT", body: "x" });
    expect(res.status).toBe(401);
  });

  it("l'inscription publique est désactivée", async () => {
    const { error } = await anon().auth.signUp({ email: `intrus-${Date.now()}@example.test`, password: "Un-mot-de-passe-long-1!" });
    expect(error).not.toBeNull();
  });
});

describe("stockage privé", () => {
  it("les images ne sont pas accessibles publiquement ni directement par un membre", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    await uploadPage(a.token, doc.id, uuid(), 1, await fakeSheet("prive"));
    const [page] = await db<{ storage_path: string }>("select storage_path from pages where document_id = $1", [doc.id]);

    const [bucket] = await db<{ public: boolean }>("select public from storage.buckets where id = 'fiches'");
    expect(bucket.public).toBe(false);
    const pub = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/fiches/${page.storage_path}`);
    expect(pub.ok).toBe(false);
    const direct = await a.client.storage.from("fiches").download(page.storage_path);
    expect(direct.error).not.toBeNull();
    const anonDl = await anon().storage.from("fiches").download(page.storage_path);
    expect(anonDl.error).not.toBeNull();

    // Consultation : uniquement par lien signé temporaire, journalisée
    const res = await fetch(`${BASE_URL}/api/documents/${doc.id}/images`, { headers: { Authorization: `Bearer ${a.token}` } });
    const body = await res.json();
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(body.pages[0].url).toMatch(/token=/);
    expect((await fetch(body.pages[0].url)).ok).toBe(true);
    const logs = await db("select 1 from audit_log where action = 'document.view' and entity_id = $1", [doc.id]);
    expect(logs.length).toBe(1);
  });
});

describe("journal d'audit", () => {
  it("est en ajout seul, même avec la clé serveur", async () => {
    const svc = service();
    const { error: u } = await svc.from("audit_log").update({ action: "falsifié" }).gt("id", 0);
    expect(u).not.toBeNull();
    const { error: d } = await svc.from("audit_log").delete().gt("id", 0);
    expect(d).not.toBeNull();
    await expect(db("delete from audit_log")).rejects.toThrow(/ajout seul/);
  });
});

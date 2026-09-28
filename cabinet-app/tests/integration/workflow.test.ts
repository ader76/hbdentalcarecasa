// Corrections, journal, homonymes, fuseau horaire, révocation, double authentification.
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  A_PATIENT_JEAN, A_PATIENT_JEANNE, BASE_URL, db, login, newDocument, uploadPage, uuid, withToken,
} from "./helpers";
import { fakeSheet } from "../helpers/images";

describe("homonymes", () => {
  it("deux patients aux noms proches restent distincts, la recherche renvoie les deux", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const { data } = await a.client.rpc("search_patients", { p_query: "dupont" });
    expect(data.map((p: { id: string }) => p.id).sort()).toEqual([A_PATIENT_JEAN, A_PATIENT_JEANNE].sort());
    const { data: exact } = await a.client.rpc("search_patients", { p_query: "dupont jeanne" });
    expect(exact.map((p: { id: string }) => p.id)).toEqual([A_PATIENT_JEANNE]);
    const { data: byPhone } = await a.client.rpc("search_patients", { p_query: "06 00 00 00 01" });
    expect(byPhone.map((p: { id: string }) => p.id)).toEqual([A_PATIENT_JEAN]);
    // création d'un homonyme : jamais fusionné automatiquement
    const id = uuid();
    const { data: created } = await a.client.rpc("create_patient", { p_id: id, p_last_name: "Dupont", p_first_name: "Jean" });
    expect(created.id).toBe(id);
    expect(created.file_number).not.toBe("P-00001");
    // création rejouée (même identifiant) : pas de second patient
    await a.client.rpc("create_patient", { p_id: id, p_last_name: "Dupont", p_first_name: "Jean" });
    expect((await db("select 1 from patients where id = $1", [id])).length).toBe(1);
  });
});

describe("correction d'une fiche associée au mauvais patient", () => {
  it("déplacement avec motif obligatoire, version incrémentée, trace dans les deux dossiers", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    await uploadPage(a.token, doc.id, uuid(), 1, await fakeSheet("mauvais patient"));
    await a.client.rpc("finalize_document", { p_id: doc.id });

    expect((await a.client.rpc("move_document", { p_id: doc.id, p_new_patient_id: A_PATIENT_JEANNE, p_reason: "" })).error).not.toBeNull();
    const { data, error } = await a.client.rpc("move_document", { p_id: doc.id, p_new_patient_id: A_PATIENT_JEANNE, p_reason: "erreur de dossier" });
    expect(error).toBeNull();
    expect(data.patient_id).toBe(A_PATIENT_JEANNE);
    expect(data.version).toBe(2);

    const audit = await db<{ action: string; patient_id: string; old_value: { patient_id: string }; new_value: { patient_id: string; reason: string }; user_id: string }>(
      "select action, patient_id, old_value, new_value, user_id from audit_log where entity_id = $1 and action like 'document.move%' order by id", [doc.id]);
    expect(audit).toHaveLength(2);
    expect(audit[0]).toMatchObject({ action: "document.move", patient_id: A_PATIENT_JEANNE, old_value: { patient_id: A_PATIENT_JEAN }, new_value: { patient_id: A_PATIENT_JEANNE, reason: "erreur de dossier" }, user_id: a.userId });
    expect(audit[1]).toMatchObject({ action: "document.move_out", patient_id: A_PATIENT_JEAN });
    // les images suivent le document (chemins sans identifiant patient)
    const res = await fetch(`${BASE_URL}/api/documents/${doc.id}/images`, { headers: { Authorization: `Bearer ${a.token}` } });
    expect((await res.json()).pages).toHaveLength(1);
  });

  it("archivage : masqué pour l'assistant, visible (archivé) pour le dentiste, jamais effacé", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const as = await login("assistant@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    expect((await a.client.rpc("archive_document", { p_id: doc.id, p_reason: "doublon papier" })).error).toBeNull();
    expect((await as.client.from("documents").select("id").eq("id", doc.id)).data).toEqual([]);
    expect((await a.client.from("documents").select("status").eq("id", doc.id)).data).toEqual([{ status: "archived" }]);
  });
});

describe("journal minimal", () => {
  it("création, réception et finalisation sont journalisées avec auteur, date et appareil", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    await uploadPage(a.token, doc.id, uuid(), 1, await fakeSheet("journal"));
    await a.client.rpc("finalize_document", { p_id: doc.id });
    const rows = await db<{ action: string; user_id: string; result: string }>(
      "select action, user_id, result from audit_log where entity_id = $1 or (entity_type = 'page' and new_value->>'document_id' = $2) order by id",
      [doc.id, doc.id]);
    expect(rows.map((r) => r.action)).toEqual(["document.create", "page.receive", "document.synced"]);
    expect(rows.every((r) => r.user_id === a.userId && r.result === "success")).toBe(true);
    const [c] = await db<{ device: string; session_id: string | null }>("select device, session_id from audit_log where entity_id = $1 and action = 'document.create'", [doc.id]);
    expect(c.device).toBe("test");
    expect(c.session_id).not.toBeNull();
  });
});

describe("fuseau horaire", () => {
  it("« aujourd'hui » est calculé dans le fuseau du cabinet ; la date de fiche est conservée telle quelle", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1, "2026-03-29"); // jour de changement d'heure en Europe
    const { data } = await a.client.rpc("dashboard_summary");
    const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Casablanca" }).format(new Date());
    expect(data.today).toBe(expected);
    expect(data.imported_today.some((d: { id: string }) => d.id === doc.id)).toBe(true);
    const [row] = await db<{ d: string }>("select document_date::text as d from documents where id = $1", [doc.id]);
    expect(row.d).toBe("2026-03-29");
  });
});

describe("téléphone perdu : révocation", () => {
  it("révoquer les sessions coupe immédiatement l'accès, même avec un jeton encore valide", async () => {
    const lost = await login("assistant@cabinet-a.test");
    const phone = withToken(lost.token);
    expect((await phone.from("patients").select("id")).data!.length).toBeGreaterThan(0);

    const admin = await login("admin@cabinet-a.test");
    const { data: n, error } = await admin.client.rpc("admin_revoke_sessions", { p_user_id: lost.userId });
    expect(error).toBeNull();
    expect(n).toBeGreaterThan(0);

    expect((await phone.from("patients").select("id")).data).toEqual([]);
    const doc = await newDocument(admin, A_PATIENT_JEAN, 1);
    expect((await uploadPage(lost.token, doc.id, uuid(), 1, await fakeSheet("perdu"))).status).toBe(401);
    expect((await phone.rpc("create_patient", { p_id: uuid(), p_last_name: "X", p_first_name: "Y" })).error).not.toBeNull();
    // le jeton de rafraîchissement ne permet plus d'obtenir une session
    const { error: refreshErr } = await lost.client.auth.refreshSession();
    expect(refreshErr).not.toBeNull();
  });

  it("un compte désactivé perd l'accès ; il peut être réactivé", async () => {
    const admin = await login("admin@cabinet-a.test");
    const as = await login("assistant@cabinet-a.test");
    expect((await admin.client.rpc("admin_set_member_status", { p_user_id: as.userId, p_status: "disabled" })).error).toBeNull();
    expect((await withToken(as.token).from("patients").select("id")).data).toEqual([]);
    expect((await admin.client.rpc("admin_set_member_status", { p_user_id: as.userId, p_status: "active" })).error).toBeNull();
    const again = await login("assistant@cabinet-a.test");
    expect((await again.client.from("patients").select("id")).data!.length).toBeGreaterThan(0);
  });
});

function totp(secret: string, t = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(t / 30_000)));
  const h = createHmac("sha1", key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

describe("double authentification", () => {
  it("une fois activée, une session sans code (aal1) n'a plus accès aux données", async () => {
    const d = await login("dentiste@cabinet-a.test");
    const { data: f, error } = await d.client.auth.mfa.enroll({ factorType: "totp", friendlyName: `test-${Date.now()}` });
    expect(error).toBeNull();
    expect((await d.client.auth.mfa.challengeAndVerify({ factorId: f!.id, code: totp(f!.totp.secret) })).error).toBeNull();
    try {
      const aal1 = await login("dentiste@cabinet-a.test");
      expect((await aal1.client.from("patients").select("id")).data).toEqual([]);
      expect((await aal1.client.auth.mfa.challengeAndVerify({ factorId: f!.id, code: totp(f!.totp.secret) })).error).toBeNull();
      expect((await aal1.client.from("patients").select("id")).data!.length).toBeGreaterThan(0);
    } finally {
      await db("delete from auth.mfa_factors where id = $1", [f!.id]);
    }
  });
});

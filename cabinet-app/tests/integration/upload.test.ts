// Réception des pages : vérifications de fichier, idempotence, finalisation.
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { hasApp1 } from "@/lib/jpeg";
import { A_PATIENT_JEAN, db, login, newDocument, service, sha256, uploadPage, uuid } from "./helpers";
import { fakePng, fakeSheet, sheetWithGps } from "../helpers/images";

describe("envoi des pages", () => {
  it("parcours complet : pages reçues, vérifiées, puis fiche « synced » seulement quand tout est là", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 2);
    const p1 = await fakeSheet("page 1");
    const r1 = await uploadPage(a.token, doc.id, uuid(), 1, p1);
    expect(r1.status).toBe(201);
    expect(r1.body.receivedSha256).toBe(sha256(p1));

    const early = await a.client.rpc("finalize_document", { p_id: doc.id });
    expect(early.error?.message).toMatch(/incomplet/);

    expect((await uploadPage(a.token, doc.id, uuid(), 2, await fakeSheet("page 2"))).status).toBe(201);
    const fin = await a.client.rpc("finalize_document", { p_id: doc.id });
    expect(fin.error).toBeNull();
    expect(fin.data.sync_status).toBe("synced");
    const pages = await db<{ page_number: number; validation_status: string }>(
      "select page_number, validation_status from pages where document_id = $1 order by page_number", [doc.id]);
    expect(pages).toEqual([{ page_number: 1, validation_status: "validated" }, { page_number: 2, validation_status: "validated" }]);
  });

  it("renvoi identique : aucun doublon (document, page, fichier)", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const id = uuid();
    const args = { p_id: id, p_patient_id: A_PATIENT_JEAN, p_document_date: "2026-09-28", p_note: null, p_page_count: 1 };
    expect((await a.client.rpc("create_document", args)).error).toBeNull();
    expect((await a.client.rpc("create_document", args)).error).toBeNull();
    const pageId = uuid();
    const img = await fakeSheet("doublon");
    expect((await uploadPage(a.token, id, pageId, 1, img)).status).toBe(201);
    const again = await uploadPage(a.token, id, pageId, 1, img);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect((await db("select 1 from documents where id = $1", [id])).length).toBe(1);
    expect((await db("select 1 from pages where document_id = $1", [id])).length).toBe(1);
    const { data: files } = await service().storage.from("fiches").list(`a0000000-0000-4000-8000-00000000000a/${id}`);
    expect(files!.length).toBe(2); // image + miniature
  });

  it("même identifiant de page avec un autre contenu : conflit", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    const pageId = uuid();
    await uploadPage(a.token, doc.id, pageId, 1, await fakeSheet("v1"));
    expect((await uploadPage(a.token, doc.id, pageId, 1, await fakeSheet("v2"))).status).toBe(409);
  });

  it("fichier altéré pendant le transfert (empreinte différente) : refusé", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    const img = await fakeSheet("altéré");
    const r = await uploadPage(a.token, doc.id, uuid(), 1, img, sha256(Buffer.from("autre chose")));
    expect(r.status).toBe(422);
  });

  it("image corrompue (tronquée) : refusée", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    const img = await fakeSheet("corrompue");
    const truncated = img.subarray(0, Math.floor(img.length * 0.6));
    expect((await uploadPage(a.token, doc.id, uuid(), 1, truncated)).status).toBe(422);
    const garbage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5000, 7)]);
    expect((await uploadPage(a.token, doc.id, uuid(), 1, garbage)).status).toBe(422);
  });

  it("type réel vérifié : un PNG ou un fichier quelconque est refusé", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    expect((await uploadPage(a.token, doc.id, uuid(), 1, await fakePng())).status).toBe(415);
    expect((await uploadPage(a.token, doc.id, uuid(), 1, Buffer.from("<script>alert(1)</script>"))).status).toBe(415);
  });

  it("fichier trop volumineux : refusé", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    const big = Buffer.concat([await fakeSheet("gros"), Buffer.alloc(9 * 1024 * 1024)]);
    expect((await uploadPage(a.token, doc.id, uuid(), 1, big)).status).toBe(413);
  });

  it("numéro de page hors limites : refusé", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    expect((await uploadPage(a.token, doc.id, uuid(), 2, await fakeSheet("hors"))).status).toBe(422);
  });

  it("les métadonnées (EXIF, GPS) sont retirées de l'image stockée, lisibilité conservée", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    const img = await sheetWithGps("gps");
    expect((await uploadPage(a.token, doc.id, uuid(), 1, img)).status).toBe(201);
    const [page] = await db<{ storage_path: string; sha256: string; width: number }>("select storage_path, sha256, width from pages where document_id = $1", [doc.id]);
    const { data } = await service().storage.from("fiches").download(page.storage_path);
    const stored = new Uint8Array(await data!.arrayBuffer());
    expect(hasApp1(stored)).toBe(false);
    expect((await sharp(stored).metadata()).exif).toBeUndefined();
    expect(sha256(stored)).toBe(page.sha256);          // empreinte stockée = fichier réel
    expect(page.width).toBe(1240);                        // aucune réduction côté serveur
  });

  it("image aux dimensions démesurées : refusée avant décodage (protection mémoire du serveur)", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    const huge = await sharp({ create: { width: 12000, height: 12000, channels: 3, background: "#fff" } }).jpeg({ quality: 50 }).toBuffer();
    expect(huge.length).toBeLessThan(8 * 1024 * 1024);
    expect((await uploadPage(a.token, doc.id, uuid(), 1, huge)).status).toBe(422);
  });

  it("seul l'auteur de la fiche peut y ajouter des pages", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const as = await login("assistant@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    expect((await uploadPage(as.token, doc.id, uuid(), 1, await fakeSheet("tiers"))).status).toBe(403);
  });

  it("requêtes identiques simultanées (réessai réseau) : pas de faux conflit, pas de doublon", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const pid = uuid();
    const [p1, p2] = await Promise.all([1, 2].map(() => a.client.rpc("create_patient", { p_id: pid, p_last_name: "Simultane", p_first_name: "Test" })));
    expect(p1.error, JSON.stringify([p1.error, p2.error])).toBeNull();
    expect(p2.error, JSON.stringify([p1.error, p2.error])).toBeNull();
    const id = uuid();
    const args = { p_id: id, p_patient_id: pid, p_document_date: "2026-09-28", p_note: null, p_page_count: 1 };
    const [d1, d2] = await Promise.all([a.client.rpc("create_document", args), a.client.rpc("create_document", args)]);
    expect(d1.error, JSON.stringify([d1.error, d2.error])).toBeNull();
    expect(d2.error, JSON.stringify([d1.error, d2.error])).toBeNull();
    const img = await fakeSheet("simultane");
    for (let round = 0; round < 8; round++) {
      const docId = uuid();
      await a.client.rpc("create_document", { ...args, p_id: docId });
      const pageId = uuid();
      const res = await Promise.all([0, 1, 2].map(() => uploadPage(a.token, docId, pageId, 1, img)));
      for (const r of res) expect([200, 201], JSON.stringify(res.map((x) => [x.status, x.body.error]))).toContain(r.status);
      expect((await db("select 1 from pages where document_id = $1", [docId])).length).toBe(1);
    }
  });

  it("les images sont stockées avec une consigne « pas de cache » (max-age=0)", async () => {
    // Protection principale côté navigateur : SecureImage télécharge en « no-store » (voir e2e).
    const a = await login("dentiste@cabinet-a.test");
    const doc = await newDocument(a, A_PATIENT_JEAN, 1);
    await uploadPage(a.token, doc.id, uuid(), 1, await fakeSheet("cache"));
    const rows = await db<{ cc: string }>(
      `select o.metadata->>'cacheControl' as cc from storage.objects o
       join pages p on p.storage_path = o.name or p.thumb_path = o.name where p.document_id = $1`, [doc.id]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.cc === "max-age=0")).toBe(true);
  });

  it("journée chargée : 50 pages envoyées par l'API, toutes enregistrées une seule fois", async () => {
    const a = await login("dentiste@cabinet-a.test");
    const img = await fakeSheet("volume");
    let total = 0;
    for (let d = 0; d < 10; d++) {
      const doc = await newDocument(a, A_PATIENT_JEAN, 5);
      for (let n = 1; n <= 5; n++) {
        const r = await uploadPage(a.token, doc.id, uuid(), n, img);
        expect(r.status).toBe(201);
        total++;
      }
      expect((await a.client.rpc("finalize_document", { p_id: doc.id })).data.sync_status).toBe("synced");
    }
    expect(total).toBe(50);
  }, 180_000);
});

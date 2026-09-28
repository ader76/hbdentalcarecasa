// Sauvegarde chiffrée complète : base (comptes + données) + images.
// Usage : npx tsx scripts/backup.mts <dossier-de-destination>
// Les images déjà présentes dans le dossier (même empreinte) ne sont pas recopiées.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv } from "./env";
import { TABLES, deriveKey, encrypt, ensureDir, sha256, storageAdmin, withDb, type Manifest } from "./backup-lib.mts";

loadEnv();

export async function backup(dir: string): Promise<Manifest> {
  ensureDir(join(dir, "objects"));
  const key = deriveKey(requireEnv("BACKUP_PASSPHRASE"), dir, true);

  // Instantané cohérent des tables (transaction en lecture seule, isolation « repeatable read »).
  const data = await withDb(async (c) => {
    await c.query("begin isolation level repeatable read read only");
    const out: Record<string, unknown[]> = {};
    for (const t of TABLES) out[t] = (await c.query(`select * from ${t}`)).rows;
    await c.query("commit");
    return out;
  });

  const dbJson = Buffer.from(JSON.stringify(data));
  writeFileSync(join(dir, "db.json.enc"), encrypt(key, dbJson));

  const bucket = storageAdmin().storage.from("fiches");
  const objects: Manifest["objects"] = [];
  const pages = data["public.pages"] as { storage_path: string; thumb_path: string; sha256: string }[];
  for (const p of pages) {
    for (const path of [p.storage_path, p.thumb_path]) {
      const { data: blob, error } = await bucket.download(path);
      if (error || !blob) throw new Error(`fichier illisible dans le stockage : ${path}`);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const h = sha256(bytes);
      if (path === p.storage_path && h !== p.sha256) throw new Error(`empreinte incorrecte dans le stockage : ${path}`);
      const target = join(dir, "objects", `${h}.enc`);
      if (!existsSync(target)) writeFileSync(target, encrypt(key, bytes));
      objects.push({ path, sha256: h, size: bytes.length });
    }
  }

  const manifest: Manifest = {
    format: 1,
    createdAt: new Date().toISOString(),
    source: new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL")).host,
    tables: Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, { rows: rows.length }])),
    dbSha256: sha256(dbJson),
    objects,
  };
  writeFileSync(join(dir, "manifest.json.enc"), encrypt(key, Buffer.from(JSON.stringify(manifest))));
  return manifest;
}

if (process.argv[1]?.split(/[\\/]/).pop() === "backup.mts") {
  const dir = process.argv[2];
  if (!dir) { console.error("Usage : npx tsx scripts/backup.mts <dossier>"); process.exit(1); }
  backup(dir).then((m) => {
    console.log(`Sauvegarde terminée : ${Object.entries(m.tables).map(([t, v]) => `${t}=${v.rows}`).join(", ")}, ${m.objects.length} fichiers.`);
  }, (e) => { console.error("ÉCHEC de la sauvegarde :", e.message); process.exit(1); });
}

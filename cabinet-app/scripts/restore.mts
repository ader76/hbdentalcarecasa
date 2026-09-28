// Restauration d'une sauvegarde chiffrée dans une base VIDE (schéma déjà migré).
// Usage : npx tsx scripts/restore.mts <dossier> --confirm <hôte-cible>
// L'option --confirm doit reprendre l'hôte de NEXT_PUBLIC_SUPABASE_URL : protection
// contre une restauration dans le mauvais environnement.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEnv, requireEnv } from "./env";
import { TABLES, decrypt, deriveKey, sha256, storageAdmin, tableColumns, withDb, type Manifest } from "./backup-lib.mts";

loadEnv();

export interface RestoreReport { tables: Record<string, number>; objects: number; verifiedPages: number }

export async function restore(dir: string, confirmHost: string): Promise<RestoreReport> {
  const host = new URL(requireEnv("NEXT_PUBLIC_SUPABASE_URL")).host;
  if (confirmHost !== host) throw new Error(`confirmation invalide : la cible est ${host}`);
  const key = deriveKey(requireEnv("BACKUP_PASSPHRASE"), dir, false);
  const manifest = JSON.parse(decrypt(key, readFileSync(join(dir, "manifest.json.enc"))).toString()) as Manifest;
  const dbJson = decrypt(key, readFileSync(join(dir, "db.json.enc")));
  if (sha256(dbJson) !== manifest.dbSha256) throw new Error("db.json altéré (empreinte différente)");
  const data = JSON.parse(dbJson.toString()) as Record<string, Record<string, unknown>[]>;
  for (const [t, { rows }] of Object.entries(manifest.tables)) {
    if ((data[t]?.length ?? 0) !== rows) throw new Error(`nombre de lignes incohérent pour ${t}`);
  }

  // 1. Vérifie tous les fichiers AVANT de toucher à la cible.
  for (const o of manifest.objects) {
    const f = join(dir, "objects", `${o.sha256}.enc`);
    if (!existsSync(f)) throw new Error(`fichier manquant dans la sauvegarde : ${o.sha256}`);
    if (sha256(decrypt(key, readFileSync(f))) !== o.sha256) throw new Error(`fichier altéré : ${o.sha256}`);
  }

  // 2. Base : cible vide obligatoire, tout dans une transaction.
  const tables: Record<string, number> = {};
  await withDb(async (c) => {
    const { rows } = await c.query("select (select count(*) from public.patients) + (select count(*) from public.documents) as n");
    if (Number(rows[0].n) > 0) throw new Error("la base cible n'est pas vide : restauration refusée");
    await c.query("begin");
    try {
      await c.query("delete from public.members; delete from public.cabinets; delete from auth.mfa_factors; delete from auth.identities; delete from auth.sessions; delete from auth.users");
      for (const t of TABLES) {
        const rowsT = data[t] ?? [];
        tables[t] = rowsT.length;
        if (rowsT.length === 0) continue;
        const { cols, identityAlways } = await tableColumns(c, t);
        const list = cols.map((x) => `"${x}"`).join(", ");
        await c.query(
          `insert into ${t} (${list}) ${identityAlways ? "overriding system value" : ""}
           select ${list} from json_populate_recordset(null::${t}, $1::json)`, [JSON.stringify(rowsT)]);
      }
      await c.query("select setval('public.audit_log_id_seq', greatest((select coalesce(max(id), 0) from public.audit_log), 1))");
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw e;
    }
  });

  // 3. Fichiers images.
  const bucket = storageAdmin().storage.from("fiches");
  for (const o of manifest.objects) {
    const bytes = decrypt(key, readFileSync(join(dir, "objects", `${o.sha256}.enc`)));
    const { error } = await bucket.upload(o.path, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "0" });
    if (error) throw new Error(`envoi impossible : ${o.path}`);
  }

  // 4. Vérification : chaque page restaurée est relue et comparée à son empreinte.
  let verifiedPages = 0;
  for (const p of data["public.pages"] as { storage_path: string; sha256: string }[]) {
    const { data: blob, error } = await bucket.download(p.storage_path);
    if (error || !blob || sha256(new Uint8Array(await blob.arrayBuffer())) !== p.sha256) {
      throw new Error(`vérification échouée : ${p.storage_path}`);
    }
    verifiedPages++;
  }
  return { tables, objects: manifest.objects.length, verifiedPages };
}

if (process.argv[1]?.split(/[\\/]/).pop() === "restore.mts") {
  const dir = process.argv[2];
  const i = process.argv.indexOf("--confirm");
  if (!dir || i < 0) { console.error("Usage : npx tsx scripts/restore.mts <dossier> --confirm <hôte-cible>"); process.exit(1); }
  restore(dir, process.argv[i + 1]).then((r) => {
    console.log(`Restauration terminée et vérifiée : ${JSON.stringify(r.tables)} ; ${r.verifiedPages} pages vérifiées.`);
  }, (e) => { console.error("ÉCHEC de la restauration :", e.message); process.exit(1); });
}

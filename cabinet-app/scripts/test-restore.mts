// Test RÉEL de restauration (pile locale, données fictives uniquement) :
// données créées par l'application → sauvegarde chiffrée → effacement complet
// (base + fichiers) → restauration → vérifications (connexion, dossiers, images).
import { execSync, spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { loadEnv } from "./env";
import { decrypt, deriveKey, sha256, storageAdmin, withDb } from "./backup-lib.mts";

loadEnv();
if (!/127\.0\.0\.1|localhost/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")) throw new Error("test local uniquement");
process.env.BACKUP_PASSPHRASE ??= "phrase-de-test-locale-uniquement-0123456789";
const BASE = "http://127.0.0.1:3300";
const PASSWORD = "Fictif-Demo-2026!";
const log = (s: string) => console.log(`• ${s}`);

async function up(): Promise<boolean> { try { return (await fetch(`${BASE}/login`)).ok; } catch { return false; } }

async function login() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: "dentiste@cabinet-a.test", password: PASSWORD });
  if (error) throw error;
  return { c, token: data.session!.access_token };
}

async function snapshot() {
  return withDb(async (c) => ({
    counts: (await c.query(`select (select count(*) from auth.users) u, (select count(*) from patients) p,
      (select count(*) from documents) d, (select count(*) from pages) g, (select count(*) from audit_log) a`)).rows[0],
    // lignes complètes (dates comprises) converties en texte par PostgreSQL lui-même
    rows: (await c.query(`select
      (select json_agg(p order by p.id)::text from patients p) as patients,
      (select json_agg(d order by d.id)::text from documents d) as documents,
      (select json_agg(g order by g.id)::text from pages g) as pages,
      (select json_agg(a order by a.id)::text from audit_log a) as audit,
      (select json_agg(json_build_object('id', u.id, 'email', u.email, 'pw', u.encrypted_password, 'created', u.created_at) order by u.id)::text from auth.users u) as users`)).rows[0],
  }));
}

const { backup } = await import("./backup.mts");
const { restore } = await import("./restore.mts");

execSync("npx supabase db reset", { stdio: "ignore" });
execSync("npx tsx scripts/seed-dev.ts", { stdio: "ignore" });
const server = (await up()) ? null : spawn("npx", ["next", "start", "-p", "3300", "-H", "127.0.0.1"], { stdio: "ignore", env: process.env, detached: true });
for (let i = 0; i < 60 && !(await up()); i++) await new Promise((r) => setTimeout(r, 500));

try {
  // 1. Données créées par le vrai parcours (API de l'application)
  const { c, token } = await login();
  for (let d = 0; d < 3; d++) {
    const id = crypto.randomUUID();
    await c.rpc("create_document", { p_id: id, // dates variées dont un changement d'heure
 p_patient_id: "11111111-1111-4111-8111-11111111111" + (d % 2 ? "1" : "2"),
      p_document_date: ["2026-09-28", "2026-03-29", "2026-10-25"][d], p_note: `note fictive ${d}`, p_page_count: 2 });
    for (let n = 1; n <= 2; n++) {
      const img = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 250, g: 250, b: 245 - d * 10 - n } } }).jpeg().toBuffer();
      const res = await fetch(`${BASE}/api/pages?documentId=${id}&pageId=${crypto.randomUUID()}&pageNumber=${n}`, {
        method: "PUT", headers: { Authorization: `Bearer ${token}`, "x-content-sha256": sha256(img) }, body: img as unknown as BodyInit });
      if (res.status !== 201) throw new Error(`envoi page : HTTP ${res.status}`);
    }
    await c.rpc("finalize_document", { p_id: id });
  }
  await c.rpc("move_document", { p_id: (await withDb((x) => x.query("select id from documents limit 1"))).rows[0].id,
    p_new_patient_id: "11111111-1111-4111-8111-111111111113", p_reason: "test restauration" });
  const before = await snapshot();
  log(`Avant : ${JSON.stringify(before.counts)}`);

  // 2. Sauvegarde chiffrée
  const dir = mkdtempSync(join(tmpdir(), "sauvegarde-"));
  const m = await backup(dir);
  log(`Sauvegarde : ${m.objects.length} fichiers, ${Object.keys(m.tables).length} tables → ${dir}`);
  const rawDb = readFileSync(join(dir, "db.json.enc"));
  if (rawDb.includes(Buffer.from("DUPONT"))) throw new Error("la sauvegarde n'est pas chiffrée !");
  log("Contenu illisible sans la phrase secrète (aucun nom en clair) : OK");

  // 2b. Une sauvegarde altérée doit être détectée
  const tampered = mkdtempSync(join(tmpdir(), "alteree-"));
  cpSync(dir, tampered, { recursive: true });
  const buf = readFileSync(join(tampered, "db.json.enc"));
  buf[buf.length - 20] ^= 0xff;
  writeFileSync(join(tampered, "db.json.enc"), buf);
  let detected = false;
  try { decrypt(deriveKey(process.env.BACKUP_PASSPHRASE!, tampered, false), buf); } catch { detected = true; }
  if (!detected) throw new Error("altération non détectée");
  log("Sauvegarde altérée détectée : OK");
  let wrongPass = false;
  try { decrypt(deriveKey("mauvaise-phrase-secrete-de-32-caracteres-min", dir, false), rawDb); } catch { wrongPass = true; }
  if (!wrongPass) throw new Error("mauvaise phrase acceptée");
  log("Mauvaise phrase secrète refusée : OK");

  // 3. Sinistre simulé : fichiers supprimés, base remise à zéro
  const bucket = storageAdmin().storage.from("fiches");
  await bucket.remove(m.objects.map((o) => o.path));
  execSync("npx supabase db reset", { stdio: "ignore" });
  const empty = await snapshot();
  log(`Après sinistre : ${JSON.stringify(empty.counts)}`);

  // 4. Restauration
  const r = await restore(dir, new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host);
  log(`Restauration : ${r.verifiedPages} pages relues et vérifiées par empreinte`);

  // 5. Vérifications
  const after = await snapshot();
  const same = JSON.stringify(before) === JSON.stringify(after);
  if (!same) throw new Error(`différence après restauration : ${JSON.stringify(after.counts)}`);
  log("Lignes complètes identiques (dates, horodatages, empreintes, mots de passe chiffrés, journal) : OK");
  const again = await login();
  const { data: docs } = await again.c.from("documents").select("id").limit(1);
  const res = await fetch(`${BASE}/api/documents/${docs![0].id}/images`, { headers: { Authorization: `Bearer ${again.token}` } });
  const body = await res.json();
  const img = new Uint8Array(await (await fetch(body.pages[0].url)).arrayBuffer());
  if (sha256(img) !== body.pages[0].sha256) throw new Error("image consultée différente");
  log("Connexion avec l'ancien mot de passe et consultation d'une image restaurée : OK");
  // restaurer par-dessus des données existantes est refusé
  let refused = false;
  try { await restore(dir, new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).host); } catch { refused = true; }
  if (!refused) throw new Error("restauration sur base non vide acceptée");
  log("Restauration sur une base non vide refusée : OK");
  rmSync(dir, { recursive: true });
  rmSync(tampered, { recursive: true });
  console.log("\nTEST DE RESTAURATION RÉUSSI");
} finally {
  if (server?.pid) process.kill(-server.pid, "SIGTERM");
}

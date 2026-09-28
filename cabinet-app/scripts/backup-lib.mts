// Sauvegarde chiffrée : bibliothèque commune (sauvegarde, restauration, test).
//
// Format d'un dossier de sauvegarde :
//   key.json            paramètres de dérivation de clé (sel scrypt) — non secret
//   manifest.json.enc   liste des tables, nombres de lignes, empreintes
//   db.json.enc         contenu des tables (auth + application)
//   objects/<sha256>.enc  fichiers images, adressés par leur empreinte (auto-vérifiants)
// Chaque .enc = IV (12 o) + données chiffrées AES-256-GCM + tag (16 o).
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const TABLES = [
  "auth.users", "auth.identities", "auth.mfa_factors",
  "public.cabinets", "public.members", "public.patients", "public.documents", "public.pages", "public.audit_log",
] as const;

export const sha256 = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

export function deriveKey(passphrase: string, dir: string, create: boolean): Buffer {
  if (!passphrase || passphrase.length < 32) throw new Error("BACKUP_PASSPHRASE : 32 caractères minimum");
  const keyFile = join(dir, "key.json");
  let salt: string;
  if (existsSync(keyFile)) salt = JSON.parse(readFileSync(keyFile, "utf8")).salt;
  else if (create) {
    salt = randomBytes(16).toString("hex");
    writeFileSync(keyFile, JSON.stringify({ kdf: "scrypt", N: 32768, r: 8, p: 1, salt }, null, 2));
  } else throw new Error("key.json manquant");
  return scryptSync(passphrase, Buffer.from(salt, "hex"), 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

export function encrypt(key: Buffer, plain: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]);
}

export function decrypt(key: Buffer, data: Buffer): Buffer {
  const iv = data.subarray(0, 12);
  const tag = data.subarray(data.length - 16);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data.subarray(12, data.length - 16)), d.final()]); // lève une erreur si altéré
}

export function ensureDir(p: string): void {
  mkdirSync(p, { recursive: true });
}

export function storageAdmin(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Dates et horodatages conservés en texte brut : aucune conversion par le fuseau
// horaire de la machine (sinon une date « 2026-09-28 » peut devenir le 27).
const RAW_TYPES = new Set([1082, 1083, 1114, 1184, 1266]);
const types = {
  getTypeParser: ((oid: number, format?: string) =>
    RAW_TYPES.has(oid) ? (v: string) => v : pg.types.getTypeParser(oid, format as "text")) as typeof pg.types.getTypeParser,
};

export async function withDb<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, types });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

/** Colonnes insérables (hors colonnes générées) et présence d'une identité « always ». */
export async function tableColumns(c: pg.Client, table: string): Promise<{ cols: string[]; identityAlways: boolean }> {
  const [schema, name] = table.split(".");
  const { rows } = await c.query(
    `select attname, attgenerated, attidentity from pg_attribute
     where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attnum`, [`${schema}.${name}`]);
  return {
    cols: rows.filter((r) => r.attgenerated === "").map((r) => r.attname as string),
    identityAlways: rows.some((r) => r.attidentity === "a"),
  };
}

export interface Manifest {
  format: 1;
  createdAt: string;
  source: string;
  tables: Record<string, { rows: number }>;
  dbSha256: string;
  objects: { path: string; sha256: string; size: number }[];
}

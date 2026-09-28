import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { loadEnv } from "../../scripts/env";

loadEnv();
export const BASE_URL = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100";
export const PASSWORD = "Fictif-Demo-2026!";
export const A_PATIENT_JEAN = "11111111-1111-4111-8111-111111111111";
export const A_PATIENT_JEANNE = "11111111-1111-4111-8111-111111111112";
export const B_PATIENT = "22222222-2222-4222-8222-222222222221";

export function anon(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function service(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface Session { client: SupabaseClient; token: string; userId: string }

export async function login(email: string): Promise<Session> {
  const client = anon();
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return { client, token: data.session!.access_token, userId: data.user.id };
}

/** Client utilisant un jeton d'accès figé (simule un téléphone qui garde son jeton). */
export function withToken(token: string): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
export const uuid = () => randomUUID();

export async function uploadPage(token: string, documentId: string, pageId: string, pageNumber: number, body: Uint8Array, sha = sha256(body)) {
  const qs = new URLSearchParams({ documentId, pageId, pageNumber: String(pageNumber) });
  const res = await fetch(`${BASE_URL}/api/pages?${qs}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg", "x-content-sha256": sha },
    body: body as unknown as BodyInit,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

export async function db<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  try { return (await c.query(sql, params)).rows as T[]; } finally { await c.end(); }
}

export async function newDocument(s: Session, patientId: string, pageCount: number, date = "2026-09-28") {
  const id = uuid();
  const { data, error } = await s.client.rpc("create_document", {
    p_id: id, p_patient_id: patientId, p_document_date: date, p_note: null, p_page_count: pageCount, p_device: "test",
  });
  if (error) throw error;
  return data as { id: string; sync_status: string };
}

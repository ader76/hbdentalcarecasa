import "server-only";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`configuration serveur incomplète (${name})`);
  return v;
}

/** Client « service_role » : contourne RLS. SERVEUR UNIQUEMENT, jamais exposé au navigateur. */
export function serviceClient(): SupabaseClient {
  return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface AuthContext {
  user: User;
  /** Client agissant avec les droits de l'utilisateur (RLS appliquée). */
  client: SupabaseClient;
  member: { user_id: string; cabinet_id: string; role: string };
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Vérifie le jeton de la requête auprès du serveur d'authentification ET que le
 * compte est un membre actif (session non révoquée, MFA respectée : voir
 * private.current_member()). Renvoie une réponse d'erreur sinon.
 */
export async function authenticate(req: Request): Promise<AuthContext | Response> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return json({ error: "non authentifié" }, 401);
  const client = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return json({ error: "session invalide" }, 401);
  // La politique RLS de « members » ne renvoie la ligne que si le compte est actif,
  // la session non révoquée et la double authentification respectée.
  const { data: member } = await client
    .from("members").select("user_id,cabinet_id,role").eq("user_id", data.user.id).maybeSingle();
  if (!member) return json({ error: "accès refusé" }, 403);
  return { user: data.user, client, member };
}

"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Client navigateur : clé publique uniquement, toutes les données sont protégées par RLS. */
export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "cabinet-auth", detectSessionInUrl: false },
    });
  }
  return client;
}

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  return data.session?.access_token ?? null;
}

/** Message d'erreur lisible, sans détail technique ni donnée patient. */
export function friendlyError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? "";
  const code = (e as { code?: string })?.code ?? "";
  if (code === "42501" || /accès refusé|rôle insuffisant/.test(msg)) return "Action non autorisée pour votre compte.";
  if (/fetch|network|Failed to fetch/i.test(msg)) return "Réseau indisponible. Réessayez.";
  if (/motif obligatoire/.test(msg)) return "Merci d'indiquer un motif (3 caractères minimum).";
  if (/introuvable/.test(msg)) return "Élément introuvable (supprimé ou non autorisé).";
  if (/date de naissance/.test(msg)) return "Date de naissance invalide.";
  return "Une erreur est survenue. Réessayez.";
}

// Liens signés de courte durée vers les pages d'un document.
// Aucune URL publique ni permanente : le bucket est privé et chaque consultation
// est journalisée.
import { authenticate, json, serviceClient } from "@/lib/server/supabase";
import { SIGNED_URL_TTL_SECONDS, STORAGE_BUCKET } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: RouteContext<"/api/documents/[id]/images">): Promise<Response> {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;
  const { id } = await ctx.params;
  const thumbsOnly = new URL(req.url).searchParams.get("thumbs") === "1";

  // RLS : ne renvoie rien si le document n'est pas dans le cabinet de l'utilisateur.
  const { data: doc } = await auth.client.from("documents").select("id").eq("id", id).maybeSingle();
  if (!doc) return json({ error: "document introuvable" }, 404);
  const { data: pages, error } = await auth.client
    .from("pages")
    .select("id,page_number,storage_path,thumb_path,width,height,size_bytes,sha256,received_at")
    .eq("document_id", id)
    .order("page_number");
  if (error) return json({ error: "lecture impossible" }, 500);

  const svc = serviceClient();
  const paths = pages.flatMap((p) => (thumbsOnly ? [p.thumb_path] : [p.storage_path, p.thumb_path]));
  const { data: signed, error: signErr } = paths.length
    ? await svc.storage.from(STORAGE_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
    : { data: [], error: null };
  if (signErr) return json({ error: "stockage indisponible" }, 503);
  const byPath = new Map(signed.map((s) => [s.path, s.signedUrl]));

  if (!thumbsOnly) await svc.rpc("server_log_access", { p_actor: auth.user.id, p_document_id: id });

  return json({
    expiresIn: SIGNED_URL_TTL_SECONDS,
    pages: pages.map((p) => ({
      id: p.id,
      pageNumber: p.page_number,
      width: p.width,
      height: p.height,
      size: p.size_bytes,
      sha256: p.sha256,
      receivedAt: p.received_at,
      thumbUrl: byPath.get(p.thumb_path) ?? null,
      url: thumbsOnly ? null : byPath.get(p.storage_path) ?? null,
    })),
  });
}

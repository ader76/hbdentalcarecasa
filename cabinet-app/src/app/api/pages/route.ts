// Réception d'une page photographiée.
// La page n'est enregistrée (et donc comptée pour « Synchronisée ») qu'après :
//   1. authentification + appartenance au cabinet du document (RLS) ;
//   2. contrôle de taille, d'empreinte SHA-256 et du type réel (signature JPEG) ;
//   3. décodage complet de l'image (fichier corrompu ou tronqué → refusé) ;
//   4. retrait des métadonnées (EXIF, GPS…) ;
//   5. stockage privé puis relecture et comparaison de l'empreinte stockée.
// Un renvoi identique (même identifiant, même contenu) ne crée aucun doublon.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { authenticate, json, serviceClient } from "@/lib/server/supabase";
import { hasApp1, isJpeg, JpegError, stripJpegMetadata } from "@/lib/jpeg";
import { MAX_PAGE_BYTES, MAX_PAGE_EDGE, MAX_PAGES_PER_DOCUMENT, MIN_PAGE_EDGE, STORAGE_BUCKET } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function readBody(req: Request, limit: number): Promise<Uint8Array | null> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function PUT(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (auth instanceof Response) return auth;

  const q = new URL(req.url).searchParams;
  const documentId = q.get("documentId") ?? "";
  const pageId = q.get("pageId") ?? "";
  const pageNumber = Number(q.get("pageNumber"));
  const clientSha = (req.headers.get("x-content-sha256") ?? "").toLowerCase();
  if (!UUID.test(documentId) || !UUID.test(pageId) || !Number.isInteger(pageNumber)
      || pageNumber < 1 || pageNumber > MAX_PAGES_PER_DOCUMENT || !SHA.test(clientSha)) {
    return json({ error: "paramètres invalides" }, 400);
  }
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_PAGE_BYTES) return json({ error: "fichier trop volumineux" }, 413);

  // Le document doit être visible par l'utilisateur (même cabinet, compte actif).
  const { data: doc } = await auth.client
    .from("documents").select("id,cabinet_id,page_count,created_by").eq("id", documentId).maybeSingle();
  if (!doc) return json({ error: "document introuvable" }, 404);
  if (doc.created_by !== auth.user.id) return json({ error: "seul l'auteur de la fiche peut y ajouter des pages" }, 403);
  if (pageNumber > doc.page_count) return json({ error: "numéro de page hors limites" }, 422);

  const body = await readBody(req, MAX_PAGE_BYTES);
  if (body === null) return json({ error: "fichier trop volumineux" }, 413);
  if (body.length === 0) return json({ error: "fichier vide" }, 422);
  const receivedSha = sha256(body);
  if (receivedSha !== clientSha) {
    return json({ error: "empreinte différente : fichier altéré pendant le transfert" }, 422);
  }
  if (!isJpeg(body)) return json({ error: "type de fichier refusé (JPEG attendu)" }, 415);

  let stored: Buffer;
  let width: number;
  let height: number;
  // Limite de pixels AVANT tout décodage : une petite image peut déclarer des dimensions énormes.
  const limits = { limitInputPixels: MAX_PAGE_EDGE * MAX_PAGE_EDGE };
  try {
    const meta = await sharp(body, limits).metadata();
    if (meta.format !== "jpeg") return json({ error: "type de fichier refusé (JPEG attendu)" }, 415);
    if (!meta.width || !meta.height || Math.max(meta.width, meta.height) > MAX_PAGE_EDGE) {
      return json({ error: "dimensions d'image non acceptées" }, 422);
    }
    stored = meta.orientation && meta.orientation > 1
      ? await sharp(body, limits).rotate().jpeg({ quality: 90 }).toBuffer()   // cas rare : ré-encodage nécessaire
      : Buffer.from(stripJpegMetadata(body));                          // cas normal : sans perte
    if (hasApp1(stored)) throw new JpegError("métadonnées résiduelles");
    // Décodage complet : un fichier tronqué ou corrompu lève une erreur ici.
    const { info } = await sharp(stored, { ...limits, failOn: "error" }).raw().toBuffer({ resolveWithObject: true });
    width = info.width;
    height = info.height;
  } catch {
    return json({ error: "image corrompue ou illisible" }, 422);
  }
  if (Math.max(width, height) < MIN_PAGE_EDGE || Math.max(width, height) > MAX_PAGE_EDGE) {
    return json({ error: "dimensions d'image non acceptées" }, 422);
  }
  const storedSha = sha256(stored);
  const svc = serviceClient();

  // Renvoi d'une page déjà enregistrée : réponse identique, aucun doublon.
  const alreadyRegistered = async (): Promise<Response | null> => {
    const { data: existing } = await svc
      .from("pages").select("id,document_id,page_number,sha256").eq("id", pageId).maybeSingle();
    if (!existing) return null;
    if (existing.document_id === documentId && existing.page_number === pageNumber && existing.sha256 === storedSha) {
      return json({ pageId, receivedSha256: receivedSha, storedSha256: storedSha, duplicate: true });
    }
    return json({ error: "conflit : page déjà reçue avec un contenu différent" }, 409);
  };
  const dup = await alreadyRegistered();
  if (dup) return dup;

  // Chemins sans aucune donnée patient ; le patient est porté par la base.
  const base = `${doc.cabinet_id}/${documentId}/${pageId}`;
  const storagePath = `${base}.jpg`;
  const thumbPath = `${base}.thumb.jpg`;
  const thumb = await sharp(stored).resize(400, 400, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();

  const bucket = svc.storage.from(STORAGE_BUCKET);
  const opts = { contentType: "image/jpeg", cacheControl: "0" }; // consigne « pas de cache »
  const storedHash = async (path: string) => {
    const { data } = await bucket.download(path);
    return data ? sha256(new Uint8Array(await data.arrayBuffer())) : null;
  };
  // Le fichier est déjà présent et identique (renvoi) : pas de réécriture. Sinon écriture avec
  // remplacement ; un envoi simultané du même fichier est absorbé par la relecture répétée ci-dessous.
  const put = async (path: string, bytes: Buffer) => {
    if ((await storedHash(path)) === sha256(bytes)) return true;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!(await bucket.upload(path, bytes, { ...opts, upsert: true })).error) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  };
  if (!(await put(storagePath, stored)) || !(await put(thumbPath, thumb))) {
    return (await alreadyRegistered()) ?? json({ error: "stockage indisponible" }, 503);
  }

  // Relecture : on confirme que le fichier réellement stocké est intact.
  let verified = false;
  for (let attempt = 0; attempt < 3 && !verified; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 200));
    verified = (await storedHash(storagePath)) === storedSha;
  }
  if (!verified) return (await alreadyRegistered()) ?? json({ error: "vérification du stockage échouée" }, 503);

  const { error: regErr } = await svc.rpc("server_register_page", {
    p_actor: auth.user.id, p_id: pageId, p_document_id: documentId, p_page_number: pageNumber,
    p_storage_path: storagePath, p_thumb_path: thumbPath, p_size: stored.length,
    p_width: width, p_height: height, p_sha256: storedSha,
  });
  if (regErr) {
    if (regErr.code === "23505") return (await alreadyRegistered()) ?? json({ error: "conflit de page" }, 409);
    return json({ error: "enregistrement impossible" }, 503);
  }
  return json({ pageId, receivedSha256: receivedSha, storedSha256: storedSha, duplicate: false }, 201);
}

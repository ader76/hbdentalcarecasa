// Outils JPEG sans perte : détection du type réel et retrait des métadonnées.
// Utilisé côté serveur (contrôle des fichiers reçus) et dans les tests.

/** Vrai si les octets commencent par la signature JPEG (SOI + marqueur). */
export function isJpeg(buf: Uint8Array): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export class JpegError extends Error {}

type Part =
  | { kind: "segment"; marker: number; bytes: Uint8Array }   // marqueur + longueur + contenu
  | { kind: "standalone"; marker: number; bytes: Uint8Array } // RSTn, TEM
  | { kind: "entropy"; bytes: Uint8Array }                     // données compressées d'un scan
  | { kind: "eoi"; bytes: Uint8Array };

/**
 * Parcourt TOUT le fichier : segments d'en-tête, données de chaque scan (y compris
 * les marqueurs placés entre les scans d'un JPEG progressif) jusqu'à la fin d'image.
 * Tout ce qui suit la fin d'image est ignoré (images secondaires, données cachées).
 */
function* parts(buf: Uint8Array): Generator<Part> {
  if (!isJpeg(buf)) throw new JpegError("signature JPEG absente");
  let i = 2;
  let sawScan = false;
  while (i < buf.length) {
    if (buf[i] !== 0xff) throw new JpegError(`marqueur attendu à l'octet ${i}`);
    while (i + 1 < buf.length && buf[i + 1] === 0xff) i++; // octets de remplissage
    const marker = buf[i + 1];
    if (marker === undefined) throw new JpegError("fichier tronqué");
    if (marker === 0xd9) {
      if (!sawScan) throw new JpegError("aucune donnée d'image");
      yield { kind: "eoi", bytes: buf.subarray(i, i + 2) };
      return;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      yield { kind: "standalone", marker, bytes: buf.subarray(i, i + 2) };
      i += 2;
      continue;
    }
    if (i + 4 > buf.length) throw new JpegError("fichier tronqué");
    const len = (buf[i + 2] << 8) | buf[i + 3];
    if (len < 2 || i + 2 + len > buf.length) throw new JpegError("longueur de segment invalide");
    yield { kind: "segment", marker, bytes: buf.subarray(i, i + 2 + len) };
    i += 2 + len;
    if (marker === 0xda) {
      // Données compressées : 0xFF n'y apparaît que suivi de 0x00 (échappement) ou d'un RSTn.
      sawScan = true;
      let k = i;
      for (;;) {
        if (k + 1 >= buf.length) throw new JpegError("fin d'image absente");
        if (buf[k] === 0xff) {
          const n = buf[k + 1];
          if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { k += 2; continue; }
          if (n === 0xff) { k++; continue; }
          break;
        }
        k++;
      }
      yield { kind: "entropy", bytes: buf.subarray(i, k) };
      i = k;
    }
  }
  throw new JpegError("fin d'image absente");
}

const ICC = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00]; // "ICC_PROFILE\0"

function isIccSegment(seg: Uint8Array): boolean {
  return ICC.every((b, k) => seg[4 + k] === b);
}

/**
 * Conserve : APP0 (JFIF), APP2 s'il s'agit d'un profil de couleur ICC, APP14 (Adobe,
 * nécessaire au décodage de certaines images). Retire : EXIF/GPS/XMP (APP1), images
 * secondaires MPF (APP2 non ICC), IPTC et autres APPn, commentaires, et toute donnée
 * après la fin d'image.
 */
function keep(p: Part): boolean {
  if (p.kind !== "segment") return true;
  const m = p.marker;
  if (m === 0xfe) return false;
  if (m >= 0xe0 && m <= 0xef) return m === 0xe0 || m === 0xee || (m === 0xe2 && isIccSegment(p.bytes));
  return true;
}

/** Retire les métadonnées sans ré-encoder l'image (aucune perte de qualité). Lève JpegError si invalide. */
export function stripJpegMetadata(buf: Uint8Array): Uint8Array {
  const out: Uint8Array[] = [buf.subarray(0, 2)];
  for (const p of parts(buf)) if (keep(p)) out.push(p.bytes);
  return concat(out);
}

/** Vrai s'il reste, n'importe où dans l'image, un segment de métadonnées non autorisé. */
export function hasApp1(buf: Uint8Array): boolean {
  for (const p of parts(buf)) if (p.kind === "segment" && !keep(p)) return true;
  return false;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const res = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { res.set(p, o); o += p.length; }
  return res;
}

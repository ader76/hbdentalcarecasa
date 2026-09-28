// Traitement des photos dans le navigateur.
// Le ré-encodage via <canvas> corrige l'orientation EXIF et supprime TOUTES les
// métadonnées (dont la géolocalisation) : le JPEG produit ne contient pas d'EXIF.
import {
  MAX_CAPTURE_BYTES, PAGE_JPEG_QUALITY, PAGE_MAX_EDGE, THUMB_MAX_EDGE,
} from "@/lib/constants";
import type { ImageOp } from "@/lib/queue/db";

export class ImageProcessingError extends Error {}

export interface ProcessedImage {
  blob: Blob;
  thumb: Blob;
  sha256: string;
  width: number;
  height: number;
}

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;

function makeCanvas(w: number, h: number): Canvas2D {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: Canvas2D): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const ctx = c.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new ImageProcessingError("Canvas indisponible");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return ctx;
}

async function toJpeg(c: Canvas2D, quality: number): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob({ type: "image/jpeg", quality });
  return new Promise((resolve, reject) =>
    (c as HTMLCanvasElement).toBlob((b) => (b ? resolve(b) : reject(new ImageProcessingError("Encodage impossible"))), "image/jpeg", quality),
  );
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    // « from-image » applique l'orientation EXIF de la photo.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageProcessingError("Photo illisible ou format non pris en charge. Reprenez la photo.");
  }
}

function fit(w: number, h: number, maxEdge: number): [number, number] {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return [Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))];
}

async function drawScaled(src: CanvasImageSource, sw: number, sh: number, maxEdge: number): Promise<Canvas2D> {
  const [w, h] = fit(sw, sh, maxEdge);
  const c = makeCanvas(w, h);
  const ctx = ctx2d(c);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

/**
 * Première étape après la prise de vue : vérifie, redresse, réduit et
 * ré-encode la photo. Le résultat est la « source » conservée localement.
 */
export async function normalizeCapture(file: Blob): Promise<Blob> {
  if (file.size === 0) throw new ImageProcessingError("Photo vide. Reprenez la photo.");
  if (file.size > MAX_CAPTURE_BYTES) throw new ImageProcessingError("Photo trop volumineuse.");
  if (file.type && !file.type.startsWith("image/")) throw new ImageProcessingError("Ce fichier n'est pas une image.");
  const bmp = await decode(file);
  try {
    const c = await drawScaled(bmp, bmp.width, bmp.height, PAGE_MAX_EDGE);
    return await toJpeg(c, 0.92);
  } finally {
    bmp.close();
  }
}

/** Applique rotations et recadrages à la source (un seul ré-encodage final). */
export async function renderPage(source: Blob, ops: ImageOp[]): Promise<ProcessedImage> {
  const bmp = await decode(source);
  let canvas: Canvas2D = makeCanvas(bmp.width, bmp.height);
  ctx2d(canvas).drawImage(bmp, 0, 0);
  bmp.close();

  for (const op of ops) {
    if (op.type === "rotate") {
      const next = makeCanvas(canvas.height, canvas.width);
      const ctx = ctx2d(next);
      ctx.translate(next.width / 2, next.height / 2);
      ctx.rotate((op.deg * Math.PI) / 180);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      canvas = next;
    } else {
      const x = Math.max(0, Math.round(op.x));
      const y = Math.max(0, Math.round(op.y));
      const w = Math.min(canvas.width - x, Math.round(op.width));
      const h = Math.min(canvas.height - y, Math.round(op.height));
      if (w < 50 || h < 50) continue; // recadrage aberrant ignoré
      const next = makeCanvas(w, h);
      ctx2d(next).drawImage(canvas, x, y, w, h, 0, 0, w, h);
      canvas = next;
    }
  }

  const out = await drawScaled(canvas, canvas.width, canvas.height, PAGE_MAX_EDGE);
  const blob = await toJpeg(out, PAGE_JPEG_QUALITY);
  const thumbCanvas = await drawScaled(out, out.width, out.height, THUMB_MAX_EDGE);
  const thumb = await toJpeg(thumbCanvas, 0.7);
  return { blob, thumb, sha256: await sha256Hex(blob), width: out.width, height: out.height };
}

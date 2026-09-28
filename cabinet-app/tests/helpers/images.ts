// Images FICTIVES de fiches (texte générique, aucune donnée réelle).
import sharp from "sharp";

export async function fakeSheet(label: string, opts: { width?: number; height?: number } = {}): Promise<Buffer> {
  const w = opts.width ?? 1240;
  const h = opts.height ?? 1754;
  const lines = Array.from({ length: 18 }, (_, i) =>
    `<text x="80" y="${260 + i * 72}" font-size="34" font-family="sans-serif" fill="#1e3a8a">Ligne manuscrite fictive ${i + 1} — ${label}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <rect width="100%" height="100%" fill="#fdfdf8"/>
    <text x="80" y="140" font-size="56" font-family="sans-serif" fill="#111">FICHE FICTIVE — ${label}</text>${lines}</svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 85 }).toBuffer();
}

/** JPEG avec EXIF contenant une position GPS fictive. */
export async function sheetWithGps(label: string): Promise<Buffer> {
  const base = await fakeSheet(label);
  return sharp(base).withExif({
    IFD0: { Make: "FictivePhone", Model: "Test" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "33/1 35/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "7/1 36/1 0/1" },
  }).jpeg({ quality: 85 }).toBuffer();
}

export async function fakePng(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 1000, channels: 3, background: "#fff" } }).png().toBuffer();
}

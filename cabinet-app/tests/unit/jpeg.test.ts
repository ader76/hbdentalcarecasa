import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { hasApp1, isJpeg, JpegError, stripJpegMetadata } from "@/lib/jpeg";
import { fakePng, fakeSheet, sheetWithGps } from "../helpers/images";

describe("stripJpegMetadata", () => {
  it("retire l'EXIF et la position GPS sans modifier les pixels", async () => {
    const withGps = await sheetWithGps("gps");
    expect(hasApp1(withGps)).toBe(true);
    expect((await sharp(withGps).metadata()).exif).toBeDefined();

    const stripped = stripJpegMetadata(withGps);
    expect(hasApp1(stripped)).toBe(false);
    expect((await sharp(stripped).metadata()).exif).toBeUndefined();

    const a = await sharp(withGps).raw().toBuffer();
    const b = await sharp(Buffer.from(stripped)).raw().toBuffer();
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("laisse intact un JPEG déjà sans métadonnées", async () => {
    const clean = stripJpegMetadata(await fakeSheet("x"));
    expect(Buffer.compare(Buffer.from(stripJpegMetadata(clean)), Buffer.from(clean))).toBe(0);
  });

  it("supprime les données cachées après la fin d'image et les images secondaires (APP2 non ICC)", async () => {
    const base = await fakeSheet("cache");
    const mpf = Buffer.concat([Buffer.from([0xff, 0xe2, 0x00, 0x0a]), Buffer.from("MPF\0GPS!")]);
    const withExtra = Buffer.concat([base.subarray(0, 2), mpf, base.subarray(2), Buffer.from("DONNEES-CACHEES-GPS")]);
    expect(hasApp1(withExtra)).toBe(true);
    const out = Buffer.from(stripJpegMetadata(withExtra));
    expect(out.includes(Buffer.from("DONNEES-CACHEES"))).toBe(false);
    expect(out.includes(Buffer.from("MPF"))).toBe(false);
    expect(out.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect((await sharp(out).metadata()).width).toBe(1240);
  });

  it("conserve le profil de couleur ICC", async () => {
    const withIcc = await sharp(await fakeSheet("icc")).withIccProfile("srgb").jpeg().toBuffer();
    const out = Buffer.from(stripJpegMetadata(withIcc));
    expect((await sharp(out).metadata()).icc).toBeDefined();
  });

  it("JPEG progressif : retire aussi les métadonnées glissées entre deux scans", async () => {
    const prog = await sharp(await fakeSheet("prog")).jpeg({ progressive: true }).toBuffer();
    // insère un segment EXIF juste avant le 2e marqueur de début de scan (FFDA)
    let sos = -1, count = 0;
    for (let k = 0; k < prog.length - 1; k++) {
      if (prog[k] === 0xff && prog[k + 1] === 0xda && ++count === 2) { sos = k; break; }
    }
    expect(sos).toBeGreaterThan(0);
    const exif = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x0c]), Buffer.from("Exif\0\0GPS!")]);
    const tampered = Buffer.concat([prog.subarray(0, sos), exif, prog.subarray(sos)]);
    expect(hasApp1(tampered)).toBe(true);
    const out = Buffer.from(stripJpegMetadata(tampered));
    expect(hasApp1(out)).toBe(false);
    const a = await sharp(prog).raw().toBuffer();
    const b = await sharp(out).raw().toBuffer();
    expect(Buffer.compare(a, b)).toBe(0);
  });

  it("refuse un fichier qui n'est pas un JPEG", async () => {
    const png = await fakePng();
    expect(isJpeg(png)).toBe(false);
    expect(() => stripJpegMetadata(png)).toThrow(JpegError);
  });

  it("refuse un JPEG tronqué avant les données d'image", async () => {
    const buf = await fakeSheet("t");
    expect(() => stripJpegMetadata(buf.subarray(0, 40))).toThrow(JpegError);
  });
});

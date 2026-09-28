// Génère les icônes PWA (exécuté une fois, résultat commité dans public/).
import sharp from "sharp";

const svg = (pad: number) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" rx="${pad ? 0 : 96}" fill="#0f766e"/>
  <g transform="translate(${pad},${pad}) scale(${(512 - 2 * pad) / 512})">
    <rect x="136" y="96" width="240" height="320" rx="20" fill="#fff"/>
    <rect x="172" y="150" width="168" height="16" rx="8" fill="#99f6e4"/>
    <rect x="172" y="196" width="168" height="16" rx="8" fill="#99f6e4"/>
    <rect x="172" y="242" width="120" height="16" rx="8" fill="#99f6e4"/>
    <circle cx="340" cy="360" r="62" fill="#134e4a"/>
    <circle cx="340" cy="360" r="30" fill="none" stroke="#fff" stroke-width="12"/>
  </g></svg>`);

await sharp(svg(0)).resize(192).png().toFile("public/icon-192.png");
await sharp(svg(0)).resize(512).png().toFile("public/icon-512.png");
await sharp(svg(56)).resize(512).png().toFile("public/icon-maskable-512.png");
await sharp(svg(0)).resize(180).png().toFile("public/apple-touch-icon.png");
console.log("icônes générées");

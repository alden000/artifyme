// Renders PWA / Apple icons from public/icons/logo.svg.
import sharp from 'sharp';
import fs from 'node:fs/promises';

const svg = await fs.readFile('public/icons/logo.svg');
const out = 'public/icons';
await sharp(svg).resize(192, 192).png().toFile(`${out}/icon-192.png`);
await sharp(svg).resize(512, 512).png().toFile(`${out}/icon-512.png`);
await sharp(svg).resize(180, 180).png().toFile(`${out}/apple-touch-icon.png`);
await sharp(svg).resize(64, 64).png().toFile(`${out}/favicon-64.png`);
// Maskable: shrink artwork into the 80% safe zone over the same background colour.
const inner = await sharp(svg).resize(400, 400).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0e0b13' } })
  .composite([{ input: inner, top: 56, left: 56 }])
  .png()
  .toFile(`${out}/icon-maskable-512.png`);
console.log('icons written');

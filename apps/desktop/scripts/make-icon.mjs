// Renders the gRabbit icon (gradient tile, rabbit ears, download arrow) to PNG without dependencies.
// Usage: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed distance functions in unit coordinates (0..1)
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdCapsule(x, y, ax, ay, bx, by, r) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}
function mix(a, b, t) {
  return a + (b - a) * t;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.2 / size;
  const top = [124, 92, 255];
  const bottom = [255, 92, 138];
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size;
      const y = (py + 0.5) / size;
      const tile = sdRoundRect(x, y, 0.5, 0.5, 0.46, 0.46, 0.13);
      const tileCov = Math.max(0, Math.min(1, 0.5 - tile / aa));
      if (tileCov <= 0) continue;

      const g = Math.max(0, Math.min(1, (x * 0.45 + y * 0.9) / 1.2));
      let r = mix(top[0], bottom[0], g);
      let gr = mix(top[1], bottom[1], g);
      let b = mix(top[2], bottom[2], g);
      // Soft highlight in the upper-left corner
      const glow = Math.max(0, 1 - Math.hypot(x - 0.25, y - 0.15) / 0.55) * 0.18;
      r = mix(r, 255, glow);
      gr = mix(gr, 255, glow);
      b = mix(b, 255, glow);

      const ears = Math.min(
        sdCapsule(x, y, 0.405, 0.4, 0.33, 0.14, 0.062),
        sdCapsule(x, y, 0.595, 0.4, 0.67, 0.14, 0.062)
      );
      const innerEars = Math.min(
        sdCapsule(x, y, 0.4, 0.37, 0.345, 0.18, 0.024),
        sdCapsule(x, y, 0.6, 0.37, 0.655, 0.18, 0.024)
      );
      const arrow = Math.min(
        sdCapsule(x, y, 0.5, 0.44, 0.5, 0.71, 0.052),
        sdCapsule(x, y, 0.5, 0.735, 0.355, 0.59, 0.052),
        sdCapsule(x, y, 0.5, 0.735, 0.645, 0.59, 0.052)
      );
      const base = sdCapsule(x, y, 0.3, 0.845, 0.7, 0.845, 0.04);
      const white = Math.min(ears, arrow, base);
      const whiteCov = Math.max(0, Math.min(1, 0.5 - white / aa));
      const innerCov = Math.max(0, Math.min(1, 0.5 - innerEars / aa));

      r = mix(r, 255, whiteCov);
      gr = mix(gr, 255, whiteCov);
      b = mix(b, 255, whiteCov);
      // Pink inner ears
      r = mix(r, 255, innerCov * 0.9);
      gr = mix(gr, 150, innerCov * 0.9);
      b = mix(b, 185, innerCov * 0.9);

      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(gr);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(tileCov * 255);
    }
  }
  return encodePng(size, rgba);
}

const outputs = [
  [join(root, 'build', 'icon.png'), 512],
  [join(root, 'resources', 'icon.png'), 256],
  [join(root, 'src', 'renderer', 'src', 'assets', 'icon.png'), 64],
];
for (const [path, size] of outputs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, render(size));
  console.log(`wrote ${path} (${size}x${size})`);
}

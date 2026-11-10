// Renders the GRabbit icon (sleek squircle tile, sculpted rabbit silhouette + tapered ears, high-speed download arrow) to PNG & ICO without dependencies.
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

function encodeIco(pngBuffersWithSizes) {
  const count = pngBuffersWithSizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const dirEntries = [];
  let offset = 6 + count * 16;
  for (const { size, png } of pngBuffersWithSizes) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size;
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...dirEntries, ...pngBuffersWithSizes.map((p) => p.png)]);
}

// Signed distance functions in unit coordinates (0..1)
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
function sdCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r;
}
function sdCapsule(x, y, ax, ay, bx, by, r) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}
function sdUnevenCapsule(x, y, ax, ay, bx, by, ra, rb) {
  const pax = x - ax;
  const pay = y - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  const r = ra + (rb - ra) * h;
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}
function mix(a, b, t) {
  return a + (b - a) * t;
}

function shapeRabbit(x, y) {
  // Tapered upright rabbit ears
  const leftEar = sdUnevenCapsule(x, y, 0.39, 0.42, 0.325, 0.16, 0.052, 0.068);
  const rightEar = sdUnevenCapsule(x, y, 0.61, 0.42, 0.675, 0.16, 0.052, 0.068);
  const ears = Math.min(leftEar, rightEar);

  // Sculpted head dome + rounded cheeks
  const headTop = sdCircle(x, y, 0.5, 0.54, 0.185);
  const cheekL = sdCircle(x, y, 0.405, 0.59, 0.135);
  const cheekR = sdCircle(x, y, 0.595, 0.59, 0.135);
  const chin = sdCircle(x, y, 0.5, 0.615, 0.155);

  const head = smin(smin(headTop, Math.min(cheekL, cheekR), 0.06), chin, 0.05);
  return smin(ears, head, 0.032);
}

function shapeInnerEars(x, y) {
  const leftInner = sdUnevenCapsule(x, y, 0.386, 0.38, 0.334, 0.185, 0.02, 0.03);
  const rightInner = sdUnevenCapsule(x, y, 0.614, 0.38, 0.666, 0.185, 0.02, 0.03);
  return Math.min(leftInner, rightInner);
}

function shapeArrow(x, y) {
  const shaft = sdCapsule(x, y, 0.5, 0.455, 0.5, 0.66, 0.038);
  const leftWing = sdCapsule(x, y, 0.5, 0.675, 0.398, 0.575, 0.038);
  const rightWing = sdCapsule(x, y, 0.5, 0.675, 0.602, 0.575, 0.038);
  const tray = sdCapsule(x, y, 0.355, 0.84, 0.645, 0.84, 0.032);
  return {
    arrow: Math.min(shaft, leftWing, rightWing),
    tray,
  };
}

export function renderIcon(size, isForeground = false) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.25 / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size;
      const y = (py + 0.5) / size;

      const tile = sdRoundRect(x, y, 0.5, 0.5, 0.46, 0.46, 0.155);
      const tileCov = isForeground ? 1 : clamp(0.5 - tile / aa);
      if (tileCov <= 0) continue;

      // Rich layered background gradient: deep indigo -> electric violet -> vibrant magenta
      const diag = clamp((x * 0.55 + y * 0.85) / 1.35);
      let r = mix(22, 118, clamp(diag * 1.3));
      let g = mix(19, 52, clamp(diag * 1.3));
      let b = mix(62, 235, clamp(diag * 1.3));

      const bottomGlow = Math.pow(clamp((y - 0.35) / 0.65), 1.5) * clamp(1 - Math.abs(x - 0.5) * 1.4);
      r = mix(r, 236, bottomGlow * 0.55);
      g = mix(g, 72, bottomGlow * 0.45);
      b = mix(b, 153, bottomGlow * 0.35);

      // Top-left cyan/lavender ambient spotlight
      const topGlow = Math.pow(clamp(1 - Math.hypot(x - 0.25, y - 0.16) / 0.62), 2);
      r = mix(r, 88, topGlow * 0.45);
      g = mix(g, 175, topGlow * 0.45);
      b = mix(b, 255, topGlow * 0.5);

      // Crisp inner glass rim on squircle tile
      if (!isForeground) {
        const rimDist = Math.abs(tile + 0.005);
        const rimCov = clamp(1 - rimDist / Math.max(0.006, aa * 1.5)) * clamp(1.1 - y * 0.75) * 0.38;
        r = mix(r, 255, rimCov);
        g = mix(g, 255, rimCov);
        b = mix(b, 255, rimCov);
      }

      // Soft drop shadow under rabbit + tray
      const shadowRabbit = shapeRabbit(x, y - 0.022);
      const { tray: shadowTray } = shapeArrow(x, y - 0.018);
      const shadowDist = Math.min(shadowRabbit, shadowTray);
      const shadowCov = clamp(0.5 - shadowDist / 0.042) * 0.4;
      r = mix(r, 8, shadowCov);
      g = mix(g, 6, shadowCov);
      b = mix(b, 24, shadowCov);

      // White rabbit silhouette
      const rabbitDist = shapeRabbit(x, y);
      const rabbitCov = clamp(0.5 - rabbitDist / aa);
      const rabbitShade = clamp((y - 0.15) / 0.65) * 0.07;
      const rabR = mix(255, 238, rabbitShade);
      const rabG = mix(255, 241, rabbitShade);
      const rabB = mix(255, 253, rabbitShade);
      r = mix(r, rabR, rabbitCov);
      g = mix(g, rabG, rabbitCov);
      b = mix(b, rabB, rabbitCov);

      // Inner ears (vibrant coral-rose gradient)
      const innerDist = shapeInnerEars(x, y);
      const innerCov = clamp(0.5 - innerDist / aa) * rabbitCov;
      const earGrad = clamp((y - 0.16) / 0.24);
      r = mix(r, mix(255, 236, earGrad), innerCov * 0.94);
      g = mix(g, mix(115, 72, earGrad), innerCov * 0.94);
      b = mix(b, mix(165, 153, earGrad), innerCov * 0.94);

      // Download arrow inside rabbit head (vibrant electric indigo -> cyan gradient)
      const { arrow, tray } = shapeArrow(x, y);
      const arrowCov = clamp(0.5 - arrow / aa) * rabbitCov;
      const arrowGrad = clamp((y - 0.45) / 0.25);
      const arrR = mix(79, 6, arrowGrad);
      const arrG = mix(70, 182, arrowGrad);
      const arrB = mix(229, 212, arrowGrad);
      r = mix(r, arrR, arrowCov);
      g = mix(g, arrG, arrowCov);
      b = mix(b, arrB, arrowCov);

      // Download tray bar below rabbit head (glowing cyan-white)
      const trayCov = clamp(0.5 - tray / aa);
      const trayGrad = clamp(Math.abs(x - 0.5) / 0.16);
      r = mix(r, mix(56, 224, 1 - trayGrad * 0.55), trayCov);
      g = mix(g, mix(189, 242, 1 - trayGrad * 0.55), trayCov);
      b = mix(b, mix(248, 254, 1 - trayGrad * 0.55), trayCov);

      const i = (py * size + px) * 4;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(tileCov * 255);
    }
  }
  return encodePng(size, rgba);
}

const extIconsDir = join(root, '..', '..', 'packages', 'extension', 'icons');
const outputs = [
  [join(root, 'build', 'icon.png'), 512],
  [join(root, 'resources', 'icon.png'), 256],
  [join(root, 'src', 'renderer', 'src', 'assets', 'icon.png'), 64],
  [join(extIconsDir, 'icon-128.png'), 128],
  [join(extIconsDir, 'icon-48.png'), 48],
  [join(extIconsDir, 'icon-16.png'), 16],
];
for (const [path, size] of outputs) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderIcon(size));
  console.log(`wrote ${path} (${size}x${size})`);
}

// Also write multi-size Windows .ico for Electron Builder
const icoSizes = [256, 64, 48, 32, 16];
const icoPath = join(root, 'build', 'icon.ico');
writeFileSync(
  icoPath,
  encodeIco(icoSizes.map((size) => ({ size, png: renderIcon(size) })))
);
console.log(`wrote ${icoPath} (${icoSizes.join(', ')}px)`);

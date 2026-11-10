// Generates GRabbit mobile assets (icon, adaptive icon, splash, favicon)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'assets');

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
  header[8] = 8;
  header[9] = 6;
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
  const leftEar = sdUnevenCapsule(x, y, 0.39, 0.42, 0.325, 0.16, 0.052, 0.068);
  const rightEar = sdUnevenCapsule(x, y, 0.61, 0.42, 0.675, 0.16, 0.052, 0.068);
  const ears = Math.min(leftEar, rightEar);

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

function render(size, isForeground = false) {
  const rgba = Buffer.alloc(size * size * 4);
  const aa = 1.25 / size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Scale slightly inward for Android adaptive icon safe zone when isForeground = true
      const rawX = (px + 0.5) / size;
      const rawY = (py + 0.5) / size;
      const x = isForeground ? (rawX - 0.5) * 1.35 + 0.5 : rawX;
      const y = isForeground ? (rawY - 0.5) * 1.35 + 0.5 : rawY;

      const tile = sdRoundRect(rawX, rawY, 0.5, 0.5, 0.46, 0.46, 0.155);
      const tileCov = isForeground ? 1 : clamp(0.5 - tile / aa);
      if (tileCov <= 0) continue;

      const diag = clamp((rawX * 0.55 + rawY * 0.85) / 1.35);
      let r = mix(22, 118, clamp(diag * 1.3));
      let g = mix(19, 52, clamp(diag * 1.3));
      let b = mix(62, 235, clamp(diag * 1.3));

      const bottomGlow = Math.pow(clamp((rawY - 0.35) / 0.65), 1.5) * clamp(1 - Math.abs(rawX - 0.5) * 1.4);
      r = mix(r, 236, bottomGlow * 0.55);
      g = mix(g, 72, bottomGlow * 0.45);
      b = mix(b, 153, bottomGlow * 0.35);

      const topGlow = Math.pow(clamp(1 - Math.hypot(rawX - 0.25, rawY - 0.16) / 0.62), 2);
      r = mix(r, 88, topGlow * 0.45);
      g = mix(g, 175, topGlow * 0.45);
      b = mix(b, 255, topGlow * 0.5);

      if (!isForeground) {
        const rimDist = Math.abs(tile + 0.005);
        const rimCov = clamp(1 - rimDist / Math.max(0.006, aa * 1.5)) * clamp(1.1 - rawY * 0.75) * 0.38;
        r = mix(r, 255, rimCov);
        g = mix(g, 255, rimCov);
        b = mix(b, 255, rimCov);
      }

      const shadowRabbit = shapeRabbit(x, y - 0.022);
      const { tray: shadowTray } = shapeArrow(x, y - 0.018);
      const shadowDist = Math.min(shadowRabbit, shadowTray);
      const shadowCov = clamp(0.5 - shadowDist / 0.042) * 0.4;
      r = mix(r, 8, shadowCov);
      g = mix(g, 6, shadowCov);
      b = mix(b, 24, shadowCov);

      const rabbitDist = shapeRabbit(x, y);
      const rabbitCov = clamp(0.5 - rabbitDist / aa);
      const rabbitShade = clamp((y - 0.15) / 0.65) * 0.07;
      const rabR = mix(255, 238, rabbitShade);
      const rabG = mix(255, 241, rabbitShade);
      const rabB = mix(255, 253, rabbitShade);
      r = mix(r, rabR, rabbitCov);
      g = mix(g, rabG, rabbitCov);
      b = mix(b, rabB, rabbitCov);

      const innerDist = shapeInnerEars(x, y);
      const innerCov = clamp(0.5 - innerDist / aa) * rabbitCov;
      const earGrad = clamp((y - 0.16) / 0.24);
      r = mix(r, mix(255, 236, earGrad), innerCov * 0.94);
      g = mix(g, mix(115, 72, earGrad), innerCov * 0.94);
      b = mix(b, mix(165, 153, earGrad), innerCov * 0.94);

      const { arrow, tray } = shapeArrow(x, y);
      const arrowCov = clamp(0.5 - arrow / aa) * rabbitCov;
      const arrowGrad = clamp((y - 0.45) / 0.25);
      const arrR = mix(79, 6, arrowGrad);
      const arrG = mix(70, 182, arrowGrad);
      const arrB = mix(229, 212, arrowGrad);
      r = mix(r, arrR, arrowCov);
      g = mix(g, arrG, arrowCov);
      b = mix(b, arrB, arrowCov);

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

mkdirSync(assetsDir, { recursive: true });

const outputs = [
  [join(assetsDir, 'icon.png'), 512, false],
  [join(assetsDir, 'adaptive-icon.png'), 512, true],
  [join(assetsDir, 'splash.png'), 512, false],
  [join(assetsDir, 'favicon.png'), 48, false],
];

for (const [path, size, isFg] of outputs) {
  writeFileSync(path, render(size, isFg));
  console.log(`wrote ${path} (${size}x${size})`);
}

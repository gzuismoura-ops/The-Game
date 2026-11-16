// Generates Y'SMARA's app icons + splash from scratch (no external assets, no deps).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// --- the mark: the Hollow Hymn glyph. A bell mouth (arc) with the Ninth Verse
//     as a vertical fracture through it, and a glowing resonance ring.
function icon(size, opts = {}) {
  const { pad = 0, bg = true, transparent = false } = opts;
  const S = size;
  const buf = Buffer.alloc(S * S * 4);
  const cx = S / 2, cy = S / 2;
  const R = (S / 2) * (1 - pad);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5, py = y + 0.5;
      const dx = (px - cx) / R, dy = (py - cy) / R;
      const d = Math.hypot(dx, dy);
      let r = 0, g = 0, b = 0, a = 255;

      if (bg) {
        // deep abyssal gradient: slate -> near-black at the rim
        const t = smoothstep(0.0, 1.15, d);
        r = lerp(40, 11, t); g = lerp(44, 13, t); b = lerp(50, 16, t);
        // warm light from below-left (the drowned sun)
        const glow = Math.max(0, 1 - Math.hypot(dx + 0.35, dy - 0.42) * 2.1);
        r += glow * 46; g += glow * 30; b += glow * 14;
      } else { a = 0; }

      // --- resonance rings (thin arcs), breathing out from the centre
      const ringR = 0.62, ringW = 0.020;
      const ring = 1 - smoothstep(0, ringW, Math.abs(d - ringR));
      if (ring > 0.01) {
        const seg = Math.abs(Math.sin(Math.atan2(dy, dx) * 3.0 + 0.6));
        const vis = smoothstep(0.05, 0.55, seg);
        r = lerp(r, 156, ring * vis); g = lerp(g, 226, ring * vis); b = lerp(b, 214, ring * vis);
        a = Math.max(a, ring * vis * 255);
      }
      const ring2 = 1 - smoothstep(0, 0.012, Math.abs(d - 0.80));
      if (ring2 > 0.01) {
        const seg2 = Math.abs(Math.sin(Math.atan2(dy, dx) * 5.0 - 1.1));
        const vis2 = smoothstep(0.35, 0.9, seg2);
        r = lerp(r, 210, ring2 * vis2 * 0.75); g = lerp(g, 180, ring2 * vis2 * 0.75); b = lerp(b, 122, ring2 * vis2 * 0.75);
        a = Math.max(a, ring2 * vis2 * 200);
      }

      // --- the bell: a rounded trapezoid, shoulder high, mouth wide
      const bellTop = -0.46, bellBot = 0.40;
      const normY = (py - cy) / R;
      if (normY > bellTop && normY < bellBot) {
        const t = (normY - bellTop) / (bellBot - bellTop);
        const halfW = lerp(0.115, 0.355, Math.pow(t, 1.65));
        const edge = Math.abs(dx) - halfW;
        if (edge < 0) {
          // vertical fracture: the Ninth Verse splits the bell
          const fracture = Math.abs(dx - Math.sin(normY * 9.0) * 0.038 - 0.012);
          const inCrack = 1 - smoothstep(0.006, 0.026, fracture);
          if (inCrack > 0.5) { r = 8; g = 9; b = 12; a = 255; }
          else {
            const shade = 0.55 + 0.45 * smoothstep(-halfW, halfW, dx * 1.4);
            r = lerp(96, 214, shade); g = lerp(104, 208, shade); b = lerp(102, 176, shade);
            // the glow that leaks from the crack
            const leak = Math.max(0, 1 - Math.abs(dx) * 9) * (1 - t * 0.4);
            r += leak * 92; g += leak * 74; b += leak * 36;
            a = 255;
          }
        }
      }
      // bell mouth (the rim arc)
      const mouthY = 0.40;
      if (normY > mouthY - 0.02 && normY < mouthY + 0.10) {
        const t2 = (normY - (mouthY - 0.02)) / 0.12;
        const halfW2 = 0.355 + t2 * 0.075;
        if (Math.abs(dx) < halfW2) {
          const k = 1 - t2;
          r = lerp(r, 118, k); g = lerp(g, 120, k); b = lerp(b, 112, k); a = 255;
        }
      }

      // soft vignette for the maskable safe area
      if (d > 1.0) a = 0;
      const i = (y * S + x) * 4;
      buf[i] = Math.max(0, Math.min(255, r | 0));
      buf[i + 1] = Math.max(0, Math.min(255, g | 0));
      buf[i + 2] = Math.max(0, Math.min(255, b | 0));
      buf[i + 3] = transparent ? Math.min(a, 255) : 255;
    }
  }
  return png(S, S, buf);
}

// splash: wide, simple, centred mark on the abyss
function splash(w, h) {
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x / w - 0.5) * 1.6, dy = (y / h - 0.5) * 1.6;
    const d = Math.hypot(dx, dy * 0.9);
    const t = smoothstep(0, 1.05, d);
    let r = lerp(26, 9, t), g = lerp(30, 11, t), b = lerp(36, 13, t);
    const glow = Math.max(0, 1 - Math.hypot(dx, dy + 0.28) * 1.9);
    r += glow * 34; g += glow * 26; b += glow * 16;
    const i = (y * w + x) * 4;
    buf[i] = r | 0; buf[i + 1] = g | 0; buf[i + 2] = b | 0; buf[i + 3] = 255;
  }
  return png(w, h, buf);
}

mkdirSync('public/icons', { recursive: true });
const sizes = [72, 96, 128, 144, 152, 192, 256, 384, 512];
for (const s of sizes) {
  writeFileSync(`public/icons/icon-${s}.png`, icon(s, { pad: 0.06 }));
}
// maskable: keep all art inside the 80% safe circle
writeFileSync('public/icons/maskable-512.png', icon(512, { pad: 0.20 }));
writeFileSync('public/icons/apple-touch-icon.png', icon(180, { pad: 0.10 }));
writeFileSync('public/icons/favicon-32.png', icon(32, { pad: 0.02 }));
writeFileSync('public/icons/splash-2732.png', splash(2732, 2732));
writeFileSync('public/icons/splash-2048x1536.png', splash(2048, 1536));
console.log('icons written:', sizes.length + 4);

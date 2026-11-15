// Y'SMARA — procedural texture foundry.
// Every surface in the game is painted here at load time: no external image files, tiny download,
// fully offline. Each material returns a CanvasTexture set (albedo / normal / roughness).
import * as THREE from 'three';
import { makeNoise2D, makeRng, clamp, lerp, smoothstep, TAU } from '../core/math.js';

const cache = new Map();

function makeCanvas(size) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (!c) return null;
  c.width = size; c.height = size;
  return c;
}

/** Heightfield -> normal map (Sobel). Keeps everything tileable by wrapping the taps. */
function heightToNormal(height, size, strength = 2.0) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
      let nx = dx, ny = dy, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function paint(size, fn) {
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const px = (x, y) => ((y & (size - 1)) * size + (x & (size - 1))) * 4;
  fn(img.data, size, px);
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(canvas, repeat = 1, srgb = true) {
  if (!canvas) return null;
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const rgb = (r, g, b) => `rgb(${clamp(r, 0, 255) | 0},${clamp(g, 0, 255) | 0},${clamp(b, 0, 255) | 0})`;

// ---------------------------------------------------------------------------------------------
// SAND / SILT — fine grain with shell flecks and wind ripples
// ---------------------------------------------------------------------------------------------
export function sandTextures(size = 256) {
  const key = 'sand' + size;
  if (cache.has(key)) return cache.get(key);
  const n = makeNoise2D(11), n2 = makeNoise2D(12);
  const height = new Float32Array(size * size);
  const albedo = paint(size, (d, sz, px) => {
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const u = x / sz, v = y / sz;
      const ripple = Math.sin((u * 18 + Math.sin(v * 6.0) * 1.4) * Math.PI) * 0.5 + 0.5;
      const grain = n(x * 0.09, y * 0.09) * 0.5 + 0.5;
      const fleck = Math.pow(n2(x * 0.5, y * 0.5) * 0.5 + 0.5, 12);
      const h = ripple * 0.35 + grain * 0.65;
      height[y * sz + x] = h + fleck * 0.6;
      const base = 176 + grain * 26 + ripple * 12;
      const shell = fleck > 0.35 ? 40 : 0;
      const i = px(x, y);
      d[i] = base + shell; d[i + 1] = base - 4 + shell; d[i + 2] = base - 26 + shell * 0.7; d[i + 3] = 255;
    }
  });
  const out = { map: tex(albedo, 26), normalMap: tex(heightToNormal(height, size, 1.5), 26, false) };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// WET STONE / CLIFF — stratified, lichen-spotted
// ---------------------------------------------------------------------------------------------
export function stoneTextures(size = 256) {
  const key = 'stone' + size;
  if (cache.has(key)) return cache.get(key);
  const n = makeNoise2D(21), n2 = makeNoise2D(22), n3 = makeNoise2D(23);
  const height = new Float32Array(size * size);
  const albedo = paint(size, (d, sz, px) => {
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const strata = Math.sin((y / sz) * 38 + n2(x * 0.05, y * 0.05) * 3) * 0.5 + 0.5;
      const rough = n(x * 0.06, y * 0.06) * 0.5 + 0.5;
      const blotch = n3(x * 0.02, y * 0.02) * 0.5 + 0.5;
      const h = strata * 0.4 + rough * 0.6;
      height[y * sz + x] = h * 2.2 + blotch * 2.5;
      const base = 96 + rough * 34 + strata * 22;
      const lichen = smoothstep(0.62, 0.82, blotch) * 26;
      const i = px(x, y);
      d[i] = base + lichen * 0.5; d[i + 1] = base + lichen * 0.95; d[i + 2] = base + lichen * 0.45; d[i + 3] = 255;
    }
  });
  const out = { map: tex(albedo, 14), normalMap: tex(heightToNormal(height, size, 1.1), 14, false) };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// CORAL — porous, ridged, pale teal/rose
// ---------------------------------------------------------------------------------------------
export function coralTextures(size = 256) {
  const key = 'coral' + size;
  if (cache.has(key)) return cache.get(key);
  const n = makeNoise2D(31), n2 = makeNoise2D(32);
  const height = new Float32Array(size * size);
  const albedo = paint(size, (d, sz, px) => {
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const u = x / sz, v = y / sz;
      const pores = Math.pow(1 - Math.abs(n(x * 0.18, y * 0.18)), 3);
      const ridge = Math.abs(Math.sin((u + v) * 26 + n2(x * 0.04, y * 0.04) * 4));
      const h = pores * 0.7 + (1 - ridge) * 0.3;
      height[y * sz + x] = h;
      const i = px(x, y);
      const tint = n2(x * 0.03, y * 0.03) * 0.5 + 0.5;
      d[i] = lerp(196, 168, tint) + pores * 22;
      d[i + 1] = lerp(178, 196, tint) + pores * 16;
      d[i + 2] = lerp(166, 186, tint) + pores * 18;
      d[i + 3] = 255;
    }
  });
  const out = { map: tex(albedo, 9), normalMap: tex(heightToNormal(height, size, 2.4), 9, false) };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// DRIED WOOD / ROPE-WRAPPED TIMBER — planks, grain, iron nails
// ---------------------------------------------------------------------------------------------
export function woodTextures(size = 256) {
  const key = 'wood' + size;
  if (cache.has(key)) return cache.get(key);
  const n = makeNoise2D(41), n2 = makeNoise2D(42);
  const height = new Float32Array(size * size);
  const albedo = paint(size, (d, sz, px) => {
    const plankH = sz / 6;
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const plank = Math.floor(y / plankH);
      const seam = Math.min(y % plankH, plankH - (y % plankH));
      const grain = Math.abs(Math.sin((x / sz) * 60 + n(plank * 13.3, y * 0.03) * 5 + n2(x * 0.2, y * 0.2) * 1.5));
      const h = grain * 0.55 + smoothstep(0, 3, seam) * 0.5;
      height[y * sz + x] = h;
      const tone = 74 + (plank % 3) * 10 + grain * 26;
      const seamDark = smoothstep(0, 3.5, seam);
      const nail = (Math.abs((x % (sz / 3)) - 6) < 1.6 && Math.abs(((y % plankH) - plankH / 2)) < 1.6) ? 30 : 0;
      const i = px(x, y);
      d[i] = (tone + nail) * (0.55 + seamDark * 0.45);
      d[i + 1] = (tone * 0.82 + nail) * (0.55 + seamDark * 0.45);
      d[i + 2] = (tone * 0.62 + nail) * (0.55 + seamDark * 0.45);
      d[i + 3] = 255;
    }
  });
  const out = { map: tex(albedo, 5), normalMap: tex(heightToNormal(height, size, 1.8), 5, false) };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// GLASS PAN — fractured sea-glass with bright fracture lines
// ---------------------------------------------------------------------------------------------
export function glassTextures(size = 256) {
  const key = 'glass' + size;
  if (cache.has(key)) return cache.get(key);
  const rng = makeRng(4242);
  const height = new Float32Array(size * size);
  // Voronoi-ish fracture cells via scattered seeds
  const seeds = [];
  for (let i = 0; i < 90; i++) seeds.push({ x: rng() * size, y: rng() * size, t: rng() });
  const albedo = paint(size, (d, sz, px) => {
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      let d1 = 1e9, d2 = 1e9, cell = 0;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        let dx = Math.abs(x - s.x); if (dx > sz / 2) dx = sz - dx;
        let dy = Math.abs(y - s.y); if (dy > sz / 2) dy = sz - dy;
        const dd = dx * dx + dy * dy;
        if (dd < d1) { d2 = d1; d1 = dd; cell = s.t; } else if (dd < d2) d2 = dd;
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);
      const crack = smoothstep(6, 0.5, edge);
      height[y * sz + x] = 1 - crack;
      const i = px(x, y);
      const base = 168 + cell * 46;
      d[i] = base - crack * 48;
      d[i + 1] = base + 6 - crack * 42;
      d[i + 2] = base + 18 - crack * 30;
      d[i + 3] = 255;
    }
  });
  const out = { map: tex(albedo, 12), normalMap: tex(heightToNormal(height, size, 2.6), 12, false) };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// ASH / BURNT GROUND — cracked plates, soot, faint embers
// ---------------------------------------------------------------------------------------------
export function ashTextures(size = 256) {
  const key = 'ash' + size;
  if (cache.has(key)) return cache.get(key);
  const n = makeNoise2D(51), n2 = makeNoise2D(52);
  const height = new Float32Array(size * size);
  const albedo = paint(size, (d, sz, px) => {
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const warp = n(x * 0.02, y * 0.02) * 12;
      const cell = Math.abs(n2((x + warp) * 0.06, (y + warp) * 0.06));
      const crack = smoothstep(0.16, 0.02, cell);
      const soot = n(x * 0.1, y * 0.1) * 0.5 + 0.5;
      height[y * sz + x] = (1 - crack) * 0.8 + soot * 0.2;
      const base = 62 + soot * 42;
      const i = px(x, y);
      d[i] = base - crack * 26; d[i + 1] = base - crack * 28; d[i + 2] = base - crack * 26; d[i + 3] = 255;
    }
  });
  const out = { map: tex(albedo, 18), normalMap: tex(heightToNormal(height, size, 2.0), 18, false) };
  cache.set(key, out);
  return out;
}

// ---------------------------------------------------------------------------------------------
// SALT GRASS — vertical blade strokes on alpha (used with alphaTest for cheap foliage)
// ---------------------------------------------------------------------------------------------
export function grassTexture(size = 128) {
  const key = 'grass' + size;
  if (cache.has(key)) return cache.get(key);
  const rng = makeRng(99);
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 46; i++) {
    const x = rng() * size;
    const h = size * (0.45 + rng() * 0.55);
    const lean = (rng() - 0.5) * size * 0.28;
    const w = 1.4 + rng() * 2.6;
    const hue = 62 + rng() * 30;
    const light = 30 + rng() * 26;
    ctx.strokeStyle = `hsl(${hue} ${22 + rng() * 18}% ${light}%)`;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(x + lean * 0.4, size - h * 0.55, x + lean, size - h);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, t);
  return t;
}

/** Soft radial glow sprite used for lights, embers, spores and UI glows. */
export function glowTexture(size = 64) {
  const key = 'glow' + size;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Smoke / mist puff. */
export function puffTexture(size = 96) {
  const key = 'puff' + size;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(size);
  if (!c) return null;
  const ctx = c.getContext('2d');
  const n = makeNoise2D(313);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2;
    const r = Math.hypot(dx, dy);
    const nv = n(x * 0.05, y * 0.05) * 0.5 + 0.5;
    const a = clamp((1 - smoothstep(0.25, 1.0, r)) * (0.55 + nv * 0.6));
    const i = (y * size + x) * 4;
    img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
    img.data[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

export function disposeAll() { cache.clear(); }

/** Tileable ripple normal map for the water surface (procedural sine interference). */
export function generateRippleTexture(size = 256) {
  const key = 'ripple' + size;
  if (cache.has(key)) return cache.get(key);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * TAU, v = (y / size) * TAU;
      height[y * size + x] =
        Math.sin(u * 3 + Math.cos(v * 2) * 1.4) * 0.5 +
        Math.sin(v * 4 + Math.cos(u * 3) * 1.1) * 0.35 +
        Math.sin((u + v) * 6) * 0.15;
    }
  }
  const canvas = heightToNormal(height, size, 2.2);
  const t = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (t) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
  }
  cache.set(key, t);
  return t;
}

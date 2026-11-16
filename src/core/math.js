// Y'SMARA — core math helpers (pure, no engine dependency)
export const TAU = Math.PI * 2;
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp(invLerp(a, b, v));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (a, b, v) => {
  const t = clamp(invLerp(a, b, v));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const mix = lerp;
export const saturate = (v) => clamp(v);
/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const mod = (a, n) => ((a % n) + n) % n;
export const dist2d = (x1, z1, x2, z2) => Math.hypot(x2 - x1, z2 - z1);
export const angleDelta = (a, b) => mod(b - a + Math.PI, TAU) - Math.PI;
export const dampAngle = (a, b, lambda, dt) => a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** Tiny seeded PRNG (mulberry32) — deterministic worlds, no dependencies. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function rngRange(rng, a, b) { return a + (b - a) * rng(); }
export function pick(rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; }

/** Cheap 2D value noise with smooth interpolation. */
export function makeNoise2D(seed) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, y) => {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
      case 4: return x; case 5: return -x; case 6: return y; default: return -y;
    }
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v); // approx [-1,1]
  };
}

export function fbm(noise, x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal — sharp mountain crests. */
export function ridged(noise, x, y, octaves = 4, lacunarity = 2.1, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0, prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise(x * freq, y * freq));
    n *= n;
    sum += n * amp * prev;
    norm += amp;
    prev = n;
    amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

export function hsl(h, s, l) {
  // h in [0,1], s,l in [0,1] -> {r,g,b} linear-ish sRGB floats
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

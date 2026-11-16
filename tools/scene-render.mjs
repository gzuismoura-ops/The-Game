// Y'SMARA — offline scene rasterizer.
// Walks the REAL three.js scene graph the game builds (terrain mesh vertices/colors, instanced
// flora, monuments, villages) and ray-casts it on the CPU into a PNG. No GPU, no browser.
// This is how the final lighting/composition is verified without a display.
import './css-hooks.mjs';
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// --- minimal DOM so textures become no-ops but geometry still builds
globalThis.document = { createElement: () => null, createElementNS: () => null };
globalThis.self = globalThis;
if (!globalThis.window) globalThis.window = globalThis;
try { Object.defineProperty(globalThis, 'screen', { value: { width: 1920, height: 1080 }, configurable: true }); } catch {}
try { Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true }); } catch {}

const THREE = await import('three');
const W = await import('../src/world/world.js');
const { deckHeightAt } = await import('../src/world/structures.js');
const { buildTerrain } = await import('../src/world/terrainMesh.js');
const { buildTitan, buildShrine, buildMaw, buildAmphitheatre, buildBellChamber } = await import('../src/world/monuments.js');
const { buildVillages } = await import('../src/world/villages.js');
const { FloraSystem } = await import('../src/world/flora.js');

// Precompute a heightmap once: the ray marcher then does bilinear lookups instead of
// evaluating 20 noise octaves per step (this is the difference between 7 min and 4 s a frame).
const HM = (() => {
  const R = 370, STEP = 2.0;
  const N = Math.ceil((R * 2) / STEP) + 1;
  const data = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    data[j * N + i] = 0; // filled after W is imported below
  }
  return { R, STEP, N, data, ready: false };
})();

const PRESET = { label: 'QA', pixelRatio: 1, shadows: true, shadowSize: 1024, props: 1, waterDetail: 2, post: false, aa: false, foliage: 0.55, quality: 'high' };

// fill the heightmap from the real terrain function
for (let j = 0; j < HM.N; j++) {
  for (let i = 0; i < HM.N; i++) {
    const x = -HM.R + i * HM.STEP, z = -HM.R + j * HM.STEP;
    HM.data[j * HM.N + i] = W.terrainHeight(x, z);
  }
}
HM.ready = true;
function heightAt(x, z) {
  const fx = (x + HM.R) / HM.STEP, fz = (z + HM.R) / HM.STEP;
  const i0 = Math.floor(fx), j0 = Math.floor(fz);
  if (i0 < 0 || j0 < 0 || i0 >= HM.N - 1 || j0 >= HM.N - 1) return W.terrainHeight(x, z);
  const tx = fx - i0, tz = fz - j0;
  const a = HM.data[j0 * HM.N + i0], b = HM.data[j0 * HM.N + i0 + 1];
  const c = HM.data[(j0 + 1) * HM.N + i0], d = HM.data[(j0 + 1) * HM.N + i0 + 1];
  return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
}

// ------------------------------------------------------------------ PNG
function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function writePNG(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}

// ------------------------------------------------------------------ build the real scene
const scene = new THREE.Scene();
const terrain = buildTerrain(PRESET); scene.add(terrain);
const titan = buildTitan(PRESET); scene.add(titan);
scene.add(buildShrine(W.SHRINES, PRESET));
scene.add(buildMaw(PRESET));
scene.add(buildAmphitheatre(PRESET));
scene.add(buildBellChamber(PRESET));
scene.add(buildVillages(PRESET));
const flora = new FloraSystem(scene, PRESET);
scene.updateMatrixWorld(true);

// ------------------------------------------------------------------ collect triangles
// Each tri: {a,b,c (vec3), color (vec3), emissive}
const tris = [];
const box = new THREE.Box3();
const v = new THREE.Vector3();

function pushGeometry(geo, matrix, colorFn, emissive = 0, src = '') {
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  const index = geo.index;
  const count = index ? index.count : pos.count;
  for (let i = 0; i < count; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    const a = new THREE.Vector3().fromBufferAttribute(pos, ia).applyMatrix4(matrix);
    const b = new THREE.Vector3().fromBufferAttribute(pos, ib).applyMatrix4(matrix);
    const c = new THREE.Vector3().fromBufferAttribute(pos, ic).applyMatrix4(matrix);
    // cheap backface/AABB reject
    if (Math.max(a.y, b.y, c.y) < -6) continue;
    let color = colorFn ? colorFn(a, b, c, ia, col) : { r: 0.6, g: 0.6, b: 0.6 };
    tris.push({ a, b, c, color, emissive, src });
  }
}

const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

function materialColor(mat, worldPos) {
  if (!mat) return { r: 0.6, g: 0.6, b: 0.6 };
  if (mat.color) { tmpC.copy(mat.color); return { r: tmpC.r, g: tmpC.g, b: tmpC.b }; }
  return { r: 0.6, g: 0.6, b: 0.6 };
}

scene.traverse((obj) => {
  if (!obj.isMesh && !obj.isInstancedMesh) return;
  if (obj.name === 'water') return;
  const geo = obj.geometry;
  if (!geo || !geo.attributes.position) return;
  const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  const emissive = mat && mat.emissiveIntensity > 0.5 ? 1 : 0;
  const baseCol = materialColor(mat);
  const srcTag = obj.name || obj.type;

  if (obj.isInstancedMesh) {
    // only render instances near the camera views (perf), all are cheap triangles though
    for (let i = 0; i < obj.count; i++) {
      obj.getMatrixAt(i, tmpM);
      const m = new THREE.Matrix4().multiplyMatrices(obj.matrixWorld, tmpM);
      pushGeometry(geo, m, () => baseCol, emissive, srcTag);
    }
  } else if (obj.name === 'terrain_inner' || obj.name === 'terrain_outer') {
    return; // handled by the analytic heightfield march
  } else {
    pushGeometry(geo, obj.matrixWorld, () => baseCol, emissive, srcTag);
  }
});

console.log(`scene: ${tris.length} triangles`);

// ------------------------------------------------------------------ BVH-lite grid for fast raycast
const GRID = 48;
const gridMin = -370, gridMax = 370;
const cell = (gridMax - gridMin) / GRID;
const buckets = new Map();
function key(ix, iz) { return ix * 1000 + iz; }
for (let i = 0; i < tris.length; i++) {
  const t = tris[i];
  const minx = Math.min(t.a.x, t.b.x, t.c.x), maxx = Math.max(t.a.x, t.b.x, t.c.x);
  const minz = Math.min(t.a.z, t.b.z, t.c.z), maxz = Math.max(t.a.z, t.b.z, t.c.z);
  const x0 = Math.max(0, Math.min(GRID - 1, Math.floor((minx - gridMin) / cell)));
  const x1 = Math.max(0, Math.min(GRID - 1, Math.floor((maxx - gridMin) / cell)));
  const z0 = Math.max(0, Math.min(GRID - 1, Math.floor((minz - gridMin) / cell)));
  const z1 = Math.max(0, Math.min(GRID - 1, Math.floor((maxz - gridMin) / cell)));
  if ((x1 - x0) * (z1 - z0) > 400) continue; // skip huge tris in the grid (terrain handled by heightfield)
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const k = key(x, z);
    let b = buckets.get(k);
    if (!b) { b = []; buckets.set(k, b); }
    b.push(i);
  }
}
console.log(`grid: ${buckets.size} populated cells`);

function rayTri(ro, rd, t, out) {
  // Möller–Trumbore
  const e1x = t.b.x - t.a.x, e1y = t.b.y - t.a.y, e1z = t.b.z - t.a.z;
  const e2x = t.c.x - t.a.x, e2y = t.c.y - t.a.y, e2z = t.c.z - t.a.z;
  const px = rd.y * e2z - rd.z * e2y, py = rd.z * e2x - rd.x * e2z, pz = rd.x * e2y - rd.y * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-9) return null;
  const inv = 1 / det;
  const tx = ro.x - t.a.x, ty = ro.y - t.a.y, tz = ro.z - t.a.z;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const vv = (rd.x * qx + rd.y * qy + rd.z * qz) * inv;
  if (vv < 0 || u + vv > 1) return null;
  const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (dist < 0.05) return null;
  // normal
  let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const nl = Math.hypot(nx, ny, nz) || 1;
  out.nx = nx / nl; out.ny = ny / nl; out.nz = nz / nl;
  out.dist = dist;
  return out;
}

// ------------------------------------------------------------------ shading
const SUN = new THREE.Vector3(0.36, 0.66, 0.66).normalize();
const hex = (n) => ({ r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 });
const mixc = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });
const mulc = (a, k) => ({ r: a.r * k, g: a.g * k, b: a.b * k });
const clampc = (c) => ({ r: Math.min(1, Math.max(0, c.r)), g: Math.min(1, Math.max(0, c.g)), b: Math.min(1, Math.max(0, c.b)) });

// exact uniforms from the game's terrain shader
const U_SUN = { r: 1.0, g: 0.93, b: 0.80 };
const U_AMB = { r: 0.42, g: 0.50, b: 0.60 };
const HEMI_DOWN = { r: 0.30, g: 0.30, b: 0.26 };
const HEMI_UP = { r: 0.55, g: 0.62, b: 0.72 };
/** Mirrors terrainMesh.js:  lit = albedo * (uSunColor*(ndl*0.95+wrap*0.22) + uAmbient*hemi) */
function gameLight(albedo, n, sunDir, sunColor = U_SUN) {
  const ndl = Math.max(0, n.x * sunDir.x + n.y * sunDir.y + n.z * sunDir.z);
  const wrap = Math.pow(Math.max((n.x * sunDir.x + n.y * sunDir.y + n.z * sunDir.z) * 0.5 + 0.5, 0), 1.4);
  const t = n.y * 0.5 + 0.5;
  const hr = HEMI_DOWN.r + (HEMI_UP.r - HEMI_DOWN.r) * t;
  const hg = HEMI_DOWN.g + (HEMI_UP.g - HEMI_DOWN.g) * t;
  const hb = HEMI_DOWN.b + (HEMI_UP.b - HEMI_DOWN.b) * t;
  const k = ndl * 0.95 + wrap * 0.22;
  return {
    r: albedo.r * (sunColor.r * k + U_AMB.r * hr),
    g: albedo.g * (sunColor.g * k + U_AMB.g * hg),
    b: albedo.b * (sunColor.b * k + U_AMB.b * hb),
  };
}

// ACES filmic approximation + exposure, matching THREE.ACESFilmicToneMapping in the game
const acesCurve = (x) => { const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return Math.min(1, Math.max(0, (x * (a * x + b)) / (x * (c * x + d) + e))); };
const aces = (c) => ({ r: acesCurve(c.r * 1.06), g: acesCurve(c.g * 1.06), b: acesCurve(c.b * 1.06) });

function skyColor(dir, look) {
  const up = Math.min(1, Math.max(0, dir.y * 0.5 + 0.5));
  let c = mixc(look.horizon, look.zenith, Math.pow(up, 0.72));
  c = mixc(c, look.haze, Math.pow(1 - Math.min(1, Math.abs(dir.y) * 1.6), 3.2) * 0.75);
  const sd = Math.max(0, dir.x * SUN.x + dir.y * SUN.y + dir.z * SUN.z);
  c.r += look.sun.r * Math.pow(sd, 22) * 0.28; c.g += look.sun.g * Math.pow(sd, 22) * 0.28; c.b += look.sun.b * Math.pow(sd, 22) * 0.28;
  const disc = Math.pow(sd, 900) * 3.0;
  c.r += look.sun.r * disc; c.g += look.sun.g * disc; c.b += look.sun.b * disc;
  return c;
}

function renderView({ name, pos, eye = null, yaw, pitch, fov = 66, w = 400, h = 225, look }) {
  // Only derive a height when the view did not supply one; a view that computed its own
  // eye height (sy) already accounts for decks, and must not be forced onto bare terrain.
  if (eye !== null) {
    const g = deckHeightAt(pos.x, pos.z);
    const t = heightAt(pos.x, pos.z);
    pos = { x: pos.x, y: ((g !== null && g >= t - 0.6) ? g : t) + eye, z: pos.z };
  }
  const dir0 = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).normalize();
  const right = new THREE.Vector3().crossVectors(dir0, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, dir0).normalize();
  const tanF = Math.tan((fov * Math.PI) / 360);
  const aspect = w / h;
  const buf = Buffer.alloc(w * h * 3);
  const ro = new THREE.Vector3(pos.x, pos.y, pos.z);
  const hit = { nx: 0, ny: 0, nz: 0, dist: 0 };
  const fog = look.fog;

  // ---- project & rasterise structure triangles into a depth + normal buffer
  const triDepth = new Float32Array(w * h).fill(Infinity);
  const triIdx = new Int32Array(w * h).fill(-1);
  const triN = new Float32Array(w * h * 3);
  const camSpace = new THREE.Matrix4().lookAt(ro, new THREE.Vector3(pos.x + dir0.x, pos.y + dir0.y, pos.z + dir0.z), up);
  // view matrix = inverse of camera world matrix
  const camMat = new THREE.Matrix4().makeBasis(right, up, dir0.clone().negate());
  camMat.setPosition(ro);
  const viewMat = camMat.clone().invert();
  const near = 0.2;
  const focal = (h / 2) / tanF;

  for (let ti = 0; ti < tris.length; ti++) {
    const tr = tris[ti];
    // quick reject: distance from camera along view
    const va = new THREE.Vector3().subVectors(tr.a, ro);
    const vb = new THREE.Vector3().subVectors(tr.b, ro);
    const vc = new THREE.Vector3().subVectors(tr.c, ro);
    const za = va.dot(dir0), zb = vb.dot(dir0), zc = vc.dot(dir0);
    if (za < near && zb < near && zc < near) continue;
    if (za > 260 && zb > 260 && zc > 260) continue;
    // screen coords
    const proj = (v, z) => {
      const x = v.dot(right) / z, y = v.dot(up) / z;
      return { x: w / 2 + x * focal, y: h / 2 - y * focal, z };
    };
    if (za < near || zb < near || zc < near) continue; // skip clipped triangles (rare)
    const A = proj(va, za), B = proj(vb, zb), C = proj(vc, zc);
    const minx = Math.max(0, Math.floor(Math.min(A.x, B.x, C.x)));
    const maxx = Math.min(w - 1, Math.ceil(Math.max(A.x, B.x, C.x)));
    const miny = Math.max(0, Math.floor(Math.min(A.y, B.y, C.y)));
    const maxy = Math.min(h - 1, Math.ceil(Math.max(A.y, B.y, C.y)));
    if (minx > maxx || miny > maxy) continue;
    const area = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
    if (Math.abs(area) < 1e-6) continue;
    const invArea = 1 / area;
    // face normal
    const e1 = new THREE.Vector3().subVectors(tr.b, tr.a);
    const e2 = new THREE.Vector3().subVectors(tr.c, tr.a);
    const fn = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const facing = fn.dot(new THREE.Vector3(ro.x - tr.a.x, ro.y - tr.a.y, ro.z - tr.a.z)) > 0 ? 1 : -1;
    for (let yy = miny; yy <= maxy; yy++) {
      for (let xx = minx; xx <= maxx; xx++) {
        const pxc = xx + 0.5, pyc = yy + 0.5;
        const w0 = ((B.x - A.x) * (pyc - A.y) - (pxc - A.x) * (B.y - A.y)) * invArea;
        const w1 = ((pxc - A.x) * (C.y - A.y) - (C.x - A.x) * (pyc - A.y)) * invArea;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-5 || w1 < -1e-5 || w2 < -1e-5) continue;
        const z = 1 / (w2 / A.z + w1 / B.z + w0 / C.z);
        const di = yy * w + xx;
        if (z < triDepth[di]) {
          triDepth[di] = z;
          triIdx[di] = ti;
          triN[di * 3] = fn.x * facing; triN[di * 3 + 1] = fn.y * facing; triN[di * 3 + 2] = fn.z * facing;
        }
      }
    }
  }

  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const sx = (px / w) * 2 - 1, sy = 1 - (py / h) * 2;
      const rd = new THREE.Vector3()
        .addScaledVector(dir0, 1)
        .addScaledVector(right, sx * tanF * aspect)
        .addScaledVector(up, sy * tanF)
        .normalize();

      // water plane test
      let waterT = Infinity;
      if (rd.y < -1e-4) {
        const t = (0 - ro.y) / rd.y;     // plane y = 0
        if (t > 0.35) waterT = t;
      }

      // ray march terrain heightfield (fast) + triangles near the ray
      let bestD = Math.min(waterT, 420);
      let terrainHit = null;
      let t = 0.5, step = 0.8;
      while (t < bestD) {
        const x = ro.x + rd.x * t, y = ro.y + rd.y * t, z = ro.z + rd.z * t;
        if (Math.abs(x) < 366 && Math.abs(z) < 366 && y <= heightAt(x, z)) {
          let lo = t - step, hi = t;
          for (let i = 0; i < 6; i++) { const m = (lo + hi) * 0.5; if (ro.y + rd.y * m <= heightAt(ro.x + rd.x * m, ro.z + rd.z * m)) hi = m; else lo = m; }
          terrainHit = hi; bestD = hi; break;
        }
        t += step; step = Math.min(3.5, step * 1.04);
      }

      // structures: look up the pre-rasterised triangle depth buffer for this pixel
      let triHit = null;
      {
        const di = (py * w + px);
        const dTri = triDepth[di];
        if (dTri < bestD) {
          bestD = dTri;
          triHit = { t: tris[triIdx[di]], n: { x: triN[di * 3], y: triN[di * 3 + 1], z: triN[di * 3 + 2] }, d: dTri };
        }
      }

      let col;
      const fogT = (d) => 1 - Math.exp(-Math.pow(d * (look.fogDensity || 0.0034), 1.65));

      if (triHit) {
        const n = triHit.n;
        if (n.x * rd.x + n.y * rd.y + n.z * rd.z > 0) { n.x = -n.x; n.y = -n.y; n.z = -n.z; }
        const lit = gameLight(triHit.t.color, n, SUN);
        if (triHit.t.emissive) {
          lit.r += triHit.t.color.r * 0.55;
          lit.g += triHit.t.color.g * 0.55;
          lit.b += triHit.t.color.b * 0.55;
        }
        col = mixc(aces(lit), fog, fogT(triHit.d));
      } else if (terrainHit !== null) {
        const x = ro.x + rd.x * terrainHit, z = ro.z + rd.z * terrainHit;
        const e = 1.2;
        const nx = heightAt(x - e, z) - heightAt(x + e, z);
        const nz = heightAt(x, z - e) - heightAt(x, z + e);
        const ny = 2 * e;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const n = { x: nx / nl, y: ny / nl, z: nz / nl };
        const region = W.regionAt(x, z);
        // band-limited value noise instead of fine sine: no moiré, reads like the real
        // albedo texture at distance (the game samples 256px canvas maps here).
        const hash2 = (ix, iz) => {
          let h = ix * 374761393 + iz * 668265263;
          h = (h ^ (h >> 13)) * 1274126177;
          return ((h ^ (h >> 16)) & 0xffff) / 0xffff;
        };
        const vnoise = (px, pz) => {
          const ix = Math.floor(px), iz = Math.floor(pz);
          const fx = px - ix, fz = pz - iz;
          const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
          const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
          return (a * (1 - sx) + b * sx) * (1 - sz) + (c * (1 - sx) + d * sx) * sz;
        };
        // fade high frequencies with distance to avoid shimmer, exactly like mip filtering
        const lodFade = Math.min(1, 26 / Math.max(1, terrainHit));
        const macro = vnoise(x * 0.06, z * 0.06) * 0.16 + (vnoise(x * 0.24, z * 0.24) - 0.5) * 0.10 * lodFade;
        let base = mulc(hex(region.palette.ground), 0.92 + macro);

        const depth = Math.max(0, -heightAt(x, z));
        let lit = gameLight(base, n, SUN);
        if (depth > 0) {
          lit = mulc(lit, Math.exp(-depth * 0.35));
          lit = mixc(lit, { r: 0.06, g: 0.16, b: 0.17 }, Math.min(0.5, depth * 0.16));
        }
        const wet = 1 - Math.min(1, Math.max(0, heightAt(x, z) / 1.2));
        lit = mulc(lit, 1 - wet * 0.18);
        col = mixc(aces(lit), fog, fogT(terrainHit));
      } else if (waterT < 420 && waterT > 0.35) {
        const wx = ro.x + rd.x * waterT, wz = ro.z + rd.z * waterT;
        const depth = Math.max(0, -heightAt(wx, wz));
        const ripple = Math.sin(wx * 0.7 + wz * 0.45) * 0.5 + Math.sin(wx * 0.23 - wz * 0.61) * 0.5;
        const nrm = new THREE.Vector3(ripple * 0.05, 1, ripple * 0.04).normalize();
        const refl = skyColor(new THREE.Vector3(-rd.x + ripple * 0.03, Math.abs(rd.y) * 0.6 + 0.35, -rd.z), look);
        const fres = Math.min(1, Math.max(0, 0.04 + Math.pow(1 - Math.max(0, nrm.dot(rd)), 4.2)));
        const deep = { r: 0.11, g: 0.23, b: 0.25 };
        const shallow = mixc(hex(0x8a8164), deep, Math.min(1, depth * 0.7));
        col = mixc(shallow, refl, fres * 0.92);
        col = aces(col);
        const H = new THREE.Vector3(SUN.x - rd.x, SUN.y - rd.y, SUN.z - rd.z).normalize();
        const glint = Math.pow(Math.max(0, nrm.dot(H)), 380) * 2.0;
        col.r += look.sun.r * glint; col.g += look.sun.g * glint; col.b += look.sun.b * glint;
        col = mixc(col, fog, fogT(waterT));
      } else {
        // SKY: analytic dome equivalent (matches the game's sky shader)
        col = aces(skyColor(rd, look));
      }

      // filmic-ish shoulder + vignette
      const vx = (px / w - 0.5) * 2, vy = (py / h - 0.5) * 2;
      const vig = 1 - Math.min(1, Math.hypot(vx, vy) * 0.2);
      const tmol = (x) => Math.pow(Math.min(1, Math.max(0, x)), 0.92);
      const i = (py * w + px) * 3;
      buf[i] = Math.round(255 * tmol(col.r * vig));
      buf[i + 1] = Math.round(255 * tmol(col.g * vig));
      buf[i + 2] = Math.round(255 * tmol(col.b * vig));
    }
  }
  const path = `tools/scene/${name}.png`;
  writePNG(path, w, h, buf);
  return path;
}

// fog colours exactly as src/main.js regionLook() defines them
const REGION_FOG = {
  kneeling: { color: 0xc9c1ae, density: 0.0029, sun: 0xfff0d8 },
  shallows: { color: 0xd4cab0, density: 0.0032, sun: 0xfff3dd },
  ossuary:  { color: 0xa8bdb4, density: 0.0042, sun: 0xe8f4e8 },
  glass:    { color: 0xdde2de, density: 0.0026, sun: 0xfff6e6 },
  hollow:   { color: 0x807a70, density: 0.0052, sun: 0xd8c8a8 },
};

const LOOKS = {};
for (const [k, v] of Object.entries(REGION_FOG)) {
  const base = {
    kneeling: { zenith: 0x5b87a8, horizon: 0xcfd6d2, haze: 0xecdcc0 },
    shallows: { zenith: 0x6f9ab6, horizon: 0xd6d9cf, haze: 0xf2e2c4 },
    ossuary:  { zenith: 0x4a6a78, horizon: 0x9fb0ac, haze: 0xc4d8cd },
    glass:    { zenith: 0x7a95b0, horizon: 0xdfe4e2, haze: 0xf0eee6 },
    hollow:   { zenith: 0x3a4248, horizon: 0x6a6a66, haze: 0x8a8478 },
  }[k];
  LOOKS[k] = {
    zenith: hex(base.zenith), horizon: hex(base.horizon), haze: hex(base.haze),
    sun: hex(v.sun), fog: hex(v.color), fogDensity: v.density, hemi: 1,
  };
}
// hex() already yields 0-1 floats; nothing to rescale here.

const sy = (x, z, e = 1.7) => {
  // Village decks sit above the raw terrain; a camera using terrainHeight alone ends
  // up under the platform. main.js resolves decks first — mirror that here.
  const d = deckHeightAt(x, z);
  const t = W.terrainHeight(x, z);
  const g = (d !== null && d >= t - 0.6) ? d : t;
  return g + e;
};
const sweep = process.env.SWEEP === '1';
const views = sweep ? (() => {
  const out = [];
  const specs = [
    { name: 'A_ashbend_vista', x: -28, z: -411, yaw: 0.30, pitch: -0.06, fov: 64, look: 'kneeling' },
    { name: 'B_titan_close', x: 0, z: -240, yaw: Math.PI, pitch: 0.22, fov: 55, look: 'kneeling' },
    { name: 'C_titan_side', x: -70, z: -300, yaw: 1.35, pitch: 0.18, fov: 60, look: 'kneeling' },
    { name: 'D_causeway_up', x: 6, z: -215, yaw: Math.PI, pitch: 0.30, fov: 66, look: 'kneeling' },
    { name: 'E_deck_stand', x: -8, z: -278, yaw: 0.9, pitch: 0.05, fov: 70, look: 'kneeling' },
    { name: 'F_shallows_low', x: -20, z: -130, yaw: 0.2, pitch: 0.02, fov: 72, look: 'shallows' },
    { name: 'G_kell_water', x: -60, z: -30, yaw: 1.6, pitch: 0.02, fov: 70, look: 'shallows' },
    { name: 'H_ossuary_gate', x: 150, z: -140, yaw: -1.1, pitch: 0.08, fov: 68, look: 'ossuary' },
    { name: 'I_glass_shards', x: -186, z: 26, yaw: 4.35, pitch: 0.02, fov: 76, look: 'glass' },
    { name: 'J_hollow_gate', x: 10, z: 150, yaw: 0.05, pitch: 0.06, fov: 70, look: 'hollow' },
    { name: 'K_hollow_pillars', x: -30, z: 250, yaw: 1.3, pitch: 0.05, fov: 72, look: 'hollow' },
    { name: 'L_maw_close', x: 5, z: 246, yaw: 0.0, pitch: 0.10, fov: 68, look: 'hollow' },
    { name: 'M_approach', x: 0, z: -330, yaw: 3.14, pitch: 0.10, fov: 70, look: 'kneeling' },
    { name: 'N_titan_chest', x: 10, z: -270, yaw: Math.PI, pitch: 0.45, fov: 60, look: 'kneeling' },
    { name: 'O_wide_coast', x: 60, z: -180, yaw: 2.6, pitch: 0.10, fov: 78, look: 'kneeling' },
  ];
  for (const sp of specs) out.push({ name: sp.name, pos: { x: sp.x, y: sy(sp.x, sp.z, 1.8), z: sp.z }, yaw: sp.yaw, pitch: sp.pitch, fov: sp.fov, look: LOOKS[sp.look] });
  return out;
})() : [
  { name: '01_arrival_ashbend', pos: { x: 2, y: sy(2, -290, 1.7), z: -290 }, yaw: 0.15, pitch: -0.04, fov: 70, look: LOOKS.kneeling },
  { name: '02_ashbend_deck', pos: { x: 6, y: sy(6, -278, 1.6), z: -278 }, yaw: Math.PI, pitch: 0.02, fov: 72, look: LOOKS.kneeling },
  { name: '03_causeway', pos: { x: 8, y: sy(8, -256, 1.7), z: -256 }, yaw: 0.0, pitch: -0.10, fov: 68, look: LOOKS.kneeling },
  { name: '04_shallows', pos: { x: -30, y: sy(-30, -110, 3), z: -110 }, yaw: 0.5, pitch: -0.02, fov: 70, look: LOOKS.shallows },
  { name: '05_kell', pos: { x: -18, y: sy(-18, -44, 2.4), z: -44 }, yaw: 4.2, pitch: 0.0, fov: 66, look: LOOKS.shallows },
  { name: '06_ossuary', pos: { x: 130, y: sy(130, -60, 9), z: -60 }, yaw: -1.3, pitch: 0.02, fov: 70, look: LOOKS.ossuary },
  { name: '07_ossuary_chamber', pos: { x: 208, y: sy(208, -70, 3), z: -70 }, yaw: 3.14, pitch: 0.1, fov: 66, look: LOOKS.ossuary },
  { name: '08_glass_amphi', pos: { x: -172, y: sy(-172, -40, 3), z: -40 }, yaw: 2.55, pitch: 0.0, fov: 66, look: LOOKS.glass },
  { name: '09_glass_wide', pos: { x: -150, y: sy(-150, 30, 2), z: 30 }, yaw: 5.2, pitch: 0.02, fov: 72, look: LOOKS.glass },
  // the Hollow is centred on (6, 268) — aim the cameras where the region actually is
  { name: '10_hollow_maw', pos: { x: 6, y: sy(6, 196, 3.0), z: 196 }, yaw: 0.0, pitch: 0.04, fov: 70, look: LOOKS.hollow },
  { name: '11_hollow_wide', pos: { x: -18, y: sy(-18, 232, 3.2), z: 232 }, yaw: 5.62, pitch: 0.02, fov: 78, look: LOOKS.hollow },
  { name: '12_titan_vista', x: 26, z: -196, yaw: Math.PI, pitch: 0.11, fov: 56, look: LOOKS.kneeling },
].map((v) => ({ ...v, pos: v.pos || { x: v.x, y: sy(v.x, v.z, 1.8), z: v.z } }));
// ---------------------------------------------------------------------------------------------
// Render every view
// ---------------------------------------------------------------------------------------------
const t0 = Date.now();
for (const vv of views) {
  const p = renderView(vv);
  console.log(`rendered ${p}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

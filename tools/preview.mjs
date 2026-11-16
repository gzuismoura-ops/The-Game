// Y'SMARA — headless art preview renderer.
// Raycasts the SAME procedural world used by the game and writes PNGs, so composition, fog,
// palette and silhouettes can be reviewed without a GPU. This is a QA tool, not the game.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import * as W from '../src/world/world.js';
import { STRUCTURES } from '../src/world/structures.js';
import { clamp, smoothstep, mix, TAU } from '../src/core/math.js';

const SUN = normalize({ x: 0.36, y: 0.66, z: 0.66 });

function normalize(v) { const l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; }
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

// ---------------------------------------------------------------- tiny PNG writer
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function writePNG(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, png);
}

// ---------------------------------------------------------------- palette
const hex = (n) => ({ r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 });
const mixc = (a, b, t) => ({ r: mix(a.r, b.r, t), g: mix(a.g, b.g, t), b: mix(a.b, b.b, t) });
const mulc = (a, k) => ({ r: a.r * k, g: a.g * k, b: a.b * k });
const addc = (a, b) => ({ r: a.r + b.r, g: a.g + b.g, b: a.b + b.b });
const clampc = (c) => ({ r: clamp(c.r, 0, 255), g: clamp(c.g, 0, 255), b: clamp(c.b, 0, 255) });

function skyColor(dir, weights) {
  const up = clamp(dir.y * 0.5 + 0.5);
  let base = mixc(hex(0xe8dcc6), hex(0x6f92ad), Math.pow(up, 0.85));
  base = mixc(base, hex(0x2c3f52), smoothstep(0.55, 0.98, up) * 0.55);
  // warm haze at horizon
  base = mixc(base, hex(0xf2d9b4), Math.pow(1 - up, 7) * 0.7);
  const sd = Math.max(0, dot(dir, SUN));
  base = addc(base, mulc(hex(0xfff0cf), Math.pow(sd, 64) * 0.9));
  base = addc(base, mulc(hex(0xffe2a8), Math.pow(sd, 5) * 0.20));
  return base;
}

function surfaceColor(x, z, h, slope, n, dist) {
  const region = W.regionAt(x, z);
  let c;
  const v = W.getProps ? 0 : 0;
  if (h < W.WORLD.waterLevel - 0.02) {
    c = mixc(hex(0x6a6446), hex(0x3a4a44), clamp(-h * 0.45));
  } else if (region.id === 'glass') {
    c = mixc(hex(0xd8d2c4), hex(0x9fb3bd), clamp(slope * 1.6));
  } else if (region.id === 'ossuary') {
    c = mixc(hex(0x8b7a6e), hex(0x5f6f72), clamp(slope * 1.2));
  } else if (region.id === 'hollow') {
    c = mixc(hex(0x585250), hex(0x3a3736), clamp(slope * 1.5));
  } else if (region.id === 'kneeling') {
    c = mixc(hex(0x8a7f6a), hex(0x6b6455), clamp(slope * 1.4));
  } else {
    c = mixc(hex(0xb9ab8a), hex(0x8c8a6c), clamp(slope * 1.3));
    c = mixc(c, hex(0x8fa07a), smoothstep(1.2, 3.5, h) * 0.35);
  }
  // procedural surface break-up
  const grain = (Math.sin(x * 1.7) * Math.cos(z * 1.3) * 0.5 + 0.5) * 0.06;
  c = mulc(c, 0.94 + grain);
  return c;
}

const _hex = (n) => ({ r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 });

// box with center c, half-size h, yaw rot
function hitBox(o, d, c, hx, hy, hz, yaw) {
  const cs = Math.cos(-yaw), sn = Math.sin(-yaw);
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const rx = ox * cs - oz * sn, rz = ox * sn + oz * cs;
  const dx = d.x * cs - d.z * sn, dz = d.x * sn + d.z * cs;
  const dyy = d.y;
  let tmin = -1e9, tmax = 1e9;
  const axes = [[rx, dx, hx], [oy, dyy, hy], [rz, dz, hz]];
  let hitAxis = 0;
  for (let i = 0; i < 3; i++) {
    const [oo, dd, hh] = axes[i];
    if (Math.abs(dd) < 1e-8) { if (Math.abs(oo) > hh) return null; continue; }
    let t1 = (-hh - oo) / dd, t2 = (hh - oo) / dd;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
    if (t1 > tmin) { tmin = t1; hitAxis = i; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmin < 0.05) tmin = tmax;
  if (tmin < 0.05) return null;
  let n;
  if (hitAxis === 1) n = { x: 0, y: Math.sign(dyy) || 1, z: 0 };
  else {
    const nx = hitAxis === 0 ? Math.sign(dx) || 1 : 0;
    const nz = hitAxis === 2 ? Math.sign(dz) || 1 : 0;
    n = { x: nx * Math.cos(yaw) + nz * Math.sin(yaw), y: 0, z: -nx * Math.sin(yaw) + nz * Math.cos(yaw) };
  }
  return { t: tmin, n };
}
function hitSphere(o, d, c, r, sy = 1) {
  const ox = o.x - c.x, oy = (o.y - c.y) / sy, oz = o.z - c.z;
  const dx = d.x, dy = d.y / sy, dz = d.z;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0.05) return null;
  const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
  const n = normalize({ x: px, y: py / sy, z: pz });
  return { t, n };
}
function hitCylinderY(o, d, c, r, height, yaw = 0) {
  const ox = o.x - c.x, oz = o.z - c.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-9) return null;
  const b = 2 * (ox * d.x + oz * d.z);
  const cc = ox * ox + oz * oz - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return null;
  let t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0.05) return null;
  const y = o.y + d.y * t;
  if (y < c.y || y > c.y + height) return null;
  const px = ox + d.x * t, pz = oz + d.z * t;
  return { t, n: normalize({ x: px, y: 0, z: pz }), flat: false };
}

function structureHit(o, d, maxT) {
  let best = null;
  const put = (hit, col, id) => { if (hit && hit.t > 0.05 && hit.t < maxT && (!best || hit.t < best.t)) best = { ...hit, col, id }; };
  // --- TITAN
  const T = STRUCTURES.titan;
  const stone = _hex(0x6a6053), stoneLit = _hex(0x8a7d69);
  const moss = _hex(0x5c6b4e);
  for (const p of T.parts) {
    if (p.type === 'sphere') put(hitSphere(o, d, p, p.r, p.squash || 1), stone, p.id);
    else if (p.type === 'box') put(hitBox(o, d, p, p.w / 2, p.h / 2, p.d / 2, p.rot || 0), stone, p.id);
    else if (p.type === 'cylinder') put(hitCylinderY(o, d, p, p.r, p.h), stone, p.id);
    else if (p.type === 'ellipse') put(hitCylinderY(o, d, { x: p.x, y: p.y - 0.6, z: p.z }, Math.min(p.rx, p.rz), 1.2), moss, p.id);
  }
  // --- VILLAGES (ashbend + kell)
  for (const key of ['ashbend', 'kell']) {
    const V = STRUCTURES[key];
    const deckCol = _hex(0x6e5a42), hutWall = _hex(0x8a7355), hutRoof = _hex(0x4d4b41);
    for (const dk of V.decks) {
      if (dk.shape === 'circle') put(hitCylinderY(o, d, { x: dk.x, y: dk.y - 0.55, z: dk.z }, dk.r, 0.55), deckCol, dk.id);
      else put(hitCylinderY(o, d, { x: dk.x, y: dk.y - 0.55, z: dk.z }, Math.min(dk.rx, dk.rz), 0.55), deckCol, dk.id);
    }
    for (const hut of V.huts || []) {
      put(hitCylinderY(o, d, { x: hut.x, y: hut.y ?? 0, z: hut.z }, hut.r * 0.9, (hut.h || 4) * 0.62 + ((V.y || 0) - 0.0)), hutWall, 'hut');
      put(hitSphere(o, d, { x: hut.x, y: (V.y || 0) + (hut.h || 4) * 0.62, z: hut.z }, hut.r * 1.28, 0.55), hutRoof, 'roof');
    }
    for (const b of V.braziers || []) put(hitSphere(o, d, { x: b.x, y: (V.y || 0) + 0.8, z: b.z }, 0.75), _hex(0xff9a3c), 'brazier');
    if (V.hall) put(hitBox(o, d, { x: V.hall.x, y: (V.y || 0) + V.hall.h * 0.42, z: V.hall.z }, V.hall.w / 2, V.hall.h * 0.42, V.hall.d / 2, V.hall.rot), _hex(0x7d6a4f), 'hall');
    // rope railings
    for (const w of V.walls || []) {
      if (w.shape !== 'circle') continue;
      const segs = 30;
      for (let i = 0; i < segs; i++) {
        const a = (i / segs) * 6.283;
        const sxp = w.x + Math.cos(a) * w.r, szp = w.z + Math.sin(a) * w.r;
        if (w.gateAt && Math.hypot(sxp - w.gateAt.x, szp - w.gateAt.z) < (w.gateWidth || 4) * 0.5) continue;
        put(hitBox(o, d, { x: sxp, y: (V.y || 0) + 0.55, z: szp }, 0.42, 0.55, 0.42, a), _hex(0x453a2c), 'rail');
      }
    }
  }
  // --- MAW monoliths
  const rng = (() => { let s = 5150; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  for (let i = 0; i < STRUCTURES.maw.monoliths; i++) {
    const a = (i / STRUCTURES.maw.monoliths) * 6.283 + 0.35;
    const rr = 24 + (rng() * 5 - 2.5);
    const bx = STRUCTURES.maw.center.x + Math.cos(a) * rr, bz = STRUCTURES.maw.center.z + Math.sin(a) * rr;
    const hgt = 6 + rng() * 11;
    put(hitBox(o, d, { x: bx, y: W.terrainHeight(bx, bz) + hgt / 2, z: bz }, 1.1, hgt / 2, 1.1, a), _hex(0x4a4542), 'monolith');
  }
  // --- amphitheatre rings
  const A = STRUCTURES.amphitheatre;
  for (let ring = 0; ring < 4; ring++) {
    const rr = A.radius - ring * 4.2, ry = 1 + ring * 1.5;
    const segs = 26;
    for (let i = 0; i < segs; i++) {
      if (rng() < 0.22) continue;
      const a = (i / segs) * 6.283;
      const bx = A.center.x + Math.cos(a) * rr, bz = A.center.z + Math.sin(a) * rr;
      put(hitBox(o, d, { x: bx, y: W.terrainHeight(bx, bz) + ry * 0.5, z: bz }, 2.6, ry * 0.5, 1.0, a), _hex(0x8d8f88), 'tier');
    }
  }
  return best;
}

function propHit(o, d, maxT) {
  // cheap: only test props within a coarse radius of the ray's closest approach
  const props = W.getProps();
  let best = null;
  const cols = {
    saltreed: _hex(0x8a9a6a), saltbush: _hex(0x6f7d52), coral: _hex(0xb87a6a), coralFan: _hex(0x9fe8d8),
    rock: _hex(0x7a7266), glassShard: _hex(0xbfd6dd), deadtree: _hex(0x4a4036), ashPillar: _hex(0x5a5450),
    boneArch: _hex(0xcfc4a8), stump: _hex(0x5a4a38), lantern: _hex(0xffc98a), wreck: _hex(0x4f4638),
  };
  for (const kind in props) {
    for (const p of props[kind]) {
      // distance from ray to prop center
      const ox = p.x - o.x, oy = (p.y + 2) - o.y, oz = p.z - o.z;
      const tproj = ox * d.x + oy * d.y + oz * d.z;
      if (tproj < 0.3 || tproj > maxT) continue;
      const cx = o.x + d.x * tproj, cy = o.y + d.y * tproj, cz = o.z + d.z * tproj;
      const rr = (kind === 'saltreed' ? 1.4 : kind === 'coral' ? 1.5 : kind === 'boneArch' ? 3.2 : 1.6) * p.scale;
      if (Math.hypot(cx - p.x, cz - p.z) > rr) continue;
      // approximate vertical extent
      const hgt = (kind === 'saltreed' ? 2.6 : kind === 'coral' ? 2.2 : kind === 'rock' ? 1.4 : kind === 'glassShard' ? 3.0 : kind === 'deadtree' ? 6.5 : kind === 'ashPillar' ? 7 : kind === 'boneArch' ? 6.5 : kind === 'wreck' ? 2.5 : 2.0) * p.scale;
      const sphereT = hitSphere(o, d, { x: p.x, y: p.y + hgt * 0.5, z: p.z }, Math.max(rr * 0.75, hgt * 0.42));
      if (sphereT && sphereT.t < maxT && (!best || sphereT.t < best.t)) best = { ...sphereT, col: cols[kind] || _hex(0x888888), id: kind + p.variant, kind };
    }
  }
  return best;
}

function trace(px, py, cam, W_, H_, weights) {
  const aspect = W_ / H_;
  const fov = cam.fov ?? 62;
  const tanF = Math.tan((fov * Math.PI) / 360);
  const sx = (px / W_) * 2 - 1;
  const sy = 1 - (py / H_) * 2;
  const dir = normalize({
    x: cam.dir.x + sx * tanF * aspect * cam.right.x + sy * tanF * cam.up.x,
    y: cam.dir.y + sx * tanF * aspect * cam.right.y + sy * tanF * cam.up.y,
    z: cam.dir.z + sx * tanF * aspect * cam.right.z + sy * tanF * cam.up.z,
  });

  const maxD = 420;
  let t = 0.6, prevT = 0, hit = null;
  let step = 0.9;
  const o = cam.pos;
  // terrain march
  while (t < maxD) {
    const x = o.x + dir.x * t, y = o.y + dir.y * t, z = o.z + dir.z * t;
    const h = W.terrainHeight(x, z);
    if (y <= h) {
      // bisect refine
      let lo = prevT, hi = t;
      for (let i = 0; i < 7; i++) {
        const m = (lo + hi) * 0.5;
        const mx = o.x + dir.x * m, my = o.y + dir.y * m, mz = o.z + dir.z * m;
        if (my <= W.terrainHeight(mx, mz)) hi = m; else lo = m;
      }
      const hx = o.x + dir.x * hi, hy = o.y + dir.y * hi, hz = o.z + dir.z * hi;
      hit = { x: hx, y: hy, z: hz, d: hi };
      break;
    }
    prevT = t;
    t += step;
    step = Math.min(4.0, step * 1.035);
  }
  // water plane
  let waterT = Infinity;
  if (dir.y < -1e-4) {
    const wt = (W.WORLD.waterLevel - o.y) / dir.y;
    if (wt > 0.2) waterT = wt;
  }

  // --- structures & props (analytic, no meshes needed)
  const sHit = structureHit(o, dir, maxD);
  if (sHit && (!hit || sHit.t < hit.d) && sHit.t < waterT) {
    const lam = clamp(dot(sHit.n, SUN) * 0.8 + 0.2);
    let sc = sHit.col;
    // vertical AO-ish shading on walls
    sc = mulc(sc, 0.58 + lam * 0.66);
    if (sHit.id === 'monolith' || sHit.id === 'tier') sc = mixc(sc, _hex(0x2a2a2a), 0.15);
    if (sHit.id === 'brazier') sc = _hex(0xffb463);
    const fogA = 1 - Math.exp(-Math.pow(sHit.t / 235, 2.2) * 1.15);
    let fg = { r: 0, g: 0, b: 0 };
    for (const r of W.REGIONS) fg = addc(fg, mulc(hex(r.palette.fog), weights[r.id] ?? 0));
    sc = mixc(sc, fg, clamp(fogA * 0.9));
    return clampc(sc);
  }
  const pHit = propHit(o, dir, hit ? Math.min(hit.d, waterT) : Math.min(maxD, waterT));
  if (pHit) {
    const lam = clamp(dot(pHit.n, SUN) * 0.75 + 0.25);
    let pc = mulc(pHit.col, 0.6 + lam * 0.7);
    const fogA = 1 - Math.exp(-Math.pow(pHit.t / 235, 2.2) * 1.15);
    let fg = { r: 0, g: 0, b: 0 };
    for (const r of W.REGIONS) fg = addc(fg, mulc(hex(r.palette.fog), weights[r.id] ?? 0));
    return clampc(mixc(pc, fg, clamp(fogA * 0.9)));
  }

  let col;
  let skyD = dir;
  if (hit && hit.d < waterT) {
    const h = W.terrainHeight(hit.x, hit.z);
    const n = W.terrainNormal(hit.x, hit.z);
    const slope = 1 - n.y;
    col = surfaceColor(hit.x, hit.z, h, slope, n, hit.d);
    const lam = clamp(dot(n, SUN) * 0.85 + 0.15);
    col = mulc(col, 0.72 + lam * 0.58);
    // wetness near waterline
    const wet = smoothstep(0.6, 0.05, Math.abs(h - W.WORLD.waterLevel));
    col = mulc(col, 1 - wet * 0.22);
  } else if (waterT < maxD) {
    const wx = o.x + dir.x * waterT, wz = o.z + dir.z * waterT;
    const depth = W.waterDepthAt(wx, wz);
    const ripple = Math.sin(wx * 0.7 + wz * 0.45) * 0.5 + Math.sin(wx * 0.23 - wz * 0.61) * 0.5;
    const n2 = normalize({ x: ripple * 0.05, y: 1, z: ripple * 0.04 });
    const refl = skyColor({ x: -dir.x + ripple * 0.03, y: Math.abs(dir.y) * 0.6 + 0.35, z: -dir.z }, weights);
    const fres = clamp(0.16 + Math.pow(1 - Math.abs(dir.y), 3.0) * 0.84);
    const deep = mixc(hex(0x2f4f4a), hex(0x1a2f33), clamp(depth * 0.5));
    const shallow = mixc(hex(0xc8b98f), deep, clamp(depth * 0.7));
    col = mixc(shallow, refl, fres * 0.92);
    col = addc(col, mulc(hex(0xffffff), Math.max(0, dot(n2, SUN)) * 0.22));
    col = mulc(col, 0.92);
  } else {
    col = skyColor(dir, weights);
    // distant haze band
    col = mixc(col, hex(0xe4d3b2), Math.pow(clamp(1 - Math.abs(dir.y) * 3), 3) * 0.35);
  }

  // atmospheric fog toward region fog colour
  let fogC = hex(0xd9c9a8);
  for (const r of W.REGIONS) {
    const w = weights[r.id] ?? 0;
    if (w > 0.001) fogC = addc(fogC, mulc(hex(r.palette.fog), w * 0.0)); // weighted below
  }
  let fw = 0; fogC = { r: 0, g: 0, b: 0 };
  for (const r of W.REGIONS) {
    const w = weights[r.id] ?? 0;
    fogC = addc(fogC, mulc(hex(r.palette.fog), w));
    fw += w;
  }
  if (fw < 1e-4) fogC = hex(0xd9c9a8);
  const horizon = skyColor({ x: dir.x * 0.2, y: 0.06, z: dir.z * 0.2 }, weights);
  fogC = mixc(fogC, horizon, 0.55);
  const dHit = hit && hit.d < waterT ? hit.d : (waterT < maxD ? waterT : 300);
  const fogAmt = 1 - Math.exp(-Math.pow(dHit / 235, 2.2) * 1.15);
  col = mixc(col, fogC, clamp(fogAmt * 0.9));
  return col;
}

function buildCamera(pos, yaw, pitch) {
  const dir = normalize({ x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) });
  const WU = { x: 0, y: 1, z: 0 };
  // screen-right = dir x worldUp  (matches three.js right-handed view), up = right x dir
  const right = normalize({ x: dir.y * WU.z - dir.z * WU.y, y: dir.z * WU.x - dir.x * WU.z, z: dir.x * WU.y - dir.y * WU.x });
  const up = normalize({ x: right.y * dir.z - right.z * dir.y, y: right.z * dir.x - right.x * dir.z, z: right.x * dir.y - right.y * dir.x });
  return { pos, dir, right, up };
}

export function renderView({ W: w = 480, H: h = 270, pos, yaw, pitch, fov = 62, name }) {
  const SC = Number(process.env.SCALE || 1); w = Math.round(w * SC); h = Math.round(h * SC);
  const cam = buildCamera(pos, yaw, pitch);
  cam.fov = fov;
  const weights = W.regionBlend(pos.x, pos.z);
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = clampc(trace(x + 0.5, y + 0.5, cam, w, h, weights));
      const i = (y * w + x) * 3;
      // gentle vignette + filmic shoulder
      const vx = (x / w - 0.5) * 2, vy = (y / h - 0.5) * 2;
      const vig = 1 - clamp(Math.hypot(vx, vy) * 0.22);
      buf[i] = Math.round(255 * Math.pow(clamp((c.r / 255) * vig), 0.92));
      buf[i + 1] = Math.round(255 * Math.pow(clamp((c.g / 255) * vig), 0.92));
      buf[i + 2] = Math.round(255 * Math.pow(clamp((c.b / 255) * vig), 0.92));
    }
  }
  const path = `tools/preview/${name}.png`;
  writePNG(path, w, h, buf);
  return path;
}

// CLI: node tools/preview.mjs
const y = (x, z, extra = 1.7) => W.terrainHeight(x, z) + extra;
const views = [
  { name: '01_ashbend_arrival', pos: { x: 4, y: y(4, -268, 2.0), z: -268 }, yaw: 3.1416, pitch: 0.12, fov: 68 },
  { name: '02_ashbend_deck', pos: { x: 2, y: 36.0, z: -290 }, yaw: 3.5, pitch: -0.02, fov: 70 },
  { name: '03_causeway_down', pos: { x: 6, y: 20, z: -262 }, yaw: 3.1416, pitch: -0.10, fov: 66 },
  { name: '04_shallows_wide', pos: { x: -26, y: y(-26, -96, 6), z: -96 }, yaw: 0.55, pitch: -0.04, fov: 70 },
  { name: '05_kell', pos: { x: -16, y: y(-16, -44, 2.4), z: -44 }, yaw: 4.1, pitch: 0.0, fov: 66 },
  { name: '06_ossuary', pos: { x: 126, y: y(126, -62, 10), z: -62 }, yaw: -1.35, pitch: 0.02, fov: 70 },
  { name: '07_glass_amphi', pos: { x: -168, y: y(-168, -30, 3), z: -30 }, yaw: 2.6, pitch: 0.0, fov: 64 },
  { name: '08_hollow_maw', pos: { x: 18, y: y(18, 196, 3.5), z: 196 }, yaw: 2.95, pitch: 0.03, fov: 68 },
  { name: '09_titan_from_sea', pos: { x: 30, y: y(30, -190, 3), z: -190 }, yaw: 3.1416, pitch: 0.12, fov: 55 },
  { name: '10_bell_shrine', pos: { x: -8, y: y(-8, -146, 2.2), z: -146 }, yaw: 3.1416, pitch: 0.02, fov: 60 },
];

const t0 = Date.now();
for (const v of views) {
  const p = renderView(v);
  console.log('rendered', p, `${((Date.now() - t0) / 1000).toFixed(1)}s elapsed`);
}

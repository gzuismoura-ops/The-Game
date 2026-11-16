// Y'SMARA — authored structures.
// Every structure exposes both a *visual builder* (three.js) and *analytic colliders*
// (deck height, walls). The pure parts live here so gameplay + QA can share them.
import { WORLD, terrainHeight, regionAt } from './world.js';
import { dist2d } from '../core/math.js';
import { clamp, lerp, smoothstep, TAU, makeRng, rngRange, makeNoise2D } from '../core/math.js';

// ---------------------------------------------------------------------------------------------
// Analytic collider primitives (pure, testable)
//   deck:   { type:'deck', shape:'circle'|'box'|'ellipse', x,z,r|hx,hz, y, edgeFade }
//   wall:   { type:'wall', shape:'circle'|'box', ... , thickness }
//   ramp:   { type:'ramp', from:{x,z,y}, to:{x,z,y}, width }
// ---------------------------------------------------------------------------------------------
export const STRUCTURES = {
  // Ashbend village: a horseshoe of rope-and-timber decks on the Kneeling One's shoulder.
  ashbend: {
    id: 'ashbend', kind: 'village', region: 'kneeling',
    center: { x: 0, z: -300 }, y: 34.2, radius: 44,
    decks: [
      { id: 'deck_main', shape: 'circle', x: 0, z: -296, r: 17, y: 34.2 },
      { id: 'deck_east', shape: 'ellipse', x: 24, z: -300, rx: 13, rz: 8, y: 34.6 },
      { id: 'deck_west', shape: 'ellipse', x: -24, z: -298, rx: 12, rz: 8, y: 34.4 },
      { id: 'deck_north', shape: 'ellipse', x: -2, z: -318, rx: 16, rz: 7, y: 35.2 },
      { id: 'deck_low', shape: 'ellipse', x: 6, z: -276, rx: 9, rz: 6, y: 32.8 },
    ],
    // ramps from the deck level down the titan's body to the ash ground
    ramps: [
      { from: { x: 6, z: -276, y: 32.8 }, to: { x: 8, z: -252, y: 8.0 }, width: 3.2 },
    ],
    walls: [
      { shape: 'circle', x: 0, z: -296, r: 17.4, thickness: 0.5, gateAt: { x: 0, z: -278.6 }, gateWidth: 5.2, height: 1.25 },
      { shape: 'ellipse', x: 24, z: -300, rx: 13.3, rz: 8.3, height: 1.1 },
      { shape: 'ellipse', x: -24, z: -298, rx: 12.3, rz: 8.3, height: 1.1 },
    ],
    huts: [
      { x: -8, z: -302, r: 3.4, h: 5.2, rot: 0.3 },
      { x: 9, z: -304, r: 3.0, h: 4.8, rot: -0.4 },
      { x: -14, z: -292, r: 2.6, h: 4.2, rot: 1.1 },
      { x: 14, z: -293, r: 2.8, h: 4.4, rot: -1.0 },
      { x: 26, z: -302, r: 2.4, h: 3.8, rot: 0.7 },
      { x: -26, z: -300, r: 2.4, h: 3.8, rot: -0.6 },
      { x: -2, z: -320, r: 3.2, h: 5.6, rot: 0.0 },
    ],
    // Senn's hall — bigger, open-sided, with hanging bells
    hall: { x: -18, z: -312, w: 12, d: 8, h: 6.4, rot: 0.22 },
    braziers: [
      { x: 6.5, z: -288 }, { x: -6.5, z: -288 }, { x: 18, z: -296 }, { x: -18, z: -294 },
    ],
  },

  // The Kneeling One itself: a colossal kneeling figure in stone, its shoulder forming Ashbend.
  titan: {
    id: 'titan', kind: 'monument', region: 'kneeling',
    center: { x: 0, z: -322 }, yBase: 46,
    // body parts, all in world space (y = base height of part)
    parts: [
      { id: 'head', type: 'sphere', x: 0, y: 82, z: -336, r: 13, squash: 1.15 },
      { id: 'face', type: 'box', x: 0, y: 80, z: -324, w: 15, h: 10, d: 4, rot: 0.0 },
      { id: 'neck', type: 'cylinder', x: 0, y: 68, z: -330, r: 8.5, h: 12 },
      { id: 'torso', type: 'box', x: 0, y: 52, z: -326, w: 30, h: 26, d: 18, rot: 0.06 },
      { id: 'shoulderE', type: 'sphere', x: 23, y: 47, z: -318, r: 11 },
      { id: 'shoulderW', type: 'sphere', x: -23, y: 47, z: -318, r: 11 },
      { id: 'shoulderEDeck', type: 'ellipse', x: 24, y: 34.5, z: -300, rx: 13, rz: 9 },
      { id: 'armE', type: 'cylinder', x: 36, y: 30, z: -300, r: 6.5, h: 26, rot: { x: 0.28, z: -0.22 } },
      { id: 'armW', type: 'cylinder', x: -36, y: 30, z: -296, r: 6.5, h: 26, rot: { x: 0.24, z: 0.2 } },
      { id: 'handE', type: 'sphere', x: 44, y: 14, z: -276, r: 7.2 },
      { id: 'handW', type: 'sphere', x: -44, y: 14, z: -272, r: 7.2 },
      { id: 'kneeE', type: 'sphere', x: 20, y: 8, z: -262, r: 9 },
      { id: 'kneeW', type: 'sphere', x: -20, y: 8, z: -262, r: 9 },
      { id: 'apse', type: 'box', x: 0, y: 34, z: -300, w: 26, h: 4, d: 20, rot: 0.02 }, // the shoulder shelf
    ],
    colliders: [
      { shape: 'circle', x: 40, z: -308, r: 7.6 }, { shape: 'circle', x: -40, z: -306, r: 7.6 },
      { shape: 'circle', x: 42, z: -296, r: 7.4 }, { shape: 'circle', x: -42, z: -294, r: 7.4 },
      { shape: 'circle', x: 46, z: -274, r: 7.6 }, { shape: 'circle', x: -46, z: -270, r: 7.6 },
      { shape: 'circle', x: 17, z: -283, r: 10.2 }, { shape: 'circle', x: -17, z: -283, r: 10.2 },
    ],
  },

  // Bell shrines — an arched wooden frame with a hanging bronze bell, used for fast-travel + save.
  shrines: [], // filled from SHRINES data by game layer

  // The Maw: a ring of broken columns and a vast split in the ash at the Hollow's heart.
  maw: {
    id: 'maw', kind: 'monument', region: 'hollow',
    center: { x: 4, z: 262 }, radius: 30,
    monoliths: 11,
  },

  // Kell: stilt village in the shallows.
  kell: {
    id: 'kell', kind: 'village', region: 'shallows',
    center: { x: -44, z: -56 }, y: 1.55,
    decks: [
      { id: 'kell_main', shape: 'ellipse', x: -44, z: -56, rx: 15, rz: 11, y: 1.55 },
      { id: 'kell_east', shape: 'ellipse', x: -27, z: -50, rx: 8, rz: 6, y: 1.35 },
      { id: 'kell_west', shape: 'ellipse', x: -61, z: -62, rx: 8, rz: 6, y: 1.4 },
    ],
    ramps: [
      { from: { x: -44, z: -45, y: 1.55 }, to: { x: -44, z: -36, y: 0.3 }, width: 2.6 },
    ],
    huts: [
      { x: -50, z: -60, r: 3.0, h: 4.4, rot: 0.4 },
      { x: -38, z: -60, r: 2.8, h: 4.0, rot: -0.5 },
      { x: -44, z: -51, r: 3.4, h: 5.0, rot: 1.2 },
      { x: -28, z: -50, r: 2.2, h: 3.4, rot: 0.2 },
      { x: -60, z: -63, r: 2.2, h: 3.4, rot: -0.3 },
    ],
    braziers: [{ x: -36, z: -53 }, { x: -52, z: -59 }],
  },

  // Drowned amphitheatre in the Glass Reach — the Third Bell.
  amphitheatre: {
    id: 'amphitheatre', kind: 'monument', region: 'glass',
    center: { x: -206, z: -84 }, radius: 26, rings: 5,
  },

  // The Ossuary bell chamber — coral ribs arching over the Second Bell.
  bellChamber: {
    id: 'bellChamber', kind: 'monument', region: 'ossuary',
    center: { x: 208, z: -56 }, radius: 20,
  },
};

/** Height of any walkable deck at (x,z), or null. Used for player ground resolution. */
export function deckHeightAt(x, z) {
  let best = null;
  for (const key of ['ashbend', 'kell']) {
    const s = STRUCTURES[key];
    for (const d of s.decks) {
      if (d.shape === 'circle') {
        if (dist2d(x, z, d.x, d.z) < d.r) best = best === null ? d.y : Math.max(best, d.y);
      } else if (d.shape === 'ellipse') {
        const dx = (x - d.x) / d.rx, dz = (z - d.z) / d.rz;
        if (dx * dx + dz * dz < 1) best = best === null ? d.y : Math.max(best, d.y);
      }
    }
    for (const r of s.ramps) {
      const dx = r.to.x - r.from.x, dz = r.to.z - r.from.z;
      const len2 = dx * dx + dz * dz;
      const t = clamp(((x - r.from.x) * dx + (z - r.from.z) * dz) / len2);
      const px = r.from.x + dx * t, pz = r.from.z + dz * t;
      if (dist2d(x, z, px, pz) < r.width * 0.5 + 0.4) {
        const y = lerp(r.from.y, r.to.y, t);
        best = best === null ? y : Math.max(best, y);
      }
    }
  }
  return best;
}

/** Solid circular/elliptical obstacles for horizontal collision. */
export function structureColliders() {
  const out = [];
  for (const key of ['ashbend', 'kell']) {
    const s = STRUCTURES[key];
    for (const w of s.walls || []) {
      if (w.shape === 'circle') {
        // approximate ring wall with segments so the gate can be left open
        const segs = 26;
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * TAU;
          const x = w.x + Math.cos(a) * w.r, z = w.z + Math.sin(a) * w.r;
          if (w.gateAt && dist2d(x, z, w.gateAt.x, w.gateAt.z) < (w.gateWidth || 4) * 0.5) continue;
          out.push({ x, z, r: 0.55, kind: 'deckwall', y: w.height || 1.2 });
        }
      } else if (w.shape === 'ellipse') {
        const segs = 22;
        for (let i = 0; i < segs; i++) {
          const a = (i / segs) * TAU;
          out.push({ x: w.x + Math.cos(a) * w.rx, z: w.z + Math.sin(a) * w.rz, r: 0.5, kind: 'deckwall', y: w.height || 1.1 });
        }
      }
    }
    for (const h of s.huts || []) out.push({ x: h.x, z: h.z, r: h.r * 0.92, kind: 'hut', y: h.h });
    if (s.hall) out.push({ x: s.hall.x, z: s.hall.z, r: Math.max(s.hall.w, s.hall.d) * 0.34, kind: 'hall', y: s.hall.h });
    for (const b of s.braziers || []) out.push({ x: b.x, z: b.z, r: 0.7, kind: 'brazier', y: 1.6 });
  }
  for (const c of STRUCTURES.titan.colliders) out.push({ ...c, kind: 'titan' });
  // maw monoliths
  const rng = makeRng(5150);
  for (let i = 0; i < STRUCTURES.maw.monoliths; i++) {
    const a = (i / STRUCTURES.maw.monoliths) * TAU + 0.35;
    const r = 24 + rngRange(rng, -2.5, 2.5);
    out.push({ x: STRUCTURES.maw.center.x + Math.cos(a) * r, z: STRUCTURES.maw.center.z + Math.sin(a) * r, r: 1.5, kind: 'monolith', y: 4 });
  }
  // amphitheatre broken tiers
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    const r = STRUCTURES.amphitheatre.radius;
    out.push({ x: STRUCTURES.amphitheatre.center.x + Math.cos(a) * r, z: STRUCTURES.amphitheatre.center.z + Math.sin(a) * r, r: 1.4, kind: 'ruin', y: 3 });
  }
  return out;
}

/** Landmark descriptors used by the minimap + compass. */
export function landmarkPins() {
  return [
    { id: 'ashbend', label: 'Ashbend', x: 0, z: -296, kind: 'village' },
    { id: 'titan', label: 'The Kneeling One', x: 0, z: -330, kind: 'monument' },
    { id: 'kell', label: 'Kell', x: -44, z: -56, kind: 'village' },
    { id: 'ossuary', label: 'Coral Ossuary', x: 196, z: -40, kind: 'region' },
    { id: 'glass', label: 'Glass Reach', x: -206, z: -30, kind: 'region' },
    { id: 'hollow', label: 'The Hollow', x: 4, z: 262, kind: 'monument' },
  ];
}

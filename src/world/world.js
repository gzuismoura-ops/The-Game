// Y'SMARA — THE HOLLOW HYMN
// World definition: one continuous drowned world, fully procedural & deterministic.
// Pure data/logic (no renderer imports) so it can be unit-tested and previewed headlessly.
import {
  TAU, clamp, lerp, smoothstep, smootherstep, mix, fbm, ridged,
  makeNoise2D, makeRng, rngRange, pick, dist2d,
} from '../core/math.js';

export const TITLE = "Y'SMARA";
export const SUBTITLE = 'THE HOLLOW HYMN';
export const SAVE_NAMESPACE = 'yshmara.v1';

// ---------------------------------------------------------------------------------------------
// WORLD EXTENTS
// ---------------------------------------------------------------------------------------------
export const WORLD = {
  size: 720,            // metres across
  half: 360,
  waterLevel: 0,
  gridStep: 2.5,        // heightfield sampling step
  spawn: { x: -6, z: -286, y: 0 },
  titan: { x: 0, z: -318, shoulderY: 34, radius: 96 },
};

export const REGIONS = [
  {
    id: 'kneeling', name: 'The Kneeling One', short: 'Ashbend',
    center: { x: 0, z: -300 }, radius: 105,
    ambience: 'wind_high', scale: 'dorian', root: 146.83, mood: 0.35,
    palette: { ground: 0x6d6252, accent: 0xd8b47a, fog: 0xc9b79a, sky: 0x8fa8bd, water: 0x2f4f57 },
    blurb: 'A god of stone, kneeling so long the world grew over it. Ashbend village rides its shoulders.',
  },
  {
    id: 'shallows', name: 'The Silt Shallows', short: 'Shallows',
    center: { x: 0, z: -40 }, radius: 190,
    ambience: 'water_lap', scale: 'aeolian', root: 130.81, mood: 0.5,
    palette: { ground: 0x8c8168, accent: 0xe8d9b0, fog: 0xd9c9a8, sky: 0x9fb6c4, water: 0x3f5f63 },
    blurb: 'A mirror one finger deep. The sky walks there, and so do the Mutes.',
  },
  {
    id: 'ossuary', name: 'The Coral Ossuary', short: 'Ossuary',
    center: { x: 196, z: -30 }, radius: 150,
    ambience: 'cave_drip', scale: 'phrygian', root: 123.47, mood: 0.65,
    palette: { ground: 0x7e6a63, accent: 0x9fe8d8, fog: 0x6e7f86, sky: 0x6d8792, water: 0x24464b },
    blurb: 'The ribs of a Cantor that sang itself to death. Something still hums in the marrow.',
  },
  {
    id: 'glass', name: 'The Glass Reach', short: 'Glass',
    center: { x: -206, z: -20 }, radius: 148,
    ambience: 'wind_glass', scale: 'lydian', root: 155.56, mood: 0.45,
    palette: { ground: 0xa8a49a, accent: 0xcfe8f2, fog: 0xbfcbd4, sky: 0x86a3bb, water: 0x35505c },
    blurb: 'A sea that forgot how to be water. Every shard remembers a different sunset.',
  },
  {
    id: 'hollow', name: 'The Hollow', short: 'Hollow',
    center: { x: 6, z: 268 }, radius: 132,
    ambience: 'silence', scale: 'locrian', root: 110.0, mood: 0.9,
    palette: { ground: 0x4a4744, accent: 0x9a8f86, fog: 0x5a5854, sky: 0x4d5257, water: 0x1b2a2c },
    blurb: 'Where the Ninth Verse stopped. Not empty — unfinished.',
  },
];

export const REGION_BY_ID = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

// ---------------------------------------------------------------------------------------------
// TERRAIN
// ---------------------------------------------------------------------------------------------
const n1 = makeNoise2D(1337);
const n2 = makeNoise2D(90210);
const n3 = makeNoise2D(424242);
const nDetail = makeNoise2D(777001);

/** Signed distance to the world edge, positive inside. */
function innerEdge(x, z) {
  return WORLD.half - Math.max(Math.abs(x), Math.abs(z));
}

/**
 * Authored terrain composition. Each region contributes a shaped field; the fields are blended
 * with smooth masks so the world reads as one continuous drowned coast, not stitched tiles.
 */
export function terrainHeight(x, z) {
  const dShallows = dist2d(x, z, 0, -40);
  const dOssuary = dist2d(x, z, 196, -30);
  const dGlass = dist2d(x, z, -206, -20);
  const dHollow = dist2d(x, z, 6, 268);
  const dTitan = dist2d(x, z, 0, -318);

  // --- base drowned shelf: gentle dunes under shallow water
  let h = -1.6 + fbm(n1, x * 0.0075, z * 0.0075, 4) * 2.1;
  h += fbm(n3, x * 0.021, z * 0.021, 3) * 0.55;

  // --- tidal channels braided through the shallows
  const chA = Math.sin((x * 0.017) + fbm(n2, x * 0.004, z * 0.004, 3) * 3.2);
  h -= smoothstep(0.55, 1.0, Math.abs(chA)) * 1.35 * smoothstep(40, 120, dShallows);

  // --- salt-grass islands: low mounds that break the water surface
  const islandMask = smoothstep(0.12, 0.62, fbm(n2, x * 0.0125 + 31.7, z * 0.0125 - 12.3, 3));
  h += islandMask * 2.4 * smoothstep(90, 190, dShallows) * smoothstep(30, 80, dTitan) * smoothstep(60, 120, dHollow);

  // --- OSSUARY: coral ridge maze, canyon carved along a winding spine
  const ridgeMask = smoothstep(230, 96, dOssuary);
  const spineX = 196 + Math.sin((z + 30) * 0.033) * 26 + fbm(n3, z * 0.01, 4.2, 2) * 18;
  const canyon = smoothstep(26, 6, Math.abs(x - spineX));
  // domain warping gives coral a gnarled, organic crest instead of smooth dunes
  const wq = fbm(n2, x * 0.008 + 11.3, z * 0.008 - 4.7, 3) * 22;
  const wr = fbm(n3, x * 0.008 - 7.1, z * 0.008 + 9.9, 3) * 22;
  const ridges = ridged(n1, (x + wq) * 0.016 + 7.1, (z + wr) * 0.016 - 3.3, 5) * 38;
  const ridgeTerraces = Math.floor(ridges / 3.6) * 3.6 * 0.55 + (ridges % 3.6) * 0.45;
  const plateau = smoothstep(150, 70, dOssuary) * 7.0;
  h += ridgeMask * (ridgeTerraces * (1 - canyon * 0.9) + plateau) - canyon * ridgeMask * 2.4;

  // --- GLASS REACH: a vast flat pan with faint wind-carved dunes
  const glassMask = smoothstep(190, 100, dGlass);
  const glassFlat = 0.55 + fbm(n2, x * 0.006, z * 0.006, 3) * 0.32 + fbm(nDetail, x * 0.05, z * 0.05, 2) * 0.10;
  h = lerp(h, glassFlat, glassMask * 0.93);

  // --- HOLLOW: a bowl that swallows its own edge; the maw descends at its heart
  const hollowMask = smoothstep(150, 40, dHollow);
  const bowl = smoothstep(150, 20, dHollow);
  // ash field carved into cracked plates — fractured is the point
  const crack = Math.abs(fbm(n2, x * 0.05 + 3.3, z * 0.05 - 8.8, 3));
  const plating = smoothstep(0.12, 0.02, crack) * 1.5;
  h = lerp(h, -0.6 + bowl * 1.8 + plating, hollowMask * 0.85);
  h -= smoothstep(46, 8, dHollow) * 7.4;                    // the maw
  const rim = smoothstep(118, 150, dHollow) * smoothstep(186, 150, dHollow);
  h += rim * 8.5;                                            // raised lip around the Hollow
  h += smoothstep(150, 214, dHollow) * smoothstep(260, 214, dHollow) * 2.2;

  // --- KNEELING ONE: a colossal stone shelf rising toward the titan
  const titanMask = smoothstep(150, 60, dTitan);
  const shelf = smoothstep(150, 48, dTitan) * 7.5;
  h = lerp(h, h * 0.35 + shelf + 1.2, titanMask * 0.9);
  // titan's own body is a separate mesh, but the ground humps under it
  h += smoothstep(74, 24, dTitan) * 11;
  h += smoothstep(30, 8, dTitan) * 20;

  // --- world rim: serrated sea-cliffs so the player never sees an edge
  const edge = innerEdge(x, z);
  const cliffNoise = ridged(n3, x * 0.02 + 4.4, z * 0.02 - 2.2, 4);
  const rimRise = smoothstep(78, 10, edge);
  h += rimRise * (34 + cliffNoise * 30);
  h -= smoothstep(12, -8, edge) * 14;

  // --- salt-grass dunes: coherent, wind-aligned ridges
  const duneWarp = fbm(n1, x * 0.01 + 5.5, z * 0.01 + 2.2, 2) * 12;
  const dunes = Math.abs(Math.sin((x * 0.9 + z * 0.42) * 0.055 + duneWarp * 0.3));
  const duneMask = smoothstep(0.5, 3.5, h) * smoothstep(9, 4, h) * smoothstep(170, 120, dShallows);
  h += Math.pow(dunes, 2.2) * 1.15 * duneMask;

  // --- fine surface detail
  h += fbm(nDetail, x * 0.09, z * 0.09, 3) * 0.16 * (1 - hollowMask * 0.5);
  return h;
}

export function terrainNormal(x, z, eps = 1.2) {
  const hL = terrainHeight(x - eps, z), hR = terrainHeight(x + eps, z);
  const hD = terrainHeight(x, z - eps), hU = terrainHeight(x, z + eps);
  let nx = hL - hR, ny = 2 * eps, nz = hD - hU;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

export const slopeAt = (x, z) => 1 - terrainNormal(x, z).y;

export function waterDepthAt(x, z) {
  return Math.max(0, WORLD.waterLevel - terrainHeight(x, z));
}

/** Which named region owns this point (nearest weighted centre). */
export function regionAt(x, z) {
  let best = REGIONS[0], bestScore = Infinity;
  for (const r of REGIONS) {
    const d = dist2d(x, z, r.center.x, r.center.z);
    const score = d / r.radius;
    if (score < bestScore) { bestScore = score; best = r; }
  }
  return best;
}

/** Blend weights per region for fog/palette/music transitions. */
export function regionBlend(x, z) {
  const w = {};
  let total = 0;
  for (const r of REGIONS) {
    const d = dist2d(x, z, r.center.x, r.center.z);
    const v = Math.pow(clamp(1 - d / (r.radius * 1.35)), 2.4);
    w[r.id] = v; total += v;
  }
  if (total < 1e-5) { w.shallows = 1; return w; }
  for (const k in w) w[k] /= total;
  return w;
}

/** Biology + material classification used by the renderer, footstep sfx and gameplay. */
export function biomeAt(x, z) {
  const h = terrainHeight(x, z);
  const slope = slopeAt(x, z);
  const region = regionAt(x, z);
  if (region.id === 'hollow') return h < -0.4 ? 'ashwater' : 'ash';
  if (region.id === 'glass') return slope > 0.32 ? 'glassrock' : 'glasspan';
  if (region.id === 'ossuary') {
    if (slope > 0.42) return 'coralcliff';
    return h < WORLD.waterLevel ? 'coralwater' : 'coralfloor';
  }
  if (region.id === 'kneeling') return slope > 0.5 ? 'stone' : 'titanmoss';
  if (h < WORLD.waterLevel - 0.05) return 'shallows';
  if (h < WORLD.waterLevel + 0.55) return 'saltflat';
  return slope > 0.45 ? 'rock' : 'saltgrass';
}

export function footstepMaterialAt(x, z) {
  const b = biomeAt(x, z);
  const depth = waterDepthAt(x, z);
  if (depth > 0.12) return depth > 0.7 ? 'deepwater' : 'shallowwater';
  switch (b) {
    case 'ash': return 'ash';
    case 'glasspan': return 'glass';
    case 'glassrock': return 'glass';
    case 'coralcliff': return 'coral';
    case 'stone': return 'stone';
    case 'saltgrass': return 'grass';
    default: return 'sand';
  }
}

// ---------------------------------------------------------------------------------------------
// PATHS — a guiding thread of pale trodden silt connecting the bell shrines
// ---------------------------------------------------------------------------------------------
export const PATHS = [
  { id: 'causeway', from: { x: 0, z: -250 }, to: { x: 0, z: -120 }, width: 9 },   // titan ramp → shallows
  { id: 'east', from: { x: 0, z: -60 }, to: { x: 138, z: -34 }, width: 6 },        // to the ossuary
  { id: 'west', from: { x: 0, z: -30 }, to: { x: -150, z: -24 }, width: 6 },      // to the glass reach
  { id: 'south', from: { x: 2, z: 30 }, to: { x: 6, z: 176 }, width: 7 },          // to the hollow
];

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const t = len2 === 0 ? 0 : clamp(((px - ax) * dx + (pz - az) * dz) / len2);
  return dist2d(px, pz, ax + dx * t, az + dz * t);
}

export function pathDistance(x, z) {
  let best = Infinity;
  for (const p of PATHS) best = Math.min(best, distToSegment(x, z, p.from.x, p.from.z, p.to.x, p.to.z) - p.width);
  return best;
}

// ---------------------------------------------------------------------------------------------
// LANDMARKS, SHRINES, ECHOES (memory collectibles), CANTOS (lore), SECRETS
// ---------------------------------------------------------------------------------------------
export const SHRINES = [
  { id: 'shrine_ashbend', name: 'Bell of Ashbend', x: -14, z: -272, region: 'kneeling' },
  { id: 'shrine_causeway', name: 'Bell of the Causeway', x: 8, z: -150, region: 'shallows' },
  { id: 'shrine_kell', name: 'Bell of Kell', x: -38, z: -46, region: 'shallows' },
  { id: 'shrine_drowned', name: 'Bell of the Drowned Field', x: 84, z: 74, region: 'shallows' },
  { id: 'shrine_ossuary', name: 'Bell of the Marrow', x: 196, z: -88, region: 'ossuary' },
  { id: 'shrine_glass', name: 'Bell of Glass', x: -214, z: -56, region: 'glass' },
  { id: 'shrine_verge', name: 'Bell on the Verge', x: 4, z: 128, region: 'hollow' },
];

export const BELLS = [
  { id: 'bell_ossuary', name: 'Second Bell — the Marrow Chime', x: 208, z: -52, region: 'ossuary',
    hint: 'East, in the ribs of the dead Cantor.' },
  { id: 'bell_glass', name: 'Third Bell — the Glass Knell', x: -206, z: -84, region: 'glass',
    hint: 'West, where the sea forgot how to be water.' },
  { id: 'bell_hollow', name: 'Fourth Bell — the Unrung', x: 8, z: 206, region: 'hollow',
    hint: 'South, at the door of the Hollow. Do not ring it alone.' },
];

// 24 memory echoes: each is a short playable vignette of text + ghost imagery
export const ECHOES = [
  { id: 'e01', x: -18, z: -270, y: 34, region: 'kneeling', title: 'The Ninth Verse', lines: [
    'Mother Senn: "Eight verses. Eight Reaches. The Choir sang until the sea obeyed."',
    'Mother Senn: "The Ninth had no words yet. So the Choir hummed. And the humming opened something."',
  ]},
  { id: 'e02', x: 26, z: -258, y: 34, region: 'kneeling', title: 'First Fall', lines: [
    '"The Kneeling One was the first Cantor. It knelt to hear the Verse better."',
    '"It has not stood since. We built our roofs on its patience."',
  ]},
  { id: 'e03', x: -52, z: -238, y: 8, region: 'kneeling', title: 'Salt Lullaby', lines: [
    'A child hums four notes. The wind answers with three.',
    '"Never finish a song you did not start," says the grandmother. "The Hollow listens for endings."',
  ]},
  { id: 'e04', x: 4, z: -196, y: 2, region: 'shallows', title: 'The Causeway', lines: [
    'Pilgrims walked this road when there was still road under it.',
    'Their footprints filled with salt and became the stones you are standing on.',
  ]},
  { id: 'e05', x: -64, z: -150, y: 2, region: 'shallows', title: 'Mute Dance', lines: [
    'The Mutes were singers once. They gave their voices to the Choir as tribute.',
    'Now they open their mouths and nothing comes out — but they still keep time.',
  ]},
  { id: 'e06', x: 62, z: -108, y: 1, region: 'shallows', title: 'Sky in the Water', lines: [
    '"When the water is still enough, you can see the sky that used to be."',
    '"Look for a moon with two shadows. That is the sky the Choir left behind."',
  ]},
  { id: 'e07', x: -30, z: -66, y: 1, region: 'shallows', title: 'Kell Village', lines: [
    'Kell was built on stilts so the tide could pass beneath and take nothing but rope.',
    'It took the rope anyway. Kell rebuilt with rope that remembered being a chandelier.',
  ]},
  { id: 'e08', x: 118, z: -70, y: 1, region: 'shallows', title: 'A Bell Without a Tower', lines: [
    'The bells were not made to call people. They were made to answer the Choir.',
    'Every bell is a question. The Choir stopped asking.',
  ]},
  { id: 'e09', x: -140, z: 22, y: 2, region: 'shallows', title: 'The Salt Road', lines: [
    'Two families walked west for three years and arrived at the same beach.',
    'They named it Arrival. Then they walked home.',
  ]},
  { id: 'e10', x: 0, z: 96, y: 1, region: 'shallows', title: 'Verge', lines: [
    'Grass stops growing here. Not dying — stopping, mid-sentence.',
    'The Hollow does not kill. It interrupts.',
  ]},
  { id: 'e11', x: 196, z: -120, y: 14, region: 'ossuary', title: 'The Cantor', lines: [
    'The Ossuary is not bone. Bone would have rotted.',
    'It is coral that grew in the shape of a singer as it listened.',
  ]},
  { id: 'e12', x: 232, z: -40, y: 18, region: 'ossuary', title: 'Marrow Hymn', lines: [
    'The Second Verse is still inside these ribs, folded like a hand.',
    'Touch the wall and you can feel it decide whether to hold on.',
  ]},
  { id: 'e13', x: 168, z: 6, y: 6, region: 'ossuary', title: 'Lumen Spawn', lines: [
    'The glowing spores are the Cantor\'s last breath, still drifting.',
    'They light the way for anyone who has given up on torches.',
  ]},
  { id: 'e14', x: 206, z: -52, y: 26, region: 'ossuary', title: 'Second Bell', lines: [
    'The Marrow Chime rings a note the Cantor could not finish.',
    'Listen closely: it is not a note. It is a door.',
  ]},
  { id: 'e15', x: -238, z: -84, y: 2, region: 'glass', title: 'Glass Knell', lines: [
    'The pan is not sand. It is every sunset that ever fell here, cooled and pressed flat.',
    'Step lightly. They are still setting.',
  ]},
  { id: 'e16', x: -196, z: -6, y: 2, region: 'glass', title: 'The Shattered Choir', lines: [
    'Six Cantors stood here. The Hollow did not take them — they shattered.',
    'Silence does that to a body that will not stop singing.',
  ]},
  { id: 'e17', x: -170, z: -70, y: 2, region: 'glass', title: 'Mirror Walk', lines: [
    'A glass shard shows your reflection singing. You are not singing.',
    'It is polite. It is showing you what the Reach remembers.',
  ]},
  { id: 'e18', x: -252, z: 40, y: 4, region: 'glass', title: 'The Last Sunset', lines: [
    'The Reach kept one complete sunset, in case the sky ever needed reminding.',
    'It is behind you, on the largest shard. Do not turn around too quickly.',
  ]},
  { id: 'e19', x: 10, z: 168, y: 4, region: 'hollow', title: 'Interruption', lines: [
    'Here is a sentence: "The Choir sang because—"',
    'The Hollow was not strong enough to finish it either.',
  ]},
  { id: 'e20', x: -60, z: 206, y: 1, region: 'hollow', title: 'The Held Note', lines: [
    '"Orin sings two parts at once. The Hollow grew in the space between his two voices."',
    '"He thinks he is holding us together. He might even be right."',
  ]},
  { id: 'e21', x: 66, z: 240, y: 1, region: 'hollow', title: 'Ash Choir', lines: [
    'The ash is not burned wood. It is every note the ninth voice could not reach.',
    'They are still falling, slowly, like an argument losing its temper.',
  ]},
  { id: 'e22', x: 0, z: 282, y: 1, region: 'hollow', title: 'The Maw', lines: [
    'Up close the Hollow is not quiet. It is the sound of a held breath.',
    'Which means somewhere, someone is waiting to breathe.',
  ]},
  { id: 'e23', x: -96, z: -214, y: 30, region: 'kneeling', title: 'Vela\'s Nest', lines: [
    'A little cinderwing built a nest of bell-clappers and tooth-thin rope.',
    'She is not a bird. But she decided to be one, and the world allowed it.',
  ]},
  { id: 'e24', x: 96, z: -176, y: 1, region: 'shallows', title: 'The Question', lines: [
    '"If the world is a song, who is listening?"',
    '"That is what the Hollow is. The Choir found out."',
  ]},
];

export const CANTOS = [
  { id: 'c01', x: -3, z: -292, y: 36, title: 'Canto I — Before Salt', text:
    'Before the Reach there was only listening. The Choir did not create the sea; they found it humming and hummed back until it took a shape they could walk on.' },
  { id: 'c02', x: 47, z: -244, y: 9, title: 'Canto II — The Cantors', text:
    'Eight Cantors sang the Eight Unfinished Verses. The first was stone, the last was a boy of nineteen. Stone is patient. Boys are not — and that is exactly why the Hollow wanted him.' },
  { id: 'c03', x: -92, z: -46, y: 1, title: 'Canto III — The Law of Vessels', text:
    'A Listener is a vessel. A vessel must be emptied before it is filled, and the emptying is the part no one warns you about.' },
  { id: 'c04', x: 254, z: -96, y: 22, title: 'Canto IV — Coral Remembering', text:
    'Coral grows toward the light, even when there is no light. It remembers the direction the sun would be and leans. The Ossuary leans so far it became a singer.' },
  { id: 'c05', x: -226, z: 26, y: 3, title: 'Canto V — The Glass Pan', text:
    'Six Cantors chose to die flat, so their silence would be broad enough to protect us. We walk on their resolve. It is cool to the touch.' },
  { id: 'c06', x: 30, z: 232, y: 1, title: 'Canto VI — The Ninth Voice', text:
    'Nine Cantors were needed for Nine Verses, but the Choir could only find eight. So the youngest, Orin, was made to sing two parts at once — the eighth and the ninth — with the sea listening in between them.' },
  { id: 'c07', x: 0, z: 300, y: 1, title: 'Canto VII — What Waits in the Hollow', text:
    'It is not a void. It is a held breath the size of a sky. It is waiting for permission. Ask it nicely: are you finished, or are you afraid?' },
  { id: 'c08', x: -24, z: -258, y: 34, title: 'Canto VIII — The Ninth Verse', text:
    'The Ninth Verse was never given words. It was given a question instead: what does a song become when it is allowed to end? Orin is still holding the note that answers it.' },
];

export const SECRETS = [
  { id: 's01', name: 'Hollow of the First Word', x: -118, z: -108, reward: 'charm_echo', desc: 'A cave under the shallows where the very first word was carved — and then scratched out.' },
  { id: 's02', name: 'The Glass Garden', x: -246, z: -140, reward: 'charm_glass', desc: 'A garden of glass flowers that only bloom when no one is looking.' },
  { id: 's03', name: 'Nest of the Cinderwings', x: 238, z: 14, reward: 'charm_wing', desc: 'Hundreds of paper lanterns sleeping in a coral throat.' },
  { id: 's04', name: 'Orin\'s Boots', x: 78, z: 292, reward: 'charm_verse', desc: 'Two bootprints at the edge of the maw, facing in, toes together. He stood here a long time.' },
  { id: 's05', name: 'The Listening Stone', x: 132, z: -168, reward: 'charm_still', desc: 'A stone shaped like an ear. Hold your breath inside it and you can hear Ashbend breathing.' },
];

export const CHARMS = [
  { id: 'charm_echo', name: 'Echo Charm', desc: 'Echoes you collect drift toward you from farther away.', color: 0x7fe3d4 },
  { id: 'charm_glass', name: 'Glass Charm', desc: 'Dissonance step leaves a ring of sharp wind that damages Mutes.', color: 0xcfe8f2 },
  { id: 'charm_wing', name: 'Cinder Charm', desc: 'Vela circles closer and lights dark caves; +1 stamina bar.', color: 0xffb066 },
  { id: 'charm_verse', name: 'Verse Charm', desc: 'Your hymn charges 30% faster.', color: 0xe6b8ff },
  { id: 'charm_still', name: 'Stillness Charm', desc: 'The Hollow\'s silence drains you more slowly.', color: 0xb8d4ff },
];

// ---------------------------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------------------------
export const NPCS = [
  { id: 'senn', name: 'Mother Senn', role: 'Keeper of the Last Verse', x: -20, z: -262, y: 35, region: 'kneeling',
    color: 0xe8d9b0, lines: [
      'You woke. Good. The bells have been ringing wrong since dawn, and only you can hear which way.',
      'That is not a compliment, Aru. It is a duty. The Hollow is at the door and our door is very old.',
      'Go down to Kell. Find Wren. She has been putting a map together out of fish scales and spite.',
    ]},
  { id: 'wren', name: 'Wren', role: 'Rope-mender, mapmaker, skeptic', x: -44, z: -52, y: 1, region: 'shallows',
    color: 0xffc46b, lines: [
      'A Listener. Wonderful. Last one we had went south to finish a song and came back as weather.',
      'If you must go, ring the bells first. The Mutes hate a bell — it reminds them they used to have a voice.',
      'And Aru — if you hear something singing your name, do not answer. That is how it gets in.',
    ]},
  { id: 'tol', name: 'Tol', role: 'Salvager of the Glass Reach', x: -204, z: -40, y: 2, region: 'glass',
    color: 0xbfe0ff, lines: [
      'Glass, glass, all glass. I sell the shards to rich people who want to be reminded how fragile things are.',
      'The Reach sings if you stand still long enough. I have never had the patience. You look like you have too much.',
      'Take the west path up. The Third Bell hangs in the shattered amphitheatre. The acoustics will do things to your bones.',
    ]},
  { id: 'marrow', name: 'The Marrow Warden', role: 'What is left of the Second Cantor', x: 214, z: -66, y: 22, region: 'ossuary',
    color: 0x9fe8d8, lines: [
      'I was a singer. Now I am a room.',
      'The bell you seek is in my heart. Take it. But leave me the echo — it is the last thing I own.',
      'When you ring it, sing with it. A bell rung alone is just a noise.',
    ]},
  { id: 'orin', name: 'Orin', role: 'The Ninth Voice', x: 0, z: 274, y: 1, region: 'hollow',
    color: 0x9a8f86, lines: [
      'You are late. Or early. Time is one of the things I stopped finishing.',
      'I did not make the Hollow. I held it open. There is a difference, and it matters, and no one will believe me.',
      'If you finish the Verse, I can rest. If you do not, I will keep holding it. I am good at holding things.',
    ]},
];

// ---------------------------------------------------------------------------------------------
// CREATURES — spawn zones and behaviour tuning
// ---------------------------------------------------------------------------------------------
export const CREATURE_TYPES = {
  muteHound: { hp: 3, speed: 5.4, aggro: 26, name: 'Mute Hound', color: 0x8a8f96, glow: 0x5fd4c8 },
  siltWraith: { hp: 4, speed: 2.5, aggro: 20, name: 'Silt Wraith', color: 0x6a7a80, glow: 0x9be0ff },
  choirHusk: { hp: 7, speed: 2.1, aggro: 18, name: 'Choir Husk', color: 0x9a8a72, glow: 0xffc27a },
  echoEater: { hp: 2, speed: 6.2, aggro: 34, name: 'Echo Eater', color: 0x4b5460, glow: 0xffe08a },
  wanderer: { hp: 999, speed: 0.0, aggro: 0, name: 'The Kneeling One', color: 0x736a5c, glow: 0xd8b47a },
};

export const SPAWN_ZONES = [
  { type: 'muteHound', x: -70, z: -150, r: 40, count: 3 },
  { type: 'muteHound', x: 70, z: -80, r: 44, count: 3 },
  { type: 'siltWraith', x: -120, z: 40, r: 50, count: 2 },
  { type: 'siltWraith', x: 44, z: 60, r: 46, count: 2 },
  { type: 'muteHound', x: 150, z: -140, r: 40, count: 4 },
  { type: 'choirHusk', x: 190, z: -40, r: 46, count: 3 },
  { type: 'siltWraith', x: 236, z: -110, r: 34, count: 3 },
  { type: 'echoEater', x: -200, z: -20, r: 54, count: 3 },
  { type: 'choirHusk', x: -240, z: 20, r: 40, count: 2 },
  { type: 'muteHound', x: -160, z: -120, r: 40, count: 3 },
  { type: 'siltWraith', x: 0, z: 180, r: 56, count: 4 },
  { type: 'choirHusk', x: 60, z: 230, r: 44, count: 3 },
  { type: 'echoEater', x: -70, z: 226, r: 40, count: 2 },
  { type: 'muteHound', x: -30, z: 250, r: 40, count: 3 },
];

// ---------------------------------------------------------------------------------------------
// PROP SCATTER — deterministic; shared by renderer, collider and QA rasterizer
// ---------------------------------------------------------------------------------------------
export const PROP_KINDS = {
  saltreed:  { collide: 0, sway: 1 },
  saltbush:  { collide: 0, sway: 1 },
  coral:     { collide: 1, sway: 0 },
  coralFan:  { collide: 0, sway: 1 },
  rock:      { collide: 1, sway: 0 },
  glassShard:{ collide: 0, sway: 0 },
  deadtree:  { collide: 1, sway: 0 },
  bellpost:  { collide: 1, sway: 0 },
  stump:     { collide: 1, sway: 0 },
  boneArch:  { collide: 1, sway: 0 },
  ashPillar: { collide: 1, sway: 0 },
  lantern:   { collide: 0, sway: 1 },
  wreck:     { collide: 1, sway: 0 },
};

function scatter(seed, count, minX, maxX, minZ, maxZ, accept) {
  const rng = makeRng(seed);
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 32) {
    const x = rngRange(rng, minX, maxX);
    const z = rngRange(rng, minZ, maxZ);
    const res = accept(x, z, rng);
    if (!res) continue;
    out.push({ x, z, y: terrainHeight(x, z), rot: rng() * TAU, scale: res.scale ?? rngRange(rng, 0.75, 1.35), variant: Math.floor(rng() * 1000) });
  }
  return out;
}

let _propsCache = null;
export function getProps() {
  if (_propsCache) return _propsCache;
  const H = WORLD.half - 30;
  const props = {};
  const add = (kind, list) => { props[kind] = list; };

  add('saltreed', scatter(101, 2600, -H, H, -H, H, (x, z, rng) => {
    const reg = regionAt(x, z);
    if (reg.id === 'ossuary' || reg.id === 'glass' || reg.id === 'hollow') return null;
    const h = terrainHeight(x, z);
    if (h < 0.02 || h > 4.2) return null;
    if (pathDistance(x, z) < 1.6) return null;
    return { scale: rngRange(rng, 0.6, 1.6) };
  }));
  add('saltbush', scatter(102, 900, -H, H, -H, H, (x, z, rng) => {
    const reg = regionAt(x, z);
    if (reg.id === 'ossuary' || reg.id === 'glass' || reg.id === 'hollow' || reg.id === 'kneeling') return null;
    const h = terrainHeight(x, z);
    if (h < 0.4 || h > 5) return null;
    return { scale: rngRange(rng, 0.7, 1.5) };
  }));
  add('coral', scatter(103, 260, -H, H, -H, H, (x, z, rng) => {
    const reg = regionAt(x, z);
    if (reg.id !== 'ossuary' && reg.id !== 'shallows') return null;
    if (reg.id === 'shallows' && rng() > 0.16) return null;
    const h = terrainHeight(x, z);
    if (h < -1.5 || h > 9) return null;
    if (pathDistance(x, z) < 2.5) return null;
    return { scale: rngRange(rng, 0.8, 2.4) };
  }));
  add('coralFan', scatter(104, 520, -H, H, -H, H, (x, z, rng) => {
    const reg = regionAt(x, z);
    if (reg.id !== 'ossuary') return null;
    const h = terrainHeight(x, z);
    if (h < -2) return null;
    return { scale: rngRange(rng, 0.7, 1.9) };
  }));
  add('rock', scatter(105, 620, -H, H, -H, H, (x, z, rng) => {
    const reg = regionAt(x, z);
    if (reg.id === 'glass') return null;
    const slope = slopeAt(x, z);
    if (slope < 0.18 && rng() > 0.25) return null;
    if (pathDistance(x, z) < 2.5) return null;
    return { scale: rngRange(rng, 0.6, 2.8) };
  }));
  add('glassShard', scatter(106, 420, -320, -90, -190, 150, (x, z, rng) => {
    if (regionAt(x, z).id !== 'glass') return null;
    if (slopeAt(x, z) > 0.4) return null;
    return { scale: rngRange(rng, 1.0, 3.8) };
  }));
  add('deadtree', scatter(107, 130, -H, H, -H, H, (x, z, rng) => {
    const reg = regionAt(x, z);
    if (reg.id === 'glass' || reg.id === 'ossuary') return null;
    const h = terrainHeight(x, z);
    if (h < 0.3 || h > 5.5) return null;
    if (pathDistance(x, z) < 3) return null;
    return { scale: rngRange(rng, 0.8, 1.7) };
  }));
  add('ashPillar', scatter(108, 120, -110, 130, 150, 330, (x, z, rng) => {
    if (regionAt(x, z).id !== 'hollow') return null;
    const h = terrainHeight(x, z);
    if (h < -1) return null;
    if (dist2d(x, z, 0, 274) < 16) return null;
    return { scale: rngRange(rng, 1.2, 3.4) };
  }));
  add('boneArch', scatter(109, 26, -H, H, -H, H, (x, z, rng) => {
    const reg = regionAt(x, z);
    if (reg.id !== 'ossuary' && reg.id !== 'shallows') return null;
    const h = terrainHeight(x, z);
    if (h < 0.2) return null;
    if (pathDistance(x, z) < 8) return null;
    return { scale: rngRange(rng, 1.4, 2.6) };
  }));
  add('stump', scatter(110, 90, -H, H, -H, H, (x, z, rng) => {
    const reg = regionAt(x, z);
    if (reg.id === 'glass' || reg.id === 'hollow' || reg.id === 'ossuary') return null;
    const h = terrainHeight(x, z);
    if (h < 0.5) return null;
    return { scale: rngRange(rng, 0.8, 1.6) };
  }));
  add('wreck', scatter(111, 18, -H, H, -H, H, (x, z) => {
    const reg = regionAt(x, z);
    if (reg.id !== 'shallows' && reg.id !== 'glass') return null;
    const d = waterDepthAt(x, z);
    if (d < 0.05 || d > 1.4) return null;
    return { scale: 1 };
  }));
  // lanterns along the causeway & near shrines (hand-placed, warm light)
  const lanterns = [];
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const z = lerp(-252, -132, t);
    const x = 7.5 * Math.sin(t * 6.0) + 4;
    lanterns.push({ x, z, y: terrainHeight(x, z), rot: 0, scale: 1, variant: i });
  }
  for (const s of SHRINES) lanterns.push({ x: s.x + 2.6, z: s.z + 1.8, y: terrainHeight(s.x + 2.6, s.z + 1.8), rot: 0.4, scale: 1, variant: 40 });
  add('lantern', lanterns);

  _propsCache = props;
  return props;
}

/** Every collidable prop, flat, for the collision broadphase. */
export function getColliders() {
  const props = getProps();
  const out = [];
  const radiusFor = { coral: 1.15, rock: 1.0, deadtree: 0.5, bellpost: 0.55, stump: 0.75, boneArch: 2.6, ashPillar: 1.1, wreck: 3.2 };
  for (const kind in props) {
    if (!PROP_KINDS[kind]?.collide) continue;
    const r0 = radiusFor[kind] ?? 1;
    for (const p of props[kind]) out.push({ x: p.x, z: p.z, r: r0 * p.scale * 0.8, kind });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// REGION DISCOVERY / NAMING
// ---------------------------------------------------------------------------------------------
export function landmarkNameAt(x, z) {
  let best = null, bd = Infinity;
  for (const s of SHRINES) { const d = dist2d(x, z, s.x, s.z); if (d < bd) { bd = d; best = s.name; } }
  for (const b of BELLS) { const d = dist2d(x, z, b.x, b.z); if (d < bd) { bd = d; best = b.name; } }
  if (bd < 26) return best;
  return regionAt(x, z).name;
}

export const GAME_CONSTANTS = {
  walkSpeed: 4.4,
  sprintSpeed: 7.6,
  wadeSpeed: 2.6,
  gravity: 24,
  jumpSpeed: 7.4,
  staminaMax: 100,
  sprintDrain: 17,
  staminaRegen: 13,
  hpMax: 100,
  playerHeight: 1.8,
  playerRadius: 0.42,
  interactRadius: 3.4,
  singRadius: 7.5,
  singChargeTime: 0.85,
  dodgeCost: 22,
  dodgeSpeed: 12,
  dodgeTime: 0.32,
  fallDamageSpeed: 17,
  cameraDistance: 5.2,
  cameraHeight: 2.1,
  maxSlopeWalk: 0.62,
};

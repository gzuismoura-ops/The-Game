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
    id: 'kneeling', name: 'O Ajoelhado', short: 'Ashbend',
    center: { x: 0, z: -300 }, radius: 105,
    ambience: 'wind_high', scale: 'dorian', root: 146.83, mood: 0.35,
    palette: { ground: 0x6e6150, accent: 0xd8a862, fog: 0x9a8d78, sky: 0x7f9cb4, water: 0x24383e },
    blurb: 'A god of stone, kneeling so long the world grew over it. Ashbend village rides its shoulders.',
  },
  {
    id: 'shallows', name: 'Os Baixios de Lodo', short: 'Baixios',
    center: { x: 0, z: -40 }, radius: 190,
    ambience: 'water_lap', scale: 'aeolian', root: 130.81, mood: 0.5,
    palette: { ground: 0x7d6d4a, accent: 0xc9a978, fog: 0xb0a184, sky: 0x8fa9bc, water: 0x2b3f44 },
    blurb: 'A mirror one finger deep. The sky walks there, and so do the Mutes.',
  },
  {
    id: 'ossuary', name: 'O Ossuário de Coral', short: 'Ossuário',
    center: { x: 196, z: -30 }, radius: 150,
    ambience: 'cave_drip', scale: 'phrygian', root: 123.47, mood: 0.65,
    palette: { ground: 0x5f4c47, accent: 0x6fc4b2, fog: 0x6b7a7e, sky: 0x6a8492, water: 0x182f35 },
    blurb: 'The ribs of a Cantor that sang itself to death. Something still hums in the marrow.',
  },
  {
    id: 'glass', name: 'O Alcance de Vidro', short: 'Vidro',
    center: { x: -206, z: -20 }, radius: 148,
    ambience: 'wind_glass', scale: 'lydian', root: 155.56, mood: 0.45,
    palette: { ground: 0x5e6b78, accent: 0x9fd8ea, fog: 0x8f9fae, sky: 0x6d8ba8, water: 0x1e343e },
    blurb: 'A sea that forgot how to be water. Every shard remembers a different sunset.',
  },
  {
    id: 'hollow', name: 'O Oco', short: 'Oco',
    center: { x: 6, z: 268 }, radius: 132,
    ambience: 'silence', scale: 'locrian', root: 110.0, mood: 0.9,
    palette: { ground: 0x2f2a2c, accent: 0x6e5c6c, fog: 0x46423f, sky: 0x3a3f45, water: 0x101b1f },
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
  { id: 'shrine_ashbend', name: 'Sino de Ashbend', x: -14, z: -272, region: 'kneeling' },
  { id: 'shrine_causeway', name: 'Sino da Passagem', x: 8, z: -150, region: 'shallows' },
  { id: 'shrine_kell', name: 'Sino de Kell', x: -38, z: -46, region: 'shallows' },
  { id: 'shrine_drowned', name: 'Sino do Campo Afogado', x: 84, z: 74, region: 'shallows' },
  { id: 'shrine_ossuary', name: 'Sino do Tutano', x: 196, z: -88, region: 'ossuary' },
  { id: 'shrine_glass', name: 'Sino do Vidro', x: -214, z: -56, region: 'glass' },
  { id: 'shrine_verge', name: 'Sino na Beira', x: 4, z: 128, region: 'hollow' },
];

export const BELLS = [
  { id: 'bell_ossuary', name: 'Segundo Sino — o Dobrar do Tutano', x: 208, z: -52, region: 'ossuary',
    hint: 'East, in the ribs of the dead Cantor.' },
  { id: 'bell_glass', name: 'Terceiro Sino — o Repique de Vidro', x: -206, z: -84, region: 'glass',
    hint: 'West, where the sea forgot how to be water.' },
  { id: 'bell_hollow', name: 'Quarto Sino — o Não Tocado', x: 8, z: 206, region: 'hollow',
    hint: 'South, at the door of the Hollow. Do not ring it alone.' },
];

// 24 memory echoes: each is a short playable vignette of text + ghost imagery
export const ECHOES = [
  { id: 'e01', x: -18, z: -270, y: 34, region: 'kneeling', title: 'O Nono Verso', lines: [
    'Mãe Senn: "Oito versos. Oito Alcances. O Coro cantou até o mar obedecer."',
    'Mãe Senn: "O Nono ainda não tinha palavra. Então o Coro cantarolou. E o cantarolar abriu alguma coisa."',
  ]},
  { id: 'e02', x: 26, z: -258, y: 34, region: 'kneeling', title: 'Primeira Queda', lines: [
    '"O Ajoelhado foi o primeiro Cantor. Ele se ajoelhou para ouvir o Verso melhor."',
    '"Nunca mais se levantou. Construímos nossos telhados sobre a paciência dele."',
  ]},
  { id: 'e03', x: -52, z: -238, y: 8, region: 'kneeling', title: 'Canção de Ninar Salgada', lines: [
    'Uma criança cantarola quatro notas. O vento responde com três.',
    '"Nunca termine uma canção que você não começou", diz a avó. "O Oco escuta os finais."',
  ]},
  { id: 'e04', x: 4, z: -196, y: 2, region: 'shallows', title: 'A Passagem', lines: [
    'Peregrinos andaram por esta estrada quando ainda havia estrada embaixo dela.',
    'As pegadas encheram de sal e viraram as pedras onde você pisa agora.',
  ]},
  { id: 'e05', x: -64, z: -150, y: 2, region: 'shallows', title: 'Dança dos Mudos', lines: [
    'Os Mudos já foram cantores. Deram a voz ao Coro como tributo.',
    'Agora abrem a boca e não sai nada — mas ainda mantêm o compasso.',
  ]},
  { id: 'e06', x: 62, z: -108, y: 1, region: 'shallows', title: 'Céu Dentro da Água', lines: [
    '"Quando a água fica parada o bastante, dá para ver o céu que existia antes."',
    '"Procure uma lua com duas sombras. É o céu que o Coro deixou para trás."',
  ]},
  { id: 'e07', x: -30, z: -66, y: 1, region: 'shallows', title: 'Vila de Kell', lines: [
    'Kell foi construída sobre palafitas para a maré passar por baixo e não levar nada além de corda.',
    'Levou a corda de todo jeito. Kell reconstruiu com corda que lembrava ter sido lustre.',
  ]},
  { id: 'e08', x: 118, z: -70, y: 1, region: 'shallows', title: 'Um Sino Sem Torre', lines: [
    'Os sinos não foram feitos para chamar gente. Foram feitos para responder ao Coro.',
    'Todo sino é uma pergunta. O Coro parou de perguntar.',
  ]},
  { id: 'e09', x: -140, z: 22, y: 2, region: 'shallows', title: 'A Estrada de Sal', lines: [
    'Duas famílias andaram para oeste por três anos e chegaram à mesma praia.',
    'Chamaram o lugar de Chegada. Depois voltaram para casa andando.',
  ]},
  { id: 'e10', x: 0, z: 96, y: 1, region: 'shallows', title: 'Beira', lines: [
    'A grama para de crescer aqui. Não morre — para, no meio da frase.',
    'O Oco não mata. Ele interrompe.',
  ]},
  { id: 'e11', x: 196, z: -120, y: 14, region: 'ossuary', title: 'O Cantor', lines: [
    'O Ossuário não é osso. Osso teria apodrecido.',
    'É coral que cresceu no formato de um cantor enquanto escutava.',
  ]},
  { id: 'e12', x: 232, z: -40, y: 18, region: 'ossuary', title: 'Hino do Tutano', lines: [
    'O Segundo Verso ainda está dentro destas costelas, dobrado como uma mão.',
    'Toque a parede e dá para sentir ele decidindo se continua.',
  ]},
  { id: 'e13', x: 168, z: 6, y: 6, region: 'ossuary', title: 'Cria de Lume', lines: [
    'Os esporos brilhantes são o último suspiro do Cantor, ainda à deriva.',
    'Iluminam o caminho de quem já desistiu das tochas.',
  ]},
  { id: 'e14', x: 206, z: -52, y: 26, region: 'ossuary', title: 'Segundo Sino', lines: [
    'O Dobrar do Tutano toca uma nota que o Cantor não conseguiu terminar.',
    'Escute bem: não é uma nota. É uma porta.',
  ]},
  { id: 'e15', x: -238, z: -84, y: 2, region: 'glass', title: 'Repique de Vidro', lines: [
    'A planície não é areia. É todo pôr do sol que já caiu aqui, esfriado e prensado liso.',
    'Pise leve. Ainda estão endurecendo.',
  ]},
  { id: 'e16', x: -196, z: -6, y: 2, region: 'glass', title: 'O Coro Estilhaçado', lines: [
    'Seis Cantores estavam aqui. O Oco não os levou — eles se estilhaçaram.',
    'O silêncio faz isso com um corpo que não para de cantar.',
  ]},
  { id: 'e17', x: -170, z: -70, y: 2, region: 'glass', title: 'Caminho de Espelhos', lines: [
    'Um pedaço de vidro mostra o seu reflexo cantando. Você não está cantando.',
    'Ele é educado. Está mostrando o que o Alcance lembra.',
  ]},
  { id: 'e18', x: -252, z: 40, y: 4, region: 'glass', title: 'O Último Pôr do Sol', lines: [
    'O Alcance guardou um pôr do sol completo, caso o céu algum dia precisasse lembrar.',
    'Está atrás de você, no maior vidro. Não vire rápido demais.',
  ]},
  { id: 'e19', x: 10, z: 168, y: 4, region: 'hollow', title: 'Interrupção', lines: [
    'Eis uma frase: "O Coro cantou porque—"',
    'O Oco também não foi forte o bastante para terminá-la.',
  ]},
  { id: 'e20', x: -60, z: 206, y: 1, region: 'hollow', title: 'A Nota Suspensa', lines: [
    '"Orin canta duas partes ao mesmo tempo. O Oco cresceu no espaço entre as duas vozes dele."',
    '"Ele acha que está nos mantendo inteiros. Talvez até esteja certo."',
  ]},
  { id: 'e21', x: 66, z: 240, y: 1, region: 'hollow', title: 'Coro de Cinzas', lines: [
    'As cinzas não são madeira queimada. São todas as notas que a nona voz não alcançou.',
    'Continuam caindo, devagar, como uma discussão perdendo a paciência.',
  ]},
  { id: 'e22', x: 0, z: 282, y: 1, region: 'hollow', title: 'O Abismo', lines: [
    'De perto o Oco não é silencioso. É o som de um fôlego suspenso.',
    'O que significa que, em algum lugar, alguém espera para respirar.',
  ]},
  { id: 'e23', x: -96, z: -214, y: 30, region: 'kneeling', title: 'Ninho de Vela', lines: [
    'Uma pequena asa-de-brasa fez um ninho de badalos e corda fina como dente.',
    'Ela não é pássaro. Mas decidiu ser um, e o mundo permitiu.',
  ]},
  { id: 'e24', x: 96, z: -176, y: 1, region: 'shallows', title: 'A Pergunta', lines: [
    '"Se o mundo é uma canção, quem está escutando?"',
    '"É isso que o Oco é. O Coro descobriu."',
  ]},
];

export const CANTOS = [
  { id: 'c01', x: -3, z: -292, y: 36, title: 'Canto I — Antes do Sal', text:
    'Antes do Alcance havia apenas escuta. O Coro não criou o mar; encontrou-o cantarolando e cantarolou de volta, até ele tomar uma forma onde fosse possível andar.' },
  { id: 'c02', x: 47, z: -244, y: 9, title: 'Canto II — Os Cantores', text:
    'Oito Cantores entoaram os Oito Versos Inacabados. O primeiro era pedra, o último era um menino de dezenove anos. Pedra é paciente. Menino não é — e foi exatamente por isso que o Oco o quis.' },
  { id: 'c03', x: -92, z: -46, y: 1, title: 'Canto III — A Lei dos Vasos', text:
    'Uma Ouvinte é um vaso. Um vaso precisa ser esvaziado antes de ser cheio, e o esvaziar é a parte sobre a qual ninguém te avisa.' },
  { id: 'c04', x: 254, z: -96, y: 22, title: 'Canto IV — O Coral que Lembra', text:
    'O coral cresce na direção da luz, mesmo quando não há luz. Ele lembra para onde o sol estaria e se inclina. O Ossuário se inclinou tanto que virou um cantor.' },
  { id: 'c05', x: -226, z: 26, y: 3, title: 'Canto V — A Planície de Vidro', text:
    'Seis Cantores escolheram morrer deitados, para que o silêncio deles fosse largo o bastante para nos proteger. Andamos sobre a determinação deles. É fria ao toque.' },
  { id: 'c06', x: 30, z: 232, y: 1, title: 'Canto VI — A Nona Voz', text:
    'Nove Cantores eram necessários para Nove Versos, mas o Coro só encontrou oito. Então o mais novo, Orin, foi feito para cantar duas partes ao mesmo tempo — a oitava e a nona — com o mar escutando entre elas.' },
  { id: 'c07', x: 0, z: 300, y: 1, title: 'Canto VII — O Que Espera no Oco', text:
    'Não é um vazio. É um fôlego suspenso do tamanho de um céu. Espera permissão. Pergunte com delicadeza: você terminou, ou está com medo?' },
  { id: 'c08', x: -24, z: -258, y: 34, title: 'Canto VIII — O Nono Verso', text:
    'O Nono Verso nunca recebeu palavras. Recebeu uma pergunta no lugar: em que se transforma uma canção quando lhe é permitido terminar? Orin ainda segura a nota que responde.' },
];

export const SECRETS = [
  { id: 's01', name: 'Oco da Primeira Palavra', x: -118, z: -108, reward: 'charm_echo', desc: 'Uma caverna sob os baixios onde a primeira palavra foi gravada — e depois riscada.' },
  { id: 's02', name: 'O Jardim de Vidro', x: -246, z: -140, reward: 'charm_glass', desc: 'Um jardim de flores de vidro que só desabrocham quando ninguém está olhando.' },
  { id: 's03', name: 'Ninho das Asas-de-Brasa', x: 238, z: 14, reward: 'charm_wing', desc: 'Centenas de lanternas de papel dormindo numa garganta de coral.' },
  { id: 's04', name: 'As Botas de Orin', x: 78, z: 292, reward: 'charm_verse', desc: 'Duas marcas de bota na beira do abismo, voltadas para dentro, pontas juntas. Ele ficou aqui muito tempo.' },
  { id: 's05', name: 'A Pedra que Escuta', x: 132, z: -168, reward: 'charm_still', desc: 'Uma pedra em forma de orelha. Prenda a respiração dentro dela e dá para ouvir Ashbend respirando.' },
];

export const CHARMS = [
  { id: 'charm_echo', name: 'Amuleto do Eco', desc: 'Os ecos que você coleta se aproximam de mais longe.', color: 0x7fe3d4 },
  { id: 'charm_glass', name: 'Amuleto de Vidro', desc: 'A esquiva dissonante deixa um anel de vento cortante que fere os Mudos.', color: 0xcfe8f2 },
  { id: 'charm_wing', name: 'Amuleto de Brasa', desc: 'Vela voa mais perto e ilumina cavernas escuras; +1 barra de fôlego.', color: 0xffb066 },
  { id: 'charm_verse', name: 'Amuleto do Verso', desc: 'Seu hino carrega 30% mais rápido.', color: 0xe6b8ff },
  { id: 'charm_still', name: 'Amuleto da Quietude', desc: 'O silêncio do Oco te drena mais devagar.', color: 0xb8d4ff },
];

// ---------------------------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------------------------
export const NPCS = [
  { id: 'senn', name: 'Mãe Senn', role: 'Guardiã do Último Verso', x: -20, z: -262, y: 35, region: 'kneeling',
    color: 0xe8d9b0, lines: [
      'Você acordou. Bom. Os sinos tocam errado desde o amanhecer, e só você ouve em que direção.',
      'Isso não é um elogio, Aru. É um dever. O Oco está à porta e a nossa porta é muito velha.',
      'Desça até Kell. Encontre Wren. Ela anda montando um mapa com escamas de peixe e rancor.',
    ]},
  { id: 'wren', name: 'Wren', role: 'Remenda cordas, faz mapas, desconfia de tudo', x: -44, z: -52, y: 1, region: 'shallows',
    color: 0xffc46b, lines: [
      'Uma Ouvinte. Maravilha. A última que tivemos foi para o sul terminar uma canção e voltou como tempo ruim.',
      'Se você precisa ir, toque os sinos primeiro. Os Mudos odeiam sino — lembra que eles já tiveram voz.',
      'E, Aru — se ouvir alguma coisa cantando o seu nome, não responda. É assim que ela entra.',
    ]},
  { id: 'tol', name: 'Tol', role: 'Catador do Alcance de Vidro', x: -204, z: -40, y: 2, region: 'glass',
    color: 0xbfe0ff, lines: [
      'Vidro, vidro, só vidro. Vendo os cacos para gente rica que quer lembrar como as coisas são frágeis.',
      'O Alcance canta se você ficar parada o bastante. Nunca tive paciência. Você parece ter de sobra.',
      'Pegue o caminho oeste. O Terceiro Sino está no anfiteatro em ruínas. A acústica faz coisas com os seus ossos.',
    ]},
  { id: 'marrow', name: 'O Guardião do Tutano', role: 'O que restou do Segundo Cantor', x: 214, z: -66, y: 22, region: 'ossuary',
    color: 0x9fe8d8, lines: [
      'Eu era cantor. Agora sou um cômodo.',
      'O sino que você procura está no meu peito. Leve-o. Mas me deixe o eco — é a última coisa que possuo.',
      'Quando tocar, cante junto. Sino tocado sozinho é só um barulho.',
    ]},
  { id: 'orin', name: 'Orin', role: 'A Nona Voz', x: 0, z: 274, y: 1, region: 'hollow',
    color: 0x9a8f86, lines: [
      'Você está atrasada. Ou adiantada. O tempo é uma das coisas que eu parei de terminar.',
      'Eu não fiz o Oco. Eu o mantive aberto. Há uma diferença, e ela importa, e ninguém vai acreditar em mim.',
      'Se você terminar o Verso, eu posso descansar. Se não, eu continuo segurando. Eu sou bom em segurar coisas.',
    ]},
];

// ---------------------------------------------------------------------------------------------
// CREATURES — spawn zones and behaviour tuning
// ---------------------------------------------------------------------------------------------
export const CREATURE_TYPES = {
  muteHound: { hp: 3, speed: 5.4, aggro: 26, name: 'Cão Mudo', color: 0x8a8f96, glow: 0x5fd4c8 },
  siltWraith: { hp: 4, speed: 2.5, aggro: 20, name: 'Espectro de Lodo', color: 0x6a7a80, glow: 0x9be0ff },
  choirHusk: { hp: 7, speed: 2.1, aggro: 18, name: 'Casca de Coro', color: 0x9a8a72, glow: 0xffc27a },
  echoEater: { hp: 2, speed: 6.2, aggro: 34, name: 'Devorador de Ecos', color: 0x4b5460, glow: 0xffe08a },
  wanderer: { hp: 999, speed: 0.0, aggro: 0, name: 'O Ajoelhado', color: 0x736a5c, glow: 0xd8b47a },
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
    return { scale: rngRange(rng, 0.55, 1.25) };
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
    return { scale: rngRange(rng, 0.5, 1.5) };
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
    return { scale: rngRange(rng, 0.35, 1.35) };
  }));
  add('glassShard', scatter(106, 420, -320, -90, -190, 150, (x, z, rng) => {
    if (regionAt(x, z).id !== 'glass') return null;
    if (slopeAt(x, z) > 0.4) return null;
    return { scale: rngRange(rng, 0.7, 2.4) };
  }));
  add('deadtree', scatter(107, 130, -H, H, -H, H, (x, z, rng) => {
    const reg = regionAt(x, z);
    if (reg.id === 'glass' || reg.id === 'ossuary') return null;
    const h = terrainHeight(x, z);
    if (h < 0.3 || h > 5.5) return null;
    if (pathDistance(x, z) < 3) return null;
    return { scale: rngRange(rng, 0.7, 1.4) };
  }));
  add('ashPillar', scatter(108, 120, -110, 130, 150, 330, (x, z, rng) => {
    if (regionAt(x, z).id !== 'hollow') return null;
    const h = terrainHeight(x, z);
    if (h < -1) return null;
    if (dist2d(x, z, 0, 274) < 16) return null;
    return { scale: rngRange(rng, 1.0, 2.6) };
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

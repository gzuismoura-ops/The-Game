// Y'SMARA — monuments.
// The Kneeling One, the Maw, the Amphitheatre, bell shrines and the Ossuary bell chamber.
// All built from procedurally deformed geometry so nothing looks like a stock primitive.
import * as THREE from 'three';
import { STRUCTURES } from './structures.js';
import { stoneTextures, woodTextures, coralTextures, glowTexture } from './textures.js';
import { SHRINES, BELLS, WORLD, terrainHeight } from './world.js';
import { makeNoise2D, makeRng, clamp, lerp, smoothstep, TAU, rngRange } from '../core/math.js';

const noise = makeNoise2D(515);

/** Displace vertices along their normals using layered noise — turns primitives into sculpted forms. */
function sculpt(geo, amount = 0.06, freq = 0.35, seedOffset = 0) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n1 = noise(x * freq + seedOffset, y * freq + z * freq * 0.7);
    const n2 = noise(x * freq * 3.1 - seedOffset, y * freq * 3.1 + 4.2);
    const d = (n1 * 0.7 + n2 * 0.3) * amount;
    pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}

function stoneMaterial(set, color = 0xffffff, rough = 0.92, uvScale = 0.42) {
  // Clone the maps so each structure can choose its own real-world tiling.
  // The canvas textures ship un-tiled (repeat 1) so nothing is locked in globally.
  const map = set.map ? set.map.clone() : null;
  const normalMap = set.normalMap ? set.normalMap.clone() : null;
  for (const t of [map, normalMap]) {
    if (!t) continue;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(uvScale, uvScale);
    t.needsUpdate = true;
  }
  return new THREE.MeshStandardMaterial({
    map, normalMap, color,
    normalScale: new THREE.Vector2(1.4, 1.4), roughness: rough, metalness: 0.02,
  });
}

// ---------------------------------------------------------------------------------------------
// THE KNEELING ONE
// ---------------------------------------------------------------------------------------------
export function buildTitan(preset) {
  const group = new THREE.Group();
  group.name = 'titan';
  const stone = stoneTextures();
  const bodyMat = stoneMaterial(stone, 0x8e8375, 0.96);
  bodyMat.normalScale.set(2.4, 2.4);
  const mossMat = new THREE.MeshStandardMaterial({ color: 0x53603f, roughness: 1, metalness: 0 });
  const T = STRUCTURES.titan;

  const addPart = (geo, mat, pos, rot, name, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos.x, pos.y, pos.z);
    if (rot) m.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
    m.castShadow = cast && preset.shadows;
    m.receiveShadow = preset.shadows;
    if (name) m.name = name;
    group.add(m);
    return m;
  };

  // ============================================================================
  // THE KNEELING ONE — read as ONE figure: broad shoulders, bowed head, arms
  // braced on the sea floor, one knee raised. Built from a continuous stack of
  // sculpted slabs rather than loose spheres.
  // ============================================================================

  // ---- PLINTH / LOWER BODY: the mass that the sea drowned
  const baseGeo = sculpt(new THREE.CylinderGeometry(30, 40, 16, 14, 4), 1.6, 0.05, 2.2);
  baseGeo.scale(1, 1, 0.78);
  addPart(baseGeo, bodyMat, { x: 0, y: 8, z: -330 }, { x: 0.04 }, 'kneel_base');

  // thighs: massive wedges running forward from the hips (kneeling = femurs down)
  for (const [sx, rz] of [[16, -0.12], [-16, 0.12]]) {
    const thigh = sculpt(new THREE.BoxGeometry(20, 13, 34, 8, 5, 10), 0.9, 0.08, sx);
    addPart(thigh, bodyMat, { x: sx, y: 13, z: -300 }, { x: 0.10, z: rz }, 'thigh');
    // knee caps — the two rounded forms breaking the waterline
    const knee = sculpt(new THREE.SphereGeometry(10.5, 18, 14), 0.7, 0.2, sx + 20);
    knee.scale(1.0, 0.82, 1.1);
    addPart(knee, bodyMat, { x: sx, y: 12, z: -282 }, null, 'knee');
    // shins trailing back into the silt
    const shin = sculpt(new THREE.CylinderGeometry(8.4, 11, 22, 10, 4), 0.7, 0.1, sx + 30);
    addPart(shin, bodyMat, { x: sx * 1.06, y: 6.5, z: -266 }, { x: 1.42 }, 'shin');
  }

  // ---- HIPS + TORSO: a single continuous mass, tapering up, leaning forward
  const torsoGeo = sculpt(new THREE.CylinderGeometry(19, 27, 46, 14, 10), 1.35, 0.055, 5.5);
  const tp = torsoGeo.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    const t = (y + 23) / 46;                    // 0 bottom .. 1 top
    const chest = 1 + Math.sin(t * Math.PI * 0.92) * 0.20;  // barrel chest
    tp.setXYZ(i, tp.getX(i) * chest, y, tp.getZ(i) * chest * 0.74);
  }
  torsoGeo.computeVertexNormals();
  addPart(torsoGeo, bodyMat, { x: 0, y: 62, z: -328 }, { x: 0.20 }, 'torso');

  // ---- SHOULDER SHELF: the wide slab Ashbend is built on
  const shelf = sculpt(new THREE.CylinderGeometry(25, 23, 6.5, 12, 3), 0.7, 0.07, 9.1);
  shelf.scale(1.12, 1, 0.86);
  addPart(shelf, bodyMat, { x: 0, y: 46, z: -318 }, { x: 0.06 }, 'shoulder_shelf');

  // deltoid masses framing the shelf
  for (const [sx, sd] of [[25, 11], [-25, 12]]) {
    const sh = sculpt(new THREE.SphereGeometry(11.5, 20, 15), 0.8, 0.19, sd);
    sh.scale(1.25, 0.92, 1.05);
    addPart(sh, bodyMat, { x: sx, y: 51, z: -320 }, null, 'shoulder');
  }

  // ---- NECK + BOWED HEAD
  const neckGeo = sculpt(new THREE.CylinderGeometry(9.2, 11.5, 15, 12, 4), 0.55, 0.2, 3.3);
  addPart(neckGeo, bodyMat, { x: 0, y: 78, z: -334 }, { x: 0.20 }, 'neck');

  const headGeo = sculpt(new THREE.SphereGeometry(14, 30, 24), 0.62, 0.14, 7.7);
  headGeo.scale(0.94, 1.18, 1.02);
  const head = addPart(headGeo, bodyMat, { x: 0, y: 92, z: -338 }, { x: 0.42 }, 'head');

  // brow ridge: a heavy shelf over the eyes (reading as a face, not a rock)
  const brow = sculpt(new THREE.BoxGeometry(21, 2.6, 5.2, 10, 2, 2), 0.2, 0.45, 2.2);
  addPart(brow, bodyMat, { x: 0, y: 96.5, z: -328.5 }, { x: 0.30 }, 'brow');
  // cheek planes
  for (const sx of [-6.4, 6.4]) {
    const cheek = sculpt(new THREE.SphereGeometry(5.0, 12, 9), 0.18, 0.3, sx);
    cheek.scale(1.0, 0.72, 0.8);
    addPart(cheek, bodyMat, { x: sx, y: 91.2, z: -326.6 }, { x: 0.3 }, 'cheek');
  }
  // eye sockets: deep dark recesses, closed in prayer
  const socketMat = new THREE.MeshStandardMaterial({ color: 0x1d1b18, roughness: 1 });
  for (const sx of [-5.4, 5.4]) {
    const socket = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 10), socketMat);
    socket.position.set(sx, 94.4, -327.4);
    socket.scale.set(1.25, 0.7, 0.55);
    group.add(socket);
  }
  // jaw / chin
  const jaw = sculpt(new THREE.BoxGeometry(13, 5.2, 9, 7, 3, 4), 0.28, 0.3, 4.1);
  addPart(jaw, bodyMat, { x: 0, y: 85.6, z: -327.6 }, { x: 0.42 }, 'jaw');

  // ---- ARMS: upper arm out of the deltoid, elbow bent down, forearm braced on the ground
  for (const [sx, sd] of [[40, 31], [-40, 32]]) {
    const upper = sculpt(new THREE.CylinderGeometry(7.4, 8.6, 26, 12, 6), 0.6, 0.12, sd);
    addPart(upper, bodyMat, { x: sx, y: 32, z: -308 }, { x: 0.16, z: sx > 0 ? -0.20 : 0.20 }, 'upperarm');
    const elbore = sculpt(new THREE.SphereGeometry(7.8, 14, 11), 0.4, 0.2, sd + 5);
    addPart(elbore, bodyMat, { x: sx * 1.06, y: 19.5, z: -296 }, null, 'elbow');
    const fore = sculpt(new THREE.CylinderGeometry(6.6, 5.6, 22, 10, 5), 0.5, 0.13, sd + 9);
    addPart(fore, bodyMat, { x: sx * 1.10, y: 10.5, z: -283 }, { x: -0.62 }, 'forearm');
  }

  // ---- HANDS: flat palms with splayed stone fingers, pressed into the shallows
  for (const [hx, hz, sd] of [[46, -272, 40], [-46, -268, 41]]) {
    const palm = sculpt(new THREE.BoxGeometry(13, 3.4, 15, 6, 2, 6), 0.32, 0.28, sd);
    addPart(palm, bodyMat, { x: hx, y: 2.4, z: hz }, { x: 0.03 }, 'palm');
    for (let f = 0; f < 4; f++) {
      const fg = sculpt(new THREE.CylinderGeometry(1.15, 1.5, 8.5, 7, 3), 0.2, 0.35, f * 2.7 + sd);
      const ang = (f - 1.5) * 0.30;
      addPart(fg, bodyMat, { x: hx + Math.sin(ang) * 6.6, y: 1.7, z: hz - 9.5 + Math.abs(ang) * 2.0 },
        { x: 1.46, z: ang * 0.6 }, 'finger');
    }
    // thumb
    const th = sculpt(new THREE.CylinderGeometry(1.3, 1.7, 7, 7, 3), 0.2, 0.35, sd + 3);
    addPart(th, bodyMat, { x: hx + (hx > 0 ? 7.4 : -7.4), y: 1.9, z: hz + 2.2 }, { x: 0.5, z: hx > 0 ? 0.7 : -0.7 }, 'thumb');
  }

  // ---- CARVED MANTLE: shoulder cloth in stone, with a deep carved fold line
  const mantle = sculpt(new THREE.CylinderGeometry(21, 30, 17, 13, 4), 0.85, 0.09, 6.3);
  mantle.scale(1.06, 1, 0.9);
  addPart(mantle, bodyMat, { x: 0, y: 42, z: -322 }, { x: 0.05 }, 'mantle');

  // ---- MOSS / LICHEN on upward faces (weathering)
  const mossRng = makeRng(77);
  for (let i = 0; i < 34; i++) {
    const a = mossRng() * TAU;
    const r = 6 + mossRng() * 30;
    const mx = Math.cos(a) * r, mz = -324 + Math.sin(a) * r * 0.72;
    const my = mossRng() < 0.5 ? 47.5 : 52 + mossRng() * 36;
    const g = new THREE.CircleGeometry(1.4 + mossRng() * 3.6, 7);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, mossMat);
    m.position.set(mx, my, mz);
    m.rotation.y = mossRng() * TAU;
    m.receiveShadow = preset.shadows;
    group.add(m);
  }

  // ---- SIGILS: warm carvings along the collarbone and brow, the titan is still listening
  const sigils = new THREE.Group();
  const glowTex = glowTexture();
  const sigilPositions = [
    [-13, 57.5, -309.5], [-6.5, 58.4, -309.8], [0, 58.8, -310.0], [6.5, 58.4, -309.8], [13, 57.5, -309.5],
    [-9, 100.0, -329.5], [0, 100.8, -329.8], [9, 100.0, -329.5],
  ];
  for (const [sx, sy, sz] of sigilPositions) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0xffcb84, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    s.position.set(sx, sy, sz);
    s.scale.set(2.4, 2.4, 1);
    sigils.add(s);
  }
  group.add(sigils);

  const heart = new THREE.PointLight(0xffb870, 2.6, 80, 2);
  heart.position.set(0, 62, -306);
  group.add(heart);

  group.userData.sigils = sigils;
  group.userData.heart = heart;
  group.userData.head = head;
  group.userData.update = (t) => {
    const pulse = 0.55 + Math.sin(t * 0.7) * 0.16;
    sigils.children.forEach((s, i) => {
      s.material.opacity = pulse * (0.7 + Math.sin(t * 1.6 + i * 0.9) * 0.3);
      s.scale.setScalar(2.0 + Math.sin(t * 1.1 + i) * 0.35);
    });
    heart.intensity = 2.2 + Math.sin(t * 0.8) * 0.6;
    // the head bows almost imperceptibly, as if still praying
    head.rotation.x = 0.42 + Math.sin(t * 0.22) * 0.012;
  };
  return group;
}

// ---------------------------------------------------------------------------------------------
// BELL SHRINES — arched frame, bronze bell, warm lantern, save/fast-travel point
// ---------------------------------------------------------------------------------------------
export function buildShrine(shrines, preset) {
  const group = new THREE.Group();
  group.name = 'shrines';
  const wood = woodTextures();
  const woodMat = new THREE.MeshStandardMaterial({
    map: wood.map, normalMap: wood.normalMap, color: 0x8a7a5e, roughness: 0.86, metalness: 0.05,
  });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x8c6a3a, roughness: 0.36, metalness: 0.86 });
  const glowTex = glowTexture();
  const lanternMat = new THREE.SpriteMaterial({
    map: glowTex, color: 0xffc078, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  const bells = [];
  for (const s of SHRINES) {
    const g = new THREE.Group();
    const y = terrainHeight(s.x, s.z);
    g.position.set(s.x, y, s.z);

    // two upright posts
    for (const px of [-1.5, 1.5]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.26, 4.4, 8, 3), woodMat);
      post.position.set(px, 2.2, 0);
      post.castShadow = preset.shadows;
      g.add(post);
    }
    // crossbeam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.34, 0.6), woodMat);
    beam.position.set(0, 4.35, 0); beam.castShadow = preset.shadows;
    g.add(beam);
    // diagonal braces
    for (const bx of [-1.25, 1.25]) {
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.7, 0.18), woodMat);
      br.position.set(bx, 3.5, 0); br.rotation.z = bx > 0 ? 0.55 : -0.55;
      g.add(br);
    }
    // bell: lathe profile (a real bell shape, not a cone)
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const r = 0.16 + Math.sin(t * Math.PI * 0.92) * 0.72 + t * 0.14;
      pts.push(new THREE.Vector2(r, -t * 1.5));
    }
    const bellGeo = new THREE.LatheGeometry(pts, 20);
    const bell = new THREE.Mesh(bellGeo, bronze);
    bell.position.set(0, 3.55, 0);
    bell.castShadow = preset.shadows;
    g.add(bell);
    // clapper + rope
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), bronze);
    clapper.position.set(0, 2.3, 0);
    g.add(clapper);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.7, 5), new THREE.MeshStandardMaterial({ color: 0x6a5b42, roughness: 1 }));
    rope.position.set(0, 1.35, 0.62); rope.rotation.x = 0.12;
    g.add(rope);
    // hanging lantern glow + real light (only near shrines; budgeted)
    const glow = new THREE.Sprite(lanternMat.clone());
    glow.position.set(1.9, 3.1, 0.4);
    glow.scale.set(2.6, 2.6, 1);
    g.add(glow);
    if (preset.quality === 'ultra' || preset.quality === 'high') {
      const pl = new THREE.PointLight(0xffb060, 2.4, 16, 2.2);
      pl.position.set(1.9, 3.1, 0.4);
      g.add(pl);
    }
    // offering stones at the base
    const rng = makeRng(s.x * 31 + s.z);
    for (let i = 0; i < 7; i++) {
      const ang = rng() * TAU, rad = 1.2 + rng() * 1.6;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + rng() * 0.3, 0), new THREE.MeshStandardMaterial({ color: 0x8b8578, roughness: 1 }));
      st.position.set(Math.cos(ang) * rad, 0.12, Math.sin(ang) * rad);
      st.rotation.set(rng(), rng(), rng());
      st.castShadow = preset.shadows;
      g.add(st);
    }
    group.add(g);
    bells.push({ data: s, group: g, bell, rope, baseY: y });
  }
  group.userData.bells = bells;
  return group;
}

// ---------------------------------------------------------------------------------------------
// THE MAW — broken monolith ring around a vast split in the ash
// ---------------------------------------------------------------------------------------------
export function buildMaw(preset) {
  const group = new THREE.Group();
  group.name = 'maw';
  const stone = stoneTextures();
  const mat = stoneMaterial(stone, 0x6a6560, 0.98);
  mat.normalScale.set(2.6, 2.6);
  const M = STRUCTURES.maw;
  const rng = makeRng(5150);
  const glowTex = glowTexture();
  const riftMat = new THREE.MeshBasicMaterial({ color: 0x120f12, transparent: true, opacity: 0.94, side: THREE.DoubleSide });

  // monoliths, leaning inward like teeth
  for (let i = 0; i < M.monoliths; i++) {
    const a = (i / M.monoliths) * TAU + 0.35;
    const rr = 24 + rngRange(rng, -2.5, 2.5);
    const x = M.center.x + Math.cos(a) * rr, z = M.center.z + Math.sin(a) * rr;
    const y = terrainHeight(x, z);
    const h = 7 + rng() * 12;
    const geo = sculpt(new THREE.BoxGeometry(2.4, h, 2.2, 3, 12, 3), 0.32, 0.35, i * 1.7);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y + h * 0.5 - 0.6, z);
    m.rotation.set(0, -a + Math.PI / 2, (rng() - 0.5) * 0.12 + 0.1);
    m.castShadow = preset.shadows;
    m.receiveShadow = preset.shadows;
    group.add(m);
    // carved slot glowing faintly
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.35, h * 0.55), new THREE.MeshBasicMaterial({ color: 0x8a6cff, transparent: true, opacity: 0.35 }));
    slot.position.set(x - Math.cos(a) * 1.2, y + h * 0.55, z - Math.sin(a) * 1.2);
    slot.rotation.y = -a + Math.PI / 2;
    group.add(slot);
  }

  // the rift: a dark ellipse pressed into the ash, with a rim of embers
  const riftGeo = new THREE.CircleGeometry(13, 40);
  riftGeo.rotateX(-Math.PI / 2);
  const rift = new THREE.Mesh(riftGeo, riftMat);
  rift.position.set(M.center.x, terrainHeight(M.center.x, M.center.z) + 0.06, M.center.z);
  group.add(rift);

  const emberMat = new THREE.SpriteMaterial({ map: glowTex, color: 0xb98cff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
  const embers = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const a = rng() * TAU, r = 12 + rng() * 6;
    const s = new THREE.Sprite(emberMat.clone());
    s.position.set(M.center.x + Math.cos(a) * r, terrainHeight(M.center.x + Math.cos(a) * r, M.center.z + Math.sin(a) * r) + 0.5 + rng() * 2.6, M.center.z + Math.sin(a) * r);
    s.scale.setScalar(0.6 + rng() * 1.8);
    s.userData.phase = rng() * TAU;
    embers.add(s);
  }
  group.add(embers);

  const riftLight = new THREE.PointLight(0x9a78ff, 2.0, 55, 2);
  riftLight.position.set(M.center.x, 6, M.center.z);
  group.add(riftLight);

  group.userData.update = (t) => {
    embers.children.forEach((s) => {
      s.material.opacity = 0.25 + Math.abs(Math.sin(t * 0.8 + s.userData.phase)) * 0.5;
    });
    riftLight.intensity = 1.6 + Math.sin(t * 0.45) * 0.6;
  };
  return group;
}

// ---------------------------------------------------------------------------------------------
// GLASS AMPHITHEATRE — shattered tiers in the Glass Reach
// ---------------------------------------------------------------------------------------------
export function buildAmphitheatre(preset) {
  const group = new THREE.Group();
  const stone = stoneTextures();
  const mat = stoneMaterial(stone, 0xb9b6ad, 0.7);
  const A = STRUCTURES.amphitheatre;
  const rng = makeRng(8181);
  for (let ring = 0; ring < 4; ring++) {
    const rr = A.radius - ring * 4.4;
    const ry = 1.1 + ring * 1.6;
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      if (rng() < 0.24) continue;
      const a = (i / segs) * TAU;
      const x = A.center.x + Math.cos(a) * rr, z = A.center.z + Math.sin(a) * rr;
      const y = terrainHeight(x, z);
      const geo = sculpt(new THREE.BoxGeometry(5.4, ry * 1.05, 2.1, 5, 2, 2), 0.18, 0.5, i + ring * 7);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y + ry * 0.42, z);
      m.rotation.y = -a;
      m.castShadow = preset.shadows;
      m.receiveShadow = preset.shadows;
      group.add(m);
    }
  }
  // central plinth where the bell hangs
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 5.0, 1.1, 12), mat);
  plinth.position.set(A.center.x, terrainHeight(A.center.x, A.center.z) + 0.4, A.center.z);
  plinth.receiveShadow = preset.shadows;
  group.add(plinth);
  // standing shards of glass, catching light
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xcfe8f2, roughness: 0.08, metalness: 0.15, transparent: true, opacity: 0.52,
    side: THREE.DoubleSide, envMapIntensity: 1.2,
  });
  for (let i = 0; i < 22; i++) {
    const a = rng() * TAU, r = 6 + rng() * 20;
    const x = A.center.x + Math.cos(a) * r, z = A.center.z + Math.sin(a) * r;
    const h = 2 + rng() * 7;
    const g = new THREE.ConeGeometry(0.5 + rng() * 1.1, h, 5);
    const m = new THREE.Mesh(g, glassMat);
    m.position.set(x, terrainHeight(x, z) + h * 0.42, z);
    m.rotation.set((rng() - 0.5) * 0.25, rng() * TAU, (rng() - 0.5) * 0.25);
    group.add(m);
  }
  return group;
}

// ---------------------------------------------------------------------------------------------
// OSSUARY BELL CHAMBER — ribs arching over the Second Bell
// ---------------------------------------------------------------------------------------------
export function buildBellChamber(preset) {
  const group = new THREE.Group();
  const coral = coralTextures();
  const mat = new THREE.MeshStandardMaterial({
    map: coral.map, normalMap: coral.normalMap, color: 0xa8b0a4,
    roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide,
  });
  mat.normalScale.set(2.0, 2.0);
  const C = STRUCTURES.bellChamber;
  const rng = makeRng(3131);
  // ribs: tapered tubes arching over the centre
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * 13, 0, Math.sin(a) * 13),
      new THREE.Vector3(Math.cos(a) * 9.5, 9.5, Math.sin(a) * 9.5),
      new THREE.Vector3(Math.cos(a + 0.12) * 3.5, 17.5, Math.sin(a + 0.12) * 3.5),
      new THREE.Vector3(Math.cos(a + 0.24) * 2.2, 20.5, Math.sin(a + 0.24) * 2.2),
    ]);
    const tube = new THREE.TubeGeometry(curve, 18, 0.95 + rng() * 0.5, 7, false);
    const m = new THREE.Mesh(tube, mat);
    m.position.set(C.center.x, terrainHeight(C.center.x, C.center.z) - 0.4, C.center.z);
    m.castShadow = preset.shadows;
    m.receiveShadow = preset.shadows;
    group.add(m);
  }
  // hanging bell (big) at the centre
  const bronze = new THREE.MeshStandardMaterial({ color: 0x7f6234, roughness: 0.4, metalness: 0.82 });
  const pts = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const r = 0.3 + Math.sin(t * Math.PI * 0.9) * 1.9 + t * 0.35;
    pts.push(new THREE.Vector2(r, -t * 3.6));
  }
  const bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 22), bronze);
  bell.position.set(C.center.x, terrainHeight(C.center.x, C.center.z) + 10.4, C.center.z);
  bell.castShadow = preset.shadows;
  group.add(bell);
  group.userData.bell = bell;

  // luminous spores in the chamber
  const glowTex = glowTexture();
  const spores = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: 0x8affd8, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    const a = rng() * TAU, r = rng() * 12;
    s.position.set(C.center.x + Math.cos(a) * r, terrainHeight(C.center.x, C.center.z) + 1 + rng() * 14, C.center.z + Math.sin(a) * r);
    s.scale.setScalar(0.5 + rng() * 1.4);
    s.userData.phase = rng() * TAU;
    spores.add(s);
  }
  group.add(spores);
  group.userData.update = (t) => {
    spores.children.forEach((s) => {
      s.position.y += Math.sin(t * 0.6 + s.userData.phase) * 0.004;
      s.material.opacity = 0.25 + Math.abs(Math.sin(t * 0.7 + s.userData.phase)) * 0.45;
    });
    bell.rotation.z = Math.sin(t * 0.22) * 0.006;
  };
  return group;
}

export { sculpt, stoneMaterial };

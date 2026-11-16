// Y'SMARA — flora & scattered props.
// InstancedMesh everywhere (one draw call per kind), wind animation inside the vertex shader,
// quality-scaled density. This is what makes the coast feel alive instead of a heightmap.
import * as THREE from 'three';
import { getProps, regionAt } from './world.js';
import { grassTexture, glowTexture, coralTextures, stoneTextures, woodTextures } from './textures.js';
import { makeNoise2D, makeRng, clamp, rngRange, TAU, smoothstep } from '../core/math.js';

const WIND_VERT = /* glsl */`
uniform float uTime;
uniform float uWind;
uniform vec2  uWindDir;
attribute float aPhase;
attribute float aHeight;
varying vec3 vN;
varying vec3 vWpos;
varying float vH;

void main() {
  vec3 p = position;
  float hRatio = clamp((p.y - aHeight * 0.15) / max(aHeight, 0.001), 0.0, 1.0);
  float sway = sin(uTime * 1.15 + aPhase) * 0.5 + sin(uTime * 2.3 + aPhase * 1.7) * 0.22;
  float gust = sin(uTime * 0.32 + aPhase * 0.1) * 0.35;
  float amt = hRatio * hRatio * uWind * (0.55 + gust);
  p.x += (uWindDir.x * amt + sway * amt * 0.34);
  p.z += (uWindDir.y * amt + sway * amt * 0.28);
  p.y += sin(uTime * 2.1 + aPhase * 2.0) * 0.02 * hRatio;

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWpos = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vH = hRatio;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

function windMaterial(base, windAmount = 0.25, extraUniforms = {}) {
  const mat = base.clone();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWind = { value: windAmount };
    shader.uniforms.uWindDir = { value: new THREE.Vector2(0.85, 0.53) };
    Object.assign(shader.uniforms, extraUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform float uTime; uniform float uWind; uniform vec2 uWindDir;
attribute float aPhase; attribute float aHeight;
varying float vH;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  float hR = clamp((position.y - aHeight * 0.12) / max(aHeight, 0.001), 0.0, 1.0);
  float sway = sin(uTime * 1.15 + aPhase) * 0.5 + sin(uTime * 2.3 + aPhase * 1.7) * 0.22;
  float gust = sin(uTime * 0.32 + aPhase * 0.1) * 0.35;
  float amt = hR * hR * uWind * (0.55 + gust);
  transformed.x += uWindDir.x * amt + sway * amt * 0.34;
  transformed.z += uWindDir.y * amt + sway * amt * 0.28;
  vH = hR;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vH;');
    mat.userData.shader = shader;
  };
  return mat;
}

/** Salt-grass tufts: crossed quads with a painted alpha blade texture. */
function grassGeometry() {
  const g = new THREE.BufferGeometry();
  const w = 0.9, h = 1.5;
  const verts = [];
  const uvs = [];
  const normals = [];
  const idx = [];
  const planes = [
    { n: [0, 0, 1], a: [-w / 2, 0, 0], b: [w / 2, 0, 0], c: [w / 2, h, 0], d: [-w / 2, h, 0] },
    { n: [0, 0, 1], a: [0, 0, -w / 2], b: [0, 0, w / 2], c: [0, h, w / 2], d: [0, h, -w / 2] },
    { n: [0, 0, 1], a: [-w * 0.35, 0, -w * 0.35], b: [w * 0.35, 0, w * 0.35], c: [w * 0.35, h * 0.85, w * 0.35], d: [-w * 0.35, h * 0.85, -w * 0.35] },
  ];
  for (const p of planes) {
    const base = verts.length / 3;
    for (const v of [p.a, p.b, p.c, p.d]) { verts.push(...v); normals.push(...p.n); }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

/** Add per-instance phase/height attributes required by the wind shader. */
function withWindAttrs(geo, seed) {
  const g = geo.clone();
  const rng = makeRng(seed);
  const count = g.attributes.position.count;
  const phase = new Float32Array(count);
  const height = new Float32Array(count);
  let maxY = 0;
  const pos = g.attributes.position;
  for (let i = 0; i < count; i++) maxY = Math.max(maxY, pos.getY(i));
  for (let i = 0; i < count; i++) {
    phase[i] = rng() * TAU;
    height[i] = maxY;
  }
  g.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  g.setAttribute('aHeight', new THREE.BufferAttribute(height, 1));
  return g;
}

function instanced(geo, mat, list, scene, { scaleJitter = true, name = '' } = {}) {
  if (!list.length) return null;
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    p.set(it.x, it.y, it.z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot || 0);
    const sc = it.scale ?? 1;
    s.set(sc, sc * (it.sy ?? 1), sc);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = true;
  scene.add(mesh);
  return mesh;
}

export class FloraSystem {
  constructor(scene, preset) {
    this.scene = scene;
    this.preset = preset;
    this.group = new THREE.Group();
    this.group.name = 'flora';
    scene.add(this.group);
    this.windMats = [];
    this.meshes = [];
    this.build();
  }

  build() {
    const preset = this.preset;
    const density = preset.foliage;
    const props = getProps();
    const sample = (arr, k) => (k >= 1 ? arr : arr.filter((_, i) => i % Math.round(1 / k) === 0));

    // --- SALT GRASS
    const grassTex = grassTexture();
    const grassMat = windMaterial(new THREE.MeshStandardMaterial({
      map: grassTex, transparent: true, alphaTest: 0.34, side: THREE.DoubleSide,
      color: 0xa8a878, roughness: 0.95, metalness: 0,
    }), 0.22);
    this.windMats.push(grassMat);
    if (props.saltreed?.length) {
      const g = withWindAttrs(grassGeometry(), 3);
      const list = sample(props.saltreed, density * 1.0).map((p) => ({ ...p, sy: p.scale * 0.9 + 0.3 }));
      const m = instanced(g, grassMat, list, this.group, { name: 'saltgrass' });
      if (m) this.meshes.push(m);
    }

    // --- SALT BUSH (low, rounded, wind-blown)
    if (props.saltbush?.length) {
      const bushMat = windMaterial(new THREE.MeshStandardMaterial({ color: 0x7d8a5e, roughness: 1, flatShading: true }), 0.08);
      this.windMats.push(bushMat);
      const g = withWindAttrs(new THREE.IcosahedronGeometry(0.8, 1), 4);
      g.scale(1.25, 0.72, 1.15);
      const list = sample(props.saltbush, density * 0.9);
      const m = instanced(g, bushMat, list, this.group, { name: 'saltbush' });
      if (m) this.meshes.push(m);
    }

    // --- CORAL CLUSTERS (gnarled, sculpted by displacement)
    const coralSet = coralTextures();
    if (props.coral?.length) {
      const mat = new THREE.MeshStandardMaterial({
        map: coralSet.map, normalMap: coralSet.normalMap, color: 0xc4b0a0,
        roughness: 0.78, metalness: 0.02, flatShading: false,
      });
      const noise = makeNoise2D(88);
      const g = new THREE.CylinderGeometry(0.22, 0.55, 2.2, 7, 5);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const d = noise(x * 2.4, y * 1.3 + z) * 0.34 + noise(y * 3.4, x * 2.1) * 0.14;
        pos.setXYZ(i, x * (1 + d), y, z * (1 + d));
      }
      g.computeVertexNormals();
      g.translate(0, 1.1, 0);
      const list = sample(props.coral, density);
      const m = instanced(g, mat, list, this.group, { name: 'coral' });
      if (m) this.meshes.push(m);
    }

    // --- CORAL FANS (thin, translucent, catches the light)
    if (props.coralFan?.length) {
      const fanMat = new THREE.MeshStandardMaterial({
        color: 0x9fe8d8, roughness: 0.5, metalness: 0.1, transparent: true, opacity: 0.78,
        side: THREE.DoubleSide, emissive: 0x1d5750, emissiveIntensity: 0.55,
      });
      const g = withWindAttrs(new THREE.CircleGeometry(0.75, 9, 0, Math.PI), 6);
      const list = sample(props.coralFan, density * 0.85);
      const m = instanced(g, fanMat, list, this.group, { name: 'coralFan' });
      if (m) {
        m.castShadow = false;
        // rotate fans upright
        const mm = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          p.set(it.x, it.y + 1.1, it.z);
          q.setFromEuler(new THREE.Euler(0, it.rot, 0));
          const sc = it.scale;
          s.set(sc, sc, sc);
          mm.compose(p, q, s);
          m.setMatrixAt(i, mm);
        }
        m.instanceMatrix.needsUpdate = true;
      }
    }

    // --- ROCKS
    const stoneSet = stoneTextures();
    if (props.rock?.length) {
      const mat = new THREE.MeshStandardMaterial({
        map: stoneSet.map, normalMap: stoneSet.normalMap, color: 0x9a958a,
        roughness: 0.95, metalness: 0.01, flatShading: true,
      });
      const g = new THREE.DodecahedronGeometry(0.52, 0);
      const noise = makeNoise2D(123);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const d = 1 + noise(x * 2.6, y * 2.2 + z * 1.8) * 0.42;
        // stones lie low: wide and flat, never a smooth grey dome
        pos.setXYZ(i, x * d * 1.28, y * d * 0.52, z * d * 1.1);
      }
      g.computeVertexNormals();
      const list = sample(props.rock, density);
      const m = instanced(g, mat, list, this.group, { name: 'rocks' });
      if (m) { m.castShadow = preset.shadows; m.receiveShadow = preset.shadows; this.meshes.push(m); }
    }

    // --- GLASS SHARDS (the Reach's signature)
    if (props.glassShard?.length) {
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0xd6e8ee, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.62,
        transmission: 0.0, side: THREE.DoubleSide, emissive: 0x2a3d44, emissiveIntensity: 0.25,
        flatShading: true,
      });
      const shardGeo = () => {
        const g = new THREE.ConeGeometry(0.55, 3.2, 3);
        g.translate(0, 1.6, 0);
        return g;
      };
      const list = sample(props.glassShard, density * 0.9);
      const m = instanced(shardGeo(), glassMat, list, this.group, { name: 'glassShards' });
      if (m) { m.castShadow = false; m.renderOrder = 1; this.meshes.push(m); }
    }

    // --- DEAD TREES (sculpted, branching)
    if (props.deadtree?.length) {
      const wood = woodTextures();
      const mat = new THREE.MeshStandardMaterial({ color: 0x4f4638, roughness: 1, metalness: 0 });
      const treeGeo = buildDeadTreeGeometry();
      const list = sample(props.deadtree, density);
      const m = instanced(treeGeo.geo, mat, list, this.group, { name: 'deadtrees' });
      if (m) { m.castShadow = preset.shadows; this.meshes.push(m); }
    }

    // --- STUMPS
    if (props.stump?.length) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x5c4c3a, roughness: 1 });
      const g = new THREE.CylinderGeometry(0.55, 0.75, 0.9, 9, 2);
      g.translate(0, 0.45, 0);
      const list = sample(props.stump, density);
      const m = instanced(g, mat, list, this.group, { name: 'stumps' });
      if (m) { m.castShadow = preset.shadows; this.meshes.push(m); }
    }

    // --- ASH PILLARS (the Hollow)
    if (props.ashPillar?.length) {
      const stone = stoneTextures();
      const mat = new THREE.MeshStandardMaterial({
        map: stone.map, normalMap: stone.normalMap, color: 0x565250, roughness: 1,
      });
      const g = new THREE.CylinderGeometry(0.5, 0.9, 7, 6, 6);
      g.translate(0, 3.5, 0);
      const pos = g.attributes.position;
      const nx = makeNoise2D(555);
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const d = 1 + nx(x * 1.2, y * 0.5 + z) * 0.24;
        pos.setXYZ(i, x * d, y, z * d);
      }
      g.computeVertexNormals();
      const list = sample(props.ashPillar, density);
      const m = instanced(g, mat, list, this.group, { name: 'ashPillars' });
      if (m) { m.castShadow = preset.shadows; m.receiveShadow = preset.shadows; this.meshes.push(m); }
    }

    // --- BONE ARCHES (whale-rib gateways in the shallows)
    if (props.boneArch?.length) {
      const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8cfb4, roughness: 0.72, metalness: 0.02 });
      const arch = buildBoneArchGeometry();
      const list = sample(props.boneArch, density);
      const m = instanced(arch, boneMat, list, this.group, { name: 'boneArches' });
      if (m) { m.castShadow = preset.shadows; this.meshes.push(m); }
    }

    // --- LANTERNS (emissive lanterns on poles along the causeway)
    if (props.lantern?.length) {
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x40372c, roughness: 1 });
      const poleGeo = new THREE.CylinderGeometry(0.075, 0.1, 3.0, 6);
      poleGeo.translate(0, 1.5, 0);
      const poleMesh = instanced(poleGeo, poleMat, props.lantern, this.group, { name: 'lanternPoles' });
      if (poleMesh) { poleMesh.castShadow = preset.shadows; this.meshes.push(poleMesh); }

      const glowTex = glowTexture();
      const lanternMat = new THREE.SpriteMaterial({
        map: glowTex, color: 0xffbe78, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sprites = new THREE.Group();
      for (const l of props.lantern) {
        const s = new THREE.Sprite(lanternMat.clone());
        s.position.set(l.x, l.y + 3.0, l.z);
        s.scale.setScalar(2.1);
        s.userData.phase = Math.random() * TAU;
        sprites.add(s);
      }
      this.group.add(sprites);
      this.lanterns = sprites;
    }

    // --- WRECKS (half-sunk boats)
    if (props.wreck?.length) {
      const wood = woodTextures();
      const mat = new THREE.MeshStandardMaterial({ map: wood.map, normalMap: wood.normalMap, color: 0x6e5f4a, roughness: 0.92 });
      const hull = buildWreckGeometry();
      const list = sample(props.wreck, density);
      const m = instanced(hull, mat, list, this.group, { name: 'wrecks' });
      if (m) { m.castShadow = preset.shadows; this.meshes.push(m); }
    }
  }

  update(t, playerPos, wind = 1) {
    for (const m of this.windMats) {
      const sh = m.userData.shader;
      if (sh) { sh.uniforms.uTime.value = t; sh.uniforms.uWind.value = 0.22 * wind; }
    }
    if (this.lanterns) {
      this.lanterns.children.forEach((s) => {
        s.material.opacity = 0.65 + Math.sin(t * 2.4 + s.userData.phase) * 0.22 + Math.sin(t * 7.1 + s.userData.phase) * 0.08;
        s.scale.setScalar(2.0 + Math.sin(t * 3.1 + s.userData.phase) * 0.16);
      });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// geometry helpers
// ---------------------------------------------------------------------------------------------
function buildDeadTreeGeometry() {
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.18, 0.42, 5.2, 7, 4);
  trunk.translate(0, 2.6, 0);
  parts.push(trunk);
  const rng = makeRng(313);
  for (let i = 0; i < 7; i++) {
    const h = 2.4 + rng() * 2.4;
    const len = 1.2 + rng() * 2.0;
    const br = new THREE.CylinderGeometry(0.045, 0.14, len, 5, 2);
    br.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      (0.55 + rng() * 0.5) * (rng() > 0.5 ? 1 : -1), rng() * TAU, (rng() - 0.5) * 0.7
    ));
    br.applyQuaternion(q);
    br.translate(0, h, 0);
    parts.push(br);
  }
  const geo = mergeGeometries(parts);
  return { geo };
}

function buildBoneArchGeometry() {
  const parts = [];
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 2.9, 0, 0),
      new THREE.Vector3(side * 3.3, 2.6, 0.15),
      new THREE.Vector3(side * 2.1, 5.0, 0.1),
      new THREE.Vector3(side * 0.75, 6.6, 0),
    ]);
    parts.push(new THREE.TubeGeometry(curve, 14, 0.26, 6, false));
    // vertebrae bumps
    for (let i = 0; i < 5; i++) {
      const t = 0.12 + i * 0.19;
      const p = curve.getPoint(t);
      const bump = new THREE.SphereGeometry(0.36, 7, 5);
      bump.translate(p.x, p.y, p.z);
      parts.push(bump);
    }
  }
  // crown
  const crown = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.75, 6.6, 0), new THREE.Vector3(0, 7.0, 0.1), new THREE.Vector3(0.75, 6.6, 0),
  ]), 8, 0.24, 6, false);
  parts.push(crown);
  return mergeGeometries(parts);
}

function buildWreckGeometry() {
  const parts = [];
  const hull = new THREE.CylinderGeometry(1.5, 0.9, 5.0, 10, 5, true, 0, Math.PI);
  hull.rotateZ(Math.PI / 2);
  hull.rotateX(Math.PI / 2);
  hull.scale(1, 0.6, 1);
  hull.translate(0, 0.7, 0);
  parts.push(hull);
  // ribs
  for (let i = 0; i < 4; i++) {
    const r = new THREE.TorusGeometry(1.4 - i * 0.1, 0.075, 5, 9, Math.PI);
    r.rotateY(Math.PI / 2);
    r.translate(-1.8 + i * 1.2, 0.7, 0);
    parts.push(r);
  }
  const mast = new THREE.CylinderGeometry(0.09, 0.12, 3.4, 6);
  mast.translate(0.3, 1.9, 0);
  mast.rotateZ(0.4);
  parts.push(mast);
  return mergeGeometries(parts);
}

/** Minimal geometry merge (positions/normals/uvs) to avoid pulling in examples/jsm helpers. */
export function mergeGeometries(geos) {
  const out = new THREE.BufferGeometry();
  let vCount = 0, iCount = 0;
  const norm = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of norm) { vCount += g.attributes.position.count; }
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  let o = 0;
  for (const g of norm) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos[(o + i) * 3] = p.getX(i); pos[(o + i) * 3 + 1] = p.getY(i); pos[(o + i) * 3 + 2] = p.getZ(i);
      if (n) { nrm[(o + i) * 3] = n.getX(i); nrm[(o + i) * 3 + 1] = n.getY(i); nrm[(o + i) * 3 + 2] = n.getZ(i); }
      if (u) { uv[(o + i) * 2] = u.getX(i); uv[(o + i) * 2 + 1] = u.getY(i); }
    }
    o += p.count;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

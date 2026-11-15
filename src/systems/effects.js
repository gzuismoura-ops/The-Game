// Y'SMARA — effects.
// One pooled GPU particle system for everything: dust, water splashes, hymn motes, blood-less
// "silence" motes, embers, and impact sparks. Plus screen-space hit markers and floating numbers.
import * as THREE from 'three';
import { clamp, lerp, TAU, makeRng } from '../core/math.js';
import { glowTexture, puffTexture } from '../world/textures.js';

const PARTICLE_VERT = /* glsl */`
attribute float aSize;
attribute float aLife;
attribute vec3 aColor;
attribute float aKind;
varying vec3 vColor;
varying float vAlpha;
varying float vKind;
uniform float uPixelRatio;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vColor = aColor;
  vAlpha = clamp(aLife, 0.0, 1.0);
  vKind = aKind;
  gl_PointSize = aSize * uPixelRatio * (260.0 / max(-mv.z, 1.0));
  gl_Position = projectionMatrix * mv;
  if (aLife <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // cull dead
}
`;

const PARTICLE_FRAG = /* glsl */`
precision mediump float;
varying vec3 vColor;
varying float vAlpha;
varying float vKind;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  // soft core with a hot centre for sparks, puffy for dust
  float core = smoothstep(0.5, 0.0, r);
  float soft = pow(core, 1.6);
  float a = mix(soft, core * core, vKind) * vAlpha;
  vec3 c = vColor * (1.0 + core * 0.6);
  gl_FragColor = vec4(c, a);
}
`;

const MAX_PARTICLES = 900;

export class EffectsSystem {
  constructor(scene, preset) {
    this.scene = scene;
    this.preset = preset;
    this.max = preset.quality === 'potato' ? 240 : preset.quality === 'low' ? 420 : preset.quality === 'medium' ? 680 : MAX_PARTICLES;
    this.count = 0;
    this.positions = new Float32Array(this.max * 3);
    this.sizes = new Float32Array(this.max);
    this.lives = new Float32Array(this.max);
    this.colors = new Float32Array(this.max * 3);
    this.kinds = new Float32Array(this.max);
    this.vel = new Float32Array(this.max * 3);
    this.drag = new Float32Array(this.max);
    this.grav = new Float32Array(this.max);
    this.maxLife = new Float32Array(this.max);
    this.fade = new Float32Array(this.max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.lives, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aKind', new THREE.BufferAttribute(this.kinds, 1));
    this.geo = geo;

    this.mat = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) } },
      vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    // pooled dust puffs (soft alpha, non-additive) for readable ground impacts
    this.puffTex = puffTexture();
    this.puffs = [];
    const puffCount = preset.quality === 'potato' ? 8 : 26;
    for (let i = 0; i < puffCount; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.puffTex, color: 0xd8ccb0, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.NormalBlending,
      }));
      s.visible = false;
      scene.add(s);
      this.puffs.push({ sprite: s, life: 0, maxLife: 1, vel: new THREE.Vector3(), grow: 1 });
    }
    this.rng = makeRng(9182);

    // floating "silence" numerals are drawn by the HUD (DOM), not here.
    this.hitMarkers = [];
  }

  _alloc() {
    // find a free slot (life <= 0), else overwrite the oldest
    let idx = -1;
    for (let i = 0; i < this.max; i++) {
      const j = (this._cursor + i) % this.max;
      if (this.lives[j] <= 0) { idx = j; this._cursor = (j + 1) % this.max; return j; }
    }
    idx = this._cursor % this.max;
    this._cursor = (idx + 1) % this.max;
    return idx;
  }

  emit(opts) {
    const i = this._alloc();
    const p = opts.pos;
    this.positions[i * 3] = p.x; this.positions[i * 3 + 1] = p.y; this.positions[i * 3 + 2] = p.z;
    const v = opts.vel || { x: 0, y: 1, z: 0 };
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.sizes[i] = opts.size ?? 0.5;
    const c = opts.color || { r: 1, g: 1, b: 1 };
    this.colors[i * 3] = c.r; this.colors[i * 3 + 1] = c.g; this.colors[i * 3 + 2] = c.b;
    this.kinds[i] = opts.kind ?? 0;
    this.maxLife[i] = opts.life ?? 1;
    this.lives[i] = 1;
    this.drag[i] = opts.drag ?? 1.6;
    this.grav[i] = opts.gravity ?? 0;
    this.fade[i] = opts.fade ?? 1;
    return i;
  }

  /** Burst of dust at a footfall. */
  dust(pos, amount = 1) {
    for (let i = 0; i < 3 * amount; i++) {
      const a = this.rng() * TAU;
      this.emit({
        pos: { x: pos.x + Math.cos(a) * 0.2, y: pos.y + 0.05, z: pos.z + Math.sin(a) * 0.2 },
        vel: { x: Math.cos(a) * 0.7, y: 0.5 + this.rng() * 0.5, z: Math.sin(a) * 0.7 },
        size: 0.22 + this.rng() * 0.2, color: { r: 0.78, g: 0.72, b: 0.60 },
        life: 0.7, kind: 1, drag: 2.6, gravity: -0.4,
      });
    }
  }

  splash(pos, amount = 1, wading = 1) {
    for (let i = 0; i < 4 * amount; i++) {
      const a = this.rng() * TAU;
      const sp = 0.8 + this.rng() * 2.2 * wading;
      this.emit({
        pos: { x: pos.x + Math.cos(a) * 0.3, y: pos.y + 0.05, z: pos.z + Math.sin(a) * 0.3 },
        vel: { x: Math.cos(a) * sp, y: 1.4 + this.rng() * 2.2, z: Math.sin(a) * sp },
        size: 0.16 + this.rng() * 0.18, color: { r: 0.72, g: 0.86, b: 0.88 },
        life: 0.65, kind: 0, drag: 2.2, gravity: -9,
      });
    }
  }

  hitSpark(pos, color = { r: 1, g: 0.82, b: 0.45 }, amount = 1) {
    for (let i = 0; i < 8 * amount; i++) {
      const a = this.rng() * TAU, el = this.rng() * Math.PI - Math.PI / 2;
      const sp = 2 + this.rng() * 4.5;
      this.emit({
        pos: { x: pos.x, y: pos.y, z: pos.z },
        vel: { x: Math.cos(a) * Math.cos(el) * sp, y: Math.sin(el) * sp + 1, z: Math.sin(a) * Math.cos(el) * sp },
        size: 0.10 + this.rng() * 0.14, color, life: 0.45, kind: 0, drag: 3.4, gravity: -5,
      });
    }
  }

  hymnBurst(pos, radius, kind) {
    const colors = kind === 'ninth' ? { r: 1, g: 0.92, b: 0.62 } : kind === 'tune' ? { r: 0.78, g: 0.94, b: 1 } : { r: 0.88, g: 0.92, b: 0.86 };
    const n = kind === 'ninth' ? 90 : kind === 'tune' ? 50 : 26;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + this.rng() * 0.3;
      const sp = (2 + this.rng() * 4) * (radius / 10);
      this.emit({
        pos: { x: pos.x, y: pos.y + 0.4 + this.rng() * 0.6, z: pos.z },
        vel: { x: Math.cos(a) * sp, y: 0.6 + this.rng() * 1.8, z: Math.sin(a) * sp },
        size: 0.14 + this.rng() * 0.24, color: colors, life: 0.9, kind: 0, drag: 1.4, gravity: -1.2,
      });
    }
    this.puff(pos, kind === 'ninth' ? 0xffe0a0 : 0xdfeeff, 2.2, 0.9);
  }

  embers(pos, amount = 1) {
    for (let i = 0; i < 2 * amount; i++) {
      this.emit({
        pos: { x: pos.x + (this.rng() - 0.5) * 0.6, y: pos.y + this.rng() * 0.4, z: pos.z + (this.rng() - 0.5) * 0.6 },
        vel: { x: (this.rng() - 0.5) * 0.4, y: 0.6 + this.rng() * 0.8, z: (this.rng() - 0.5) * 0.4 },
        size: 0.06 + this.rng() * 0.08, color: { r: 1, g: 0.55, b: 0.2 }, life: 1.6, kind: 0, drag: 0.6, gravity: 0.2,
      });
    }
  }

  puff(pos, color, scale = 1.6, life = 1.0) {
    const slot = this.puffs.find((p) => p.life <= 0);
    if (!slot) return;
    slot.sprite.position.set(pos.x, pos.y + 0.4, pos.z);
    slot.sprite.material.color.setHex(color);
    slot.sprite.material.opacity = 0.55;
    slot.sprite.scale.setScalar(scale);
    slot.sprite.visible = true;
    slot.life = life; slot.maxLife = life; slot.grow = scale * 2.2;
    slot.vel.set((this.rng() - 0.5) * 0.5, 0.5, (this.rng() - 0.5) * 0.5);
  }

  /** Walking-through-water trail ring. */
  wakeRing(pos) {
    this.emit({
      pos: { x: pos.x, y: pos.y + 0.04, z: pos.z },
      vel: { x: 0, y: 0.15, z: 0 },
      size: 0.7, color: { r: 0.75, g: 0.9, b: 0.92 }, life: 0.5, kind: 1, drag: 0.4, gravity: 0,
    });
  }

  update(dt, camera) {
    const pos = this.positions, vel = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.lives[i] <= 0) continue;
      const d = Math.exp(-this.drag[i] * dt);
      vel[i * 3] *= d;
      vel[i * 3 + 2] *= d;
      vel[i * 3 + 1] = vel[i * 3 + 1] * d + this.grav[i] * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      this.lives[i] -= dt / this.maxLife[i];
      if (this.lives[i] < 0) this.lives[i] = 0;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aKind.needsUpdate = true;

    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      p.sprite.material.opacity = clamp(p.life / p.maxLife) * 0.5;
      p.sprite.scale.setScalar(lerp(p.sprite.scale.x, p.grow, dt * 1.6));
      if (p.life <= 0) p.sprite.visible = false;
    }
  }
}

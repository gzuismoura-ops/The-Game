// Y'SMARA — the Hymn.
// Combat is *sung*. Hold to gather breath (the ring fills, the world's ambience bends down);
// release to shape one of three syllables selected by how long you held:
//   Breathe  (short)  — a push of sound: stagger + knock back nearby Mutes, clears silt.
//   Tune     (medium) — a bright wave that damages and marks Mutes with a glowing seam.
//   Ninth    (full)   — a devastating verse: radial burst, shatters armour, stuns Husks.
// Resonance: hitting a marked Mute with the Ninth Verse detonates the seam.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU } from '../core/math.js';
import { GAME_CONSTANTS as C, terrainHeight } from '../world/world.js';
import { glowTexture } from '../world/textures.js';

const RING_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const RING_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform float uProgress;
uniform vec3 uColor;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  // expanding shock ring
  float front = uProgress * 1.15;
  float band = smoothstep(front - 0.22, front, r) * (1.0 - smoothstep(front, front + 0.10, r));
  float fill = (1.0 - smoothstep(0.0, 1.0, r)) * 0.10;
  // sound ripples
  float ripple = sin(r * 26.0 - uTime * 9.0) * 0.5 + 0.5;
  float a = (band * 1.0 + fill * ripple) * uAlpha * (1.0 - smoothstep(0.85, 1.0, r));
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor * (1.2 + band), a);
}
`;

export class HymnSystem {
  constructor(scene, preset) {
    this.scene = scene;
    this.preset = preset;
    this.charge = 0;
    this.charging = false;
    this.cooldown = 0;
    this.rings = [];
    this.marks = new Map();     // enemy -> mark timer
    this.combo = 0;
    this.comboTimer = 0;
    this.glowTex = glowTexture();
    this.lastLoudness = 0;
    this.syllable = null;

    // charge ring that orbits the player (always visible when charging)
    this.chargeGroup = new THREE.Group();
    const ringGeo = new THREE.RingGeometry(0.62, 0.78, 40);
    this.chargeMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.chargeRing = new THREE.Mesh(ringGeo, this.chargeMat);
    this.chargeRing.rotation.x = -Math.PI / 2;
    this.chargeGroup.add(this.chargeRing);
    // inner fill disc
    const fillGeo = new THREE.CircleGeometry(0.62, 32);
    this.fillMat = new THREE.MeshBasicMaterial({
      color: 0xffc078, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.fillDisc = new THREE.Mesh(fillGeo, this.fillMat);
    this.fillDisc.rotation.x = -Math.PI / 2;
    this.fillDisc.position.y = 0.01;
    this.chargeGroup.add(this.fillDisc);
    scene.add(this.chargeGroup);

    // ambient "sound" particles that orbit while charging
    this.particles = [];
    for (let i = 0; i < 18; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.glowTex, color: 0xffe2b0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      s.scale.setScalar(0.3);
      scene.add(s);
      this.particles.push({ sprite: s, angle: (i / 18) * TAU, r: 1.4 + Math.random(), sv: 0.6 + Math.random() * 0.8 });
    }
  }

  startCharge() {
    if (this.cooldown > 0) return false;
    this.charging = true;
    this.charge = Math.min(this.charge, 0.02);
    return true;
  }

  release(player, enemies, ctx) {
    if (!this.charging) return null;
    this.charging = false;
    const c = this.charge;
    this.charge = 0;
    this.cooldown = 0.22;

    let kind, radius, damage, knock;
    if (c < 0.34) { kind = 'breathe'; radius = 8.5; damage = 0.6; knock = 7.0; }
    else if (c < 0.78) { kind = 'tune'; radius = 13.0; damage = 2.2; knock = 4.5; }
    else { kind = 'ninth'; radius = 19.0; damage = 4.5; knock = 9.5; }
    this.syllable = kind;

    this.spawnRing(player.pos, radius, kind);
    if (this.preset.quality !== 'potato') ctx.shake?.(kind === 'ninth' ? 0.34 : 0.16);

    const hits = [];
    for (const e of enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - player.pos.x, e.pos.z - player.pos.z);
      if (d > radius + 0.8) continue;
      const falloff = 1 - smoothstep(radius * 0.35, radius, d);
      const marked = this.marks.has(e) && this.marks.get(e) > 0;
      let dmg = damage * (0.55 + falloff * 0.85);
      if (kind === 'ninth') dmg *= 1.35;
      if (marked) { dmg *= 1.9; this.marks.delete(e); }
      // wraiths are weakened by light/sound, husks resist unless stunned
      if (e.type === 'siltWraith') dmg *= 1.35;
      if (e.type === 'choirHusk' && kind !== 'ninth') dmg *= 0.55;
      const dir = { x: (e.pos.x - player.pos.x) / (d || 1), z: (e.pos.z - player.pos.z) / (d || 1) };
      const killed = e.hurt(dmg, dir);
      e.vel.x += dir.x * knock * falloff;
      e.vel.z += dir.z * knock * falloff;
      if (kind === 'ninth' && e.type === 'choirHusk') { e.state = 'stagger'; e.stateT = 0; }
      if (kind === 'tune' && !killed) this.marks.set(e, 4.5);
      hits.push({ enemy: e, killed, damage: dmg });
    }

    this.combo = hits.length > 0 ? this.combo + 1 : 0;
    this.comboTimer = 3.5;
    ctx.onHymn?.(kind, hits, radius, player.pos);
    return { kind, hits, radius };
  }

  spawnRing(pos, radius, kind) {
    const geo = new THREE.PlaneGeometry(radius * 2.2, radius * 2.2);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uProgress: { value: 0 },
        uColor: { value: new THREE.Color(kind === 'ninth' ? 0xffe6a0 : kind === 'tune' ? 0xc8f0ff : 0xdfe8e0) },
        uAlpha: { value: 0.85 },
      },
      vertexShader: RING_VERT, fragmentShader: RING_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, terrainHeight(pos.x, pos.z) + 0.35, pos.z);
    this.scene.add(mesh);
    this.rings.push({ mesh, mat, t: 0, life: kind === 'ninth' ? 1.1 : 0.7 });
  }

  update(dt, player, ctx) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer <= 0) this.combo = 0;

    // charge accumulates while held
    const chargeRate = 1 / (C.singChargeTime * (ctx.verseCharm ? 0.7 : 1));
    if (this.charging) {
      this.charge = Math.min(1, this.charge + dt * chargeRate);
      // slow the player slightly while singing: commitment
      ctx.onCharge?.(this.charge);
    }

    // rings expand and fade
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const u = clamp(r.t / r.life);
      r.mat.uniforms.uProgress.value = u;
      r.mat.uniforms.uTime.value = r.t;
      r.mat.uniforms.uAlpha.value = 0.9 * (1 - u * u);
      if (u >= 1) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        r.mat.dispose();
        this.rings.splice(i, 1);
      }
    }

    // charge visual
    const show = this.charging ? 1 : 0;
    const y = player.pos.y + 0.06;
    this.chargeGroup.position.set(player.pos.x, y, player.pos.z);
    this.chargeRing.rotation.z += dt * (1 + this.charge * 4);
    this.chargeMat.opacity = lerp(this.chargeMat.opacity, show * 0.8, dt * 10);
    this.fillMat.opacity = lerp(this.fillMat.opacity, show * (0.10 + this.charge * 0.28), dt * 10);
    const s = 0.75 + this.charge * 0.55;
    this.chargeGroup.scale.setScalar(s);
    const hue = this.charge > 0.78 ? 0xffe6a0 : this.charge > 0.34 ? 0xc8f0ff : 0xdfe8e0;
    this.chargeMat.color.setHex(hue);
    this.fillMat.color.setHex(hue);

    // orbiting sound motes
    for (const p of this.particles) {
      p.angle += dt * (0.9 + this.charge * 3.2);
      const targetR = this.charging ? 1.1 + this.charge * 1.5 : 2.6;
      p.r = lerp(p.r, targetR, dt * 4);
      p.sprite.position.set(
        player.pos.x + Math.cos(p.angle) * p.r,
        player.pos.y + 0.4 + Math.sin(p.angle * 2.2) * (0.5 + this.charge * 0.7),
        player.pos.z + Math.sin(p.angle) * p.r,
      );
      p.sprite.material.opacity = lerp(p.sprite.material.opacity, this.charging ? 0.35 + this.charge * 0.5 : 0, dt * 6);
      p.sprite.scale.setScalar(0.18 + this.charge * 0.3);
    }

    // decay marks
    for (const [e, t] of this.marks) {
      const nt = t - dt;
      if (nt <= 0 || !e.alive) this.marks.delete(e);
      else this.marks.set(e, nt);
    }
    this.lastLoudness = this.charging ? this.charge : lerp(this.lastLoudness, 0, dt * 6);
  }

  /** Called by the game each frame to sync mark visuals onto enemy meshes. */
  applyMarkVisuals() {
    for (const [e, t] of this.marks) {
      if (e.markSprite) {
        e.markSprite.visible = true;
        e.markSprite.material.opacity = clamp(t / 1.2) * 0.8;
      }
    }
  }
}

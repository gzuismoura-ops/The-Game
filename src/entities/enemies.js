// Y'SMARA — the Mutes.
// Four creature archetypes with genuinely different silhouettes, movement and threat:
//   Mute Hound   — fast quadruped, lunges, telegraphs with a shoulder dip
//   Silt Wraith  — floats, phases in/out of the silt, weak to light
//   Choir Husk   — slow armoured singer, ranged "silence" shockwave
//   Echo Eater   — skittish thief that steals memory echoes and must be chased down
import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, TAU, makeRng, rngRange, dist2d, angleDelta } from '../core/math.js';
import { CREATURE_TYPES, terrainHeight, waterDepthAt } from '../world/world.js';
import { glowTexture } from '../world/textures.js';

const glowTex = () => glowTexture();

function baseMat(color, rough = 0.9, emissive = 0x000000, emInt = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.04, emissive, emissiveIntensity: emInt, flatShading: true });
}

// ---------------------------------------------------------------------------------------------
// MESH BUILDERS
// ---------------------------------------------------------------------------------------------
function buildHound(preset) {
  const g = new THREE.Group();
  const skin = baseMat(0x5d6268, 0.86, 0x0d3a38, 0.5);
  const plate = baseMat(0x8a9096, 0.62);
  const glowMat = new THREE.MeshBasicMaterial({ color: 0x6ff0dc });

  // body: elongated, ridged
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), skin);
  body.scale.set(0.85, 0.72, 1.5);
  body.castShadow = preset.shadows;
  g.add(body);
  // spine ridges
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.34, 4), plate);
    s.position.set(0, 0.40 - i * 0.02, -0.55 + i * 0.28);
    s.rotation.x = -0.22;
    s.castShadow = preset.shadows;
    g.add(s);
  }
  // head: wedge with a split jaw
  const head = new THREE.Group();
  head.position.set(0, 0.24, 0.82);
  const skull = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.66, 5), skin);
  skull.rotation.x = Math.PI / 2;
  skull.scale.set(1, 1, 0.8);
  head.add(skull);
  const jaw = new THREE.Mesh(new THREE.ConeGeometry(0.20, 0.44, 5), plate);
  jaw.rotation.x = Math.PI / 2;
  jaw.position.set(0, -0.14, 0.12);
  head.add(jaw);
  // glowing throat (silenced voice)
  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6), glowMat);
  throat.position.set(0, -0.04, 0.18);
  head.add(throat);
  for (const ex of [-0.13, 0.13]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 5), glowMat);
    eye.position.set(ex, 0.07, 0.16);
    head.add(eye);
  }
  g.add(head);
  g.userData.head = head;

  // legs: four thin angular limbs, animated
  const legs = [];
  for (let i = 0; i < 4; i++) {
    const leg = new THREE.Group();
    const x = i % 2 === 0 ? -0.30 : 0.30;
    const z = i < 2 ? 0.5 : -0.5;
    leg.position.set(x, -0.1, z);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.42, 5), skin);
    upper.position.y = -0.21;
    leg.add(upper);
    const lower = new THREE.Group();
    lower.position.y = -0.42;
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.38, 5), plate);
    shin.position.y = -0.19;
    lower.add(shin);
    const paw = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.16, 4), plate);
    paw.position.set(0, -0.40, 0.04);
    paw.rotation.x = Math.PI / 2;
    lower.add(paw);
    leg.add(lower);
    g.add(leg);
    legs.push({ leg, lower, phase: i < 2 ? 0 : Math.PI });
  }
  g.userData.legs = legs;
  // tail: stiff bone whip
  const tail = new THREE.Group();
  tail.position.set(0, 0.16, -0.82);
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.06 - i * 0.012, 0.05 - i * 0.011, 0.22, 4), plate);
    seg.position.set(0, 0, -0.16 - i * 0.2);
    seg.rotation.x = Math.PI / 2;
    tail.add(seg);
  }
  g.add(tail);
  g.userData.tail = tail;
  return { group: g, height: 1.1 };
}

function buildWraith(preset) {
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({
    color: 0x596a72, roughness: 0.95, transparent: true, opacity: 0.78,
    side: THREE.DoubleSide, emissive: 0x163a44, emissiveIntensity: 0.55, flatShading: false,
  });
  // a tattered funnel of cloth: lathe with noise displacement
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.08 + Math.sin(t * Math.PI * 0.85) * 0.52 + t * 0.16, t * 2.1));
  }
  const lathe = new THREE.LatheGeometry(pts, 14, 0, TAU);
  const pos = lathe.attributes.position;
  const rng = makeRng(4411);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = clamp(y / 2.1);
    const d = 1 + (rng() - 0.5) * 0.24 * (1 - t);
    pos.setXYZ(i, x * d, y, z * d);
  }
  lathe.computeVertexNormals();
  const robe = new THREE.Mesh(lathe, cloth);
  robe.castShadow = false;
  g.add(robe);
  g.userData.robe = robe;

  // hood cavity + two cold lights
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8, 0, TAU, 0, Math.PI * 0.6), cloth);
  hood.position.y = 1.95;
  g.add(hood);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x9be0ff });
  for (const ex of [-0.10, 0.10]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.038, 6, 5), eyeMat);
    e.position.set(ex, 1.94, 0.20);
    g.add(e);
  }
  // sinking tendrils
  g.userData.tendrils = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const t = new THREE.Mesh(new THREE.ConeGeometry(0.07, 1.1, 4), cloth);
    t.position.set(Math.cos(a) * 0.44, 0.25, Math.sin(a) * 0.44);
    t.rotation.x = Math.PI;
    g.add(t);
    g.userData.tendrils.push(t);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color: 0x83d8ff, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.position.y = 2.0; glow.scale.setScalar(1.8);
  g.add(glow);
  return { group: g, height: 2.2 };
}

function buildHusk(preset) {
  const g = new THREE.Group();
  const shell = baseMat(0x8a7a62, 0.95, 0x3a1f0a, 0.25);
  const bronze = new THREE.MeshStandardMaterial({ color: 0x7a5c34, roughness: 0.5, metalness: 0.7 });
  // squat, armoured barrel body
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.78, 1.15, 9, 3), shell);
  body.position.y = 0.95;
  body.castShadow = preset.shadows;
  g.add(body);
  // rib plates
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.66 - i * 0.03, 0.055, 5, 12, Math.PI * 0.95), bronze);
    r.rotation.x = Math.PI / 2;
    r.rotation.z = Math.PI * 0.02;
    r.position.y = 0.55 + i * 0.26;
    g.add(r);
  }
  // head: a bell / singer's mask
  const head = new THREE.Group();
  head.position.y = 1.72;
  const bell = new THREE.Mesh(new THREE.LatheGeometry((() => {
    const p = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      p.push(new THREE.Vector2(0.10 + Math.sin(t * Math.PI * 0.9) * 0.42, t * 0.72));
    }
    return p;
  })(), 16), bronze);
  bell.rotation.x = Math.PI;
  head.add(bell);
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0xffb055, transparent: true, opacity: 0.8 });
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.15, 10), mouthMat);
  mouth.position.set(0, -0.30, 0.30);
  mouth.rotation.x = -0.4;
  head.add(mouth);
  g.add(head);
  g.userData.head = head;

  // arms: two heavy bronze fists on chains
  g.userData.arms = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 0.72, 1.35, 0);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.66, 5), bronze);
    chain.position.y = -0.33;
    arm.add(chain);
    const fist = new THREE.Mesh(new THREE.DodecahedronGeometry(0.24, 0), shell);
    fist.position.y = -0.72;
    fist.castShadow = preset.shadows;
    arm.add(fist);
    g.add(arm);
    g.userData.arms.push(arm);
  }
  // legs: stump-like
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.42, 6), shell);
    leg.position.set(s * 0.26, 0.21, 0);
    g.add(leg);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color: 0xffb055, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.position.y = 1.7; glow.scale.setScalar(2.0);
  g.add(glow);
  return { group: g, height: 2.2 };
}

function buildEater(preset) {
  const g = new THREE.Group();
  const body = baseMat(0x3d4652, 0.7, 0x2a1a3a, 0.6);
  // a small, quick thing with a huge mouth and too many legs
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.30, 9, 8), body);
  torso.scale.set(1, 0.85, 1.2);
  torso.position.y = 0.46;
  g.add(torso);
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 7), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
  mouth.scale.set(1.5, 1.0, 0.55);
  mouth.position.set(0, 0.44, 0.26);
  g.add(mouth);
  const legs = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const leg = new THREE.Group();
    leg.position.set(Math.cos(a) * 0.24, 0.34, Math.sin(a) * 0.30);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.02, 0.44, 4), body);
    seg.position.y = -0.16;
    leg.add(seg);
    g.add(leg);
    legs.push({ node: leg, angle: a, phase: i * 1.05 });
  }
  g.userData.legs = legs;
  for (const ex of [-0.09, 0.06]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 4), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    e.position.set(ex, 0.58, 0.16);
    g.add(e);
  }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex(), color: 0xffd27a, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.position.y = 0.5; glow.scale.setScalar(1.1);
  g.add(glow);
  return { group: g, height: 0.9 };
}

const BUILDERS = { muteHound: buildHound, siltWraith: buildWraith, choirHusk: buildHusk, echoEater: buildEater };

// ---------------------------------------------------------------------------------------------
// ENEMY ENTITY
// ---------------------------------------------------------------------------------------------
export class Enemy {
  constructor(type, x, z, preset, rng) {
    this.type = type;
    this.def = CREATURE_TYPES[type];
    this.hp = this.def.hp;
    this.maxHp = this.def.hp;
    this.alive = true;
    this.preset = preset;
    const built = BUILDERS[type](preset);
    this.mesh = built.group;
    this.height = built.height;
    this.root = new THREE.Group();
    this.root.add(this.mesh);
    this.pos = new THREE.Vector3(x, terrainHeight(x, z), z);
    this.home = { x, z };
    this.vel = new THREE.Vector3();
    this.yaw = rng ? rng() * TAU : 0;
    this.state = 'idle';      // idle | alert | chase | attack | hurt | stagger | dead | flee | burrow
    this.stateT = 0;
    this.attackCd = 0;
    this.hurtFlash = 0;
    this.phase = rng ? rng() * TAU : 0;
    this.bobT = 0;
    this.carrying = null;      // for echo eaters
    this.stolenEcho = null;
    this.aggro = false;
    this.leash = dist2d(x, z, this.home.x, this.home.z);
    this.root.position.copy(this.pos);
    this.deadT = 0;
  }

  get isRanged() { return this.type === 'choirHusk'; }
  get isPhasing() { return this.type === 'siltWraith'; }

  /**
   * @param dt delta
   * @param player the player entity
   * @param ctx { onAttack(enemy, damage, dir), onRanged(enemy, pos, dir), canSee(enemy,player), time }
   */
  update(dt, player, ctx) {
    if (!this.alive) {
      this.deadT += dt;
      this.mesh.rotation.z = lerp(this.mesh.rotation.z, Math.PI * 0.5, dt * 4);
      this.mesh.position.y = lerp(this.mesh.position.y, -this.height * 0.35, dt * 3);
      this.root.position.y = this.pos.y;
      return;
    }
    this.stateT += dt;
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.bobT += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3.4);
    this.phase += dt;

    const toP = { x: player.pos.x - this.pos.x, z: player.pos.z - this.pos.z };
    const distP = Math.hypot(toP.x, toP.z);
    const aggroRange = this.def.aggro;
    const playerVisible = ctx.canSee?.(this, player) ?? true;

    // ---- simple state machine with distinct feel per archetype
    if (this.state === 'dead') return;

    if (this.state === 'idle') {
      this.vel.x = damp(this.vel.x, 0, 4, dt);
      this.vel.z = damp(this.vel.z, 0, 4, dt);
      // idle wander around the spawn zone
      const wander = Math.sin(this.phase * 0.35) * 0.6 + Math.cos(this.phase * 0.21) * 0.4;
      this.yaw += wander * dt * 0.4;
      if (distP < aggroRange && playerVisible && !player.dead) {
        this.state = 'alert'; this.stateT = 0;
      }
    } else if (this.state === 'alert') {
      // telegraph: rear back / rise / raise arms before pouncing
      this.yaw += angleDelta(this.yaw, Math.atan2(toP.x, toP.z)) * clamp(dt * 3.2);
      const dur = this.type === 'muteHound' ? 0.42 : this.type === 'echoEater' ? 0.3 : 0.6;
      if (this.stateT > dur) { this.state = 'chase'; this.stateT = 0; }
    } else if (this.state === 'chase') {
      const speed = this.def.speed * (this.type === 'echoEater' ? 1.0 : 1.0);
      const dirX = toP.x / (distP || 1), dirZ = toP.z / (distP || 1);
      let sp = speed;
      // wading slows creatures too
      const wd = waterDepthAt(this.pos.x, this.pos.z);
      if (wd > 0.3) sp *= 0.62;
      // stop short at attack range
      const stopAt = this.type === 'muteHound' ? 1.5 : this.type === 'choirHusk' ? 7.5 : this.type === 'echoEater' ? 0.9 : 2.0;
      if (distP < stopAt) { this.state = 'attack'; this.stateT = 0; }
      else {
        this.vel.x = damp(this.vel.x, dirX * sp, 6, dt);
        this.vel.z = damp(this.vel.z, dirZ * sp, 6, dt);
        this.yaw += angleDelta(this.yaw, Math.atan2(dirX, dirZ)) * clamp(dt * 6);
      }
      // leash back home if the player runs far
      const homeDist = dist2d(this.pos.x, this.pos.z, this.home.x, this.home.z);
      if (homeDist > 58 || player.dead) { this.state = 'idle'; this.stateT = 0; this.aggro = false; }
    } else if (this.state === 'attack') {
      this.vel.x = damp(this.vel.x, 0, 10, dt);
      this.vel.z = damp(this.vel.z, 0, 10, dt);
      const windup = this.type === 'muteHound' ? 0.34 : this.type === 'choirHusk' ? 0.95 : this.type === 'echoEater' ? 0.2 : 0.5;
      const recover = this.type === 'muteHound' ? 0.42 : this.type === 'choirHusk' ? 1.1 : 0.35;
      if (this.stateT < windup) {
        // telegraph pose handled in animate()
      } else if (this.attackCd <= 0) {
        // strike
        if (this.type === 'choirHusk') {
          ctx.onRanged?.(this, this.pos.clone().add(new THREE.Vector3(0, 1.4, 0)), { x: toP.x / (distP || 1), z: toP.z / (distP || 1) });
        } else if (distP < (this.type === 'muteHound' ? 2.6 : 2.4)) {
          const dmg = this.type === 'muteHound' ? 14 : this.type === 'echoEater' ? 2 : 18;
          ctx.onAttack?.(this, dmg, { x: toP.x / (distP || 1), z: toP.z / (distP || 1) });
          if (this.type === 'muteHound') {
            // lunge through the player
            this.vel.x = (toP.x / (distP || 1)) * 8;
            this.vel.z = (toP.z / (distP || 1)) * 8;
          }
        }
        this.attackCd = recover + (this.type === 'muteHound' ? 0.25 : 0.6);
        this.state = 'chase'; this.stateT = 0;
      }
      if (distP > this.def.aggro * 1.3) { this.state = 'chase'; this.stateT = 0; }
    } else if (this.state === 'stagger') {
      this.vel.x = damp(this.vel.x, 0, 8, dt);
      this.vel.z = damp(this.vel.z, 0, 8, dt);
      if (this.stateT > 0.34) { this.state = 'chase'; this.stateT = 0; }
    }

    // ---- integrate + ground follow
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const gh = terrainHeight(this.pos.x, this.pos.z);
    const wd = waterDepthAt(this.pos.x, this.pos.z);
    let targetY = gh;
    if (this.type === 'siltWraith') targetY = gh + 0.5 + Math.sin(this.bobT * 1.7 + this.phase) * 0.18;
    else if (this.type === 'echoEater') targetY = gh + Math.abs(Math.sin(this.bobT * 7.5)) * 0.12;
    else targetY = gh;
    this.pos.y = damp(this.pos.y, targetY, 12, dt);

    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.animate(dt, distP);
  }

  animate(dt, distP) {
    const m = this.mesh;
    const t = this.bobT + this.phase;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const moveAmt = clamp(speed / (this.def.speed || 1));
    this.mesh.scale.setScalar(1 + this.hurtFlash * 0.06);

    if (this.type === 'muteHound') {
      const legs = m.userData.legs;
      const stride = t * (6 + moveAmt * 9);
      legs.forEach((l, i) => {
        const ph = stride + l.phase;
        l.leg.rotation.x = Math.sin(ph) * (0.5 + moveAmt * 0.5);
        l.lower.rotation.x = Math.max(0, Math.cos(ph)) * 0.7 * moveAmt;
      });
      // body bob & head bob
      m.position.y = Math.abs(Math.sin(stride * 0.5)) * 0.06 * moveAmt;
      const head = m.userData.head;
      if (this.state === 'alert') {
        head.position.y = 0.24 + Math.sin(this.stateT * 22) * 0.03;
        head.rotation.x = -0.35;
      } else {
        head.rotation.x = damp(head.rotation.x, this.state === 'attack' ? 0.3 : 0.0, 8, dt);
        head.position.y = 0.24 + Math.sin(stride) * 0.02;
      }
      m.userData.tail.rotation.y = Math.sin(t * 5) * 0.35;
    } else if (this.type === 'siltWraith') {
      m.rotation.y = Math.sin(t * 0.6) * 0.18;
      m.userData.robe.scale.set(1 + Math.sin(t * 1.4) * 0.05, 1 + Math.sin(t * 1.1) * 0.04, 1 + Math.cos(t * 1.3) * 0.05);
      m.userData.tendrils.forEach((td, i) => {
        td.rotation.z = Math.sin(t * 2.2 + i) * 0.24;
        td.position.y = 0.25 + Math.sin(t * 1.7 + i * 1.1) * 0.09;
      });
      // phase out when hurt → becomes translucent
      const targetOpacity = this.state === 'stagger' ? 0.32 : 0.78;
      m.userData.robe.material.opacity = damp(m.userData.robe.material.opacity, targetOpacity, 6, dt);
    } else if (this.type === 'choirHusk') {
      const head = m.userData.head;
      const windup = this.state === 'attack' && this.stateT < 0.95;
      head.rotation.x = damp(head.rotation.x, windup ? -0.5 : 0.0, 7, dt);
      head.scale.setScalar(1 + (windup ? Math.sin(this.stateT * 26) * 0.05 : 0));
      m.userData.arms.forEach((a, i) => {
        const swing = this.state === 'attack' ? Math.sin(clamp(this.stateT / 0.95) * Math.PI) * 1.0 : Math.sin(t * 1.3 + i) * 0.08;
        a.rotation.x = damp(a.rotation.x, -swing, 8, dt);
      });
      m.position.y = Math.abs(Math.sin(t * 2.4)) * 0.03 * moveAmt;
    } else if (this.type === 'echoEater') {
      const legs = m.userData.legs;
      const stride = t * 16;
      legs.forEach((l) => {
        l.node.rotation.x = Math.sin(stride + l.phase) * 0.6;
        l.node.rotation.z = Math.cos(stride + l.phase) * 0.3;
      });
      m.position.y = Math.abs(Math.sin(stride * 0.5)) * 0.05;
    }
    // face the player during attack windups
    if (this.state === 'attack' || this.state === 'alert') {
      // subtle lean toward the target
      m.rotation.x = damp(m.rotation.x, 0.1, 5, dt);
    } else {
      m.rotation.x = damp(m.rotation.x, 0, 5, dt);
    }
  }

  hurt(amount, fromDir) {
    if (!this.alive) return false;
    this.hp -= amount;
    this.hurtFlash = 1;
    if (this.hp <= 0) {
      this.alive = false;
      this.state = 'dead';
      this.mesh.traverse((o) => {
        if (o.material && o.material.transparent !== undefined) {
          // fade out in place; the game will pool/remove after a delay
        }
      });
      return true;
    }
    this.state = 'stagger';
    this.stateT = 0;
    if (fromDir) {
      this.vel.x -= fromDir.x * 3.2;
      this.vel.z -= fromDir.z * 3.2;
    }
    return false;
  }

  dispose(scene) { scene.remove(this.root); }
}

// ---------------------------------------------------------------------------------------------
// MANAGER
// ---------------------------------------------------------------------------------------------
export class EnemySystem {
  constructor(scene, preset) {
    this.scene = scene;
    this.preset = preset;
    this.enemies = [];
    this.group = new THREE.Group();
    this.group.name = 'enemies';
    scene.add(this.group);
    this.rng = makeRng(0xbeef);
    this.maxActive = preset.quality === 'potato' ? 8 : preset.quality === 'low' ? 14 : 26;
    this.killCount = 0;
  }

  spawnZone(zone) {
    for (let i = 0; i < zone.count; i++) {
      const a = this.rng() * TAU;
      const r = Math.sqrt(this.rng()) * zone.r;
      const x = zone.x + Math.cos(a) * r;
      const z = zone.z + Math.sin(a) * r;
      const e = new Enemy(zone.type, x, z, this.preset, this.rng);
      this.group.add(e.root);
      this.enemies.push(e);
    }
  }

  spawnAll(zones) { for (const z of zones) this.spawnZone(z); }

  update(dt, player, ctx) {
    // distance-based activation keeps draw calls and logic cheap on phones
    for (const e of this.enemies) {
      if (!e.alive) {
        e.update(dt, player, ctx);
        continue;
      }
      const d = dist2d(e.pos.x, e.pos.z, player.pos.x, player.pos.z);
      e.root.visible = d < 165;
      if (d > 190) { e.state = 'idle'; continue; }
      e.update(dt, player, ctx);
    }
    // recycle long-dead corpses
    this.enemies = this.enemies.filter((e) => {
      if (e.alive || e.deadT < 6) return true;
      this.group.remove(e.root);
      return false;
    });
  }

  aliveNear(x, z, r) {
    return this.enemies.filter((e) => e.alive && dist2d(e.pos.x, e.pos.z, x, z) < r);
  }

  nearestAlive(x, z, r) {
    let best = null, bd = r;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = dist2d(e.pos.x, e.pos.z, x, z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
}

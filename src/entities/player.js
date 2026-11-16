// Y'SMARA — Aru, the Listener.
// A procedurally sculpted character (no external model): robed wanderer with a listening horn,
// layered cloth that sways, a lantern on the hip, and a fully procedural animation rig.
import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep, TAU } from '../core/math.js';
import { GAME_CONSTANTS as C, terrainHeight, terrainNormal, waterDepthAt } from '../world/world.js';
import { deckHeightAt } from '../world/structures.js';
import { glowTexture } from '../world/textures.js';

function mat(color, rough = 0.8, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05, ...extra });
}

export class Player {
  constructor(preset) {
    this.preset = preset;
    this.root = new THREE.Group();
    this.root.name = 'player';
    this.pos = new THREE.Vector3(0, 20, 0);
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.grounded = true;
    this.hp = C.hpMax;
    this.stamina = C.staminaMax;
    this.sprinting = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.facing = 0;
    this.animTime = 0;
    this.speedNorm = 0;
    this.wading = 0;
    this.attackCooldown = 0;
    this.dodgeTimer = 0;
    this.invuln = 0;
    this.dead = false;
    this.stepPhase = 0;
    this.lastStepSign = 1;
    this.bob = 0;
    this.build();
  }

  build() {
    const p = this.preset;
    const robe = mat(0x4a5560, 0.92);
    const robeDark = mat(0x323b45, 0.95);
    const accent = mat(0xd8b47a, 0.55, { metalness: 0.35 });
    const skin = mat(0xb08a6a, 0.75);
    const wrap = mat(0x8e3f3a, 0.88);
    const leather = mat(0x4a3a2a, 0.9);

    // --- hips / root of the visual hierarchy
    this.hips = new THREE.Group();
    this.hips.position.y = 0.92;
    this.root.add(this.hips);

    // torso: tapered, slightly hunched
    const torsoGeo = new THREE.CylinderGeometry(0.20, 0.26, 0.62, 10, 4);
    const tp = torsoGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      const bulge = 1 + Math.cos((y / 0.62) * Math.PI) * 0.12;
      tp.setXYZ(i, tp.getX(i) * bulge, y, tp.getZ(i) * (0.78 * bulge));
    }
    torsoGeo.computeVertexNormals();
    this.torso = new THREE.Mesh(torsoGeo, robe);
    this.torso.position.y = 0.30;
    this.torso.castShadow = p.shadows;
    this.hips.add(this.torso);

    // chest wrap / sash
    const sash = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.045, 6, 14), wrap);
    sash.rotation.x = Math.PI / 2;
    sash.position.y = 0.52;
    this.hips.add(sash);

    // shoulders
    this.shoulderL = new THREE.Group(); this.shoulderR = new THREE.Group();
    this.shoulderL.position.set(-0.235, 0.56, 0);
    this.shoulderR.position.set(0.235, 0.56, 0);
    this.hips.add(this.shoulderL, this.shoulderR);

    const armGeo = new THREE.CylinderGeometry(0.055, 0.07, 0.46, 6, 3);
    armGeo.translate(0, -0.23, 0);
    for (const [sh, side] of [[this.shoulderL, -1], [this.shoulderR, 1]]) {
      const upper = new THREE.Mesh(armGeo, robe);
      upper.castShadow = p.shadows;
      sh.add(upper);
      const fore = new THREE.Group();
      fore.position.y = -0.46;
      sh.add(fore);
      const fg = new THREE.CylinderGeometry(0.045, 0.055, 0.40, 6, 3);
      fg.translate(0, -0.20, 0);
      const fm = new THREE.Mesh(fg, robeDark);
      fm.castShadow = p.shadows;
      fore.add(fm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 6), skin);
      hand.position.y = -0.42;
      fore.add(hand);
      if (side < 0) { this.foreL = fore; this.handL = hand; } else { this.foreR = fore; this.handR = hand; }
    }

    // --- head + hood
    this.head = new THREE.Group();
    this.head.position.y = 0.70;
    this.hips.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skin);
    skull.scale.set(1, 1.08, 1);
    skull.castShadow = p.shadows;
    this.head.add(skull);
    // hood: an open cone shell behind the head
    const hoodGeo = new THREE.SphereGeometry(0.155, 12, 10, 0, TAU, 0, Math.PI * 0.62);
    const hood = new THREE.Mesh(hoodGeo, robeDark);
    hood.position.z = 0.012;
    hood.rotation.x = -0.22;
    hood.castShadow = p.shadows;
    this.head.add(hood);
    // face mask (the Listener's veil) with two small glowing eye slits
    const mask = new THREE.Mesh(new THREE.SphereGeometry(0.118, 10, 8, 0, Math.PI * 0.62), mat(0x2b3038, 0.7));
    mask.rotation.y = Math.PI / 2;
    mask.position.z = 0.012;
    this.head.add(mask);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    for (const ex of [-0.042, 0.042]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), eyeMat);
      eye.position.set(ex, 0.012, 0.108);
      this.head.add(eye);
    }

    // --- listening horn (the Listener's instrument) on the back
    this.horn = new THREE.Group();
    this.horn.position.set(0.0, 0.46, -0.20);
    this.horn.rotation.set(0.35, 0, 0.42);
    const hornGeo = new THREE.TorusGeometry(0.19, 0.035, 6, 16, Math.PI * 1.35);
    const hornMesh = new THREE.Mesh(hornGeo, accent);
    hornMesh.castShadow = p.shadows;
    this.horn.add(hornMesh);
    this.hips.add(this.horn);

    // --- skirt: layered cloth panels that swing with movement
    this.skirt = new THREE.Group();
    this.skirt.position.y = 0.02;
    this.hips.add(this.skirt);
    this.skirtPanels = [];
    const panelCount = 8;
    for (let i = 0; i < panelCount; i++) {
      const a = (i / panelCount) * TAU;
      const g = new THREE.PlaneGeometry(0.17, 0.72, 1, 5);
      g.translate(0, -0.36, 0);
      const m = new THREE.Mesh(g, i % 3 === 0 ? robeDark : robe);
      m.position.set(Math.cos(a) * 0.20, 0, Math.sin(a) * 0.16);
      m.rotation.y = -a + Math.PI / 2;
      m.castShadow = p.shadows;
      m.userData.baseRot = m.rotation.x;
      m.userData.angle = a;
      this.skirt.add(m);
      this.skirtPanels.push(m);
    }

    // --- legs
    this.legL = new THREE.Group(); this.legR = new THREE.Group();
    this.legL.position.set(-0.095, -0.02, 0);
    this.legR.position.set(0.095, -0.02, 0);
    this.hips.add(this.legL, this.legR);
    const legGeo = new THREE.CylinderGeometry(0.058, 0.05, 0.86, 6, 3);
    legGeo.translate(0, -0.43, 0);
    for (const [lg, nm] of [[this.legL, 'L'], [this.legR, 'R']]) {
      const thigh = new THREE.Mesh(legGeo, robeDark);
      thigh.castShadow = p.shadows;
      lg.add(thigh);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.075, 0.24), leather);
      foot.position.set(0, -0.88, 0.04);
      foot.castShadow = p.shadows;
      lg.add(foot);
      if (nm === 'L') this.footL = foot; else this.footR = foot;
    }

    // --- hip lantern (warm glow; Vela's beacon)
    this.lantern = new THREE.Group();
    this.lantern.position.set(0.26, 0.02, 0.10);
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.13, 6), mat(0x3a2f22, 0.9));
    this.lantern.add(cage);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xffc070, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.setScalar(1.1);
    this.lanternGlow = glow;
    this.lantern.add(glow);
    if (this.preset.quality !== 'potato') {
      this.lanternLight = new THREE.PointLight(0xffb266, 1.5, 9, 2.2);
      this.lantern.add(this.lanternLight);
    }
    this.hips.add(this.lantern);

    // --- Vela, the cinderwing (small companion bird that circles Aru)
    this.vela = this.buildVela();
    this.root.add(this.vela);

    // shadow-catcher blob under the player for grounding (cheap, always reads on mobile)
    const blobGeo = new THREE.CircleGeometry(0.42, 12);
    blobGeo.rotateX(-Math.PI / 2);
    this.blob = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false,
    }));
    this.blob.renderOrder = 4;
    this.root.add(this.blob);

    this.root.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  }

  buildVela() {
    const g = new THREE.Group();
    const bodyMat = mat(0xd8722e, 0.7, { emissive: 0x5a1c00, emissiveIntensity: 0.5 });
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xff9a4a, roughness: 0.6, side: THREE.DoubleSide,
      emissive: 0xff6a1e, emissiveIntensity: 0.55, transparent: true, opacity: 0.92,
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 7), bodyMat);
    body.scale.set(1, 0.85, 1.5);
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 7, 6), bodyMat);
    head.position.set(0, 0.045, 0.10);
    g.add(head);
    // beak
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.07, 4), mat(0xffd08a, 0.5));
    beak.position.set(0, 0.04, 0.16);
    beak.rotation.x = Math.PI / 2;
    g.add(beak);
    // wings: two triangles that flap
    this.velaWings = [];
    for (const s of [-1, 1]) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0, 0.05, s * 0.30, 0.02, -0.02, 0, 0, -0.10,
      ], 3));
      wg.computeVertexNormals();
      const w = new THREE.Mesh(wg, wingMat);
      w.userData.side = s;
      g.add(w);
      this.velaWings.push(w);
    }
    // tail plume
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.16, 4), bodyMat);
    tail.position.set(0, 0.01, -0.16);
    tail.rotation.x = -Math.PI / 2 - 0.3;
    g.add(tail);
    // ember glow
    const ember = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: 0xff9a50, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    ember.scale.setScalar(0.6);
    g.add(ember);
    g.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    g.userData.phase = 0;
    return g;
  }

  /** Resolve the walkable surface height at a position (terrain, deck or ramp). */
  groundAt(x, z) {
    const t = terrainHeight(x, z);
    const d = deckHeightAt(x, z);
    if (d !== null && d > t) return { y: d, deck: true };
    return { y: t, deck: false };
  }

  /**
   * Move with full collision: terrain slope, water drag, deck edges, prop blockers.
   * `colliders` is a prebuilt array of {x,z,r}.
   */
  update(dt, input, world) {
    if (this.dead) return;
    const { colliders, bounds } = world;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.dodgeTimer = Math.max(0, this.dodgeTimer - dt);

    // ---- desired movement in camera space
    let mx = input.moveX, mz = input.moveZ;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; }
    const camYaw = input.camYaw;
    const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
    // forward is -Z in camera space
    const wx = mx * cosY - mz * sinY;
    const wz = -mx * sinY - mz * cosY;

    const depth = waterDepthAt(this.pos.x, this.pos.z);
    this.wading = clamp(depth / 0.9);
    const wadeMul = 1 - this.wading * 0.55;

    // ---- sprint & stamina
    const wantSprint = input.sprint && !this.sprintingLock && mag > 0.1 && this.stamina > 1;
    this.sprinting = wantSprint && this.grounded;
    if (this.sprinting) this.stamina = Math.max(0, this.stamina - C.sprintDrain * dt);
    else this.stamina = Math.min(C.staminaMax, this.stamina + C.staminaRegen * dt * (this.grounded ? 1 : 0.4));

    let speed = (this.sprinting ? C.sprintSpeed : C.walkSpeed) * wadeMul;
    if (this.dodgeTimer > 0) speed = C.dodgeSpeed;

    // ---- slope-based speed cap: can't run up cliffs
    const nrm = terrainNormal(this.pos.x, this.pos.z);
    const upSlope = clamp(-(nrm.x * wx + nrm.z * wz) * 3.0);
    if (upSlope > C.maxSlopeWalk && this.grounded) speed *= 0.15;
    else if (upSlope > 0.35) speed *= lerp(1, 0.55, smoothstep(0.35, C.maxSlopeWalk, upSlope));

    // ---- velocity with acceleration + drag (responsive but not slippery)
    const targetVX = wx * speed, targetVZ = wz * speed;
    const accel = this.grounded ? 28 : 9;
    this.vel.x = damp(this.vel.x, targetVX, accel, dt);
    this.vel.z = damp(this.vel.z, targetVZ, accel, dt);

    // ---- dodge burst
    if (input.dodge && this.grounded && this.stamina >= C.dodgeCost && this.dodgeTimer <= 0) {
      this.stamina -= C.dodgeCost;
      this.dodgeTimer = C.dodgeTime;
      this.invuln = C.dodgeTime * 0.9;
      const dl = Math.hypot(wx, wz) || 1;
      this.vel.x = (wx / dl) * C.dodgeSpeed;
      this.vel.z = (wz / dl) * C.dodgeSpeed;
    }

    // ---- gravity & jump
    this.coyote = Math.max(0, this.coyote - dt);
    if (input.jump) this.jumpBuffer = 0.14;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vel.y = C.jumpSpeed;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
    }
    this.vel.y -= C.gravity * dt;
    if (this.vel.y < -34) this.vel.y = -34;

    // ---- integrate horizontal, then resolve collisions
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    this.pos.x = nx; this.pos.z = nz;
    this.resolveCollisions(colliders, bounds);

    // ---- vertical
    this.pos.y += this.vel.y * dt;
    const g = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y <= g.y) {
      const impact = -this.vel.y;
      if (impact > C.fallDamageSpeed && !this.dead) {
        this.hp -= Math.min(40, (impact - C.fallDamageSpeed) * 4.2);
        world.onFallDamage?.(impact);
      }
      this.pos.y = g.y;
      this.vel.y = 0;
      this.grounded = true;
      this.coyote = 0.12;
      this.onDeck = g.deck;
    } else {
      if (this.grounded && this.pos.y - g.y > 0.28) this.coyote = 0.12;
      this.grounded = false;
    }

    // ---- facing
    if (mag > 0.08) {
      this.facing = Math.atan2(wx, wz);
    }
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;

    // ---- animation
    this.animTime += dt;
    const horizSpeed = Math.hypot(this.vel.x, this.vel.z);
    this.speedNorm = damp(this.speedNorm, clamp(horizSpeed / C.sprintSpeed), 10, dt);
    this.animate(dt, horizSpeed);

    // ---- footsteps → surface-specific sfx callback
    if (this.grounded && horizSpeed > 0.6) {
      this.stepPhase += dt * (2.4 + horizSpeed * 0.95);
      const s = Math.sign(Math.sin(this.stepPhase * Math.PI));
      if (s !== this.lastStepSign) {
        this.lastStepSign = s;
        world.onFootstep?.(this.pos, this.wading);
      }
    }

    // ---- wading ripple / splash trail
    if (this.wading > 0.05 && horizSpeed > 0.4) world.onWade?.(this.pos, this.wading);
  }

  resolveCollisions(colliders, bounds) {
    const r = C.playerRadius;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      // vertical gate: low obstacles can be stepped over-ish; high ones block
      if (c.y !== undefined && c.y < this.pos.y - this.groundYOffset() + 0.35) continue;
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const minD = c.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD * minD && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (minD - d);
        this.pos.x += (dx / d) * push;
        this.pos.z += (dz / d) * push;
        // kill velocity into the surface
        const vn = (this.vel.x * dx + this.vel.z * dz) / d;
        if (vn < 0) { this.vel.x -= (dx / d) * vn; this.vel.z -= (dz / d) * vn; }
      }
    }
    if (bounds) {
      this.pos.x = clamp(this.pos.x, -bounds + 4, bounds - 4);
      this.pos.z = clamp(this.pos.z, -bounds + 4, bounds - 4);
    }
  }

  groundYOffset() {
    return this.pos.y - this.groundAt(this.pos.x, this.pos.z).y;
  }

  animate(dt, horizSpeed) {
    const t = this.animTime;
    const s = clamp(horizSpeed / C.walkSpeed);
    const breathe = Math.sin(t * 1.6) * 0.012;
    const bobAmt = this.grounded ? Math.abs(Math.sin(this.stepPhase * Math.PI)) * 0.045 * s : 0;
    this.bob = damp(this.bob, bobAmt, 14, dt);
    this.hips.position.y = 0.92 + this.bob + breathe;

    // lean into acceleration, crouch when wading
    const wadeDrop = this.wading * 0.16;
    this.hips.position.y -= wadeDrop;

    // legs swing
    const legSwing = Math.sin(this.stepPhase * Math.PI) * 0.72 * s;
    if (!this.grounded) {
      this.legL.rotation.x = damp(this.legL.rotation.x, -0.45, 10, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, 0.28, 10, dt);
    } else {
      this.legL.rotation.x = damp(this.legL.rotation.x, legSwing, 18, dt);
      this.legR.rotation.x = damp(this.legR.rotation.x, -legSwing, 18, dt);
    }

    // arms counter-swing; left hand steadies the lantern when idle
    const armSwing = Math.sin(this.stepPhase * Math.PI) * 0.55 * s;
    this.shoulderL.rotation.x = damp(this.shoulderL.rotation.x, -armSwing, 14, dt);
    this.shoulderR.rotation.x = damp(this.shoulderR.rotation.x, this.attackCooldown > 0 ? -1.9 : armSwing, 16, dt);
    this.shoulderL.rotation.z = damp(this.shoulderL.rotation.z, 0.10 + this.wading * 0.35, 8, dt);
    this.shoulderR.rotation.z = damp(this.shoulderR.rotation.z, -0.10 - this.wading * 0.35, 8, dt);
    this.foreL.rotation.x = damp(this.foreL.rotation.x, -0.35 - s * 0.25, 10, dt);
    this.foreR.rotation.x = damp(this.foreR.rotation.x, this.attackCooldown > 0 ? -0.5 : -0.25 - s * 0.2, 10, dt);

    // torso counter-rotation for a natural gait
    const twist = Math.sin(this.stepPhase * Math.PI) * 0.10 * s;
    this.hips.rotation.y = damp(this.hips.rotation.y, twist, 12, dt);
    this.head.rotation.y = damp(this.head.rotation.y, -twist * 0.7, 9, dt);
    this.torso.rotation.z = Math.sin(t * 0.9) * 0.012 + s * 0.04;

    // skirt panels: swing from movement + wind
    for (let i = 0; i < this.skirtPanels.length; i++) {
      const panel = this.skirtPanels[i];
      const a = panel.userData.angle;
      const windPush = Math.sin(t * 2.2 + a * 2.0) * 0.06;
      const move_ = Math.sin(this.stepPhase * Math.PI * 2 + a) * 0.14 * s;
      panel.rotation.x = panel.userData.baseRot + windPush + move_ + s * 0.22;
    }

    // lantern sways from momentum
    const swayX = clamp(-this.vel.x * 0.03, -0.4, 0.4);
    const swayZ = clamp(this.vel.z * 0.03, -0.4, 0.4);
    this.lantern.rotation.x = damp(this.lantern.rotation.x, swayZ + Math.sin(t * 3.1) * 0.05, 8, dt);
    this.lantern.rotation.z = damp(this.lantern.rotation.z, swayX + Math.cos(t * 2.7) * 0.05, 8, dt);
    if (this.lanternGlow) {
      const flick = 0.85 + Math.sin(t * 9.3) * 0.06 + Math.sin(t * 23.1) * 0.03;
      this.lanternGlow.material.opacity = flick;
      if (this.lanternLight) this.lanternLight.intensity = 1.3 * flick;
    }

    // horn bobs on the back
    this.horn.rotation.z = 0.42 + Math.sin(t * 1.9) * 0.03 + s * 0.04;

    // ---- Vela's flight: an offset orbit, banking into turns, wings flapping
    const vp = this.vela;
    const phase = t * 0.9;
    const orbitR = 2.5 + Math.sin(t * 0.5) * 0.5;
    const orbitH = 2.0 + Math.sin(t * 0.8) * 0.35;
    const tx = this.pos.x + Math.cos(phase) * orbitR;
    const tz = this.pos.z + Math.sin(phase) * orbitR;
    const ty = this.pos.y + orbitH;
    vp.position.x = damp(vp.position.x, tx, 3.2, dt);
    vp.position.y = damp(vp.position.y, ty, 2.6, dt);
    vp.position.z = damp(vp.position.z, tz, 3.2, dt);
    // face travel direction
    const vdx = vp.position.x - this.pos.x, vdz = vp.position.z - this.pos.z;
    vp.rotation.y = Math.atan2(vdx, vdz);
    vp.rotation.z = Math.sin(phase) * 0.28;
    const flap = Math.sin(t * 13.0) * (0.55 + Math.sin(t * 0.7) * 0.18);
    this.velaWings[0].rotation.z = -flap;
    this.velaWings[1].rotation.z = flap;

    // blob shadow follows the ground beneath the player
    const g = this.groundAt(this.pos.x, this.pos.z);
    this.blob.position.y = (g.y - this.pos.y) + 0.03;
    const airFade = clamp(1 - (this.pos.y - g.y) * 0.18, 0.15, 1);
    this.blob.material.opacity = 0.26 * airFade;
    this.blob.scale.setScalar(1 + (this.pos.y - g.y) * 0.10);
  }

  hurt(amount, fromDir) {
    if (this.invuln > 0 || this.dead) return false;
    this.hp = Math.max(0, this.hp - amount);
    this.invuln = 0.55;
    if (fromDir) {
      this.vel.x += fromDir.x * 4.2;
      this.vel.z += fromDir.z * 4.2;
      this.vel.y = Math.max(this.vel.y, 3.0);
    }
    if (this.hp <= 0) this.dead = true;
    return true;
  }

  heal(amount) { this.hp = Math.min(C.hpMax, this.hp + amount); }
  refillStamina() { this.stamina = C.staminaMax; }
}

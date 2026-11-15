// Y'SMARA — third-person camera.
// Orbit + spring arm with terrain/deck avoidance, aim assist, shake, and cinematic override
// for cutscenes. Tuned for one-thumb play: the camera does the work, the player steers.
import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, angleDelta, TAU, easeInOutCubic } from '../core/math.js';
import { terrainHeight, terrainNormal } from '../world/world.js';
import { GAME_CONSTANTS as C } from '../world/world.js';

export class CameraRig {
  constructor(camera, player) {
    this.camera = camera;
    this.player = player;
    this.yaw = Math.PI;          // looking toward +? (behind player)
    this.pitch = -0.12;
    this.distance = C.cameraDistance;
    this.targetDistance = C.cameraDistance;
    this.height = C.cameraHeight;
    this.pos = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.shakeAmt = 0;
    this.shakeTime = 0;
    this.cinematic = null;
    this.fovBase = 66;
    this.fovTarget = 66;
    this.lockedTarget = null;
    this.smoothTarget = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this.initialized = false;
    this.zoom = 1;
  }

  addShake(amount) { this.shakeAmt = Math.min(0.6, this.shakeAmt + amount); }
  setZoom(z) { this.zoom = clamp(z, 0.55, 1.8); }

  /** Cinematic shot: positions along a keyframe list {pos, look, time, fov} */
  playCinematic(keys, onDone) {
    this.cinematic = { keys, t: 0, onDone, total: keys.reduce((a, k) => a + k.time, 0) };
  }
  stopCinematic() { this.cinematic = null; }

  update(dt, input, world) {
    const p = this.player;
    // ---- orbit input (right side of screen / drag)
    if (input.camDX || input.camDY) {
      this.yaw -= input.camDX * 0.0042;
      this.pitch = clamp(this.pitch - input.camDY * 0.0032, -0.95, 0.62);
    }
    if (input.pinch) {
      this.setZoom(this.zoom * input.pinch);
    }

    // ---- auto-follow: gently swing behind the player while moving, if the user isn't dragging
    if (!input.camHold && Math.hypot(p.vel.x, p.vel.z) > 1.6) {
      const moveYaw = Math.atan2(p.vel.x, p.vel.z);
      const desired = moveYaw + Math.PI;
      const diff = angleDelta(this.yaw, desired);
      const strength = smoothstep(0.6, 2.5, Math.hypot(p.vel.x, p.vel.z)) * 0.9;
      this.yaw += diff * clamp(strength * dt * 1.1, 0, 1);
    }

    if (this.cinematic) return this.updateCinematic(dt);

    // ---- target point: slightly above the player's hips, with a look-ahead
    const lead = 0.34;
    const targetX = p.pos.x + p.vel.x * lead * 0.4;
    const targetZ = p.pos.z + p.vel.z * lead * 0.4;
    let targetY;
    const pitchLift = Math.sin(this.pitch) * 1.1;
    targetY = p.pos.y + 1.55 - pitchLift * 0.5;
    // ground-clamped so the camera never dives under the terrain
    const gY = Math.max(terrainHeight(targetX, targetZ), p.onDeck ? p.pos.y : -999) + 0.55;
    targetY = Math.max(targetY, gY);

    const wants = this._tmp.set(targetX, targetY, targetZ);
    if (!this.initialized) { this.smoothTarget.copy(wants); this.initialized = true; }
    this.smoothTarget.x = damp(this.smoothTarget.x, wants.x, 12, dt);
    this.smoothTarget.y = damp(this.smoothTarget.y, wants.y, 8, dt);
    this.smoothTarget.z = damp(this.smoothTarget.z, wants.z, 12, dt);

    // ---- sprint pulls the camera back for a sense of speed
    const sprintPull = p.sprinting ? 0.85 : 0;
    this.targetDistance = (C.cameraDistance + sprintPull) * this.zoom;
    this.distance = damp(this.distance, this.targetDistance, 4.5, dt);

    // ---- compute camera position on the orbit sphere
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const offset = new THREE.Vector3(
      sy * cp * this.distance,
      this.height + sp * this.distance * 1.15,
      cy * cp * this.distance,
    );
    let desired = this.smoothTarget.clone().add(offset);

    // ---- collision: march toward the target and stop before terrain/props
    const dir = desired.clone().sub(this.smoothTarget);
    const dist = dir.length();
    dir.normalize();
    let allowed = dist;
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      const t = (i / steps) * dist;
      const px = this.smoothTarget.x + dir.x * t;
      const py = this.smoothTarget.y + dir.y * t;
      const pz = this.smoothTarget.z + dir.z * t;
      const ground = terrainHeight(px, pz);
      const clearance = p.onDeck ? Math.max(ground, p.pos.y - 1.0) : ground;
      if (py < clearance + 0.40) { allowed = Math.max(1.1, t - 0.5); break; }
    }
    desired = this.smoothTarget.clone().add(dir.multiplyScalar(allowed));

    this.pos.x = damp(this.pos.x, desired.x, 16, dt);
    this.pos.y = damp(this.pos.y, desired.y, 14, dt);
    this.pos.z = damp(this.pos.z, desired.z, 16, dt);

    // hard clamp above ground (prevents seeing through the world on steep slopes)
    const camGround = terrainHeight(this.pos.x, this.pos.z) + 0.35;
    if (this.pos.y < camGround) this.pos.y = camGround;

    // ---- apply
    this.camera.position.copy(this.pos);
    this.applyShake(dt);
    this.camera.lookAt(this.smoothTarget);

    // ---- FOV: subtle speed stretch while sprinting
    this.fovTarget = this.fovBase + (p.sprinting ? 5.5 : 0) + (p.wading > 0.3 ? -2 : 0);
    this.camera.fov = damp(this.camera.fov, this.fovTarget, 5, dt);
    this.camera.updateProjectionMatrix();
  }

  updateCinematic(dt) {
    const c = this.cinematic;
    c.t += dt;
    let t = c.t, i = 0;
    while (i < c.keys.length && t > c.keys[i].time) { t -= c.keys[i].time; i++; }
    if (i >= c.keys.length) {
      const done = c.onDone;
      this.cinematic = null;
      done?.();
      return;
    }
    const k = c.keys[i];
    const prev = c.keys[i - 1] || k;
    const u = clamp(t / k.time);
    const e = easeInOutCubic(u);
    const from = prev.pos || k.pos;
    const to = k.pos;
    const lookFrom = prev.look || k.look;
    const lookTo = k.look;
    this.camera.position.set(
      lerp(from.x, to.x, e), lerp(from.y, to.y, e), lerp(from.z, to.z, e));
    const look = new THREE.Vector3(
      lerp(lookFrom.x, lookTo.x, e), lerp(lookFrom.y, lookTo.y, e), lerp(lookFrom.z, lookTo.z, e));
    this.camera.lookAt(look);
    this.camera.fov = damp(this.camera.fov, k.fov || 55, 3, dt);
    this.camera.updateProjectionMatrix();
    this.applyShake(dt);
  }

  applyShake(dt) {
    if (this.shakeAmt <= 0.0005) return;
    this.shakeTime += dt;
    const s = this.shakeAmt;
    const t = this.shakeTime * 27;
    this.camera.position.x += Math.sin(t * 1.7) * s * 0.22;
    this.camera.position.y += Math.sin(t * 2.3 + 1.1) * s * 0.18;
    this.camera.position.z += Math.cos(t * 1.9 + 0.7) * s * 0.22;
    this.camera.rotation.z += Math.sin(t * 1.3) * s * 0.02;
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.9);
  }
}

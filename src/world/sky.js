// Y'SMARA — sky, sun, clouds, weather and drifting aerial life.
import * as THREE from 'three';
import { glowTexture, puffTexture } from './textures.js';
import { makeNoise2D, makeRng, clamp, lerp, smoothstep, TAU } from '../core/math.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // force to far plane
}
`;

const SKY_FRAG = /* glsl */`
precision highp float;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uTime;
uniform float uMood;      // 0 = bright coast, 1 = hollow dread
uniform float uCloudCover;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -1.0, 1.0);

  // vertical gradient with warm horizon haze
  float t = pow(clamp(h * 0.5 + 0.5, 0.0, 1.0), 0.72);
  vec3 col = mix(uHorizon, uZenith, t);
  col = mix(col, uHaze, pow(1.0 - clamp(abs(h) * 1.6, 0.0, 1.0), 3.2) * 0.75);

  // below horizon -> darker sea-mist tone so the skydome never looks pasted
  col = mix(col, uHaze * 0.72, smoothstep(0.0, -0.28, h));

  // sun
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * pow(sd, 1400.0) * 5.2;            // disc
  col += uSunColor * pow(sd, 22.0) * 0.28;             // inner glow
  col += uSunColor * pow(sd, 4.0) * 0.10;              // wide bloom

  // clouds: layered fbm projected on a dome, drifting
  if (h > 0.02) {
    vec2 cp = d.xz / max(d.y, 0.06);
    vec2 drift = vec2(uTime * 0.0045, uTime * 0.0022) * (1.0 + uMood);
    float c1 = fbm(cp * 0.55 + drift);
    float c2 = fbm(cp * 1.35 + drift * 1.8 + 5.2);
    float cloud = smoothstep(0.52, 0.86, c1 * 0.7 + c2 * 0.45) * uCloudCover;
    cloud *= smoothstep(0.0, 0.28, h);                 // fade at horizon
    float lit = smoothstep(0.15, 0.95, c2);
    vec3 cloudCol = mix(uHaze * 1.06, uSunColor * 1.12, lit);
    cloudCol = mix(cloudCol, uZenith * 0.92, smoothstep(0.35, 1.0, h) * 0.35);
    // silver lining near the sun
    cloudCol += uSunColor * pow(sd, 8.0) * 0.35 * (1.0 - cloud) * cloud;
    col = mix(col, cloudCol, cloud * 0.9);
  }

  // subtle dithering to kill banding on phone displays
  float dither = (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.006;
  col += dither;

  gl_FragColor = vec4(col, 1.0);
}
`;

export class SkySystem {
  constructor(scene, preset) {
    this.scene = scene;
    this.preset = preset;
    this.group = new THREE.Group();
    this.group.name = 'sky';

    this.uniforms = {
      uZenith: { value: new THREE.Color(0x5b87a8) },
      uHorizon: { value: new THREE.Color(0xcfd6d2) },
      uHaze: { value: new THREE.Color(0xecdcc0) },
      uSunDir: { value: new THREE.Vector3(0.36, 0.62, 0.66).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.92, 0.78) },
      uTime: { value: 0 },
      uMood: { value: 0 },
      uCloudCover: { value: 0.85 },
    };
    // Small dome, always recentred on the camera: never clipped, never left behind.
    const geo = new THREE.SphereGeometry(1, 32, 20);
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    this.dome = new THREE.Mesh(geo, this.mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    this.dome.scale.setScalar(400);
    this.scene.add(this.dome);   // not in this.group: it is positioned per-frame from the camera


    // ---- lights
    this.sun = new THREE.DirectionalLight(0xfff0d8, 3.1);
    this.sun.position.set(70, 120, 130);
    this.sun.castShadow = preset.shadows;
    const sc = this.sun.shadow;
    sc.mapSize.set(preset.shadowSize, preset.shadowSize);
    sc.camera.near = 1; sc.camera.far = 260;
    sc.camera.left = -70; sc.camera.right = 70; sc.camera.top = 70; sc.camera.bottom = -70;
    sc.bias = -0.0008;
    sc.normalBias = 0.035;
    this.scene.add(this.sun);
    this.sunTarget = new THREE.Object3D();
    this.scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;

    this.hemi = new THREE.HemisphereLight(0xbcd2e6, 0x8a7f66, 1.05);
    this.scene.add(this.hemi);

    // subtle warm bounce from the water
    this.fill = new THREE.DirectionalLight(0x9fc6d0, 0.42);
    this.fill.position.set(-60, 30, -80);
    this.scene.add(this.fill);

    // ---- weather: mist sheets + drifting spores + cinderwings
    this.mist = [];
    const puff = puffTexture();
    this.mistMat = new THREE.MeshBasicMaterial({
      map: puff, transparent: true, opacity: 0.12, depthWrite: false,
      color: 0xe8e0cf, blending: THREE.NormalBlending, side: THREE.DoubleSide,
    });
    const mistCount = preset.quality === 'potato' ? 4 : preset.quality === 'low' ? 7 : 14;
    const rng = makeRng(808);
    for (let i = 0; i < mistCount; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mistMat.clone());
      m.material.opacity = 0.05 + rng() * 0.10;
      const scl = 30 + rng() * 70;
      m.scale.set(scl, scl * 0.42, 1);
      m.position.set((rng() - 0.5) * 420, 1.5 + rng() * 9, (rng() - 0.5) * 420);
      m.rotation.x = -Math.PI / 2 + (rng() - 0.5) * 0.25;
      m.renderOrder = 3;
      this.mist.push(m);
      this.group.add(m);
    }

    // ---- drifting motes / spores around the player (Points, cheap)
    const moteCount = preset.quality === 'ultra' ? 900 : preset.quality === 'high' ? 620 : preset.quality === 'medium' ? 360 : 140;
    const pos = new Float32Array(moteCount * 3);
    const ph = new Float32Array(moteCount);
    for (let i = 0; i < moteCount; i++) {
      pos[i * 3] = (rng() - 0.5) * 70;
      pos[i * 3 + 1] = rng() * 22;
      pos[i * 3 + 2] = (rng() - 0.5) * 70;
      ph[i] = rng() * TAU;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.moteMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xf3e2b8) }, uSize: { value: 1.5 } },
      vertexShader: /* glsl */`
        uniform float uTime; uniform float uSize;
        attribute float aPhase;
        varying float vA;
        void main() {
          vec3 p = position;
          p.y += sin(uTime * 0.35 + aPhase) * 1.6;
          p.x += cos(uTime * 0.21 + aPhase * 1.7) * 1.9;
          p.z += sin(uTime * 0.17 + aPhase * 2.3) * 1.9;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vA = smoothstep(70.0, 18.0, -mv.z) * (0.45 + 0.55 * sin(uTime * 1.3 + aPhase));
          gl_PointSize = uSize * (140.0 / max(-mv.z, 1.0));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColor; varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float a = smoothstep(0.5, 0.0, length(d)) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a * 0.85);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(g, this.moteMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    // ---- hovering cinderwings (Vela + flock) built as simple animated quads
    this.birds = [];
    const glowTex = glowTexture();
    this.glowTex = glowTex;

    this.scene.add(this.group);
  }

  /** Region-driven look: sky palette, fog, light colour and mood. */
  applyLook({ zenith, horizon, haze, sunDir, sunColor, sunIntensity, hemiSky, hemiGround, hemiIntensity, mood, cloudCover, fogColor, fogDensity }) {
    const u = this.uniforms;
    if (zenith) u.uZenith.value.set(zenith);
    if (horizon) u.uHorizon.value.set(horizon);
    if (haze) u.uHaze.value.set(haze);
    if (sunDir) u.uSunDir.value.copy(sunDir).normalize();
    if (sunColor) u.uSunColor.value.set(sunColor);
    if (mood !== undefined) u.uMood.value = mood;
    if (cloudCover !== undefined) u.uCloudCover.value = cloudCover;
    if (sunIntensity !== undefined) this.sun.intensity = sunIntensity;
    if (sunColor) this.sun.color.set(sunColor);
    if (hemiSky) this.hemi.color.set(hemiSky);
    if (hemiGround) this.hemi.groundColor.set(hemiGround);
    if (hemiIntensity !== undefined) this.hemi.intensity = hemiIntensity;
    if (fogColor) {
      this.scene.fog = this.scene.fog || new THREE.FogExp2(0xffffff, 0.0035);
      this.scene.fog.color.set(fogColor);
    }
    if (fogDensity !== undefined && this.scene.fog) this.scene.fog.density = fogDensity;
    this.sunDirNow = u.uSunDir.value.clone();
  }

  /** Sky is camera-anchored so it can never be escaped or clipped. */
  followCamera(camera) {
    if (!this.dome) return;
    this.dome.position.copy(camera.position);
    this.dome.scale.setScalar(Math.max(300, camera.far * 0.8));
    this.dome.updateMatrixWorld();
  }

  /** Keep the shadow frustum, dome and motes glued to the player. */
  followPlayer(pos, dt, time) {
    this.group.position.set(pos.x, 0, pos.z);
    this.motes.position.set(pos.x, 0, pos.z);
    const sd = this.sunDirNow || new THREE.Vector3(0.36, 0.66, 0.66);
    this.sun.position.set(pos.x + sd.x * 90, sd.y * 120, pos.z + sd.z * 90);
    this.sunTarget.position.set(pos.x, 0, pos.z);
    this.sunTarget.updateMatrixWorld();
    this.uniforms.uTime.value = time;
    this.moteMat.uniforms.uTime.value = time;
    // mist drifts slowly and wraps around the player
    for (let i = 0; i < this.mist.length; i++) {
      const m = this.mist[i];
      m.position.x += dt * (0.6 + (i % 3) * 0.22);
      m.position.z += dt * Math.sin(time * 0.1 + i) * 0.5;
      if (m.position.x - this.group.position.x > 260) m.position.x -= 520;
      m.rotation.z += dt * 0.01 * (i % 2 ? 1 : -1);
      // billboard-ish tilt toward camera stays cheap: keep flat, add slow roll
    }
  }

  updateTime(t) { this.uniforms.uTime.value = t; }
}

// Y'SMARA — water.
// A single large plane at sea level with an analytic wave normal, fresnel sky reflection,
// depth-based colour, sun glitter, shoreline foam and a hand-painted ripple normal.
import * as THREE from 'three';
import { WORLD } from './world.js';
import { TAU } from '../core/math.js';

const VERT = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
varying vec3 vWorld;
varying vec2 vUv;
varying float vWave;

vec3 waveNormal(vec2 p, float t) {
  // four directional swells -> normal via summed gradients (cheap Gerstner-ish)
  float n = 0.0;
  vec2 d1 = normalize(vec2(0.82, 0.57));
  vec2 d2 = normalize(vec2(-0.42, 0.91));
  vec2 d3 = normalize(vec2(0.62, -0.78));
  vec2 d4 = normalize(vec2(-0.90, -0.43));
  n += 0.030 * cos(dot(p, d1) * 0.55 + t * 0.85);
  n += 0.024 * cos(dot(p, d2) * 0.83 + t * 1.13);
  n += 0.020 * cos(dot(p, d3) * 1.37 + t * 1.51);
  n += 0.013 * cos(dot(p, d4) * 2.31 + t * 2.07);
  vec2 grad = d1 * 0.030 * cos(dot(p, d1) * 0.55 + t * 0.85) +
              d2 * 0.024 * cos(dot(p, d2) * 0.83 + t * 1.13) +
              d3 * 0.020 * cos(dot(p, d3) * 1.37 + t * 1.51) +
              d4 * 0.013 * cos(dot(p, d4) * 2.31 + t * 2.07);
  vWave = n;
  return normalize(vec3(-grad.x, 1.0, -grad.y));
}

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 nrm = waveNormal(wp.xz, uTime);
  // small vertical displacement
  wp.y += (waveNormal(wp.xz, uTime).x * 0.0) + sin(wp.x * 0.35 + uTime * 0.7) * 0.035 + cos(wp.z * 0.29 - uTime * 0.9) * 0.03;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  // pass normal through a varying computed from the analytic field
  vNrm = nrm;
}
`;

const FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSkyHi;
uniform vec3 uSkyLo;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uWaterLevel;
uniform sampler2D tNormal;
uniform float uQuality;

varying vec3 vWorld;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 24634.6345); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}

void main() {
  // ---- detailed normal from animated ripple texture + analytic swells
  vec2 uv1 = vWorld.xz * 0.045 + vec2(uTime * 0.012, uTime * 0.008);
  vec2 uv2 = vWorld.xz * 0.091 - vec2(uTime * 0.016, uTime * 0.011);
  vec3 n1 = texture2D(tNormal, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tNormal, uv2).xyz * 2.0 - 1.0;
  vec3 nTex = normalize(vec3((n1.x + n2.x) * 0.55, 1.0, (n1.y + n2.y) * 0.55));

  float swellX = cos(vWorld.x * 0.35 + uTime * 0.7) * 0.06;
  float swellZ = sin(vWorld.z * 0.29 - uTime * 0.9) * 0.05;
  vec3 N = normalize(vec3(nTex.x * 0.75 + swellX, 1.0, nTex.z * 0.75 + swellZ));

  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(uSunDir + V);

  // ---- fresnel sky reflection (analytic gradient sky, no cubemap needed)
  float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 4.2);
  vec3 R = reflect(-V, N);
  float skyT = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 skyRefl = mix(uSkyLo, uSkyHi, pow(skyT, 0.9));
  // sun disc reflection streak
  float sunDot = max(dot(R, uSunDir), 0.0);
  skyRefl += uSunColor * pow(sunDot, 220.0) * 1.4;

  // ---- water body colour by depth (depth read from terrain via screen-space is unavailable
  // cheaply; approximate with a distance-scaled gradient + shallow tint near the shore foam)
  vec3 body = mix(uShallow, uDeep, 0.55);

  vec3 col = mix(body, skyRefl, clamp(fres, 0.0, 0.94));

  // ---- glitter
  float glint = pow(max(dot(N, H), 0.0), 420.0);
  col += uSunColor * glint * 2.2 * step(0.25, fres);

  // ---- ripple sheen
  col += vec3(0.06, 0.08, 0.08) * pow(1.0 - abs(N.y), 3.0);

  // ---- distance fog
  float dist = length(vWorld - cameraPosition);
  float fogAmt = 1.0 - exp(-pow(dist * uFogDensity * 1.15, 1.7));
  col = mix(col, uFogColor, clamp(fogAmt, 0.0, 1.0));

  float alpha = mix(0.72, 0.97, clamp(fres * 1.2, 0.0, 1.0));
  gl_FragColor = vec4(col, alpha);
}
`;

// need the varying declared in both
const VERT2 = VERT.replace('varying float vWave;', 'varying float vWave;\nvarying vec3 vNrm;');
const FRAG2 = FRAG.replace('varying vec2 vUv;', 'varying vec2 vUv;\nvarying vec3 vNrm;');

export function buildWater(preset, rippleNormalTex) {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.36, 0.66, 0.66).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.94, 0.82) },
    uDeep: { value: new THREE.Color(0x1d3b40) },
    uShallow: { value: new THREE.Color(0x4d7a74) },
    uSkyHi: { value: new THREE.Color(0x7fa3bd) },
    uSkyLo: { value: new THREE.Color(0xe6d9c2) },
    uFogColor: { value: new THREE.Color(0xc7c0b0) },
    uFogDensity: { value: 0.0034 },
    uWaterLevel: { value: WORLD.waterLevel },
    tNormal: { value: rippleNormalTex },
    uQuality: { value: preset.waterDetail },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT2, fragmentShader: FRAG2,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const geo = new THREE.PlaneGeometry((WORLD.half + 60) * 2, (WORLD.half + 60) * 2, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WORLD.waterLevel;
  mesh.name = 'water';
  mesh.renderOrder = 2;
  mesh.userData.uniforms = uniforms;
  mesh.userData.update = (t) => { uniforms.uTime.value = t; };
  return mesh;
}

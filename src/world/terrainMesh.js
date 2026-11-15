// Y'SMARA — terrain mesh builder.
// Produces the playable heightfield: LOD rings, splat-blended materials, baked vertex colour
// (macro variation + ambient occlusion + tide staining) and a shader that adds ripples,
// caustics under water, wind shimmer and triplanar-ish detail.
import * as THREE from 'three';
import {
  WORLD, terrainHeight, terrainNormal, regionAt, waterDepthAt, pathDistance, biomeAt,
} from './world.js';
import { sandTextures, stoneTextures, coralTextures, glassTextures, ashTextures } from './textures.js';
import { clamp, smoothstep, lerp, dist2d, makeRng } from '../core/math.js';

const TERRAIN_VERT = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vColor;
varying vec4 vMat;
varying float vDepth;
varying float vSlope;

void main() {
  vec3 p = position;
  vColor = color;
  vMat = uv2;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vSlope = 1.0 - vNormalW.y;
  vDepth = max(0.0, -wp.y);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const TERRAIN_FRAG = /* glsl */`
precision highp float;
uniform float uTime;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uAmbient;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uWaterLevel;
uniform float uDetail;
uniform float uCaustics;

uniform sampler2D tSand;   uniform sampler2D tSandN;
uniform sampler2D tStone;  uniform sampler2D tStoneN;
uniform sampler2D tCoral;  uniform sampler2D tCoralN;
uniform sampler2D tGlass;  uniform sampler2D tGlassN;
uniform sampler2D tAsh;    uniform sampler2D tAshN;

varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vColor;
varying vec4 vMat;
varying float vDepth;
varying float vSlope;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm2(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

// Caustic pattern: 3 offset cell layers animated, cheap and pretty underwater.
float caustic(vec2 uv, float t) {
  vec2 p = uv * 0.55;
  float c = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    p = uv * (0.5 + fi * 0.22) + vec2(t * (0.11 + fi * 0.03), t * (0.09 - fi * 0.02));
    vec2 g = abs(sin(p)) + abs(cos(p.yx * 1.3));
    c += pow(1.0 - clamp(min(g.x, g.y), 0.0, 1.0), 6.0);
  }
  return c * 0.42;
}

void main() {
  vec3 N = normalize(vNormalW);
  vec2 worldUV = vWorld.xz;

  // ---- material masks from baked vertex colour + slope/depth
  float sand  = clamp(vMat.r, 0.0, 1.0);
  float rock  = clamp(vMat.g, 0.0, 1.0);
  float coral = clamp(vMat.b, 0.0, 1.0);
  float glass = clamp(vMat.a, 0.0, 1.0);

  // ---- detail sampling with distance-based anisotropy
  float dist = length(vWorld - cameraPosition);
  float detailFade = 1.0 - smoothstep(70.0, 220.0, dist);
  float uvS = 1.0 / 3.2;
  vec3 sandC  = texture2D(tSand,  worldUV * uvS * 1.0).rgb;
  vec3 stoneC = texture2D(tStone, worldUV * uvS * 0.75).rgb;
  vec3 coralC = texture2D(tCoral, worldUV * uvS * 1.6).rgb;
  vec3 glassC = texture2D(tGlass, worldUV * uvS * 0.9).rgb;
  vec3 ashC   = texture2D(tAsh,   worldUV * uvS * 1.3).rgb;

  vec3 nSand  = texture2D(tSandN,  worldUV * uvS * 1.0).xyz * 2.0 - 1.0;
  vec3 nStone = texture2D(tStoneN, worldUV * uvS * 0.75).xyz * 2.0 - 1.0;
  vec3 nCoral = texture2D(tCoralN, worldUV * uvS * 1.6).xyz * 2.0 - 1.0;
  vec3 nGlass = texture2D(tGlassN, worldUV * uvS * 0.9).xyz * 2.0 - 1.0;
  vec3 nAsh   = texture2D(tAshN,   worldUV * uvS * 1.3).xyz * 2.0 - 1.0;

  // blend weights: sand vs stone by slope, coral/glass/ash by baked mask
  float wRock  = smoothstep(0.18, 0.42, vSlope) * uDetail;
  float wCoral = coral;
  float wGlass = glass * (1.0 - wRock * 0.3);
  float wAsh   = clamp(1.0 - sand - wCoral - wGlass, 0.0, 1.0);

  vec3 albedo = sandC * sand * (1.0 - wRock) + stoneC * max(wRock, rock) + coralC * wCoral + glassC * wGlass + ashC * wAsh * 0.9;
  albedo /= max(sand * (1.0 - wRock) + max(wRock, rock) + wCoral + wGlass + wAsh * 0.9, 0.001);

  vec3 dn = nSand * sand * (1.0 - wRock) + nStone * max(wRock, rock) + nCoral * wCoral + nGlass * wGlass + nAsh * wAsh;
  vec3 detailN = normalize(vec3(dn.x * 0.55 * detailFade, 1.0, dn.z * 0.55 * detailFade));
  N = normalize(mix(N, normalize(N + detailN * 0.9), 0.72));

  // macro breakup so large areas never look flat
  float macro = fbm2(worldUV * 0.012) * 0.22 + fbm2(worldUV * 0.06) * 0.10;
  albedo *= 0.86 + macro;
  albedo = mix(albedo, vColor.rgb, 0.34);

  // ---- wetness band & tide staining
  float waterY = uWaterLevel;
  float above = vWorld.y - waterY;
  float wet = 1.0 - smoothstep(0.0, 1.35, max(above, 0.0));
  albedo *= 1.0 - wet * 0.30;
  albedo = mix(albedo, albedo * vec3(0.82, 0.88, 0.86), wet * 0.35);

  // ---- lighting
  float ndl = max(dot(N, uSunDir), 0.0);
  float wrap = pow(max(dot(N, uSunDir) * 0.5 + 0.5, 0.0), 1.4);
  vec3 hemi = mix(vec3(0.30, 0.30, 0.26), vec3(0.55, 0.62, 0.72), N.y * 0.5 + 0.5);
  vec3 lit = albedo * (uSunColor * (ndl * 0.95 + wrap * 0.22) + uAmbient * hemi);

  // ---- underwater caustics + absorption
  if (vDepth > 0.0) {
    float c = caustic(worldUV * 0.9, uTime * 0.55) * uCaustics;
    float shallow = exp(-vDepth * 0.75);
    lit += albedo * vec3(0.35, 0.62, 0.58) * c * shallow * 0.55;
    lit *= exp(-vDepth * vec3(0.42, 0.24, 0.20));
    lit = mix(lit, vec3(0.06, 0.16, 0.17), clamp(vDepth * 0.18, 0.0, 0.55));
  }

  // ---- specular sheen on wet sand and glass
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 H = normalize(uSunDir + V);
  float spec = pow(max(dot(N, H), 0.0), mix(48.0, 220.0, wGlass)) * (wet * 0.35 + wGlass * 0.6);
  lit += uSunColor * spec * 0.55;

  // ---- aerial perspective
  float fogAmt = 1.0 - exp(-pow(dist * uFogDensity, 1.65));
  vec3 fogc = mix(uFogColor, uSunColor * 0.85 + uFogColor * 0.30, pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.55);
  lit = mix(lit, fogc, clamp(fogAmt, 0.0, 1.0));

  gl_FragColor = vec4(lit, 1.0);
}
`;

/** Build the playable terrain mesh. Two rings: a detailed inner field + a coarse outer shell. */
export function buildTerrain(preset) {
  const group = new THREE.Group();
  group.name = 'terrain';

  const sand = sandTextures(), stone = stoneTextures(), coral = coralTextures();
  const glass = glassTextures(), ash = ashTextures();

  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.36, 0.66, 0.66).normalize() },
    uSunColor: { value: new THREE.Color(1.0, 0.93, 0.80) },
    uAmbient: { value: new THREE.Color(0.42, 0.50, 0.60) },
    uFogColor: { value: new THREE.Color(0.78, 0.76, 0.71) },
    uFogDensity: { value: 0.0034 },
    uWaterLevel: { value: WORLD.waterLevel },
    uDetail: { value: preset.quality === 'low' || preset.quality === 'potato' ? 0.6 : 1.0 },
    uCaustics: { value: preset.quality === 'low' ? 0.0 : 1.0 },
    tSand: { value: sand.map }, tSandN: { value: sand.normalMap },
    tStone: { value: stone.map }, tStoneN: { value: stone.normalMap },
    tCoral: { value: coral.map }, tCoralN: { value: coral.normalMap },
    tGlass: { value: glass.map }, tGlassN: { value: glass.normalMap },
    tAsh: { value: ash.map }, tAshN: { value: ash.normalMap },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: TERRAIN_VERT, fragmentShader: TERRAIN_FRAG,
    vertexColors: true, fog: false,
  });
  mat.extensions = { derivatives: true };

  const makeMesh = (step, extent, segmentsHint) => {
    const size = extent * 2;
    const segs = Math.floor(size / step);
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col4 = new Float32Array(pos.count * 4);
    const rng = makeRng(2024);
    // sample heights once, then derive normals from neighbours in-grid (fast + smooth)
    const n = segs + 1;
    const heights = new Float32Array(n * n);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = terrainHeight(x, z);
      heights[i] = h;
      pos.setY(i, h);
    }
    const cell = size / segs;
    const get = (ix, iy) => heights[clamp(iy, 0, n - 1) * n + clamp(ix, 0, n - 1)];
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix;
        const x = pos.getX(i), z = pos.getZ(i), h = heights[i];
        const hL = get(ix - 1, iz), hR = get(ix + 1, iz), hD = get(ix, iz - 1), hU = get(ix, iz + 1);
        const nx = hL - hR, ny = 2 * cell, nz = hD - hU;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const slope = 1 - ny / nl;

        // --- material masks baked into vertex colour (.rgb = tint, .a = glass mask)
        const region = regionAt(x, z);
        const depth = waterDepthAt(x, z);
        let sandW = 1, rockW = 0, coralW = 0, glassW = 0;
        const slopeRock = smoothstep(0.16, 0.4, slope);
        rockW = slopeRock * 0.9;
        sandW = 1 - rockW;
        if (region.id === 'ossuary') { coralW = clamp(0.55 + (h > 0 ? 0.25 : 0) - slopeRock * 0.3); sandW *= 0.3; rockW *= 0.5; }
        if (region.id === 'glass') { glassW = clamp(1 - slopeRock * 0.8); sandW *= 0.15; }
        if (region.id === 'hollow') { sandW *= 0.12; coralW = 0; rockW = 0.25 + slopeRock * 0.5; }
        if (region.id === 'kneeling') { rockW = clamp(rockW + 0.35); sandW *= 0.55; }
        // tide zone -> rockier
        if (depth > 0 && depth < 0.4) rockW = clamp(rockW + 0.25);

        // --- macro colour variation
        const tint = region.palette.ground;
        let tr = ((tint >> 16) & 255) / 255, tg = ((tint >> 8) & 255) / 255, tb = (tint & 255) / 255;
        const vary = 1 + (rng() - 0.5) * 0.06;
        tr *= vary; tg *= vary; tb *= vary;
        // ambient occlusion: valley darkening from local height differences
        const openness = clamp(0.5 + (ny / nl - 0.6) * 1.4);
        const ao = clamp(0.62 + (h - (hL + hR + hD + hU) * 0.25) * 0.09 + openness * 0.35, 0.35, 1.12);
        // path: trodden pale silt
        const pd = pathDistance(x, z);
        const pathW = 1 - smoothstep(0.0, 2.2, pd);
        tr = lerp(tr, 0.62, pathW * 0.45); tg = lerp(tg, 0.58, pathW * 0.45); tb = lerp(tb, 0.48, pathW * 0.45);
        // wetness darkening
        const wet = 1 - smoothstep(0.0, 1.1, Math.max(0, h - WORLD.waterLevel));
        const wetMul = 1 - wet * 0.26;

        colors[i * 3] = clamp(tr * ao * wetMul, 0, 1);
        colors[i * 3 + 1] = clamp(tg * ao * wetMul, 0, 1);
        colors[i * 3 + 2] = clamp(tb * ao * wetMul, 0, 1);
        col4[i * 4] = clamp(sandW, 0, 1);
        col4[i * 4 + 1] = clamp(rockW, 0, 1);
        col4[i * 4 + 2] = clamp(coralW, 0, 1);
        col4[i * 4 + 3] = clamp(glassW, 0, 1);
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // masks travel on uv2 (4 components) so the shader can splat five materials
    geo.setAttribute('uv2', new THREE.BufferAttribute(col4, 4));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = preset.shadows;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    return mesh;
  };

  // inner detailed field
  const inner = makeMesh(2.4, 260);
  inner.name = 'terrain_inner';
  group.add(inner);

  // outer coarse shell
  const outer = makeMesh(7.5, WORLD.half + 10);
  outer.name = 'terrain_outer';
  // hide the overlapping centre of the outer shell by scaling it slightly down in y
  // (inner sits a hair above it to avoid z-fighting)
  outer.position.y = -0.06;
  group.add(outer);

  group.userData.material = mat;
  group.userData.uniforms = uniforms;
  group.userData.update = (t) => { uniforms.uTime.value = t; };
  return group;
}

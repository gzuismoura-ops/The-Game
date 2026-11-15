// Y'SMARA — renderer, quality presets and the single-pass cinematic grade.
import * as THREE from 'three';
import { clamp, lerp } from './math.js';

export const QUALITY_PRESETS = {
  ultra:  { label: 'Ultra',  pixelRatio: 2.0, shadows: true,  shadowSize: 2048, props: 1.0, waterDetail: 2, post: true,  aa: true,  foliage: 1.0 },
  high:   { label: 'High',   pixelRatio: 1.5, shadows: true,  shadowSize: 1536, props: 0.85, waterDetail: 2, post: true,  aa: true,  foliage: 1.0 },
  medium: { label: 'Medium', pixelRatio: 1.15, shadows: true, shadowSize: 1024, props: 0.65, waterDetail: 1, post: true,  aa: true,  foliage: 0.75 },
  low:    { label: 'Low',    pixelRatio: 1.0, shadows: false, shadowSize: 512,  props: 0.42, waterDetail: 0, post: false, aa: false, foliage: 0.5 },
  potato: { label: 'Battery Saver', pixelRatio: 0.75, shadows: false, shadowSize: 512, props: 0.28, waterDetail: 0, post: false, aa: false, foliage: 0.32 },
};

export function detectQuality() {
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  const small = Math.min(screen.width, screen.height) < 420;
  if (small || cores <= 4 || mem <= 3) return 'medium';
  if (cores >= 8 && mem >= 6) return 'high';
  return 'medium';
}

const GRADE_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const GRADE_FRAG = /* glsl */`
precision mediump float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform float uTime;
uniform float uVignette;
uniform float uGrain;
uniform float uDamage;
uniform vec3  uTint;
uniform float uTintAmount;
uniform float uDesat;
uniform float uFade;

vec3 sat(vec3 c, float s) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(l), c, s);
}

void main() {
  vec2 uv = vUv;
  // very subtle radial chromatic aberration (premium lens feel, cheap)
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  float ab = 0.0016 * r2;
  vec3 col;
  col.r = texture2D(tDiffuse, uv + d * ab).r;
  col.g = texture2D(tDiffuse, uv).g;
  col.b = texture2D(tDiffuse, uv - d * ab).b;

  // tint + saturation grade
  col = mix(col, col * uTint, uTintAmount);
  col = sat(col, 1.0 - uDesat);

  // damage / low health pulse at edges
  float vig = smoothstep(0.95, 0.25, length(d) * 1.42);
  col *= mix(1.0, vig, uVignette);
  col = mix(col, vec3(0.55, 0.03, 0.03), uDamage * smoothstep(0.35, 0.95, length(d) * 1.5) * 0.85);

  // filmic grain (temporally varied, no texture needed)
  float n = fract(sin(dot(uv * vec2(1234.5, 7456.7) + uTime * 13.7, vec2(12.9898, 78.233))) * 43758.5453);
  col += (n - 0.5) * uGrain;

  // fade to/from black for scene transitions
  col *= uFade;

  gl_FragColor = vec4(col, 1.0);
}
`;

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance',
      stencil: false, depth: true, alpha: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x9fb0bd, 1);

    this.quality = 'high';
    this.preset = QUALITY_PRESETS.high;
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 2);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, 900);

    this._setupPost();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 220));
    this.frameSamples = [];
  }

  _setupPost() {
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
    });
    this.gradeMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.rt.texture },
        uTime: { value: 0 }, uVignette: { value: 0.85 }, uGrain: { value: 0.028 },
        uDamage: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) },
        uTintAmount: { value: 0.0 }, uDesat: { value: 0.06 }, uFade: { value: 1.0 },
      },
      vertexShader: GRADE_VERT, fragmentShader: GRADE_FRAG, depthTest: false, depthWrite: false,
    });
    this.postScene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.gradeMat);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  setQuality(name) {
    const p = QUALITY_PRESETS[name] || QUALITY_PRESETS.high;
    this.quality = name in QUALITY_PRESETS ? name : 'high';
    this.preset = p;
    this.renderer.shadowMap.enabled = p.shadows;
    this.renderer.toneMappingExposure = 1.06;
    this.resize();
    return p;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const ratio = Math.min(this.maxRatio, this.preset.pixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dw = Math.max(2, Math.floor(w * ratio)), dh = Math.max(2, Math.floor(h * ratio));
    this.rt.setSize(dw, dh);
  }

  render(timeSec, fade = 1, damage = 0) {
    const u = this.gradeMat.uniforms;
    u.uTime.value = timeSec;
    u.uFade.value = fade;
    u.uDamage.value = damage;
    if (this.preset.post) {
      this.renderer.setRenderTarget(this.rt);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.postScene, this.postCam);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.scene, this.camera);
    }
  }

  setGrade({ tint, tintAmount, desat, vignette, grain }) {
    const u = this.gradeMat.uniforms;
    if (tint) u.uTint.value.copy(tint);
    if (tintAmount !== undefined) u.uTintAmount.value = tintAmount;
    if (desat !== undefined) u.uDesat.value = desat;
    if (vignette !== undefined) u.uVignette.value = vignette;
    if (grain !== undefined) u.uGrain.value = grain;
  }
}

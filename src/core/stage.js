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

/**
 * Probe what this GPU/WebView can actually do. Mobile WebViews frequently lack
 * EXT_color_buffer_half_float, and an unsupported render-target format fails
 * SILENTLY: the scene renders into an invalid buffer and the post pass reads pure
 * black. That shipped as a black screen on real Android hardware.
 * So we never assume — we ask, and we fall back all the way to no post at all.
 */
function probeRenderer(renderer) {
  const caps = { halfFloatRT: false, shadows: true, post: false, maxTexture: 0, webgl2: false };

  let gl = null;
  try { gl = renderer.getContext(); } catch { /* ignore */ }
  if (!gl) return caps;

  // Do NOT gate on `instanceof WebGL2RenderingContext`: that class is absent in some
  // embeddings and gives a false negative. Ask the context what it can do instead.
  caps.webgl2 = typeof gl.createVertexArray === 'function';
  try { caps.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096; } catch { caps.maxTexture = 4096; }

  let hasFloatExt = false;
  try {
    hasFloatExt = !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
  } catch { hasFloatExt = false; }
  caps.floatRenderTargetExtension = hasFloatExt;

  // WebGL2 alone is NOT enough: the context can exist while colour-renderable float
  // attachments do not. Require the extension, then confirm with a real framebuffer.
  if (hasFloatExt) {
    try { caps.halfFloatRT = probeHalfFloatTarget(renderer); }
    catch { caps.halfFloatRT = false; }
  }

  // Even when float is unavailable, an ordinary 8-bit target usually works. Probe that
  // too: if it also fails, post-processing must be switched off completely.
  caps.eightBitRT = false;
  try {
    caps.eightBitRT = probeRenderTargetUsable(renderer, THREE.UnsignedByteType);
  } catch { caps.eightBitRT = false; }

  return caps;
}

/**
 * Generic probe: can this context render off-screen at all with the given type?
 * Returns false when the framebuffer comes back incomplete or the draw raises.
 */
function probeRenderTargetUsable(renderer, type) {
  let rt = null;
  let mat = null;
  try {
    rt = new THREE.WebGLRenderTarget(1, 1, { type, depthBuffer: false, stencilBuffer: false });
    const probeScene = new THREE.Scene();
    const probeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    mat = new THREE.MeshBasicMaterial({ color: 0x336699 });
    probeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(probeScene, probeCam);

    const gl = renderer.getContext();
    let complete = true;
    try {
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      complete = status === (gl.FRAMEBUFFER_COMPLETE ?? 0x8CD5);
    } catch { complete = true; }
    const err = gl.getError();
    renderer.setRenderTarget(prev);
    return complete && err === gl.NO_ERROR;
  } catch {
    return false;
  } finally {
    if (mat) mat.dispose();
    if (rt) rt.dispose();
  }
}

/**
 * Allocate a real 1x1 half-float target and check the framebuffer comes back COMPLETE.
 * Declaring the extension is not proof: several mobile drivers declare it and then
 * refuse the attachment, which is exactly how a black screen reaches the player.
 */
function probeHalfFloatTarget(renderer) {
  let rt = null;
  let mat = null;
  try {
    rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false,
    });
    const probeScene = new THREE.Scene();
    const probeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    mat = new THREE.MeshBasicMaterial({ color: 0x336699 });
    probeScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(probeScene, probeCam);

    const gl = renderer.getContext();
    // setRenderTarget binds the framebuffer; 0x8CD5 === FRAMEBUFFER_COMPLETE.
    let complete = true;
    try {
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      complete = status === (gl.FRAMEBUFFER_COMPLETE ?? 0x8CD5);
    } catch { complete = true; }          // stub contexts may not implement it

    const err = gl.getError();
    renderer.setRenderTarget(prevTarget);
    return complete && err === gl.NO_ERROR;
  } catch {
    return false;
  } finally {
    if (mat) mat.dispose();
    if (rt) rt.dispose();
  }
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    // Try a high-performance context first, then fall back to the simplest one that
    // still renders. Some Android WebViews reject the former outright.
    const attempts = [
      { antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false },
      { antialias: false, powerPreference: 'default', stencil: false, depth: true, alpha: false },
      { antialias: false, stencil: false, depth: true, alpha: true },
    ];
    let lastErr = null;
    for (const opts of attempts) {
      try { this.renderer = new THREE.WebGLRenderer({ canvas, ...opts }); break; }
      catch (e) { lastErr = e; }
    }
    if (!this.renderer) {
      throw new Error(
        'Este aparelho não conseguiu criar um contexto WebGL. ' +
        'Ative a aceleração de hardware nas configurações do navegador e tente novamente. ' +
        (lastErr ? '(' + lastErr.message + ')' : '')
      );
    }

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap was REMOVED in three r187 and logs a warning while falling
    // back to a map that may not exist. PCFShadowMap is the supported choice.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0x9fb0bd, 1);

    this.caps = probeRenderer(this.renderer);

    this.quality = 'high';
    this.preset = QUALITY_PRESETS.high;
    this.maxRatio = Math.min(window.devicePixelRatio || 1, 2);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.1, 900);

    this.usePost = false;          // enabled by setQuality() only if the buffer works
    this._setupPost();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 220));
    this.frameSamples = [];
  }

  _setupPost() {
    // Half-float keeps the grade in HDR, but only when the driver proved it works.
    // An 8-bit target is the fallback; if even that is refused, post is skipped
    // entirely and the scene draws straight to the canvas (never a black screen).
    if (!this.caps?.halfFloatRT && this.caps?.eightBitRT === false) {
      console.warn("[Y'SMARA] no usable off-screen buffer — rendering direct to canvas");
      this.rt = null;
      this.gradeMat = null;
      this.postAvailable = false;
      return;
    }
    this.postRTType = this.caps?.halfFloatRT ? THREE.HalfFloatType : THREE.UnsignedByteType;
    try {
      this.rt = new THREE.WebGLRenderTarget(1, 1, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        type: this.postRTType, depthBuffer: true, stencilBuffer: false,
      });
      this.postAvailable = true;
    } catch (e) {
      console.warn('[Y\'SMARA] post-processing unavailable, rendering direct:', e.message);
      this.rt = null;
      this.postAvailable = false;
    }
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
    // Capability decides, not the preset label: a phone asking for "high" must not
    // get an HDR pipeline its GPU cannot back.
    this.usePost = !!p.post && this.postAvailable;
    this.renderer.shadowMap.enabled = p.shadows;
    this.renderer.toneMappingExposure = 1.06;
    if (!this.usePost) {
      // Keep the grade's own colour work relevant even without the buffer.
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }
    this.resize();
    return { ...p, post: this.usePost };
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const ratio = Math.min(this.maxRatio, this.preset.pixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const dw = Math.max(2, Math.floor(w * ratio)), dh = Math.max(2, Math.floor(h * ratio));
    if (this.rt) this.rt.setSize(dw, dh);   // rt is null when off-screen rendering is unavailable
  }

  render(timeSec, fade = 1, damage = 0) {
    // gradeMat only exists when post-processing was set up successfully.
    if (this.gradeMat) {
      const u = this.gradeMat.uniforms;
      u.uTime.value = timeSec;
      u.uFade.value = fade;
      u.uDamage.value = damage;
    }

    // Only take the render-target path when the buffer EXISTS and the preset asks for
    // it. If anything throws mid-frame we drop to direct rendering and stay there, so
    // one bad frame can never leave the player staring at a black screen.
    if (this.usePost && this.rt && this.postAvailable) {
      try {
        this.renderer.setRenderTarget(this.rt);
        this.renderer.render(this.scene, this.camera);
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.postScene, this.postCam);
        return;
      } catch (e) {
        console.warn("[Y'SMARA] post pass failed, switching to direct rendering:", e.message);
        this.postAvailable = false;
        this.usePost = false;
        try { this.renderer.setRenderTarget(null); } catch { /* ignore */ }
      }
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  setGrade({ tint, tintAmount, desat, vignette, grain }) {
    if (!this.gradeMat) return;
    const u = this.gradeMat.uniforms;
    if (tint) u.uTint.value.copy(tint);
    if (tintAmount !== undefined) u.uTintAmount.value = tintAmount;
    if (desat !== undefined) u.uDesat.value = desat;
    if (vignette !== undefined) u.uVignette.value = vignette;
    if (grain !== undefined) u.uGrain.value = grain;
  }
}

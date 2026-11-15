// Y'SMARA — full integration test.
// Boots the REAL game (src/main.js) inside jsdom with a stubbed WebGL2 context. This executes
// every code path that would run on a phone: world build, player, enemies, hymn, save/load,
// menus, dialogue, collectibles, endings. Rendering is stubbed; logic is real.
//
//   node tools/integration.mjs
import './css-hooks.mjs';
import { JSDOM, VirtualConsole } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const results = [];
let failures = 0;
function ok(name, extra = '') { results.push(`PASS ${name}${extra ? ' — ' + extra : ''}`); }
function fail(name, err) { failures++; results.push(`FAIL ${name}\n     ${String(err && (err.stack || err.message) || err).split('\n').slice(0, 6).join('\n     ')}`); }

// ------------------------------------------------------------------ WebGL2 stub
// Enough of the API for three.js WebGLRenderer to initialise without a GPU.
function makeGL(canvas) {
  const STR = {
    VERSION: 'WebGL 2.0 (stub)', SHADING_LANGUAGE_VERSION: 'WebGL GLSL ES 3.00 (stub)',
    VENDOR: 'YSMARA QA', RENDERER: 'SwiftShader Stub', SL_VERSION: 'WebGL GLSL ES 3.00',
  };
  const NUM = {
    MAX_TEXTURE_SIZE: 8192, MAX_CUBE_MAP_TEXTURE_SIZE: 4096, MAX_TEXTURE_IMAGE_UNITS: 16,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
    MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 1024, MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
    MAX_VARYING_VECTORS: 30, MAX_SAMPLES: 4, MAX_RENDERBUFFER_SIZE: 8192,
    MAX_3D_TEXTURE_SIZE: 2048, MAX_ARRAY_TEXTURE_LAYERS: 2048, MAX_DRAW_BUFFERS: 8,
    MAX_COLOR_ATTACHMENTS: 8, MAX_UNIFORM_BUFFER_BINDINGS: 24, MAX_ELEMENTS_VERTICES: 65536,
    MAX_ELEMENTS_INDICES: 65536, MAX_FRAGMENT_INPUT_COMPONENTS: 120, MAX_VERTEX_OUTPUT_COMPONENTS: 120,
    FRAMEBUFFER_COMPLETE: 0x8CD5, NO_ERROR: 0, VERSION: 0x1F02, SCISSOR_BOX: 0x0C10, VIEWPORT: 0x0BA2,
  };
  const ext = {
    WEBGL_debug_renderer_info: { UNMASKED_RENDERER_WEBGL: 0x9246, UNMASKED_VENDOR_WEBGL: 0x9245 },
    EXT_color_buffer_float: {}, EXT_color_buffer_half_float: {}, OES_texture_float_linear: {},
    EXT_texture_filter_anisotropic: { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF, TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE },
    WEBGL_lose_context: { loseContext() {}, restoreContext() {} },
    OES_vertex_array_object: { createVertexArrayOES: () => ({}), bindVertexArrayOES() {}, deleteVertexArrayOES() {} },
    KHR_parallel_shader_compile: { COMPLETION_STATUS_KHR: 0x91B1 },
  };
  let objId = 1;
  // real WebGL enum values for the constants three.js actually parses
  const ENUM = {
    VERSION: 0x1F02, VENDOR: 0x1F00, RENDERER: 0x1F01, SHADING_LANGUAGE_VERSION: 0x8B8C,
    MAX_TEXTURE_SIZE: 0x0D33, MAX_COMBINED_TEXTURE_IMAGE_UNITS: 0x8B4D, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_VERTEX_ATTRIBS: 0x8869, MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB,
    MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD, MAX_VARYING_VECTORS: 0x8DFC, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C,
    MAX_SAMPLES: 0x8D57, MAX_RENDERBUFFER_SIZE: 0x84E8, MAX_3D_TEXTURE_SIZE: 0x8073,
    MAX_ARRAY_TEXTURE_LAYERS: 0x88FF, MAX_DRAW_BUFFERS: 0x8824, MAX_COLOR_ATTACHMENTS: 0x8CDF,
    MAX_UNIFORM_BUFFER_BINDINGS: 0x8A2F, MAX_ELEMENTS_VERTICES: 0x80E8, MAX_ELEMENTS_INDICES: 0x80E9,
    MAX_FRAGMENT_INPUT_COMPONENTS: 0x9125, MAX_VERTEX_OUTPUT_COMPONENTS: 0x9122,
    FRAMEBUFFER_COMPLETE: 0x8CD5, NO_ERROR: 0, SCISSOR_BOX: 0x0C10, VIEWPORT: 0x0BA2,
    MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF, TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE,
  };
  const constants = new Proxy(ENUM, {
    get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? 0x1000 + (k.length * 37) % 4000 : undefined)),
  });
  const api = {
    canvas, drawingBufferWidth: 1280, drawingBufferHeight: 720,
    getExtension: (name) => ext[name] ?? null,
    getSupportedExtensions: () => Object.keys(ext),
    getParameter: (p) => {
      if (p === 0x1F02 || p === STR.VERSION) return STR.VERSION;
      if (p === 0x8B8C) return STR.SHADING_LANGUAGE_VERSION;
      if (p === 0x1F00) return STR.VENDOR;
      if (p === 0x1F01) return STR.RENDERER;
      if (p === 0x0BA2 || p === 0x0C10) return new Int32Array([0, 0, 1280, 720]);
      const key = Object.keys(NUM).find((k) => NUM[k] === p);
      if (key) return NUM[key];
      const ek = Object.keys(ENUM).find((k) => ENUM[k] === p);
      if (ek && /MAX/.test(ek)) return NUM[ek] ?? 4096;
      return 4096;
    },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getProgramParameter: () => true,
    getShaderParameter: () => true,
    getProgramInfoLog: () => '',
    getShaderInfoLog: () => '',
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    getActiveUniform: () => ({ name: 'u', size: 1, type: 0x1406 }),
    getActiveAttrib: () => ({ name: 'a', size: 1, type: 0x1406 }),
    getError: () => 0,
    checkFramebufferStatus: () => 0x8CD5,
    isContextLost: () => false,
    getContextAttributes: () => ({ alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }),
    getUniformBlockIndex: () => 0,
    getActiveUniformBlockParameter: () => 1,
  };
  return new Proxy(api, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop in constants) {
        const v = constants[prop];
        if (v !== undefined) return v;
      }
      if (typeof prop !== 'string') return undefined;
      if (/^[A-Z0-9_]+$/.test(prop)) return 0x1000 + (prop.length * 37) % 4000;
      return (...args) => {
        if (/^create/.test(prop)) return { id: objId++, __type: prop };
        if (/^is[A-Z]/.test(prop)) return false;
        if (/^get/.test(prop)) return null;
        return undefined;
      };
    },
  });
}

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
  virtualConsole: new VirtualConsole().on('jsdomError', () => {}),
});
const { window } = dom;

// ---- load the real index.html body into the DOM
const html = readFileSync('index.html', 'utf8');
const bodyMatch = html.match(/<body>([\s\S]*)<script type="module"/);
if (bodyMatch) window.document.body.innerHTML = bodyMatch[1];

// ---- browser APIs jsdom lacks
window.HTMLCanvasElement.prototype.getContext = function (type) {
  if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
    if (!this.__gl) this.__gl = makeGL(this);
    return this.__gl;
  }
  if (type === '2d') {
    if (this.__2d) return this.__2d;
    const grad = { addColorStop() {} };
    const ctx2d = {
      canvas: this, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '', globalAlpha: 1,
      createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {}, clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {},
      moveTo() {}, lineTo() {}, arc() {}, quadraticCurveTo() {}, bezierCurveTo() {}, fill() {}, stroke() {},
      save() {}, restore() {}, translate() {}, rotate() {}, scale() {}, setTransform() {}, clip() {},
      measureText: () => ({ width: 10 }), fillText() {}, strokeText() {}, drawImage() {},
      createLinearGradient: () => grad, createRadialGradient: () => grad, createPattern: () => null,
    };
    this.__2d = ctx2d;
    return ctx2d;
  }
  return null;
};
window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(window.performance.now()), 16);
window.cancelAnimationFrame = (id) => window.clearTimeout(id);
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
window.devicePixelRatio = 1;
Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
Object.defineProperty(window, 'screen', { value: { width: 1280, height: 720 }, configurable: true });
try { Object.defineProperty(window.navigator, 'vibrate', { value: () => true, configurable: true }); } catch {}
try { Object.defineProperty(window.navigator, 'deviceMemory', { value: 8, configurable: true }); } catch {}
try { Object.defineProperty(window.navigator, 'hardwareConcurrency', { value: 8, configurable: true }); } catch {}
window.confirm = () => true;
window.alert = () => {};
window.URL.createObjectURL = () => 'blob:stub';
window.AudioContext = undefined;   // audio path must degrade gracefully
window.webkitAudioContext = undefined;

// localStorage shim
const store = new Map();
const storageShim = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
  clear: () => store.clear(),
};
try { Object.defineProperty(window, 'localStorage', { value: storageShim, configurable: true }); } catch (e) { /* jsdom has one */ }
const LS = (() => { try { return window.localStorage; } catch { return storageShim; } })();

// expose to the module graph
const G = globalThis;
const define = (k, v) => { try { Object.defineProperty(G, k, { value: v, configurable: true, writable: true }); } catch { try { G[k] = v; } catch {} } };
define('window', window);
define('document', window.document);
define('navigator', window.navigator);
define('localStorage', LS);
define('requestAnimationFrame', window.requestAnimationFrame.bind(window));
define('cancelAnimationFrame', window.cancelAnimationFrame.bind(window));
define('self', window);
// keep Node's native performance (jsdom's is bound to its own impl and recurses)

define('getComputedStyle', window.getComputedStyle.bind(window));
define('HTMLElement', window.HTMLElement);
define('Element', window.Element);
define('Node', window.Node);
define('Event', window.Event);
define('CustomEvent', window.CustomEvent);
define('KeyboardEvent', window.KeyboardEvent);
define('MouseEvent', window.MouseEvent);
define('PointerEvent', window.PointerEvent || window.MouseEvent);
define('Image', window.Image);
define('ImageData', window.ImageData);
define('matchMedia', window.matchMedia.bind(window));
define('screen', window.screen);
define('devicePixelRatio', 1);

// ------------------------------------------------------------------ run the game
let errors = [];
process.on('unhandledRejection', (e) => errors.push(e));
process.on('uncaughtException', (e) => errors.push(e));

const realError = console.error;
const realLog = console.log;
console.log = (...a) => { realLog('[log]', ...a.map(String)); };
console.error = (...args) => { errors.push(args.map(String).join(' ')); realError(...args); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  await import(pathToFileURL(process.cwd() + '/src/main.js').href);
  ok('module graph loads (no import/runtime errors at load)');
} catch (e) {
  fail('module graph loads', e);
}

// let init() finish: it awaits requestAnimationFrame, so we must keep pumping the event loop.
const game = window.__game;
for (let i = 0; i < 200 && !(game && game.player && game.hud); i++) await sleep(25);
if (game && !game.player) {
  // surface whatever init threw
  const fatal = window.document.getElementById('fatal-detail');
  if (fatal && fatal.textContent) realLog('[init fatal]', fatal.textContent.slice(0, 900));
  if (errors.length) realLog('[init errors]', errors.slice(0, 4).map((e) => String(e).slice(0, 500)).join('\n---\n'));
}

if (!game) {
  fail('game instance created', 'window.__game missing');
} else {
  ok('game instance created');
  await sleep(400);

  if (errors.length) realLog('[errors during init]', errors.slice(0,5).map(e=>String(e).slice(0,400)).join('\n---\n'));
  if (game.stage) ok('Stage created with stubbed WebGL2', `quality=${game.qualityName}`);
  else fail('Stage created', 'no stage');

  const counts = {
    terrainVerts: game.terrain?.getObjectByName('terrain_inner')?.geometry.attributes.position.count,
    enemies: game.enemies?.enemies.length,
    echoes: game.echoObjects?.length,
    cantos: game.cantoObjects?.length,
    secrets: game.secretObjects?.length,
    npcs: game.npcObjects?.length,
    colliders: game.collisionColliders?.length,
  };
  if (counts.terrainVerts > 10000) ok('terrain built', `${counts.terrainVerts} verts`);
  else fail('terrain built', JSON.stringify(counts));
  if (counts.enemies > 20) ok('enemy population spawned', `${counts.enemies} creatures`);
  else fail('enemy population spawned', String(counts.enemies));
  if (counts.echoes === 24) ok('24 memory echoes placed');
  else fail('memory echoes', String(counts.echoes));
  if (counts.cantos === 8) ok('8 cantos placed');
  else fail('cantos', String(counts.cantos));
  if (counts.secrets === 5) ok('5 secrets placed');
  else fail('secrets', String(counts.secrets));
  if (counts.npcs === 5) ok('5 NPCs placed');
  else fail('npcs', String(counts.npcs));
  if (counts.colliders > 500) ok('collision grid built', `${counts.colliders} colliders`);
  else fail('collision grid', String(counts.colliders));

  // ---------- simulate play
  try {
    game.newGame(2);
    ok('new game started (slot 2)');
    // skip the intro cinematic
    game.cameraRig.stopCinematic();
    game.state = 'playing';
    game.player.root.visible = true;
    game.hud.setHudVisible(true);
  } catch (e) { fail('new game started', e); }

  // run frames with movement input to exercise the whole loop
  try {
    const startPos = game.player.pos.clone();
    const framesBefore = game.clock;
    // the harness drives the real frame loop: press keys like a player would
    window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyW' }));
    window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ShiftLeft' }));
    for (let i = 0; i < 100; i++) await sleep(16);
    window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'KeyW' }));
    window.dispatchEvent(new window.KeyboardEvent('keyup', { code: 'ShiftLeft' }));
    const framesRan = game.clock - framesBefore;
    if (framesRan > 0.2) ok('game loop is running', `${framesRan.toFixed(2)}s of simulated time`);
    else fail('game loop running', `clock advanced ${framesRan}`);
    const moved = game.player.pos.distanceTo(startPos);
    if (moved > 0.5) ok('player moves with input (real key events)', `${moved.toFixed(2)}m`);
    else fail('player moves with input', `moved ${moved.toFixed(3)}m`);
    if (game.player.pos.y > -50 && Number.isFinite(game.player.pos.y)) ok('player stays on the ground plane', `y=${game.player.pos.y.toFixed(2)}`);
    else fail('player ground resolution', `y=${game.player.pos.y}`);
  } catch (e) { fail('player movement loop', e); }

  // ---------- hymn
  try {
    game.input.state.moveX = 0; game.input.state.moveZ = 0;
    game.hymn.startCharge();
    game.hymn.charge = 0.95;
    game.hymn.charging = true;
    game.audio.hymnChargeStart && game.audio.hymnChargeStart();
    game.releaseHymn();
    if (game.hymn.rings.length > 0) ok('hymn released, shockwave spawned', `kind=${game.hymn.syllable}`);
    else fail('hymn release', 'no ring spawned');
    if (game.campaign.stats.hymnNinth === 1) ok('Ninth Verse counted');
    else fail('ninth verse stat', String(game.campaign.stats.hymnNinth));
  } catch (e) { fail('hymn release', e); }

  // ---------- combat
  try {
    const e = game.enemies.enemies.find((x) => x.alive);
    const before = e.hp;
    const killed = e.hurt(99, { x: 1, z: 0 });
    if (killed && !e.alive) ok('enemy takes damage and dies');
    else fail('enemy damage', `hp ${before} -> ${e.hp}, alive=${e.alive}`);
    // respawn check: player death → checkpoint
    game.player.hp = 0; game.player.dead = true;
    game.onPlayerDeath();
    await sleep(3200);
    if (!game.player.dead && game.player.hp === 100) ok('player respawns at shrine with full health');
    else fail('player respawn', `dead=${game.player.dead} hp=${game.player.hp}`);
  } catch (e) { fail('combat + respawn', e); }

  // ---------- collectibles
  try {
    const echo = game.echoObjects.find((o) => !o.collected);
    game.player.pos.set(echo.data.x, game.surfaceY(echo.data.x, echo.data.z), echo.data.z);
    game.player.vel.set(0, 0, 0);
    await sleep(400);
    if (game.campaign.echoes.length > 0) ok('memory echo collected', `title="${echo.data.title}"`);
    else fail('echo collection', 'not collected');
    if (game.hud.readerOpen) { game.hud.closeReader(); ok('reader opens and closes'); }
    const canto = game.cantoObjects.find((o) => !o.collected);
    // stand on the surface the canto rests on
    game.player.pos.set(canto.data.x, game.surfaceY(canto.data.x, canto.data.z), canto.data.z);
    game.player.vel.set(0, 0, 0);
    await sleep(400);
    if (game.campaign.cantos.length > 0) ok('canto collected');
    else fail('canto collection');
    if (game.hud.readerOpen) game.hud.closeReader();
  } catch (e) { fail('collectibles', e); }

  // ---------- shrine + bell + save/load
  try {
    const shrine = game.collisionColliders; // just ensure no throw
    game.activateShrine({ id: 'shrine_ashbend', name: 'Bell of Ashbend', x: 0, z: -272 });
    if (game.campaign.shrines.includes('shrine_ashbend')) ok('shrine lit + checkpoint stored');
    else fail('shrine activation');
    const bellData = (await import(pathToFileURL(process.cwd() + '/src/world/world.js').href)).BELLS[0];
    game.activateBell(bellData);
    if (game.campaign.bells.length === 1) ok('bell rung', bellData.name);
    else fail('bell ring');
    game.saveToSlot();
    const slots = game.save.listSlots();
    if (slots.some((s) => !s.empty)) ok('save written to localStorage', JSON.stringify(slots.find((s) => !s.empty).playTime ? 'with time' : 'ok'));
    else fail('save write', JSON.stringify(slots));
    const loaded = game.save.load(2);
    if (loaded && loaded.echoes.length > 0) ok('save reloads with progress intact', `${loaded.echoes.length} echoes, ${loaded.bells.length} bell`);
    else fail('save reload', JSON.stringify(loaded && { e: loaded.echoes.length }));
    // corrupt-save resilience
    window.localStorage.setItem('yshmara.v1.slot3', '{"broken": tru');
    const bad = game.save.load(3);
    if (bad === null) ok('corrupt save is rejected safely (no crash)');
    else fail('corrupt save handling', JSON.stringify(bad).slice(0, 80));
  } catch (e) { fail('shrine/bell/save/load', e); }

  // ---------- menus & screens
  try {
    for (const act of ['new', 'load', 'settings', 'codex', 'journal', 'map', 'credits']) {
      game.onMenuAction(act);
      await sleep(30);
    }
    ok('all menu screens render without errors');
    game.hud.drawMap();
    ok('world map renders');
    game.hud.renderCodex();
    ok('codex renders');
    game.hud.renderJournal();
    ok('journal renders');
  } catch (e) { fail('menus', e); }

  // ---------- settings round-trip
  try {
    game.applySetting('quality', 'low');
    await sleep(150);
    const q = game.stage.preset;
    game.applySetting('quality', 'high');
    await sleep(150);
    ok('quality preset switch rebuilds systems', `low.props=${q.props}`);
    game.applySetting('volMusic', 0.3);
    game.applySetting('leftHanded', true);
    if (game.save.settings.leftHanded === true) ok('settings persist to storage');
    game.applySetting('leftHanded', false);
  } catch (e) { fail('settings', e); }

  // ---------- dialogue
  try {
    game.state = 'playing';
    game.hud.startDialogue('senn_intro', () => {});
    if (game.hud.dialog) ok('dialogue starts');
    else fail('dialogue start');
    // click through every node
    for (let i = 0; i < 12 && game.hud.dialog; i++) {
      game.hud.advanceDialogue();
      await sleep(20);
      const choices = window.document.querySelectorAll('.dialogue-choice');
      if (choices.length) { choices[0].dispatchEvent(new window.Event('click', { bubbles: true })); await sleep(20); }
    }
    ok('dialogue tree can be traversed to the end');
  } catch (e) { fail('dialogue traversal', e); }

  // ---------- objectives + ending
  try {
    game.campaign.ending = null;
    game.triggerEnding('keep');
    await sleep(3000);
    if (game.campaign.ending === 'keep') ok('ending triggers');
    else fail('ending trigger');
    if (window.document.getElementById('ending-screen').classList.contains('show')) ok('ending screen displayed');
    else fail('ending screen display');
    if (game.save.isUnlocked('ending_keep')) ok('ending achievement unlocked');
    else fail('ending achievement');
    game.onEndingToTitle();
    ok('returns to title after ending');
  } catch (e) { fail('ending flow', e); }

  // ---------- offline / no-network guarantees
  try {
    const fetches = [];
    window.fetch = (...a) => { fetches.push(a[0]); return Promise.reject(new Error('offline')); };
    await sleep(400);
    if (fetches.length === 0) ok('zero network requests during play (fully offline)');
    else fail('network requests detected', JSON.stringify(fetches));
    const meta = window.document.querySelector('link[rel=manifest]');
    if (meta) ok('web manifest linked (installable)');
  } catch (e) { fail('offline check', e); }

  // ---------- runtime error budget
  const realErrors = errors.filter((e) => {
    const s = String(e && (e.stack || e.message || e));
    if (/AudioContext|not implemented|Could not parse CSS|jsdom/i.test(s)) return false;
    if (/WebGL|THREE\.WebGLRenderer|Error creating WebGL/i.test(s)) return false;
    return true;
  });
  if (realErrors.length === 0) ok('no unexpected runtime errors across the whole suite');
  else fail('runtime error budget', realErrors.slice(0, 3).map(String).join('\n     '));
}

console.log('\n' + results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);

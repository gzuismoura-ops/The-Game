// Headless scene smoke test: builds EVERY world system with real three.js in Node.
// Catches shader/geometry/API errors without a browser. Node has no WebGL, so we stub the canvas.
globalThis.document = {
  createElement: () => null,      // forces texture functions to no-op safely
  createElementNS: () => null,
};
globalThis.self = globalThis;
if (!globalThis.window) globalThis.window = globalThis;
try { Object.defineProperty(globalThis, 'screen', { value: { width: 1920, height: 1080 }, configurable: true }); } catch {}
try { Object.defineProperty(globalThis, 'devicePixelRatio', { value: 1, configurable: true }); } catch {}

const THREE = await import('three');
const { QC } = { QC: (name) => ({ label: name, pixelRatio: 1, shadows: true, shadowSize: 1024, props: 1, waterDetail: 2, post: true, aa: true, foliage: 1, quality: name }) };

const results = [];
async function test(name, fn) {
  const t0 = Date.now();
  try { const r = await fn(); results.push({ name, ok: true, ms: Date.now() - t0, info: r }); }
  catch (e) { results.push({ name, ok: false, err: e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n') }); }
}

await test('world module', async () => {
  const W = await import('../src/world/world.js');
  const h = W.terrainHeight(0, 0);
  const props = W.getProps();
  return `height(0,0)=${h.toFixed(2)} propKinds=${Object.keys(props).length} echoes=${W.ECHOES.length}`;
});

await test('three builds scene graph', async () => {
  const scene = new THREE.Scene();
  const preset = QC('high');
  const W = await import('../src/world/world.js');
  const { buildTerrain } = await import('../src/world/terrainMesh.js');
  const terrain = buildTerrain(preset);
  scene.add(terrain);
  const inner = terrain.getObjectByName('terrain_inner');
  return `terrain verts=${inner.geometry.attributes.position.count} color=${!!inner.geometry.attributes.color} uv2=${!!inner.geometry.attributes.uv2}`;
});


await test('sky + water + lights', async () => {
  const scene = new THREE.Scene();
  const preset = QC('high');
  const { SkySystem } = await import('../src/world/sky.js');
  const { buildWater } = await import('../src/world/water.js');
  const sand = await import('../src/world/textures.js');
  const sky = new SkySystem(scene, preset);
  sky.applyLook({ zenith: 0x5b87a8, horizon: 0xcfd6d2, haze: 0xecdcc0, mood: 0.2, fogColor: 0xc9c0b0, fogDensity: 0.0034 });
  sky.followPlayer({ x: 0, y: 0, z: 0 }, 0.016, 1.0);
  const water = buildWater(preset, null);
  scene.add(water);
  return `children=${scene.children.length} sunI=${sky.sun.intensity}`;
});

await test('monuments (titan, shrines, maw, amphitheatre, bell chamber)', async () => {
  const preset = QC('high');
  const W = await import('../src/world/world.js');
  const M = await import('../src/world/monuments.js');
  const titan = M.buildTitan(preset);
  const shrines = M.buildShrine(W.SHRINES, preset);
  const maw = M.buildMaw(preset);
  const amphi = M.buildAmphitheatre(preset);
  const chamber = M.buildBellChamber(preset);
  titan.userData.update?.(1.2); maw.userData.update?.(1.2); chamber.userData.update?.(1.2);
  return `titanParts=${titan.children.length} shrines=${shrines.userData.bells.length}`;
});

await test('flora instancing', async () => {
  const scene = new THREE.Scene();
  const preset = QC('high');
  const { FloraSystem } = await import('../src/world/flora.js');
  const flora = new FloraSystem(scene, preset);
  flora.update(1.0, { x: 0, y: 0, z: 0 });
  const instanced = [];
  scene.traverse((o) => { if (o.isInstancedMesh) instanced.push(`${o.name}:${o.count}`); });
  return instanced.join(' ');
});

await test('villages', async () => {
  const preset = QC('high');
  const { buildVillages } = await import('../src/world/villages.js');
  const v = buildVillages(preset);
  v.userData.update?.(1.1);
  let meshes = 0; v.traverse((o) => { if (o.isMesh) meshes++; });
  return `meshes=${meshes} fires=${v.userData.fires.length}`;
});

await test('structures colliders & deck heights', async () => {
  const S = await import('../src/world/structures.js');
  const cols = S.structureColliders();
  const deck = S.deckHeightAt(0, -296);
  const kellDeck = S.deckHeightAt(-44, -56);
  if (deck === null) throw new Error('ashbend deck missing');
  if (Math.abs(kellDeck - 1.55) > 0.01) throw new Error('kell deck wrong: ' + kellDeck);
  return `colliders=${cols.length} ashbendDeckY=${deck} kellDeckY=${kellDeck}`;
});

await test('GLSL shader parse (real GLSL grammar)', async () => {
  const fs = await import('node:fs');
  const { parser } = await import('@shaderfrog/glsl-parser');
  const files = ['src/world/terrainMesh.js', 'src/world/water.js', 'src/world/sky.js', 'src/core/stage.js', 'src/entities/player.js', 'src/systems/effects.js'];
  let parsed = 0;
  const problems = [];
  for (const f of files) {
    let src;
    try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const blocks = src.match(/\/\* glsl \*\/`[\s\S]*?`/g) || [];
    for (let i = 0; i < blocks.length; i++) {
      let code = blocks[i].replace(/\/\* glsl \*\//, '').replace(/^`|`$/g, '');
      const isVert = code.includes('gl_Position');
      const prelude = isVert
        ? 'precision highp float;\nuniform mat4 modelMatrix; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; uniform mat4 viewMatrix; uniform mat3 normalMatrix; uniform vec3 cameraPosition;\nattribute vec3 position; attribute vec3 normal; attribute vec2 uv; attribute vec3 color; attribute vec4 uv2;\n'
        : 'precision highp float;\nuniform mat4 viewMatrix; uniform vec3 cameraPosition;\n';
      const full = prelude + code;
      try { parser.parse(full, { quiet: true }); parsed++; }
      catch (e) { problems.push(`${f}#${i} (${isVert ? 'vert' : 'frag'}): ${String(e.message).slice(0, 200)}`); }
    }
  }
  if (problems.length) throw new Error('\n     ' + problems.join('\n     '));
  return `${parsed} shader blocks parsed with a real GLSL grammar`;
});

for (const r of results) {
  console.log(r.ok ? `PASS ${r.name} (${r.ms}ms) ${r.info ?? ''}` : `FAIL ${r.name}\n   ${r.err}`);
}
process.exit(results.every((r) => r.ok) ? 0 : 1);

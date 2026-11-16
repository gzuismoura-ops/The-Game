// Y'SMARA — THE HOLLOW HYMN
// Entry point and game orchestrator. Boots the stage, builds the world, runs the loop, owns the
// state machine (title → play → pause → ending), autosaves, and never requires the network.
import './ui/style.css';
import * as THREE from 'three';
import { Stage, detectQuality, QUALITY_PRESETS } from './core/stage.js';
import { clamp, lerp, damp, TAU, dist2d, smoothstep, easeOutCubic } from './core/math.js';
import {
  WORLD, TITLE, SUBTITLE, ECHOES, CANTOS, BELLS, SHRINES, SECRETS, NPCS, CHARMS,
  REGIONS, terrainHeight, regionAt, regionBlend, footstepMaterialAt, waterDepthAt, GAME_CONSTANTS as C,
} from './world/world.js';
import { buildTerrain } from './world/terrainMesh.js';
import { SkySystem } from './world/sky.js';
import { buildWater } from './world/water.js';
import { FloraSystem } from './world/flora.js';
import { buildVillages } from './world/villages.js';
import { buildTitan, buildShrine, buildMaw, buildAmphitheatre, buildBellChamber } from './world/monuments.js';
import { structureColliders, deckHeightAt, landmarkPins } from './world/structures.js';
import { generateRippleTexture } from './world/textures.js';
import { Player } from './entities/player.js';
import { EnemySystem } from './entities/enemies.js';
import { CameraRig } from './systems/cameraRig.js';
import { InputSystem } from './systems/input.js';
import { HymnSystem } from './systems/hymn.js';
import { EffectsSystem } from './systems/effects.js';
import { AudioSystem } from './systems/audio.js';
import { SaveSystem } from './systems/save.js';
import { HUD } from './ui/hud.js';
import { OBJECTIVES, createQuestState, INTRO_SCRIPT } from './narrative/quest.js';

const boot = (pct, txt) => {
  try { window.__hud?.setBootProgress(pct, txt); } catch {}
};

class Game {
  constructor() {
    this.canvas = document.getElementById('glcanvas');
    this.state = 'boot';           // boot | title | playing | paused | dialogue | cinematic | ending
    this.slot = 1;
    this.campaign = this.freshCampaign();
    this.fps = 60;
    this._fpsAccum = 0; this._fpsFrames = 0;
    this.clock = 0;
    this.damageFlash = 0;
    this.currentPrompt = null;
    this.compassTarget = null;
    this.stickVisual = null;
    this.timeScale = 1;
    this.paused = false;
    this.raf = 0;
    this.lastT = performance.now();
    this.autosaveTimer = 0;
  }

  freshCampaign() {
    return {
      echoes: [], cantos: [], bells: [], shrines: [], secrets: [], charms: [],
      objectives: [], objectiveIndex: 0, flags: {}, visited: {}, playTime: 0,
      stats: { kills: 0, echoesFound: 0, deaths: 0, distance: 0, hymnNinth: 0 },
      regionName: 'Ashbend', ending: null, checkpoint: null,
    };
  }

  // ================================================================== BOOT
  async init() {
    boot(0.02, 'Waking the coast…');
    this.save = new SaveSystem();
    this.audio = new AudioSystem();

    // quality detection
    let q = this.save.settings.quality;
    if (q === 'auto') q = detectQuality();
    this.qualityName = q;
    const preset = QUALITY_PRESETS[q] || QUALITY_PRESETS.high;

    try {
      this.stage = new Stage(this.canvas);
    } catch (e) {
      document.getElementById('fatal').style.display = 'block';
      document.getElementById('fatal-detail').textContent = e.message;
      return;
    }
    const p = this.stage.setQuality(q);
    p.quality = q;
    this.preset = p;

    boot(0.10, 'Shaping the drowned coast…');
    await frame();

    // ---- world
    this.worldGroup = new THREE.Group();
    this.stage.scene.add(this.worldGroup);

    this.sky = new SkySystem(this.stage.scene, p);
    this.terrain = buildTerrain(p);
    this.worldGroup.add(this.terrain);
    boot(0.26, 'Painting salt and stone…');
    await frame();

    this.rippleTex = generateRippleTexture();
    this.water = buildWater(p, this.rippleTex);
    this.worldGroup.add(this.water);
    boot(0.38, 'Raising the Kneeling One…');
    await frame();

    this.titan = buildTitan(p);
    this.worldGroup.add(this.titan);
    this.shrineGroup = buildShrine(SHRINES, p);
    this.worldGroup.add(this.shrineGroup);
    this.maw = buildMaw(p);
    this.worldGroup.add(this.maw);
    this.amphitheatre = buildAmphitheatre(p);
    this.worldGroup.add(this.amphitheatre);
    this.bellChamber = buildBellChamber(p);
    this.worldGroup.add(this.bellChamber);
    this.villages = buildVillages(p);
    this.worldGroup.add(this.villages);
    boot(0.55, 'Growing the salt reeds…');
    await frame();

    this.flora = new FloraSystem(this.worldGroup, p);
    boot(0.70, 'Waking the Mutes…');
    await frame();

    this.enemies = new EnemySystem(this.stage.scene, p);
    this.enemies.spawnAll((await import('./world/world.js')).SPAWN_ZONES);
    this.effects = new EffectsSystem(this.stage.scene, p);
    this.hymn = new HymnSystem(this.stage.scene, p);
    boot(0.82, 'Carving the echoes…');
    await frame();

    // ---- collectibles (echoes, cantos, secrets, npc markers)
    this.collectibleGroup = new THREE.Group();
    this.stage.scene.add(this.collectibleGroup);
    this.buildCollectibles();
    boot(0.90, 'Listening…');
    await frame();

    // ---- player & camera
    this.player = new Player(p);
    this.stage.scene.add(this.player.root);
    this.cameraRig = new CameraRig(this.stage.camera, this.player);
    this.input = new InputSystem(this.canvas, {
      onAction: (a) => this.onInputAction(a),
      onStickVisual: (on, ox, oy, x, y) => this.hud?.updateStickVisual(on, ox, oy, x, y),
    });

    // ---- ui
    this.hud = new HUD(this);
    window.__hud = this.hud;
    this.hud.refreshTitle();
    this.hud.refreshSettings();

    this.collisionColliders = structureColliders();
    // add prop colliders from flora (rocks, coral, trees are solid)
    const { getColliders } = await import('./world/world.js');
    this.collisionColliders = this.collisionColliders.concat(getColliders());
    // spatial hash for fast prop collision (2.4k+ props would be slow per-frame)
    this.buildCollisionGrid();

    this.applySettingsToSystems();

    boot(0.97, 'Ready.');
    await frame();
    this.hud.hideBoot();
    this.toTitle();
    this.loop();
  }

  buildCollisionGrid() {
    this.grid = new Map();
    this.gridCell = 8;
    for (const c of this.collisionColliders) {
      const gx = Math.floor(c.x / this.gridCell), gz = Math.floor(c.z / this.gridCell);
      const key = `${gx},${gz}`;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(c);
    }
    this.nearbyColliders = (x, z, radius = 1.5) => {
      const out = [];
      const r = Math.ceil(radius / this.gridCell);
      const gx0 = Math.floor(x / this.gridCell), gz0 = Math.floor(z / this.gridCell);
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const list = this.grid.get(`${gx0 + dx},${gz0 + dz}`);
        if (list) out.push(...list);
      }
      return out;
    };
  }

  /** Walkable surface height at a point: decks/ramps win over raw terrain. */
  surfaceY(x, z, fallback = 0) {
    const deck = deckHeightAt(x, z);
    const t = terrainHeight(x, z);
    if (deck !== null && deck >= t - 0.6) return deck;
    return Number.isFinite(t) ? t : fallback;
  }

  buildCollectibles() {
    // echoes: floating motes of memory
    this.echoObjects = [];
    ECHOES.forEach((e, i) => {
      const g = new THREE.Group();
      g.position.set(e.x, this.surfaceY(e.x, e.z) + 1.5, e.z);
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.22, 0),
        new THREE.MeshBasicMaterial({ color: 0x9fe8d8, transparent: true, opacity: 0.9 }),
      );
      g.add(core);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this.flora && this.flora.windMats[0] ? null : null,
        color: 0x7fe3d4, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      g.add(halo);
      this.collectibleGroup.add(g);
      this.echoObjects.push({ data: e, group: g, core, halo, collected: false, phase: i * 0.7 });
    });

    // cantos: stone tablets
    this.cantoObjects = [];
    CANTOS.forEach((c, i) => {
      const g = new THREE.Group();
      g.position.set(c.x, Math.max(this.surfaceY(c.x, c.z) + 1.0, (c.y || 0) > terrainHeight(c.x, c.z) + 1.2 ? c.y + 0.9 : -Infinity), c.z);
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 1.0, 0.16),
        new THREE.MeshStandardMaterial({ color: 0x8a8274, roughness: 0.9 }),
      );
      slab.rotation.x = -0.2;
      g.add(slab);
      const glyph = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.66), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.7 }));
      glyph.position.z = 0.09;
      g.add(glyph);
      this.collectibleGroup.add(g);
      this.cantoObjects.push({ data: c, group: g, collected: false, phase: i });
    });

    // secrets: hidden alcoves that reveal charms
    this.secretObjects = [];
    SECRETS.forEach((s, i) => {
      const g = new THREE.Group();
      g.position.set(s.x, this.surfaceY(s.x, s.z) + 0.8, s.z);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 5, 20), new THREE.MeshBasicMaterial({ color: 0xc8a0ff, transparent: true, opacity: 0.6 }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const charm = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), new THREE.MeshStandardMaterial({ color: s.reward === 'charm_glass' ? 0xcfe8f2 : 0xb8a0ff, emissive: 0x3a2a6a, emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.6 }));
      charm.position.y = 0.9;
      g.add(charm);
      this.collectibleGroup.add(g);
      this.secretObjects.push({ data: s, group: g, charm, ring, collected: false, phase: i * 1.3 });
    });

    // NPC markers: a small floating rune over each character
    this.npcObjects = [];
    NPCS.forEach((n) => {
      const g = new THREE.Group();
      // NPCs stand on whatever surface is authored beneath them (deck, coral shelf or ground)
      const authored = typeof n.y === 'number' ? n.y : null;
      const gy = this.surfaceY(n.x, n.z);
      const finalY = authored !== null && authored > gy + 1.0 ? authored : gy;
      g.position.set(n.x, finalY, n.z);
      // simple stylised NPC figure (cloaked, distinct silhouette per role)
      const npcMesh = this.buildNpcMesh(n);
      g.add(npcMesh);
      this.stage.scene.add(g);
      this.npcObjects.push({ data: n, group: g, mesh: npcMesh, talked: false });
    });
  }

  buildNpcMesh(npc) {
    const group = new THREE.Group();
    const color = npc.color;
    const robeMat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.05 });
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.45), roughness: 0.95 });
    const h = npc.id === 'marrow' ? 2.6 : npc.id === 'senn' ? 1.55 : 1.7;

    if (npc.id === 'marrow') {
      // the Marrow Warden: a coral-encrusted pillar of a creature
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, h, 9, 4), robeMat);
      body.position.y = h / 2;
      group.add(body);
      for (let i = 0; i < 7; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6 + Math.random() * 0.5, 4), robeMat);
        const a = (i / 7) * TAU;
        spike.position.set(Math.cos(a) * 0.65, 0.6 + Math.random() * h * 0.7, Math.sin(a) * 0.65);
        spike.rotation.z = Math.cos(a) * 0.5;
        spike.rotation.x = -Math.sin(a) * 0.5;
        group.add(spike);
      }
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), darkMat);
      head.position.y = h + 0.1;
      group.add(head);
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x9fe8d8 });
      for (const ex of [-0.14, 0.14]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), eyeMat);
        e.position.set(ex, h + 0.14, 0.28);
        group.add(e);
      }
    } else if (npc.id === 'orin') {
      // Orin: a figure made of held breath — thin, luminous, trembling
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.34, h, 8, 4), new THREE.MeshStandardMaterial({
        color: 0xbfc8d0, roughness: 0.6, transparent: true, opacity: 0.72,
        emissive: 0x6a8a9a, emissiveIntensity: 0.7,
      }));
      body.position.y = h / 2;
      group.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.85 }));
      head.position.y = h + 0.05;
      group.add(head);
      // note ribbons escaping upward
      for (let i = 0; i < 5; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.16 + i * 0.1, 0.012, 4, 14), new THREE.MeshBasicMaterial({ color: 0xc8e8ff, transparent: true, opacity: 0.4 }));
        t.position.y = h * 0.5 + i * 0.28;
        t.rotation.x = Math.PI / 2;
        t.rotation.y = i * 0.5;
        group.add(t);
      }
    } else {
      // villagers: robed, hooded, with a distinguishing prop
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.40, h * 0.82, 8, 3), robeMat);
      body.position.y = h * 0.41;
      group.add(body);
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.19, 10, 8, 0, TAU, 0, Math.PI * 0.62), darkMat);
      hood.position.y = h * 0.86;
      group.add(hood);
      const face = new THREE.Mesh(new THREE.SphereGeometry(0.135, 9, 7), new THREE.MeshStandardMaterial({ color: 0xa8886a, roughness: 0.8 }));
      face.position.set(0, h * 0.85, 0.03);
      group.add(face);
      // prop per character
      if (npc.id === 'senn') {
        const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 1.9, 5), darkMat);
        staff.position.set(0.28, 0.9, 0.06);
        staff.rotation.z = 0.1;
        group.add(staff);
        const bell = new THREE.Mesh(new THREE.LatheGeometry((() => { const p = []; for (let i = 0; i <= 8; i++) { const t = i / 8; p.push(new THREE.Vector2(0.04 + Math.sin(t * Math.PI * 0.9) * 0.12, -t * 0.26)); } return p; })(), 10), new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 0.85, roughness: 0.35 }));
        bell.position.set(0.28, 1.78, 0.06);
        group.add(bell);
      } else if (npc.id === 'wren') {
        const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 7), new THREE.MeshStandardMaterial({ color: 0xd8c8a0 }));
        roll.position.set(-0.3, 1.0, 0.0);
        roll.rotation.z = 1.4;
        group.add(roll);
      } else if (npc.id === 'tol') {
        const sack = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 7), new THREE.MeshStandardMaterial({ color: 0x6a5a48 }));
        sack.position.set(0.3, 0.5, -0.1);
        sack.scale.set(1, 1.2, 0.8);
        group.add(sack);
      }
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
      for (const ex of [-0.05, 0.05]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.016, 5, 4), eyeMat);
        e.position.set(ex, h * 0.85, 0.14);
        group.add(e);
      }
    }

    group.traverse((o) => { if (o.isMesh) { o.castShadow = this.preset.shadows; } });
    return group;
  }

  // ================================================================== STATE
  toTitle() {
    this.state = 'title';
    this.hud.hideScreens();
    this.hud.show('title');
    this.hud.setHudVisible(false);
    this.hud.setLetterbox(false);
    // park the camera on a hero shot of the coast
    this.titleCameraT = 0;
    this.player.root.visible = false;
    this.cameraRig.cinematic = null;
    this.audio.setDuck(0.75);
    this.audio.updateAmbience({ region: 'kneeling', wading: 0, mood: 0.35 });
    this.audio.setMusicContext({ scale: 'dorian', root: 146.83, mood: 0.35 });
  }

  newGame(slot) {
    this.slot = slot;
    this.campaign = this.freshCampaign();
    this.player.pos.set(-4, terrainHeight(-4, -288) + 0.1, -288);
    this.player.pos.y = deckHeightAt(this.player.pos.x, this.player.pos.z) ?? this.player.pos.y;
    this.player.facing = Math.PI;   // facing the village/titan
    this.player.hp = C.hpMax;
    this.player.dead = false;
    this.player.stamina = C.staminaMax;
    this.cameraRig.yaw = 0;
    this.cameraRig.pitch = -0.1;
    this.cameraRig.initialized = false;
    this.resetWorldEntities();
    this.startIntro();
  }

  loadGame(slot) {
    const data = this.save.load(slot);
    if (!data) { this.hud.toast({ icon: '✕', title: 'Nothing to load', text: 'That thread is empty.' }); return false; }
    this.slot = slot;
    this.campaign = data;
    this.player.pos.set(data.player.x, data.player.y, data.player.z);
    this.player.facing = data.player.yaw || 0;
    this.player.hp = data.player.hp;
    this.player.dead = false;
    this.player.stamina = C.staminaMax;
    this.cameraRig.yaw = (data.player.yaw || 0) + Math.PI;
    this.cameraRig.initialized = false;
    this.resetWorldEntities();
    this.hud.hideScreens();
    this.hud.setHudVisible(true);
    this.state = 'playing';
    this.audio.unlock();
    this.hud.toast({ icon: '◈', title: 'Journey resumed', text: data.regionName || 'The coast' });
    return true;
  }

  /** Re-apply campaign state to the world (on load/new game). */
  resetWorldEntities() {
    this.echoObjects.forEach((o) => {
      o.collected = this.campaign.echoes.includes(o.data.id);
      o.group.visible = !o.collected;
    });
    this.cantoObjects.forEach((o) => {
      o.collected = this.campaign.cantos.includes(o.data.id);
      o.group.visible = !o.collected;
    });
    this.secretObjects.forEach((o) => {
      o.collected = this.campaign.secrets.includes(o.data.id);
      o.group.visible = !o.collected;
    });
    this.enemies.enemies.forEach((e) => { e.root.visible = true; });
    this.player.root.visible = true;
    this.hud.setHudVisible(true);
    this.hud.setLetterbox(false);
    this.hud.hideEnding();
  }

  startIntro() {
    this.state = 'cinematic';
    this.hud.hideScreens();
    this.hud.setHudVisible(false);
    this.player.root.visible = false;
    this.hud.setLetterbox(true);
    this.audio.unlock();
    this.audio.setDuck(0.35);
    // intro camera: wide reveal of the Kneeling One at dawn
    this.cameraRig.playCinematic([
      { pos: { x: -58, y: 64, z: -246 }, look: { x: 0, y: 46, z: -306 }, fov: 46, time: 5.0 },
      { pos: { x: -18, y: 42, z: -286 }, look: { x: 0, y: 36, z: -300 }, fov: 58, time: 4.5 },
      { pos: { x: 6, y: 38, z: -292 }, look: { x: 0, y: 34.5, z: -302 }, fov: 62, time: 3.4 },
    ], () => {
      this.hud.setLetterbox(false);
      this.hud.hideCinematicText();
      this.state = 'playing';
      this.hud.setHudVisible(true);
      this.player.root.visible = true;
      this.audio.setDuck(1);
      this.showTutorial();
    });
    // scripted lines
    this._introTimers = INTRO_SCRIPT.map((s) => setTimeout(() => {
      if (s.kind === 'line') this.hud.showCinematicText(s.speaker, s.text, 3400);
      if (s.kind === 'tutorial') this.hud.showHint(s.text, 6000);
    }, s.t * 1000));
  }

  showTutorial() {
    setTimeout(() => this.hud.showHint('HOLD ◎ TO SING · RELEASE TO SHAPE THE SYLLABLE', 7000), 1800);
    setTimeout(() => this.hud.showHint('LEFT SIDE: MOVE · RIGHT SIDE: LOOK', 5000), 10000);
  }

  // ================================================================== INPUT ACTIONS
  onInputAction(action) {
    if (this.state === 'paused' || this.state === 'title') {
      if (action === 'pause' && this.state === 'paused') this.resume();
      return;
    }
    if (this.state !== 'playing') return;

    switch (action) {
      case 'jump':
        break; // handled by polling
      case 'sing':
        this.audio.unlock();
        if (this.hymn.startCharge()) {
          this.audio.hymnChargeStart();
        }
        break;
      case 'dodge':
        this.audio.dodge();
        break;
      case 'interact':
        this.tryInteract();
        break;
      case 'tap': {
        // a tap on the right side: interact if something is near, otherwise sing a short note
        if (this.currentPrompt) this.tryInteract();
        else {
          this.audio.unlock();
          if (this.hymn.startCharge()) { this.audio.hymnChargeStart(); setTimeout(() => this.releaseHymn(), 140); }
        }
        break;
      }
      case 'pause': this.pause(); break;
      case 'map': this.onMenuAction('map'); break;
      default: break;
    }
  }

  releaseHymn() {
    if (!this.hymn.charging) return;
    this.audio.hymnChargeStop();
    let radius = 12;   // filled by onHymn before the caller reads the result
    const res = this.hymn.release(this.player, this.enemies.enemies, {
      shake: (a) => this.cameraRig.addShake(a),
      onHymn: (kind, hits, r) => {
        radius = r || radius;
        this.audio.hymnRelease(kind);
        this.effects.hymnBurst(this.player.pos, radius, kind);
        if (kind === 'ninth') this.campaign.stats.hymnNinth++;
        if (hits.length) {
          this.cameraRig.addShake(kind === 'ninth' ? 0.3 : 0.14);
          this.hud.toast({ icon: '◊', title: kind === 'ninth' ? 'NINTH VERSE' : 'THE HYMN LANDS', text: `${hits.length} Mute${hits.length > 1 ? 's' : ''} silenced` });
          if (kind === 'ninth') this.unlockAch('hymn_master');
          for (const h of hits) {
            this.effects.hitSpark(h.enemy.pos, { r: 1, g: 0.85, b: 0.5 }, 1.4);
            this.audio.enemyHurt(h.enemy.type);
            if (h.killed) {
              this.audio.enemyDie(h.enemy.type);
              this.campaign.stats.kills++;
              this.effects.puff(h.enemy.pos, 0x9fe8d8, 1.8, 0.9);
            }
          }
        }
      },
      verseCharm: this.campaign.charms.includes('charm_verse'),
    });
    if (res && res.hits.length === 0) {
      // no hit: still play the sound and a soft puff for feedback
      this.effects.hymnBurst(this.player.pos, res.radius * 0.4, res.kind);
    }
    if (this.save.settings.vibration && navigator.vibrate && res) {
      navigator.vibrate(res.kind === 'ninth' ? [18, 26, 30] : 14);
    }
  }

  tryInteract() {
    const p = this.player.pos;
    // shrines
    for (const s of SHRINES) {
      if (dist2d(p.x, p.z, s.x, s.z) < 4.0) {
        this.activateShrine(s);
        return;
      }
    }
    // bells
    for (const b of BELLS) {
      if (dist2d(p.x, p.z, b.x, b.z) < 5.0) {
        this.activateBell(b);
        return;
      }
    }
    // npcs
    for (const n of this.npcObjects) {
      const ny = n.group.position.y;
      const dy = Math.abs(p.y - ny);
      if (dist2d(p.x, p.z, n.data.x, n.data.z) < 4.2 && dy < 4.5) {
        this.talkTo(n);
        return;
      }
    }
    // the maw decision
    if (dist2d(p.x, p.z, 4, 262) < 12 && this.campaign.flags.talkedOrin) {
      this.talkTo(this.npcObjects.find((n) => n.data.id === 'orin'));
      return;
    }
  }

  // ================================================================== WORLD INTERACTIONS
  activateShrine(s) {
    this.audio.unlock();
    this.audio.bell(196);
    this.hud.toast({ icon: '◇', title: s.name, text: 'Shrine lit — progress saved.' });
    if (!this.campaign.shrines.includes(s.id)) {
      this.campaign.shrines.push(s.id);
      this.campaign.checkpoint = { x: s.x, y: terrainHeight(s.x, s.z) + 0.5, z: s.z, yaw: this.player.facing };
    }
    this.saveToSlot();
    this.checkAchievements();
    this.cameraRig.addShake(0.06);
  }

  activateBell(b) {
    if (this.campaign.bells.includes(b.id)) {
      this.hud.toast({ icon: '🔔', title: b.name, text: 'This bell has already answered you.' });
      return;
    }
    this.audio.unlock();
    this.audio.bell(b.id === 'bell_hollow' ? 146.83 : b.id === 'bell_glass' ? 220 : 174.61);
    this.campaign.bells.push(b.id);
    this.cameraRig.addShake(0.22);
    this.hud.toast({ icon: '🔔', title: b.name, text: 'The bell answers. Something far south listens.' });
    this.effects.hymnBurst({ x: b.x, y: terrainHeight(b.x, b.z) + 2, z: b.z }, 16, 'ninth');
    this.campaign.checkpoint = { x: b.x, y: terrainHeight(b.x, b.z) + 0.5, z: b.z, yaw: this.player.facing };
    this.saveToSlot();
    if (this.campaign.bells.length === 1) this.unlockAch('first_bell');
    if (this.campaign.bells.length >= 2) this.unlockAch('two_bells');
    if (this.campaign.bells.length >= 3) {
      this.unlockAch('all_bells');
      this.campaign.flags.hollowOpen = true;
      setTimeout(() => {
        this.hud.toast({ icon: '✦', title: 'THE HOLLOW OPENS', text: 'A door, not a mouth. Go south.' });
        this.audio.heartbeat();
      }, 2200);
    }
    this.checkAchievements();
  }

  talkTo(npcObj) {
    const n = npcObj.data;
    this.audio.unlock();
    const key = this.getDialogueKey(n.id);
    this.forEachPause();
    this.hud.startDialogue(key, () => {
      this.afterDialogue(n.id);
      this.forEachResume();
    });
  }

  getDialogueKey(id) {
    const f = this.campaign.flags;
    if (id === 'senn') return f.talkedSenn ? 'senn_repeat' : 'senn_intro';
    if (id === 'wren') return f.talkedWren ? 'wren_repeat' : 'wren_intro';
    if (id === 'tol') return f.talkedTol ? 'tol_repeat' : 'tol_intro';
    if (id === 'marrow') return f.talkedMarrow ? 'marrow_repeat' : 'marrow_intro';
    if (id === 'orin') return 'orin_intro';
    return null;
  }

  afterDialogue(id) {
    const f = this.campaign.flags;
    if (id === 'senn' && !f.talkedSenn) {
      f.talkedSenn = true;
      this.hud.toast({ icon: '◈', title: 'Objective updated', text: 'Follow the causeway down to the Silt Shallows.' });
    }
    if (id === 'wren' && !f.talkedWren) {
      f.talkedWren = true;
      this.unlockAch('kell_met');
      this.hud.toast({ icon: '⚓', title: 'Wren\'s map', text: 'The Ossuary is east. The Glass Reach is west. The Hollow is south.' });
    }
    if (id === 'tol') f.talkedTol = true;
    if (id === 'marrow') f.talkedMarrow = true;
    if (id === 'orin') {
      f.talkedOrin = true;
      this.campaign.objectiveIndex = Math.max(this.campaign.objectiveIndex, 6);
    }
    this.advanceObjectives();
    this.saveToSlot();
  }

  forEachPause() { this.dialogueOpen = true; this.audio.setDuck(0.28); }
  forEachResume() { this.dialogueOpen = false; this.audio.setDuck(this.state === 'playing' ? 1 : 0.75); }

  setDialogueOpen(open) {
    this.dialogueOpen = open;
    this.audio.setDuck(open ? 0.3 : 1);
  }

  /**
   * Advance the objective chain. Objectives complete strictly in order; each is
   * checked by one small predicate. The loop guards against multiple objectives
   * completing in a single frame (e.g. loading a save that satisfies several).
   */
  advanceObjectives() {
    const f = this.campaign.flags;
    const conditions = {
      wake: () => this.campaign.shrines.includes('shrine_ashbend') && !!f.talkedSenn,
      descend: () => !!f.leftAshbend,
      find_wren: () => !!f.talkedWren,
      ring_bells: () => this.campaign.bells.length >= 3,
      reach_hollow: () => !!f.enteredHollow,
      meet_orin: () => !!f.talkedOrin,
      decide: () => !!this.campaign.ending,
    };

    for (let guard = 0; guard < OBJECTIVES.length; guard++) {
      const cur = OBJECTIVES[this.campaign.objectiveIndex];
      if (!cur) break;
      const check = conditions[cur.id];
      if (!check || !check()) break;
      this.campaign.objectiveIndex++;
      const next = OBJECTIVES[this.campaign.objectiveIndex];
      if (next) this.hud.toast({ icon: '◎', title: 'New objective', text: next.title });
    }
  }

  triggerEnding(kind) {
    if (this.campaign.ending) return;
    this.campaign.ending = kind;
    this.state = 'ending';
    this.audio.setDuck(0.2);
    this.audio.hymnRelease('ninth');
    this.cameraRig.addShake(0.5);
    this.hud.setLetterbox(true);
    this.audio.bell(kind === 'rest' ? 220 : 146.83);
    this.unlockAch(kind === 'rest' ? 'ending_rest' : 'ending_keep');
    this.saveToSlot();
    setTimeout(() => {
      this.campaign.playTime = this.campaign.playTime || 0;
      this.hud.showEnding(
        kind, this.campaign,
        () => this.onEndingContinue(),
        () => this.onEndingToTitle(),
      );
    }, 2600);
  }

  onEndingContinue() {
    this.hud.hideEnding();
    this.hud.setLetterbox(false);
    this.state = 'playing';
    this.hud.setHudVisible(true);
    this.audio.setDuck(1);
    // return the player to the checkpoint with the world changed slightly
    const cp = this.campaign.checkpoint;
    if (cp) this.player.pos.set(cp.x, cp.y, cp.z);
    this.hud.toast({ icon: '✺', title: 'The coast remains', text: 'You can keep exploring. Every echo is still out there.' });
    this.campaign.flags.postEnding = true;
  }

  onEndingToTitle() {
    this.hud.hideEnding();
    this.state = 'title';
    this.hud.setHudVisible(false);
    this.hud.show('title');
    this.player.root.visible = false;
    this.audio.setDuck(0.75);
  }

  // ================================================================== MENU ACTIONS
  onMenuAction(act) {
    switch (act) {
      case 'new': this.hud.show('slots'); this.slotsMode = 'new'; document.getElementById('slots-title').innerHTML = 'New Journey<small>Three threads. One coast.</small>'; break;
      case 'load': this.hud.show('slots'); this.slotsMode = 'load'; document.getElementById('slots-title').innerHTML = 'Load Journey<small>Return to the coast</small>'; break;
      case 'continue': {
        const slots = this.save.listSlots().filter((s) => !s.empty).sort((a, b) => b.savedAt - a.savedAt);
        if (slots.length) this.loadGame(slots[0].slot);
        break;
      }
      case 'settings': this._prevScreen = this.state === 'paused' ? 'pause' : 'title'; this.hud.show('settings'); break;
      case 'codex': this._prevScreen = 'title'; this.hud.show('codex'); break;
      case 'credits': this._prevScreen = 'title'; this.hud.show('credits'); break;
      case 'journal': this.hud.show('journal'); break;
      case 'map': this.hud.show('map'); this.hud.drawMap(); break;
      case 'pause': this.pause(); break;
      default: break;
    }
  }

  onSlotChosen(slot) {
    if (this.slotsMode === 'load') {
      this.loadGame(slot);
    } else {
      // confirm overwrite if the slot has data
      const existing = this.save.listSlots().find((s) => s.slot === slot);
      if (existing && !existing.empty) {
        if (!confirm('This thread already holds a journey. Begin a new one and overwrite it?')) return;
      }
      this.newGame(slot);
    }
  }

  onCloseScreen() {
    if (this.state === 'paused') { this.hud.show('pause'); return; }
    if (this.state === 'playing' || this.state === 'ending') { this.hud.hideScreens(); return; }
    this.hud.show('title');
  }

  onPauseAction(act) {
    switch (act) {
      case 'resume': this.resume(); break;
      case 'journal': this.hud.show('journal'); break;
      case 'map': this.hud.show('map'); this.hud.drawMap(); break;
      case 'settings': this.hud.show('settings'); break;
      case 'save': this.saveToSlot(); this.hud.toast({ icon: '◈', title: 'Saved', text: 'This journey is stored on your device.' }); break;
      case 'title': this.saveToSlot(); this.toTitle(); break;
      default: break;
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.save.settings; // no-op keeps linter calm
    this.hud.show('pause');
    document.getElementById('pause-region').textContent = regionAt(this.player.pos.x, this.player.pos.z).name;
    this.audio.setDuck(0.4);
    this.audio.uiOpen();
    this.saveToSlot();
    this.input.keys.clear();
    this.player.vel.set(0, 0, 0);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.hideScreens();
    this.audio.setDuck(this.dialogueOpen ? 0.3 : 1);
  }

  /** Save to the active slot (or autosave slot 0 if the player never picked one). */
  saveToSlot() {
    if (!this.campaign) return;
    const c = this.campaign;
    c.playTime = (c.playTime || 0) + 0;
    const state = {
      ...c,
      player: {
        x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z,
        yaw: this.player.facing, hp: Math.max(1, this.player.hp),
      },
      regionName: regionAt(this.player.pos.x, this.player.pos.z).name,
    };
    this.save.save(this.slot || 1, state);
    this.save.autosave(state);
  }

  // ================================================================== SETTINGS
  applySetting(key, value) {
    this.save.saveSettings({ [key]: value });
    this.applySettingsToSystems();
  }

  applySettingsToSystems() {
    const s = this.save.settings;
    this.audio.setVolumes({ master: s.volMaster, music: s.volMusic, sfx: s.volSfx, ambience: s.volAmbience });
    this.audio.musicEnabled = s.volMusic > 0.001;
    this.input.setLayout({ leftHanded: s.leftHanded });
    this.input.setSensitivity(s.sensitivity);
    if (this.cameraRig) this.cameraRig.fovBase = s.fov;
    if (this.stage && s.quality !== 'auto') {
      const qn = s.quality;
      if (qn !== this.qualityName) {
        this.qualityName = qn;
        const p = this.stage.setQuality(qn);
        p.quality = qn;
        this.preset = p;
        this.stage.renderer.shadowMap.enabled = s.shadows && p.shadows;
        this.sky.sun.castShadow = s.shadows && p.shadows;
        // rebuild heavy systems that bake quality into geometry
        this.rebuildForQuality(qn);
      }
    }
    if (this.stage) {
      this.stage.preset.post = s.postFX;
      this.stage.renderer.shadowMap.enabled = s.shadows && this.stage.preset.shadows;
      if (this.sky) this.sky.sun.castShadow = s.shadows && this.stage.preset.shadows;
    }
    this.hud?.refreshSettings();
  }

  rebuildForQuality(qn) {
    const p = QUALITY_PRESETS[qn];
    p.quality = qn;
    // flora density is baked: rebuild it (cheap enough at <100ms)
    if (this.flora) {
      this.worldGroup.remove(this.flora.group);
      this.flora.group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
      this.flora = new FloraSystem(this.worldGroup, p);
    }
  }

  unlockAch(id) {
    const def = this.save.unlock(id);
    if (def) {
      this.hud.toast({ icon: '✦', title: def.name, text: def.desc, duration: 4200 });
      this.audio.unlock && this.audio.ready && this.audio.uiOpen();
    }
  }

  checkAchievements() {
    const c = this.campaign;
    if (c.shrines.includes('shrine_ashbend')) this.unlockAch('first_breath');
    if (c.flags.leftAshbend) this.unlockAch('wake');
    if (c.echoes.length >= 5) this.unlockAch('echo_5');
    if (c.echoes.length >= 12) this.unlockAch('echo_12');
    if (c.echoes.length >= ECHOES.length) this.unlockAch('echo_all');
    if (c.cantos.length >= CANTOS.length) this.unlockAch('canto_all');
    if (c.secrets.length >= 1) this.unlockAch('secret_1');
    if (c.secrets.length >= SECRETS.length) this.unlockAch('secret_all');
    if (Object.keys(c.visited).filter((k) => c.visited[k]).length >= REGIONS.length) this.unlockAch('explorer');
  }

  // ================================================================== LOOP
  loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (dt > 0.1) dt = 0.1;             // clamp: backgrounded tabs must not teleport physics
    if (dt <= 0) dt = 1 / 60;
    this._fpsAccum += dt; this._fpsFrames++;
    if (this._fpsAccum > 0.5) {
      this.fps = this._fpsFrames / this._fpsAccum;
      this._fpsAccum = 0; this._fpsFrames = 0;
    }
    this.clock += dt;

    try {
      this.update(dt);
      this.render(dt);
    } catch (e) {
      console.error("[Y'SMARA] era de execução:", e);
      this._errors = (this._errors || 0) + 1;
      // Surface persistent failures instead of leaving the player with a frozen or
      // blank view. One-off errors stay silent; three in a row means something is wrong.
      if (this._errors === 3) {
        this.hud?.toast({ icon: '⚠', title: 'Recuperado de um erro', text: 'O jogo continuou rodando.' });
      }
      if (this._errors === 12) {
        this.showRuntimeWarning(e);
      }
    }
  };

  update(dt) {
    const playing = this.state === 'playing';
    this.input.poll(dt);
    const camD = this.input.consumeCamDelta();

    // ---------- title camera drift (hero shot)
    if (this.state === 'title') {
      this.titleCameraT = (this.titleCameraT || 0) + dt * 0.08;
      const a = this.titleCameraT;
      const cam = this.stage.camera;
      const radius = 88;
      cam.position.set(Math.sin(a) * radius - 10, 52 + Math.sin(a * 1.7) * 8, -300 + Math.cos(a) * radius);
      cam.lookAt(0, 44, -310);
      cam.fov = 58;
      cam.updateProjectionMatrix();
      this.sky.followPlayer({ x: 0, y: 0, z: -300 }, dt, this.clock);
      this.sky.followCamera(this.stage.camera);
      const titleLook = this.regionLook('kneeling', 0.35);
      this.sky.applyLook(titleLook);
      this.applyTerrainLook(titleLook);
      this.terrain.userData.update(this.clock);
      this.water.userData.update(this.clock);
      this.flora.update(this.clock, { x: 0, y: 0, z: -300 }, 1);
      this.titan.userData.update(this.clock);
      this.maw.userData.update(this.clock);
      this.bellChamber.userData.update(this.clock);
      this.villages.userData.update(this.clock);
      this.enemies.update(dt, this.player, {});
      this.audio.updateMusic(dt, 0.15);
      this.hud.update(dt);
      return;
    }

    // ---------- dialogue / pause: world breathes but nobody moves
    const frozen = this.state === 'paused' || this.dialogueOpen || this.state === 'ending' || this.state === 'cinematic';

    if (!frozen) {
      // ---- player
      const inputForPlayer = {
        moveX: this.input.state.moveX, moveZ: this.input.state.moveZ,
        camYaw: this.cameraRig.yaw, sprint: this.input.state.sprint || this.save.settings.autoSprint,
        jump: this.input.state.jump, dodge: this.input.state.dodge,
      };
      // singing slows you: commitment to the note
      if (this.hymn.charging) {
        inputForPlayer.moveX *= 0.45;
        inputForPlayer.moveZ *= 0.45;
        inputForPlayer.sprint = false;
      }
      const prevY = this.player.pos.y;
      this.player.update(dt, inputForPlayer, {
        colliders: this.nearbyColliders(this.player.pos.x, this.player.pos.z, 2.5),
        bounds: WORLD.half - 6,
        onFootstep: (pos, wading) => {
          const mat = footstepMaterialAt(pos.x, pos.z);
          this.audio.footstep(mat, 0.75 + Math.random() * 0.4);
          if (wading > 0.12) this.effects.splash(pos, 1, wading);
          else if (Math.random() > 0.45) this.effects.dust(pos, 1);
        },
        onWade: (pos, wading) => { if (Math.random() > 0.72) this.effects.wakeRing(pos); },
        onFallDamage: (impact) => {
          this.audio.land(Math.min(1.6, impact / 20));
          this.cameraRig.addShake(0.25);
          this.damageFlash = 0.85;
        },
      });

      // ---- hymn charge, held
      if (this.hymn.charging) {
        this.hymn.update(dt, this.player, { onCharge: (c) => this.audio.hymnChargeUpdate(c) });
        // releasing the button ends the charge
        if (!this.input.state.sing) this.releaseHymn();
      } else {
        this.hymn.update(dt, this.player, { verseCharm: this.campaign.charms.includes('charm_verse') });
        if (this.input.state.sing && this.hymn.cooldown <= 0) {
          this.audio.unlock();
          if (this.hymn.startCharge()) this.audio.hymnChargeStart();
        }
      }

      // ---- enemies
      this.enemies.update(dt, this.player, {
        canSee: (e, p) => {
          const d = dist2d(e.pos.x, e.pos.z, p.pos.x, p.pos.z);
          if (d > e.def.aggro) return false;
          // crude line of sight: sample the terrain between
          const steps = Math.min(8, Math.floor(d / 3));
          for (let i = 1; i < steps; i++) {
            const t = i / steps;
            const x = lerp(e.pos.x, p.pos.x, t), z = lerp(e.pos.z, p.pos.z, t);
            const h = terrainHeight(x, z);
            const ly = lerp(e.pos.y + e.height * 0.7, p.pos.y + 1.4, t);
            if (h > ly + 0.6) return false;
          }
          return true;
        },
        onAttack: (e, dmg, dir) => {
          if (this.player.hurt(dmg, dir)) {
            this.audio.hurt();
            this.damageFlash = 1;
            this.cameraRig.addShake(0.3);
            if (this.save.settings.vibration && navigator.vibrate) navigator.vibrate([12, 20, 16]);
            if (this.player.dead) this.onPlayerDeath();
          }
        },
        onRanged: (e, pos, dir) => {
          this.audio.enemyAlert();
          this.effects.puff(pos, 0xffb055, 1.4, 0.7);
          // shockwave: damage if the player is close and in front
          const d = dist2d(pos.x, pos.z, this.player.pos.x, this.player.pos.z);
          if (d < 8) {
            const toP = { x: this.player.pos.x - e.pos.x, z: this.player.pos.z - e.pos.z };
            const len = Math.hypot(toP.x, toP.z) || 1;
            const dot = (toP.x / len) * dir.x + (toP.z / len) * dir.z;
            if (dot > 0.25) {
              if (this.player.hurt(11, { x: -dir.x, z: -dir.z })) {
                this.audio.hurt(); this.damageFlash = 1; this.cameraRig.addShake(0.22);
              }
            }
          }
        },
      });
    }

    // ---- camera (drag delta from this frame only)
    this.cameraRig.update(dt, {
      camDX: camD.dx, camDY: camD.dy, camHold: this.input.state.camHold, pinch: camD.pinch,
    }, {});

    // ---- world animation
    this.sky.followPlayer(this.player.pos, dt, this.clock);
    this.sky.followCamera(this.stage.camera);
    const reg = regionAt(this.player.pos.x, this.player.pos.z);
    this.currentRegion = reg;
    const look = this.regionLook(reg.id, this.hymn.charge);
    this.sky.applyLook(look);
    this.applyTerrainLook(look);
    this.terrain.userData.update(this.clock);
    this.water.userData.update(this.clock);
    this.flora.update(this.clock, this.player.pos, 1 + this.hymn.lastLoudness * 1.6);
    this.titan.userData.update(this.clock + 12);
    this.maw.userData.update(this.clock);
    this.bellChamber.userData.update(this.clock);
    this.villages.userData.update(this.clock);
    this.amphitheatre.userData.update?.(this.clock);
    this.effects.update(dt, this.stage.camera);

    // ---- collectibles
    this.updateCollectibles(dt);

    // ---- prompts + proximity
    this.updatePrompts();

    // ---- region discovery
    if (!this.campaign.visited[reg.id]) {
      this.campaign.visited[reg.id] = true;
      this.hud.toast({ icon: '❂', title: reg.name, text: reg.blurb, duration: 5200 });
      this.checkAchievements();
    }
    if (reg.id === 'hollow' && !this.campaign.flags.enteredHollow) {
      this.campaign.flags.enteredHollow = true;
      this.advanceObjectives();
    }
    if (this.campaign.flags.leftAshbend === undefined && this.player.pos.z > -250) {
      this.campaign.flags.leftAshbend = true;
      this.advanceObjectives();
    }

    // ---- audio
    this.audio.updateAmbience({ region: reg.id, wading: this.player.wading, mood: reg.mood });
    this.audio.setMusicContext({ scale: reg.scale, root: reg.root, mood: reg.mood });
    const threat = this.enemies.aliveNear(this.player.pos.x, this.player.pos.z, 30).length;
    this.audio.updateMusic(dt, clamp(0.25 + threat * 0.22));

    // ---- timers
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.8);
    if (this.state === 'playing') {
      this.campaign.playTime += dt;
      this.autosaveTimer += dt;
      if (this.autosaveTimer > 45) { this.autosaveTimer = 0; this.saveToSlot(); }
    }
    if (this.player.dead && this.state === 'playing') this.onPlayerDeath();

    this.hud.update(dt);
  }

  /**
   * Push the active region's atmosphere into the terrain and water shaders.
   * Without this the terrain keeps its construction-time warm haze forever and every
   * area looks the same — the per-region palettes never reach a pixel.
   */
  applyTerrainLook(look) {
    if (!this.terrain || !look) return;
    const u = this.terrain.userData && this.terrain.userData.uniforms;
    if (!u) return;
    if (u.uFogColor) u.uFogColor.value.setHex(look.fogColor);
    if (u.uFogDensity) u.uFogDensity.value = look.fogDensity;
    if (u.uAmbient) u.uAmbient.value.setRGB(0.42, 0.50, 0.60).multiplyScalar(Math.max(0.35, look.hemiIntensity));
    if (u.uSunColor) u.uSunColor.value.setHex(look.sunColor);
    if (u.uSunDir && look.sunDir) u.uSunDir.value.copy(look.sunDir).normalize();
    const wu = this.water && this.water.userData && this.water.userData.uniforms;
    if (wu) {
      if (wu.uFogColor) wu.uFogColor.value.setHex(look.fogColor);
      if (wu.uFogDensity) wu.uFogDensity.value = look.fogDensity;
      if (wu.uSunColor) wu.uSunColor.value.setHex(look.sunColor);
    }
  }

  regionLook(regionId, charge = 0) {
    // each region gets its own light, sky and fog — the core of the "living place" feel
    const base = {
      kneeling: { zenith: 0x5b87a8, horizon: 0xcfd6d2, haze: 0xecdcc0, sunColor: 0xfff0d8, sunIntensity: 3.1, hemiSky: 0xbcd2e6, hemiGround: 0x8a7f66, hemiIntensity: 1.05, mood: 0.30, cloudCover: 0.85, fogColor: 0xc9c1ae, fogDensity: 0.0029 },
      shallows: { zenith: 0x6f9ab6, horizon: 0xd6d9cf, haze: 0xf2e2c4, sunColor: 0xfff3dd, sunIntensity: 3.3, hemiSky: 0xc8dcea, hemiGround: 0x8f8568, hemiIntensity: 1.12, mood: 0.42, cloudCover: 0.75, fogColor: 0xd4cab0, fogDensity: 0.0032 },
      ossuary: { zenith: 0x4a6a78, horizon: 0x9fb0ac, haze: 0xc4d8cd, sunColor: 0xe8f4e8, sunIntensity: 2.5, hemiSky: 0x9fc4c0, hemiGround: 0x5f6a58, hemiIntensity: 0.95, mood: 0.55, cloudCover: 0.92, fogColor: 0xa8bdb4, fogDensity: 0.0042 },
      glass: { zenith: 0x7a95b0, horizon: 0xdfe4e2, haze: 0xf0eee6, sunColor: 0xfff6e6, sunIntensity: 3.5, hemiSky: 0xd4e4ee, hemiGround: 0xa8a294, hemiIntensity: 1.2, mood: 0.40, cloudCover: 0.62, fogColor: 0xdde2de, fogDensity: 0.0026 },
      hollow: { zenith: 0x3a4248, horizon: 0x6a6a66, haze: 0x8a8478, sunColor: 0xd8c8a8, sunIntensity: 1.9, hemiSky: 0x7a8488, hemiGround: 0x4a4640, hemiIntensity: 0.82, mood: 0.88, cloudCover: 0.98, fogColor: 0x807a70, fogDensity: 0.0052 },
    }[regionId] || {};
    // singing bends the light: the world dims and warms while you gather breath
    if (charge > 0.01) {
      base.sunIntensity *= 1 - charge * 0.28;
      base.mood = Math.min(1, base.mood + charge * 0.3);
      base.fogDensity *= 1 + charge * 0.25;
      base.hemiIntensity *= 1 - charge * 0.12;
    }
    const sunDir = new THREE.Vector3(0.36, 0.66, 0.66);
    return { ...base, sunDir };
  }

  updateCollectibles(dt) {
    const t = this.clock;
    const p = this.player.pos;
    const echoCharm = this.campaign.charms.includes('charm_echo');
    const echoRange = echoCharm ? 6.0 : 3.6;

    for (const o of this.echoObjects) {
      if (o.collected) continue;
      const g = o.group;
      const baseY = this.surfaceY(o.data.x, o.data.z) + 1.5;
      g.position.y = baseY + Math.sin(t * 1.2 + o.phase) * 0.22;
      o.core.rotation.y += dt * 0.9;
      o.core.rotation.x += dt * 0.45;
      const d = dist2d(p.x, p.z, o.data.x, o.data.z);
      const dy = Math.abs(p.y + 1 - g.position.y);
      o.core.material.opacity = 0.55 + Math.sin(t * 2 + o.phase) * 0.28;
      // drift toward the player when close (a memory wanting to be heard)
      if (d < 14) {
        const pull = (1 - d / 14) * 2.4;
        g.position.x += (p.x - o.data.x) * pull * dt * 0.35;
        g.position.z += (p.z - o.data.z) * pull * dt * 0.35;
      } else {
        g.position.x = lerp(g.position.x, o.data.x, dt * 2);
        g.position.z = lerp(g.position.z, o.data.z, dt * 2);
      }
      const reach = echoRange + (echoCharm ? 2 : 0);
      if (d < reach && dy < 3.4) this.collectEcho(o);
    }

    for (const o of this.cantoObjects) {
      if (o.collected) continue;
      o.group.rotation.y = Math.sin(t * 0.5 + o.phase) * 0.2;
      const d = dist2d(p.x, p.z, o.data.x, o.data.z);
      const dy = Math.abs(p.y - o.group.position.y);
      if (d < 3.2 && dy < 3.0) this.collectCanto(o);
    }

    for (const o of this.secretObjects) {
      if (o.collected) continue;
      o.charm.rotation.y += dt * 0.8;
      o.charm.position.y = 0.9 + Math.sin(t * 1.1 + o.phase) * 0.12;
      o.ring.rotation.z += dt * 0.3;
      const d = dist2d(p.x, p.z, o.data.x, o.data.z);
      if (d < 3.4 && Math.abs(p.y - o.group.position.y) < 4) this.collectSecret(o);
    }
  }

  collectEcho(o) {
    o.collected = true;
    o.group.visible = false;
    this.campaign.echoes.push(o.data.id);
    this.campaign.stats.echoesFound++;
    this.audio.pickupEcho();
    this.effects.hymnBurst({ x: o.data.x, y: this.surfaceY(o.data.x, o.data.z) + 1.5, z: o.data.z }, 2.4, 'tune');
    const n = this.campaign.echoes.length;
    this.hud.openReader('Memory Echo', o.data.title, o.data.lines, `Echo ${n} of ${ECHOES.length}`);
    this.advanceObjectives();
    this.checkAchievements();
    this.saveToSlot();
  }

  collectCanto(o) {
    o.collected = true;
    o.group.visible = false;
    this.campaign.cantos.push(o.data.id);
    this.audio.unlock();
    this.audio.bell(294);
    this.hud.openReader('Canto of the Choir', o.data.title, [o.data.text], `Canto ${this.campaign.cantos.length} of ${CANTOS.length}`);
    this.checkAchievements();
    this.saveToSlot();
  }

  collectSecret(o) {
    o.collected = true;
    o.group.visible = false;
    this.campaign.secrets.push(o.data.id);
    if (o.data.reward && !this.campaign.charms.includes(o.data.reward)) {
      this.campaign.charms.push(o.data.reward);
      const charm = CHARMS.find((c) => c.id === o.data.reward);
      this.hud.toast({ icon: '⌘', title: o.data.name, text: charm ? `Charm found: ${charm.name}` : 'A secret found.' });
      this.audio.unlock();
    }
    this.hud.openReader('Secret Place', o.data.name, [o.data.desc], `${this.campaign.secrets.length} of ${SECRETS.length} found`);
    this.checkAchievements();
    this.saveToSlot();
  }

  updatePrompts() {
    const p = this.player.pos;
    let prompt = null;
    let target = null;

    for (const s of SHRINES) {
      if (dist2d(p.x, p.z, s.x, s.z) < 4.0) {
        prompt = this.campaign.shrines.includes(s.id) ? `Rest at ${s.name}` : `Light ${s.name}`;
        target = { x: s.x, z: s.z };
        break;
      }
    }
    if (!prompt) for (const b of BELLS) {
      if (dist2d(p.x, p.z, b.x, b.z) < 5.0) {
        prompt = this.campaign.bells.includes(b.id) ? `${b.name}` : `Ring ${b.name}`;
        target = { x: b.x, z: b.z };
        break;
      }
    }
    if (!prompt) for (const n of this.npcObjects) {
      const dy = Math.abs(p.y - n.group.position.y);
      if (dist2d(p.x, p.z, n.data.x, n.data.z) < 4.2 && dy < 4.5) {
        prompt = `Speak with ${n.data.name}`;
        target = { x: n.data.x, z: n.data.z };
        break;
      }
    }
    this.currentPrompt = prompt;
    this.compassTarget = target || this.objectiveTarget();

    // hide the HUD prompt while a dialogue or reader is open
    if (this.dialogueOpen || this.hud.readerOpen) this.currentPrompt = null;
  }

  objectiveTarget() {
    const idx = this.campaign.objectiveIndex;
    const cur = OBJECTIVES[idx];
    if (!cur) return null;
    if (cur.mark) return cur.mark;
    if (cur.id === 'ring_bells') {
      const remaining = BELLS.filter((b) => !this.campaign.bells.includes(b.id));
      if (remaining.length) return { x: remaining[0].x, z: remaining[0].z };
    }
    if (cur.id === 'meet_orin' || cur.id === 'decide') return { x: 0, z: 274 };
    return null;
  }

  onPlayerDeath() {
    if (this.state === 'dying') return;
    this.state = 'dying';
    this.campaign.stats.deaths++;
    this.audio.hurt();
    this.audio.hymnRelease('ninth');
    this.cameraRig.addShake(0.5);
    this.hud.showCinematicText('', 'The coast listens for you. It does not hear anything yet.', 3000);
    setTimeout(() => {
      // respawn at checkpoint with restored health
      const cp = this.campaign.checkpoint || { x: -4, y: terrainHeight(-4, -288), z: -288 };
      this.player.pos.set(cp.x, cp.y + 0.4, cp.z);
      this.player.hp = C.hpMax;
      this.player.stamina = C.staminaMax;
      this.player.dead = false;
      this.player.vel.set(0, 0, 0);
      this.state = 'playing';
      this.damageFlash = 0;
      this.hud.hideCinematicText();
      this.hud.toast({ icon: '☾', title: 'You wake at the last shrine', text: 'The coast gives you another breath.' });
      this.enemies.enemies.forEach((e) => { if (e.alive) { e.state = 'idle'; e.aggro = false; } });
    }, 2800);
  }

  /**
   * Persistent failure: explain what happened, in Portuguese, and offer the one action
   * that actually helps (drop to the lightest preset). Never a silent black screen.
   */
  showRuntimeWarning(err) {
    if (this._warned) return;
    this._warned = true;
    try {
      const box = document.getElementById('fatal');
      const detail = document.getElementById('fatal-detail');
      if (detail) {
        detail.innerHTML =
          'O jogo encontrou um problema repetido ao desenhar a cena.<br><br>' +
          '<b>O que tentar:</b><br>' +
          '1. Toque em <b>Qualidade mínima</b> abaixo.<br>' +
          '2. Se continuar, feche e abra o jogo de novo.<br><br>' +
          '<code>' + String(err && err.message ? err.message : err).slice(0, 220) + '</code>';
        const btn = document.createElement('button');
        btn.textContent = 'Qualidade mínima';
        btn.className = 'btn';
        btn.style.marginTop = '14px';
        btn.onclick = () => {
          try {
            this.save.settings.quality = 'potato';
            this.save.saveSettings?.();
            this.applySettingsToSystems();
            this._errors = 0;
            this._warned = false;
            if (box) box.style.display = 'none';
          } catch { /* last resort */ }
        };
        detail.appendChild(document.createElement('br'));
        detail.appendChild(btn);
      }
      if (box) box.style.display = 'block';
    } catch { /* DOM unavailable */ }
  }

  // ================================================================== RENDER
  render(dt) {
    // fade in/out for cinematic transitions
    let fade = 1;
    if (this.state === 'cinematic') fade = 1;
    const damage = this.damageFlash * 0.55 + (this.player.hp < 30 && this.state === 'playing' ? (1 - this.player.hp / 30) * 0.28 : 0);
    this.stage.render(this.clock, fade, damage);
  }
}

function frame() { return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); }

// -------------------------------------------------------------------------------
// BOOTSTRAP
// -------------------------------------------------------------------------------
const game = new Game();
window.__game = game;

(async () => {
  try {
    await game.init();
  } catch (e) {
    console.error(e);
    document.getElementById('fatal').style.display = 'block';
    document.getElementById('fatal-detail').textContent = (e && e.stack) || String(e);
  }
})();

// pause the audio when the app is backgrounded (battery + policy friendliness)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    game.audio?.suspend();
    if (game.state === 'playing') game.pause();
  } else {
    game.audio?.resume();
    game.lastT = performance.now();
  }
});
window.addEventListener('pagehide', () => { try { game.saveToSlot(); } catch {} });

// resume audio on the first touch anywhere (mobile autoplay policy)
const unlockOnce = () => { game.audio?.unlock(); window.removeEventListener('pointerdown', unlockOnce); };
window.addEventListener('pointerdown', unlockOnce, { once: true });

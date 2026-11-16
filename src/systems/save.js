// Y'SMARA — persistence.
// Everything lives in localStorage: three save slots + settings + achievements. No accounts,
// no network, survives app restarts. Corrupt data can never brick the game (validated + repaired).
import { SAVE_NAMESPACE, ECHOES, CANTOS, SHRINES, BELLS, SECRETS } from '../world/world.js';

const SAVE_VERSION_TAG = 3;
const SETTINGS_KEY = `${SAVE_NAMESPACE}.settings`;
const ACH_KEY = `${SAVE_NAMESPACE}.achievements`;
const slotKey = (n) => `${SAVE_NAMESPACE}.slot${n}`;

export const ACHIEVEMENTS = [
  { id: 'first_breath', name: 'Primeiro Fôlego', desc: 'Aprenda a cantar. A costa lembra.', icon: '◎' },
  { id: 'wake', name: 'A Ouvinte Acorda', desc: 'Deixe Ashbend rumo ao mundo afogado.', icon: '◈' },
  { id: 'kell_met', name: 'Sal e Rancor', desc: 'Encontre Wren em Kell.', icon: '⚓' },
  { id: 'first_bell', name: 'Segundo Sino', desc: 'Toque o Dobrar do Tutano no Ossuário de Coral.', icon: '🔔' },
  { id: 'two_bells', name: 'Duas Vozes', desc: 'Toque dois dos três sinos perdidos.', icon: '♪' },
  { id: 'all_bells', name: 'O Não Tocado', desc: 'Toque os três sinos. Orin está escutando.', icon: '✦' },
  { id: 'echo_5', name: 'Colecionadora de Pequenas Dores', desc: 'Recupere 5 ecos de memória.', icon: '❖' },
  { id: 'echo_12', name: 'Meio Lembrado', desc: 'Recupere 12 ecos de memória.', icon: '❖' },
  { id: 'echo_all', name: 'Inteira', desc: 'Recupere todos os ecos de memória da costa.', icon: '❈' },
  { id: 'canto_all', name: 'Cantora', desc: 'Encontre os oito cantos.', icon: '✧' },
  { id: 'secret_1', name: 'Fora do Caminho', desc: 'Descubra seu primeiro lugar secreto.', icon: '⌘' },
  { id: 'secret_all', name: 'Cada Canto Escutando', desc: 'Descubra os cinco lugares secretos.', icon: '⌘' },
  { id: 'hymn_master', name: 'Três Sílabas', desc: 'Acerte um Nono Verso em combate pela primeira vez.', icon: '◊' },
  { id: 'survivor', name: 'Ainda Respirando', desc: 'Sobreviva ao Oco com um Cão, um Espectro e uma Casca todos cientes de você.', icon: '☾' },
  { id: 'ending_rest', name: 'Deixe Descansar', desc: 'Termine o Nono Verso.', icon: '✺' },
  { id: 'ending_keep', name: 'Guarde a Nota', desc: 'Recuse-se a terminar o Verso e mantenha o mundo aberto.', icon: '∞' },
  { id: 'explorer', name: 'Cinco Alcances', desc: 'Visite as cinco regiões da costa.', icon: '❂' },
  { id: 'night_swim', name: 'Vadeando no Luar', desc: 'Entre na água acima do peito por 10 segundos.', icon: '≈' },
];

function safeParse(raw) {
  try { return JSON.parse(raw); } catch { return null; }
}

export class SaveSystem {
  constructor() {
    this.settings = this.loadSettings();
    this.achievements = this.loadAchievements();
  }

  // ---------------------------------------------------------------- settings
  defaultSettings() {
    return {
      quality: 'auto', shadows: true, postFX: true, fov: 66,
      volMaster: 0.85, volMusic: 0.55, volSfx: 0.85, volAmbience: 0.6,
      leftHanded: false, sensitivity: 1.0, invertY: false,
      showFps: false, hudScale: 1.0, reduceMotion: false, language: 'en',
      subtitles: true, autoSprint: false, vibration: true,
    };
  }

  loadSettings() {
    const raw = safeParse(localStorage.getItem(SETTINGS_KEY));
    return { ...this.defaultSettings(), ...(raw && typeof raw === 'object' ? raw : {}) };
  }

  saveSettings(partial) {
    this.settings = { ...this.settings, ...partial };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* quota */ }
    return this.settings;
  }

  // ---------------------------------------------------------------- achievements
  loadAchievements() {
    const raw = safeParse(localStorage.getItem(ACH_KEY));
    return { unlocked: (raw && typeof raw.unlocked === 'object' && raw.unlocked) || {}, newest: null };
  }

  unlock(achievementId) {
    if (this.achievements.unlocked[achievementId]) return null;
    const def = ACHIEVEMENTS.find((a) => a.id === achievementId);
    if (!def) return null;
    this.achievements.unlocked[achievementId] = Date.now();
    this.achievements.newest = achievementId;
    try { localStorage.setItem(ACH_KEY, JSON.stringify(this.achievements)); } catch (e) { /* quota */ }
    return def;
  }

  isUnlocked(id) { return !!this.achievements.unlocked[id]; }
  achievementCount() { return Object.keys(this.achievements.unlocked).length; }

  // ---------------------------------------------------------------- slots
  listSlots() {
    const out = [];
    for (let i = 1; i <= 3; i++) {
      const raw = safeParse(localStorage.getItem(slotKey(i)));
      if (!raw || raw.version !== SAVE_VERSION_TAG) { out.push({ slot: i, empty: true }); continue; }
      out.push({
        slot: i, empty: false,
        savedAt: raw.savedAt,
        playTime: raw.playTime || 0,
        echoes: (raw.echoes || []).length,
        cantos: (raw.cantos || []).length,
        bells: (raw.bells || []).length,
        region: raw.regionName || 'The Silt Shallows',
        ending: raw.ending || null,
      });
    }
    return out;
  }

  hasAnySave() { return this.listSlots().some((s) => !s.empty); }

  load(slot) {
    const raw = safeParse(localStorage.getItem(slotKey(slot)));
    if (!raw) return null;
    return this.validate(raw);
  }

  /** Validate + repair: a save can never crash the game. */
  validate(raw) {
    const valid = (arr, pool) => (Array.isArray(arr) ? arr : []).filter((id) => pool.some((p) => p.id === id));
    const v = {
      version: SAVE_VERSION_TAG,
      slot: raw.slot || 1,
      savedAt: raw.savedAt || Date.now(),
      playTime: typeof raw.playTime === 'number' ? raw.playTime : 0,
      player: {
        x: Number.isFinite(raw.player?.x) ? raw.player.x : -6,
        y: Number.isFinite(raw.player?.y) ? raw.player.y : 40,
        z: Number.isFinite(raw.player?.z) ? raw.player.z : -286,
        yaw: Number.isFinite(raw.player?.yaw) ? raw.player.yaw : 0,
        hp: Number.isFinite(raw.player?.hp) ? Math.max(1, Math.min(100, raw.player.hp)) : 100,
      },
      echoes: valid(raw.echoes, ECHOES),
      cantos: valid(raw.cantos, CANTOS),
      bells: valid(raw.bells, BELLS),
      shrines: valid(raw.shrines, SHRINES),
      secrets: valid(raw.secrets, SECRETS),
      charms: Array.isArray(raw.charms) ? raw.charms : [],
      objectives: Array.isArray(raw.objectives) ? raw.objectives : [],
      objectiveIndex: Number.isFinite(raw.objectiveIndex) ? raw.objectiveIndex : 0,
      flags: raw.flags && typeof raw.flags === 'object' ? raw.flags : {},
      visited: raw.visited && typeof raw.visited === 'object' ? raw.visited : {},
      stats: {
        kills: Number(raw.stats?.kills) || 0,
        echoesFound: Number(raw.stats?.echoesFound) || 0,
        deaths: Number(raw.stats?.deaths) || 0,
        distance: Number(raw.stats?.distance) || 0,
        hymnNinth: Number(raw.stats?.hymnNinth) || 0,
      },
      regionName: typeof raw.regionName === 'string' ? raw.regionName : 'The Shallows',
      ending: raw.ending || null,
      checkpoint: raw.checkpoint && typeof raw.checkpoint === 'object'
        ? { x: Number(raw.checkpoint.x) || -6, y: Number(raw.checkpoint.y) || 40, z: Number(raw.checkpoint.z) || -286, yaw: Number(raw.checkpoint.yaw) || 0 }
        : null,
    };
    return v;
  }

  save(slot, state) {
    const payload = { ...state, version: SAVE_VERSION_TAG, slot, savedAt: Date.now() };
    try {
      localStorage.setItem(slotKey(slot), JSON.stringify(payload));
      return true;
    } catch (e) {
      return false;
    }
  }

  autosave(state) { return this.save(0, state); }
  loadAutosave() { return this.load(0); }

  deleteSlot(slot) {
    try { localStorage.removeItem(slotKey(slot)); return true; } catch (e) { return false; }
  }

  wipeAll() {
    try {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(ACH_KEY);
      for (let i = 0; i <= 3; i++) localStorage.removeItem(slotKey(i));
      this.settings = this.defaultSettings();
      this.achievements = { unlocked: {}, newest: null };
      return true;
    } catch (e) { return false; }
  }

  /** Rough storage footprint, shown in the settings screen so players can trust "offline". */
  storageInfo() {
    let bytes = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(SAVE_NAMESPACE)) bytes += (localStorage.getItem(k) || '').length * 2;
      }
    } catch (e) { /* ignore */ }
    return { bytes };
  }
}

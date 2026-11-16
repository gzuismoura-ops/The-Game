// Y'SMARA — audio.
// 100% procedural: synthesized SFX, a generative adaptive score in four modal scales, and
// environmental ambience. No audio files, no downloads, works offline, ~0 bytes on disk.
import { clamp, lerp, makeRng, TAU } from '../core/math.js';

const SCALES = {
  dorian:    [0, 2, 3, 5, 7, 9, 10],
  aeolian:   [0, 2, 3, 5, 7, 8, 10],
  phrygian:  [0, 1, 3, 5, 7, 8, 10],
  lydian:    [0, 2, 4, 6, 7, 9, 11],
  locrian:   [0, 1, 3, 5, 6, 8, 10],
};

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.ambBus = null;
    this.volumes = { master: 0.85, music: 0.55, sfx: 0.85, ambience: 0.6 };
    this.muted = false;
    this.musicEnabled = true;
    this.currentScale = 'aeolian';
    this.currentRoot = 130.81;
    this.mood = 0.4;
    this.musicTimer = 0;
    this.musicStep = 0;
    this.rng = makeRng(70707);
    this.ambNodes = [];
    this.ambienceType = 'wind';
    this.lastFootstep = 0;
    this.duck = 1;
    this._unlocked = false;
  }

  /** Must be called from a user gesture (mobile autoplay policy). */
  async unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    await this.ctx.resume();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;
    // gentle master limiter so layered notes never clip on phone speakers
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 18; comp.ratio.value = 3.5;
    comp.attack.value = 0.004; comp.release.value = 0.24;
    this.master.connect(comp).connect(ctx.destination);

    this.musicBus = ctx.createGain(); this.musicBus.gain.value = this.volumes.music;
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.volumes.sfx;
    this.ambBus = ctx.createGain(); this.ambBus.gain.value = this.volumes.ambience;

    // reverb via synthesized impulse response (no files)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.9, 2.4);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.32;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb); this.reverb.connect(this.reverbGain).connect(this.master);
    this.sfxBus.connect(this.master);
    this.sfxBus.connect(this.reverb);
    this.ambBus.connect(this.master);

    this.ready = true;
    this._unlocked = true;
    this.startAmbience('wind');
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (0.6 + 0.4 * Math.sin(i * 0.001));
      }
    }
    return buf;
  }

  setVolumes({ master, music, sfx, ambience }) {
    if (master !== undefined) { this.volumes.master = master; if (this.master) this.master.gain.value = master; }
    if (music !== undefined) { this.volumes.music = music; if (this.musicBus) this.musicBus.gain.value = music; }
    if (sfx !== undefined) { this.volumes.sfx = sfx; if (this.sfxBus) this.sfxBus.gain.value = sfx; }
    if (ambience !== undefined) { this.volumes.ambience = ambience; if (this.ambBus) this.ambBus.gain.value = ambience; }
  }

  // ------------------------------------------------------------------ synthesis primitives
  noiseBuffer(seconds = 1) {
    if (!this._noise) {
      const rate = this.ctx.sampleRate;
      const len = Math.floor(rate * seconds);
      const buf = this.ctx.createBuffer(1, len, rate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }

  playTone({ freq, dur = 0.3, type = 'sine', gain = 0.2, attack = 0.005, decay = null, detune = 0, pan = 0, bus = null, filter = null, when = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const g = ctx.createGain();
    const target = bus || this.sfxBus;
    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type || 'lowpass';
      f.frequency.value = filter.freq || 1200;
      f.Q.value = filter.q || 1;
      node.connect(f); node = f;
    }
    node.connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p).connect(target);
    } else {
      g.connect(target);
    }
    const peak = gain;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    const dec = decay ?? dur;
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dec);
    osc.start(t0);
    osc.stop(t0 + attack + dec + 0.05);
    return { osc, gain: g };
  }

  playNoise({ dur = 0.3, gain = 0.15, type = 'lowpass', freq = 900, q = 1, attack = 0.004, pan = 0, bus = null, when = 0, sweepTo = null }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
    const g = ctx.createGain();
    src.connect(f).connect(g);
    if (pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1);
      g.connect(p).connect(bus || this.sfxBus);
    } else g.connect(bus || this.sfxBus);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur);
    src.start(t0);
    src.stop(t0 + attack + dur + 0.05);
  }

  // ------------------------------------------------------------------ SFX
  footstep(surface, intensity = 1) {
    if (!this.ready) return;
    const v = clamp(intensity, 0.2, 1.4);
    switch (surface) {
      case 'sand':
        this.playNoise({ dur: 0.14, gain: 0.055 * v, type: 'bandpass', freq: 1500, q: 0.8 });
        break;
      case 'shallowwater':
        this.playNoise({ dur: 0.22, gain: 0.085 * v, type: 'bandpass', freq: 900, q: 1.1, sweepTo: 500 });
        break;
      case 'deepwater':
        this.playNoise({ dur: 0.30, gain: 0.10 * v, type: 'lowpass', freq: 700, q: 0.9, sweepTo: 300 });
        break;
      case 'grass':
        this.playNoise({ dur: 0.16, gain: 0.05 * v, type: 'highpass', freq: 2400, q: 0.6 });
        break;
      case 'stone':
      case 'coral':
        this.playNoise({ dur: 0.09, gain: 0.055 * v, type: 'bandpass', freq: 2100, q: 2.2 });
        this.playTone({ freq: 160 + Math.random() * 40, dur: 0.06, type: 'triangle', gain: 0.03 * v });
        break;
      case 'glass':
        this.playTone({ freq: 1800 + Math.random() * 900, dur: 0.13, type: 'sine', gain: 0.035 * v });
        this.playNoise({ dur: 0.06, gain: 0.03 * v, type: 'highpass', freq: 4200 });
        break;
      case 'ash':
        this.playNoise({ dur: 0.18, gain: 0.05 * v, type: 'lowpass', freq: 800, q: 0.7 });
        break;
      default:
        this.playNoise({ dur: 0.12, gain: 0.05 * v, type: 'bandpass', freq: 1200, q: 1.0 });
    }
  }

  jump() {
    this.playNoise({ dur: 0.18, gain: 0.05, type: 'bandpass', freq: 700, q: 0.7, sweepTo: 1800 });
  }
  land(intensity = 1) {
    this.playNoise({ dur: 0.20, gain: 0.10 * intensity, type: 'lowpass', freq: 420, q: 0.8 });
    this.playTone({ freq: 70, dur: 0.16, type: 'sine', gain: 0.10 * intensity });
  }
  dodge() {
    this.playNoise({ dur: 0.30, gain: 0.08, type: 'bandpass', freq: 400, q: 0.6, sweepTo: 2200 });
  }

  hymnChargeStart() {
    if (!this.ready) return;
    this._chargeOsc = this.ctx.createOscillator();
    this._chargeOsc.type = 'sawtooth';
    this._chargeOsc.frequency.value = 110;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.035, this.ctx.currentTime + 0.15);
    this._chargeOsc.connect(f).connect(g).connect(this.sfxBus);
    this._chargeOsc.start();
    this._chargeGain = g;
    this._chargeFilter = f;
  }
  hymnChargeUpdate(charge) {
    if (!this._chargeOsc) return;
    const t = this.ctx.currentTime;
    this._chargeOsc.frequency.setTargetAtTime(110 + charge * 260, t, 0.05);
    if (this._chargeFilter) this._chargeFilter.frequency.setTargetAtTime(400 + charge * 2600, t, 0.06);
  }
  hymnChargeStop() {
    if (!this._chargeOsc) return;
    const t = this.ctx.currentTime;
    try {
      this._chargeGain.gain.cancelScheduledValues(t);
      this._chargeGain.gain.setTargetAtTime(0.0001, t, 0.05);
      this._chargeOsc.stop(t + 0.3);
    } catch (e) { /* already stopped */ }
    this._chargeOsc = null;
    this._chargeGain = null;
  }

  /** The core "singing" sound: a chord sung into the reverb. */
  hymnRelease(kind) {
    if (!this.ready) return;
    const base = kind === 'ninth' ? 92.5 : kind === 'tune' ? 138.6 : 174.6;
    const intervals = kind === 'ninth' ? [0, 5, 7, 12, 19] : kind === 'tune' ? [0, 7, 12] : [0, 7];
    const dur = kind === 'ninth' ? 1.9 : kind === 'tune' ? 0.9 : 0.45;
    const gain = kind === 'ninth' ? 0.14 : kind === 'tune' ? 0.10 : 0.07;
    // breathy attack
    this.playNoise({ dur: kind === 'ninth' ? 0.5 : 0.24, gain: gain * 0.5, type: 'bandpass', freq: 1600, q: 0.9, sweepTo: 500, bus: this.sfxBus });
    intervals.forEach((semi, i) => {
      const f = base * Math.pow(2, semi / 12);
      this.playTone({
        freq: f, dur, type: 'sine', gain: gain * (1 - i * 0.11),
        attack: 0.02 + i * 0.012, detune: (i % 2 ? 6 : -6),
        filter: { type: 'lowpass', freq: 2600 }, bus: this.sfxBus,
      });
      // octave shimmer
      this.playTone({ freq: f * 2, dur: dur * 0.6, type: 'triangle', gain: gain * 0.18, attack: 0.05, bus: this.sfxBus });
    });
    if (kind === 'ninth') {
      this.playTone({ freq: 46, dur: 2.4, type: 'sine', gain: 0.16, attack: 0.01, bus: this.sfxBus });
      this.playNoise({ dur: 1.6, gain: 0.06, type: 'lowpass', freq: 900, sweepTo: 120, bus: this.sfxBus });
    }
  }

  hurt() {
    this.playTone({ freq: 220, dur: 0.22, type: 'sawtooth', gain: 0.06, filter: { type: 'lowpass', freq: 900 } });
    this.playNoise({ dur: 0.16, gain: 0.09, type: 'lowpass', freq: 600 });
  }
  enemyHurt(type) {
    const f = type === 'choirHusk' ? 320 : type === 'siltWraith' ? 520 : 380;
    this.playTone({ freq: f, dur: 0.14, type: 'square', gain: 0.035, filter: { type: 'lowpass', freq: 1400 } });
    this.playNoise({ dur: 0.10, gain: 0.04, type: 'bandpass', freq: 1700, q: 2 });
  }
  enemyDie(type) {
    const f = type === 'choirHusk' ? 180 : 300;
    this.playTone({ freq: f, dur: 0.5, type: 'triangle', gain: 0.05, filter: { type: 'lowpass', freq: 800 } });
    this.playNoise({ dur: 0.4, gain: 0.05, type: 'lowpass', freq: 700, sweepTo: 200 });
  }
  enemyAlert() {
    this.playTone({ freq: 660, dur: 0.10, type: 'triangle', gain: 0.03 });
    this.playTone({ freq: 880, dur: 0.10, type: 'triangle', gain: 0.02, when: 0.07 });
  }

  pickupEcho() {
    [0, 4, 7, 12].forEach((s, i) => {
      this.playTone({ freq: 523.25 * Math.pow(2, s / 12), dur: 0.5, type: 'sine', gain: 0.05, attack: 0.01, when: i * 0.05, bus: this.sfxBus });
    });
  }
  unlock() {
    [0, 5, 7, 12, 17].forEach((s, i) => {
      this.playTone({ freq: 261.63 * Math.pow(2, s / 12), dur: 0.9, type: 'triangle', gain: 0.05, when: i * 0.09, bus: this.sfxBus });
    });
  }
  bell(freq = 220) {
    // bell = inharmonic partials with long decay (the signature sound of the game)
    const partials = [1, 2.01, 2.76, 4.07, 5.43, 6.79];
    const gains = [0.16, 0.10, 0.07, 0.05, 0.035, 0.022];
    partials.forEach((p, i) => {
      this.playTone({ freq: freq * p, dur: 2.6 / (1 + i * 0.35), type: 'sine', gain: gains[i], attack: 0.004, bus: this.sfxBus });
    });
    this.playNoise({ dur: 0.5, gain: 0.05, type: 'bandpass', freq: 2400, q: 3, bus: this.sfxBus });
  }
  uiClick() { this.playTone({ freq: 760, dur: 0.06, type: 'sine', gain: 0.035 }); }
  uiHover() { this.playTone({ freq: 520, dur: 0.05, type: 'sine', gain: 0.02 }); }
  uiBack() { this.playTone({ freq: 380, dur: 0.09, type: 'sine', gain: 0.03 }); }
  uiOpen() {
    this.playNoise({ dur: 0.4, gain: 0.03, type: 'bandpass', freq: 1200, q: 0.8, sweepTo: 300 });
    this.playTone({ freq: 330, dur: 0.35, type: 'sine', gain: 0.03 });
  }
  heartbeat() {
    this.playTone({ freq: 58, dur: 0.16, type: 'sine', gain: 0.14 });
    this.playTone({ freq: 52, dur: 0.20, type: 'sine', gain: 0.10, when: 0.20 });
  }
  whisper(pan = 0) {
    this.playNoise({ dur: 1.4, gain: 0.02, type: 'bandpass', freq: 2200, q: 1.6, attack: 0.4, pan, bus: this.ambBus });
  }

  // ------------------------------------------------------------------ AMBIENCE (looping beds)
  startAmbience(type = 'wind') {
    if (!this.ready) return;
    this.ambienceType = type;
    // base wind bed: filtered noise with slow LFO gain
    if (!this._windSrc) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(2);
      src.loop = true;
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 420; f1.Q.value = 0.7;
      const f2 = ctx.createBiquadFilter(); f2.type = 'highpass'; f2.frequency.value = 120;
      const g = ctx.createGain(); g.gain.value = 0.05;
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.03;
      lfo.connect(lfoGain).connect(g.gain);
      src.connect(f1).connect(f2).connect(g).connect(this.ambBus);
      src.start(); lfo.start();
      this._windSrc = src; this._windGain = g; this._windFilter = f1;
    }
    // water lapping bed
    if (!this._waterSrc) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer(2.4);
      src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; f.Q.value = 0.5;
      const g = ctx.createGain(); g.gain.value = 0.0;
      src.connect(f).connect(g).connect(this.ambBus);
      src.start();
      this._waterSrc = src; this._waterGain = g;
    }
  }

  /** Called each frame: crossfade ambience by biome/region. */
  updateAmbience({ region, wading, mood, indoor }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const target = {
      kneeling: 0.045, shallows: 0.030, ossuary: 0.020, glass: 0.055, hollow: 0.012,
    }[region] ?? 0.04;
    const waterTarget = clamp(0.02 + wading * 0.09 + (region === 'shallows' ? 0.03 : 0), 0, 0.14);
    if (this._windGain) this._windGain.gain.setTargetAtTime(target * (1 + mood * 0.5), t, 0.6);
    if (this._waterGain) this._waterGain.gain.setTargetAtTime(waterTarget, t, 0.5);
    if (this._windFilter) this._windFilter.frequency.setTargetAtTime(region === 'hollow' ? 180 : region === 'glass' ? 900 : 460, t, 0.8);
  }

  // ------------------------------------------------------------------ GENERATIVE SCORE
  setMusicContext({ scale, root, mood }) {
    if (scale && SCALES[scale]) this.currentScale = scale;
    if (root) this.currentRoot = root;
    if (mood !== undefined) this.mood = mood;
  }

  updateMusic(dt, intensity = 0.5) {
    if (!this.ready || !this.musicEnabled) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    const scale = SCALES[this.currentScale] || SCALES.aeolian;
    const root = this.currentRoot;
    const step = this.musicStep++;
    // slow, breathing phrases: a drone every 8 steps, a sparse melody note most steps
    const beat = lerp(1.5, 0.62, clamp(intensity));    // music gets denser when threatened
    this.musicTimer = beat * (0.72 + this.rng() * 0.6);

    if (step % 8 === 0) {
      // drone: root + fifth, very soft, long
      const f = root * (this.rng() > 0.5 ? 1 : 0.5);
      this.playTone({ freq: f, dur: 7.5, type: 'sine', gain: 0.045 + this.mood * 0.02, attack: 1.2, bus: this.musicBus });
      this.playTone({ freq: f * 1.5, dur: 6.0, type: 'sine', gain: 0.020, attack: 1.6, bus: this.musicBus });
    }
    // melody: weighted random walk through the scale, favoring the 5th and 3rd
    const idx = Math.floor(this.rng() * scale.length);
    const octave = this.rng() > 0.72 ? 2 : 1;
    const semi = scale[idx] + 12 * octave;
    const f = root * Math.pow(2, semi / 12);
    const gain = (0.026 + this.rng() * 0.02) * (1 - this.mood * 0.25);
    const pan = (this.rng() - 0.5) * 0.8;
    this.playTone({
      freq: f, dur: lerp(2.6, 0.8, clamp(intensity)), type: this.rng() > 0.75 ? 'triangle' : 'sine',
      gain, attack: 0.06, pan, bus: this.musicBus,
      filter: { type: 'lowpass', freq: 2200 },
    });
    // occasional answering voice a fifth above (the "choir")
    if (this.rng() > 0.70) {
      this.playTone({ freq: f * 1.5, dur: 2.2, type: 'sine', gain: gain * 0.55, attack: 0.35, pan: -pan, bus: this.musicBus, when: 0.28 });
    }
    // low percussion heartbeat in the Hollow
    if (this.mood > 0.55 && step % 2 === 0) {
      this.playTone({ freq: 48, dur: 0.22, type: 'sine', gain: 0.06, attack: 0.005, bus: this.musicBus });
    }
  }

  /** Duck music during dialogue/cutscenes. */
  setDuck(amount) {
    this.duck = amount;
    if (this.musicBus) this.musicBus.gain.setTargetAtTime(this.volumes.music * amount, this.ctx.currentTime, 0.3);
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
}

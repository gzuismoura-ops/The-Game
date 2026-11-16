// Y'SMARA — UI controller.
// Screens, HUD, dialogue, codex, map, toasts. Deliberately DOM-based: crisp text at any DPI,
// tiny cost on the GPU, and it never fights the WebGL canvas for frame time.
import { clamp, lerp, easeOutCubic, TAU } from '../core/math.js';
import {
  TITLE, SUBTITLE, ECHOES, CANTOS, BELLS, SHRINES, SECRETS, CHARMS, NPCS, REGIONS, WORLD,
} from '../world/world.js';
import { OBJECTIVES, DIALOGUES, currentObjective, completionStats, ENDINGS, EPILOGUE_NOTES } from '../narrative/quest.js';
import { ACHIEVEMENTS } from '../systems/save.js';
import { landmarkPins } from '../world/structures.js';
import { terrainHeight, regionAt } from '../world/world.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class HUD {
  constructor(game) {
    this.game = game;
    this.audio = game.audio;
    this.save = game.save;
    this.screens = {};
    this.current = null;
    this.toastQueue = [];
    this.dialog = null;
    this.readerOpen = false;
    this.mapOpen = false;
    this._lastPrompt = '';
    this._bindDom();
  }

  // ------------------------------------------------------------------ setup
  _bindDom() {
    // screens
    for (const id of ['title', 'slots', 'settings', 'codex', 'credits', 'pause', 'journal', 'map']) {
      const s = $(`screen-${id}`);
      if (s) this.screens[id] = s;
    }

    // title menu
    document.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => {
        this.audio.uiClick();
        this.game.onMenuAction(b.dataset.act);
      });
      b.addEventListener('pointerenter', () => this.audio.uiHover());
    });

    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => { this.audio.uiBack(); this.game.onCloseScreen(); });
    });

    // pause buttons
    document.querySelectorAll('[data-pause]').forEach((b) => {
      b.addEventListener('click', () => { this.audio.uiClick(); this.game.onPauseAction(b.dataset.pause); });
    });

    // hud icon buttons
    $('btn-map')?.addEventListener('click', () => { this.audio.uiClick(); this.game.onMenuAction('map'); });
    $('btn-journal')?.addEventListener('click', () => { this.audio.uiClick(); this.game.onMenuAction('journal'); });
    $('btn-pause')?.addEventListener('click', () => { this.audio.uiClick(); this.game.onMenuAction('pause'); });

    // settings controls
    this._bindSettings();

    // reader closes anywhere
    $('reader')?.addEventListener('click', () => this.closeReader());

    // action buttons: register hit areas with the input system
    document.querySelectorAll('[data-btn]').forEach((b) => {
      this.game.input.registerButton(b.dataset.btn, b);
    });

    // ending buttons
    $('ending-continue')?.addEventListener('click', () => this.game.onEndingContinue());
    $('ending-title-btn')?.addEventListener('click', () => this.game.onEndingToTitle());
  }

  _bindSettings() {
    const s = this.save;
    const body = $('settings-body');
    if (!body) return;

    // segmented controls
    body.querySelectorAll('[data-setting]').forEach((seg) => {
      const key = seg.dataset.setting;
      seg.querySelectorAll('button').forEach((b) => {
        b.addEventListener('click', () => {
          this.audio.uiClick();
          seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          this.game.applySetting(key, b.dataset.val);
        });
      });
    });
    // toggles
    body.querySelectorAll('[data-toggle]').forEach((t) => {
      t.addEventListener('click', () => {
        this.audio.uiClick();
        const key = t.dataset.toggle;
        const val = !this.save.settings[key];
        t.classList.toggle('on', val);
        this.game.applySetting(key, val);
      });
    });
    // ranges
    body.querySelectorAll('[data-range]').forEach((r) => {
      r.addEventListener('input', () => {
        const key = r.dataset.range;
        const raw = Number(r.value);
        let val = raw;
        if (key.startsWith('vol')) val = raw / 100;
        if (key === 'sensitivity') val = raw / 100;
        this.game.applySetting(key, val);
        if (key === 'fov') $('fov-val').textContent = `${Math.round(val)}°`;
      });
    });
    $('btn-wipe')?.addEventListener('click', () => {
      if (confirm('Erase all saves, settings and achievements on this device? This cannot be undone.')) {
        this.save.wipeAll();
        this.game.onDataWiped();
      }
    });
  }

  /** Push current settings values into the DOM controls. */
  refreshSettings() {
    const s = this.save.settings;
    document.querySelectorAll('[data-setting]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.val === s[seg.dataset.setting]));
    });
    document.querySelectorAll('[data-toggle]').forEach((t) => t.classList.toggle('on', !!s[t.dataset.toggle]));
    document.querySelectorAll('[data-range]').forEach((r) => {
      const key = r.dataset.range;
      const v = s[key];
      r.value = key.startsWith('vol') || key === 'sensitivity' ? Math.round(v * 100) : v;
    });
    const fv = $('fov-val'); if (fv) fv.textContent = `${Math.round(s.fov)}°`;
    const st = this.save.storageInfo();
    const si = $('storage-info');
    if (si) si.textContent = `${(st.bytes / 1024).toFixed(1)} KB used · saved locally`;
  }

  // ------------------------------------------------------------------ screens
  show(name) {
    for (const k in this.screens) this.screens[k].classList.toggle('active', k === name);
    this.current = name;
    if (name === 'settings') this.refreshSettings();
    if (name === 'title') this.refreshTitle();
    if (name === 'slots') this.refreshSlots();
    if (name === 'codex') this.renderCodex();
    if (name === 'journal') this.renderJournal();
    if (name === 'credits') this.renderCredits();
    if (name === 'map') this.drawMap();
  }

  hideScreens() {
    for (const k in this.screens) this.screens[k].classList.remove('active');
    this.current = null;
  }

  refreshTitle() {
    const slots = this.save.listSlots();
    const latest = slots.filter((s) => !s.empty).sort((a, b) => b.savedAt - a.savedAt)[0];
    const btn = $('btn-continue');
    const meta = $('continue-meta');
    if (latest) {
      btn.disabled = false;
      const d = new Date(latest.savedAt);
      meta.textContent = `${latest.region} · ${Math.floor(latest.playTime / 60)}m`;
    } else {
      btn.disabled = true;
      meta.textContent = 'no saved journey';
    }
    const a = $('ach-note');
    if (a) a.textContent = `${this.save.achievementCount()} / ${ACHIEVEMENTS.length} memories found`;
  }

  refreshSlots() {
    const list = $('slot-list');
    if (!list) return;
    list.innerHTML = '';
    for (const s of this.save.listSlots()) {
      const d = el('button', 'slot' + (s.empty ? ' empty' : ''));
      if (s.empty) {
        d.innerHTML = `<div class="num">${s.slot || '—'}</div><div class="info"><div class="region">Empty thread</div><div class="detail">Begin a new journey</div></div>`;
      } else {
        const st = completionStats({
          echoes: new Array(s.echoes).fill(0), cantos: new Array(s.cantos).fill(0),
          bells: new Array(s.bells).fill(0), shrines: [], secrets: [],
        });
        const mins = Math.floor(s.playTime / 60);
        d.innerHTML = `<div class="num">${s.slot}</div><div class="info">
            <div class="region">${s.ending ? 'Journey complete — ' + (s.ending === 'rest' ? 'Let It Rest' : 'Keep the Note') : s.region}</div>
            <div class="detail">${s.echoes} echoes · ${s.cantos} cantos · ${s.bells}/3 bells · ${mins}m played</div>
          </div><div class="prog-ring">${s.ending ? '✦' : st.percent + '%'}</div>`;
      }
      d.addEventListener('click', () => { this.audio.uiClick(); this.game.onSlotChosen(s.slot); });
      list.appendChild(d);
    }
  }

  renderCodex() {
    const body = $('codex-body');
    if (!body) return;
    const save = this.game.campaign;
    body.innerHTML = '';
    const addGroup = (title, entries, pool, kind) => {
      const g = el('div', 'set-group');
      g.innerHTML = `<h4>${title}</h4>`;
      const wrap = el('div', 'slots');
      pool.forEach((e) => {
        const found = entries.includes(e.id);
        const row = el('div', 'slot' + (found ? '' : ' empty'));
        const name = e.title || e.name;
        row.innerHTML = `<div class="num" style="font-size:20px">${found ? '✦' : '·'}</div><div class="info">
            <div class="region">${found ? name : 'Undiscovered'}</div>
            <div class="detail">${found ? (e.lines ? e.lines[0] : e.text ? e.text.slice(0, 90) + '…' : (e.desc || '')) : (kind === 'echo' ? 'A memory still out there, waiting to be heard.' : 'Not yet found on the coast.')}</div>
          </div>`;
        if (found) {
          row.style.cursor = 'pointer';
          row.addEventListener('click', () => {
            if (e.lines) this.openReader('Memory Echo', e.title, e.lines, '');
            else if (e.text) this.openReader('Canto', e.title, [e.text], '');
            else this.openReader('Place', e.name, [e.desc || ''], '');
          });
        }
        wrap.appendChild(row);
      });
      g.appendChild(wrap);
      body.appendChild(g);
    };
    addGroup('Memory Echoes', save.echoes, ECHOES, 'echo');
    addGroup('Cantos of the Choir', save.cantos, CANTOS, 'canto');
    addGroup('The Lost Bells', save.bells, BELLS, 'bell');
    addGroup('Secret Places', save.secrets, SECRETS, 'secret');
    addGroup('Charms', save.charms, CHARMS.map((c) => ({ ...c, title: c.name, desc: c.desc })), 'charm');
    // achievements
    const g = el('div', 'set-group');
    g.innerHTML = '<h4>The Listener\'s Ledger</h4>';
    const wrap = el('div', 'slots');
    ACHIEVEMENTS.forEach((a) => {
      const got = this.save.isUnlocked(a.id);
      const row = el('div', 'slot' + (got ? '' : ' empty'));
      row.innerHTML = `<div class="num" style="font-size:20px;color:${got ? 'var(--bronze)' : 'rgba(235,227,210,.18)'}">${got ? a.icon : '○'}</div><div class="info"><div class="region">${a.name}</div><div class="detail">${a.desc}</div></div>`;
      wrap.appendChild(row);
    });
    g.appendChild(wrap);
    body.appendChild(g);
  }

  renderJournal() {
    const body = $('journal-body');
    if (!body) return;
    const save = this.game.campaign;
    const stats = completionStats(save);
    const obj = currentObjective(save);
    const regionsVisited = Object.keys(save.visited || {}).filter((k) => save.visited[k]);
    body.innerHTML = `
      <div class="set-group">
        <h4>Current Objective</h4>
        <div style="font-family:var(--serif);font-size:20px;color:var(--salt);letter-spacing:.06em">${obj.title}</div>
        <div style="font-size:12px;color:rgba(235,227,210,.55);margin-top:8px;line-height:1.7">${obj.hint}</div>
      </div>
      <div class="set-group">
        <h4>Progress</h4>
        <div class="set-row"><label>Memory Echoes</label><span style="font-family:var(--mono);color:var(--bronze)">${stats.echoes}</span></div>
        <div class="set-row"><label>Cantos Recovered</label><span style="font-family:var(--mono);color:var(--bronze)">${stats.cantos}</span></div>
        <div class="set-row"><label>Bells Rung</label><span style="font-family:var(--mono);color:var(--bronze)">${stats.bells}</span></div>
        <div class="set-row"><label>Shrines Lit</label><span style="font-family:var(--mono);color:var(--bronze)">${stats.shrines}</span></div>
        <div class="set-row"><label>Secrets Found</label><span style="font-family:var(--mono);color:var(--bronze)">${stats.secrets}</span></div>
        <div class="set-row"><label>Coast Explored</label><span style="font-family:var(--mono);color:var(--bronze)">${stats.percent}%</span></div>
      </div>
      <div class="set-group">
        <h4>Reaches Discovered</h4>
        <div class="slots">${REGIONS.map((r) => `
          <div class="slot ${regionsVisited.includes(r.id) ? '' : 'empty'}">
            <div class="num" style="font-size:18px">${regionsVisited.includes(r.id) ? '✦' : '·'}</div>
            <div class="info"><div class="region">${regionsVisited.includes(r.id) ? r.name : 'Unnamed Reach'}</div>
            <div class="detail">${regionsVisited.includes(r.id) ? r.blurb : 'You have not walked here yet.'}</div></div>
          </div>`).join('')}</div>
      </div>
      <div class="set-group">
        <h4>Charms</h4>
        <div class="slots">${CHARMS.map((c) => `
          <div class="slot ${save.charms.includes(c.id) ? '' : 'empty'}">
            <div class="num" style="font-size:18px;color:#${c.color.toString(16).padStart(6, '0')}">${save.charms.includes(c.id) ? '◈' : '·'}</div>
            <div class="info"><div class="region">${save.charms.includes(c.id) ? c.name : 'Unfound Charm'}</div>
            <div class="detail">${save.charms.includes(c.id) ? c.desc : 'Hidden somewhere on the coast.'}</div></div>
          </div>`).join('')}</div>
      </div>
    `;
  }

  renderCredits() {
    const body = $('credits-body');
    if (!body) return;
    body.innerHTML = `
      <h3>Y'SMARA — The Hollow Hymn</h3>
      <p class="role">An original game, built entirely offline</p>
      <p>Every model, texture, sound, note of music and line of story in this game is generated procedurally at runtime from code. No downloaded assets, no third-party art, no servers.</p>
      <h3>Design & Direction</h3><p class="role">World, narrative, systems</p><p>Original concept and screenplay written for this project.</p>
      <h3>Engine & Rendering</h3><p class="role">three.js · WebGL2 · custom shaders</p>
      <p>Terrain splat shading, analytic water, sky dome, atmospheric grade, instanced flora with vertex wind.</p>
      <h3>Audio</h3><p class="role">Procedural synthesis</p>
      <p>Web Audio: additive bells, breath-noise footsteps, modal generative score in five scales.</p>
      <h3>Story</h3>
      <p>The Choir sang the coast into being and left the last verse unfinished. You are the Listener who decides whether a world is allowed to end.</p>
      <h3>Thank You</h3>
      <p>For playing something small, strange, and finished.</p>
      <p style="margin-top:28px;color:rgba(235,227,210,.35);font-family:var(--mono);font-size:10px;letter-spacing:.2em">VERSION 1.0 · OFFLINE BUILD</p>
    `;
  }

  // ------------------------------------------------------------------ map
  drawMap() {
    const c = $('map-canvas');
    if (!c) return;
    const ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    const half = WORLD.half;
    const toPx = (x, z) => [((x + half) / (half * 2)) * W, ((z + half) / (half * 2)) * H];

    // background
    ctx.fillStyle = '#0a0f11';
    ctx.fillRect(0, 0, W, H);

    // region halos
    for (const r of REGIONS) {
      const [cx, cy] = toPx(r.center.x, r.center.z);
      const rad = (r.radius / (half * 2)) * W;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const col = `#${r.palette.accent.toString(16).padStart(6, '0')}`;
      g.addColorStop(0, col + '30');
      g.addColorStop(1, col + '00');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, TAU); ctx.fill();
      // name
      ctx.fillStyle = 'rgba(235,227,210,0.34)';
      ctx.font = '600 15px Palatino, Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText(r.short.toUpperCase(), cx, cy - rad * 0.72);
    }

    // coastline: sample heightfield into a mask
    const step = 6;
    for (let py = 0; py < H; py += step) {
      for (let px = 0; px < W; px += step) {
        const wx = (px / W) * half * 2 - half;
        const wz = (py / H) * half * 2 - half;
        const h = terrainHeight(wx, wz);
        if (h > WORLD.waterLevel) {
          const shade = clamp(0.34 + h / 90, 0, 1);
          ctx.fillStyle = `rgba(${Math.floor(120 + shade * 80)},${Math.floor(112 + shade * 74)},${Math.floor(96 + shade * 60)},0.72)`;
          ctx.fillRect(px, py, step - 1, step - 1);
        } else {
          ctx.fillStyle = 'rgba(22,44,52,0.55)';
          ctx.fillRect(px, py, step - 1, step - 1);
        }
      }
    }

    const save = this.game.campaign;

    // shrines
    for (const s of SHRINES) {
      const [x, y] = toPx(s.x, s.z);
      const lit = save.shrines.includes(s.id);
      ctx.fillStyle = lit ? '#ffcb84' : 'rgba(255,203,132,0.34)';
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-4, -4, 8, 8); ctx.restore();
    }
    // bells
    for (const b of BELLS) {
      if (save.bells.includes(b.id)) continue;
      const [x, y] = toPx(b.x, b.z);
      ctx.fillStyle = '#9fe8d8';
      ctx.beginPath();
      ctx.moveTo(x, y - 8); ctx.lineTo(x + 7, y + 6); ctx.lineTo(x - 7, y + 6);
      ctx.closePath(); ctx.fill();
    }
    // echoes
    for (const e of ECHOES) {
      if (save.echoes.includes(e.id)) continue;
      const [x, y] = toPx(e.x, e.z);
      ctx.fillStyle = 'rgba(127,227,212,0.8)';
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill();
    }
    // secrets
    for (const s of SECRETS) {
      if (save.secrets.includes(s.id)) continue;
      const [x, y] = toPx(s.x, s.z);
      ctx.strokeStyle = 'rgba(200,160,255,0.7)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, TAU); ctx.stroke();
    }
    // hollow
    const [hx, hy] = toPx(4, 262);
    ctx.fillStyle = 'rgba(143,123,216,0.85)';
    ctx.beginPath(); ctx.arc(hx, hy, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0a0f11'; ctx.beginPath(); ctx.arc(hx, hy, 5, 0, TAU); ctx.fill();

    // player
    const p = this.game.player.pos;
    const [px, py] = toPx(p.x, p.z);
    ctx.fillStyle = '#f3ede0';
    ctx.beginPath(); ctx.arc(px, py, 5.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#f3ede0'; ctx.lineWidth = 2;
    const dir = this.game.player.facing;
    ctx.beginPath(); ctx.moveTo(px, py);
    ctx.lineTo(px + Math.sin(dir) * 16, py + Math.cos(dir) * 16); ctx.stroke();

    // compass rose
    ctx.fillStyle = 'rgba(235,227,210,0.3)';
    ctx.font = '600 13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('N', W / 2, 22);
    ctx.fillText('S', W / 2, H - 12);
    ctx.fillText('W', 14, H / 2);
    ctx.fillText('E', W - 14, H / 2);
  }

  // ------------------------------------------------------------------ hud update
  setHudVisible(v) {
    $('hud')?.classList.toggle('hidden', !v);
    const tl = $('touch-layer');
    if (tl) tl.style.display = v ? 'block' : 'none';
  }

  update(dt) {
    const g = this.game;
    if (!g.player) return;
    const p = g.player;

    // vitals
    const hpPct = clamp(p.hp / 100) * 100;
    const hpBar = $('hp-bar');
    if (hpBar) {
      hpBar.firstElementChild.style.width = `${hpPct}%`;
      hpBar.classList.toggle('low', hpPct < 32);
    }
    const stBar = $('stamina-bar');
    if (stBar) {
      stBar.firstElementChild.style.width = `${clamp(p.stamina / 100) * 100}%`;
      stBar.classList.toggle('exhausted', p.stamina < 12);
    }

    // region chip
    const rc = $('region-chip');
    if (rc) {
      const r = regionAt(p.pos.x, p.pos.z);
      if (rc.dataset.region !== r.id) {
        rc.dataset.region = r.id;
        rc.innerHTML = `<b>${r.name}</b>`;
      }
    }

    // objective
    const obj = currentObjective(g.campaign);
    const ot = $('obj-title');
    if (ot && ot.textContent !== obj.title) {
      ot.textContent = obj.title;
      $('obj-hint').textContent = obj.hint;
      $('objective').classList.remove('bump');
      void $('objective').offsetWidth;
      $('objective').classList.add('bump');
    }

    // counters
    const ec = $('echo-count'); if (ec) ec.textContent = `${g.campaign.echoes.length} / ${ECHOES.length}`;
    const bc = $('bell-count'); if (bc) bc.textContent = `${g.campaign.bells.length} / ${BELLS.length}`;

    // interaction prompt
    const prompt = g.currentPrompt;
    const ip = $('interact-prompt');
    if (ip) {
      if (prompt && prompt !== this._lastPrompt) {
        $('interact-text').textContent = prompt;
        ip.classList.add('show');
        this._lastPrompt = prompt;
      } else if (!prompt && this._lastPrompt) {
        ip.classList.remove('show');
        this._lastPrompt = '';
      }
    }

    // charge ring on the sing button
    const singBtn = document.querySelector('[data-btn="sing"]');
    if (singBtn) {
      singBtn.classList.toggle('charging', g.hymn.charging);
      singBtn.style.setProperty('--charge', g.hymn.charge.toFixed(3));
    }

    // combo
    const combo = $('combo');
    if (combo) {
      const on = g.hymn.combo > 1;
      combo.classList.toggle('on', on);
      if (on) combo.textContent = `×${g.hymn.combo}`;
    }

    // damage vignette
    const dmg = clamp(g.damageFlash);
    const vd = $('vignette-damage');
    if (vd) vd.style.opacity = String(dmg * 0.85);

    // compass: show bearing to current target marker
    this._updateCompass(p);

    // fps
    if (g.save.settings.showFps) {
      const f = $('fps');
      if (f) { f.classList.add('on'); f.textContent = `${Math.round(g.fps)} FPS · ${g.stage.renderer.info.render.calls} calls`; }
    } else {
      $('fps')?.classList.remove('on');
    }

    // stick visual
    if (g.stickVisual) {
      const sv = $('stick');
      const knob = $('stick-knob');
      if (sv.classList.contains('on') && knob) {
        knob.style.transform = `translate(${g.stickVisual.dx * 34}px, ${g.stickVisual.dy * 34}px)`;
      }
    }

    // process queued toasts
    if (this.toastQueue.length && !this._toastBusy) this._nextToast();
  }

  _updateCompass(p) {
    const c = $('compass');
    if (!c) return;
    const g = this.game;
    const target = g.compassTarget;
    // remove old ticks (keep needle)
    [...c.querySelectorAll('.tick,.tick-label,.marker')].forEach((e) => e.remove());
    const W = c.clientWidth || 320;
    const heading = Math.atan2(Math.sin(p.facing), Math.cos(p.facing));
    // cardinal ticks around the player's heading
    const cards = [['N', Math.PI], ['E', Math.PI / 2], ['S', 0], ['W', -Math.PI / 2]];
    for (const [label, ang] of cards) {
      let d = ((ang - p.facing + Math.PI) % TAU + TAU) % TAU - Math.PI;
      if (Math.abs(d) < 1.35) {
        const x = W / 2 + (d / 1.35) * (W / 2);
        const t = el('div', 'tick major');
        t.style.left = `${x}px`;
        c.appendChild(t);
        const l = el('div', 'tick-label', label);
        l.style.left = `${x}px`;
        c.appendChild(l);
      }
    }
    if (target) {
      const ang = Math.atan2(target.x - p.pos.x, target.z - p.pos.z);
      let d = ((ang - p.facing + Math.PI) % TAU + TAU) % TAU - Math.PI;
      if (Math.abs(d) < 1.35) {
        const x = W / 2 + (d / 1.35) * (W / 2);
        const m = el('div', 'marker');
        m.style.left = `${x}px`;
        m.style.color = '#ffcb84';
        c.appendChild(m);
      }
    }
  }

  // ------------------------------------------------------------------ toasts
  toast({ icon = '✦', title, text, duration = 3300 }) {
    this.toastQueue.push({ icon, title, text, duration });
    if (!this._toastBusy) this._nextToast();
  }

  _nextToast() {
    const t = this.toastQueue.shift();
    if (!t) { this._toastBusy = false; return; }
    this._toastBusy = true;
    const host = $('toasts');
    if (!host) { this._toastBusy = false; return; }
    const node = el('div', 'toast');
    node.innerHTML = `<span class="ico">${t.icon}</span><span class="txt">${t.title ? `<b>${t.title}</b>` : ''}${t.text || ''}</span>`;
    node.style.animation = `toastIn .34s cubic-bezier(.2,.9,.3,1), toastOut .4s ${t.duration / 1000 - 0.4}s forwards`;
    host.appendChild(node);
    setTimeout(() => {
      node.remove();
      this._toastBusy = false;
      if (this.toastQueue.length) this._nextToast();
    }, t.duration);
  }

  // ------------------------------------------------------------------ dialogue
  startDialogue(key, onComplete) {
    const d = DIALOGUES[key];
    if (!d) { onComplete?.(); return; }
    this.dialog = { data: d, node: 0, onComplete, typing: false, full: '' };
    this._showDialogueNode();
    $('dialogue')?.classList.add('show');
    this.game.setDialogueOpen(true);
    this._dlgHandler = (e) => {
      if (!['Space', 'Enter', 'KeyE'].includes(e.code)) return;
      e.preventDefault();
      this.advanceDialogue();
    };
    this._dlgPointer = (e) => {
      // ignore taps on choice buttons, which handle themselves
      if (e.target && e.target.closest && e.target.closest('.dialogue-choice')) return;
      this.advanceDialogue();
    };
    window.addEventListener('keydown', this._dlgHandler);
    document.addEventListener('pointerdown', this._dlgPointer);
  }

  _showDialogueNode() {
    const st = this.dialog;
    if (!st) return;
    const node = st.data.nodes[st.node];
    if (!node) { this.endDialogue(); return; }
    const sp = $('dlg-speaker');
    if (sp) sp.textContent = st.data.speaker;
    const txt = $('dlg-text');
    const choices = $('dlg-choices');
    if (choices) choices.innerHTML = '';
    const next = $('dlg-next');
    if (next) next.style.display = 'none';

    // typewriter
    const full = node.text;
    st.full = full;
    st.typing = true;
    let i = 0;
    if (txt) txt.innerHTML = '';
    const speed = this.save.settings.reduceMotion ? 1000 : 26;
    clearInterval(st._typer);
    st._typer = setInterval(() => {
      i += 2;
      if (txt) txt.innerHTML = full.slice(0, i) + (i < full.length ? '<span class="caret">▌</span>' : '');
      if (i >= full.length) {
        clearInterval(st._typer);
        st.typing = false;
        if (txt) txt.textContent = full;
        if (node.choices) {
          node.choices.forEach((c) => {
            const b = el('button', 'dialogue-choice', c.text);
            b.addEventListener('click', (ev) => {
              ev.stopPropagation();
              this.audio.uiClick();
              if (c.ending) { this.endDialogue(); this.game.triggerEnding(c.ending); return; }
              if (c.end) { this.endDialogue(); return; }
              st.node = c.next;
              this._showDialogueNode();
            });
            choices?.appendChild(b);
          });
          if (next) next.style.display = 'none';
        } else {
          if (next) { next.style.display = 'block'; next.classList.add('blink'); }
        }
      }
    }, speed);
  }

  advanceDialogue() {
    const st = this.dialog;
    if (!st) return;
    const node = st.data.nodes[st.node];
    if (st.typing) {
      clearInterval(st._typer);
      st.typing = false;
      const txt = $('dlg-text');
      if (txt) txt.textContent = st.full;
      // reveal choices immediately
      if (node.choices) {
        const choices = $('dlg-choices');
        if (choices && !choices.children.length) {
          node.choices.forEach((c) => {
            const b = el('button', 'dialogue-choice', c.text);
            b.addEventListener('click', (ev) => {
              ev.stopPropagation();
              this.audio.uiClick();
              if (c.ending) { this.endDialogue(); this.game.triggerEnding(c.ending); return; }
              if (c.end) { this.endDialogue(); return; }
              st.node = c.next;
              this._showDialogueNode();
            });
            choices.appendChild(b);
          });
        }
      }
      return;
    }
    if (node.choices) return;  // must pick a choice
    if (node.end) { this.endDialogue(); return; }
    if (typeof node.next === 'number') { st.node = node.next; this._showDialogueNode(); }
    else this.endDialogue();
  }

  endDialogue() {
    const st = this.dialog;
    if (!st) return;
    clearInterval(st._typer);
    this.dialog = null;
    $('dialogue')?.classList.remove('show');
    window.removeEventListener('keydown', this._dlgHandler);
    if (this._dlgPointer) document.removeEventListener('pointerdown', this._dlgPointer);
    this._dlgHandler = null;
    this._dlgPointer = null;
    this.game.setDialogueOpen(false);
    st.onComplete?.();
  }

  // ------------------------------------------------------------------ reader
  openReader(kicker, title, lines, footLeft) {
    this.readerOpen = true;
    $('reader-kicker').textContent = kicker;
    $('reader-title').textContent = title;
    $('reader-body').innerHTML = lines.map((l) => `<p>${l}</p>`).join('');
    $('reader-foot-left').textContent = footLeft || '';
    $('reader').classList.add('show');
    this.audio.uiOpen();
    this.game.setDialogueOpen(true);
  }

  closeReader() {
    if (!this.readerOpen) return;
    this.readerOpen = false;
    $('reader').classList.remove('show');
    this.audio.uiBack();
    this.game.setDialogueOpen(false);
  }

  // ------------------------------------------------------------------ cinematic
  setLetterbox(on) {
    $('lb-top')?.classList.toggle('on', on);
    $('lb-bottom')?.classList.toggle('on', on);
  }

  showCinematicText(who, text, duration = 4200) {
    const c = $('cin-text');
    if (!c) return;
    c.innerHTML = (who ? `<span class="who">${who}</span>` : '') + text;
    c.classList.add('show');
    clearTimeout(this._cinTimer);
    this._cinTimer = setTimeout(() => c.classList.remove('show'), duration);
  }

  hideCinematicText() { $('cin-text')?.classList.remove('show'); }

  showHint(text, duration = 4200) {
    const h = $('hint-strip');
    if (!h) return;
    h.innerHTML = text;
    h.classList.add('show');
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => h.classList.remove('show'), duration);
  }

  // ------------------------------------------------------------------ ending
  showEnding(ending, save, onContinue, onTitle) {
    const e = ENDINGS[ending] || ENDINGS.rest;
    const scr = $('ending-screen');
    if (!scr) return;
    $('ending-title').textContent = e.title;
    $('ending-sub').textContent = e.subtitle;
    const linesHost = $('ending-lines');
    linesHost.innerHTML = '';
    e.lines.forEach((l, i) => {
      const p = el('p', '', l);
      p.style.animationDelay = `${0.4 + i * 0.85}s`;
      linesHost.appendChild(p);
    });
    const stats = completionStats(save);
    const notes = EPILOGUE_NOTES.filter((n) => n.cond(save)).map((n) => n.text);
    $('ending-note').textContent = notes[0] || '';
    $('ending-stats').innerHTML = `
      <div class="ending-stat"><b>${stats.echoes}</b><span>Echoes</span></div>
      <div class="ending-stat"><b>${stats.cantos}</b><span>Cantos</span></div>
      <div class="ending-stat"><b>${stats.bells}</b><span>Bells</span></div>
      <div class="ending-stat"><b>${stats.secrets}</b><span>Secrets</span></div>
      <div class="ending-stat"><b>${Math.round((save.playTime || 0) / 60)}m</b><span>Played</span></div>
    `;
    scr.classList.add('show');
    this.setHudVisible(false);
    $('ending-continue').onclick = onContinue;
    $('ending-title-btn').onclick = onTitle;
  }

  hideEnding() { $('ending-screen')?.classList.remove('show'); }

  // ------------------------------------------------------------------ boot
  setBootProgress(pct, text) {
    const f = $('boot-bar-fill');
    if (f) f.style.width = `${clamp(pct * 100, 0, 100)}%`;
    const s = $('boot-status');
    if (s && text) s.textContent = text;
  }

  hideBoot() {
    const b = $('boot');
    if (b) { b.classList.add('gone'); setTimeout(() => b.remove(), 1200); }
  }

  showFatal(msg) {
    $('boot')?.classList.add('gone');
    const f = $('fatal');
    if (f) { f.style.display = 'block'; $('fatal-detail').textContent = msg || ''; }
  }

  updateStickVisual(active, ox, oy, x, y) {
    const sv = $('stick');
    if (!sv) return;
    if (!active) { sv.classList.remove('on'); this.game.stickVisual = null; return; }
    sv.classList.add('on');
    sv.style.left = `${ox}px`;
    sv.style.top = `${oy}px`;
    const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.13;
    let dx = x - ox, dy = y - oy;
    const len = Math.hypot(dx, dy);
    if (len > maxR) { dx = (dx / len) * maxR; dy = (dy / len) * maxR; }
    this.game.stickVisual = { dx: dx / maxR, dy: dy / maxR };
  }
}

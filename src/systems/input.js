// Y'SMARA — input.
// Mobile-first: left virtual stick (appears where you touch), right-side drag to orbit,
// buttons for Hymn / Dodge / Jump / Interact. Also supports gamepad and WASD so the same build
// is testable on desktop. All state is polled by the game loop; no per-frame allocation.
import { clamp } from '../core/math.js';

const KEY_MAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyE: 'interact', KeyF: 'sing', KeyQ: 'dodge',
  Escape: 'pause', Tab: 'map', KeyM: 'map',
};

export class InputSystem {
  constructor(domElement, options = {}) {
    this.el = domElement;
    this.state = {
      moveX: 0, moveZ: 0, camDX: 0, camDY: 0, camHold: false,
      jump: false, sprint: false, dodge: false, sing: false, interact: false,
      pause: false, map: false, pinch: 0,
    };
    this.keys = new Set();
    this.touchStick = null;     // { id, ox, oy, x, y }
    this.touchCam = null;       // { id, x, y }
    this.buttons = {};          // name -> {id, x, y, r}
    this.onAction = options.onAction || (() => {});
    this.onStickVisual = options.onStickVisual || (() => {});
    this.sensitivity = 1;
    this.leftHanded = false;
    this.deadZone = 0.16;
    this.enabled = true;
    this.gpPrev = [];
    this.gpIndex = null;
    this._bind();
  }

  _bind() {
    const el = this.el;
    el.style.touchAction = 'none';

    el.addEventListener('pointerdown', (e) => this.onPointerDown(e), { passive: false });
    el.addEventListener('pointermove', (e) => this.onPointerMove(e), { passive: false });
    el.addEventListener('pointerup', (e) => this.onPointerUp(e), { passive: false });
    el.addEventListener('pointercancel', (e) => this.onPointerUp(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    // wheel zoom (desktop convenience)
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.state.pinch = e.deltaY > 0 ? 0.94 : 1.06;
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      const a = KEY_MAP[e.code];
      if (a && ['pause', 'map'].includes(a)) { this.onAction(a); e.preventDefault(); }
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.touchStick = null; this.touchCam = null; });

    window.addEventListener('gamepadconnected', (e) => { this.gpIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.gpIndex = null; });
  }

  /** Register a HUD button hit area in CSS pixels. */
  registerButton(name, el) {
    this.buttons[name] = el;
  }

  _buttonAt(x, y) {
    for (const name in this.buttons) {
      const b = this.buttons[name];
      if (!b) continue;
      const r = b.getBoundingClientRect();
      if (r.width === 0) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const rad = Math.max(r.width, r.height) * 0.62;
      if ((x - cx) ** 2 + (y - cy) ** 2 < rad * rad) return name;
    }
    return null;
  }

  onPointerDown(e) {
    if (!this.enabled) return;
    const x = e.clientX, y = e.clientY;
    const btn = this._buttonAt(x, y);
    if (btn) {
      e.preventDefault();
      this._pressButton(btn, true);
      this._activeButton = { id: e.pointerId, name: btn };
      return;
    }
    const isLeft = this.leftHanded
      ? x > window.innerWidth * 0.5
      : x < window.innerWidth * 0.5;
    if (isLeft) {
      this.touchStick = { id: e.pointerId, ox: x, oy: y, x, y };
      this.onStickVisual(true, x, y, x, y);
    } else {
      this.touchCam = { id: e.pointerId, x, y, lx: x, ly: y, moved: 0, t0: performance.now() };
    }
    e.preventDefault();
  }

  onPointerMove(e) {
    const x = e.clientX, y = e.clientY;
    if (this.touchStick && this.touchStick.id === e.pointerId) {
      this.touchStick.x = x; this.touchStick.y = y;
      this.onStickVisual(true, this.touchStick.ox, this.touchStick.oy, x, y);
    } else if (this.touchCam && this.touchCam.id === e.pointerId) {
      const dx = x - this.touchCam.lx, dy = y - this.touchCam.ly;
      this.state.camDX += dx * this.sensitivity;
      this.state.camDY += dy * this.sensitivity;
      this.touchCam.lx = x; this.touchCam.ly = y;
      this.touchCam.moved += Math.abs(dx) + Math.abs(dy);
      this.state.camHold = true;
    }
  }

  onPointerUp(e) {
    if (this.touchStick && this.touchStick.id === e.pointerId) {
      this.touchStick = null;
      this.onStickVisual(false);
    } else if (this.touchCam && this.touchCam.id === e.pointerId) {
      // a tap on the right side = interact / attack
      const dt = performance.now() - this.touchCam.t0;
      if (this.touchCam.moved < 12 && dt < 260) this.onAction('tap');
      this.touchCam = null;
      this.state.camHold = false;
    }
    if (this._activeButton && this._activeButton.id === e.pointerId) {
      this._pressButton(this._activeButton.name, false);
      this._activeButton = null;
    }
  }

  _pressButton(name, down) {
    switch (name) {
      case 'jump': this.state.jump = down; if (down) this.onAction('jump'); break;
      case 'sing': this.state.sing = down; break;
      case 'dodge': this.state.dodge = down; if (down) this.onAction('dodge'); break;
      case 'sprint': this.state.sprint = down; break;
      case 'interact': this.state.interact = down; if (down) this.onAction('interact'); break;
      case 'pause': if (down) this.onAction('pause'); break;
      case 'map': if (down) this.onAction('map'); break;
      default: break;
    }
  }

  /** Called once per frame by the game. Fills moveX/moveZ from stick + keys + gamepad. */
  poll(dt) {
    const st = this.state;
    let mx = 0, mz = 0;

    if (this.touchStick) {
      const dx = this.touchStick.x - this.touchStick.ox;
      const dy = this.touchStick.y - this.touchStick.oy;
      const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.13;
      const len = Math.hypot(dx, dy);
      const dead = maxR * this.deadZone;
      if (len > dead) {
        const mag = Math.min(1, (len - dead) / (maxR - dead));
        mx += (dx / len) * mag;
        mz += (dy / len) * mag;
      }
    }

    // keyboard
    if (this.keys.size) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz -= 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
      if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) st.sprint = true;
      if (this.keys.has('Space')) {
        if (!this._spaceHeld) { this.onAction('jump'); this._spaceHeld = true; }
        st.jump = true;
      } else {
        if (this._spaceHeld) { st.jump = false; this._spaceHeld = false; }
      }
      if (this.keys.has('KeyF')) { if (!this._fHeld) { this.onAction('sing'); this._fHeld = true; } st.sing = true; }
      else { st.sing = false; this._fHeld = false; }
      if (this.keys.has('KeyE')) { if (!this._eHeld) { this.onAction('interact'); this._eHeld = true; } st.interact = true; }
      else { st.interact = false; this._eHeld = false; }
      if (this.keys.has('KeyQ')) { if (!this._qHeld) { this.onAction('dodge'); this._qHeld = true; } st.dodge = true; }
      else { st.dodge = false; this._qHeld = false; }
    }

    // gamepad
    if (this.gpIndex !== null && navigator.getGamepads) {
      const gp = navigator.getGamepads()[this.gpIndex];
      if (gp) {
        const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
        mx += dz(gp.axes[0] || 0);
        mz += dz(gp.axes[1] || 0);
        // right stick orbits camera
        const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
        st.camDX += rx * 14;
        st.camDY += ry * 14;
        if (rx || ry) st.camHold = true; else st.camHold = false;
        const pressed = gp.buttons.map((b) => b.pressed);
        const edge = (i, name) => { if (pressed[i] && !this.gpPrev[i]) this.onAction(name); };
        edge(0, 'jump');        // A
        edge(1, 'sing');        // B
        edge(2, 'dodge');       // X
        edge(3, 'interact');    // Y
        edge(9, 'pause');       // Start
        edge(8, 'map');         // Select
        st.jump = !!pressed[0];
        st.sing = !!pressed[1];
        st.sprint = !!pressed[6] || !!pressed[10];
        this.gpPrev = pressed;
      }
    }

    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }
    st.moveX = mx;
    st.moveZ = mz;

    // hand the accumulated camera delta to the rig for this frame, then clear it
    this._camDXOut = st.camDX;
    this._camDYOut = st.camDY;
    st.camDX = 0;
    st.camDY = 0;
  }

  /** Consume camera delta for this frame (called by CameraRig via the game). */
  consumeCamDelta() {
    const out = { dx: this._camDXOut || 0, dy: this._camDYOut || 0, pinch: this.state.pinch || 0 };
    this.state.pinch = 0;
    return out;
  }

  setLayout({ leftHanded }) { this.leftHanded = !!leftHanded; }
  setSensitivity(s) { this.sensitivity = clamp(s, 0.4, 2.2); }
}

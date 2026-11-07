/**
 * Front Path — polished path-puzzle engine (WeChat + browser).
 * v6: Normal / Timed modes, tall portrait boards, concurrent slides, best times.
 */
(function (root) {
  const { LEVELS, D } = root.FrontPathLevels;

  const COLORS = {
    bg0: '#0b1017',
    bg1: '#121a24',
    panel: '#162033',
    panelEdge: '#2a3d5a',
    cell: '#1a2740',
    cellHi: '#203050',
    arrow: '#5ad0ff',
    arrowDeep: '#2a9fd6',
    arrowBlocked: '#ff6b6b',
    arrowOk: '#6ee7a8',
    text: '#eef3fb',
    muted: '#8fa3bc',
    accent: '#ffc857',
    danger: '#ff5c7a',
    warn: '#ffb020',
    btn: '#243652',
    btnEdge: '#3d5a80',
    btnPrimary: '#2f7dd1',
    btnPrimaryEdge: '#5eb0ff',
    glow: 'rgba(90,208,255,0.35)',
  };

  const BEST_KEY = 'front_path_best_times';
  const BEST_TIMED_KEY = 'front_path_best_times_timed';
  const UNLOCK_KEY = 'front_path_max_unlocked';
  const TOTAL_KEY = 'front_path_total_ms';
  const SOUND_KEY = 'front_path_sound';
  const MODE_KEY = 'front_path_mode';

  function cloneLevel(level) {
    return {
      id: level.id,
      name: level.name,
      w: level.w,
      h: level.h,
      arrows: level.arrows.map(function (a) {
        return { x: a.x, y: a.y, d: a.d, id: a.x + ',' + a.y + ',' + a.d };
      }),
    };
  }

  function storageGet(key, fallback) {
    try {
      if (typeof wx !== 'undefined' && wx.getStorageSync) {
        var v = wx.getStorageSync(key);
        return v === '' || v === undefined || v === null ? fallback : v;
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== 'undefined') {
        var v2 = localStorage.getItem(key);
        if (v2 === null) return fallback;
        try {
          return JSON.parse(v2);
        } catch (_) {
          return v2;
        }
      }
    } catch (e) {}
    return fallback;
  }

  function storageSet(key, value) {
    try {
      if (typeof wx !== 'undefined' && wx.setStorageSync) {
        wx.setStorageSync(key, value);
        return;
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    } catch (e) {}
  }

  function performanceNow() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  function formatTime(ms) {
    ms = Math.max(0, Math.floor(ms || 0));
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  function formatCountdown(ms) {
    ms = Math.max(0, Math.ceil(ms || 0));
    var totalSec = Math.floor(ms / 1000);
    var frac = Math.floor((ms % 1000) / 100);
    var m = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    if (m > 0) {
      return m + ':' + (sec < 10 ? '0' : '') + sec;
    }
    return sec + '.' + frac + 's';
  }

  /** Per-level countdown budget for Timed Mode (ms). */
  function timeLimitFor(level) {
    var n = level.arrows.length;
    var area = level.w * level.h;
    var id = level.id || 1;
    // Early: ~18–28s, mid: ~40–60s, late: ~70–110s
    var sec = 14 + id * 0.55 + n * 1.65 + area * 0.12;
    sec = Math.max(16, Math.min(120, Math.round(sec)));
    return sec * 1000;
  }

  function easeIn(t) {
    return t * t;
  }

  function FrontPathGame(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = opts.dpr || 1;
    this.width = 0;
    this.height = 0;

    this.maxUnlocked = Number(storageGet(UNLOCK_KEY, 1)) || 1;
    if (this.maxUnlocked > LEVELS.length) this.maxUnlocked = LEVELS.length;
    this.bestTimes = storageGet(BEST_KEY, {}) || {};
    if (typeof this.bestTimes !== 'object') this.bestTimes = {};
    this.bestTimesTimed = storageGet(BEST_TIMED_KEY, {}) || {};
    if (typeof this.bestTimesTimed !== 'object') this.bestTimesTimed = {};
    this.soundOn = storageGet(SOUND_KEY, true) !== false;
    this.totalElapsedMs = Number(storageGet(TOTAL_KEY, 0)) || 0;
    this._totalAccruedBase = this.totalElapsedMs;
    var savedMode = storageGet(MODE_KEY, 'normal');
    this.mode = savedMode === 'timed' ? 'timed' : 'normal';

    this.levelIndex = Math.min(Math.max(0, this.maxUnlocked - 1), LEVELS.length - 1);
    this.screen = 'title'; // title | playing | clear | fail
    this.state = 'title';
    this.board = null;
    this.cell = 0;
    this.originX = 0;
    this.originY = 0;
    this.anims = [];
    this.particles = [];
    this.flash = null;
    this.buttons = [];
    this.message = '';
    this.messageUntil = 0;
    this.levelStartedAt = 0;
    this.levelElapsedMs = 0;
    this.levelRemainingMs = 0;
    this.levelTimeLimitMs = 0;
    this.levelTimerFrozen = false;
    this.clearBurstAt = 0;
    this.failAt = 0;
    this.titlePulse = 0;
    this._newBest = false;
    this._audio = null;
    this._urgentBeepAt = 0;

    this._bindInput();
    this._running = true;
    this._last = 0;
    this._loop = this._loop.bind(this);
    this._raf =
      (typeof requestAnimationFrame !== 'undefined' && requestAnimationFrame.bind(root)) ||
      function (cb) {
        return setTimeout(function () {
          cb(Date.now());
        }, 16);
      };
    this._raf(this._loop);
  }

  FrontPathGame.prototype.resize = function (w, h, dpr) {
    this.dpr = dpr || this.dpr || 1;
    this.width = w;
    this.height = h;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    if (this.canvas.style) {
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
    }
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._layout();
  };

  FrontPathGame.prototype._layout = function () {
    if (!this.board || this.screen === 'title') return;
    // Portrait-first: thinner side padding, taller usable board area
    var padX = Math.max(8, Math.floor(this.width * 0.025));
    var header = Math.max(88, Math.min(118, Math.floor(this.height * 0.13)));
    var footer = Math.max(72, Math.min(100, Math.floor(this.height * 0.11)));
    var availW = this.width - padX * 2;
    var availH = this.height - header - footer;
    var cell = Math.floor(Math.min(availW / this.board.w, availH / this.board.h));
    var minCell = this.board.h >= 16 ? 16 : this.board.h >= 12 ? 18 : 24;
    this.cell = Math.max(minCell, Math.min(cell, 72));
    var boardW = this.cell * this.board.w;
    var boardH = this.cell * this.board.h;
    this.originX = Math.floor((this.width - boardW) / 2);
    this.originY = Math.floor(header + Math.max(0, (availH - boardH) / 2));
    this.headerY = 16;
    this.footerY = this.height - Math.max(58, footer - 10);
  };

  FrontPathGame.prototype.loadLevel = function (index) {
    index = Math.max(0, Math.min(index, LEVELS.length - 1));
    this.levelIndex = index;
    this.board = cloneLevel(LEVELS[index]);
    this.screen = 'playing';
    this.state = 'playing';
    this.anims = [];
    this.particles = [];
    this.flash = null;
    this.message = '';
    this.levelStartedAt = performanceNow();
    this.levelElapsedMs = 0;
    this.levelTimeLimitMs = timeLimitFor(this.board);
    this.levelRemainingMs = this.levelTimeLimitMs;
    this.levelTimerFrozen = false;
    this.clearBurstAt = 0;
    this.failAt = 0;
    this._newBest = false;
    this._urgentBeepAt = 0;
    this._layout();
  };

  FrontPathGame.prototype._ensureAudio = function () {
    if (this._audio) return this._audio;
    try {
      var AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;
      this._audio = new AC();
    } catch (e) {
      return null;
    }
    return this._audio;
  };

  FrontPathGame.prototype._beep = function (kind) {
    if (!this.soundOn) return;
    var ac = this._ensureAudio();
    if (!ac) return;
    try {
      if (ac.state === 'suspended') ac.resume();
      var t0 = ac.currentTime;
      var o = ac.createOscillator();
      var g = ac.createGain();
      o.connect(g);
      g.connect(ac.destination);
      if (kind === 'slide') {
        o.type = 'sine';
        o.frequency.setValueAtTime(520, t0);
        o.frequency.exponentialRampToValueAtTime(280, t0 + 0.12);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
        o.start(t0);
        o.stop(t0 + 0.15);
      } else if (kind === 'block') {
        o.type = 'triangle';
        o.frequency.setValueAtTime(160, t0);
        o.frequency.exponentialRampToValueAtTime(90, t0 + 0.1);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.06, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
        o.start(t0);
        o.stop(t0 + 0.13);
      } else if (kind === 'clear') {
        o.type = 'sine';
        o.frequency.setValueAtTime(440, t0);
        o.frequency.exponentialRampToValueAtTime(880, t0 + 0.22);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
        o.start(t0);
        o.stop(t0 + 0.36);
      } else if (kind === 'fail') {
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(220, t0);
        o.frequency.exponentialRampToValueAtTime(70, t0 + 0.28);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
        o.start(t0);
        o.stop(t0 + 0.32);
      } else if (kind === 'urgent') {
        o.type = 'square';
        o.frequency.setValueAtTime(880, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.035, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
        o.start(t0);
        o.stop(t0 + 0.09);
      } else if (kind === 'tap') {
        o.type = 'sine';
        o.frequency.setValueAtTime(660, t0);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.03, t0 + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
        o.start(t0);
        o.stop(t0 + 0.07);
      }
    } catch (e) {}
  };

  FrontPathGame.prototype._bindInput = function () {
    var self = this;
    this._lastPointerId = null;
    this._lastTapAt = 0;
    this._lastTapKey = '';

    var onDown = function (x, y, pointerId) {
      var now = performanceNow();
      var key = Math.round(x) + ':' + Math.round(y);
      if (pointerId != null && pointerId === self._lastPointerId && now - self._lastTapAt < 40) return;
      if (key === self._lastTapKey && now - self._lastTapAt < 40) return;
      self._lastPointerId = pointerId;
      self._lastTapAt = now;
      self._lastTapKey = key;
      self._onTap(x, y);
    };

    if (typeof wx !== 'undefined' && wx.onTouchStart) {
      wx.onTouchStart(function (e) {
        var touches = e.changedTouches || e.touches || [];
        for (var i = 0; i < touches.length; i++) {
          var t = touches[i];
          onDown(t.clientX, t.clientY, t.identifier);
        }
      });
      return;
    }

    var el = this.canvas;
    var toLocal = function (e) {
      var rect = el.getBoundingClientRect();
      var clientX, clientY, pid = null;
      if (e.changedTouches && e.changedTouches[0]) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
        pid = e.changedTouches[0].identifier;
      } else if (e.touches && e.touches[0]) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
        pid = e.touches[0].identifier;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
        pid = e.pointerId != null ? e.pointerId : 'mouse';
      }
      return { x: clientX - rect.left, y: clientY - rect.top, pid: pid };
    };

    var handler = function (e) {
      if (e.cancelable) e.preventDefault();
      var p = toLocal(e);
      onDown(p.x, p.y, p.pid);
    };

    if (typeof window !== 'undefined' && window.PointerEvent) {
      el.addEventListener('pointerdown', handler, { passive: false });
    } else {
      el.addEventListener('mousedown', handler);
      el.addEventListener('touchstart', handler, { passive: false });
    }
  };

  FrontPathGame.prototype._hitButton = function (x, y) {
    for (var i = 0; i < this.buttons.length; i++) {
      var b = this.buttons[i];
      if (b.disabled) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  };

  FrontPathGame.prototype._isSliding = function (arrow) {
    if (!arrow) return false;
    if (arrow.departing) return true;
    for (var i = 0; i < this.anims.length; i++) {
      if (this.anims[i].type === 'slide' && this.anims[i].arrow === arrow) return true;
    }
    return false;
  };

  FrontPathGame.prototype._hitArrow = function (x, y) {
    var cell = this.cell || 1;
    var radius = cell * 0.75;
    var r2 = radius * radius;
    var best = null;
    var bestDist = r2;
    for (var i = 0; i < this.board.arrows.length; i++) {
      var a = this.board.arrows[i];
      if (a.departing) continue;
      var cx = this.originX + (a.x + 0.5) * cell;
      var cy = this.originY + (a.y + 0.5) * cell;
      var dx = x - cx;
      var dy = y - cy;
      var d2 = dx * dx + dy * dy;
      if (d2 <= bestDist) {
        bestDist = d2;
        best = a;
      }
    }
    return best;
  };

  FrontPathGame.prototype._setMode = function (mode) {
    this.mode = mode === 'timed' ? 'timed' : 'normal';
    storageSet(MODE_KEY, this.mode);
  };

  FrontPathGame.prototype._onTap = function (x, y) {
    var btn = this._hitButton(x, y);
    if (btn) {
      this._beep('tap');
      if (btn.id === 'mode_normal') {
        this._setMode('normal');
        return;
      }
      if (btn.id === 'mode_timed') {
        this._setMode('timed');
        return;
      }
      if (btn.id === 'play') {
        this.loadLevel(0);
        return;
      }
      if (btn.id === 'continue') {
        this.loadLevel(Math.min(this.maxUnlocked - 1, LEVELS.length - 1));
        return;
      }
      if (btn.id === 'menu') {
        this.screen = 'title';
        this.state = 'title';
        this.board = null;
        this.anims = [];
        this.particles = [];
        return;
      }
      if (btn.id === 'sound') {
        this.soundOn = !this.soundOn;
        storageSet(SOUND_KEY, this.soundOn);
        return;
      }
      if (btn.id === 'retry') {
        this.loadLevel(this.levelIndex);
        return;
      }
      if (btn.id === 'next') {
        if (this.state === 'clear' || this.screen === 'clear') {
          if (this.levelIndex < LEVELS.length - 1) this.loadLevel(this.levelIndex + 1);
          else {
            this.screen = 'title';
            this.state = 'title';
            this.board = null;
          }
        } else if (this.levelIndex + 1 < this.maxUnlocked) {
          this.loadLevel(this.levelIndex + 1);
        }
        return;
      }
      if (btn.id === 'prev' && this.levelIndex > 0) {
        this.loadLevel(this.levelIndex - 1);
        return;
      }
      return;
    }

    if (this.screen === 'title') return;
    if (this.state === 'fail') return;
    if (this.state !== 'playing') return;
    if (!this.board) return;

    var arrow = this._hitArrow(x, y);
    if (!arrow) return;
    this._trySlide(arrow);
  };

  FrontPathGame.prototype._occupied = function (x, y, skip) {
    for (var i = 0; i < this.board.arrows.length; i++) {
      var a = this.board.arrows[i];
      if (a === skip) continue;
      if (a.departing || this._isSliding(a)) continue;
      if (a.x === x && a.y === y) return true;
    }
    return false;
  };

  FrontPathGame.prototype._pathClear = function (arrow) {
    var dir = D[arrow.d];
    var x = arrow.x + dir[0];
    var y = arrow.y + dir[1];
    var path = [];
    while (x >= 0 && y >= 0 && x < this.board.w && y < this.board.h) {
      if (this._occupied(x, y, arrow)) {
        return { ok: false, blockedAt: { x: x, y: y }, path: path };
      }
      path.push({ x: x, y: y });
      x += dir[0];
      y += dir[1];
    }
    return { ok: true, path: path, exit: { x: x, y: y } };
  };

  FrontPathGame.prototype._spawnClearParticles = function () {
    var cx = this.width / 2;
    var cy = this.height / 2;
    for (var i = 0; i < 28; i++) {
      var ang = (Math.PI * 2 * i) / 28 + Math.random() * 0.2;
      var spd = 60 + Math.random() * 160;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        life: 0.7 + Math.random() * 0.5,
        age: 0,
        color: i % 2 ? COLORS.arrow : COLORS.accent,
        r: 2 + Math.random() * 3,
      });
    }
  };

  FrontPathGame.prototype._recordBest = function () {
    var id = String(this.board.id);
    if (this.mode === 'timed') {
      // Best = most time remaining (higher is better)
      var rem = Math.max(0, this.levelRemainingMs);
      var prev = this.bestTimesTimed[id];
      if (prev == null || rem > prev) {
        this.bestTimesTimed[id] = rem;
        storageSet(BEST_TIMED_KEY, this.bestTimesTimed);
        this._newBest = true;
      } else {
        this._newBest = false;
      }
    } else {
      var prevN = this.bestTimes[id];
      if (prevN == null || this.levelElapsedMs < prevN) {
        this.bestTimes[id] = this.levelElapsedMs;
        storageSet(BEST_KEY, this.bestTimes);
        this._newBest = true;
      } else {
        this._newBest = false;
      }
    }
  };

  FrontPathGame.prototype._checkClear = function () {
    if (this.state !== 'playing') return;
    var idle = this.board.arrows.filter(function (a) {
      return !a.departing;
    });
    var sliding = this.anims.some(function (a) {
      return a.type === 'slide';
    });
    if (idle.length === 0 && !sliding) {
      this.state = 'clear';
      this.screen = 'clear';
      this.message = 'Clear!';
      this.messageUntil = performanceNow() + 2500;
      if (!this.levelTimerFrozen) {
        this.levelElapsedMs = Math.max(0, performanceNow() - this.levelStartedAt);
        if (this.mode === 'timed') {
          this.levelRemainingMs = Math.max(0, this.levelTimeLimitMs - this.levelElapsedMs);
        }
        this.levelTimerFrozen = true;
        this.totalElapsedMs = this._totalAccruedBase + this.levelElapsedMs;
        this._totalAccruedBase = this.totalElapsedMs;
        storageSet(TOTAL_KEY, this.totalElapsedMs);
        this._recordBest();
      }
      var unlocked = Math.max(this.maxUnlocked, this.levelIndex + 2);
      this.maxUnlocked = Math.min(unlocked, LEVELS.length);
      storageSet(UNLOCK_KEY, this.maxUnlocked);
      this.clearBurstAt = performanceNow();
      this._spawnClearParticles();
      this._beep('clear');
    }
  };

  FrontPathGame.prototype._triggerFail = function () {
    if (this.state !== 'playing') return;
    this.state = 'fail';
    this.screen = 'fail';
    this.levelTimerFrozen = true;
    this.levelRemainingMs = 0;
    this.failAt = performanceNow();
    this.anims = [];
    this._beep('fail');
  };

  FrontPathGame.prototype._trySlide = function (arrow) {
    if (!arrow || arrow.departing) return;
    if (this.state !== 'playing') return;
    var result = this._pathClear(arrow);
    if (!result.ok) {
      this.flash = { arrow: arrow, until: performanceNow() + 220, kind: 'blocked' };
      this.message = 'Blocked';
      this.messageUntil = performanceNow() + 550;
      this.anims = this.anims.filter(function (a) {
        return !(a.type === 'shake' && a.arrow === arrow);
      });
      this.anims.push({ type: 'shake', arrow: arrow, t0: performanceNow(), dur: 220 });
      this._beep('block');
      return;
    }

    arrow.departing = true;
    var cells = result.path.slice();
    cells.push(result.exit);
    var anim = {
      type: 'slide',
      arrow: arrow,
      cells: cells,
      t0: performanceNow(),
      dur: Math.max(130, cells.length * 50),
    };
    var self = this;
    anim.onDone = function () {
      self.board.arrows = self.board.arrows.filter(function (a) {
        return a !== arrow;
      });
      self.anims = self.anims.filter(function (a) {
        return a !== anim;
      });
      self._checkClear();
    };
    this.anims.push(anim);
    this._beep('slide');
  };

  FrontPathGame.prototype._loop = function (ts) {
    if (!this._running) return;
    var dt = this._last ? Math.min(50, ts - this._last) : 16;
    this._last = ts;
    this._update(ts, dt);
    this._draw(ts);
    this._raf(this._loop);
  };

  FrontPathGame.prototype._update = function (ts, dt) {
    this.titlePulse = ts;
    if (!this.levelTimerFrozen && this.state === 'playing' && this.levelStartedAt) {
      this.levelElapsedMs = Math.max(0, ts - this.levelStartedAt);
      if (this.mode === 'timed') {
        this.levelRemainingMs = Math.max(0, this.levelTimeLimitMs - this.levelElapsedMs);
        if (this.levelRemainingMs <= 0) {
          this._triggerFail();
        } else if (this.levelRemainingMs <= 5000) {
          // Soft tick every ~0.8s under 5s
          if (!this._urgentBeepAt || ts - this._urgentBeepAt > 800) {
            this._urgentBeepAt = ts;
            this._beep('urgent');
          }
        }
      }
    }
    var list = this.anims.slice();
    for (var i = 0; i < list.length; i++) {
      var anim = list[i];
      var t = (ts - anim.t0) / anim.dur;
      if (t >= 1) {
        if (anim.onDone) anim.onDone();
        else {
          this.anims = this.anims.filter(function (a) {
            return a !== anim;
          });
        }
      }
    }
    if (this.flash && ts > this.flash.until) this.flash = null;

    var dts = (dt || 16) / 1000;
    for (var p = this.particles.length - 1; p >= 0; p--) {
      var pt = this.particles[p];
      pt.age += dts;
      pt.x += pt.vx * dts;
      pt.y += pt.vy * dts;
      pt.vy += 40 * dts;
      if (pt.age >= pt.life) this.particles.splice(p, 1);
    }
  };

  FrontPathGame.prototype._drawBg = function (ctx, w, h) {
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, COLORS.bg0);
    g.addColorStop(1, COLORS.bg1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(90,208,255,0.03)';
    for (var i = 0; i < 12; i++) {
      var rx = (i * 97) % w;
      var ry = (i * 53) % h;
      ctx.beginPath();
      ctx.arc(rx, ry, 40 + (i % 5) * 10, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  FrontPathGame.prototype._draw = function (ts) {
    var ctx = this.ctx;
    var w = this.width;
    var h = this.height;
    ctx.clearRect(0, 0, w, h);
    this._drawBg(ctx, w, h);
    this.buttons = [];

    if (this.screen === 'title') {
      this._drawTitle(ctx, w, h, ts);
      return;
    }

    this._drawPlay(ctx, w, h, ts);

    for (var i = 0; i < this.particles.length; i++) {
      var pt = this.particles[i];
      var a = 1 - pt.age / pt.life;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  FrontPathGame.prototype._drawTitle = function (ctx, w, h, ts) {
    var pulse = 0.5 + 0.5 * Math.sin((ts || 0) / 500);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 40px system-ui, -apple-system, sans-serif';
    ctx.fillText('Front Path', w / 2, h * 0.12);

    ctx.fillStyle = COLORS.muted;
    ctx.font = '14px system-ui, -apple-system, sans-serif';
    ctx.fillText('Slide arrows off the board · plan the order', w / 2, h * 0.12 + 32);

    var demoY = h * 0.24;
    var dirs = ['L', 'U', 'R', 'D'];
    for (var i = 0; i < 4; i++) {
      this._drawArrowAt(ctx, w / 2 + (i - 1.5) * 52, demoY, dirs[i], COLORS.arrow, 0.75 + pulse * 0.25, 0, 40);
    }

    var cleared = 0;
    var bestMap = this.mode === 'timed' ? this.bestTimesTimed : this.bestTimes;
    for (var k in bestMap) if (Object.prototype.hasOwnProperty.call(bestMap, k)) cleared++;

    ctx.fillStyle = COLORS.accent;
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      LEVELS.length + ' levels · ' + Math.max(0, this.maxUnlocked - 1) + ' cleared · records ' + cleared,
      w / 2,
      h * 0.32
    );

    // Mode select
    ctx.fillStyle = COLORS.muted;
    ctx.font = '13px system-ui, -apple-system, sans-serif';
    ctx.fillText('Choose mode', w / 2, h * 0.38);

    var gap = 12;
    var modeW = Math.min(150, (w - 48 - gap) / 2);
    var modeH = 64;
    var modeY = h * 0.42;
    var leftX = w / 2 - modeW - gap / 2;
    var rightX = w / 2 + gap / 2;

    this._drawModeCard(ctx, leftX, modeY, modeW, modeH, 'Normal', 'No limit · stopwatch', 'mode_normal', this.mode === 'normal');
    this._drawModeCard(ctx, rightX, modeY, modeW, modeH, 'Timed', 'Countdown · urgency', 'mode_timed', this.mode === 'timed');

    var bw = Math.min(240, w - 48);
    var bh = 52;
    var bx = (w - bw) / 2;
    var playY = modeY + modeH + 28;
    this._drawBtn(ctx, bx, playY, bw, bh, this.maxUnlocked > 1 ? 'Continue' : 'Play', this.maxUnlocked > 1 ? 'continue' : 'play', false, true);
    if (this.maxUnlocked > 1) {
      this._drawBtn(ctx, bx, playY + 64, bw, bh, 'Play from Level 1', 'play', false, false);
    }
    var soundY = playY + (this.maxUnlocked > 1 ? 128 : 64);
    this._drawBtn(ctx, bx, soundY, bw, 44, this.soundOn ? 'Sound: On' : 'Sound: Off', 'sound', false, false);

    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      this.mode === 'timed' ? 'Beat the clock on every level' : 'Take your time · chase best times',
      w / 2,
      h - 36
    );
  };

  FrontPathGame.prototype._drawModeCard = function (ctx, x, y, bw, bh, title, sub, id, selected) {
    this.buttons.push({ x: x, y: y, w: bw, h: bh, id: id, disabled: false });
    roundRect(ctx, x, y, bw, bh, 14);
    if (selected) {
      var g = ctx.createLinearGradient(x, y, x, y + bh);
      g.addColorStop(0, '#3a8be0');
      g.addColorStop(1, COLORS.btnPrimary);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = COLORS.btn;
    }
    ctx.fill();
    ctx.strokeStyle = selected ? COLORS.btnPrimaryEdge : COLORS.btnEdge;
    ctx.lineWidth = selected ? 2 : 1.2;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
    ctx.fillText(title, x + bw / 2, y + bh / 2 - 10);
    ctx.fillStyle = selected ? 'rgba(255,255,255,0.85)' : COLORS.muted;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillText(sub, x + bw / 2, y + bh / 2 + 12);
  };

  FrontPathGame.prototype._drawPlay = function (ctx, w, h, ts) {
    var lv = this.board;
    var bestMap = this.mode === 'timed' ? this.bestTimesTimed : this.bestTimes;
    var best = bestMap[String(lv.id)];

    // HUD top
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
    ctx.fillText('Front Path', 16, 12);

    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    ctx.fillText(
      'Lv ' + lv.id + '/' + LEVELS.length + ' · ' + lv.name + ' · ' + lv.w + '×' + lv.h,
      16,
      36
    );

    var leftCount = 0;
    for (var li = 0; li < lv.arrows.length; li++) if (!lv.arrows[li].departing) leftCount++;

    // Timer display
    ctx.textAlign = 'right';
    if (this.mode === 'timed') {
      var rem = this.levelRemainingMs;
      var urgent = rem <= 5000 && this.state === 'playing';
      var critical = rem <= 3000 && this.state === 'playing';
      ctx.fillStyle = this.state === 'fail' ? COLORS.danger : critical ? COLORS.danger : urgent ? COLORS.warn : COLORS.accent;
      ctx.font = 'bold 26px ui-monospace, SFMono-Regular, Menlo, monospace';
      // pulse when urgent
      if (urgent && this.state === 'playing') {
        var p = 0.85 + 0.15 * Math.sin(ts / 120);
        ctx.globalAlpha = p;
      }
      ctx.fillText(formatCountdown(rem), w - 16, 10);
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.muted;
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.fillText(this.state === 'fail' ? 'time up' : this.levelTimerFrozen ? 'left' : 'countdown', w - 16, 40);

      // countdown bar under HUD
      var barW = Math.min(w - 32, 220);
      var barX = w - 16 - barW;
      var barY = 56;
      var pct = this.levelTimeLimitMs > 0 ? Math.max(0, Math.min(1, rem / this.levelTimeLimitMs)) : 0;
      roundRect(ctx, barX, barY, barW, 6, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
      roundRect(ctx, barX, barY, Math.max(2, barW * pct), 6, 3);
      ctx.fillStyle = critical ? COLORS.danger : urgent ? COLORS.warn : COLORS.accent;
      ctx.fill();
    } else {
      ctx.fillStyle = this.levelTimerFrozen ? COLORS.arrowOk : COLORS.text;
      ctx.font = 'bold 22px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(formatTime(this.levelElapsedMs), w - 16, 10);
      ctx.fillStyle = COLORS.muted;
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.fillText(this.levelTimerFrozen ? 'cleared' : 'level time', w - 16, 36);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.accent;
    ctx.font = '12px system-ui, -apple-system, sans-serif';
    var bestLabel;
    if (this.mode === 'timed') {
      bestLabel = best != null ? 'Best left ' + formatCountdown(best) : 'Best —';
    } else {
      bestLabel = best != null ? 'Best ' + formatTime(best) : 'Best —';
    }
    ctx.fillText(bestLabel + '   ·   ' + leftCount + ' left', 16, this.mode === 'timed' ? 68 : 56);

    // Board panel
    var boardW = this.cell * lv.w;
    var boardH = this.cell * lv.h;
    roundRect(ctx, this.originX - 8, this.originY - 8, boardW + 16, boardH + 16, 14);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.strokeStyle = COLORS.panelEdge;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    for (var y = 0; y < lv.h; y++) {
      for (var x = 0; x < lv.w; x++) {
        var cx = this.originX + x * this.cell;
        var cy = this.originY + y * this.cell;
        var pad = Math.max(2, Math.floor(this.cell * 0.08));
        roundRect(ctx, cx + pad, cy + pad, this.cell - pad * 2, this.cell - pad * 2, Math.min(8, this.cell * 0.2));
        ctx.fillStyle = (x + y) % 2 === 0 ? COLORS.cell : COLORS.cellHi;
        ctx.fill();
      }
    }

    for (var i = 0; i < lv.arrows.length; i++) {
      var a = lv.arrows[i];
      var drawX = a.x;
      var drawY = a.y;
      var alpha = 1;
      var shake = 0;
      var anim = null;
      for (var ai = 0; ai < this.anims.length; ai++) {
        if (this.anims[ai].arrow === a) {
          anim = this.anims[ai];
          break;
        }
      }
      if (anim) {
        if (anim.type === 'slide') {
          var t = Math.min(1, (ts - anim.t0) / anim.dur);
          var eased = easeIn(t);
          var positions = [{ x: a.x, y: a.y }].concat(anim.cells);
          var pIdx = eased * (positions.length - 1);
          var p0 = Math.floor(pIdx);
          var p1 = Math.min(p0 + 1, positions.length - 1);
          var pf = pIdx - p0;
          drawX = positions[p0].x + (positions[p1].x - positions[p0].x) * pf;
          drawY = positions[p0].y + (positions[p1].y - positions[p0].y) * pf;
          alpha = 1 - eased * 0.9;
        } else if (anim.type === 'shake') {
          var t2 = Math.min(1, (ts - anim.t0) / anim.dur);
          shake = Math.sin(t2 * Math.PI * 7) * (1 - t2) * 5;
        }
      }
      var color = COLORS.arrow;
      if (this.flash && this.flash.arrow === a) color = COLORS.arrowBlocked;
      this._drawArrow(ctx, drawX, drawY, a.d, color, alpha, shake);
    }

    if (this.message && ts < this.messageUntil && this.state === 'playing') {
      ctx.fillStyle = COLORS.arrowBlocked;
      ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.message, w / 2, this.originY - 14);
    }

    // Clear overlay
    if (this.state === 'clear') {
      var burst = this.clearBurstAt ? Math.min(1, (ts - this.clearBurstAt) / 400) : 1;
      ctx.fillStyle = 'rgba(11,16,23,' + (0.45 + 0.2 * burst) + ')';
      ctx.fillRect(0, 0, w, h);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.arrowOk;
      ctx.font = 'bold 40px system-ui, -apple-system, sans-serif';
      ctx.fillText('Clear!', w / 2, h / 2 - 58);

      ctx.fillStyle = COLORS.text;
      ctx.font = 'bold 26px ui-monospace, SFMono-Regular, Menlo, monospace';
      if (this.mode === 'timed') {
        ctx.fillText(formatCountdown(this.levelRemainingMs) + ' left', w / 2, h / 2 - 12);
      } else {
        ctx.fillText(formatTime(this.levelElapsedMs), w / 2, h / 2 - 12);
      }

      ctx.fillStyle = this._newBest ? COLORS.accent : COLORS.muted;
      ctx.font = '14px system-ui, -apple-system, sans-serif';
      var bestLine = '';
      if (this.mode === 'timed') {
        var bt = this.bestTimesTimed[String(lv.id)];
        bestLine = bt != null ? 'Best left ' + formatCountdown(bt) : '';
      } else {
        var bn = this.bestTimes[String(lv.id)];
        bestLine = bn != null ? 'Best ' + formatTime(bn) : '';
      }
      ctx.fillText(this._newBest ? 'New best!' : bestLine, w / 2, h / 2 + 18);
    }

    // Fail overlay
    if (this.state === 'fail') {
      ctx.fillStyle = 'rgba(11,16,23,0.62)';
      ctx.fillRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLORS.danger;
      ctx.font = 'bold 38px system-ui, -apple-system, sans-serif';
      ctx.fillText("Time's up!", w / 2, h / 2 - 36);
      ctx.fillStyle = COLORS.muted;
      ctx.font = '14px system-ui, -apple-system, sans-serif';
      ctx.fillText('Retry and beat the countdown', w / 2, h / 2);
    }

    // Footer buttons
    var btnY = this.footerY;
    var btnH = 46;
    var gap = 10;
    var btnW = Math.min(108, (w - 36 - gap * 2) / 3);
    this._drawBtn(ctx, 16, btnY, btnW, btnH, 'Retry', 'retry', false, this.state === 'fail');
    var midX = (w - btnW) / 2;
    if (this.levelIndex > 0) this._drawBtn(ctx, midX, btnY, btnW, btnH, 'Prev', 'prev');
    else this._drawBtn(ctx, midX, btnY, btnW, btnH, 'Menu', 'menu');

    var nextLabel =
      this.state === 'clear'
        ? this.levelIndex < LEVELS.length - 1
          ? 'Next'
          : 'Menu'
        : 'Next';
    var nextEnabled = this.state === 'clear' || this.levelIndex + 1 < this.maxUnlocked;
    this._drawBtn(
      ctx,
      w - 16 - btnW,
      btnY,
      btnW,
      btnH,
      nextLabel,
      'next',
      !nextEnabled && this.state !== 'clear',
      this.state === 'clear'
    );
  };

  FrontPathGame.prototype._drawBtn = function (ctx, x, y, bw, bh, label, id, disabled, primary) {
    this.buttons.push({ x: x, y: y, w: bw, h: bh, id: id, disabled: !!disabled });
    roundRect(ctx, x, y, bw, bh, 12);
    if (primary && !disabled) {
      var g = ctx.createLinearGradient(x, y, x, y + bh);
      g.addColorStop(0, '#3a8be0');
      g.addColorStop(1, COLORS.btnPrimary);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = disabled ? '#152032' : COLORS.btn;
    }
    ctx.fill();
    ctx.strokeStyle = disabled ? '#243044' : primary ? COLORS.btnPrimaryEdge : COLORS.btnEdge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = disabled ? '#5a6b80' : COLORS.text;
    ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + bw / 2, y + bh / 2 + 0.5);
  };

  FrontPathGame.prototype._drawArrow = function (ctx, gx, gy, dir, color, alpha, shake) {
    var cx = this.originX + (gx + 0.5) * this.cell + (shake || 0);
    var cy = this.originY + (gy + 0.5) * this.cell;
    this._drawArrowAt(ctx, cx, cy, dir, color, alpha, shake, this.cell);
  };

  FrontPathGame.prototype._drawArrowAt = function (ctx, cx, cy, dir, color, alpha, shake, cell) {
    var s = cell * 0.3;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(cx, cy);
    var rot = { U: -Math.PI / 2, D: Math.PI / 2, L: Math.PI, R: 0 }[dir];
    ctx.rotate(rot);

    ctx.beginPath();
    ctx.arc(0, 0, cell * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.glow;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, cell * 0.34, 0, Math.PI * 2);
    var g = ctx.createRadialGradient(-cell * 0.1, -cell * 0.1, 2, 0, 0, cell * 0.34);
    g.addColorStop(0, '#9ae6ff');
    g.addColorStop(0.55, color);
    g.addColorStop(1, COLORS.arrowDeep);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, cell * 0.34, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#071018';
    ctx.beginPath();
    ctx.moveTo(s * 0.9, 0);
    ctx.lineTo(-s * 0.3, s * 0.72);
    ctx.lineTo(-s * 0.3, s * 0.28);
    ctx.lineTo(-s * 0.85, s * 0.28);
    ctx.lineTo(-s * 0.85, -s * 0.28);
    ctx.lineTo(-s * 0.3, -s * 0.28);
    ctx.lineTo(-s * 0.3, -s * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  FrontPathGame.prototype.destroy = function () {
    this._running = false;
  };

  root.FrontPathGame = FrontPathGame;
  root.FrontPathLEVELS = LEVELS;
})(
  typeof GameGlobal !== 'undefined'
    ? GameGlobal
    : typeof window !== 'undefined'
      ? window
      : typeof globalThis !== 'undefined'
        ? globalThis
        : this
);

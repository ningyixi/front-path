/**
 * Front Path — shared canvas path-puzzle engine.
 * Works in WeChat mini-game (wx) and browser (Canvas + localStorage).
 * multi-anim v4 + timer: no global lock; departing arrows free hits immediately.
 */
(function (root) {
  const { LEVELS, D } = root.FrontPathLevels;

  const COLORS = {
    bg: '#0f1419',
    panel: '#1a2332',
    grid: '#243044',
    cell: '#1e2a3a',
    arrow: '#4fc3f7',
    arrowBlocked: '#ef5350',
    arrowOk: '#66bb6a',
    text: '#e8eef7',
    muted: '#8a9bb0',
    accent: '#ffb74d',
    btn: '#2a3a52',
    btnHover: '#3a4f6e',
  };

  function cloneLevel(level) {
    return {
      id: level.id,
      name: level.name,
      w: level.w,
      h: level.h,
      arrows: level.arrows.map((a) => ({ x: a.x, y: a.y, d: a.d, id: a.x + ',' + a.y + ',' + a.d })),
    };
  }

  function storageGet(key, fallback) {
    try {
      if (typeof wx !== 'undefined' && wx.getStorageSync) {
        const v = wx.getStorageSync(key);
        return v === '' || v === undefined || v === null ? fallback : v;
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== 'undefined') {
        const v = localStorage.getItem(key);
        if (v === null) return fallback;
        try {
          return JSON.parse(v);
        } catch (_) {
          return v;
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

  function FrontPathGame(canvas, opts) {
    opts = opts || {};
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = opts.dpr || 1;
    this.width = 0;
    this.height = 0;

    this.maxUnlocked = Number(storageGet('front_path_max_unlocked', 1)) || 1;
    this.levelIndex = Math.min(this.maxUnlocked, LEVELS.length) - 1;
    this.state = null; // playing | clear
    this.board = null;
    this.cell = 0;
    this.originX = 0;
    this.originY = 0;
    this.anims = []; // concurrent slide/shake animations
    this.flash = null;
    this.buttons = [];
    this.message = '';
    this.messageUntil = 0;
    this.levelStartedAt = 0;
    this.levelElapsedMs = 0;
    this.levelTimerFrozen = false;
    this.totalElapsedMs = Number(storageGet('front_path_total_ms', 0)) || 0;
    this._totalAccruedBase = this.totalElapsedMs;

    this.loadLevel(this.levelIndex);
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
    if (!this.board) return;
    // Use most of the viewport: thin chrome, large cells, roomy boards.
    const padX = Math.max(8, Math.floor(this.width * 0.02));
    const padY = 8;
    const header = Math.max(64, Math.min(84, Math.floor(this.height * 0.1)));
    const footer = Math.max(72, Math.min(96, Math.floor(this.height * 0.12)));
    const availW = this.width - padX * 2;
    const availH = this.height - header - footer - padY;
    let cell = Math.floor(Math.min(availW / this.board.w, availH / this.board.h));
    // Prefer filling the screen; allow big cells on phones/tablets and huge boards.
    const minCell = this.board.w >= 10 || this.board.h >= 10 ? 22 : 28;
    const maxCell = 96;
    this.cell = Math.max(minCell, Math.min(cell, maxCell));
    const boardW = this.cell * this.board.w;
    const boardH = this.cell * this.board.h;
    this.originX = Math.floor((this.width - boardW) / 2);
    this.originY = Math.floor(header + Math.max(0, (availH - boardH) / 2));
    this.headerY = Math.max(16, Math.floor(header * 0.28));
    this.footerY = this.height - Math.max(56, footer - 16);
  };

  FrontPathGame.prototype.loadLevel = function (index) {
    index = Math.max(0, Math.min(index, LEVELS.length - 1));
    this.levelIndex = index;
    this.board = cloneLevel(LEVELS[index]);
    this.state = 'playing';
    this.anims = [];
    this.flash = null;
    this.message = '';
    this.levelStartedAt = performanceNow();
    this.levelElapsedMs = 0;
    this.levelTimerFrozen = false;
    this._layout();
  };

  FrontPathGame.prototype._bindInput = function () {
    const self = this;
    this._lastPointerId = null;
    this._lastTapAt = 0;
    this._lastTapKey = '';

    const onDown = function (x, y, pointerId) {
      // Deduplicate touchstart+mousedown / pointer+mouse for the SAME gesture only.
      // Never block a tap on a different arrow.
      const now = performanceNow();
      const key = Math.round(x) + ':' + Math.round(y);
      if (pointerId != null && pointerId === self._lastPointerId && now - self._lastTapAt < 40) return;
      if (key === self._lastTapKey && now - self._lastTapAt < 40) return;
      self._lastPointerId = pointerId;
      self._lastTapAt = now;
      self._lastTapKey = key;
      self._onTap(x, y);
    };

    if (typeof wx !== 'undefined' && wx.onTouchStart) {
      wx.onTouchStart(function (e) {
        const touches = e.changedTouches || e.touches || [];
        for (let i = 0; i < touches.length; i++) {
          const t = touches[i];
          onDown(t.clientX, t.clientY, t.identifier);
        }
      });
      return;
    }

    const el = this.canvas;
    const toLocal = function (e) {
      const rect = el.getBoundingClientRect();
      let clientX, clientY, pid = null;
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

    const handler = function (e) {
      // Always handle; never wait on animations.
      if (e.cancelable) e.preventDefault();
      const p = toLocal(e);
      onDown(p.x, p.y, p.pid);
    };

    // Prefer pointerdown (mouse + touch + pen). Keep touchstart/mousedown as fallback.
    if (typeof window !== 'undefined' && window.PointerEvent) {
      el.addEventListener('pointerdown', handler, { passive: false });
    } else {
      el.addEventListener('mousedown', handler);
      el.addEventListener('touchstart', handler, { passive: false });
    }
  };

  FrontPathGame.prototype._hitButton = function (x, y) {
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  };

  FrontPathGame.prototype._isSliding = function (arrow) {
    if (!arrow) return false;
    if (arrow.departing) return true;
    for (let i = 0; i < this.anims.length; i++) {
      if (this.anims[i].type === 'slide' && this.anims[i].arrow === arrow) return true;
    }
    return false;
  };

  /** Nearest idle (non-departing) arrow; generous touch radius. */
  FrontPathGame.prototype._hitArrow = function (x, y) {
    const cell = this.cell || 1;
    const radius = cell * 0.72; // large touch target
    const r2 = radius * radius;
    let best = null;
    let bestDist = r2;
    for (let i = 0; i < this.board.arrows.length; i++) {
      const a = this.board.arrows[i];
      if (a.departing) continue;
      const cx = this.originX + (a.x + 0.5) * cell;
      const cy = this.originY + (a.y + 0.5) * cell;
      const dx = x - cx;
      const dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 <= bestDist) {
        bestDist = d2;
        best = a;
      }
    }
    return best;
  };

  FrontPathGame.prototype._onTap = function (x, y) {
    // Buttons always work; NEVER gate on animations / busy / single-anim lock.
    const btn = this._hitButton(x, y);
    if (btn) {
      if (btn.id === 'retry') this.loadLevel(this.levelIndex);
      if (btn.id === 'next') {
        if (this.state === 'clear') {
          if (this.levelIndex < LEVELS.length - 1) this.loadLevel(this.levelIndex + 1);
          else this.loadLevel(0);
        } else if (this.levelIndex + 1 < this.maxUnlocked) {
          this.loadLevel(this.levelIndex + 1);
        }
      }
      if (btn.id === 'prev' && this.levelIndex > 0) this.loadLevel(this.levelIndex - 1);
      return;
    }

    if (this.state !== 'playing') return;

    const arrow = this._hitArrow(x, y);
    if (!arrow) return;
    // Start immediately — concurrent slides are allowed.
    this._trySlide(arrow);
  };

  FrontPathGame.prototype._occupied = function (x, y, skip) {
    for (let i = 0; i < this.board.arrows.length; i++) {
      const a = this.board.arrows[i];
      if (a === skip) continue;
      // Departing / sliding-out arrows do not block — chains work mid-flight.
      if (a.departing || this._isSliding(a)) continue;
      if (a.x === x && a.y === y) return true;
    }
    return false;
  };

  FrontPathGame.prototype._pathClear = function (arrow) {
    const dir = D[arrow.d];
    let x = arrow.x + dir[0];
    let y = arrow.y + dir[1];
    const path = [];
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

  FrontPathGame.prototype._checkClear = function () {
    if (this.state !== 'playing') return;
    const idle = this.board.arrows.filter(function (a) { return !a.departing; });
    const sliding = this.anims.some(function (a) { return a.type === 'slide'; });
    if (idle.length === 0 && !sliding) {
      this.state = 'clear';
      this.message = 'Clear!';
      this.messageUntil = performanceNow() + 2000;
      if (!this.levelTimerFrozen) {
        this.levelElapsedMs = Math.max(0, performanceNow() - this.levelStartedAt);
        this.levelTimerFrozen = true;
        this.totalElapsedMs = this._totalAccruedBase + this.levelElapsedMs;
        this._totalAccruedBase = this.totalElapsedMs;
        storageSet('front_path_total_ms', this.totalElapsedMs);
      }
      const unlocked = Math.max(this.maxUnlocked, this.levelIndex + 2);
      this.maxUnlocked = Math.min(unlocked, LEVELS.length);
      storageSet('front_path_max_unlocked', this.maxUnlocked);
    }
  };

  FrontPathGame.prototype._trySlide = function (arrow) {
    if (!arrow || arrow.departing) return;
    const result = this._pathClear(arrow);
    if (!result.ok) {
      this.flash = { arrow: arrow, until: performanceNow() + 220, kind: 'blocked' };
      this.message = 'Blocked';
      this.messageUntil = performanceNow() + 600;
      this.anims = this.anims.filter(function (a) {
        return !(a.type === 'shake' && a.arrow === arrow);
      });
      this.anims.push({
        type: 'shake',
        arrow: arrow,
        t0: performanceNow(),
        dur: 220,
      });
      return;
    }

    // Mark departing IMMEDIATELY so:
    // 1) other taps never wait
    // 2) this cell is free for hit-testing other arrows' paths
    // 3) collision treats it as already cleared
    arrow.departing = true;

    const cells = result.path.slice();
    cells.push(result.exit);
    const anim = {
      type: 'slide',
      arrow: arrow,
      cells: cells,
      t0: performanceNow(),
      dur: Math.max(140, cells.length * 55),
    };
    const self = this;
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
    // Eager clear-check so UI can show progress; full clear waits for anims.
    // (kept playing until slides finish)
  };

  function performanceNow() {
    if (typeof performance !== 'undefined' && performance.now) return performance.now();
    return Date.now();
  }

  FrontPathGame.prototype._loop = function (ts) {
    if (!this._running) return;
    const dt = this._last ? Math.min(50, ts - this._last) : 16;
    this._last = ts;
    this._update(ts, dt);
    this._draw(ts);
    this._raf(this._loop);
  };

  FrontPathGame.prototype._update = function (ts) {
    if (!this.levelTimerFrozen && this.state === 'playing' && this.levelStartedAt) {
      this.levelElapsedMs = Math.max(0, ts - this.levelStartedAt);
    }
    // Copy list — onDone mutates this.anims
    const list = this.anims.slice();
    for (let i = 0; i < list.length; i++) {
      const anim = list[i];
      const t = (ts - anim.t0) / anim.dur;
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
  };

  FrontPathGame.prototype._draw = function (ts) {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, w, h);

    // Header
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Front Path', 20, 18);

    ctx.fillStyle = COLORS.muted;
    ctx.font = '14px system-ui, -apple-system, sans-serif';
    const lv = this.board;
    ctx.fillText('Level ' + lv.id + ' · ' + lv.name + ' / ' + LEVELS.length, 20, 48);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.accent;
    var leftCount = 0;
    for (var li = 0; li < lv.arrows.length; li++) if (!lv.arrows[li].departing) leftCount++;
    ctx.fillText(leftCount + ' left', w - 20, 48);

    // Level timer (mm:ss) — freezes on Clear
    ctx.textAlign = 'right';
    ctx.fillStyle = this.levelTimerFrozen ? COLORS.arrowOk : COLORS.text;
    ctx.font = 'bold 18px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(formatTime(this.levelElapsedMs), w - 20, 18);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillText(this.levelTimerFrozen ? 'cleared' : 'level time', w - 20, 38);

    // Board background
    const boardW = this.cell * lv.w;
    const boardH = this.cell * lv.h;
    roundRect(ctx, this.originX - 8, this.originY - 8, boardW + 16, boardH + 16, 12);
    ctx.fillStyle = COLORS.panel;
    ctx.fill();

    for (let y = 0; y < lv.h; y++) {
      for (let x = 0; x < lv.w; x++) {
        const cx = this.originX + x * this.cell;
        const cy = this.originY + y * this.cell;
        const pad = 3;
        roundRect(ctx, cx + pad, cy + pad, this.cell - pad * 2, this.cell - pad * 2, 8);
        ctx.fillStyle = COLORS.cell;
        ctx.fill();
      }
    }

    // Arrows
    for (let i = 0; i < lv.arrows.length; i++) {
      const a = lv.arrows[i];
      let drawX = a.x;
      let drawY = a.y;
      let alpha = 1;
      let shake = 0;

      let anim = null;
      for (let ai = 0; ai < this.anims.length; ai++) {
        if (this.anims[ai].arrow === a) {
          anim = this.anims[ai];
          break;
        }
      }
      if (anim) {
        if (anim.type === 'slide') {
          const t = Math.min(1, (ts - anim.t0) / anim.dur);
          const eased = easeIn(t);
          const positions = [{ x: a.x, y: a.y }].concat(anim.cells);
          const pIdx = eased * (positions.length - 1);
          const p0 = Math.floor(pIdx);
          const p1 = Math.min(p0 + 1, positions.length - 1);
          const pf = pIdx - p0;
          drawX = positions[p0].x + (positions[p1].x - positions[p0].x) * pf;
          drawY = positions[p0].y + (positions[p1].y - positions[p0].y) * pf;
          alpha = 1 - eased * 0.85;
        } else if (anim.type === 'shake') {
          const t = Math.min(1, (ts - anim.t0) / anim.dur);
          shake = Math.sin(t * Math.PI * 6) * (1 - t) * 4;
        }
      }

      let color = COLORS.arrow;
      if (this.flash && this.flash.arrow === a) color = COLORS.arrowBlocked;
      this._drawArrow(ctx, drawX, drawY, a.d, color, alpha, shake);
    }

    // Clear overlay
    if (this.state === 'clear') {
      ctx.fillStyle = 'rgba(15,20,25,0.55)';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = COLORS.arrowOk;
      ctx.font = 'bold 36px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Clear!', w / 2, h / 2 - 40);
      ctx.fillStyle = COLORS.text;
      ctx.font = 'bold 20px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillText(formatTime(this.levelElapsedMs), w / 2, h / 2 + 4);
      ctx.fillStyle = COLORS.muted;
      ctx.font = '13px system-ui, -apple-system, sans-serif';
      ctx.fillText('level time', w / 2, h / 2 + 28);
    }

    // Transient message
    if (this.message && ts < this.messageUntil && this.state === 'playing') {
      ctx.fillStyle = COLORS.arrowBlocked;
      ctx.font = 'bold 16px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.message, w / 2, this.originY - 18);
    }

    // Buttons
    this.buttons = [];
    const btnY = this.footerY;
    const btnH = 44;
    const gap = 12;
    const btnW = Math.min(110, (w - 40 - gap * 2) / 3);

    this._drawBtn(ctx, 20, btnY, btnW, btnH, 'Retry', 'retry');
    const midX = (w - btnW) / 2;
    if (this.levelIndex > 0) {
      this._drawBtn(ctx, midX, btnY, btnW, btnH, 'Prev', 'prev');
    }
    const nextLabel = this.state === 'clear' ? (this.levelIndex < LEVELS.length - 1 ? 'Next' : 'Again') : 'Next';
    const nextEnabled = this.state === 'clear' || this.levelIndex + 1 < this.maxUnlocked;
    this._drawBtn(ctx, w - 20 - btnW, btnY, btnW, btnH, nextLabel, 'next', !nextEnabled && this.state !== 'clear');
  };

  FrontPathGame.prototype._drawBtn = function (ctx, x, y, bw, bh, label, id, disabled) {
    this.buttons.push({ x: x, y: y, w: bw, h: bh, id: id });
    roundRect(ctx, x, y, bw, bh, 10);
    ctx.fillStyle = disabled ? '#1a2330' : COLORS.btn;
    ctx.fill();
    ctx.strokeStyle = disabled ? '#2a3545' : '#3d5270';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = disabled ? '#556678' : COLORS.text;
    ctx.font = 'bold 15px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + bw / 2, y + bh / 2);
  };

  FrontPathGame.prototype._drawArrow = function (ctx, gx, gy, dir, color, alpha, shake) {
    const cx = this.originX + (gx + 0.5) * this.cell + (shake || 0);
    const cy = this.originY + (gy + 0.5) * this.cell;
    const s = this.cell * 0.32;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.translate(cx, cy);
    const rot = { U: -Math.PI / 2, D: Math.PI / 2, L: Math.PI, R: 0 }[dir];
    ctx.rotate(rot);

    // soft shadow circle
    ctx.beginPath();
    ctx.arc(0, 0, this.cell * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, this.cell * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // chevron pointing right (after rotate)
    ctx.fillStyle = '#0a121c';
    ctx.beginPath();
    ctx.moveTo(s * 0.85, 0);
    ctx.lineTo(-s * 0.35, s * 0.75);
    ctx.lineTo(-s * 0.35, s * 0.28);
    ctx.lineTo(-s * 0.85, s * 0.28);
    ctx.lineTo(-s * 0.85, -s * 0.28);
    ctx.lineTo(-s * 0.35, -s * 0.28);
    ctx.lineTo(-s * 0.35, -s * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function easeIn(t) {
    return t * t;
  }

  function formatTime(ms) {
    ms = Math.max(0, Math.floor(ms || 0));
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  FrontPathGame.prototype.destroy = function () {
    this._running = false;
  };

  root.FrontPathGame = FrontPathGame;
  root.FrontPathLEVELS = LEVELS;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);

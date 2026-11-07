/**
 * Front Path — shared canvas path-puzzle engine.
 * Works in WeChat mini-game (wx) and browser (Canvas + localStorage).
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
    this.state = null; // playing | clear | anim
    this.board = null;
    this.cell = 0;
    this.originX = 0;
    this.originY = 0;
    this.anim = null;
    this.flash = null;
    this.buttons = [];
    this.message = '';
    this.messageUntil = 0;

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
    const pad = 20;
    const header = 88;
    const footer = 96;
    const availW = this.width - pad * 2;
    const availH = this.height - header - footer - pad;
    this.cell = Math.floor(Math.min(availW / this.board.w, availH / this.board.h));
    this.cell = Math.max(36, Math.min(this.cell, 72));
    const boardW = this.cell * this.board.w;
    const boardH = this.cell * this.board.h;
    this.originX = Math.floor((this.width - boardW) / 2);
    this.originY = Math.floor(header + (availH - boardH) / 2);
    this.headerY = 24;
    this.footerY = this.height - 72;
  };

  FrontPathGame.prototype.loadLevel = function (index) {
    index = Math.max(0, Math.min(index, LEVELS.length - 1));
    this.levelIndex = index;
    this.board = cloneLevel(LEVELS[index]);
    this.state = 'playing';
    this.anim = null;
    this.flash = null;
    this.message = '';
    this._layout();
  };

  FrontPathGame.prototype._bindInput = function () {
    const self = this;
    const onDown = function (x, y) {
      self._onTap(x, y);
    };

    if (typeof wx !== 'undefined' && wx.onTouchStart) {
      wx.onTouchStart(function (e) {
        const t = e.touches[0];
        onDown(t.clientX, t.clientY);
      });
      return;
    }

    const el = this.canvas;
    const handler = function (e) {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      let clientX, clientY;
      if (e.touches && e.touches[0]) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
      } else {
        clientX = e.clientX;
        clientY = e.clientY;
      }
      onDown(clientX - rect.left, clientY - rect.top);
    };
    el.addEventListener('mousedown', handler);
    el.addEventListener('touchstart', handler, { passive: false });
  };

  FrontPathGame.prototype._hitButton = function (x, y) {
    for (let i = 0; i < this.buttons.length; i++) {
      const b = this.buttons[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  };

  FrontPathGame.prototype._onTap = function (x, y) {
    if (this.anim) return;
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

    const gx = Math.floor((x - this.originX) / this.cell);
    const gy = Math.floor((y - this.originY) / this.cell);
    if (gx < 0 || gy < 0 || gx >= this.board.w || gy >= this.board.h) return;

    const arrow = this.board.arrows.find(function (a) {
      return a.x === gx && a.y === gy;
    });
    if (!arrow) return;
    this._trySlide(arrow);
  };

  FrontPathGame.prototype._occupied = function (x, y, skip) {
    for (let i = 0; i < this.board.arrows.length; i++) {
      const a = this.board.arrows[i];
      if (a === skip) continue;
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
    // Exit off the board — success; last step is just past the edge
    return { ok: true, path: path, exit: { x: x, y: y } };
  };

  FrontPathGame.prototype._trySlide = function (arrow) {
    const result = this._pathClear(arrow);
    if (!result.ok) {
      this.flash = { arrow: arrow, until: performanceNow() + 220, kind: 'blocked' };
      this.message = 'Blocked';
      this.messageUntil = performanceNow() + 600;
      // snap-back shake anim
      this.anim = {
        type: 'shake',
        arrow: arrow,
        t0: performanceNow(),
        dur: 220,
      };
      return;
    }

    // Animate sliding out
    const cells = result.path.slice();
    cells.push(result.exit);
    this.anim = {
      type: 'slide',
      arrow: arrow,
      cells: cells,
      t0: performanceNow(),
      dur: Math.max(180, cells.length * 70),
      onDone: null,
    };
    const self = this;
    this.anim.onDone = function () {
      self.board.arrows = self.board.arrows.filter(function (a) {
        return a !== arrow;
      });
      self.anim = null;
      if (self.board.arrows.length === 0) {
        self.state = 'clear';
        self.message = 'Clear!';
        self.messageUntil = performanceNow() + 2000;
        const unlocked = Math.max(self.maxUnlocked, self.levelIndex + 2);
        self.maxUnlocked = Math.min(unlocked, LEVELS.length);
        storageSet('front_path_max_unlocked', self.maxUnlocked);
      }
    };
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
    if (this.anim) {
      const t = (ts - this.anim.t0) / this.anim.dur;
      if (t >= 1) {
        if (this.anim.onDone) this.anim.onDone();
        else this.anim = null;
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
    ctx.fillText('Level ' + lv.id + ' · ' + lv.name, 20, 48);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.accent;
    ctx.fillText(lv.arrows.length + ' left', w - 20, 48);

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

      if (this.anim && this.anim.arrow === a) {
        if (this.anim.type === 'slide') {
          const t = Math.min(1, (ts - this.anim.t0) / this.anim.dur);
          const eased = easeIn(t);
          const idx = eased * this.anim.cells.length;
          const i0 = Math.min(Math.floor(idx), this.anim.cells.length - 1);
          const i1 = Math.min(i0 + 1, this.anim.cells.length - 1);
          const frac = idx - i0;
          const c0 = i0 === 0 && eased < 1 / this.anim.cells.length
            ? { x: a.x, y: a.y }
            : this.anim.cells[Math.max(0, i0 - 1)] || { x: a.x, y: a.y };
          // Better: interpolate from start through cells
          const positions = [{ x: a.x, y: a.y }].concat(this.anim.cells);
          const pIdx = eased * (positions.length - 1);
          const p0 = Math.floor(pIdx);
          const p1 = Math.min(p0 + 1, positions.length - 1);
          const pf = pIdx - p0;
          drawX = positions[p0].x + (positions[p1].x - positions[p0].x) * pf;
          drawY = positions[p0].y + (positions[p1].y - positions[p0].y) * pf;
          alpha = 1 - eased * 0.85;
        } else if (this.anim.type === 'shake') {
          const t = Math.min(1, (ts - this.anim.t0) / this.anim.dur);
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

  FrontPathGame.prototype.destroy = function () {
    this._running = false;
  };

  root.FrontPathGame = FrontPathGame;
  root.FrontPathLEVELS = LEVELS;
})(typeof GameGlobal !== 'undefined' ? GameGlobal : typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);

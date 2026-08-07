// AirPlay — Utility Functions, Coordinate Calibration & Algorithms (v2 Updated)

/**
 * Enhanced One-Euro Filter with Exponential Moving Average (EMA) Jitter Suppression
 */
class OneEuroFilter {
  constructor(minCutoff = 0.8, beta = 0.005, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;

    this.x = null;
    this.y = null;
    this.dx = 0;
    this.dy = 0;
    this.lastTime = null;

    // EMA smoothing buffer for stationary hover stabilization
    this.emaX = null;
    this.emaY = null;
    this.emaAlpha = 0.2;
  }

  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(point, timestamp = performance.now()) {
    if (this.lastTime === null) {
      this.x = point.x;
      this.y = point.y;
      this.emaX = point.x;
      this.emaY = point.y;
      this.lastTime = timestamp;
      return { x: this.x, y: this.y };
    }

    const dt = Math.max((timestamp - this.lastTime) / 1000.0, 0.001);
    this.lastTime = timestamp;

    const dxNew = (point.x - this.x) / dt;
    const dyNew = (point.y - this.y) / dt;

    const aDeriv = this.alpha(this.dCutoff, dt);
    this.dx = this.dx + aDeriv * (dxNew - this.dx);
    this.dy = this.dy + aDeriv * (dyNew - this.dy);

    const speed = Math.sqrt(this.dx * this.dx + this.dy * this.dy);
    const cutoff = this.minCutoff + this.beta * speed;
    const a = this.alpha(cutoff, dt);

    this.x = this.x + a * (point.x - this.x);
    this.y = this.y + a * (point.y - this.y);

    // Apply EMA smoothing during low speeds (<0.1) to eliminate stationary jitter
    if (speed < 0.1) {
      this.emaX = this.emaX + this.emaAlpha * (this.x - this.emaX);
      this.emaY = this.emaY + this.emaAlpha * (this.y - this.emaY);
      return { x: this.emaX, y: this.emaY };
    } else {
      this.emaX = this.x;
      this.emaY = this.y;
      return { x: this.x, y: this.y };
    }
  }

  reset() {
    this.x = null;
    this.y = null;
    this.emaX = null;
    this.emaY = null;
    this.lastTime = null;
  }
}

/**
 * Aspect-Ratio Corrected Coordinate Mapping Calibration
 * Solves vertical/horizontal tracking offset caused by object-fit: cover video scaling!
 */
function getAspectCorrectedCoords(normalizedPoint, videoEl, canvasEl) {
  if (!normalizedPoint || !canvasEl) return { x: 0, y: 0, normX: 0, normY: 0 };

  const canvasRect = canvasEl.getBoundingClientRect();
  const canvasWidth = canvasRect.width || canvasEl.width || window.innerWidth;
  const canvasHeight = canvasRect.height || canvasEl.height || window.innerHeight;

  // Game-space coordinates always span the FULL canvas (0-1 x, 0-1 y),
  // regardless of how the video tiles are visually arranged on screen
  // (side-by-side on desktop, stacked on mobile, etc). If we mapped the
  // fingertip only within the local video tile's on-screen rect, a player
  // could physically never reach the half of the shared play area drawn
  // over the OPPONENT's video tile. So we crop/aspect-correct against the
  // canvas itself, not the tile — the hand's full range of motion inside
  // its own camera frame now always covers the entire shared canvas.
  const videoWidth = (videoEl && videoEl.videoWidth) ? videoEl.videoWidth : 1280;
  const videoHeight = (videoEl && videoEl.videoHeight) ? videoEl.videoHeight : 720;

  const videoAspect = videoWidth / videoHeight;
  const canvasAspect = canvasWidth / canvasHeight;

  let renderWidth = canvasWidth;
  let renderHeight = canvasHeight;
  let cropOffsetX = 0;
  let cropOffsetY = 0;

  if (canvasAspect > videoAspect) {
    renderHeight = canvasWidth / videoAspect;
    cropOffsetY = (renderHeight - canvasHeight) / 2;
  } else {
    renderWidth = canvasHeight * videoAspect;
    cropOffsetX = (renderWidth - canvasWidth) / 2;
  }

  const px = normalizedPoint.x * renderWidth - cropOffsetX;
  const py = normalizedPoint.y * renderHeight - cropOffsetY;

  return {
    x: Math.max(0, Math.min(canvasWidth, px)),
    y: Math.max(0, Math.min(canvasHeight, py)),
    normX: Math.max(0, Math.min(1.0, px / canvasWidth)),
    normY: Math.max(0, Math.min(1.0, py / canvasHeight))
  };
}

/**
 * Draw Sharp Pin/Needle Cursor at Fingertip
 */
function drawNeedleCursor(ctx, x, y, color = '#ff0844') {
  // shadowBlur is a well-known Android Chrome canvas perf trap (it forces
  // a much slower rasterization path), and this cursor is redrawn every
  // single animation frame during gameplay (e.g. Balloon Duel). Skip the
  // blur on mobile and fall back to a plain filled glow ring instead —
  // visually close, without the per-frame cost.
  const mobile = window.isMobileDevice && window.isMobileDevice();

  ctx.save();
  ctx.translate(x, y);

  // Sharp Needle Shaft
  ctx.beginPath();
  ctx.moveTo(0, 0); // Needle Tip
  ctx.lineTo(-6, -24);
  ctx.lineTo(6, -24);
  ctx.closePath();
  ctx.fillStyle = '#e2e8f0';
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Needle Head Pin
  ctx.beginPath();
  ctx.arc(0, -28, 8, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  if (!mobile) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
  }
  ctx.fill();
  ctx.shadowBlur = 0;

  // Tip Sparkle Dot
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, 2 * Math.PI);
  ctx.fillStyle = '#ffffff';
  if (!mobile) {
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 10;
  }
  ctx.fill();

  ctx.restore();
}

/**
 * Particle Explosion Generator
 */
class ParticleSystem {
  constructor() {
    this.particles = [];
  }

  explode(x, y, color = '#00f2fe', count = 16) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * 2 * Math.PI + Math.random() * 0.5;
      const speed = 3 + Math.random() * 6;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 3 + Math.random() * 4,
        color,
        alpha: 1.0,
        life: 1.0
      });
    }
  }

  updateAndRender(ctx) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= 0.03;

      if (p.alpha <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, 2 * Math.PI);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();
    }
  }
}

/**
 * Lightweight mobile-device detector. Used to trim hand-tracking /
 * rendering costs (camera inference resolution, skeleton overlay, etc.)
 * on phones, where the same pipeline that runs fine on desktop can drag
 * FPS down significantly.
 */
function isMobileDevice() {
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  if (navigator.maxTouchPoints && navigator.maxTouchPoints > 1 && /Mac/i.test(ua)) return false; // iPad-as-Mac edge case, still fine to treat as desktop-class
  return window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
}
window.isMobileDevice = isMobileDevice;

/**
 * Cryptographically secure random room ID generator
 */
function generateRoomId() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const cryptoObj = window.crypto || window.msCrypto;
  const values = new Uint32Array(16);
  cryptoObj.getRandomValues(values);
  for (let i = 0; i < 16; i++) {
    result += chars[values[i] % chars.length];
  }
  return result;
}

function debounce(fn, delay = 400) {
  let timer = null;
  return function (...args) {
    if (timer) return;
    fn.apply(this, args);
    timer = setTimeout(() => { timer = null; }, delay);
  };
}

function getDistance(p1, p2) {
  if (!p1 || !p2) return Infinity;
  const dx = p1.x - p2.x;
  const dy = p1.y - p2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

class SoundEffects {
  constructor() { this.ctx = null; }
  init() { if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
  playPop() {
    try {
      this.init();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(400, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(900, this.ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(); osc.stop(this.ctx.currentTime + 0.08);
    } catch (e) {}
  }
  playHit() {
    try {
      this.init();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(70, this.ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.4, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(); osc.stop(this.ctx.currentTime + 0.1);
    } catch (e) {}
  }
  playWin() {
    try {
      this.init();
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + i * 0.1 + 0.2);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime + i * 0.1);
        osc.stop(this.ctx.currentTime + i * 0.1 + 0.2);
      });
    } catch (e) {}
  }
}

// --- Solo Mode Bot Difficulty ---------------------------------------------
// Shared by paddle.js and tug.js so the difficulty picker in solo.html can
// control how strong the bot opponent plays. 'hard' keeps the original
// (pre-existing) bot strength untouched.
window.AIRPLAY_DIFFICULTY = 'medium';

window.BOT_DIFFICULTY_PRESETS = {
  easy: {
    paddleMaxSpeed: 0.009,   // slower reaction, easy to score past
    paddleError: 0.30,       // wider aim mistakes
    tugIntervalMin: 900,
    tugIntervalMax: 1700,
    tugForceMin: 0.15,
    tugForceMax: 0.40
  },
  medium: {
    paddleMaxSpeed: 0.013,
    paddleError: 0.18,
    tugIntervalMin: 700,
    tugIntervalMax: 1300,
    tugForceMin: 0.28,
    tugForceMax: 0.60
  },
  hard: {
    paddleMaxSpeed: 0.018,   // original values — unchanged from before
    paddleError: 0.12,
    tugIntervalMin: 550,
    tugIntervalMax: 1050,
    tugForceMin: 0.35,
    tugForceMax: 0.90
  }
};

window.getBotDifficulty = function () {
  return window.BOT_DIFFICULTY_PRESETS[window.AIRPLAY_DIFFICULTY] || window.BOT_DIFFICULTY_PRESETS.medium;
};

window.SoundFx = new SoundEffects();
window.ParticleFx = new ParticleSystem();
window.OneEuroFilter = OneEuroFilter;
/**
 * Scale a canvas font size down proportionally on narrow (mobile) screens
 * so on-canvas text never overflows past the visible play area.
 */
function scaleFont(canvas, basePx) {
  const w = (canvas && canvas.width) || window.innerWidth;
  const scale = Math.max(0.55, Math.min(1, w / 900));
  return Math.round(basePx * scale);
}

/**
 * Word-wraps text to fit within maxWidth, drawing centered multi-line text
 * around (cx, cy) instead of letting a long string overflow off-canvas.
 * Returns the number of lines drawn.
 */
function wrapCanvasText(ctx, text, cx, cy, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && i > 0) {
      lines.push(line.trim());
      line = words[i] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line.trim());
  const startY = cy - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, startY + i * lineHeight));
  return lines.length;
}

/**
 * Same word-wrap logic as wrapCanvasText, but only counts how many lines
 * the text would take instead of drawing — used to size a box to its
 * text before the box itself is drawn.
 */
function measureWrappedLineCount(ctx, text, maxWidth) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const testLine = line + words[i] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && i > 0) {
      lines.push(line.trim());
      line = words[i] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line.trim());
  return lines.length;
}

window.scaleFont = scaleFont;
window.wrapCanvasText = wrapCanvasText;
window.measureWrappedLineCount = measureWrappedLineCount;
window.getAspectCorrectedCoords = getAspectCorrectedCoords;
window.drawNeedleCursor = drawNeedleCursor;
window.generateRoomId = generateRoomId;
window.debounce = debounce;
window.getDistance = getDistance;

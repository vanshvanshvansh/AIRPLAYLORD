// AirPlay Game 1 — Balloon Duel (Optimized Lightweight Renderer & Continuous Spawning)

class BalloonGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;
    this.canvas = null;

    this.balloons = [];
    this.popHoverTimes = {};
    this.popCooldowns = {};
    this.gameTimer = 45;
    this.isUnlimitedTimer = false;
    this.timerInterval = null;
    this.spawnCheckInterval = null;
    this.isRunning = false;

    this.maxPerPlayer = 6;
    this.sensitivity = 1.0; // shared by both players (not a per-color setting)
  }

  start(canvas, syncEngine, timerSetting = 45, extraSettings = null) {
    this.canvas = canvas;
    this.sync = syncEngine;
    this.balloons = [];
    this.popHoverTimes = {};
    this.popCooldowns = {};

    if (extraSettings && extraSettings.sensitivity) {
      this.sensitivity = parseFloat(extraSettings.sensitivity) || 1.0;
    }

    if (timerSetting === 'unlimited') {
      this.isUnlimitedTimer = true;
      this.gameTimer = 999;
    } else {
      this.isUnlimitedTimer = false;
      this.gameTimer = parseInt(timerSetting) || 45;
    }

    this.isRunning = true;

    if (this.sync) {
      if (this.sync.isHost) {
        this.generateHostSchedule();
      }
      this.sync.listen('game/balloons', (balloons) => {
        if (balloons) this.balloons = balloons;
      });
      this.sync.listen('game/popEvent', (event) => {
        if (event) this.handleRemotePop(event);
      });
    } else {
      this.spawnLocalBalloons(6);
    }

    this.startTimer();
    this.startContinuousSpawning();
  }

  randomSpawnPoint() {
    const leftBand = Math.random() < 0.5;
    const x = leftBand ? (0.08 + Math.random() * 0.22) : (0.70 + Math.random() * 0.22);
    const y = 0.18 + Math.random() * 0.64;
    return { x, y };
  }

  generateHostSchedule() {
    this.balloons = [];
    this.spawnPackFor('peerA', 5);
    this.spawnPackFor('peerB', 5);
    if (this.sync) this.sync.write('game/balloons', this.balloons);
  }

  spawnPackFor(owner, count) {
    for (let i = 0; i < count; i++) {
      const p = this.randomSpawnPoint();
      this.balloons.push({
        id: owner + '_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substring(2, 5),
        x: p.x,
        y: p.y,
        radius: 36 + Math.random() * 8,
        owner,
        popped: false
      });
    }
  }

  spawnLocalBalloons(count) {
    for (let i = 0; i < count; i++) {
      const p = this.randomSpawnPoint();
      this.balloons.push({
        id: 'solo_b_' + i + '_' + Math.random().toString(36).substring(2, 5),
        x: p.x,
        y: p.y,
        radius: 38,
        owner: 'peerA',
        popped: false
      });
    }
  }

  // Continuous Spawning Maintenance: check active unpopped balloons every 1.5s.
  // If count drops below 3 for a player, spawn a fresh trickle to keep count around 5-6.
  startContinuousSpawning() {
    if (this.spawnCheckInterval) clearInterval(this.spawnCheckInterval);
    this.spawnCheckInterval = setInterval(() => {
      if (!this.isRunning) return;
      if (this.sync && !this.sync.isHost) return; // Only host or solo manages spawning

      const roles = this.sync ? ['peerA', 'peerB'] : ['peerA'];
      let changed = false;

      roles.forEach((role) => {
        const activeCount = this.balloons.filter(b => b.owner === role && !b.popped).length;
        if (activeCount < 3) {
          const needed = Math.min(3, this.maxPerPlayer - activeCount);
          if (needed > 0) {
            this.spawnPackFor(role, needed);
            changed = true;
          }
        }
      });

      // Clean up old popped balloons to keep array lightweight
      if (this.balloons.length > 20) {
        this.balloons = this.balloons.filter(b => !b.popped);
        changed = true;
      }

      if (changed && this.sync && this.sync.isHost) {
        this.sync.write('game/balloons', this.balloons);
      }
    }, 1200);
  }

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.isUnlimitedTimer) {
      if (this.overlay.timerEl) this.overlay.timerEl.textContent = '∞ Unlimited';
      return;
    }

    this.timerInterval = setInterval(() => {
      if (this.gameTimer > 0) {
        this.gameTimer--;
        if (this.overlay.timerEl) this.overlay.timerEl.textContent = `${this.gameTimer}s`;
      } else {
        this.stop();
        this.overlay.endActiveGame(true);
      }
    }, 1000);
  }

  stop() {
    this.isRunning = false;
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.spawnCheckInterval) clearInterval(this.spawnCheckInterval);
  }

  render(ctx, width, height, localFingertip, peerFingertip) {
    const now = performance.now();

    if (localFingertip && this.isRunning) {
      const myRole = this.sync ? this.sync.peerRole : 'peerA';
      this.checkHoverPop(localFingertip, myRole, width, height, now);
    }

    // Lightweight 2D Glossy Balloon Renderer (No shadowBlur to eliminate lag!)
    for (let i = 0; i < this.balloons.length; i++) {
      const b = this.balloons[i];
      if (b.popped) continue;

      const bx = b.x * width;
      const by = b.y * height;
      const isPink = b.owner === 'peerA';
      const mainColor = isPink ? '#ff0844' : '#00f2fe';

      ctx.save();

      // Simple String
      ctx.beginPath();
      ctx.moveTo(bx, by + b.radius);
      ctx.lineTo(bx, by + b.radius + 28);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Balloon Knot
      ctx.beginPath();
      ctx.moveTo(bx - 4, by + b.radius + 1);
      ctx.lineTo(bx + 4, by + b.radius + 1);
      ctx.lineTo(bx, by + b.radius + 6);
      ctx.closePath();
      ctx.fillStyle = mainColor;
      ctx.fill();

      // Glossy Radial Gradient Fill (Fast, no shadowBlur)
      const grad = ctx.createRadialGradient(
        bx - b.radius * 0.3, by - b.radius * 0.3, b.radius * 0.1,
        bx, by, b.radius
      );
      if (isPink) {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.35, '#ff4e50');
        grad.addColorStop(1, '#c40030');
      } else {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.35, '#00f2fe');
        grad.addColorStop(1, '#0066cc');
      }

      ctx.beginPath();
      ctx.arc(bx, by, b.radius, 0, 2 * Math.PI);
      ctx.fillStyle = grad;
      ctx.fill();

      // Specular Shine
      ctx.beginPath();
      ctx.ellipse(bx - b.radius * 0.35, by - b.radius * 0.35, b.radius * 0.22, b.radius * 0.1, Math.PI / 4, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.fill();

      ctx.restore();

      // Hover Dwell Progress Ring
      const hoverStart = this.popHoverTimes[b.id];
      if (hoverStart) {
        const hoverProgress = Math.min((now - hoverStart) / 70, 1.0);
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, b.radius + 6, -Math.PI / 2, -Math.PI / 2 + hoverProgress * 2 * Math.PI);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.restore();
      }
    }

    // Render Needle Pin Cursor at local fingertip
    if (localFingertip) {
      drawNeedleCursor(ctx, localFingertip.px, localFingertip.py, this.sync && this.sync.peerRole === 'peerB' ? '#00f2fe' : '#ff0844');
    }
  }

  checkHoverPop(fingertip, myRole, width, height, now) {
    const fx = fingertip.px;
    const fy = fingertip.py;
    const touchBonus = 18 * Math.max(0.5, Math.min(4.0, this.sensitivity));

    for (let i = 0; i < this.balloons.length; i++) {
      const b = this.balloons[i];
      if (b.popped) continue;
      if (this.sync && b.owner !== myRole) continue;

      const bx = b.x * width;
      const by = b.y * height;
      const dx = fx - bx;
      const dy = fy - by;
      const distSq = dx * dx + dy * dy;
      const maxDist = b.radius + touchBonus;

      if (this.popCooldowns[b.id] && now - this.popCooldowns[b.id] < 120) continue;

      if (distSq <= maxDist * maxDist) {
        if (!this.popHoverTimes[b.id]) {
          this.popHoverTimes[b.id] = now;
        } else if (now - this.popHoverTimes[b.id] >= 70) {
          this.popBalloon(b, myRole, now, bx, by);
        }
      } else {
        delete this.popHoverTimes[b.id];
      }
    }
  }

  popBalloon(balloon, role, now, bx, by) {
    balloon.popped = true;
    this.popCooldowns[balloon.id] = now;
    delete this.popHoverTimes[balloon.id];

    if (window.SoundFx) window.SoundFx.playPop();

    // Lightweight score update
    this.overlay.updateScore(role, 1);

    if (this.sync) {
      this.sync.write('game/popEvent', { balloonId: balloon.id, role, bx, by });
      if (this.sync.isHost) {
        this.sync.write('game/balloons', this.balloons);
      }
    }
  }

  handleRemotePop(event) {
    const b = this.balloons.find(item => item.id === event.balloonId);
    if (b && !b.popped) {
      b.popped = true;
      if (window.SoundFx) window.SoundFx.playPop();
    }
  }
}

window.BalloonGame = BalloonGame;

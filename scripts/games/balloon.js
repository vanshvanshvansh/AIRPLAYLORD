// AirPlay Game 1 — Balloon Duel (v3 Continuous Trickle-Spawn Balloon Supply)

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
    this.isRunning = false;

    // --- Continuous balloon supply -------------------------------------
    // BUGFIX: balloons used to only come back once a whole 7-balloon pack
    // of ONE color was fully cleared, and — worse — solo mode only ever
    // created 'peerA' (red) balloons in the first place, so blue never
    // appeared there at all. Players also reported that in the 2-player
    // version, popping out all of one color mid-round just left that side
    // empty until the *entire* pack was gone, instead of balloons trickling
    // back in as the count got low.
    // New behavior, checked every MAINTAIN_INTERVAL_MS AND right after any
    // pop: if a color has ZERO left, refill it with a fresh full pack
    // immediately. If it still has a few (but is below the cap), add ONE
    // more every TRICKLE_INTERVAL_MS so the screen slowly tops back up
    // instead of sitting empty — but it stops adding once it reaches
    // MAX_PER_COLOR so the screen never gets overcrowded.
    this.MAX_PER_COLOR = 6;
    this.TRICKLE_INTERVAL_MS = 1400;
    this.maintainInterval = null;
    this._lastTrickle = { peerA: 0, peerB: 0 };
  }

  start(canvas, syncEngine, timerSetting = 45) {
    this.canvas = canvas;
    this.sync = syncEngine;
    this.balloons = [];
    this.popHoverTimes = {};
    this.popCooldowns = {};
    this._lastTrickle = { peerA: 0, peerB: 0 };

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
      // Solo mode: spawn BOTH colors up front (previously only red ever
      // spawned here, so blue balloons never showed up in solo practice).
      this.spawnPackFor('peerA', this.MAX_PER_COLOR);
      this.spawnPackFor('peerB', this.MAX_PER_COLOR);
    }

    // Runs continuously for the authoritative side (host, or solo with no
    // sync at all) so the supply keeps topping itself up all round long,
    // not just in reaction to a pop.
    if (this.maintainInterval) clearInterval(this.maintainInterval);
    this.maintainInterval = setInterval(() => {
      if (this.isRunning) this.maintainBalloons(performance.now());
    }, 500);

    this.startTimer();
  }

  // Balloons spawn only in a band down the sides of the screen, never in the
  // central column where a player's own face/webcam view sits, so a pack
  // never covers your face while you're trying to look at your hand.
  randomSpawnPoint() {
    const leftBand = Math.random() < 0.5;
    const x = leftBand ? (0.08 + Math.random() * 0.22) : (0.70 + Math.random() * 0.22);
    const y = 0.18 + Math.random() * 0.64;
    return { x, y };
  }

  generateHostSchedule() {
    this.balloons = [];
    this.spawnPackFor('peerA', this.MAX_PER_COLOR);
    this.spawnPackFor('peerB', this.MAX_PER_COLOR);
    if (this.sync) this.sync.write('game/balloons', this.balloons);
  }

  spawnPackFor(owner, count) {
    for (let i = 0; i < count; i++) {
      const p = this.randomSpawnPoint();
      this.balloons.push({
        id: owner + '_' + Date.now() + '_' + i + '_' + Math.random().toString(36).substring(2, 5),
        x: p.x,
        y: p.y,
        radius: 38 + Math.random() * 12,
        owner,
        popped: false
      });
    }
  }

  // Keeps each color's on-screen supply healthy without ever overfilling
  // the screen. Only the authoritative side calls this (host in synced
  // play, or the local instance in solo play — guests just receive the
  // resulting list over 'game/balloons').
  maintainBalloons(now) {
    if (this.sync && !this.sync.isHost) return;

    // Drop already-popped entries so this array doesn't grow forever over
    // a long/unlimited-timer round.
    this.balloons = this.balloons.filter(b => !b.popped);

    let changed = false;
    ['peerA', 'peerB'].forEach((role) => {
      const activeCount = this.balloons.filter(b => b.owner === role).length;

      if (activeCount === 0) {
        // Fully cleared — bring a whole fresh pack back right away.
        this.spawnPackFor(role, this.MAX_PER_COLOR);
        this._lastTrickle[role] = now;
        changed = true;
      } else if (activeCount < this.MAX_PER_COLOR) {
        // A few left — trickle in one more every TRICKLE_INTERVAL_MS
        // instead of dumping a full pack, so the screen never floods.
        if (now - (this._lastTrickle[role] || 0) >= this.TRICKLE_INTERVAL_MS) {
          this.spawnPackFor(role, 1);
          this._lastTrickle[role] = now;
          changed = true;
        }
      }
      // else: already at the cap, do nothing this tick.
    });

    if (changed && this.sync) {
      this.sync.write('game/balloons', this.balloons);
    }
  }

  spawnLocalBalloons(count) {
    // Kept for backward compatibility; start() now calls spawnPackFor
    // directly for both colors in solo mode.
    for (let i = 0; i < count; i++) {
      const p = this.randomSpawnPoint();
      this.balloons.push({
        id: 'solo_b_' + i + '_' + Math.random().toString(36).substring(2, 5),
        x: p.x,
        y: p.y,
        radius: 40,
        owner: 'peerA',
        popped: false
      });
    }
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
    if (this.maintainInterval) {
      clearInterval(this.maintainInterval);
      this.maintainInterval = null;
    }
  }

  render(ctx, width, height, localFingertip, peerFingertip) {
    const now = performance.now();

    if (localFingertip && this.isRunning) {
      const myRole = this.sync ? this.sync.peerRole : 'peerA';
      this.checkHoverPop(localFingertip, myRole, width, height, now);
    }

    // Render 3D Glossy Balloons
    this.balloons.forEach((b) => {
      if (b.popped) return;

      const bx = b.x * width;
      const by = b.y * height;
      const isPink = b.owner === 'peerA';
      const mainColor = isPink ? '#ff0844' : '#00f2fe';

      ctx.save();

      // Hanging String
      ctx.beginPath();
      ctx.moveTo(bx, by + b.radius);
      ctx.quadraticCurveTo(bx + 10, by + b.radius + 20, bx - 5, by + b.radius + 40);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // Balloon Knot
      ctx.beginPath();
      ctx.moveTo(bx - 6, by + b.radius + 2);
      ctx.lineTo(bx + 6, by + b.radius + 2);
      ctx.lineTo(bx, by + b.radius + 8);
      ctx.closePath();
      ctx.fillStyle = mainColor;
      ctx.fill();

      // 3D Glossy Sphere Fill
      const grad = ctx.createRadialGradient(
        bx - b.radius * 0.35, by - b.radius * 0.35, b.radius * 0.1,
        bx, by, b.radius
      );
      if (isPink) {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, '#ff4e50');
        grad.addColorStop(0.85, '#ff0844');
        grad.addColorStop(1, '#8b0024');
      } else {
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.3, '#4facfe');
        grad.addColorStop(0.85, '#00f2fe');
        grad.addColorStop(1, '#0072ff');
      }

      ctx.beginPath();
      ctx.arc(bx, by, b.radius, 0, 2 * Math.PI);
      ctx.fillStyle = grad;
      ctx.shadowColor = mainColor;
      ctx.shadowBlur = 20;
      ctx.fill();

      // Curved Specular Highlight Shine
      ctx.beginPath();
      ctx.ellipse(bx - b.radius * 0.4, by - b.radius * 0.4, b.radius * 0.25, b.radius * 0.12, Math.PI / 4, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fill();

      ctx.restore();

      // Hover Dwell Progress Ring
      const hoverStart = this.popHoverTimes[b.id];
      if (hoverStart) {
        const hoverProgress = Math.min((now - hoverStart) / 100, 1.0);
        ctx.save();
        ctx.beginPath();
        ctx.arc(bx, by, b.radius + 8, -Math.PI / 2, -Math.PI / 2 + hoverProgress * 2 * Math.PI);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
      }
    });

    // Render Needle Pin Cursor at local fingertip
    if (localFingertip) {
      drawNeedleCursor(ctx, localFingertip.px, localFingertip.py, this.sync && this.sync.peerRole === 'peerB' ? '#00f2fe' : '#ff0844');
    }
  }

  checkHoverPop(fingertip, myRole, width, height, now) {
    const fx = fingertip.px;
    const fy = fingertip.py;

    this.balloons.forEach((b) => {
      if (b.popped) return;
      if (this.sync && b.owner !== myRole) return;

      const bx = b.x * width;
      const by = b.y * height;
      const dist = Math.sqrt((fx - bx) ** 2 + (fy - by) ** 2);

      if (this.popCooldowns[b.id] && now - this.popCooldowns[b.id] < 150) return;

      if (dist <= b.radius + 10) { // Pin tip touches balloon
        if (!this.popHoverTimes[b.id]) {
          this.popHoverTimes[b.id] = now;
        } else if (now - this.popHoverTimes[b.id] >= 80) { // 80ms pin pop!
          this.popBalloon(b, myRole, now, bx, by);
        }
      } else {
        delete this.popHoverTimes[b.id];
      }
    });
  }

  popBalloon(balloon, role, now, bx, by) {
    balloon.popped = true;
    this.popCooldowns[balloon.id] = now;
    delete this.popHoverTimes[balloon.id];

    if (window.SoundFx) window.SoundFx.playPop();
    if (window.ParticleFx) window.ParticleFx.explode(bx, by, role === 'peerA' ? '#ff0844' : '#00f2fe', 20);

    this.overlay.updateScore(role, 1);

    if (this.sync) {
      this.sync.write('game/popEvent', { balloonId: balloon.id, role, bx, by });
    }

    // Only the authoritative side (host, or solo with no sync) restocks —
    // this runs the same trickle-or-refill logic as the periodic tick, so
    // popping the last balloon of a color brings that color right back
    // instead of waiting on the next 500ms check.
    if (!this.sync || this.sync.isHost) {
      this.maintainBalloons(now);
    }
  }

  handleRemotePop(event) {
    const b = this.balloons.find(item => item.id === event.balloonId);
    if (b && !b.popped) {
      b.popped = true;
      if (window.SoundFx) window.SoundFx.playPop();
      if (window.ParticleFx) window.ParticleFx.explode(event.bx, event.by, event.role === 'peerA' ? '#ff0844' : '#00f2fe', 20);
    }
  }
}

window.BalloonGame = BalloonGame;

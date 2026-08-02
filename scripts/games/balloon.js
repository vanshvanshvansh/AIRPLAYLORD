// AirPlay Game 1 — Balloon Duel (v2 3D Balloon Visuals & Needle Indicator)

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
  }

  start(canvas, syncEngine, timerSetting = 45) {
    this.canvas = canvas;
    this.sync = syncEngine;
    this.balloons = [];
    this.popHoverTimes = {};
    this.popCooldowns = {};

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
      this.spawnLocalBalloons(12);
    }

    this.startTimer();
  }

  generateHostSchedule() {
    const newBalloons = [];
    for (let i = 0; i < 14; i++) {
      newBalloons.push({
        id: 'b_' + i + '_' + Math.random().toString(36).substring(2, 7),
        x: 0.15 + Math.random() * 0.7,
        y: 0.2 + Math.random() * 0.6,
        radius: 38 + Math.random() * 12,
        owner: i % 2 === 0 ? 'peerA' : 'peerB', // Player 1 Pink, Player 2 Cyan
        popped: false
      });
    }
    this.balloons = newBalloons;
    if (this.sync) this.sync.write('game/balloons', this.balloons);
  }

  spawnLocalBalloons(count) {
    for (let i = 0; i < count; i++) {
      this.balloons.push({
        id: 'solo_b_' + i,
        x: 0.15 + Math.random() * 0.7,
        y: 0.2 + Math.random() * 0.6,
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
      if (this.sync.isHost) {
        this.sync.write('game/balloons', this.balloons);
      }
    }

    if (this.balloons.every(b => b.popped)) {
      if (!this.sync || this.sync.isHost) {
        this.generateHostSchedule();
      }
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

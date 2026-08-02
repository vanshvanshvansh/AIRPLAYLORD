// AirPlay Game 2 — Air Hockey Duel

class HockeyGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    this.puck = { x: 0.5, y: 0.5, vx: 0.005, vy: 0.003, radius: 25 };
    this.targetPuck = { x: 0.5, y: 0.5 };
    this.paddleA = { x: 0.5, y: 0.85 };
    this.paddleB = { x: 0.5, y: 0.15 };

    this.lastSyncTime = 0;
    this.isRunning = false;
  }

  start(canvas, syncEngine) {
    this.sync = syncEngine;
    this.puck = { x: 0.5, y: 0.5, vx: 0.004, vy: 0.005, radius: 25 };
    this.targetPuck = { x: 0.5, y: 0.5 };
    this.isRunning = true;

    if (this.sync) {
      if (this.sync.isHost) {
        this.startPhysicsLoop();
      }
      this.sync.listen('game/puck', (data) => {
        if (data && !this.sync.isHost) {
          this.targetPuck = { x: data.x, y: data.y };
          this.puck.vx = data.vx;
          this.puck.vy = data.vy;
        }
      });
      this.sync.listen('game/paddleInput', (data) => {
        if (data) {
          if (data.role === 'peerA') this.paddleA = data.pos;
          if (data.role === 'peerB') this.paddleB = data.pos;
        }
      });
    }
  }

  startPhysicsLoop() {
    this.physicsInterval = setInterval(() => {
      if (!this.isRunning) return;
      this.updatePhysics();
      if (this.sync) {
        this.sync.write('game/puck', {
          x: this.puck.x,
          y: this.puck.y,
          vx: this.puck.vx,
          vy: this.puck.vy
        });
      }
    }, 150); // Host updates physics every ~150ms
  }

  updatePhysics() {
    this.puck.x += this.puck.vx;
    this.puck.y += this.puck.vy;

    // Bounce off side walls (x: 0.05 to 0.95)
    if (this.puck.x <= 0.05 || this.puck.x >= 0.95) {
      this.puck.vx *= -1;
      this.puck.x = Math.max(0.05, Math.min(0.95, this.puck.x));
      if (window.SoundFx) window.SoundFx.playHit();
    }

    // Goal checks (y: 0 and y: 1)
    if (this.puck.y <= 0.02) {
      // PeerA (Bottom) scores!
      this.overlay.updateScore('peerA', 1);
      this.resetPuck();
      if (window.SoundFx) window.SoundFx.playWin();
    } else if (this.puck.y >= 0.98) {
      // PeerB (Top) scores!
      this.overlay.updateScore('peerB', 1);
      this.resetPuck();
      if (window.SoundFx) window.SoundFx.playWin();
    }

    // Paddle Collisions
    this.checkPaddleCollision(this.paddleA, 1);
    this.checkPaddleCollision(this.paddleB, -1);
  }

  checkPaddleCollision(paddle, direction) {
    const dist = Math.sqrt((this.puck.x - paddle.x) ** 2 + (this.puck.y - paddle.y) ** 2);
    if (dist < 0.08) {
      this.puck.vy = direction * (0.005 + Math.random() * 0.003);
      this.puck.vx = (this.puck.x - paddle.x) * 0.1;
      if (window.SoundFx) window.SoundFx.playHit();
    }
  }

  resetPuck() {
    this.puck.x = 0.5;
    this.puck.y = 0.5;
    this.puck.vx = (Math.random() - 0.5) * 0.008;
    this.puck.vy = Math.random() > 0.5 ? 0.005 : -0.005;
  }

  stop() {
    this.isRunning = false;
    if (this.physicsInterval) clearInterval(this.physicsInterval);
  }

  render(ctx, width, height, localFingertip, peerFingertip) {
    if (!this.isRunning) return;

    const myRole = this.sync ? this.sync.peerRole : 'peerA';

    // Update local paddle from local fingertip
    if (localFingertip) {
      const myPaddle = myRole === 'peerA' ? this.paddleA : this.paddleB;
      myPaddle.x = localFingertip.x;
      myPaddle.y = myRole === 'peerA' ? Math.max(0.5, localFingertip.y) : Math.min(0.5, localFingertip.y);

      if (this.sync) {
        this.sync.write('game/paddleInput', { role: myRole, pos: myPaddle });
      }
    }

    // Client-side interpolation for non-host puck rendering
    if (this.sync && !this.sync.isHost) {
      this.puck.x = SyncEngine.lerp(this.puck.x, this.targetPuck.x, 0.25);
      this.puck.y = SyncEngine.lerp(this.puck.y, this.targetPuck.y, 0.25);
    } else {
      this.updatePhysics();
    }

    // Render Rink Divider
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Draw Center Circle
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 70, 0, 2 * Math.PI);
    ctx.stroke();

    // Render Goal Lines
    ctx.strokeStyle = '#ff0844';
    ctx.strokeRect(width * 0.3, 0, width * 0.4, 10);
    ctx.strokeStyle = '#00f2fe';
    ctx.strokeRect(width * 0.3, height - 10, width * 0.4, 10);

    // Render Paddles
    this.drawPaddle(ctx, this.paddleA.x * width, this.paddleA.y * height, '#ff0844');
    this.drawPaddle(ctx, this.paddleB.x * width, this.paddleB.y * height, '#00f2fe');

    // Render Puck with glowing trail
    const px = this.puck.x * width;
    const py = this.puck.y * height;

    ctx.beginPath();
    ctx.arc(px, py, this.puck.radius, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 25;
    ctx.fill();

    ctx.restore();
  }

  drawPaddle(ctx, x, y, color) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 35, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.restore();
  }
}

window.HockeyGame = HockeyGame;

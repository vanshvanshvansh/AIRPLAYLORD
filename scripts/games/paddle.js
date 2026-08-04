// AirPlay Game 2 — Low-Effort Paddle Duel (Breakout/Pong Style with Settings & Goal Flash)

class PaddleGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    this.baseSpeedMult = 1.0;
    this.ball = { x: 0.5, y: 0.5, vx: 0.0125, vy: 0.018, radius: 16 };
    this.targetBall = { x: 0.5, y: 0.5 };

    this.paddleA = { x: 0.5, width: 0.2, y: 0.88 }; // Bottom paddle (Player 1 Pink)
    this.paddleB = { x: 0.5, width: 0.2, y: 0.17 }; // Top paddle (Player 2 Cyan)

    this.targetPaddleA = 0.5;
    this.targetPaddleB = 0.5;
    this._lastPaddleSend = 0;
    this._lastPhysicsTime = null;

    this.paddleReach = 0.045;
    this.maxSpeed = 0.036;

    this.gameTimer = 90;
    this.isUnlimitedTimer = false;
    this.timerInterval = null;
    this.isRunning = false;

    this.goalFlash = null; // { role: 'peerA'|'peerB', startTime }
    this.botError = 0;
  }

  start(canvas, syncEngine, timerSetting = 90, extraSettings = null) {
    this.sync = syncEngine;

    // Apply Ball Speed multiplier from pre-game settings
    let speedMult = 1.0;
    if (extraSettings && extraSettings.ballSpeed) {
      if (extraSettings.ballSpeed === 'slow') speedMult = 0.7;
      else if (extraSettings.ballSpeed === 'fast') speedMult = 1.4;
    }
    this.baseSpeedMult = speedMult;

    // Apply Hand Sensitivity setting to paddle widths
    let sensP1 = (extraSettings && extraSettings.sensP1) ? extraSettings.sensP1 : 1.0;
    let sensP2 = (extraSettings && extraSettings.sensP2) ? extraSettings.sensP2 : 1.0;

    this.paddleA.width = 0.2 * sensP1;
    this.paddleB.width = 0.2 * sensP2;

    const baseVy = 0.018 * speedMult;
    const baseVx = 0.0125 * speedMult;
    this.ball = { x: 0.5, y: 0.5, vx: baseVx, vy: baseVy, radius: 16 };
    this.targetBall = { x: 0.5, y: 0.5 };
    this.targetPaddleA = this.paddleA.x;
    this.targetPaddleB = this.paddleB.x;
    this._lastPaddleSend = 0;
    this._lastPhysicsTime = null;
    this.goalFlash = null;
    this.isRunning = true;

    if (timerSetting === 'unlimited') {
      this.isUnlimitedTimer = true;
      this.gameTimer = 999;
    } else {
      this.isUnlimitedTimer = false;
      this.gameTimer = parseInt(timerSetting) || 90;
    }

    if (this.sync) {
      if (this.sync.isHost) {
        this.startPhysicsLoop();
      }
      this.sync.listen('game/paddleBall', (data) => {
        if (data && !this.sync.isHost) {
          this.targetBall = { x: data.x, y: data.y };
          this.ball.vx = data.vx;
          this.ball.vy = data.vy;
        }
      });
      this.sync.listen('game/paddleInput', (data) => {
        if (data) {
          if (data.role === 'peerA') this.targetPaddleA = data.x;
          if (data.role === 'peerB') this.targetPaddleB = data.x;
        }
      });
      this.sync.listen('game/paddleGoal', (data) => {
        if (data && data.role) {
          this.triggerGoalFlash(data.role);
        }
      });
    }

    this.startTimer();
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

  startPhysicsLoop() {
    this.physicsInterval = setInterval(() => {
      if (!this.isRunning || !this.sync) return;
      this.sync.write('game/paddleBall', {
        x: this.ball.x,
        y: this.ball.y,
        vx: this.ball.vx,
        vy: this.ball.vy
      });
    }, 50);
  }

  triggerGoalFlash(scoringRole) {
    this.goalFlash = { role: scoringRole, startTime: performance.now() };
  }

  updatePhysics() {
    const now = performance.now();
    const dt = this._lastPhysicsTime ? (now - this._lastPhysicsTime) : 16.67;
    this._lastPhysicsTime = now;
    const scale = Math.min(Math.max(dt / 16.67, 0.2), 3);

    this.ball.x += this.ball.vx * scale;
    this.ball.y += this.ball.vy * scale;

    // Bounce off side walls (x: 0.03 to 0.97)
    if (this.ball.x <= 0.03 || this.ball.x >= 0.97) {
      this.ball.vx *= -1;
      this.ball.x = Math.max(0.03, Math.min(0.97, this.ball.x));
      if (window.SoundFx) window.SoundFx.playHit();
    }

    // Paddle A Collision (Bottom)
    if (this.ball.vy > 0 && this.ball.y >= this.paddleA.y - this.paddleReach && this.ball.y <= this.paddleA.y + 0.01) {
      if (Math.abs(this.ball.x - this.paddleA.x) <= this.paddleA.width / 2 + 0.02) {
        this.ball.vy = -Math.min(Math.abs(this.ball.vy) * 1.06, this.maxSpeed * this.baseSpeedMult);
        this.ball.vx = (this.ball.x - this.paddleA.x) * 0.05 * this.baseSpeedMult;
        this.ball.y = this.paddleA.y - this.paddleReach;
        if (window.SoundFx) window.SoundFx.playHit();
      }
    }

    // Paddle B Collision (Top)
    if (this.ball.vy < 0 && this.ball.y <= this.paddleB.y + this.paddleReach && this.ball.y >= this.paddleB.y - 0.01) {
      if (Math.abs(this.ball.x - this.paddleB.x) <= this.paddleB.width / 2 + 0.02) {
        this.ball.vy = Math.min(Math.abs(this.ball.vy) * 1.06, this.maxSpeed * this.baseSpeedMult);
        this.ball.vx = (this.ball.x - this.paddleB.x) * 0.05 * this.baseSpeedMult;
        this.ball.y = this.paddleB.y + this.paddleReach;
        if (window.SoundFx) window.SoundFx.playHit();
      }
    }

    // Goal scored
    if (this.ball.y >= 0.99) { // Peer B scores (top player)
      this.overlay.updateScore('peerB', 1);
      this.triggerGoalFlash('peerB');
      if (this.sync) this.sync.write('game/paddleGoal', { role: 'peerB' });
      if (window.SoundFx) window.SoundFx.playWin();
      this.resetBall(-0.010 * this.baseSpeedMult);
    } else if (this.ball.y <= 0.01) { // Peer A scores (bottom player)
      this.overlay.updateScore('peerA', 1);
      this.triggerGoalFlash('peerA');
      if (this.sync) this.sync.write('game/paddleGoal', { role: 'peerA' });
      if (window.SoundFx) window.SoundFx.playWin();
      this.resetBall(0.010 * this.baseSpeedMult);
    }
  }

  resetBall(initialVy) {
    this.ball.x = 0.5;
    this.ball.y = 0.5;
    this.ball.vx = (Math.random() - 0.5) * 0.006 * this.baseSpeedMult;
    this.ball.vy = initialVy;
    const diff = window.getBotDifficulty ? window.getBotDifficulty() : { paddleError: 0.12 };
    this.botError = (Math.random() - 0.5) * diff.paddleError;
  }

  updateBotPaddle() {
    const diff = window.getBotDifficulty ? window.getBotDifficulty() : { paddleMaxSpeed: 0.018, paddleError: 0.12 };

    const now = performance.now();
    if (!this._nextErrorRoll || now >= this._nextErrorRoll) {
      this.botError = (Math.random() - 0.5) * diff.paddleError;
      this._nextErrorRoll = now + 500 + Math.random() * 400;
    }
    if (Math.random() < 0.06) return;

    const targetX = Math.max(0.08, Math.min(0.92, this.ball.x + this.botError));
    const maxSpeed = diff.paddleMaxSpeed;
    const dx = targetX - this.paddleB.x;
    this.paddleB.x += Math.max(-maxSpeed, Math.min(maxSpeed, dx));
  }

  stop() {
    this.isRunning = false;
    if (this.physicsInterval) clearInterval(this.physicsInterval);
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  render(ctx, width, height, localFingertip, peerFingertip) {
    if (!this.isRunning) return;

    const myRole = this.sync ? this.sync.peerRole : 'peerA';

    if (localFingertip) {
      const myPaddle = myRole === 'peerA' ? this.paddleA : this.paddleB;
      myPaddle.x = localFingertip.x;

      if (this.sync) {
        const now = performance.now();
        if (now - this._lastPaddleSend >= 50) {
          this._lastPaddleSend = now;
          this.sync.write('game/paddleInput', { role: myRole, x: myPaddle.x });
        }
      }
    }

    if (this.sync) {
      if (myRole === 'peerA') {
        this.paddleB.x = SyncEngine.lerp(this.paddleB.x, this.targetPaddleB, 0.35);
      } else {
        this.paddleA.x = SyncEngine.lerp(this.paddleA.x, this.targetPaddleA, 0.35);
      }
    }

    if (this.sync && !this.sync.isHost) {
      this.ball.x = SyncEngine.lerp(this.ball.x, this.targetBall.x, 0.3);
      this.ball.y = SyncEngine.lerp(this.ball.y, this.targetBall.y, 0.3);
    } else {
      if (!this.sync) this.updateBotPaddle();
      this.updatePhysics();
    }

    ctx.save();

    // Render Soft Border Goal Glow (Item #9 Fix)
    if (this.goalFlash) {
      const elapsed = performance.now() - this.goalFlash.startTime;
      if (elapsed < 500) {
        const progress = elapsed / 500;
        const alpha = 0.5 * (1 - progress);
        const color = this.goalFlash.role === 'peerA' ? `rgba(255, 8, 68, ${alpha})` : `rgba(0, 242, 254, ${alpha})`;
        
        ctx.save();
        ctx.fillStyle = color;
        if (this.goalFlash.role === 'peerA') {
          // Bottom border glow (Player 1 scored / bottom side)
          ctx.fillRect(0, height - 24, width, 24);
        } else {
          // Top border glow (Player 2 scored / top side)
          ctx.fillRect(0, 0, width, 24);
        }
        ctx.restore();
      } else {
        this.goalFlash = null;
      }
    }

    // Render Middle Net Line
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 12]);
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Render Paddles
    this.drawPaddle(ctx, this.paddleA.x * width, this.paddleA.y * height, this.paddleA.width * width, '#ff0844');
    this.drawPaddle(ctx, this.paddleB.x * width, this.paddleB.y * height, this.paddleB.width * width, '#00f2fe');

    // Render Bouncing Ball
    const bx = this.ball.x * width;
    const by = this.ball.y * height;

    ctx.beginPath();
    ctx.arc(bx, by, this.ball.radius, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
  }

  drawPaddle(ctx, x, y, pWidth, color) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x - pWidth / 2, y - 10, pWidth, 20, 10);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }
}

window.PaddleGame = PaddleGame;

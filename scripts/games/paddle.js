// AirPlay Game 2 — Low-Effort Paddle Duel (Breakout/Pong Style)

class PaddleGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    // Base speeds bumped ~1.8x and physics is now delta-time scaled (see
    // updatePhysics) instead of a fixed "per rendered frame" step — on a
    // phone where MediaPipe hand-tracking competes for CPU time and the
    // render loop occasionally drops below 60fps, the OLD fixed-per-frame
    // step meant the ball advanced less every second in real wall-clock
    // time (fewer frames = fewer steps = a genuinely slower-looking ball).
    // Scaling by real elapsed time keeps speed consistent no matter the fps.
    this.ball = { x: 0.5, y: 0.5, vx: 0.0125, vy: 0.018, radius: 16 };
    this.targetBall = { x: 0.5, y: 0.5 };

    this.paddleA = { x: 0.5, width: 0.2, y: 0.88 }; // Bottom paddle (Player 1 Pink)
    this.paddleB = { x: 0.5, width: 0.2, y: 0.17 }; // Top paddle (Player 2 Cyan) — pushed below the scoreboard HUD

    // Latest x reported by the network for whichever paddle is NOT under our
    // local control. We lerp toward this every frame instead of snapping to
    // it directly, so the remote paddle glides instead of jumping/lagging
    // behind on the other player's screen.
    this.targetPaddleA = 0.5;
    this.targetPaddleB = 0.5;
    this._lastPaddleSend = 0; // throttle gate for outgoing paddleInput writes
    this._lastPhysicsTime = null; // wall-clock timestamp of the last updatePhysics() call

    // How far the ball can reach in front of a paddle before it's considered
    // a hit, and the hard speed cap so hits-in-a-row don't spiral out of control.
    this.paddleReach = 0.045;
    this.maxSpeed = 0.036;

    this.gameTimer = 90;
    this.isUnlimitedTimer = false;
    this.timerInterval = null;
    this.isRunning = false;

    // Solo-mode Bot AI (only active when there is no syncEngine, i.e. Solo
    // Practice Mode). Controls paddleB (top) so the player always has an
    // opponent to play against instead of a static wall.
    this.botError = 0; // per-rally aim imprecision, re-rolled on reset
  }

  start(canvas, syncEngine, timerSetting = 90) {
    this.sync = syncEngine;
    this.ball = { x: 0.5, y: 0.5, vx: 0.0125, vy: 0.018, radius: 16 };
    this.targetBall = { x: 0.5, y: 0.5 };
    this.targetPaddleA = this.paddleA.x;
    this.targetPaddleB = this.paddleB.x;
    this._lastPaddleSend = 0;
    this._lastPhysicsTime = null;
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

  // Host only: broadcasts the current ball state to the peer every 50ms.
  // The actual simulation runs once per animation frame inside render() —
  // this interval used to ALSO call updatePhysics(), which meant the host's
  // ball was being advanced twice (once here, once in render()) every cycle.
  // That silently doubled the ball's effective speed on the host and made it
  // easy for the ball to skip clean over/through the paddle's contact zone
  // in a single tick, which is what caused hits to register only after the
  // ball had already passed behind the paddle.
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

  updatePhysics() {
    // Delta-time scaling: normalize movement to a 60fps baseline (16.67ms
    // per frame) using REAL elapsed wall-clock time instead of a fixed step
    // per call. Without this, if the render loop drops to e.g. 20fps on a
    // loaded phone, the ball only got 20 position updates that second
    // instead of 60 — i.e. it visibly crawled — even though each individual
    // step size was "correct". Clamped to 3x so a tab going to the
    // background and coming back doesn't fire off one giant teleporting step.
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

    // Paddle A Collision (Bottom) — the ball travels down TOWARD this paddle,
    // so the contact zone sits just ABOVE the paddle line (the face it's
    // approaching), not below it. Checking below the line meant the ball had
    // already sailed past/behind the paddle before a bounce was registered.
    if (this.ball.vy > 0 && this.ball.y >= this.paddleA.y - this.paddleReach && this.ball.y <= this.paddleA.y + 0.01) {
      if (Math.abs(this.ball.x - this.paddleA.x) <= this.paddleA.width / 2 + 0.02) {
        this.ball.vy = -Math.min(Math.abs(this.ball.vy) * 1.06, this.maxSpeed);
        this.ball.vx = (this.ball.x - this.paddleA.x) * 0.05;
        this.ball.y = this.paddleA.y - this.paddleReach; // snap to the contact point so it visibly bounces off the face
        if (window.SoundFx) window.SoundFx.playHit();
        if (window.ParticleFx) window.ParticleFx.explode(this.ball.x * window.innerWidth, this.ball.y * window.innerHeight, '#ff0844', 12);
      }
    }

    // Paddle B Collision (Top) — mirror of the above: ball travels up toward
    // this paddle, so the contact zone sits just BELOW its line.
    if (this.ball.vy < 0 && this.ball.y <= this.paddleB.y + this.paddleReach && this.ball.y >= this.paddleB.y - 0.01) {
      if (Math.abs(this.ball.x - this.paddleB.x) <= this.paddleB.width / 2 + 0.02) {
        this.ball.vy = Math.min(Math.abs(this.ball.vy) * 1.06, this.maxSpeed);
        this.ball.vx = (this.ball.x - this.paddleB.x) * 0.05;
        this.ball.y = this.paddleB.y + this.paddleReach;
        if (window.SoundFx) window.SoundFx.playHit();
        if (window.ParticleFx) window.ParticleFx.explode(this.ball.x * window.innerWidth, this.ball.y * window.innerHeight, '#00f2fe', 12);
      }
    }

    // Goal scored
    if (this.ball.y >= 0.99) { // Peer B scores (top player)
      this.overlay.updateScore('peerB', 1);
      if (window.SoundFx) window.SoundFx.playWin();
      this.resetBall(-0.010);
    } else if (this.ball.y <= 0.01) { // Peer A scores (bottom player)
      this.overlay.updateScore('peerA', 1);
      if (window.SoundFx) window.SoundFx.playWin();
      this.resetBall(0.010);
    }
  }

  resetBall(initialVy) {
    this.ball.x = 0.5;
    this.ball.y = 0.5;
    this.ball.vx = (Math.random() - 0.5) * 0.006;
    this.ball.vy = initialVy;
    const diff = window.getBotDifficulty ? window.getBotDifficulty() : { paddleError: 0.12 };
    this.botError = (Math.random() - 0.5) * diff.paddleError;
  }

  // Moves the Solo-mode bot's paddle toward the ball with a capped speed and
  // a small aim error, so it can be beaten but still puts up a fight.
  // Speed/error scale with the difficulty picked in solo.html.
  updateBotPaddle() {
    const diff = window.getBotDifficulty ? window.getBotDifficulty() : { paddleMaxSpeed: 0.018, paddleError: 0.12 };

    // Re-roll the aim error every ~500-900ms instead of once per rally, and
    // occasionally skip a frame entirely — makes the bot feel human/variable
    // instead of tracking the ball in one perfectly smooth, predictable curve.
    const now = performance.now();
    if (!this._nextErrorRoll || now >= this._nextErrorRoll) {
      this.botError = (Math.random() - 0.5) * diff.paddleError;
      this._nextErrorRoll = now + 500 + Math.random() * 400;
    }
    if (Math.random() < 0.06) return; // brief human-like hesitation

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

    // Effortless horizontal left-right hand sliding paddle input
    if (localFingertip) {
      const myPaddle = myRole === 'peerA' ? this.paddleA : this.paddleB;
      myPaddle.x = localFingertip.x; // Slide left/right based on hand x position — instant locally, never delayed

      // Firebase RTDB can't take a write every animation frame (~60/s) —
      // that floods the connection and updates start arriving late/out of
      // order, which is why the opponent's paddle used to show up in the
      // wrong spot on the OTHER player's screen even though it was correct
      // locally. Cap outgoing writes to once per 50ms (same cadence as the
      // ball broadcast) and let the receiver smooth between updates below.
      if (this.sync) {
        const now = performance.now();
        if (now - this._lastPaddleSend >= 50) {
          this._lastPaddleSend = now;
          this.sync.write('game/paddleInput', { role: myRole, x: myPaddle.x });
        }
      }
    }

    // Smoothly glide the OPPONENT's paddle toward the latest network value
    // instead of snapping straight to it. This hides the remaining network
    // latency/jitter so their paddle looks like it's sliding, not teleporting.
    if (this.sync) {
      if (myRole === 'peerA') {
        this.paddleB.x = SyncEngine.lerp(this.paddleB.x, this.targetPaddleB, 0.35);
      } else {
        this.paddleA.x = SyncEngine.lerp(this.paddleA.x, this.targetPaddleA, 0.35);
      }
    }

    if (this.sync && !this.sync.isHost) {
      // Guest: don't simulate locally, just smoothly interpolate toward the
      // host's authoritative ball position.
      this.ball.x = SyncEngine.lerp(this.ball.x, this.targetBall.x, 0.3);
      this.ball.y = SyncEngine.lerp(this.ball.y, this.targetBall.y, 0.3);
    } else {
      // Host (multiplayer) or Solo mode: this is the ONLY place physics runs.
      if (!this.sync) this.updateBotPaddle(); // Solo mode: bot controls paddleB
      this.updatePhysics();
    }

    ctx.save();

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
    // PERF: shadowBlur (ball + both paddles below) replaced with cached
    // glow sprites (drawGlow) — these redraw every frame for the whole
    // round, so this was a steady per-frame cost. See utils.js.
    const bx = this.ball.x * width;
    const by = this.ball.y * height;

    drawGlow(ctx, bx, by, this.ball.radius, '#00f2fe', 1.8);
    ctx.beginPath();
    ctx.arc(bx, by, this.ball.radius, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
  }

  drawPaddle(ctx, x, y, pWidth, color) {
    ctx.save();
    drawGlow(ctx, x, y, 12, color, 2.2);
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

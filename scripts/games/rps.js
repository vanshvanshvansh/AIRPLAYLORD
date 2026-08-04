// AirPlay Game 3 — Rock-Paper-Scissors Showdown
// Full-video-blur flow: Start -> 3s countdown -> whole call blurs -> both
// hand signs lock in simultaneously while still blurred -> unblur ->
// winner announced -> Start button reappears.

class RPSGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    // 'READY' -> 'COUNTDOWN' -> 'LOCKING' -> 'REVEAL' -> 'READY'
    this.roundState = 'READY';

    this.localGesture = 'NONE';
    this.peerGesture = 'NONE';
    this.localLocked = false;
    this.peerLocked = false;
    this.roundWinner = null;

    this.dwellStart = null;
    this.pendingGesture = null;
    this.dwellTime = 500;

    this.countdownTarget = null;

    this.gameTimer = 90;
    this.isUnlimitedTimer = false;
    this.timerInterval = null;
    this.isRunning = false;

    this._waitTimeout = null;
    this._botLockTimeout = null;

    this.blurOverlayEl = document.getElementById('rpsVideoBlurOverlay');
  }

  start(canvas, syncEngine, timerSetting = 90) {
    this.sync = syncEngine;
    this.canvas = canvas;
    this.resetToReady();

    if (timerSetting === 'unlimited') {
      this.isUnlimitedTimer = true;
      this.gameTimer = 999;
    } else {
      this.isUnlimitedTimer = false;
      this.gameTimer = parseInt(timerSetting) || 90;
    }

    this.isRunning = true;

    if (this.sync) {
      this.sync.listen('game/rpsGesture', (data) => {
        if (data && data.role !== this.sync.peerRole) {
          this.peerGesture = data.gesture;
          this.peerLocked = true;
          this.checkRoundResolution();
        }
      });
      this.sync.listen('game/rpsStart', (data) => {
        if (data && data.startedAt) {
          this.beginCountdown(data.startedAt);
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

  stop() {
    this.isRunning = false;
    if (this.timerInterval) clearInterval(this.timerInterval);
    clearTimeout(this._waitTimeout);
    clearTimeout(this._botLockTimeout);
    this.setBlurActive(false);
  }

  // --- State transitions ---------------------------------------------------

  now() {
    return this.sync ? this.sync.getServerTime() : Date.now();
  }

  triggerStartRound() {
    if (this.roundState !== 'READY') return;
    const startedAt = this.now() + 3000;
    this.beginCountdown(startedAt);
    if (this.sync) {
      this.sync.write('game/rpsStart', { startedAt });
    }
  }

  beginCountdown(targetTime) {
    this.roundState = 'COUNTDOWN';
    this.countdownTarget = targetTime;
    this.localGesture = 'NONE';
    this.peerGesture = 'NONE';
    this.localLocked = false;
    this.peerLocked = false;
    this.roundWinner = null;
    this.dwellStart = null;
    this.pendingGesture = null;
    this.setBlurActive(false);
  }

  beginRoundLocking() {
    this.roundState = 'LOCKING';
    this.dwellStart = null;
    this.pendingGesture = null;
    this.setBlurActive(true);

    clearTimeout(this._waitTimeout);
    // Safety net: if a round never resolves (peer drops mid-round, camera
    // trouble, etc.) don't leave the call blurred forever.
    this._waitTimeout = setTimeout(() => {
      if (this.roundState === 'LOCKING') {
        this.resetToReady();
      }
    }, 30000);

    if (!this.sync) {
      this.botPreCommittedGesture = ['ROCK', 'PAPER', 'SCISSORS'][Math.floor(Math.random() * 3)];
      clearTimeout(this._botLockTimeout);
      this._botLockTimeout = setTimeout(() => {
        if (this.roundState === 'LOCKING') {
          this.peerGesture = this.botPreCommittedGesture;
          this.peerLocked = true;
          this.checkRoundResolution();
        }
      }, 700 + Math.random() * 1300);
    }
  }

  resetToReady() {
    this.roundState = 'READY';
    this.localGesture = 'NONE';
    this.peerGesture = 'NONE';
    this.localLocked = false;
    this.peerLocked = false;
    this.roundWinner = null;
    this.dwellStart = null;
    this.pendingGesture = null;
    clearTimeout(this._waitTimeout);
    clearTimeout(this._botLockTimeout);
    this.setBlurActive(false);
  }

  setBlurActive(active) {
    if (!this.blurOverlayEl) this.blurOverlayEl = document.getElementById('rpsVideoBlurOverlay');
    if (this.blurOverlayEl) this.blurOverlayEl.classList.toggle('active', active);
  }

  // --- Gesture lock-in -------------------------------------------------------

  lockInGesture(myRole, gesture) {
    if (this.localLocked) return; // anti-cheat: a locked sign can never change
    this.localGesture = gesture;
    this.localLocked = true;
    this.dwellStart = null;
    this.pendingGesture = null;
    if (window.SoundFx) window.SoundFx.playHit();

    if (this.sync) {
      this.sync.write('game/rpsGesture', { role: myRole, gesture });
    }
    this.checkRoundResolution();
  }

  checkRoundResolution() {
    if (this.roundState !== 'LOCKING') return;
    if (this.localGesture === 'NONE' || this.peerGesture === 'NONE') return;
    if (!this.localLocked || !this.peerLocked) return;

    clearTimeout(this._waitTimeout);
    clearTimeout(this._botLockTimeout);

    const g1 = this.localGesture;
    const g2 = this.peerGesture;
    const myRole = this.sync ? this.sync.peerRole : 'peerA';

    if (g1 === g2) {
      this.roundWinner = 'DRAW';
    } else if (
      (g1 === 'ROCK' && g2 === 'SCISSORS') ||
      (g1 === 'PAPER' && g2 === 'ROCK') ||
      (g1 === 'SCISSORS' && g2 === 'PAPER')
    ) {
      this.roundWinner = myRole;
      this.overlay.updateScore(this.roundWinner, 1);
    } else {
      this.roundWinner = this.sync ? this.sync.opponentRole : 'peerB';
      this.overlay.updateScore(this.roundWinner, 1);
    }

    // Both signs are confirmed — only now does the blur lift and the
    // result get announced.
    this.roundState = 'REVEAL';
    this.setBlurActive(false);
    if (window.SoundFx) window.SoundFx.playWin();

    setTimeout(() => {
      if (this.roundState === 'REVEAL') this.resetToReady();
    }, 3500);
  }

  // --- Render ----------------------------------------------------------------

  render(ctx, width, height, localFingertip, peerFingertip) {
    if (!this.isRunning) return;

    const myRole = this.sync ? this.sync.peerRole : 'peerA';
    const cx = width / 2;
    const cy = height / 2;

    // Advance countdown
    if (this.roundState === 'COUNTDOWN') {
      const remainingMs = this.countdownTarget - this.now();
      if (remainingMs <= 0) {
        this.beginRoundLocking();
      }
    }

    // Gesture detection during LOCKING state (whole call is blurred).
    // Once a gesture has dwelled long enough it locks permanently for this
    // round — no further reads happen, so there is nothing left to change
    // once the blur lifts.
    if (window.activeHandTracker && this.roundState === 'LOCKING' && !this.localLocked) {
      const detected = window.activeHandTracker.detectedGesture || 'NONE';
      if (detected !== 'NONE') {
        if (this.pendingGesture !== detected || !this.dwellStart) {
          this.pendingGesture = detected;
          this.dwellStart = performance.now();
        } else if (performance.now() - this.dwellStart >= this.dwellTime) {
          this.lockInGesture(myRole, detected);
        }
      } else {
        this.dwellStart = null;
        this.pendingGesture = null;
      }
    }

    ctx.save();

    if (this.roundState === 'READY') {
      this.renderStartButton(ctx, cx, cy, localFingertip);
    } else if (this.roundState === 'COUNTDOWN') {
      this.renderCountdown(ctx, cx, cy);
    } else if (this.roundState === 'LOCKING') {
      this.renderLockingUI(ctx, cx, cy);
    } else if (this.roundState === 'REVEAL') {
      this.renderReveal(ctx, cx, cy, width, myRole);
    }

    ctx.restore();
  }

  renderStartButton(ctx, cx, cy, localFingertip) {
    const bx = cx;
    const by = cy + 120;
    const btnW = 220;
    const btnH = 54;

    ctx.beginPath();
    ctx.roundRect(bx - btnW / 2, by - btnH / 2, btnW, btnH, 27);
    ctx.fillStyle = 'rgba(0, 242, 254, 0.9)';
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 15;
    ctx.fill();

    ctx.font = `800 ${scaleFont(ctx.canvas, 20)}px Outfit, sans-serif`;
    ctx.fillStyle = '#040914';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('▶ START ROUND', bx, by);

    ctx.font = `600 ${scaleFont(ctx.canvas, 14)}px Outfit, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('Both screens will blur while you form your sign', bx, by + 44);

    if (localFingertip) {
      const fx = localFingertip.px;
      const fy = localFingertip.py;
      if (Math.abs(fx - bx) < btnW / 2 && Math.abs(fy - by) < btnH / 2) {
        this.triggerStartRound();
      }
    }
  }

  renderCountdown(ctx, cx, cy) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    const remainingMs = Math.max(0, this.countdownTarget - this.now());
    const secondsLeft = Math.ceil(remainingMs / 1000);

    ctx.font = `700 ${scaleFont(ctx.canvas, 24)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('Get Your Hand Ready!', cx, cy - 90);

    ctx.font = `900 120px Outfit, sans-serif`;
    ctx.fillStyle = '#00f2fe';
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 30;
    ctx.fillText(secondsLeft > 0 ? secondsLeft.toString() : 'GO!', cx, cy + 10);
    ctx.shadowBlur = 0;

    ctx.font = `600 ${scaleFont(ctx.canvas, 15)}px Outfit, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('The call blurs the moment this hits GO', cx, cy + 100);
  }

  renderLockingUI(ctx, cx, cy) {
    ctx.font = `700 ${scaleFont(ctx.canvas, 26)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 10;

    if (!this.localLocked) {
      ctx.fillText('✊✋✌️ Show Your Hand Sign!', cx, cy - 80);
      ctx.font = `600 ${scaleFont(ctx.canvas, 15)}px Outfit, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('Hold Rock, Paper or Scissors steady', cx, cy - 44);

      if (this.pendingGesture && this.pendingGesture !== 'NONE') {
        ctx.font = `700 ${scaleFont(ctx.canvas, 20)}px Outfit, sans-serif`;
        ctx.fillStyle = '#00f2fe';
        ctx.fillText(`Detecting: ${this.pendingGesture}`, cx, cy - 8);
      }

      if (this.dwellStart) {
        const progress = Math.min((performance.now() - this.dwellStart) / this.dwellTime, 1.0);
        ctx.beginPath();
        ctx.arc(cx, cy + 60, 45, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 6;
        ctx.stroke();
      }
    } else {
      ctx.fillText('🔒 Sign Locked In!', cx, cy - 40);
      ctx.font = `600 ${scaleFont(ctx.canvas, 16)}px Outfit, sans-serif`;
      ctx.fillStyle = this.peerLocked ? '#00f2fe' : 'rgba(255,255,255,0.7)';
      ctx.fillText(
        this.peerLocked ? 'Opponent locked in too — revealing…' : 'Waiting for both players to lock in…',
        cx,
        cy + 4
      );
    }

    ctx.shadowBlur = 0;
  }

  renderReveal(ctx, cx, cy, width, myRole) {
    const gestureEmoji = { ROCK: '✊ ROCK', PAPER: '✋ PAPER', SCISSORS: '✌️ SCISSORS', NONE: '❓ NONE' };

    ctx.font = `700 ${scaleFont(ctx.canvas, 24)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ff0844';
    ctx.fillText(`You: ${gestureEmoji[this.localGesture] || 'NONE'}`, cx, cy - 50);

    ctx.fillStyle = '#00f2fe';
    ctx.fillText(`Opponent: ${gestureEmoji[this.peerGesture] || 'NONE'}`, cx, cy - 10);

    ctx.font = `900 ${scaleFont(ctx.canvas, 38)}px Outfit, sans-serif`;
    ctx.fillStyle = '#ffffff';

    let resultText = 'DRAW!';
    if (this.roundWinner === 'DRAW') resultText = 'DRAW!';
    else if (this.roundWinner === myRole) resultText = 'YOU WIN ROUND! 🎉';
    else if (this.roundWinner) resultText = 'OPPONENT WINS ROUND!';

    wrapCanvasText(ctx, resultText, cx, cy + 50, width - 40, scaleFont(ctx.canvas, 42));
  }
}

window.RPSGame = RPSGame;

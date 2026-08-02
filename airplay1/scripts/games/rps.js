// AirPlay Game 3 — Rock-Paper-Scissors Showdown

class RPSGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    this.roundState = 'COUNTDOWN'; // 'COUNTDOWN', 'LOCKING', 'REVEAL', 'ROUND_END'
    this.countdown = 3;
    this.localGesture = 'NONE';
    this.peerGesture = 'NONE';
    this.roundWinner = null;
    this.roundsWonA = 0;
    this.roundsWonB = 0;

    this.dwellStart = null;
    this.dwellTime = 600; // 600ms dwell hover confirmation
  }

  start(canvas, syncEngine) {
    this.sync = syncEngine;
    this.roundState = 'COUNTDOWN';
    this.countdown = 3;
    this.localGesture = 'NONE';
    this.peerGesture = 'NONE';
    this.roundWinner = null;

    if (this.sync) {
      this.sync.listen('game/rpsGesture', (data) => {
        if (data && data.role !== this.sync.peerRole) {
          this.peerGesture = data.gesture;
          this.checkRoundResolution();
        }
      });
    }

    this.startCountdown();
  }

  startCountdown() {
    this.countdown = 3;
    this.roundState = 'COUNTDOWN';

    const interval = setInterval(() => {
      this.countdown--;
      if (this.countdown <= 0) {
        clearInterval(interval);
        this.roundState = 'LOCKING';
      }
    }, 1000);
  }

  stop() {
    this.roundState = 'ROUND_END';
  }

  render(ctx, width, height, localFingertip, peerFingertip) {
    const myRole = this.sync ? this.sync.peerRole : 'peerA';

    // Get current hand gesture from HandTracker global instance if available
    if (window.activeHandTracker && this.roundState === 'LOCKING') {
      this.localGesture = window.activeHandTracker.detectedGesture || 'NONE';

      if (this.localGesture !== 'NONE') {
        if (!this.dwellStart) {
          this.dwellStart = performance.now();
        } else if (performance.now() - this.dwellStart >= this.dwellTime) {
          // 600ms dwell confirmed gesture lock
          this.lockInGesture(myRole);
        }
      } else {
        this.dwellStart = null;
      }
    }

    // UI Rendering based on Round State
    const cx = width / 2;
    const cy = height / 2;

    ctx.save();

    if (this.roundState === 'COUNTDOWN') {
      ctx.font = '700 36px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Prepare Your Gesture!', cx, cy - 80);

      ctx.font = '900 100px Outfit, sans-serif';
      ctx.fillStyle = '#00f2fe';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 25;
      ctx.fillText(this.countdown > 0 ? this.countdown.toString() : 'SHOW!', cx, cy + 40);
    } else if (this.roundState === 'LOCKING') {
      ctx.font = '700 32px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`Hold Hand Gesture: ${this.localGesture}`, cx, cy - 60);

      // Render 600ms radial hover progress ring
      if (this.dwellStart) {
        const progress = Math.min((performance.now() - this.dwellStart) / this.dwellTime, 1.0);
        ctx.beginPath();
        ctx.arc(cx, cy + 40, 50, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 8;
        ctx.shadowColor = '#00f2fe';
        ctx.shadowBlur = 15;
        ctx.stroke();
      }
    } else if (this.roundState === 'REVEAL') {
      const gestureEmoji = { ROCK: '✊ ROCK', PAPER: '✋ PAPER', SCISSORS: '✌️ SCISSORS', NONE: '❓ NONE' };

      ctx.font = '700 28px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff0844';
      ctx.fillText(`You: ${gestureEmoji[this.localGesture]}`, cx - 180, cy - 20);

      ctx.fillStyle = '#00f2fe';
      ctx.fillText(`Opponent: ${gestureEmoji[this.peerGesture]}`, cx + 180, cy - 20);

      ctx.font = '900 48px Outfit, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 20;

      let resultText = 'DRAW!';
      if (this.roundWinner === myRole) resultText = 'YOU WIN ROUND! 🎉';
      else if (this.roundWinner && this.roundWinner !== myRole) resultText = 'OPPONENT WINS ROUND!';

      ctx.fillText(resultText, cx, cy + 80);
    }

    ctx.restore();
  }

  lockInGesture(myRole) {
    this.roundState = 'REVEAL';
    if (window.SoundFx) window.SoundFx.playHit();

    if (this.sync) {
      this.sync.write('game/rpsGesture', { role: myRole, gesture: this.localGesture });
    } else {
      // Solo testing fallback
      this.peerGesture = ['ROCK', 'PAPER', 'SCISSORS'][Math.floor(Math.random() * 3)];
      this.checkRoundResolution();
    }
  }

  checkRoundResolution() {
    if (this.localGesture === 'NONE' || this.peerGesture === 'NONE') return;

    const g1 = this.localGesture;
    const g2 = this.peerGesture;

    if (g1 === g2) {
      this.roundWinner = 'DRAW';
    } else if (
      (g1 === 'ROCK' && g2 === 'SCISSORS') ||
      (g1 === 'PAPER' && g2 === 'ROCK') ||
      (g1 === 'SCISSORS' && g2 === 'PAPER')
    ) {
      this.roundWinner = this.sync ? this.sync.peerRole : 'peerA';
      this.overlay.updateScore(this.roundWinner, 1);
    } else {
      this.roundWinner = this.sync ? this.sync.opponentRole : 'peerB';
      this.overlay.updateScore(this.roundWinner, 1);
    }

    // Reset for next round after 3 seconds
    setTimeout(() => {
      if (this.roundState === 'REVEAL') {
        this.localGesture = 'NONE';
        this.peerGesture = 'NONE';
        this.dwellStart = null;
        this.startCountdown();
      }
    }, 3000);
  }
}

window.RPSGame = RPSGame;

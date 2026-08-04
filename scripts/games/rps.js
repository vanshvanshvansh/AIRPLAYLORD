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

    // Anti-cheat: while both players are choosing a gesture, this blacks
    // out each player's hand in the video THEY SEND to the other player
    // (see privacyShield.js) so nobody can watch the opponent's hand over
    // the video call and copy/counter it live. Only meaningful in synced
    // (real opponent) play — solo mode plays against a bot that never
    // "watches" anything.
    this.shield = window.HandPrivacyShield ? new window.HandPrivacyShield() : null;
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
    // BUGFIX: roundWinner was never cleared between rounds, so if a round
    // reached REVEAL while waiting on a peer gesture that never arrived (or
    // arrived as NONE), the screen kept showing the PREVIOUS round's winner
    // — looking exactly like the game "decided" a winner out of thin air.
    this.roundWinner = null;

    // Solo mode: lock in the bot's gesture NOW, before the player has shown
    // theirs, so there is zero possibility of the bot "reading" the player's
    // hand — it's committed in advance, same as a real opponent would be.
    if (!this.sync) {
      this.botPreCommittedGesture = ['ROCK', 'PAPER', 'SCISSORS'][Math.floor(Math.random() * 3)];
    }

    // BUGFIX (black privacy-mask box leaking into whichever game gets
    // played AFTER RPS, e.g. Paddle/Balloon): this interval was never
    // stored/cleared, so if the round was torn down (game switched, exit
    // button, timer ran out) WHILE it was still counting down, it kept
    // ticking in the background. When it hit 0 it would still flip
    // roundState to 'LOCKING' and call shield.start() — even though RPS
    // wasn't the active game anymore, so the mask stayed stuck on top of
    // whatever game came next. Storing it on `this` and clearing it in
    // stop() kills it the instant the round/game actually ends.
    if (this._countdownInterval) clearInterval(this._countdownInterval);
    this._countdownInterval = setInterval(() => {
      this.countdown--;
      if (this.countdown <= 0) {
        clearInterval(this._countdownInterval);
        this._countdownInterval = null;
        this.roundState = 'LOCKING';

        // Start hiding hands from each other the instant the round enters
        // its choosing phase — before either player has shown anything.
        if (this.sync && this.shield && window.activeWebRTC) {
          this._shieldToken = this.shield.start(window.activeWebRTC);
        }
      }
    }, 1000);
  }

  stop() {
    this.roundState = 'ROUND_END';
    clearTimeout(this._waitTimeout);
    if (this._countdownInterval) {
      clearInterval(this._countdownInterval);
      this._countdownInterval = null;
    }
    if (this.shield) this.shield.stop(this._shieldToken);
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
      ctx.font = `700 ${scaleFont(ctx.canvas, 26)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Prepare Your Gesture!', cx, cy - 80);

      ctx.font = `900 ${scaleFont(ctx.canvas, 80)}px Outfit, sans-serif`;
      ctx.fillStyle = '#00f2fe';
      drawGlow(ctx, cx, cy + 24, 30, '#00f2fe', 1.6);
      ctx.fillText(this.countdown > 0 ? this.countdown.toString() : 'SHOW!', cx, cy + 40);
    } else if (this.roundState === 'LOCKING') {
      ctx.font = `700 ${scaleFont(ctx.canvas, 24)}px Outfit, sans-serif`;
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

      // Stacked vertically (not side-by-side) so long labels never run off
      // the edge of a narrow phone screen.
      ctx.font = `700 ${scaleFont(ctx.canvas, 26)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff0844';
      ctx.fillText(`You: ${gestureEmoji[this.localGesture]}`, cx, cy - 55);

      ctx.fillStyle = '#00f2fe';
      ctx.fillText(`Opponent: ${gestureEmoji[this.peerGesture]}`, cx, cy - 15);

      ctx.font = `900 ${scaleFont(ctx.canvas, 42)}px Outfit, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 20;

      // BUGFIX: 'DRAW' is a truthy string, so checking "roundWinner &&
      // roundWinner !== myRole" before checking for a draw meant every draw
      // fell into that branch and displayed as a loss/win instead of DRAW.
      // The DRAW case must be checked explicitly, first.
      // BUGFIX (user feedback): the old "You're locked in — you can relax
      // your hand" status line was removed — it read cluttered mid-call
      // and wasn't needed; simple "Waiting for opponent…" covers it.
      let resultText = 'Waiting for opponent…';
      if (this.roundWinner === 'DRAW') resultText = 'DRAW!';
      else if (this.roundWinner === myRole) resultText = 'YOU WIN ROUND! 🎉';
      else if (this.roundWinner) resultText = 'OPPONENT WINS ROUND!';

      const maxWidth = Math.min(width - 40, 560);
      wrapCanvasText(ctx, resultText, cx, cy + 60, maxWidth, scaleFont(ctx.canvas, 36));
    }

    ctx.restore();
  }

  lockInGesture(myRole) {
    this.roundState = 'REVEAL';
    if (window.SoundFx) window.SoundFx.playHit();

    if (this.sync) {
      this.sync.write('game/rpsGesture', { role: myRole, gesture: this.localGesture });

      // If the opponent never locks in a gesture (dropped hand, lag, etc.)
      // don't leave the screen stuck forever on "Waiting for opponent…" —
      // redo the round after a few seconds so play can continue.
      clearTimeout(this._waitTimeout);
      this._waitTimeout = setTimeout(() => {
        if (this.roundState === 'REVEAL' && !this.roundWinner) {
          if (this.shield) this.shield.stop(this._shieldToken);
          this.localGesture = 'NONE';
          this.peerGesture = 'NONE';
          this.dwellStart = null;
          this.startCountdown();
        }
      }, 6000);
    } else {
      // Solo mode: use the gesture committed before the round started
      this.peerGesture = this.botPreCommittedGesture || ['ROCK', 'PAPER', 'SCISSORS'][Math.floor(Math.random() * 3)];
      this.checkRoundResolution();
    }
  }

  checkRoundResolution() {
    if (this.localGesture === 'NONE' || this.peerGesture === 'NONE') return;
    clearTimeout(this._waitTimeout);

    // Both sides have now locked in a gesture — safe to reveal. Restore
    // each player's normal (unmasked) outgoing video so hands become
    // visible again right as the result is shown, never before.
    if (this.shield) this.shield.stop(this._shieldToken);

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

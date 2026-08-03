// AirPlay — Master Game Overlay Framework & State Controller (v2 Updated)

class GameOverlayManager {
  constructor(canvasElement, syncEngine) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.sync = syncEngine;

    this.activeGame = null;
    this.currentGameId = null;
    this.countdownSeconds = null;
    this.customTimerSetting = 45;
    this.pendingTimerSetting = 45; // last timer value received via sync, used when game/current fires

    this.scores = {
      peerA: 0,
      peerB: 0
    };

    this.floatingEmojis = [];

    this.scoreboardEl = document.getElementById('scoreboardHud');
    this.timerEl = document.getElementById('gameTimerDisplay');
    this.scoreAEl = document.getElementById('scorePeerA');
    this.scoreBEl = document.getElementById('scorePeerB');
    this.exitBtn = document.getElementById('exitGameBtn');
    this.exitModal = document.getElementById('exitConfirmModal');

    this.gamesMap = {};

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.setupExitListener();
    if (this.sync) this.setupSyncListeners();
  }

  registerGame(gameId, gameInstance) {
    this.gamesMap[gameId] = gameInstance;
  }

  resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  setupExitListener() {
    if (!this.exitBtn) return;
    this.exitBtn.onclick = debounce(() => {
      if (this.exitModal) this.exitModal.classList.add('active');
    });

    const confirmYes = document.getElementById('exitConfirmYes');
    const confirmNo = document.getElementById('exitConfirmNo');

    if (confirmYes) {
      confirmYes.onclick = debounce(() => {
        if (this.exitModal) this.exitModal.classList.remove('active');
        this.endActiveGame(true);
      });
    }

    if (confirmNo) {
      confirmNo.onclick = debounce(() => {
        if (this.exitModal) this.exitModal.classList.remove('active');
      });
    }
  }

  setupSyncListeners() {
    // Must be registered before 'game/current' — startSyncedGame() writes
    // timerSetting first, then current, so this value is populated in time.
    this.sync.listen('game/timerSetting', (timerSetting) => {
      if (timerSetting !== null && timerSetting !== undefined) {
        this.pendingTimerSetting = timerSetting;
      }
    });

    // Must ALSO be registered before 'game/current' for the same reason.
    // Previously the guest never listened to this at all and instead started
    // its OWN local 3s countdown the moment the (network-delayed) 'game/current'
    // notification arrived — so if that notification was even 1-2s late, the
    // guest's countdown/game started 1-2s behind the host's, which is exactly
    // why both sides showed different screens / mismatched countdowns.
    this.sync.listen('game/startTimestamp', (ts) => {
      if (typeof ts === 'number') {
        this.pendingStartTimestamp = ts;
      }
    });

    this.sync.listen('game/current', (gameId) => {
      if (gameId && gameId !== this.currentGameId) {
        this.launchGame(gameId, false, this.pendingStartTimestamp, this.pendingTimerSetting);
      } else if (!gameId && this.activeGame) {
        this.endActiveGame(false);
      }
    });

    this.sync.listen('game/scores', (scores) => {
      if (scores) {
        this.scores = scores;
        this.updateScoreboardUI();
      }
    });

    this.sync.listen('session/reaction', (reaction) => {
      if (reaction && reaction.emoji) {
        this.triggerFloatingEmoji(reaction.emoji);
      }
    });
  }

  triggerFloatingEmoji(emojiSymbol) {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emojiSymbol;
    el.style.left = `${30 + Math.random() * 40}%`;
    el.style.bottom = '100px';
    document.body.appendChild(el);
    setTimeout(() => { el.remove(); }, 2000);
  }

  startSyncedGame(gameId, timerSetting = 45) {
    this.customTimerSetting = timerSetting;
    const startTimestamp = Date.now() + 3000;
    if (this.sync) {
      this.sync.write('game/timerSetting', timerSetting);
      this.sync.write('game/startTimestamp', startTimestamp);
      this.sync.write('game/current', gameId);
    } else {
      this.launchGame(gameId, true, startTimestamp, timerSetting);
    }
  }

  launchGame(gameId, isInitiator = true, targetTimestamp = null, timerSetting = 45) {
    const game = this.gamesMap[gameId];
    if (!game) {
      console.error(`Game ${gameId} not registered.`);
      return;
    }

    this.currentGameId = gameId;
    this.activeGame = game;
    this.customTimerSetting = timerSetting;

    if (this.scoreboardEl) this.scoreboardEl.style.display = 'flex';
    if (this.exitBtn) this.exitBtn.style.display = 'flex';

    const startTime = targetTimestamp || (Date.now() + 3000);
    this.runCountdown(startTime, () => {
      this.activeGame.start(this.canvas, this.sync, this.customTimerSetting);
    });
  }

  runCountdown(targetTime, onComplete) {
    const countdownInterval = setInterval(() => {
      const remaining = Math.ceil((targetTime - Date.now()) / 1000);
      this.countdownSeconds = remaining;

      if (remaining <= 0) {
        clearInterval(countdownInterval);
        this.countdownSeconds = null;
        onComplete();
      }
    }, 50);
  }

  updateScore(peerRole, points = 1) {
    this.scores[peerRole] = (this.scores[peerRole] || 0) + points;
    if (this.sync) {
      this.sync.write('game/scores', this.scores);
    } else {
      this.updateScoreboardUI();
    }
  }

  updateScoreboardUI() {
    if (this.scoreAEl) this.scoreAEl.textContent = this.scores.peerA || 0;
    if (this.scoreBEl) this.scoreBEl.textContent = this.scores.peerB || 0;
  }

  endActiveGame(notifyPeer = true) {
    if (this.activeGame) {
      const winner = (this.scores.peerA > this.scores.peerB) ? 'peerA' : (this.scores.peerB > this.scores.peerA ? 'peerB' : 'TIE');
      if (this.sync) {
        this.sync.recordGameFinished(this.currentGameId, this.customTimerSetting, this.scores, winner);
      }
      if (this.activeGame.stop) this.activeGame.stop();
      this.activeGame = null;
    }
    this.currentGameId = null;

    if (this.scoreboardEl) this.scoreboardEl.style.display = 'none';
    if (this.exitBtn) this.exitBtn.style.display = 'none';

    if (notifyPeer && this.sync) {
      this.sync.write('game/current', null);
    }
  }

  render(localFingertip, peerFingertip) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // Update & Render Particle FX
    if (window.ParticleFx) {
      window.ParticleFx.updateAndRender(this.ctx);
    }

    if (this.countdownSeconds !== null && this.countdownSeconds > 0) {
      this.drawCountdownOverlay(this.countdownSeconds);
      return;
    }

    if (this.activeGame && this.activeGame.render) {
      this.activeGame.render(this.ctx, this.canvas.width, this.canvas.height, localFingertip, peerFingertip);
    }
  }

  drawCountdownOverlay(seconds) {
    const ctx = this.ctx;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.font = '900 120px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#00f2fe';
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 30;

    const text = seconds > 0 ? seconds.toString() : 'GO!';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }
}

window.GameOverlayManager = GameOverlayManager;

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
    // BUGFIX: this used to be THREE separate writes to three separate
    // Firebase paths (game/timerSetting, game/startTimestamp, game/current),
    // each with its own listener. Firebase does not guarantee those three
    // 'value' callbacks fire in write order relative to EACH OTHER (only
    // writes to the *same* path are ordered) — so on a slow/lossy connection
    // 'game/current' could arrive before 'game/timerSetting' had landed,
    // and the guest would launch the game with the stale default (45s)
    // while the host was using whatever value was actually picked (e.g. 3s
    // or a custom value). Same race explains games starting mid-switch on
    // one screen while the other still shows an old timer/countdown.
    // Fix: send everything the game needs to start in ONE write to ONE
    // path, so it always arrives as a single atomic snapshot.
    // BUGFIX (game end doesn't propagate to the other player): Firebase
    // Realtime Database silently STRIPS any key whose value is `null` before
    // writing — so the old `sync.write('game/session', { gameId: null })`
    // call in endActiveGame() actually resulted in the ENTIRE 'game/session'
    // node being deleted (an object with only null-valued keys collapses to
    // nothing). That means the listener below received `session === null`
    // (not an object), and the old check `session && !session.gameId` never
    // ran because `session` itself was falsy — so the other player's game
    // never ended automatically. Checking `!session || !session.gameId`
    // (instead of requiring `session` to be truthy first) correctly treats
    // "node deleted" and "gameId explicitly cleared" as the same signal.
    this.sync.listen('game/session', (session) => {
      if (!session || !session.gameId) {
        if (this.activeGame) this.endActiveGame(false);
        return;
      }
      if (session.gameId !== this.currentGameId) {
        this.launchGame(session.gameId, false, session.startTimestamp, session.timerSetting);
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
      // Single atomic write — see BUGFIX note in setupSyncListeners().
      this.sync.write('game/session', { gameId, timerSetting, startTimestamp });
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
      // `false` (not `null`) so Firebase doesn't strip the key entirely —
      // keeps 'game/session' as a real, readable object for anything else
      // that might inspect it.
      this.sync.write('game/session', { gameId: false });
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

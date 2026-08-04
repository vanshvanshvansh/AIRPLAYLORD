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
    this.extraSettings = null;
    this.gameStartedAt = null;

    this.scores = {
      peerA: 0,
      peerB: 0
    };

    this.floatingEmojis = [];

    this.gameTitles = {
      balloon: 'Balloon Duel',
      paddle: 'Paddle Duel',
      rps: 'RPS Showdown',
      tug: 'Finger Tug of War',
      truth: 'Truth or Dare — Air Spin'
    };

    this.scoreboardEl = document.getElementById('scoreboardHud');
    this.timerEl = document.getElementById('gameTimerDisplay');
    this.scoreAEl = document.getElementById('scorePeerA');
    this.scoreBEl = document.getElementById('scorePeerB');
    this.exitBtn = document.getElementById('exitGameBtn');
    this.exitModal = document.getElementById('exitConfirmModal');

    this.resultModalEl = document.getElementById('gameResultModal');
    this.resultCloseBtn = document.getElementById('gameResultCloseBtn');

    this.gamesMap = {};

    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());

    this.setupExitListener();
    this.setupResultModalListener();
    if (this.sync) this.setupSyncListeners();
  }

  now() {
    return (this.sync && typeof this.sync.getServerTime === 'function') ? this.sync.getServerTime() : Date.now();
  }

  setupResultModalListener() {
    if (!this.resultCloseBtn) return;
    this.resultCloseBtn.onclick = debounce(() => {
      if (this.resultModalEl) this.resultModalEl.classList.remove('active');
      const gamesSheet = document.getElementById('gamesBottomSheet');
      if (gamesSheet) gamesSheet.classList.add('open');
    });
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
    this.sync.listen('game/session', (session) => {
      if (!session || !session.gameId) {
        if (this.activeGame) this.endActiveGame(false);
        return;
      }
      if (session.gameId !== this.currentGameId) {
        this.launchGame(session.gameId, false, session.startTimestamp, session.timerSetting, session.extraSettings);
      }
    });

    this.sync.listen('game/scores', (scores) => {
      if (scores) {
        const prevA = this.scores.peerA || 0;
        const prevB = this.scores.peerB || 0;
        this.scores = scores;
        this.updateScoreboardUI();
        if ((scores.peerA || 0) > prevA) this.flashScore('peerA');
        if ((scores.peerB || 0) > prevB) this.flashScore('peerB');
      }
    });

    this.sync.listen('session/reaction', (reaction) => {
      if (reaction && reaction.emoji) {
        this.triggerFloatingEmoji(reaction.emoji);
      }
    });
  }

  triggerFloatingEmoji(emojiSymbol) {
    const BURST_COUNT = 6;
    for (let i = 0; i < BURST_COUNT; i++) {
      const delay = i * (70 + Math.random() * 90);
      setTimeout(() => this.spawnFloatingEmojiParticle(emojiSymbol), delay);
    }
  }

  spawnFloatingEmojiParticle(emojiSymbol) {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emojiSymbol;

    const leftPct = 25 + Math.random() * 50;
    const drift = (Math.random() * 60 - 30).toFixed(0);
    const rise = (140 + Math.random() * 100).toFixed(0);
    const duration = (1.6 + Math.random() * 1.1).toFixed(2);
    const scale = (0.85 + Math.random() * 0.5).toFixed(2);

    el.style.left = `${leftPct}%`;
    el.style.bottom = '90px';
    el.style.setProperty('--drift', `${drift}px`);
    el.style.setProperty('--rise', `${rise}px`);
    el.style.setProperty('--scale', scale);
    el.style.animationDuration = `${duration}s`;

    document.body.appendChild(el);
    setTimeout(() => { el.remove(); }, duration * 1000);
  }

  startSyncedGame(gameId, timerSetting = 45, extraSettings = null) {
    const timerVal = (typeof timerSetting === 'object') ? (timerSetting.timer || 90) : timerSetting;
    const settingsObj = (typeof timerSetting === 'object') ? timerSetting : extraSettings;
    this.customTimerSetting = timerVal;
    this.extraSettings = settingsObj;
    const startTimestamp = this.now() + 3000;

    if (this.sync) {
      this.sync.write('game/session', { gameId, timerSetting: timerVal, extraSettings: settingsObj, startTimestamp });
    } else {
      this.launchGame(gameId, true, startTimestamp, timerVal, settingsObj);
    }
  }

  launchGame(gameId, isInitiator = true, targetTimestamp = null, timerSetting = 45, extraSettings = null) {
    const game = this.gamesMap[gameId];
    if (!game) {
      console.error(`Game ${gameId} not registered.`);
      return;
    }

    this.currentGameId = gameId;
    this.activeGame = game;
    this.customTimerSetting = timerSetting;
    this.extraSettings = extraSettings;
    this.scores = { peerA: 0, peerB: 0 };
    this.updateScoreboardUI();

    if (this.sync && this.sync.isHost) this.sync.write('game/scores', this.scores);

    if (this.scoreboardEl) this.scoreboardEl.style.display = (gameId === 'truth') ? 'none' : 'flex';
    if (this.exitBtn) this.exitBtn.style.display = 'flex';

    const startTime = targetTimestamp || (this.now() + 3000);
    this.runCountdown(startTime, () => {
      this.gameStartedAt = Date.now();
      this.activeGame.start(this.canvas, this.sync, this.customTimerSetting, this.extraSettings);
    });
  }

  runCountdown(targetTime, onComplete) {
    const countdownInterval = setInterval(() => {
      const remaining = Math.ceil((targetTime - this.now()) / 1000);
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
    this.flashScore(peerRole);
  }

  updateScoreboardUI() {
    if (this.scoreAEl) this.scoreAEl.textContent = this.scores.peerA || 0;
    if (this.scoreBEl) this.scoreBEl.textContent = this.scores.peerB || 0;
  }

  flashScore(peerRole) {
    const el = peerRole === 'peerA' ? this.scoreAEl : this.scoreBEl;
    if (!el) return;

    el.classList.remove('score-pulse');
    void el.offsetWidth;
    el.classList.add('score-pulse');
    setTimeout(() => el.classList.remove('score-pulse'), 650);

    const rect = el.getBoundingClientRect();
    const popup = document.createElement('div');
    popup.className = 'floating-score-popup';
    popup.textContent = '+1';
    popup.style.left = `${rect.left + rect.width / 2}px`;
    popup.style.top = `${rect.top}px`;
    document.body.appendChild(popup);
    setTimeout(() => popup.remove(), 900);
  }

  endActiveGame(notifyPeer = true) {
    if (this.activeGame) {
      const winner = (this.scores.peerA > this.scores.peerB) ? 'peerA' : (this.scores.peerB > this.scores.peerA ? 'peerB' : 'TIE');
      const finishedGameId = this.currentGameId;
      const finishedScores = { ...this.scores };
      const finishedTdCounts = (finishedGameId === 'truth' && this.activeGame.tdCounts)
        ? JSON.parse(JSON.stringify(this.activeGame.tdCounts))
        : null;
      const playedSeconds = this.gameStartedAt ? Math.max(0, Math.round((Date.now() - this.gameStartedAt) / 1000)) : 0;

      if (this.sync) {
        this.sync.recordGameFinished(this.currentGameId, this.customTimerSetting, this.scores, winner);
      }
      if (this.activeGame.stop) this.activeGame.stop();
      this.activeGame = null;

      this.showGameResultModal(finishedGameId, finishedScores, winner, playedSeconds, finishedTdCounts);
    }
    this.currentGameId = null;
    this.gameStartedAt = null;

    if (this.scoreboardEl) this.scoreboardEl.style.display = 'none';
    if (this.exitBtn) this.exitBtn.style.display = 'none';

    if (notifyPeer && this.sync) {
      this.sync.write('game/session', { gameId: false });
    }
  }

  showGameResultModal(gameId, scores, winner, playedSeconds, tdCounts = null) {
    if (!this.resultModalEl) return;

    const myRole = this.sync ? this.sync.peerRole : 'peerA';
    const isSolo = !this.sync;

    const titleEl = document.getElementById('gameResultTitle');
    const winnerTextEl = document.getElementById('gameResultWinnerText');
    const bannerEl = document.getElementById('gameResultBanner');
    const labelAEl = document.getElementById('gameResultLabelA');
    const labelBEl = document.getElementById('gameResultLabelB');
    const valAEl = document.getElementById('gameResultValA');
    const valBEl = document.getElementById('gameResultValB');
    const metaEl = document.getElementById('gameResultMeta');

    if (titleEl) titleEl.textContent = this.gameTitles[gameId] || 'Game';

    if (labelAEl) labelAEl.textContent = isSolo ? 'You' : (myRole === 'peerA' ? 'You' : 'Opponent');
    if (labelBEl) labelBEl.textContent = isSolo ? 'Bot' : (myRole === 'peerB' ? 'You' : 'Opponent');

    // Reset visibility every time — a previous truth-mode modal shouldn't
    // leak its layout into the next (non-truth) game's result screen.
    const scoresRowEl = document.getElementById('gameResultScoresRow');
    const truthBlockEl = document.getElementById('truthResultBlock');
    if (bannerEl) bannerEl.style.display = '';
    if (winnerTextEl) winnerTextEl.style.display = '';
    if (scoresRowEl) scoresRowEl.style.display = '';
    if (metaEl) metaEl.style.display = '';
    if (truthBlockEl) truthBlockEl.style.display = 'none';

    if (gameId === 'truth' && tdCounts) {
      const a = tdCounts.peerA || { truth: 0, dare: 0 }; // Red / P1
      const b = tdCounts.peerB || { truth: 0, dare: 0 }; // Blue / P2

      // Reorganized top to bottom: Time -> Truth (Blue, Red) -> Dare (Red, Blue).
      if (bannerEl) bannerEl.style.display = 'none';
      if (winnerTextEl) winnerTextEl.style.display = 'none';
      if (scoresRowEl) scoresRowEl.style.display = 'none';
      if (metaEl) metaEl.style.display = 'none';
      if (truthBlockEl) truthBlockEl.style.display = 'flex';

      const mins2 = Math.floor(playedSeconds / 60);
      const secs2 = playedSeconds % 60;
      const durationStr2 = mins2 > 0 ? `${mins2}m ${secs2}s` : `${secs2}s`;
      const timeEl = document.getElementById('truthResultTime');
      if (timeEl) timeEl.textContent = `⏱ Played for ${durationStr2}`;

      const truthBlueEl = document.getElementById('truthResultTruthBlue');
      const truthRedEl = document.getElementById('truthResultTruthRed');
      const dareRedEl = document.getElementById('truthResultDareRed');
      const dareBlueEl = document.getElementById('truthResultDareBlue');
      if (truthBlueEl) truthBlueEl.textContent = b.truth;
      if (truthRedEl) truthRedEl.textContent = a.truth;
      if (dareRedEl) dareRedEl.textContent = a.dare;
      if (dareBlueEl) dareBlueEl.textContent = b.dare;

      this.resultModalEl.classList.add('active');
      return;
    }

    if (gameId === 'tug') {
      if (valAEl) valAEl.textContent = `${scores.peerA || 0}%`;
      if (valBEl) valBEl.textContent = `${scores.peerB || 0}%`;
    } else {
      if (valAEl) valAEl.textContent = scores.peerA || 0;
      if (valBEl) valBEl.textContent = scores.peerB || 0;
    }

    let winnerText;
    if (winner === 'TIE') {
      winnerText = "It's a Tie!";
      if (bannerEl) bannerEl.textContent = '🤝';
    } else if (isSolo) {
      winnerText = winner === 'peerA' ? 'You Won! 🎉' : 'Bot Won — Try Again!';
      if (bannerEl) bannerEl.textContent = winner === 'peerA' ? '🏆' : '🤖';
    } else {
      winnerText = winner === myRole ? 'You Won! 🎉' : 'Opponent Won';
      if (bannerEl) bannerEl.textContent = winner === myRole ? '🏆' : '😔';
    }
    if (winnerTextEl) winnerTextEl.textContent = winnerText;

    const mins = Math.floor(playedSeconds / 60);
    const secs = playedSeconds % 60;
    const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    if (metaEl) metaEl.textContent = `Played for ${durationStr}`;

    this.resultModalEl.classList.add('active');
  }

  render(localFingertip, peerFingertip) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

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

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
    this.gameStartedAt = null; // wall-clock time actual play began (post-countdown), for the result modal's duration

    this.scores = {
      peerA: 0,
      peerB: 0
    };

    this.floatingEmojis = [];

    // Human-readable names for the end-of-game result modal & other UI.
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

  // "Network time" — corrected for this device's clock drift so a shared
  // absolute timestamp (like a countdown target) reads the same way on
  // every device. See BUGFIX note in sync.js's getServerTime().
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
        // Diff against the previous scores so BOTH players get the same
        // "someone just scored" flash/feedback — not just whoever's device
        // physically detected the point. Without this, the scoring player
        // saw feedback (via updateScore() below) but the opponent's number
        // just silently changed with no visible cue that a point happened.
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
    const startTimestamp = this.now() + 3000;
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
    this.scores = { peerA: 0, peerB: 0 };
    this.updateScoreboardUI();
    // Reset the shared score node too (host-only write, so both sides don't
    // race to write it) — otherwise a fresh game could briefly inherit the
    // previous round's score the moment the first real point comes in.
    if (this.sync && this.sync.isHost) this.sync.write('game/scores', this.scores);

    // Truth or Dare has no numeric "score" — the live 0-0 scoreboard HUD
    // was meaningless for it, so hide it for this game only. (Its
    // end-of-game summary shows Truth/Dare pick counts instead — see
    // showGameResultModal below.)
    if (this.scoreboardEl) this.scoreboardEl.style.display = (gameId === 'truth') ? 'none' : 'flex';
    if (this.exitBtn) this.exitBtn.style.display = 'flex';

    const startTime = targetTimestamp || (this.now() + 3000);
    this.runCountdown(startTime, () => {
      this.gameStartedAt = Date.now();
      this.activeGame.start(this.canvas, this.sync, this.customTimerSetting);
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
    // Local instant feedback for whoever's device detected the point (host,
    // in the host-authoritative games). The opponent gets the matching
    // flash from the diff-check in the 'game/scores' listener above, so
    // both screens visibly react to every point — not just a silently
    // updated number.
    this.flashScore(peerRole);
  }

  updateScoreboardUI() {
    if (this.scoreAEl) this.scoreAEl.textContent = this.scores.peerA || 0;
    if (this.scoreBEl) this.scoreBEl.textContent = this.scores.peerB || 0;
  }

  // Visible "someone scored" cue: pulses/highlights that player's score
  // number and pops a floating "+1" next to it, so a missed ball / lost
  // point is obvious on BOTH screens instead of the number just quietly
  // ticking up.
  flashScore(peerRole) {
    const el = peerRole === 'peerA' ? this.scoreAEl : this.scoreBEl;
    if (!el) return;

    el.classList.remove('score-pulse');
    // Force reflow so the animation restarts even on back-to-back scores.
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
      // Truth or Dare reports Truth/Dare pick counts instead of a score —
      // grab them off the game instance before it's torn down below.
      const finishedTdCounts = (finishedGameId === 'truth' && this.activeGame.tdCounts)
        ? JSON.parse(JSON.stringify(this.activeGame.tdCounts))
        : null;
      const playedSeconds = this.gameStartedAt ? Math.max(0, Math.round((Date.now() - this.gameStartedAt) / 1000)) : 0;

      if (this.sync) {
        this.sync.recordGameFinished(this.currentGameId, this.customTimerSetting, this.scores, winner);
      }
      if (this.activeGame.stop) this.activeGame.stop();
      this.activeGame = null;

      // Show BOTH players a result scoreboard whenever a game actually
      // ends — whether its timer ran out naturally, or someone cut it
      // short. This fires here regardless of which of the 3 end-paths
      // triggered endActiveGame (own timer, exit button, or the peer
      // ending it — see the 'game/session' listener above), so it's
      // consistent across every game and every way a round can end.
      this.showGameResultModal(finishedGameId, finishedScores, winner, playedSeconds, finishedTdCounts);
    }
    this.currentGameId = null;
    this.gameStartedAt = null;

    if (this.scoreboardEl) this.scoreboardEl.style.display = 'none';
    if (this.exitBtn) this.exitBtn.style.display = 'none';

    if (notifyPeer && this.sync) {
      // `false` (not `null`) so Firebase doesn't strip the key entirely —
      // keeps 'game/session' as a real, readable object for anything else
      // that might inspect it.
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

    // Truth or Dare: show how many times each player picked Truth vs Dare
    // instead of a numeric score — a win/loss score never meant anything
    // for this game, but the pick breakdown is actually useful info.
    if (gameId === 'truth' && tdCounts) {
      const a = tdCounts.peerA || { truth: 0, dare: 0 };
      const b = tdCounts.peerB || { truth: 0, dare: 0 };
      if (valAEl) valAEl.textContent = `${a.truth} Truth · ${a.dare} Dare`;
      if (valBEl) valBEl.textContent = `${b.truth} Truth · ${b.dare} Dare`;
      if (winnerTextEl) winnerTextEl.textContent = 'Round Complete!';
      if (bannerEl) bannerEl.textContent = '🎉';
      const mins2 = Math.floor(playedSeconds / 60);
      const secs2 = playedSeconds % 60;
      const durationStr2 = mins2 > 0 ? `${mins2}m ${secs2}s` : `${secs2}s`;
      if (metaEl) metaEl.textContent = `Played for ${durationStr2}`;
      this.resultModalEl.classList.add('active');
      return;
    }

    if (valAEl) valAEl.textContent = scores.peerA || 0;
    if (valBEl) valBEl.textContent = scores.peerB || 0;

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

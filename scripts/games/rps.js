// AirPlay Game 3 — Rock-Paper-Scissors Showdown (Full Redesign with Black Box Hiding & Start Button)

class RPSGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    this.roundState = 'READY'; // 'READY', 'LOCKING', 'REVEAL', 'ROUND_END'
    this.localGesture = 'NONE';
    this.peerGesture = 'NONE';
    this.roundWinner = null;

    this.dwellStart = null;
    this.dwellTime = 500;
    this.gameTimer = 90;
    this.isUnlimitedTimer = false;
    this.timerInterval = null;
    this.isRunning = false;

    // Draggable / Resizable Hiding Black Box for local player (normalized 0..1)
    this.myBox = { x: 0.1, y: 0.52, w: 0.35, h: 0.3 };
    this.peerBox = null; // Received from peer via network

    this.isDragging = false;
    this.isResizing = false;
    this.dragOffset = { x: 0, y: 0 };
    this.touchStartDist = 0;

    this.sensitivityP1 = 1.0;
    this.sensitivityP2 = 1.0;

    this.setupPointerListeners();
  }

  start(canvas, syncEngine, timerSetting = 90, extraSettings = null) {
    this.sync = syncEngine;
    this.canvas = canvas;
    this.roundState = 'READY';
    this.localGesture = 'NONE';
    this.peerGesture = 'NONE';
    this.roundWinner = null;
    this.dwellStart = null;

    if (extraSettings) {
      if (extraSettings.sensP1) this.sensitivityP1 = extraSettings.sensP1;
      if (extraSettings.sensP2) this.sensitivityP2 = extraSettings.sensP2;
    }

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
          this.checkRoundResolution();
        }
      });
      this.sync.listen('game/rpsStart', (data) => {
        if (data && data.startedAt) {
          this.beginRoundLocking();
        }
      });
      const peerRole = this.sync.peerRole === 'peerA' ? 'peerB' : 'peerA';
      this.sync.listen(`game/rpsBox_${peerRole}`, (boxData) => {
        if (boxData) this.peerBox = boxData;
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
    this.roundState = 'ROUND_END';
    if (this.timerInterval) clearInterval(this.timerInterval);
    clearTimeout(this._waitTimeout);
  }

  beginRoundLocking() {
    this.roundState = 'LOCKING';
    this.localGesture = 'NONE';
    this.peerGesture = 'NONE';
    this.roundWinner = null;
    this.dwellStart = null;

    if (!this.sync) {
      this.botPreCommittedGesture = ['ROCK', 'PAPER', 'SCISSORS'][Math.floor(Math.random() * 3)];
    }
  }

  triggerStartRound() {
    if (this.roundState !== 'READY') return;
    this.beginRoundLocking();
    if (this.sync) {
      this.sync.write('game/rpsStart', { startedAt: Date.now() });
    }
  }

  setupPointerListeners() {
    const onDown = (e) => {
      if (!this.isRunning || (this.roundState !== 'READY' && this.roundState !== 'LOCKING')) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;

      const handleX = this.myBox.x + this.myBox.w;
      const handleY = this.myBox.y + this.myBox.h;

      // Check if user clicked/touched resize handle (bottom-right corner)
      if (Math.abs(px - handleX) < 0.06 && Math.abs(py - handleY) < 0.06) {
        this.isResizing = true;
        e.preventDefault();
        return;
      }

      // Check if user clicked/touched inside box to drag
      if (px >= this.myBox.x && px <= this.myBox.x + this.myBox.w && py >= this.myBox.y && py <= this.myBox.y + this.myBox.h) {
        this.isDragging = true;
        this.dragOffset = { x: px - this.myBox.x, y: py - this.myBox.y };
        e.preventDefault();
      }
    };

    const onMove = (e) => {
      if (!this.isRunning) return;
      const rect = this.canvas.getBoundingClientRect();
      const px = (e.clientX - rect.left) / rect.width;
      const py = (e.clientY - rect.top) / rect.height;

      if (this.isResizing) {
        this.myBox.w = Math.max(0.18, Math.min(0.6, px - this.myBox.x));
        this.myBox.h = Math.max(0.18, Math.min(0.6, py - this.myBox.y));
        this.broadcastMyBox();
      } else if (this.isDragging) {
        this.myBox.x = Math.max(0.02, Math.min(0.98 - this.myBox.w, px - this.dragOffset.x));
        this.myBox.y = Math.max(0.08, Math.min(0.92 - this.myBox.h, py - this.dragOffset.y));
        this.broadcastMyBox();
      }
    };

    const onUp = () => {
      this.isDragging = false;
      this.isResizing = false;
    };

    window.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  broadcastMyBox() {
    if (this.sync) {
      this.sync.write(`game/rpsBox_${this.sync.peerRole}`, this.myBox);
    }
  }

  render(ctx, width, height, localFingertip, peerFingertip) {
    if (!this.isRunning) return;

    const myRole = this.sync ? this.sync.peerRole : 'peerA';
    const cx = width / 2;
    const cy = height / 2;

    // Gesture detection during LOCKING state (only if hand is inside black box!)
    if (window.activeHandTracker && this.roundState === 'LOCKING' && localFingertip) {
      const hx = localFingertip.x;
      const hy = localFingertip.y;
      const isInsideBox = hx >= this.myBox.x && hx <= this.myBox.x + this.myBox.w &&
                          hy >= this.myBox.y && hy <= this.myBox.y + this.myBox.h;

      if (isInsideBox) {
        const detected = window.activeHandTracker.detectedGesture || 'NONE';
        if (detected !== 'NONE') {
          this.localGesture = detected;
          if (!this.dwellStart) {
            this.dwellStart = performance.now();
          } else if (performance.now() - this.dwellStart >= this.dwellTime) {
            this.lockInGesture(myRole);
          }
        } else {
          this.dwellStart = null;
        }
      } else {
        this.dwellStart = null;
      }
    }

    ctx.save();

    // Render Movable / Resizable Black Boxes during READY and LOCKING states
    if (this.roundState === 'READY' || this.roundState === 'LOCKING') {
      this.drawBlackBox(ctx, this.myBox, width, height, true);

      // Render Opponent's Black Box on opponent's video tile to block visibility
      if (this.peerBox) {
        this.drawBlackBox(ctx, this.peerBox, width, height, false);
      }
    }

    // Render UI according to state
    if (this.roundState === 'READY') {
      // Start Button
      const bx = cx;
      const by = cy + 120;
      const btnW = 200;
      const btnH = 50;

      ctx.beginPath();
      ctx.roundRect(bx - btnW / 2, by - btnH / 2, btnW, btnH, 25);
      ctx.fillStyle = 'rgba(0, 242, 254, 0.9)';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = 15;
      ctx.fill();

      ctx.font = `800 ${scaleFont(ctx.canvas, 20)}px Outfit, sans-serif`;
      ctx.fillStyle = '#040914';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▶ START ROUND', bx, by);

      // Check if user tapped / clicked Start button via fingertip
      if (localFingertip) {
        const fx = localFingertip.px;
        const fy = localFingertip.py;
        if (Math.abs(fx - bx) < btnW / 2 && Math.abs(fy - by) < btnH / 2) {
          this.triggerStartRound();
        }
      }
    } else if (this.roundState === 'LOCKING') {
      ctx.font = `700 ${scaleFont(ctx.canvas, 26)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Form Hand Sign Under Your Box!', cx, cy - 80);

      if (this.localGesture !== 'NONE') {
        ctx.font = `700 ${scaleFont(ctx.canvas, 22)}px Outfit, sans-serif`;
        ctx.fillStyle = '#00f2fe';
        ctx.fillText(`Holding: ${this.localGesture}`, cx, cy - 40);
      }

      if (this.dwellStart) {
        const progress = Math.min((performance.now() - this.dwellStart) / this.dwellTime, 1.0);
        ctx.beginPath();
        ctx.arc(cx, cy, 45, -Math.PI / 2, -Math.PI / 2 + progress * 2 * Math.PI);
        ctx.strokeStyle = '#00f2fe';
        ctx.lineWidth = 6;
        ctx.stroke();
      }
    } else if (this.roundState === 'REVEAL') {
      const gestureEmoji = { ROCK: '✊ ROCK', PAPER: '✋ PAPER', SCISSORS: '✌️ SCISSORS', NONE: '❓ NONE' };

      ctx.font = `700 ${scaleFont(ctx.canvas, 24)}px Outfit, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff0844';
      ctx.fillText(`You: ${gestureEmoji[this.localGesture] || 'NONE'}`, cx, cy - 50);

      ctx.fillStyle = '#00f2fe';
      ctx.fillText(`Opponent: ${gestureEmoji[this.peerGesture] || 'NONE'}`, cx, cy - 10);

      ctx.font = `900 ${scaleFont(ctx.canvas, 38)}px Outfit, sans-serif`;
      ctx.fillStyle = '#ffffff';

      let resultText = 'Waiting for opponent…';
      if (this.roundWinner === 'DRAW') resultText = 'DRAW!';
      else if (this.roundWinner === myRole) resultText = 'YOU WIN ROUND! 🎉';
      else if (this.roundWinner) resultText = 'OPPONENT WINS ROUND!';

      wrapCanvasText(ctx, resultText, cx, cy + 50, width - 40, scaleFont(ctx.canvas, 42));
    }

    ctx.restore();
  }

  drawBlackBox(ctx, box, width, height, isMine) {
    const bx = box.x * width;
    const by = box.y * height;
    const bw = box.w * width;
    const bh = box.h * height;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 12);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.96)';
    ctx.fill();

    ctx.strokeStyle = isMine ? 'rgba(0, 242, 254, 0.6)' : 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.setLineDash(isMine ? [6, 4] : []);
    ctx.stroke();

    if (isMine) {
      // Helper text inside box
      ctx.font = '600 13px Outfit, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Hide your hand under this box', bx + bw / 2, by + bh / 2 - 8);
      ctx.font = '400 11px Outfit, sans-serif';
      ctx.fillStyle = 'rgba(0, 242, 254, 0.8)';
      ctx.fillText('(Drag to move · Corner to resize)', bx + bw / 2, by + bh / 2 + 12);

      // Resize handle on bottom-right corner
      ctx.beginPath();
      ctx.arc(bx + bw - 10, by + bh - 10, 8, 0, 2 * Math.PI);
      ctx.fillStyle = '#00f2fe';
      ctx.fill();
    }

    ctx.restore();
  }

  lockInGesture(myRole) {
    this.roundState = 'REVEAL';
    if (window.SoundFx) window.SoundFx.playHit();

    if (this.sync) {
      this.sync.write('game/rpsGesture', { role: myRole, gesture: this.localGesture });

      clearTimeout(this._waitTimeout);
      this._waitTimeout = setTimeout(() => {
        if (this.roundState === 'REVEAL' && !this.roundWinner) {
          this.localGesture = 'NONE';
          this.peerGesture = 'NONE';
          this.dwellStart = null;
          this.roundState = 'READY';
        }
      }, 6000);
    } else {
      this.peerGesture = this.botPreCommittedGesture || ['ROCK', 'PAPER', 'SCISSORS'][Math.floor(Math.random() * 3)];
      this.checkRoundResolution();
    }
  }

  checkRoundResolution() {
    if (this.localGesture === 'NONE' || this.peerGesture === 'NONE') return;
    clearTimeout(this._waitTimeout);

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

    // Reset to READY state after 3.5 seconds so Start button reappears for next round
    setTimeout(() => {
      if (this.roundState === 'REVEAL') {
        this.localGesture = 'NONE';
        this.peerGesture = 'NONE';
        this.dwellStart = null;
        this.roundState = 'READY';
      }
    }, 3500);
  }
}

window.RPSGame = RPSGame;

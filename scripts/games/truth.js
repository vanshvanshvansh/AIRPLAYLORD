// AirPlay Game 5 — Truth or Dare: Air Spin (Compact Bottle & Minimized Task Panel System)

class TruthGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    this.angle = 0;
    this.angularVelocity = 0;
    this.isSpinning = false;
    this.targetAngle = 0;
    this.selectedPlayer = null;

    this.choiceState = 'IDLE'; // 'IDLE', 'CHOOSING', 'PROMPT_ACTIVE'
    this.chosenType = null;
    this.currentPrompt = null;
    this.isTaskMinimized = false;
    this.minimizedPillEl = null;

    this.dwellStartTruth = null;
    this.dwellStartDare = null;

    this.PLAYER_COLORS = { peerA: '#ff0844', peerB: '#2979ff' };
    this.PLAYER_LABELS = { peerA: 'P1 (Red)', peerB: 'P2 (Blue)' };

    this.tdCounts = {
      peerA: { truth: 0, dare: 0 },
      peerB: { truth: 0, dare: 0 }
    };

    this.customTruthTags = [];
    this.customDareTags = [];
    this.useCustomOnly = false;

    this.askedQuestions = {
      peerA: new Set(),
      peerB: new Set()
    };

    this.defaultPrompts = {
      LIGHT: {
        TRUTH: [
          "What is your most used emoji and why?",
          "What is the funniest thing that happened to you this week?",
          "If you could teleport anywhere right now, where would you go?",
          "What song do you secretly know all the words to?",
          "What is your favorite guilty pleasure snack?"
        ],
        DARE: [
          "Do your best impression of a famous celebrity for 10 seconds!",
          "Show the last photo in your camera roll.",
          "Speak in a dramatic whisper for the next round.",
          "Balance an object on your head for 15 seconds without dropping it.",
          "Make a funny face and hold it for 5 seconds!"
        ]
      }
    };
  }

  start(canvas, syncEngine) {
    this.sync = syncEngine;
    this.tdCounts = { peerA: { truth: 0, dare: 0 }, peerB: { truth: 0, dare: 0 } };
    this.resetTurnState();

    if (this.sync) {
      if (this.sync.isHost) {
        this.sync.listen('game/spinTrigger', (data) => { if (data) this.triggerSpin(); });
      }
      this.sync.listen('game/bottleAngle', (angle) => {
        if (typeof angle === 'number' && !this.sync.isHost) {
          this.targetAngle = angle;
        }
      });
      this.sync.listen('game/truthState', (stateData) => {
        if (stateData) {
          this.choiceState = stateData.choiceState;
          this.chosenType = stateData.chosenType;
          this.currentPrompt = stateData.currentPrompt;
          this.selectedPlayer = stateData.selectedPlayer;
          if (stateData.tdCounts) this.tdCounts = stateData.tdCounts;
          if (stateData.isTaskMinimized !== undefined) {
            this.setTaskMinimizedLocally(stateData.isTaskMinimized);
          }
        }
      });
      this.sync.listen('game/customQuestions', (data) => {
        if (data) this.syncCustomQuestions(data);
      });
    }
  }

  syncCustomQuestions(data) {
    if (data.truth) this.customTruthTags = Array.from(new Set([...this.customTruthTags, ...data.truth]));
    if (data.dare) this.customDareTags = Array.from(new Set([...this.customDareTags, ...data.dare]));
    if (data.useCustomOnly !== undefined) this.useCustomOnly = data.useCustomOnly;
  }

  resetTurnState() {
    this.angle = 0;
    this.angularVelocity = 0;
    this.isSpinning = false;
    this.choiceState = 'IDLE';
    this.chosenType = null;
    this.currentPrompt = null;
    this.dwellStartTruth = null;
    this.dwellStartDare = null;
    this.setTaskMinimizedLocally(false);
    this.removeMinimizedPill();

    if (this.sync) {
      this.sync.write('game/truthState', {
        choiceState: 'IDLE',
        chosenType: null,
        currentPrompt: null,
        selectedPlayer: null,
        isTaskMinimized: false
      });
    }
  }

  stop() {
    this.isSpinning = false;
    this.removeMinimizedPill();
  }

  triggerSpin() {
    if (this.isSpinning) return;
    this.removeMinimizedPill();
    this.isTaskMinimized = false;
    this.isSpinning = true;
    this.choiceState = 'IDLE';
    this.currentPrompt = null;
    this.angularVelocity = 0.35 + Math.random() * 0.45;
    if (window.SoundFx) window.SoundFx.playHit();
  }

  render(ctx, width, height, localFingertip, peerFingertip) {
    const cx = width / 2;
    const cy = height / 2;

    if (this.isSpinning) {
      this.angle += this.angularVelocity;
      this.angularVelocity *= 0.97;

      if (this.sync && this.sync.isHost) {
        this.sync.write('game/bottleAngle', this.angle);
      }

      if (this.angularVelocity < 0.002) {
        this.isSpinning = false;
        this.angularVelocity = 0;
        this.determineLandingPlayer();
      }
    } else if (this.sync && !this.sync.isHost) {
      this.angle = SyncEngine.lerp(this.angle, this.targetAngle, 0.15);
    }

    // Render Compact Spinner Circle & Bottle (Only when IDLE or CHOOSING, or when task is MINIMIZED)
    const showBottle = this.choiceState === 'IDLE' || this.choiceState === 'CHOOSING' || this.isTaskMinimized || this.isSpinning;

    if (showBottle) {
      this.renderSelectorRing(ctx, cx, cy);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.angle);

      // Reduced size bottle silhouette (~110px height, 28px width) so it never covers face tiles
      ctx.beginPath();
      ctx.moveTo(-14, 55);
      ctx.lineTo(-14, 6);
      ctx.quadraticCurveTo(-14, -20, -6, -32);
      ctx.lineTo(-6, -55);
      ctx.lineTo(6, -55);
      ctx.lineTo(6, -32);
      ctx.quadraticCurveTo(14, -20, 14, 6);
      ctx.lineTo(14, 55);
      ctx.quadraticCurveTo(14, 62, 8, 62);
      ctx.lineTo(-8, 62);
      ctx.quadraticCurveTo(-14, 62, -14, 55);
      ctx.closePath();

      const glassGrad = ctx.createLinearGradient(-14, 0, 14, 0);
      glassGrad.addColorStop(0, 'rgba(0, 200, 210, 0.65)');
      glassGrad.addColorStop(0.5, 'rgba(180, 250, 255, 0.95)');
      glassGrad.addColorStop(1, 'rgba(0, 150, 170, 0.65)');
      ctx.fillStyle = glassGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Bottle Label
      ctx.beginPath();
      ctx.roundRect(-14, 10, 28, 18, 3);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
      ctx.font = '800 8px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff0844';
      ctx.fillText('AIRPLAY', 0, 22);

      // Cap
      ctx.beginPath();
      ctx.roundRect(-7, -64, 14, 10, 3);
      ctx.fillStyle = '#ff0844';
      ctx.fill();

      ctx.restore();
    }

    // Render Turn Flow UI
    if (!this.isSpinning && this.choiceState === 'IDLE') {
      ctx.font = '700 20px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Tap / Hover Bottle to Spin!', cx, cy + 120);

      if (localFingertip) {
        const fx = localFingertip.px;
        const fy = localFingertip.py;
        if (Math.sqrt((fx - cx) ** 2 + (fy - cy) ** 2) < 70) {
          if (this.sync) this.sync.write('game/spinTrigger', true);
          else this.triggerSpin();
        }
      }
    } else if (this.choiceState === 'CHOOSING') {
      this.renderChoiceButtons(ctx, width, height, localFingertip);
    } else if (this.choiceState === 'PROMPT_ACTIVE' && !this.isTaskMinimized) {
      this.renderPromptCard(ctx, cx, cy, localFingertip);
    }
  }

  // Compact Selector Ring (Radius 85px)
  renderSelectorRing(ctx, cx, cy) {
    const r = 85;
    ctx.save();

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(41, 121, 255, 0.16)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, Math.PI / 2, 3 * Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 8, 68, 0.16)';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '800 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.PLAYER_COLORS.peerA;
    ctx.fillText('RED · P1', cx - r + 24, cy);
    ctx.fillStyle = this.PLAYER_COLORS.peerB;
    ctx.fillText('BLUE · P2', cx + r - 24, cy);

    ctx.restore();
  }

  determineLandingPlayer() {
    const normAngle = (this.angle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    this.selectedPlayer = normAngle > Math.PI ? 'peerA' : 'peerB';
    this.choiceState = 'CHOOSING';

    if (this.sync && this.sync.isHost) {
      this.sync.write('game/truthState', {
        choiceState: this.choiceState,
        selectedPlayer: this.selectedPlayer
      });
    }
  }

  renderChoiceButtons(ctx, width, height, localFingertip) {
    const cx = width / 2;
    const cy = height / 2 + 100;
    const now = performance.now();

    const isMyTurn = !this.sync || this.sync.peerRole === this.selectedPlayer;

    ctx.font = `700 ${scaleFont(ctx.canvas, 22)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.PLAYER_COLORS[this.selectedPlayer] || '#ffffff';
    const label = this.PLAYER_LABELS[this.selectedPlayer] || 'Player';
    wrapCanvasText(ctx, `${label} — Choose Truth or Dare!`, cx, cy - 40, width - 40, scaleFont(ctx.canvas, 24));

    if (!isMyTurn) {
      ctx.font = `600 ${scaleFont(ctx.canvas, 15)}px Outfit, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText("Waiting for their pick…", cx, cy - 16);
    }

    const btnOffset = Math.min(100, width * 0.22);
    const tx = cx - btnOffset;
    const ty = cy;
    ctx.beginPath();
    ctx.arc(tx, ty, 42, 0, 2 * Math.PI);
    ctx.fillStyle = '#00f2fe';
    ctx.fill();
    ctx.font = `700 ${scaleFont(ctx.canvas, 16)}px Outfit, sans-serif`;
    ctx.fillStyle = '#040914';
    ctx.fillText('TRUTH', tx, ty + 5);

    const dx = cx + btnOffset;
    const dy = cy;
    ctx.beginPath();
    ctx.arc(dx, dy, 42, 0, 2 * Math.PI);
    ctx.fillStyle = '#ff0844';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText('DARE', dx, dy + 5);

    if (localFingertip && isMyTurn) {
      const fx = localFingertip.px;
      const fy = localFingertip.py;

      if (Math.sqrt((fx - tx) ** 2 + (fy - ty) ** 2) < 42) {
        if (!this.dwellStartTruth) this.dwellStartTruth = now;
        else if (now - this.dwellStartTruth >= 500) this.selectChoice('TRUTH');
      } else {
        this.dwellStartTruth = null;
      }

      if (Math.sqrt((fx - dx) ** 2 + (fy - dy) ** 2) < 42) {
        if (!this.dwellStartDare) this.dwellStartDare = now;
        else if (now - this.dwellStartDare >= 500) this.selectChoice('DARE');
      } else {
        this.dwellStartDare = null;
      }
    } else {
      this.dwellStartTruth = null;
      this.dwellStartDare = null;
    }
  }

  selectChoice(type) {
    this.chosenType = type;
    const targetPlayer = this.selectedPlayer || 'peerA';

    let availableList = [];
    if (type === 'TRUTH') {
      availableList = (this.useCustomOnly && this.customTruthTags.length > 0)
        ? [...this.customTruthTags]
        : [...this.defaultPrompts.LIGHT.TRUTH, ...this.customTruthTags];
    } else {
      availableList = (this.useCustomOnly && this.customDareTags.length > 0)
        ? [...this.customDareTags]
        : [...this.defaultPrompts.LIGHT.DARE, ...this.customDareTags];
    }

    let freshList = availableList.filter(q => !this.askedQuestions[targetPlayer].has(q));
    if (freshList.length === 0) {
      this.askedQuestions[targetPlayer].clear();
      freshList = availableList;
    }

    const chosenQuestion = freshList[Math.floor(Math.random() * freshList.length)] || "Have fun!";
    this.askedQuestions[targetPlayer].add(chosenQuestion);

    this.currentPrompt = chosenQuestion;
    this.choiceState = 'PROMPT_ACTIVE';
    this.isTaskMinimized = false;

    if (!this.tdCounts[targetPlayer]) this.tdCounts[targetPlayer] = { truth: 0, dare: 0 };
    this.tdCounts[targetPlayer][type === 'TRUTH' ? 'truth' : 'dare']++;

    if (this.sync) {
      this.sync.write('game/truthState', {
        choiceState: this.choiceState,
        chosenType: this.chosenType,
        currentPrompt: this.currentPrompt,
        selectedPlayer: this.selectedPlayer,
        tdCounts: this.tdCounts,
        isTaskMinimized: false
      });
    }
  }

  renderPromptCard(ctx, cx, cy, localFingertip) {
    ctx.save();
    const boxWidth = Math.min(500, ctx.canvas.width - 40);
    const boxHeight = 175;
    const topY = cy - boxHeight / 2;

    // Main Card Background
    ctx.beginPath();
    ctx.roundRect(cx - boxWidth / 2, topY, boxWidth, boxHeight, 20);
    ctx.fillStyle = 'rgba(14, 20, 32, 0.95)';
    ctx.strokeStyle = this.chosenType === 'TRUTH' ? '#00f2fe' : '#ff0844';
    ctx.lineWidth = 2.5;
    ctx.fill();
    ctx.stroke();

    // Title
    ctx.font = `700 ${scaleFont(ctx.canvas, 20)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.chosenType === 'TRUTH' ? '#00f2fe' : '#ff0844';
    ctx.fillText(`${this.chosenType}:`, cx, topY + 36);

    // Question Text
    ctx.font = `500 ${scaleFont(ctx.canvas, 16)}px Outfit, sans-serif`;
    ctx.fillStyle = '#ffffff';
    wrapCanvasText(ctx, this.currentPrompt || '', cx, topY + 72, boxWidth - 40, scaleFont(ctx.canvas, 20));

    // Minimize Button [ _ Minimize ] at top-right corner of card
    const minBtnX = cx + boxWidth / 2 - 54;
    const minBtnY = topY + 24;
    ctx.beginPath();
    ctx.roundRect(minBtnX - 42, minBtnY - 14, 84, 28, 14);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.fill();
    ctx.stroke();

    ctx.font = '600 12px Outfit, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('— Minimize', minBtnX, minBtnY);

    // Next Spin Button at bottom center of card
    const spinBtnY = topY + boxHeight - 24;
    ctx.beginPath();
    ctx.roundRect(cx - 75, spinBtnY - 14, 150, 28, 14);
    ctx.fillStyle = 'rgba(0, 242, 254, 0.2)';
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    ctx.font = '700 13px Outfit, sans-serif';
    ctx.fillStyle = '#00f2fe';
    ctx.fillText('🔄 SPIN AGAIN', cx, spinBtnY);

    // Interaction checks (minimize & spin again)
    if (localFingertip) {
      const fx = localFingertip.px;
      const fy = localFingertip.py;

      // Minimize tap
      if (Math.abs(fx - minBtnX) < 42 && Math.abs(fy - minBtnY) < 14) {
        this.minimizeTask();
      }

      // Spin again tap
      if (Math.abs(fx - cx) < 75 && Math.abs(fy - spinBtnY) < 14) {
        this.resetTurnState();
      }
    }

    ctx.restore();
  }

  minimizeTask() {
    this.setTaskMinimizedLocally(true);
    if (this.sync) {
      this.sync.write('game/truthState', {
        choiceState: this.choiceState,
        chosenType: this.chosenType,
        currentPrompt: this.currentPrompt,
        selectedPlayer: this.selectedPlayer,
        tdCounts: this.tdCounts,
        isTaskMinimized: true
      });
    }
  }

  setTaskMinimizedLocally(minimized) {
    this.isTaskMinimized = minimized;
    if (minimized && this.currentPrompt) {
      this.showMinimizedPill();
    } else {
      this.removeMinimizedPill();
    }
  }

  showMinimizedPill() {
    if (!this.minimizedPillEl) {
      const pill = document.createElement('div');
      pill.className = `minimized-task-pill ${this.chosenType === 'DARE' ? 'dare-pill' : ''}`;
      pill.onclick = () => {
        this.setTaskMinimizedLocally(false);
        if (this.sync) {
          this.sync.write('game/truthState', {
            choiceState: this.choiceState,
            chosenType: this.chosenType,
            currentPrompt: this.currentPrompt,
            selectedPlayer: this.selectedPlayer,
            tdCounts: this.tdCounts,
            isTaskMinimized: false
          });
        }
      };
      document.body.appendChild(pill);
      this.minimizedPillEl = pill;
    }

    const icon = this.chosenType === 'TRUTH' ? '🔍 Truth:' : '🎯 Dare:';
    this.minimizedPillEl.textContent = `${icon} "${this.currentPrompt}" (Tap to open)`;
    this.minimizedPillEl.style.display = 'flex';
  }

  removeMinimizedPill() {
    if (this.minimizedPillEl) {
      this.minimizedPillEl.remove();
      this.minimizedPillEl = null;
    }
  }
}

window.TruthGame = TruthGame;

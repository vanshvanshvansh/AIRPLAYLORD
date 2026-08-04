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

    // Time-based spin physics (frame-rate independent — the old velocity-
    // decay-per-frame approach ran up to ~20s on slower devices, since
    // fewer frames per second meant fewer decay steps per real second).
    this.spinStartTime = 0;
    this.spinDuration = 0;
    this.spinStartAngle = 0;
    this.spinTargetAngle = 0;
    this._spinTapArmed = true; // guards against writing spinTrigger every frame while hovering

    this.choiceState = 'IDLE'; // 'IDLE', 'CHOOSING', 'PROMPT_ACTIVE'
    this.chosenType = null;
    this.currentPrompt = null;
    this.isTaskMinimized = false;
    this.minimizedPillEl = null;
    this.spinAgainBtnEl = null;

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
    this._spinTapArmed = true;
    this.setTaskMinimizedLocally(false);
    this.removeMinimizedPill();
    this.removeSpinAgainButton();

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
    this.removeSpinAgainButton();
  }

  triggerSpin() {
    if (this.isSpinning) return;
    this.removeMinimizedPill();
    this.removeSpinAgainButton();
    this.isTaskMinimized = false;
    this.isSpinning = true;
    this.choiceState = 'IDLE';
    this.currentPrompt = null;

    // Time-based spin (frame-rate independent): always finishes within
    // 3.2s-4.7s (hard cap under the 5s max), and the landing angle is
    // pre-committed here — biased well inside one player's half so the
    // bottle can never rest ambiguously near the Red/Blue boundary.
    this.spinStartTime = performance.now();
    this.spinDuration = 3200 + Math.random() * 1500;
    this.spinStartAngle = this.angle;

    const extraTurns = 4 + Math.random() * 3; // 4-7 full extra rotations
    const targetPlayer = Math.random() < 0.5 ? 'peerA' : 'peerB';
    const SAFE_MARGIN = 0.35; // radians (~20°) kept clear of the 0/PI boundary on each side
    const halfStart = targetPlayer === 'peerA' ? Math.PI : 0;
    const usableSpan = Math.PI - SAFE_MARGIN * 2;
    const landingAngleNorm = halfStart + SAFE_MARGIN + Math.random() * usableSpan;

    const currentNorm = ((this.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    let deltaToLanding = landingAngleNorm - currentNorm;
    if (deltaToLanding < 0) deltaToLanding += 2 * Math.PI;
    this.spinTargetAngle = this.angle + extraTurns * 2 * Math.PI + deltaToLanding;

    if (window.SoundFx) window.SoundFx.playHit();
  }

  render(ctx, width, height, localFingertip, peerFingertip) {
    const cx = width / 2;
    const cy = height / 2;

    if (this.isSpinning) {
      const elapsed = performance.now() - this.spinStartTime;
      const t = Math.min(elapsed / this.spinDuration, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic — fast start, gentle stop
      this.angle = this.spinStartAngle + (this.spinTargetAngle - this.spinStartAngle) * eased;

      if (this.sync && this.sync.isHost) {
        this.sync.write('game/bottleAngle', this.angle);
      }

      if (t >= 1) {
        this.isSpinning = false;
        this.angle = this.spinTargetAngle;
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
          if (this._spinTapArmed) {
            this._spinTapArmed = false;
            // BUGFIX (bottle sometimes never spins, for either player):
            // this used to write a constant `true`. Firebase's 'value'
            // listener only fires on an actual data change — writing the
            // exact same value again (which happens whenever the previous
            // round's spinTrigger was also `true`) produced no event at
            // all on the host, so the tap silently did nothing. A unique
            // timestamp guarantees the value always changes, so the host
            // always receives the trigger and always spins.
            if (this.sync) this.sync.write('game/spinTrigger', Date.now());
            else this.triggerSpin();
          }
        } else {
          this._spinTapArmed = true;
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

    // NOTE: the "Spin Again" button used to live here, but an accidental
    // tap on it while reading the task would silently end the turn early.
    // It now only appears (as a separate on-screen button) once this task
    // has been minimized — see showSpinAgainButton().
    ctx.font = '500 12px Outfit, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fillText('Minimize to spin again', cx, topY + boxHeight - 20);

    // Interaction check (minimize only)
    if (localFingertip) {
      const fx = localFingertip.px;
      const fy = localFingertip.py;

      if (Math.abs(fx - minBtnX) < 42 && Math.abs(fy - minBtnY) < 14) {
        this.minimizeTask();
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
      // "Spin Again" only ever appears once the task has been minimized
      // (i.e. tucked away / marked done with) — never while the task
      // popup itself is open, so it can't be tapped by accident.
      this.showSpinAgainButton();
    } else {
      this.removeMinimizedPill();
      this.removeSpinAgainButton();
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

  showSpinAgainButton() {
    if (!this.spinAgainBtnEl) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'truth-spin-again-btn';
      btn.textContent = '🔄 Spin Again';
      btn.onclick = () => this.spinAgainFromMinimized();
      document.body.appendChild(btn);
      this.spinAgainBtnEl = btn;
    }
    this.spinAgainBtnEl.style.display = 'flex';
  }

  removeSpinAgainButton() {
    if (this.spinAgainBtnEl) {
      this.spinAgainBtnEl.remove();
      this.spinAgainBtnEl = null;
    }
  }

  // Reliably starts a fresh spin from the minimized state — routed through
  // the same host-authoritative spinTrigger path (with a unique timestamp,
  // see the IDLE tap handler above) that the bottle tap itself uses, so it
  // works the same way regardless of which player taps it.
  spinAgainFromMinimized() {
    this.removeMinimizedPill();
    this.removeSpinAgainButton();
    this.resetTurnState();
    if (this.sync) this.sync.write('game/spinTrigger', Date.now());
    else this.triggerSpin();
  }
}

window.TruthGame = TruthGame;

// AirPlay Game 5 — Truth or Dare: Air Spin (Compact Bottle & Glassy Minimized Task Panel)

class TruthGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    this.angle = 0;
    this.angularVelocity = 0;
    this.isSpinning = false;
    this.targetAngle = 0;
    this.selectedPlayer = null;

    this.spinStartTime = 0;
    this.spinDuration = 0;
    this.spinStartAngle = 0;
    this.spinTargetAngle = 0;
    this._spinTapArmed = true;

    this.choiceState = 'IDLE'; // 'IDLE', 'CHOOSING', 'PROMPT_ACTIVE'
    this.chosenType = null;
    this.currentPrompt = null;

    this.dwellStartTruth = null;
    this.dwellStartDare = null;
    this.dwellStartTaskDone = null;

    this.isPointerDown = false;
    this.pointerPos = null;

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

    // Small "add more questions" banner state — shown once when every
    // question in the current pool has been asked to BOTH players, reset
    // whenever the question list changes.
    this._poolExhaustedShown = false;
    this._poolExhaustedAt = 0;

    // Anti-glitch "armed" gates for dwell-to-select UI (see renderChoiceButtons
    // and renderPromptCard). A dwell timer is only allowed to START counting
    // once the fingertip has been OFF the button at least one frame after a
    // new screen appears — this stops a finger left resting from the
    // previous screen from instantly counting toward the next action.
    this._choiceArmed = true;
    this._promptHoldArmed = true;

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

    this.setupPointerListeners();
  }

  setupPointerListeners() {
    if (this._pointerBound) return;
    this._pointerBound = true;

    const handleDown = (e) => {
      this.isPointerDown = true;
      this.pointerPos = { x: e.clientX, y: e.clientY };
    };

    const handleMove = (e) => {
      if (this.isPointerDown) {
        this.pointerPos = { x: e.clientX, y: e.clientY };
      }
    };

    const handleUp = () => {
      this.isPointerDown = false;
      this.pointerPos = null;
      this.dwellStartTaskDone = null;
    };

    window.addEventListener('pointerdown', handleDown);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }

  start(canvas, syncEngine, timerSetting = 90, extraSettings = null) {
    this.sync = syncEngine;
    this.tdCounts = { peerA: { truth: 0, dare: 0 }, peerB: { truth: 0, dare: 0 } };
    this.sensitivity = (extraSettings && extraSettings.sensitivity) ? parseFloat(extraSettings.sensitivity) : 1.0;
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
          // Use our own clock for the fade timer — the sender's
          // performance.now() timestamp isn't meaningful on this device.
          if (stateData.poolExhaustedAt && !this._poolExhaustedShown) {
            this._poolExhaustedShown = true;
            this._poolExhaustedAt = performance.now();
          }
        }
      });
      this.sync.listen('game/customQuestions', (data) => {
        if (data) this.syncCustomQuestions(data);
      });
    }
  }

  syncCustomQuestions(data) {
    // Every save sends the FULL current list, so the receiving side must
    // REPLACE its list with it, not merge/union. Merging meant a question
    // removed on one phone could never actually disappear on the other —
    // it just kept getting re-added back in on every future save.
    if (Array.isArray(data.truth)) this.customTruthTags = [...data.truth];
    if (Array.isArray(data.dare)) this.customDareTags = [...data.dare];
    if (data.useCustomOnly !== undefined) this.useCustomOnly = data.useCustomOnly;
    this.notifyCustomQuestionsChanged();
  }

  // Called whenever the custom question pool changes (locally or via sync)
  // so a fresh "you've asked everything" banner can appear again later.
  notifyCustomQuestionsChanged() {
    this._poolExhaustedShown = false;
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
    this.dwellStartTaskDone = null;
    this._spinTapArmed = true;
    this._choiceArmed = true;
    this._promptHoldArmed = true;

    if (this.sync) {
      this.sync.write('game/truthState', {
        choiceState: 'IDLE',
        chosenType: null,
        currentPrompt: null,
        selectedPlayer: null
      });
    }
  }

  stop() {
    this.isSpinning = false;
  }

  triggerSpin() {
    if (this.isSpinning) return;
    this.isSpinning = true;
    this.choiceState = 'IDLE';
    this.currentPrompt = null;

    this.spinStartTime = performance.now();
    this.spinDuration = 3200 + Math.random() * 1500;
    this.spinStartAngle = this.angle;

    const extraTurns = 4 + Math.random() * 3;
    const targetPlayer = Math.random() < 0.5 ? 'peerA' : 'peerB';
    const SAFE_MARGIN = 0.35;
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
    const now = performance.now();

    if (this.isSpinning) {
      const elapsed = performance.now() - this.spinStartTime;
      const t = Math.min(elapsed / this.spinDuration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
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

    const showBottle = this.choiceState === 'IDLE' || this.choiceState === 'CHOOSING' || this.isSpinning;

    if (showBottle) {
      this.renderSelectorRing(ctx, cx, cy);

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(this.angle);

      // Compact Bottle Silhouette (~75px height, 20px width)
      ctx.beginPath();
      ctx.moveTo(-10, 38);
      ctx.lineTo(-10, 4);
      ctx.quadraticCurveTo(-10, -14, -4, -22);
      ctx.lineTo(-4, -38);
      ctx.lineTo(4, -38);
      ctx.lineTo(4, -22);
      ctx.quadraticCurveTo(10, -14, 10, 4);
      ctx.lineTo(10, 38);
      ctx.quadraticCurveTo(10, 43, 6, 43);
      ctx.lineTo(-6, 43);
      ctx.quadraticCurveTo(-10, 43, -10, 38);
      ctx.closePath();

      const glassGrad = ctx.createLinearGradient(-10, 0, 10, 0);
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
      ctx.roundRect(-10, 8, 20, 13, 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fill();
      ctx.font = '800 6px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff0844';
      ctx.fillText('AIRPLAY', 0, 17);

      // Cap
      ctx.beginPath();
      ctx.roundRect(-5, -44, 10, 7, 2);
      ctx.fillStyle = '#ff0844';
      ctx.fill();

      ctx.restore();
    }

    // Render Turn Flow UI
    if (!this.isSpinning && this.choiceState === 'IDLE') {
      ctx.font = '700 18px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Tap / Hover Bottle to Spin!', cx, cy + 95);

      const activePos = localFingertip ? { x: localFingertip.px, y: localFingertip.py } : (this.isPointerDown ? this.pointerPos : null);

      if (activePos) {
        const bottleHitRadius = 60 * (this.sensitivity || 1.0);
        if (Math.sqrt((activePos.x - cx) ** 2 + (activePos.y - cy) ** 2) < bottleHitRadius) {
          if (this._spinTapArmed) {
            this._spinTapArmed = false;
            if (this.sync) this.sync.write('game/spinTrigger', Date.now());
            else this.triggerSpin();
          }
        } else {
          this._spinTapArmed = true;
        }
      } else {
        this._spinTapArmed = true;
      }
    } else if (this.choiceState === 'CHOOSING') {
      this.renderChoiceButtons(ctx, width, height, localFingertip);
    } else if (this.choiceState === 'PROMPT_ACTIVE') {
      this.renderPromptCard(ctx, cx, cy, localFingertip, now);
    }

    this.renderExhaustionBanner(ctx, width, now);
  }

  // Small, brief "add more questions" banner — shown once the whole custom
  // question pool has been asked to both players.
  renderExhaustionBanner(ctx, width, now) {
    if (!this._poolExhaustedShown) return;
    const elapsed = now - this._poolExhaustedAt;
    const BANNER_DURATION = 3500;
    if (elapsed > BANNER_DURATION) return;

    const fadeOut = elapsed > BANNER_DURATION - 500 ? (BANNER_DURATION - elapsed) / 500 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, fadeOut));

    const text = "You've asked every question — please add more!";
    ctx.font = `600 ${scaleFont(ctx.canvas, 13)}px Outfit, sans-serif`;
    const padX = 14;
    const textWidth = ctx.measureText(text).width;
    const boxW = textWidth + padX * 2;
    const boxH = 30;
    const boxX = width / 2 - boxW / 2;
    const boxY = 14;

    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 15);
    ctx.fillStyle = 'rgba(12, 18, 32, 0.75)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, width / 2, boxY + boxH / 2 + 1);
    ctx.restore();
  }

  // Compact Selector Ring (Radius 60px)
  renderSelectorRing(ctx, cx, cy) {
    const r = 60;
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

    ctx.font = '800 10px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.PLAYER_COLORS.peerA;
    ctx.fillText('RED · P1', cx - r + 18, cy);
    ctx.fillStyle = this.PLAYER_COLORS.peerB;
    ctx.fillText('BLUE · P2', cx + r - 18, cy);

    ctx.restore();
  }

  determineLandingPlayer() {
    const normAngle = (this.angle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    this.selectedPlayer = normAngle > Math.PI ? 'peerA' : 'peerB';
    this.choiceState = 'CHOOSING';
    // Require the fingertip to be off both buttons at least once before a
    // hold can start counting — stops a finger left near the bottle from
    // instantly triggering a choice on this new screen.
    this._choiceArmed = false;
    this.dwellStartTruth = null;
    this.dwellStartDare = null;

    if (this.sync && this.sync.isHost) {
      this.sync.write('game/truthState', {
        choiceState: this.choiceState,
        selectedPlayer: this.selectedPlayer
      });
    }
  }

  renderChoiceButtons(ctx, width, height, localFingertip) {
    const cx = width / 2;
    const cy = height / 2 + 80;
    const now = performance.now();

    const isMyTurn = !this.sync || this.sync.peerRole === this.selectedPlayer;

    ctx.font = `700 ${scaleFont(ctx.canvas, 20)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.PLAYER_COLORS[this.selectedPlayer] || '#ffffff';
    const label = this.PLAYER_LABELS[this.selectedPlayer] || 'Player';
    wrapCanvasText(ctx, `${label} — Choose Truth or Dare!`, cx, cy - 40, width - 40, scaleFont(ctx.canvas, 22));

    if (!isMyTurn) {
      ctx.font = `600 ${scaleFont(ctx.canvas, 14)}px Outfit, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText("Waiting for their pick…", cx, cy - 16);
    }

    const btnOffset = Math.min(90, width * 0.2);
    const tx = cx - btnOffset;
    const ty = cy;
    ctx.beginPath();
    ctx.arc(tx, ty, 38, 0, 2 * Math.PI);
    ctx.fillStyle = '#00f2fe';
    ctx.fill();
    ctx.font = `700 ${scaleFont(ctx.canvas, 15)}px Outfit, sans-serif`;
    ctx.fillStyle = '#040914';
    ctx.fillText('TRUTH', tx, ty + 5);

    const dx = cx + btnOffset;
    const dy = cy;
    ctx.beginPath();
    ctx.arc(dx, dy, 38, 0, 2 * Math.PI);
    ctx.fillStyle = '#ff0844';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText('DARE', dx, dy + 5);

    const activePos = localFingertip ? { x: localFingertip.px, y: localFingertip.py } : (this.isPointerDown ? this.pointerPos : null);

    if (activePos && isMyTurn) {
      const fx = activePos.x;
      const fy = activePos.y;
      const sens = this.sensitivity || 1.0;
      const radius = 38 * sens;

      const onTruth = Math.sqrt((fx - tx) ** 2 + (fy - ty) ** 2) < radius;
      const onDare = Math.sqrt((fx - dx) ** 2 + (fy - dy) ** 2) < radius;

      if (!this._choiceArmed) {
        // Ignore hovering until the finger has been off both buttons once.
        if (!onTruth && !onDare) this._choiceArmed = true;
        this.dwellStartTruth = null;
        this.dwellStartDare = null;
      } else {
        if (onTruth) {
          if (!this.dwellStartTruth) this.dwellStartTruth = now;
          else if (now - this.dwellStartTruth >= 300) this.selectChoice('TRUTH');
        } else {
          this.dwellStartTruth = null;
        }

        if (onDare) {
          if (!this.dwellStartDare) this.dwellStartDare = now;
          else if (now - this.dwellStartDare >= 300) this.selectChoice('DARE');
        } else {
          this.dwellStartDare = null;
        }
      }
    } else {
      this.dwellStartTruth = null;
      this.dwellStartDare = null;
    }
  }

  selectChoice(type) {
    this.chosenType = type;
    const targetPlayer = this.selectedPlayer || 'peerA';

    const truthPool = (this.useCustomOnly && this.customTruthTags.length > 0)
      ? [...this.customTruthTags]
      : [...this.defaultPrompts.LIGHT.TRUTH, ...this.customTruthTags];
    const darePool = (this.useCustomOnly && this.customDareTags.length > 0)
      ? [...this.customDareTags]
      : [...this.defaultPrompts.LIGHT.DARE, ...this.customDareTags];
    const availableList = type === 'TRUTH' ? truthPool : darePool;

    let freshList = availableList.filter(q => !this.askedQuestions[targetPlayer].has(q));
    if (freshList.length === 0) {
      this.askedQuestions[targetPlayer].clear();
      freshList = availableList;
    }

    const chosenQuestion = freshList[Math.floor(Math.random() * freshList.length)] || "Have fun!";
    this.askedQuestions[targetPlayer].add(chosenQuestion);

    this.currentPrompt = chosenQuestion;
    this.choiceState = 'PROMPT_ACTIVE';
    // Same anti-glitch gate as the choice buttons: don't let a finger still
    // resting from the TRUTH/DARE tap instantly start counting toward
    // "Hold to Spin Again" on the very next screen.
    this._promptHoldArmed = false;
    this.dwellStartTaskDone = null;

    if (!this.tdCounts[targetPlayer]) this.tdCounts[targetPlayer] = { truth: 0, dare: 0 };
    this.tdCounts[targetPlayer][type === 'TRUTH' ? 'truth' : 'dare']++;

    // "Add more questions" banner: fires once when EVERY question in the
    // full pool (truth + dare, given current settings) has been asked to
    // both players at least once.
    const fullPool = [...truthPool, ...darePool];
    const bothCovered = fullPool.length > 0 &&
      fullPool.every(q => this.askedQuestions.peerA.has(q)) &&
      fullPool.every(q => this.askedQuestions.peerB.has(q));
    if (bothCovered && !this._poolExhaustedShown) {
      this._poolExhaustedShown = true;
      this._poolExhaustedAt = performance.now();
    }

    if (this.sync) {
      this.sync.write('game/truthState', {
        choiceState: this.choiceState,
        chosenType: this.chosenType,
        currentPrompt: this.currentPrompt,
        selectedPlayer: this.selectedPlayer,
        tdCounts: this.tdCounts,
        poolExhaustedAt: this._poolExhaustedShown ? this._poolExhaustedAt : null
      });
    }
  }

  // Frosted Glass Task Popup (Transparent, Glassy UI) with mandatory 5-second Hold Action
  renderPromptCard(ctx, cx, cy, localFingertip, now) {
    ctx.save();
    const boxWidth = Math.min(500, ctx.canvas.width - 32);
    const boxHeight = 220;
    const topY = cy - boxHeight / 2;

    // Translucent Glassy Card Fill
    ctx.beginPath();
    ctx.roundRect(cx - boxWidth / 2, topY, boxWidth, boxHeight, 22);

    const glassGrad = ctx.createLinearGradient(0, topY, 0, topY + boxHeight);
    glassGrad.addColorStop(0, 'rgba(12, 18, 32, 0.45)');
    glassGrad.addColorStop(1, 'rgba(6, 10, 18, 0.55)');
    ctx.fillStyle = glassGrad;
    ctx.fill();

    // Glowing Neon Glass Border
    const isTruth = this.chosenType === 'TRUTH';
    const mainColor = isTruth ? '#00f2fe' : '#ff0844';
    ctx.strokeStyle = isTruth ? 'rgba(0, 242, 254, 0.65)' : 'rgba(255, 8, 68, 0.65)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Specular Glass Shine
    ctx.beginPath();
    ctx.roundRect(cx - boxWidth / 2 + 2, topY + 2, boxWidth - 4, 30, [20, 20, 0, 0]);
    const shineGrad = ctx.createLinearGradient(0, topY, 0, topY + 30);
    shineGrad.addColorStop(0, 'rgba(255, 255, 255, 0.15)');
    shineGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = shineGrad;
    ctx.fill();

    // Title Header
    ctx.font = `800 ${scaleFont(ctx.canvas, 18)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = mainColor;
    ctx.fillText(`${this.chosenType} TASK`, cx, topY + 38);

    // Tiny corner dot showing which player's turn/pick this was
    const dotColor = this.PLAYER_COLORS[this.selectedPlayer] || '#ffffff';
    ctx.beginPath();
    ctx.arc(cx + boxWidth / 2 - 16, topY + 16, 5, 0, 2 * Math.PI);
    ctx.fillStyle = dotColor;
    ctx.shadowColor = dotColor;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Question / Task Prompt Text
    ctx.font = `500 ${scaleFont(ctx.canvas, 16)}px Outfit, sans-serif`;
    ctx.fillStyle = '#ffffff';
    wrapCanvasText(ctx, this.currentPrompt || '', cx, topY + 74, boxWidth - 40, scaleFont(ctx.canvas, 19));

    // Mandatory 5-Second Hold Action Button: "Spin Again 🔄"
    const btnW = 240;
    const btnH = 44;
    const btnX = cx;
    const btnY = topY + boxHeight - 38;
    const HOLD_DURATION = 5000; // 5 Seconds mandatory hold

    ctx.beginPath();
    ctx.roundRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH, 22);
    ctx.fillStyle = isTruth ? 'rgba(0, 242, 254, 0.18)' : 'rgba(255, 8, 68, 0.18)';
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    const activePos = localFingertip ? { x: localFingertip.px, y: localFingertip.py } : (this.isPointerDown ? this.pointerPos : null);

    let progress = 0;
    let remainingSecs = 5;

    if (activePos) {
      const fx = activePos.x;
      const fy = activePos.y;
      const sens = this.sensitivity || 1.0;
      const onButton = Math.abs(fx - btnX) < (btnW / 2) * sens && Math.abs(fy - btnY) < (btnH / 2) * sens;

      if (!this._promptHoldArmed) {
        // A finger left resting from the TRUTH/DARE tap doesn't count —
        // wait for it to leave the button area at least once first.
        if (!onButton) this._promptHoldArmed = true;
        this.dwellStartTaskDone = null;
      } else if (onButton) {
        if (!this.dwellStartTaskDone) {
          this.dwellStartTaskDone = now;
        } else {
          const elapsed = now - this.dwellStartTaskDone;
          progress = Math.min(elapsed / HOLD_DURATION, 1.0);
          remainingSecs = Math.max(1, Math.ceil((HOLD_DURATION - elapsed) / 1000));

          // Draw Glowing Progress Fill Bar inside Button
          if (progress > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(btnX - btnW / 2 + 2, btnY - btnH / 2 + 2, (btnW - 4) * progress, btnH - 4, 20);
            ctx.fillStyle = isTruth ? 'rgba(0, 242, 254, 0.55)' : 'rgba(255, 8, 68, 0.55)';
            ctx.fill();
            ctx.restore();
          }

          if (progress >= 1.0) {
            this.dwellStartTaskDone = null;
            this.spinAgainFromTask();
          }
        }
      } else {
        this.dwellStartTaskDone = null;
      }
    } else {
      this.dwellStartTaskDone = null;
    }

    // Button Text with Countdown Feedback
    ctx.font = '700 13px Outfit, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (progress > 0) {
      ctx.fillText(`HOLD ${remainingSecs}s: SPIN AGAIN 🔄`, btnX, btnY);
    } else {
      ctx.fillText('Hold 5s to Spin Again 🔄', btnX, btnY);
    }

    ctx.restore();
  }

  spinAgainFromTask() {
    this.resetTurnState();
    if (this.sync) this.sync.write('game/spinTrigger', Date.now());
    else this.triggerSpin();
  }
}

window.TruthGame = TruthGame;

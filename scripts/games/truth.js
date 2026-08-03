// AirPlay Game 5 — Truth or Dare: Air Spin (v2 Turn Reset & Custom Tagged Questions System)

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
    this.intensity = 'LIGHT';

    this.dwellStartTruth = null;
    this.dwellStartDare = null;

    // Custom Tagged Questions Storage
    this.customTruthTags = [];
    this.customDareTags = [];
    this.useCustomOnly = false;

    // No-Repeat Engine Tracking Per Player
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
        }
      });
      this.sync.listen('game/customQuestions', (data) => {
        if (data) {
          this.syncCustomQuestions(data);
        }
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

    ctx.save();

    // Render Bottle — proper glass-bottle silhouette (body → tapered
    // shoulder → neck → cap) instead of the old plain rounded-rectangle
    // "pill" shape, which didn't read as a bottle at all.
    ctx.translate(cx, cy);
    ctx.rotate(this.angle);

    ctx.beginPath();
    ctx.moveTo(-22, 95);                                  // bottom-left
    ctx.lineTo(-22, 10);                                   // up the body's left side
    ctx.quadraticCurveTo(-22, -35, -10, -55);              // shoulder taper (left)
    ctx.lineTo(-10, -95);                                  // neck (left)
    ctx.lineTo(10, -95);                                   // neck top
    ctx.lineTo(10, -55);                                   // neck (right)
    ctx.quadraticCurveTo(22, -35, 22, 10);                 // shoulder taper (right)
    ctx.lineTo(22, 95);                                     // down the body's right side
    ctx.quadraticCurveTo(22, 105, 12, 105);                // rounded bottom-right
    ctx.lineTo(-12, 105);
    ctx.quadraticCurveTo(-22, 105, -22, 95);               // rounded bottom-left
    ctx.closePath();

    const glassGrad = ctx.createLinearGradient(-22, 0, 22, 0);
    glassGrad.addColorStop(0, 'rgba(0, 200, 210, 0.55)');
    glassGrad.addColorStop(0.45, 'rgba(120, 245, 255, 0.92)');
    glassGrad.addColorStop(0.55, 'rgba(120, 245, 255, 0.92)');
    glassGrad.addColorStop(1, 'rgba(0, 150, 170, 0.55)');
    ctx.fillStyle = glassGrad;
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 22;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Label band around the middle of the body
    ctx.beginPath();
    ctx.roundRect(-22, 20, 44, 30, 4);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
    ctx.font = '800 11px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff0844';
    ctx.fillText('AIRPLAY', 0, 39);

    // Glossy highlight streak down the body
    ctx.beginPath();
    ctx.roundRect(-15, -50, 6, 130, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();

    // Cap
    ctx.beginPath();
    ctx.roundRect(-12, -110, 24, 18, 4);
    ctx.fillStyle = '#ff0844';
    ctx.shadowColor = '#ff0844';
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();

    // Render Turn Flow UI
    if (!this.isSpinning && this.choiceState === 'IDLE') {
      ctx.font = '700 24px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Tap / Hover Bottle to Spin!', cx, cy + 160);

      if (localFingertip) {
        const fx = localFingertip.px;
        const fy = localFingertip.py;
        if (Math.sqrt((fx - cx) ** 2 + (fy - cy) ** 2) < 100) {
          if (this.sync) this.sync.write('game/spinTrigger', true);
          else this.triggerSpin();
        }
      }
    } else if (this.choiceState === 'CHOOSING') {
      this.renderChoiceButtons(ctx, width, height, localFingertip);
    } else if (this.choiceState === 'PROMPT_ACTIVE') {
      this.renderPromptCard(ctx, cx, cy, localFingertip);
    }
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
    const cy = height / 2 + 140;
    const now = performance.now();

    ctx.font = `700 ${scaleFont(ctx.canvas, 24)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    wrapCanvasText(ctx, `${this.selectedPlayer === 'peerA' ? 'P1 (Pink)' : 'P2 (Cyan)'} — Choose Truth or Dare!`, cx, cy - 50, width - 40, scaleFont(ctx.canvas, 28));

    const btnOffset = Math.min(120, width * 0.24);
    const tx = cx - btnOffset;
    const ty = cy;
    ctx.beginPath();
    ctx.arc(tx, ty, 50, 0, 2 * Math.PI);
    ctx.fillStyle = '#00f2fe';
    ctx.fill();
    ctx.font = `700 ${scaleFont(ctx.canvas, 18)}px Outfit, sans-serif`;
    ctx.fillStyle = '#040914';
    ctx.fillText('TRUTH', tx, ty + 6);

    const dx = cx + btnOffset;
    const dy = cy;
    ctx.beginPath();
    ctx.arc(dx, dy, 50, 0, 2 * Math.PI);
    ctx.fillStyle = '#ff0844';
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText('DARE', dx, dy + 6);

    if (localFingertip) {
      const fx = localFingertip.px;
      const fy = localFingertip.py;

      if (Math.sqrt((fx - tx) ** 2 + (fy - ty) ** 2) < 50) {
        if (!this.dwellStartTruth) this.dwellStartTruth = now;
        else if (now - this.dwellStartTruth >= 600) this.selectChoice('TRUTH');
      } else {
        this.dwellStartTruth = null;
      }

      if (Math.sqrt((fx - dx) ** 2 + (fy - dy) ** 2) < 50) {
        if (!this.dwellStartDare) this.dwellStartDare = now;
        else if (now - this.dwellStartDare >= 600) this.selectChoice('DARE');
      } else {
        this.dwellStartDare = null;
      }
    }
  }

  selectChoice(type) {
    this.chosenType = type;
    const targetPlayer = this.selectedPlayer || 'peerA';

    // Pick prompt according to Custom Tags & No-Repeat logic
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

    // Filter out questions already asked to this specific player
    let freshList = availableList.filter(q => !this.askedQuestions[targetPlayer].has(q));

    // If all questions have been asked to this player, reset tracking for this player
    if (freshList.length === 0) {
      this.askedQuestions[targetPlayer].clear();
      freshList = availableList;
    }

    const chosenQuestion = freshList[Math.floor(Math.random() * freshList.length)] || "Have fun!";
    this.askedQuestions[targetPlayer].add(chosenQuestion);

    this.currentPrompt = chosenQuestion;
    this.choiceState = 'PROMPT_ACTIVE';

    if (this.sync) {
      this.sync.write('game/truthState', {
        choiceState: this.choiceState,
        chosenType: this.chosenType,
        currentPrompt: this.currentPrompt,
        selectedPlayer: this.selectedPlayer
      });
    }
  }

  renderPromptCard(ctx, cx, cy, localFingertip) {
    ctx.save();
    const boxWidth = Math.min(520, ctx.canvas.width - 40);
    const boxHeight = 170;
    ctx.beginPath();
    ctx.roundRect(cx - boxWidth / 2, cy + 60, boxWidth, boxHeight, 20);
    ctx.fillStyle = 'rgba(18, 24, 38, 0.95)';
    ctx.strokeStyle = this.chosenType === 'TRUTH' ? '#00f2fe' : '#ff0844';
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();

    ctx.font = `700 ${scaleFont(ctx.canvas, 20)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.chosenType === 'TRUTH' ? '#00f2fe' : '#ff0844';
    ctx.fillText(`${this.chosenType}:`, cx, cy + 95);

    ctx.font = `500 ${scaleFont(ctx.canvas, 17)}px Outfit, sans-serif`;
    ctx.fillStyle = '#ffffff';
    wrapCanvasText(ctx, this.currentPrompt || '', cx, cy + 135, boxWidth - 40, scaleFont(ctx.canvas, 22));

    // Next Turn / Spin Again Hover Button
    const bx = cx;
    const by = cy + 60 + boxHeight - 25;
    ctx.beginPath();
    ctx.roundRect(bx - 90, by - 16, 180, 32, 16);
    ctx.fillStyle = 'rgba(0, 242, 254, 0.2)';
    ctx.strokeStyle = '#00f2fe';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    ctx.font = `700 ${scaleFont(ctx.canvas, 14)}px Outfit, sans-serif`;
    ctx.fillStyle = '#00f2fe';
    ctx.fillText('🔄 SPIN AGAIN', bx, by + 5);

    // Hover or Tap Spin Again button to reset turn cleanly
    if (localFingertip) {
      const fx = localFingertip.px;
      const fy = localFingertip.py;
      if (Math.abs(fx - bx) < 90 && Math.abs(fy - by) < 20) {
        this.resetTurnState();
      }
    }

    ctx.restore();
  }
}

window.TruthGame = TruthGame;

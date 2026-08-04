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

    // Player-color scheme, fixed & screen-independent (see BUGFIX note on
    // determineLandingPlayer/render below) — Red = P1/peerA, Blue = P2/peerB.
    this.PLAYER_COLORS = { peerA: '#ff0844', peerB: '#2979ff' };
    this.PLAYER_LABELS = { peerA: 'P1 (Red)', peerB: 'P2 (Blue)' };

    // Per-player Truth/Dare pick counters for this game session (shown on
    // the end-of-game summary instead of a meaningless 0-0 score — see
    // BUGFIX note near the end-of-game handling).
    this.tdCounts = {
      peerA: { truth: 0, dare: 0 },
      peerB: { truth: 0, dare: 0 }
    };

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
          // Counts are authoritative from whichever device actually made the
          // pick (see selectChoice()) — mirror them here so both screens'
          // end-of-game summary always agree.
          if (stateData.tdCounts) this.tdCounts = stateData.tdCounts;
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

    // BUGFIX (bottle "always" landing near the middle of a half, never near
    // the boundary): the old approach picked a random VELOCITY and let it
    // decay multiplicatively frame-by-frame until it dropped below a
    // threshold. That's driven by an exponential decay curve, which — for
    // any starting velocity in the old 0.35–0.8 range — reliably bleeds off
    // to a stop at almost the same total rotation each time, so the final
    // resting angle clustered in a narrow, predictable band instead of
    // covering the whole circle.
    // Fix: pick the FINAL resting angle first, uniformly at random anywhere
    // on the full circle (so it can land anywhere — dead center of a half,
    // right on the red/blue boundary, wherever), then add several random
    // extra full rotations on top and animate smoothly from where the
    // bottle currently sits to that exact target over a fixed duration.
    // This still looks and feels like a natural spin, but the landing spot
    // itself is genuinely unpredictable every time.
    const randomFinalAngle = Math.random() * Math.PI * 2;
    const extraFullSpins = 4 + Math.floor(Math.random() * 5); // 4–8 full spins
    const currentNorm = ((this.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    let delta = randomFinalAngle - currentNorm;
    if (delta < 0) delta += Math.PI * 2;

    this._spinStartAngle = this.angle;
    this._spinTargetAngle = this.angle + delta + extraFullSpins * Math.PI * 2;
    this._spinDurationFrames = 130 + Math.floor(Math.random() * 40); // ~2.2–2.8s at 60fps
    this._spinFrame = 0;

    if (window.SoundFx) window.SoundFx.playHit();
  }

  render(ctx, width, height, localFingertip, peerFingertip) {
    const cx = width / 2;
    const cy = height / 2;

    if (this.isSpinning) {
      this._spinFrame++;
      const t = Math.min(this._spinFrame / this._spinDurationFrames, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic — fast start, gentle stop
      this.angle = this._spinStartAngle + (this._spinTargetAngle - this._spinStartAngle) * eased;

      if (this.sync && this.sync.isHost) {
        this.sync.write('game/bottleAngle', this.angle);
      }

      if (t >= 1) {
        this.isSpinning = false;
        this.determineLandingPlayer();
      }
    } else if (this.sync && !this.sync.isHost) {
      this.angle = SyncEngine.lerp(this.angle, this.targetAngle, 0.15);
    }

    // BUGFIX (bottle landed on "the wrong person"): the landing player used
    // to be inferred by eye — "which video tile does the bottle's tip point
    // at?" — but the two devices don't necessarily share the same camera
    // layout (e.g. one phone stacks the two video tiles top/bottom in
    // portrait, the other lays them side-by-side in landscape), even though
    // the bottle's rotation angle itself IS perfectly synced. So the exact
    // same spin could visually read as "landed on me" on one screen and
    // "landed on them" on the other, purely because of layout, not logic.
    // Fix: stop relying on camera-tile position entirely. Draw a fixed
    // (non-rotating) ring, split into a Red half and a Blue half at the
    // SAME world-space boundary the selection math already uses (see
    // determineLandingPlayer). Because this ring is drawn in absolute
    // screen space — not tied to either camera tile — it renders IDENTICALLY
    // on both devices, so "which color the bottle's neck stops in" is
    // unambiguous and agrees on every screen, regardless of layout.
    this.renderSelectorRing(ctx, cx, cy);

    ctx.save();

    // Render Bottle — proper glass-bottle silhouette (body → tapered
    // shoulder → neck → cap) instead of the old plain rounded-rectangle
    // "pill" shape, which didn't read as a bottle at all.
    ctx.translate(cx, cy);
    ctx.rotate(this.angle);
    // Shrunk down (was full-size) — on a phone the old bottle + ring
    // combo was big enough to cover a whole face during the video call.
    // Scaling the draw down keeps the same shape/gradients/proportions.
    ctx.scale(0.6, 0.6);

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
      ctx.font = '700 22px Outfit, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('Tap / Hover Bottle to Spin!', cx, cy + 115);

      if (localFingertip) {
        const fx = localFingertip.px;
        const fy = localFingertip.py;
        if (Math.sqrt((fx - cx) ** 2 + (fy - cy) ** 2) < 65) {
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

  // Fixed, non-rotating Red/Blue half-ring. Boundary matches
  // determineLandingPlayer()'s normAngle-vs-π split, offset by -π/2 because
  // the bottle's neck points "up" (world angle -π/2) when this.angle === 0.
  renderSelectorRing(ctx, cx, cy) {
    // Shrunk from 145 — the old ring was large enough to sit over a whole
    // face on a phone during the video call.
    const r = 92;
    ctx.save();

    // Right half (world angle -π/2 → π/2) = this.angle in [0, π) = peerB/Blue
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(41, 121, 255, 0.16)';
    ctx.fill();

    // Left half (world angle π/2 → 3π/2) = this.angle in [π, 2π) = peerA/Red
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, Math.PI / 2, 3 * Math.PI / 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 8, 68, 0.16)';
    ctx.fill();

    // Divider line + outer ring outline
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

    ctx.font = '800 13px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = this.PLAYER_COLORS.peerA;
    ctx.fillText('RED · P1', cx - r + 34, cy);
    ctx.fillStyle = this.PLAYER_COLORS.peerB;
    ctx.fillText('BLUE · P2', cx + r - 34, cy);

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
    const cy = height / 2 + 140;
    const now = performance.now();

    // BUGFIX: only the actual selected player's own device should be able to
    // choose Truth/Dare via hand tracking — previously ANY local fingertip
    // (on either device) could trigger selectChoice() since this render
    // function ran identically on both screens with no ownership check.
    const isMyTurn = !this.sync || this.sync.peerRole === this.selectedPlayer;

    ctx.font = `700 ${scaleFont(ctx.canvas, 24)}px Outfit, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.PLAYER_COLORS[this.selectedPlayer] || '#ffffff';
    const label = this.PLAYER_LABELS[this.selectedPlayer] || 'Player';
    wrapCanvasText(ctx, `${label} — Choose Truth or Dare!`, cx, cy - 50, width - 40, scaleFont(ctx.canvas, 28));

    if (!isMyTurn) {
      ctx.font = `600 ${scaleFont(ctx.canvas, 16)}px Outfit, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText("Waiting for their pick…", cx, cy - 22);
    }

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

    if (localFingertip && isMyTurn) {
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
    } else {
      this.dwellStartTruth = null;
      this.dwellStartDare = null;
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

    // Tally this pick for the end-of-game Truth/Dare summary (replaces the
    // meaningless 0-0 numeric "score" this game never actually used).
    if (!this.tdCounts[targetPlayer]) this.tdCounts[targetPlayer] = { truth: 0, dare: 0 };
    this.tdCounts[targetPlayer][type === 'TRUTH' ? 'truth' : 'dare']++;

    if (this.sync) {
      this.sync.write('game/truthState', {
        choiceState: this.choiceState,
        chosenType: this.chosenType,
        currentPrompt: this.currentPrompt,
        selectedPlayer: this.selectedPlayer,
        tdCounts: this.tdCounts
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

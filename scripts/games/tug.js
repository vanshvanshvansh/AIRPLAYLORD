// AirPlay Game 4 — Finger Tug of War (Pre-Game Settings & Win Percentage Fix)

class TugGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    this.markerPos = 0.5; // 0.0 (PeerA wins) to 1.0 (PeerB wins)
    this.targetMarkerPos = 0.5;
    this.isRunning = false;

    // Adjustable settings via pre-game panel
    this.targetPointsCount = 3;
    // Default bumped from 5s -> 10s: Red's taps were intermittently not
    // registering because points (especially under any lag) could expire
    // before a hit landed. A longer default window makes both sides'
    // taps register reliably.
    this.pointLifetimeMs = 10000;
    this.POINT_RADIUS = 34;
    this.PULL_PER_HIT = 0.6;

    this.sensitivity = 1.0; // shared by both players (not a per-color setting)

    this.myPoints = [];
    this._lastSpawnTime = 0;
    this._pointIdSeq = 0;

    this.gameTimer = 90;
    this.isUnlimitedTimer = false;
    this.timerInterval = null;
    this.botPullTimer = null;
  }

  start(canvas, syncEngine, timerSetting = 90, extraSettings = null) {
    this.sync = syncEngine;
    this.canvas = canvas;
    this.markerPos = 0.5;
    this.targetMarkerPos = 0.5;
    this.isRunning = true;
    this.myPoints = [];
    this._lastSpawnTime = performance.now();

    if (extraSettings) {
      if (extraSettings.tugPoints) this.targetPointsCount = parseInt(extraSettings.tugPoints) || 3;
      if (extraSettings.tugHold) this.pointLifetimeMs = (parseInt(extraSettings.tugHold) || 10) * 1000;
      if (extraSettings.sensitivity) this.sensitivity = parseFloat(extraSettings.sensitivity) || 1.0;
    }

    if (timerSetting === 'unlimited') {
      this.isUnlimitedTimer = true;
      this.gameTimer = 999;
    } else {
      this.isUnlimitedTimer = false;
      this.gameTimer = parseInt(timerSetting) || 90;
    }

    if (this.sync) {
      this.sync.listen('game/tugMarker', (pos) => {
        if (typeof pos === 'number') {
          this.targetMarkerPos = pos;
        }
      });
      this.sync.listen('game/tugPull', (data) => {
        if (data && this.sync.isHost) {
          this.applyPullForce(data.role, data.force);
        }
      });
    } else {
      this.startBotPulling();
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
        this.finishGameOnTimer();
      }
    }, 1000);
  }

  finishGameOnTimer() {
    this.stop();
    // When timer ends, side with higher percentage pulled wins
    const pullA = Math.round((1 - this.markerPos) * 100);
    const pullB = Math.round(this.markerPos * 100);

    // Update overlay scores to reflect final percentages so end screen displays them!
    this.overlay.scores = { peerA: pullA, peerB: pullB };
    this.overlay.endActiveGame(true);
  }

  startBotPulling() {
    if (this.botPullTimer) clearTimeout(this.botPullTimer);
    const diff = window.getBotDifficulty ? window.getBotDifficulty() : {
      tugIntervalMin: 550, tugIntervalMax: 1050, tugForceMin: 0.35, tugForceMax: 0.90
    };
    const scheduleNextPull = () => {
      const delay = diff.tugIntervalMin + Math.random() * (diff.tugIntervalMax - diff.tugIntervalMin);
      this.botPullTimer = setTimeout(() => {
        if (!this.isRunning) return;
        const force = diff.tugForceMin + Math.random() * (diff.tugForceMax - diff.tugForceMin);
        this.applyPullForce('peerB', force);
        if (window.SoundFx) window.SoundFx.playHit();
        scheduleNextPull();
      }, delay);
    };
    scheduleNextPull();
  }

  stop() {
    this.isRunning = false;
    this.myPoints = [];
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.botPullTimer) {
      clearTimeout(this.botPullTimer);
      this.botPullTimer = null;
    }
  }

  applyPullForce(role, force) {
    const direction = role === 'peerA' ? -1 : 1;
    this.markerPos = Math.max(0, Math.min(1, this.markerPos + direction * force * 0.04 * this.sensitivity));

    if (this.sync && this.sync.isHost) {
      this.sync.write('game/tugMarker', this.markerPos);
    }

    // Instant Win condition
    if (this.markerPos <= 0.05) {
      this.overlay.updateScore('peerA', 1);
      if (window.SoundFx) window.SoundFx.playWin();
      this.resetMarker();
    } else if (this.markerPos >= 0.95) {
      this.overlay.updateScore('peerB', 1);
      if (window.SoundFx) window.SoundFx.playWin();
      this.resetMarker();
    }
  }

  resetMarker() {
    this.markerPos = 0.5;
    this.targetMarkerPos = 0.5;
    if (this.sync && this.sync.isHost) {
      this.sync.write('game/tugMarker', 0.5);
    }
  }

  render(ctx, width, height, localFingertip, peerFingertip) {
    if (!this.isRunning) return;

    const myRole = this.sync ? this.sync.peerRole : 'peerA';
    const now = performance.now();

    this.updatePressurePoints(now, width, height, myRole, localFingertip);

    if (this.sync && !this.sync.isHost) {
      this.markerPos = SyncEngine.lerp(this.markerPos, this.targetMarkerPos, 0.2);
    }

    // Render Tug of War Bar & Marker (Scaled to fit any screen without clipping)
    const cx = width / 2;
    const cy = height / 2;
    const barWidth = Math.min(width * 0.65, 500);

    ctx.save();

    // Bar background track
    ctx.beginPath();
    ctx.roundRect(cx - barWidth / 2, cy - 18, barWidth, 36, 18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    // Side Indicators with scaled text to prevent overflow
    const labelFontSize = Math.max(14, scaleFont(ctx.canvas, 20));
    ctx.font = `700 ${labelFontSize}px Outfit, sans-serif`;

    ctx.fillStyle = '#ff0844';
    ctx.textAlign = 'right';
    ctx.fillText('◄ PULL', cx - barWidth / 2 - 12, cy + 6);

    ctx.fillStyle = '#00f2fe';
    ctx.textAlign = 'left';
    ctx.fillText('PULL ►', cx + barWidth / 2 + 12, cy + 6);

    // Center divider
    ctx.beginPath();
    ctx.moveTo(cx, cy - 25);
    ctx.lineTo(cx, cy + 25);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Sliding Tug Marker
    const mx = (cx - barWidth / 2) + this.markerPos * barWidth;
    ctx.beginPath();
    ctx.arc(mx, cy, 28, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.font = '800 13px Outfit, sans-serif';
    ctx.fillStyle = '#090d16';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PULL!', mx, cy);

    // Pull Percentages display under bar
    const p1Pct = Math.round((1 - this.markerPos) * 100);
    const p2Pct = Math.round(this.markerPos * 100);
    ctx.font = '700 15px Outfit, sans-serif';
    ctx.fillStyle = '#ff0844';
    ctx.textAlign = 'center';
    ctx.fillText(`${p1Pct}%`, cx - barWidth / 4, cy + 40);
    ctx.fillStyle = '#00f2fe';
    ctx.fillText(`${p2Pct}%`, cx + barWidth / 4, cy + 40);

    ctx.restore();

    this.drawPressurePoints(ctx, myRole, now);
  }

  updatePressurePoints(now, width, height, myRole, localFingertip) {
    // Expire stale points based on pointLifetimeMs
    this.myPoints = this.myPoints.filter(p => now - p.spawnedAt < this.pointLifetimeMs);

    // Continuous replenishment: maintain targetPointsCount on screen
    if (this.myPoints.length < this.targetPointsCount) {
      const isLeft = myRole === 'peerA';
      const zoneXMin = isLeft ? width * 0.08 : width * 0.58;
      const zoneXMax = isLeft ? width * 0.42 : width * 0.92;
      const zoneYMin = height * 0.18;
      const zoneYMax = height * 0.82;

      const needed = this.targetPointsCount - this.myPoints.length;
      for (let i = 0; i < needed; i++) {
        this.myPoints.push({
          id: this._pointIdSeq++,
          x: zoneXMin + Math.random() * (zoneXMax - zoneXMin),
          y: zoneYMin + Math.random() * (zoneYMax - zoneYMin),
          spawnedAt: now
        });
      }
    }

    // Hit-test local fingertip against active points
    if (localFingertip) {
      const fx = localFingertip.px;
      const fy = localFingertip.py;
      const radius = this.POINT_RADIUS * this.sensitivity;
      const stillActive = [];
      let hits = 0;

      for (const p of this.myPoints) {
        const dist = Math.sqrt((fx - p.x) ** 2 + (fy - p.y) ** 2);
        if (dist < radius) {
          hits++;
        } else {
          stillActive.push(p);
        }
      }

      if (hits > 0) {
        this.myPoints = stillActive;
        const force = Math.min(hits * this.PULL_PER_HIT, 1.0);
        if (this.sync) {
          if (this.sync.isHost) {
            this.applyPullForce(myRole, force);
          } else {
            this.sync.write('game/tugPull', { role: myRole, force });
          }
        } else {
          this.applyPullForce('peerA', force);
        }
        if (window.SoundFx) window.SoundFx.playHit();
      }
    }
  }

  drawPressurePoints(ctx, myRole, now) {
    if (this.myPoints.length === 0) return;
    const color = myRole === 'peerA' ? '255, 8, 68' : '41, 121, 255';
    const rad = this.POINT_RADIUS * this.sensitivity;

    ctx.save();
    for (const p of this.myPoints) {
      const age = (now - p.spawnedAt) / this.pointLifetimeMs;
      const fade = 1 - age;
      const pulse = 1 + 0.15 * Math.sin(now / 90 + p.id);

      ctx.beginPath();
      ctx.arc(p.x, p.y, rad * pulse, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(${color}, ${0.65 * fade})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, rad * 0.35, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(${color}, ${0.45 * fade})`;
      ctx.fill();
    }
    ctx.restore();
  }
}

window.TugGame = TugGame;

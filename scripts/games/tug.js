// AirPlay Game 4 — Finger Tug of War

class TugGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    this.markerPos = 0.5; // 0.0 (PeerA wins) to 1.0 (PeerB wins)
    this.targetMarkerPos = 0.5;
    this.isRunning = false;

    // --- Pressure-point tap mechanic ---------------------------------
    // Instead of (or in addition to) a vertical swipe, small "pressure
    // point" circles randomly spawn on each player's own half of the
    // screen. Tapping one (via hand tracking, before it expires) gives that
    // side a small pull. Points spawn every SPAWN_INTERVAL_MS in batches of
    // SPAWN_BATCH_SIZE and live for POINT_LIFETIME_MS — so a player who
    // taps quickly and accurately racks up far more pulls than one who
    // taps slowly, since points they miss simply expire unused.
    this.SPAWN_INTERVAL_MS = 200;
    this.POINT_LIFETIME_MS = 1000;
    this.SPAWN_BATCH_SIZE = 3;
    this.POINT_RADIUS = 34;
    // applyPullForce() multiplies this "force" by another 0.04 internally,
    // so 0.6 → ~0.024 marker-shift per hit (roughly 19 clean hits to pull
    // the marker all the way from center to a win — a few seconds of fast,
    // accurate tapping, matching the "whoever taps fastest/most wins" goal).
    this.PULL_PER_HIT = 0.6;

    this.myPoints = []; // { id, x, y, spawnedAt }
    this._lastSpawnTime = 0;
    this._pointIdSeq = 0;

    // Solo-mode Bot AI (only active when there is no syncEngine). Pulls the
    // marker toward peerB's side on a random cadence so it's a real duel
    // instead of a one-sided rope.
    this.botPullTimer = null;
  }

  start(canvas, syncEngine) {
    this.sync = syncEngine;
    this.markerPos = 0.5;
    this.targetMarkerPos = 0.5;
    this.isRunning = true;
    this.myPoints = [];
    this._lastSpawnTime = performance.now();

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
    if (this.botPullTimer) {
      clearTimeout(this.botPullTimer);
      this.botPullTimer = null;
    }
  }

  applyPullForce(role, force) {
    const direction = role === 'peerA' ? -1 : 1;
    this.markerPos = Math.max(0, Math.min(1, this.markerPos + direction * force * 0.04));

    if (this.sync && this.sync.isHost) {
      this.sync.write('game/tugMarker', this.markerPos);
    }

    // Check Win
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

    // BUGFIX/redesign: pull force used to come from raw vertical swipe
    // speed, which was hard to calibrate fairly (jitter vs. deliberate
    // swipe) and didn't give players a clear, visible target to react to.
    // Replaced with randomly-spawning pressure points on each player's own
    // half of the screen — hand-tracked taps on a still-active point pull
    // that side; whoever taps faster/more accurately lands more hits and
    // pulls harder, which is a much clearer (and fairer) signal.
    this.updatePressurePoints(now, width, height, myRole, localFingertip);

    // Client lerp interpolation
    if (this.sync && !this.sync.isHost) {
      this.markerPos = SyncEngine.lerp(this.markerPos, this.targetMarkerPos, 0.2);
    }

    // Render Tug of War Bar & Marker
    const cx = width / 2;
    const cy = height / 2;
    const barWidth = width * 0.7;

    ctx.save();

    // Bar background track
    ctx.beginPath();
    ctx.roundRect(cx - barWidth / 2, cy - 20, barWidth, 40, 20);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 3;
    ctx.fill();
    ctx.stroke();

    // Player A (Pink) and Player B (Cyan) side indicators
    ctx.font = '700 24px Outfit, sans-serif';
    ctx.fillStyle = '#ff0844';
    ctx.fillText('◄ PULL LEFT', cx - barWidth / 2 - 140, cy + 8);

    ctx.fillStyle = '#00f2fe';
    ctx.fillText('PULL RIGHT ►', cx + barWidth / 2 + 20, cy + 8);

    // Center divider
    ctx.beginPath();
    ctx.moveTo(cx, cy - 30);
    ctx.lineTo(cx, cy + 30);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Sliding Tug Marker
    const mx = (cx - barWidth / 2) + this.markerPos * barWidth;
    ctx.beginPath();
    ctx.arc(mx, cy, 32, 0, 2 * Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#00f2fe';
    ctx.shadowBlur = 25;
    ctx.fill();

    ctx.font = '700 16px Outfit, sans-serif';
    ctx.fillStyle = '#090d16';
    ctx.textAlign = 'center';
    ctx.fillText('PULL!', mx, cy + 5);

    ctx.restore();

    this.drawPressurePoints(ctx, myRole, now);
  }

  // Spawns a fresh batch of pressure points on the LOCAL player's own half
  // of the screen every SPAWN_INTERVAL_MS, expires stale ones, and checks
  // the local fingertip against still-active points — a hit consumes the
  // point immediately and sends a small pull for myRole. Each device only
  // ever manages/taps its OWN half; there's no need to sync point positions
  // over the network (that would just add latency to a fast-tap game) since
  // the resulting pulls already sync via the existing 'game/tugPull' path.
  updatePressurePoints(now, width, height, myRole, localFingertip) {
    // Expire stale points
    this.myPoints = this.myPoints.filter(p => now - p.spawnedAt < this.POINT_LIFETIME_MS);

    // Spawn a new batch on a fixed cadence
    if (now - this._lastSpawnTime >= this.SPAWN_INTERVAL_MS) {
      this._lastSpawnTime = now;
      const isLeft = myRole === 'peerA';
      const zoneXMin = isLeft ? width * 0.08 : width * 0.58;
      const zoneXMax = isLeft ? width * 0.42 : width * 0.92;
      const zoneYMin = height * 0.18;
      const zoneYMax = height * 0.82;

      for (let i = 0; i < this.SPAWN_BATCH_SIZE; i++) {
        this.myPoints.push({
          id: this._pointIdSeq++,
          x: zoneXMin + Math.random() * (zoneXMax - zoneXMin),
          y: zoneYMin + Math.random() * (zoneYMax - zoneYMin),
          spawnedAt: now
        });
      }
    }

    // Hit-test the local fingertip against active points
    if (localFingertip) {
      const fx = localFingertip.px;
      const fy = localFingertip.py;
      const stillActive = [];
      let hits = 0;

      for (const p of this.myPoints) {
        const dist = Math.sqrt((fx - p.x) ** 2 + (fy - p.y) ** 2);
        if (dist < this.POINT_RADIUS) {
          hits++;
        } else {
          stillActive.push(p);
        }
      }

      if (hits > 0) {
        this.myPoints = stillActive;
        const force = Math.min(hits * this.PULL_PER_HIT, 1.0);
        if (this.sync) {
          this.sync.write('game/tugPull', { role: myRole, force });
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

    ctx.save();
    for (const p of this.myPoints) {
      const age = (now - p.spawnedAt) / this.POINT_LIFETIME_MS; // 0 → 1
      const fade = 1 - age;
      // Subtle pulsing ring — "invisible-ish", just enough of a circle
      // effect to tap accurately without cluttering the screen.
      const pulse = 1 + 0.15 * Math.sin(now / 90 + p.id);

      ctx.beginPath();
      ctx.arc(p.x, p.y, this.POINT_RADIUS * pulse, 0, 2 * Math.PI);
      ctx.strokeStyle = `rgba(${color}, ${0.55 * fade})`;
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, this.POINT_RADIUS * 0.35, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(${color}, ${0.35 * fade})`;
      ctx.fill();
    }
    ctx.restore();
  }
}

window.TugGame = TugGame;

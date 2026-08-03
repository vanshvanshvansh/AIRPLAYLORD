// AirPlay Game 4 — Finger Tug of War

class TugGame {
  constructor(overlayManager) {
    this.overlay = overlayManager;
    this.sync = null;

    this.markerPos = 0.5; // 0.0 (PeerA wins) to 1.0 (PeerB wins)
    this.targetMarkerPos = 0.5;
    this.lastFingertipY = null;
    this.isRunning = false;
    this._lastPullTime = 0;

    // Solo-mode Bot AI (only active when there is no syncEngine). Pulls the
    // marker toward peerB's side on a random cadence so it's a real duel
    // instead of a one-sided rope.
    this.botPullTimer = null;
  }

  start(canvas, syncEngine) {
    this.sync = syncEngine;
    this.markerPos = 0.5;
    this.targetMarkerPos = 0.5;
    this.lastFingertipY = null;
    this.isRunning = true;

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

    // Calculate vertical hand speed / pull force
    if (localFingertip) {
      if (this.lastFingertipY !== null) {
        const dy = Math.abs(localFingertip.y - this.lastFingertipY);
        const now = performance.now();
        // 0.07 = a real deliberate swipe, not hand tremor/jitter. 120ms cooldown
        // stops one continuous motion from firing force on every tracked frame.
        if (dy > 0.07 && now - this._lastPullTime >= 120) {
          this._lastPullTime = now;
          const force = Math.min(dy * 2.2, 1.0);
          if (this.sync) {
            this.sync.write('game/tugPull', { role: myRole, force });
          } else {
            this.applyPullForce('peerA', force);
          }
          if (window.SoundFx) window.SoundFx.playHit();
        }
      }
      this.lastFingertipY = localFingertip.y;
    }

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
  }
}

window.TugGame = TugGame;

// AirPlay — Hand Privacy Box (RPS anti-cheat) — v2 Static Draggable Box
//
// While both players are choosing their Rock/Paper/Scissors gesture, each
// player's raw camera feed would otherwise let the OTHER player just watch
// their hand live over the video call and copy/counter it.
//
// v1 of this auto-tracked the hand's bounding box every frame and painted a
// mask that followed it live. That leaked into other games when a stray
// timer from a torn-down RPS round fired late (see old BUGFIX notes), and
// the constant per-frame tracking/redraw was itself part of the app's
// overall canvas performance cost.
//
// v2 (this version): a small, simple, STATIC black box that the player
// drags to whatever position they want over their own hand (see the
// #handPrivacyBox element + drag handlers below). Because its position
// only changes when the player actually drags it — not every frame based
// on hand-tracking — this is cheaper AND matches what was asked for:
// confirm your gesture behind the box, then it's fine to move your hand
// back out from under it; the box itself stays in place, masking that
// fixed region, until the round result is announced and stop() is called.
//
// This box element only exists inside RPS's own start()/stop() calls — it
// is never touched by any other game, so it cannot leak into Balloon,
// Paddle, Tug, or Truth/Dare the way the old auto-tracking version could.
class HandPrivacyShield {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.rafId = null;
    this.active = false;

    this.sender = null;
    this.originalTrack = null;
    this.maskedTrack = null;
    this.maskedStream = null;

    this.boxEl = document.getElementById('handPrivacyBox');
    this.tileEl = this.boxEl ? this.boxEl.parentElement : null;
    this._dragBound = false;
    this._dragging = false;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;

    // Every start() hands out a fresh token; stop() only acts if the
    // caller doesn't pass a token, or passes the CURRENT one — so a
    // leftover call from a dead round can't stop/restart a later round's
    // shield (or nothing at all).
    this._token = 0;

    this._setupDrag();
  }

  // Pointer-drag the box within its parent video tile. Position is kept in
  // plain CSS left/top (px), clamped to the tile's bounds. Bound once in
  // the constructor since the element itself never changes.
  _setupDrag() {
    if (!this.boxEl || !this.tileEl || this._dragBound) return;
    this._dragBound = true;

    const onPointerDown = (e) => {
      this._dragging = true;
      this.boxEl.setPointerCapture && this.boxEl.setPointerCapture(e.pointerId);
      const rect = this.boxEl.getBoundingClientRect();
      this._dragOffsetX = e.clientX - rect.left;
      this._dragOffsetY = e.clientY - rect.top;
      // Switch from centered (margin-based) positioning to explicit
      // left/top the first time it's dragged, so it doesn't snap.
      this._applyPxPosition(rect);
    };

    const onPointerMove = (e) => {
      if (!this._dragging) return;
      const tileRect = this.tileEl.getBoundingClientRect();
      const boxW = this.boxEl.offsetWidth;
      const boxH = this.boxEl.offsetHeight;
      let left = e.clientX - tileRect.left - this._dragOffsetX;
      let top = e.clientY - tileRect.top - this._dragOffsetY;
      left = Math.max(0, Math.min(tileRect.width - boxW, left));
      top = Math.max(0, Math.min(tileRect.height - boxH, top));
      this.boxEl.style.left = `${left}px`;
      this.boxEl.style.top = `${top}px`;
      this.boxEl.style.margin = '0';
    };

    const onPointerUp = () => { this._dragging = false; };

    this.boxEl.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  _applyPxPosition(rect) {
    const tileRect = this.tileEl.getBoundingClientRect();
    this.boxEl.style.left = `${rect.left - tileRect.left}px`;
    this.boxEl.style.top = `${rect.top - tileRect.top}px`;
    this.boxEl.style.margin = '0';
  }

  // webrtc: the WebRTCManager instance (needs .peerConnection, .localStream).
  // Returns a token to pass to stop() (optional, but recommended).
  start(webrtc) {
    if (this.active) return this._token;
    if (!webrtc || !webrtc.peerConnection || !webrtc.localStream) return this._token;
    if (!this.boxEl || !this.tileEl) return this._token;

    const videoTrack = webrtc.localStream.getVideoTracks()[0];
    if (!videoTrack) return this._token;

    this.sender = webrtc.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!this.sender) return this._token;

    const myToken = ++this._token;

    const settings = videoTrack.getSettings ? videoTrack.getSettings() : {};
    this.canvas.width = settings.width || 1280;
    this.canvas.height = settings.height || 720;

    this.originalTrack = this.sender.track;

    // Read frames from a hidden <video> playing the raw camera stream.
    if (!this._rawVideoEl) {
      this._rawVideoEl = document.createElement('video');
      this._rawVideoEl.muted = true;
      this._rawVideoEl.playsInline = true;
    }
    this._rawVideoEl.srcObject = webrtc.localStream;
    this._rawVideoEl.play().catch(() => {});

    try {
      this.maskedStream = this.canvas.captureStream(30);
      this.maskedTrack = this.maskedStream.getVideoTracks()[0];
    } catch (e) {
      console.error('Hand privacy box: captureStream unsupported', e);
      return this._token;
    }

    // Show the draggable box on the local tile (this alone hides it from
    // the LOCAL player's own screen — no need to swap the local preview's
    // srcObject like v1 did).
    this.boxEl.classList.add('active');

    this.active = true;
    const rawVideoEl = this._rawVideoEl;

    const draw = () => {
      if (!this.active || myToken !== this._token) return;
      if (rawVideoEl.videoWidth > 0) {
        this.ctx.drawImage(rawVideoEl, 0, 0, this.canvas.width, this.canvas.height);

        const region = this._getMaskRegion();
        if (region) {
          this.ctx.fillStyle = '#0a0a0f';
          this.ctx.beginPath();
          this.ctx.roundRect(region.x, region.y, region.w, region.h, 14);
          this.ctx.fill();
        }
      }
      this.rafId = requestAnimationFrame(draw);
    };
    draw();

    this.sender.replaceTrack(this.maskedTrack).catch((e) => console.error('Hand privacy box: replaceTrack (mask) failed', e));

    return myToken;
  }

  // Maps the box's current on-screen position (over the MIRRORED local
  // preview) to the corresponding region in the RAW (unmirrored) camera
  // frame that gets captured onto this.canvas — accounting for both the
  // horizontal mirror (scaleX(-1) on .video-tile video) and the
  // object-fit:cover crop between the video's native resolution and its
  // displayed size.
  _getMaskRegion() {
    const localVideoEl = document.getElementById('localVideo');
    if (!localVideoEl || !localVideoEl.videoWidth) return null;

    const boxRect = this.boxEl.getBoundingClientRect();
    const dispRect = localVideoEl.getBoundingClientRect();
    if (!dispRect.width || !dispRect.height) return null;

    const vw = localVideoEl.videoWidth;
    const vh = localVideoEl.videoHeight;
    const videoAspect = vw / vh;
    const dispAspect = dispRect.width / dispRect.height;

    // object-fit: cover crop math
    let renderW = dispRect.width, renderH = dispRect.height, offX = 0, offY = 0;
    if (dispAspect > videoAspect) {
      renderW = dispRect.width;
      renderH = renderW / videoAspect;
      offY = (renderH - dispRect.height) / 2;
    } else {
      renderH = dispRect.height;
      renderW = renderH * videoAspect;
      offX = (renderW - dispRect.width) / 2;
    }

    const scaleX = vw / renderW;
    const scaleY = vh / renderH;

    // Box position relative to the displayed (mirrored) video, in display px
    const boxLeftDisp = boxRect.left - dispRect.left;
    const boxTopDisp = boxRect.top - dispRect.top;

    // Mirror horizontally: the DOM box's left edge in the mirrored view
    // corresponds to the RIGHT edge of the same physical region in the
    // raw, unmirrored frame — so flip the X position, not just negate it.
    const mirroredLeftDisp = dispRect.width - boxLeftDisp - boxRect.width;

    const x = (mirroredLeftDisp + offX) * scaleX;
    const y = (boxTopDisp + offY) * scaleY;
    const w = boxRect.width * scaleX;
    const h = boxRect.height * scaleY;

    return {
      x: Math.max(0, x),
      y: Math.max(0, y),
      w: Math.min(w, this.canvas.width - x),
      h: Math.min(h, this.canvas.height - y)
    };
  }

  // `token` is optional. If provided, stop() only takes effect when it
  // matches the token from the start() call that's actually still active.
  stop(token) {
    if (token !== undefined && token !== this._token) return;
    if (!this.active) return;
    this.active = false;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.boxEl) this.boxEl.classList.remove('active');

    if (this.sender && this.originalTrack) {
      this.sender.replaceTrack(this.originalTrack).catch((e) => console.error('Hand privacy box: replaceTrack (restore) failed', e));
    }

    if (this.maskedTrack) {
      this.maskedTrack.stop();
      this.maskedTrack = null;
    }
    if (this._rawVideoEl) {
      this._rawVideoEl.srcObject = null;
    }
    this.maskedStream = null;
    this.sender = null;
    this.originalTrack = null;
  }
}

window.HandPrivacyShield = HandPrivacyShield;

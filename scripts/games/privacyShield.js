// AirPlay — Hand Privacy Shield (for RPS anti-cheat)
//
// While both players are choosing their Rock/Paper/Scissors gesture, each
// player's raw camera feed would otherwise let the OTHER player just watch
// their hand live over the video call and copy/counter it — same problem
// hand-gesture-tracking canvas games can't fix on their own, since the
// canvas overlay only draws on top of the LOCAL screen; it can't hide
// anything in the video actually being sent to the peer.
//
// This blacks out the hand region in BOTH the video sent to the peer AND
// your own local self-preview (so neither side can read a gesture off
// either video tile) by drawing each outgoing frame onto a hidden canvas,
// painting a black box over the hand's bounding region, and:
//   1. swapping the outgoing WebRTC video track for a captureStream() of
//      that canvas via RTCRtpSender.replaceTrack() (no renegotiation), and
//   2. pointing the local <video> preview's srcObject at that same masked
//      stream until stop() restores both.
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

    this.localVideoEl = null;
    this.originalLocalSrcObject = null;

    // BUGFIX (black box showing up in OTHER games like Paddle/Balloon):
    // if the RPS round that started this shield got torn down (game
    // switched, exited, etc.) while a stray setTimeout/setInterval from
    // that same round was still pending, that old timer could call
    // start()/stop() again later, on top of whatever game is now active.
    // Every start() now hands out a fresh token; stop() only acts if the
    // caller doesn't pass a token, or passes the CURRENT one — so a leftover
    // call from a dead round can no longer mess with a shield a later round
    // (or nothing at all) is using. The real fix for the leak itself is
    // clearing that stray timer in rps.js, but this makes the shield
    // itself hijack-proof as a second line of defense.
    this._token = 0;
  }

  // webrtc: the WebRTCManager instance (needs .peerConnection, .localStream,
  // .localVideoElement). handTracker: the HandTracker instance to read the
  // current hand bounding box from every frame. Returns a token to pass to
  // stop() (optional, but recommended).
  start(webrtc, handTracker) {
    if (this.active) return this._token;
    if (!webrtc || !webrtc.peerConnection || !webrtc.localStream || !webrtc.localVideoElement) return this._token;

    const videoTrack = webrtc.localStream.getVideoTracks()[0];
    if (!videoTrack) return this._token;

    this.sender = webrtc.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!this.sender) return this._token;

    const myToken = ++this._token;

    const settings = videoTrack.getSettings ? videoTrack.getSettings() : {};
    this.canvas.width = settings.width || webrtc.localVideoElement.videoWidth || 1280;
    this.canvas.height = settings.height || webrtc.localVideoElement.videoHeight || 720;

    this.originalTrack = this.sender.track;
    this.localVideoEl = webrtc.localVideoElement;
    this.originalLocalSrcObject = this.localVideoEl.srcObject;

    // Read frames from a SEPARATE hidden <video> playing the raw camera
    // stream — not from the visible localVideoElement, since that one is
    // about to get its srcObject swapped to the masked output. Drawing
    // from the same element we just repointed would create a feedback
    // loop (masked frame → drawn again → re-masked...) and freeze/corrupt
    // the preview instead of showing a live masked feed.
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
      console.error('Hand privacy shield: captureStream unsupported', e);
      return this._token;
    }

    this.active = true;
    const rawVideoEl = this._rawVideoEl;

    const draw = () => {
      if (!this.active || myToken !== this._token) return;
      if (rawVideoEl.videoWidth > 0) {
        this.ctx.drawImage(rawVideoEl, 0, 0, this.canvas.width, this.canvas.height);

        const box = handTracker ? handTracker.getHandBoundingBox(this.canvas.width, this.canvas.height) : null;
        if (box && box.width > 0 && box.height > 0) {
          this.ctx.fillStyle = '#0a0a0f';
          this.ctx.beginPath();
          this.ctx.roundRect(box.x, box.y, box.width, box.height, 18);
          this.ctx.fill();

          this.ctx.fillStyle = 'rgba(255,255,255,0.85)';
          this.ctx.font = `700 ${Math.max(14, box.width * 0.11)}px Outfit, sans-serif`;
          this.ctx.textAlign = 'center';
          this.ctx.fillText('🤫', box.x + box.width / 2, box.y + box.height / 2 + 8);
        }
      }
      this.rafId = requestAnimationFrame(draw);
    };
    draw();

    this.sender.replaceTrack(this.maskedTrack).catch((e) => console.error('Hand privacy shield: replaceTrack (mask) failed', e));
    // Point the local self-preview at the masked stream too, so a player
    // can't read their OWN true gesture off their own screen either —
    // only the "🤫" black box, same as what the opponent sees.
    try {
      this.localVideoEl.srcObject = this.maskedStream;
    } catch (e) {
      console.error('Hand privacy shield: local preview swap failed', e);
    }

    return myToken;
  }

  // `token` is optional. If provided, stop() only takes effect when it
  // matches the token from the start() call that's actually still active —
  // preventing a stray/late call from a previous, already-ended round from
  // stopping (or restarting) someone else's active shield.
  stop(token) {
    if (token !== undefined && token !== this._token) return;
    if (!this.active) return;
    this.active = false;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.sender && this.originalTrack) {
      this.sender.replaceTrack(this.originalTrack).catch((e) => console.error('Hand privacy shield: replaceTrack (restore) failed', e));
    }
    if (this.localVideoEl) {
      try {
        this.localVideoEl.srcObject = this.originalLocalSrcObject;
      } catch (e) {
        console.error('Hand privacy shield: local preview restore failed', e);
      }
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
    this.localVideoEl = null;
    this.originalLocalSrcObject = null;
  }
}

window.HandPrivacyShield = HandPrivacyShield;

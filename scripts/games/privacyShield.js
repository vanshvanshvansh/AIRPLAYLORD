// AirPlay — Hand Privacy Shield (for RPS anti-cheat)
//
// While both players are choosing their Rock/Paper/Scissors gesture, each
// player's raw camera feed would otherwise let the OTHER player just watch
// their hand live over the video call and copy/counter it — same problem
// hand-gesture-tracking canvas games can't fix on their own, since the
// canvas overlay only draws on top of the LOCAL screen; it can't hide
// anything in the video actually being sent to the peer.
//
// This blacks out the hand region in the video that gets SENT to the peer
// (not the local self-preview, so you can still see your own hand while
// choosing) by drawing each outgoing frame onto a hidden canvas, painting
// a black box over the hand's bounding region, and swapping the outgoing
// WebRTC video track for a captureStream() of that canvas via
// RTCRtpSender.replaceTrack() — which does NOT require any renegotiation.
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
  }

  // webrtc: the WebRTCManager instance (needs .peerConnection, .localStream,
  // .localVideoElement). handTracker: the HandTracker instance to read the
  // current hand bounding box from every frame.
  start(webrtc, handTracker) {
    if (this.active) return;
    if (!webrtc || !webrtc.peerConnection || !webrtc.localStream || !webrtc.localVideoElement) return;

    const videoTrack = webrtc.localStream.getVideoTracks()[0];
    if (!videoTrack) return;

    this.sender = webrtc.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
    if (!this.sender) return;

    const settings = videoTrack.getSettings ? videoTrack.getSettings() : {};
    this.canvas.width = settings.width || webrtc.localVideoElement.videoWidth || 1280;
    this.canvas.height = settings.height || webrtc.localVideoElement.videoHeight || 720;

    this.originalTrack = this.sender.track;

    try {
      this.maskedStream = this.canvas.captureStream(30);
      this.maskedTrack = this.maskedStream.getVideoTracks()[0];
    } catch (e) {
      console.error('Hand privacy shield: captureStream unsupported', e);
      return;
    }

    this.active = true;
    const videoEl = webrtc.localVideoElement;

    const draw = () => {
      if (!this.active) return;
      if (videoEl.videoWidth > 0) {
        this.ctx.drawImage(videoEl, 0, 0, this.canvas.width, this.canvas.height);

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
  }

  stop() {
    if (!this.active) return;
    this.active = false;

    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.sender && this.originalTrack) {
      this.sender.replaceTrack(this.originalTrack).catch((e) => console.error('Hand privacy shield: replaceTrack (restore) failed', e));
    }

    if (this.maskedTrack) {
      this.maskedTrack.stop();
      this.maskedTrack = null;
    }
    this.maskedStream = null;
    this.sender = null;
    this.originalTrack = null;
  }
}

window.HandPrivacyShield = HandPrivacyShield;

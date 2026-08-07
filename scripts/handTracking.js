// AirPlay — MediaPipe Hand Tracking & Gesture Classifier Engine (v2 Calibrated)

class HandTracker {
  constructor(options = {}) {
    this.videoElement = options.videoElement || null;
    this.canvasElement = options.canvasElement || null;
    this.onFingertipUpdate = options.onFingertipUpdate || null;
    this.onHandStatusChange = options.onHandStatusChange || null;

    this.hands = null;
    this.camera = null;
    this.euroFilter = new OneEuroFilter(0.8, 0.005, 1.0);

    this.isTracking = false;
    this.confidence = 0;
    this.lastLandmarks = null;
    this.lastActiveTime = 0;
    this.freezeTimeout = 500;
    this.fadeDuration = 200;

    this.filteredFingertip = null; // what games actually read every frame (jitter-filtered, zero added lag)
    this.targetFingertip = null;   // latest raw sample straight from MediaPipe
    this.detectedGesture = 'NONE';
    this.noHandTimeoutTimer = null;

    // Skeleton/fingertip dot is only drawn on-canvas while a game is
    // active. During a normal call it stays hidden. Toggle via setVisible().
    this.visible = false;
  }

  setVisible(visible) {
    this.visible = !!visible;
  }

  async init() {
    if (typeof Hands === 'undefined') {
      console.error("MediaPipe Hands library not loaded via CDN");
      return false;
    }

    this.hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    this.hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 0,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    this.hands.onResults((results) => this.processResults(results));
    return true;
  }

  startCamera(videoElement) {
    if (videoElement) this.videoElement = videoElement;
    if (!this.videoElement) return;

    const MIN_INFERENCE_INTERVAL = 40; // ~25fps cap for hand-tracking inference
    let lastInferenceTime = 0;
    let inferenceBusy = false;

    const maybeInfer = async () => {
      const now = performance.now();
      if (inferenceBusy || now - lastInferenceTime < MIN_INFERENCE_INTERVAL) return;
      inferenceBusy = true;
      lastInferenceTime = now;
      try {
        await this.hands.send({ image: this.videoElement });
      } finally {
        inferenceBusy = false;
      }
    };

    if (typeof Camera !== 'undefined') {
      this.camera = new Camera(this.videoElement, {
        onFrame: async () => {
          if (this.hands && this.videoElement) {
            await maybeInfer();
          }
        },
        width: 1280,
        height: 720
      });
      this.camera.start();
    } else {
      const pumpFrame = async () => {
        if (this.videoElement && !this.videoElement.paused) {
          await maybeInfer();
        }
        requestAnimationFrame(pumpFrame);
      };
      pumpFrame();
    }
  }

  // Call this once per requestAnimationFrame, BEFORE reading
  // `this.filteredFingertip`. Kept as a hook for the render loop, but the
  // position is no longer artificially glided toward the target — that
  // used to add real, felt latency between where the fingertip actually
  // was and where clicks/paddles registered. Now `filteredFingertip`
  // always equals the latest real sample (already jitter-filtered by
  // OneEuroFilter in processResults), so whatever is drawn on screen is
  // exactly what gets used for touch/click detection — zero extra delay.
  advanceDisplayPosition() {
    // No-op by design: filteredFingertip is set directly in processResults()
    // the instant a new sample arrives, so there is nothing to glide.
  }

  processResults(results) {
    const now = performance.now();
    const hasHand = results.multiHandLandmarks && results.multiHandLandmarks.length > 0;

    if (hasHand) {
      this.lastLandmarks = results.multiHandLandmarks[0];
      this.lastActiveTime = now;
      this.confidence = 1.0;

      // Raw index fingertip (landmark 8)
      const rawTip = this.lastLandmarks[8];
      const rawMirrored = { x: 1 - rawTip.x, y: rawTip.y };

      // Filter position using OneEuroFilter + EMA
      const smoothedNorm = this.euroFilter.filter(rawMirrored, now);

      // Perform Aspect Ratio Offset Calibration
      const calibratedCoords = getAspectCorrectedCoords(smoothedNorm, this.videoElement, this.canvasElement);

      // Written straight to both `targetFingertip` and `filteredFingertip`
      // the instant a new MediaPipe sample arrives — no artificial glide
      // toward it. Between real samples the position simply holds, so
      // whatever is on screen (the red fingertip dot) is always exactly
      // where a touch/click gets registered. This trades a little visual
      // smoothness on very sparse samples for correctness and minimum
      // possible latency, which is what click accuracy needs.
      this.targetFingertip = {
        x: calibratedCoords.normX,
        y: calibratedCoords.normY,
        px: calibratedCoords.x,
        py: calibratedCoords.y
      };
      this.filteredFingertip = this.targetFingertip;

      this.detectedGesture = this.classifyGesture(this.lastLandmarks);

      if (!this.isTracking) {
        this.isTracking = true;
        if (this.onHandStatusChange) this.onHandStatusChange(true, 'ACTIVE');
      }

      if (this.noHandTimeoutTimer) {
        clearTimeout(this.noHandTimeoutTimer);
        this.noHandTimeoutTimer = null;
      }
    } else {
      const elapsedSinceActive = now - this.lastActiveTime;

      if (elapsedSinceActive < this.freezeTimeout) {
        this.confidence = Math.max(0, 1.0 - elapsedSinceActive / this.fadeDuration);
      } else {
        this.confidence = 0;
        this.filteredFingertip = null;
        this.targetFingertip = null;
        this.detectedGesture = 'NONE';
        if (this.isTracking) {
          this.isTracking = false;
          if (this.onHandStatusChange) this.onHandStatusChange(false, 'LOST');
        }

        if (!this.noHandTimeoutTimer) {
          this.noHandTimeoutTimer = setTimeout(() => {
            if (this.onHandStatusChange) this.onHandStatusChange(false, 'POOR_LIGHTING');
          }, 3000);
        }
      }
    }

    if (this.onFingertipUpdate) {
      this.onFingertipUpdate({
        fingertip: this.filteredFingertip,
        confidence: this.confidence,
        landmarks: this.lastLandmarks,
        gesture: this.detectedGesture
      });
    }

    this.drawSkeleton();
  }

  drawSkeleton() {
    // Only paint the hand skeleton/fingertip dot while a game is actually
    // active (see setVisible()) — during a normal call this stays hidden.
    if (!this.visible) return;
    if (!this.canvasElement || !this.lastLandmarks || this.confidence <= 0) return;

    const ctx = this.canvasElement.getContext('2d');
    ctx.save();
    ctx.globalAlpha = this.confidence;

    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4],
      [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12],
      [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20],
      [0, 17]
    ];

    // Draw Skeleton Lines with aspect calibration
    ctx.strokeStyle = 'rgba(0, 242, 254, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();

    connections.forEach(([i, j]) => {
      const p1 = getAspectCorrectedCoords({ x: 1 - this.lastLandmarks[i].x, y: this.lastLandmarks[i].y }, this.videoElement, this.canvasElement);
      const p2 = getAspectCorrectedCoords({ x: 1 - this.lastLandmarks[j].x, y: this.lastLandmarks[j].y }, this.videoElement, this.canvasElement);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    });
    ctx.stroke();

    // Draw Joint Nodes (landmark 8 / index fingertip is skipped here and
    // drawn separately below, exactly at the same coordinates used for
    // touch/click detection, so the red dot IS the touch point — no
    // separate pin/cursor that could drift out of sync with it).
    this.lastLandmarks.forEach((lm, idx) => {
      if (idx === 8) return;
      const pt = getAspectCorrectedCoords({ x: 1 - lm.x, y: lm.y }, this.videoElement, this.canvasElement);
      const isFingertip = [4, 12, 16, 20].includes(idx);

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isFingertip ? 6 : 4, 0, 2 * Math.PI);
      ctx.fillStyle = isFingertip ? '#00f2fe' : '#ffffff';
      ctx.shadowColor = '#00f2fe';
      ctx.shadowBlur = isFingertip ? 15 : 8;
      ctx.fill();
    });

    // Red touch-point dot: drawn at this.filteredFingertip, the exact same
    // coordinate every game reads for click/touch detection.
    if (this.filteredFingertip) {
      ctx.beginPath();
      ctx.arc(this.filteredFingertip.px, this.filteredFingertip.py, 8, 0, 2 * Math.PI);
      ctx.fillStyle = '#ff0844';
      ctx.shadowColor = '#ff0844';
      ctx.shadowBlur = 15;
      ctx.fill();
    }

    ctx.restore();
  }

  classifyGesture(landmarks) {
    if (!landmarks) return 'NONE';
    const wrist = landmarks[0];

    const isIndexExtended = getDistance(landmarks[8], wrist) > getDistance(landmarks[6], wrist);
    const isMiddleExtended = getDistance(landmarks[12], wrist) > getDistance(landmarks[10], wrist);
    const isRingExtended = getDistance(landmarks[16], wrist) > getDistance(landmarks[14], wrist);
    const isPinkyExtended = getDistance(landmarks[20], wrist) > getDistance(landmarks[18], wrist);

    const extendedCount = [isIndexExtended, isMiddleExtended, isRingExtended, isPinkyExtended].filter(Boolean).length;

    if (extendedCount >= 4) return 'PAPER';
    if (extendedCount === 0) return 'ROCK'; // genuine closed fist only — a resting/relaxed hand is NOT a fist
    if (isIndexExtended && isMiddleExtended && !isRingExtended && !isPinkyExtended) return 'SCISSORS';

    return 'NONE'; // ambiguous pose (e.g. 1-3 fingers loosely extended) — don't guess, wait for a clear gesture
  }
}

window.HandTracker = HandTracker;

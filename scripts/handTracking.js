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

    this.filteredFingertip = null; // what games actually read every frame (smoothed/interpolated)
    this.targetFingertip = null;   // latest raw sample straight from MediaPipe
    this.detectedGesture = 'NONE';
    this.noHandTimeoutTimer = null;
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
  // `this.filteredFingertip`. Glides the on-screen position toward the
  // latest raw MediaPipe sample so motion looks like a full 60fps even
  // though real samples only arrive ~15-25 times a second on phones.
  advanceDisplayPosition() {
    if (!this.targetFingertip) return;
    if (!this.filteredFingertip) {
      this.filteredFingertip = { ...this.targetFingertip };
      return;
    }
    const alpha = 0.4; // convergence speed — high enough to feel responsive, low enough to hide sample gaps
    this.filteredFingertip = {
      x: this.filteredFingertip.x + (this.targetFingertip.x - this.filteredFingertip.x) * alpha,
      y: this.filteredFingertip.y + (this.targetFingertip.y - this.filteredFingertip.y) * alpha,
      px: this.filteredFingertip.px + (this.targetFingertip.px - this.filteredFingertip.px) * alpha,
      py: this.filteredFingertip.py + (this.targetFingertip.py - this.filteredFingertip.py) * alpha
    };
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

      // BUGFIX (the "5fps" complaint): this used to be written directly to
      // `filteredFingertip`, which every game reads every animation frame
      // (~60fps). But MediaPipe only actually delivers a new hand position
      // ~10-20 times a second on a real phone (inference is slow), so the
      // cursor/paddle/ball sat frozen for 3-6 render frames at a time, then
      // teleported to the next sample — visually indistinguishable from the
      // whole game running at 5-10fps, even though the canvas itself was
      // redrawing at a full 60fps the entire time.
      // Fix: store the raw sample as a TARGET, and smoothly glide
      // `filteredFingertip` toward it once per animation frame (see
      // advanceDisplayPosition(), called from the render loop). That turns
      // the sparse ~15fps samples into fluid ~60fps on-screen motion.
      this.targetFingertip = {
        x: calibratedCoords.normX,
        y: calibratedCoords.normY,
        px: calibratedCoords.x,
        py: calibratedCoords.y
      };
      if (!this.filteredFingertip) {
        // First acquisition (or just re-acquired after losing the hand):
        // snap immediately instead of gliding in from wherever it last was.
        this.filteredFingertip = { ...this.targetFingertip };
      }

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

    // Draw Joint Nodes
    this.lastLandmarks.forEach((lm, idx) => {
      const pt = getAspectCorrectedCoords({ x: 1 - lm.x, y: lm.y }, this.videoElement, this.canvasElement);
      const isFingertip = [4, 8, 12, 16, 20].includes(idx);

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isFingertip ? 6 : 4, 0, 2 * Math.PI);
      ctx.fillStyle = idx === 8 ? '#ff0844' : (isFingertip ? '#00f2fe' : '#ffffff');
      ctx.shadowColor = idx === 8 ? '#ff0844' : '#00f2fe';
      ctx.shadowBlur = idx === 8 ? 15 : 8;
      ctx.fill();
    });

    // Render Needle Cursor at Calibrated Fingertip (landmark 8)
    if (this.filteredFingertip) {
      drawNeedleCursor(ctx, this.filteredFingertip.px, this.filteredFingertip.py, '#00f2fe');
    }

    ctx.restore();
  }

  // Bounding box around the current hand, in the RAW (unmirrored) video
  // frame's pixel space at the given target resolution — i.e. matching
  // what you'd get from ctx.drawImage(videoElement, 0, 0, targetW, targetH).
  // Used by the RPS privacy shield to black out the hand in the OUTGOING
  // video before it's sent to the peer. Deliberately does NOT use the
  // mirrored/calibrated coordinates the on-screen cursor uses — those are
  // flipped for the local selfie-view display, but raw camera frame data
  // (which is what drawImage reads) is never actually flipped.
  getHandBoundingBox(targetW, targetH, paddingRatio = 0.35) {
    if (!this.lastLandmarks || this.confidence <= 0) return null;

    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    this.lastLandmarks.forEach((lm) => {
      minX = Math.min(minX, lm.x);
      maxX = Math.max(maxX, lm.x);
      minY = Math.min(minY, lm.y);
      maxY = Math.max(maxY, lm.y);
    });

    const padX = (maxX - minX) * paddingRatio + 0.035;
    const padY = (maxY - minY) * paddingRatio + 0.035;
    minX = Math.max(0, minX - padX);
    maxX = Math.min(1, maxX + padX);
    minY = Math.max(0, minY - padY);
    maxY = Math.min(1, maxY + padY);

    return {
      x: minX * targetW,
      y: minY * targetH,
      width: (maxX - minX) * targetW,
      height: (maxY - minY) * targetH
    };
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

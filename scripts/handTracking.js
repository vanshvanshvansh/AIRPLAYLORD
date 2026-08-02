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

    this.filteredFingertip = null;
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
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    this.hands.onResults((results) => this.processResults(results));
    return true;
  }

  startCamera(videoElement) {
    if (videoElement) this.videoElement = videoElement;
    if (!this.videoElement) return;

    if (typeof Camera !== 'undefined') {
      this.camera = new Camera(this.videoElement, {
        onFrame: async () => {
          if (this.hands && this.videoElement) {
            await this.hands.send({ image: this.videoElement });
          }
        },
        width: 1280,
        height: 720
      });
      this.camera.start();
    } else {
      const pumpFrame = async () => {
        if (this.videoElement && !this.videoElement.paused) {
          await this.hands.send({ image: this.videoElement });
        }
        requestAnimationFrame(pumpFrame);
      };
      pumpFrame();
    }
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

      this.filteredFingertip = {
        x: calibratedCoords.normX,
        y: calibratedCoords.normY,
        px: calibratedCoords.x,
        py: calibratedCoords.y
      };

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

  classifyGesture(landmarks) {
    if (!landmarks) return 'NONE';
    const wrist = landmarks[0];

    const isIndexExtended = getDistance(landmarks[8], wrist) > getDistance(landmarks[6], wrist);
    const isMiddleExtended = getDistance(landmarks[12], wrist) > getDistance(landmarks[10], wrist);
    const isRingExtended = getDistance(landmarks[16], wrist) > getDistance(landmarks[14], wrist);
    const isPinkyExtended = getDistance(landmarks[20], wrist) > getDistance(landmarks[18], wrist);

    const extendedCount = [isIndexExtended, isMiddleExtended, isRingExtended, isPinkyExtended].filter(Boolean).length;

    if (extendedCount >= 4) return 'PAPER';
    if (extendedCount === 0 || extendedCount === 1) return 'ROCK';
    if (isIndexExtended && isMiddleExtended && !isRingExtended && !isPinkyExtended) return 'SCISSORS';

    return 'NONE';
  }
}

window.HandTracker = HandTracker;

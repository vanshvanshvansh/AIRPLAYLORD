// AirPlay — WebRTC PeerConnection, ICE Queueing & Filter Manager (v2 Updated)

class WebRTCManager {
  constructor(options = {}) {
    this.localVideoElement = options.localVideoElement || null;
    this.remoteVideoElement = options.remoteVideoElement || null;
    this.onConnectionStateChange = options.onConnectionStateChange || null;
    this.onIceCandidate = options.onIceCandidate || null;

    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;

    this.pendingIceCandidates = []; // Queue for ICE candidates arriving before remote description
    this.isAudioMuted = false;
    this.isVideoMuted = false;
    this.reconnectTimer = null;
    this.activeFilter = 'none';
  }

  async initializeLocalMedia() {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
          facingMode: 'user'
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      if (this.localVideoElement) {
        this.localVideoElement.srcObject = this.localStream;
        await this.localVideoElement.play();
      }
      return true;
    } catch (err) {
      console.error("Camera/Mic access denied or error:", err);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange('MEDIA_DENIED', err);
      }
      return false;
    }
  }

  createPeerConnection() {
    const config = {
      iceServers: window.AIRPLAY_CONFIG.STUN_SERVERS,
      iceCandidatePoolSize: 10
    };

    this.peerConnection = new RTCPeerConnection(config);
    this.remoteStream = new MediaStream();

    if (this.remoteVideoElement) {
      this.remoteVideoElement.srcObject = this.remoteStream;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    this.peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach((track) => {
        this.remoteStream.addTrack(track);
      });
      if (this.remoteVideoElement) {
        this.remoteVideoElement.play().catch(e => console.log("Remote video play error:", e));
      }
    };

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate);
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log("WebRTC Connection State:", state);

      if (state === 'failed' || state === 'disconnected') {
        this.startReconnectTimer();
      } else if (state === 'connected') {
        this.clearReconnectTimer();
      }

      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(state);
      }
    };
  }

  startReconnectTimer() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      console.warn("ICE reconnection timer triggered.");
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange('ICE_FAILED_TIMEOUT');
      }
    }, 15000);
  }

  clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  async createOffer() {
    if (!this.peerConnection) this.createPeerConnection();
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(offer) {
    if (!this.peerConnection) this.createPeerConnection();
    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    await this.flushPendingIceCandidates();
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(answer) {
    if (this.peerConnection && this.peerConnection.signalingState !== 'stable') {
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
      await this.flushPendingIceCandidates();
    }
  }

  async addIceCandidate(candidate) {
    if (this.peerConnection && this.peerConnection.remoteDescription) {
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error("Error adding ICE candidate:", e);
      }
    } else {
      // Queue candidate if remote description is not set yet
      this.pendingIceCandidates.push(candidate);
    }
  }

  async flushPendingIceCandidates() {
    while (this.pendingIceCandidates.length > 0) {
      const candidate = this.pendingIceCandidates.shift();
      try {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error("Error flushing ICE candidate:", e);
      }
    }
  }

  setVideoFilter(filterName) {
    this.activeFilter = filterName;
    const filterClass = `filter-${filterName}`;
    
    if (this.localVideoElement) {
      this.localVideoElement.className = filterClass;
    }
    if (this.remoteVideoElement) {
      this.remoteVideoElement.className = filterClass;
    }
  }

  toggleAudio() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        this.isAudioMuted = !audioTrack.enabled;
        return !this.isAudioMuted;
      }
    }
    return false;
  }

  toggleVideo() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        this.isVideoMuted = !videoTrack.enabled;
        return !this.isVideoMuted;
      }
    }
    return false;
  }

  close() {
    this.clearReconnectTimer();
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
    if (this.peerConnection) {
      this.peerConnection.close();
    }
  }
}

window.WebRTCManager = WebRTCManager;

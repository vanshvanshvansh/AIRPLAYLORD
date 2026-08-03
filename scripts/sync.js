// AirPlay — Real-time Game Sync, Session Metadata & Call History Engine (v2 Updated)

class SyncEngine {
  constructor(roomId, isHost = false, userName = "Player") {
    this.roomId = roomId;
    this.isHost = isHost;
    this.userName = userName;
    this.peerRole = isHost ? 'peerA' : 'peerB';
    this.opponentRole = isHost ? 'peerB' : 'peerA';

    this.db = window.AIRPLAY_CONFIG.getDb();
    this.useFirebase = window.AIRPLAY_CONFIG.isFirebaseActive();
    this.broadcastChannel = null;

    this.listeners = {};
    this.callStartTime = Date.now();
    this.gamesHistory = []; // Tracks finished games for Call End Summary
    this.localStore = {}; // Mirrors Firebase's node tree for BroadcastChannel fallback

    // Once WebRTC's data channel is open, these specific continuous-stream
    // paths route directly P2P instead of through Firebase — this is what
    // was causing the ~2s lag on paddle/ball/tug during live play, since
    // every single update had to round-trip through the Firebase server.
    // Everything else (scores, game/current start signal, etc.) stays on
    // Firebase since those are one-off events that need reliable delivery.
    this.dataChannel = null;
    this.REALTIME_PATHS = new Set([
      'game/paddleBall', 'game/paddleInput', 'game/tugMarker',
      'game/tugPull', 'game/puck', 'game/bottleAngle'
    ]);

    this.initTransport();
  }

  // Called once the WebRTC peer connection's game data channel opens.
  setDataChannel(channel) {
    this.dataChannel = channel;
    channel.addEventListener('message', (event) => {
      try {
        const { path, data } = JSON.parse(event.data);
        this.applyLocalWrite(path, data);
      } catch (e) {
        console.error('SyncEngine: bad data channel payload', e);
      }
    });
  }

  initTransport() {
    if (this.useFirebase && this.db) {
      console.log("SyncEngine: Using Firebase Realtime Database at rooms/" + this.roomId);
      this.roomRef = this.db.ref(`rooms/${this.roomId}`);
    } else {
      console.log("SyncEngine: Using BroadcastChannel fallback for room " + this.roomId);
      this.broadcastChannel = new BroadcastChannel(`airplay_room_${this.roomId}`);
      this.broadcastChannel.onmessage = (event) => {
        const { path, data, sender } = event.data;
        if (sender !== this.peerRole) {
          this.applyLocalWrite(path, data);
        }
      };
    }
  }

  // --- Local (BroadcastChannel) node-tree helpers ---------------------------
  // Firebase fires a parent's 'value' listener whenever any child path under
  // it changes (e.g. writing 'joinRequest/status' also triggers a listener
  // registered on 'joinRequest' with the merged object). The BroadcastChannel
  // fallback needs to replicate that exact behavior, otherwise Accept/Decline
  // (which write to a sub-path while the listener is on the parent path)
  // would silently never fire during same-browser local testing.
  setNestedValue(path, data) {
    const parts = path.split('/');
    let obj = this.localStore;
    for (let i = 0; i < parts.length - 1; i++) {
      const key = parts[i];
      if (typeof obj[key] !== 'object' || obj[key] === null) obj[key] = {};
      obj = obj[key];
    }
    obj[parts[parts.length - 1]] = data;
  }

  getNestedValue(path) {
    const parts = path.split('/');
    let obj = this.localStore;
    for (const key of parts) {
      if (obj === null || obj === undefined) return null;
      obj = obj[key];
    }
    return obj === undefined ? null : obj;
  }

  applyLocalWrite(path, data) {
    this.setNestedValue(path, data);
    Object.keys(this.listeners).forEach((listenerPath) => {
      if (path === listenerPath || path.startsWith(listenerPath + '/')) {
        this.listeners[listenerPath](this.getNestedValue(listenerPath));
      }
    });
  }

  listen(path, callback) {
    this.listeners[path] = callback;

    if (this.useFirebase && this.roomRef) {
      this.roomRef.child(path).on('value', (snapshot) => {
        callback(snapshot.val());
      });
    } else if (this.broadcastChannel) {
      const current = this.getNestedValue(path);
      if (current !== null) callback(current);
    }
  }

  write(path, data) {
    if (this.REALTIME_PATHS.has(path) && this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify({ path, data }));
        return;
      } catch (e) {
        console.error('SyncEngine: data channel send failed, falling back to Firebase', e);
      }
    }
    if (this.useFirebase && this.roomRef) {
      this.roomRef.child(path).set(data);
    } else if (this.broadcastChannel) {
      this.applyLocalWrite(path, data);
      this.broadcastChannel.postMessage({
        path,
        data,
        sender: this.peerRole
      });
    }
  }

  update(path, data) {
    if (this.useFirebase && this.roomRef) {
      this.roomRef.child(path).update(data);
    } else if (this.broadcastChannel) {
      const merged = { ...(this.getNestedValue(path) || {}), ...data };
      this.write(path, merged);
    }
  }

  recordGameFinished(gameId, durationSeconds, finalScores, winner) {
    const record = {
      gameId,
      durationSeconds,
      scores: { ...finalScores },
      winner,
      timestamp: Date.now()
    };
    this.gamesHistory.push(record);
    if (this.isHost) {
      this.write('session/gamesHistory', this.gamesHistory);
    }
  }

  sendEmojiReaction(emoji) {
    this.write('session/reaction', {
      emoji,
      from: this.peerRole,
      timestamp: Date.now()
    });
  }

  emitLocalEvent(path, data) {
    if (this.listeners[path]) {
      this.listeners[path](data);
    }
  }

  static lerp(start, end, alpha) {
    return start + (end - start) * Math.min(Math.max(alpha, 0), 1);
  }

  static lerpPosition(current, target, speed = 0.25) {
    if (!current) return { ...target };
    if (!target) return { ...current };
    return {
      x: SyncEngine.lerp(current.x, target.x, speed),
      y: SyncEngine.lerp(current.y, target.y, speed)
    };
  }

  destroy() {
    if (this.useFirebase && this.roomRef) {
      this.roomRef.off();
    }
    if (this.broadcastChannel) {
      this.broadcastChannel.close();
    }
  }
}

window.SyncEngine = SyncEngine;

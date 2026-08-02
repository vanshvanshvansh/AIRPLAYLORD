// AirPlay — Join Request & Game Invite Consent Manager (v2 Updated with Timer Selector)

class ConsentManager {
  constructor(syncEngine, options = {}) {
    this.sync = syncEngine;
    this.onJoinAccepted = options.onJoinAccepted || null;
    this.onJoinDeclined = options.onJoinDeclined || null;
    this.onGameInviteReceived = options.onGameInviteReceived || null;

    this.joinModal = document.getElementById('joinConsentModal');
    this.gameModal = document.getElementById('gameConsentModal');

    this.setupListeners();
  }

  setupListeners() {
    if (!this.sync) return;

    if (this.sync.isHost) {
      this.sync.listen('joinRequest', (request) => {
        if (request && request.status === 'pending') {
          this.showJoinRequestModal(request.name);
        }
      });
    } else {
      this.sync.listen('joinRequest', (request) => {
        if (request) {
          if (request.status === 'accepted' && this.onJoinAccepted) {
            this.onJoinAccepted();
          } else if (request.status === 'declined' && this.onJoinDeclined) {
            this.onJoinDeclined();
          }
        }
      });
    }

    this.sync.listen('game/invite', (invite) => {
      if (invite && invite.status === 'pending' && invite.from !== this.sync.peerRole) {
        this.showGameInviteModal(invite.game, invite.fromName || 'Peer', invite.timerDuration);
      }
    });
  }

  showJoinRequestModal(name) {
    const textEl = document.getElementById('joinModalText');
    const acceptBtn = document.getElementById('joinAcceptBtn');
    const declineBtn = document.getElementById('joinDeclineBtn');

    if (textEl) textEl.textContent = `${name} wants to join your video call.`;
    if (this.joinModal) this.joinModal.classList.add('active');

    acceptBtn.onclick = debounce(() => {
      this.joinModal.classList.remove('active');
      this.sync.write('joinRequest/status', 'accepted');
      if (this.onJoinAccepted) this.onJoinAccepted();
    });

    declineBtn.onclick = debounce(() => {
      this.joinModal.classList.remove('active');
      this.sync.write('joinRequest/status', 'declined');
      if (this.onJoinDeclined) this.onJoinDeclined();
    });
  }

  showGameInviteModal(gameId, fromName, timerDuration = 45) {
    const titleMap = {
      balloon: 'Balloon Duel',
      paddle: 'Paddle Duel (Pong/Breakout)',
      rps: 'Rock-Paper-Scissors Showdown',
      tug: 'Finger Tug of War',
      truth: 'Truth or Dare — Air Spin'
    };

    const textEl = document.getElementById('gameModalText');
    const acceptBtn = document.getElementById('gameAcceptBtn');
    const declineBtn = document.getElementById('gameDeclineBtn');

    const timerStr = timerDuration === 'unlimited' ? 'Unlimited Time' : `${timerDuration} seconds`;
    if (textEl) textEl.textContent = `${fromName} invited you to play ${titleMap[gameId] || gameId} (${timerStr})!`;

    if (this.gameModal) this.gameModal.classList.add('active');

    acceptBtn.onclick = debounce(() => {
      this.gameModal.classList.remove('active');
      this.sync.write('game/invite/status', 'accepted');
      if (this.onGameInviteReceived) {
        this.onGameInviteReceived(gameId, true, timerDuration);
      }
    });

    declineBtn.onclick = debounce(() => {
      this.gameModal.classList.remove('active');
      this.sync.write('game/invite/status', 'declined');
      if (this.onGameInviteReceived) {
        this.onGameInviteReceived(gameId, false, timerDuration);
      }
    });
  }

  sendJoinRequest(myIdName) {
    this.sync.write('joinRequest', {
      name: myIdName,
      status: 'pending',
      timestamp: Date.now()
    });
  }

  sendGameInvite(gameId, timerDuration = 45) {
    this.sync.write('game/invite', {
      game: gameId,
      from: this.sync.peerRole,
      fromName: this.sync.userName,
      timerDuration: timerDuration,
      status: 'pending',
      timestamp: Date.now()
    });
  }
}

window.ConsentManager = ConsentManager;

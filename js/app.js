/**
 * VanishText {Made by SUVX}
 * Main Application Orchestrator
 */

(function (window) {
  'use strict';

  document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize UI controller
    window.VanishUI.init();

    // 2. Initialize Room Session
    const roomSession = new window.VanishRoomSession();

    // 3. Initialize Chat Controller with DOM elements
    const chatController = new window.VanishChatController({
      messageList: document.getElementById('chat-messages-container'),
      textarea: document.getElementById('chat-input-textarea'),
      sendBtn: document.getElementById('btn-send-message'),
      charCount: document.getElementById('chat-char-counter')
    });
    chatController.attachRoom(roomSession);

    // Auto-detect join link parameter (?code=XXXX-XXXX-XXXX) for frictionless mobile / cross-network join
    try {
      if (typeof window !== 'undefined' && window.location && window.location.search) {
        const urlParams = new URLSearchParams(window.location.search);
        const codeFromUrl = urlParams.get('code') || urlParams.get('room');
        if (codeFromUrl) {
          const joinCodeInput = document.getElementById('join-code');
          if (joinCodeInput) {
            joinCodeInput.value = window.VanishValidation.formatRoomCode(codeFromUrl);
          }
          window.VanishUI.showView('join');
          const joinNickInput = document.getElementById('join-nickname');
          if (joinNickInput) joinNickInput.focus();
          window.VanishUI.showToast('Room code detected from link! Enter your nickname to join.', 'info', 4500);
        }
      }
    } catch (e) { }

    // Track active verification details
    let currentVerificationData = null;

    // Listen for server-synchronized clear chat
    roomSession.onChatCleared((info) => {
      chatController.handleClearChat(info.clearedAt, info.clearedBy);
    });

    // Listen for incoming guest admission request (Creator only)
    roomSession.onAdmissionRequest((info) => {
      window.VanishUI.showAdmissionPrompt(info.nickname);
    });

    // Helper to refresh the left sidebar (room code, participant count, participant list & removal buttons)
    const refreshSidebar = () => {
      if (window.VanishUI && typeof window.VanishUI.updateSidebar === 'function') {
        window.VanishUI.updateSidebar(
          roomSession.formattedCode,
          roomSession.participants,
          roomSession.role === 'creator',
          (participantId, nickname) => {
            if (confirm(`Remove ${nickname} from the room? Their access will be immediately revoked.`)) {
              roomSession.removeParticipant(participantId);
              window.VanishUI.showToast(`${nickname} removed from room.`, 'info');
              refreshSidebar();
            }
          }
        );
      }
    };

    // 4. Room Session State Handler
    let lastAppNoticeState = null;
    roomSession.onStateChange((newState, details) => {
      switch (newState) {
        case window.VANISH_ROOM_STATES.CREATING:
          // Loading state handled in form submit
          lastAppNoticeState = newState;
          break;

        case window.VANISH_ROOM_STATES.WAITING_FOR_PEER:
          lastAppNoticeState = newState;
          if (window.VanishUI.inviteCodeDisplay) {
            window.VanishUI.inviteCodeDisplay.textContent = details.formattedCode || '----';
          }
          window.VanishUI.showView('invite');
          window.VanishUI.updateChatStatus('waiting', details.roomType === 'group' ? 'Waiting for members to join...' : 'Waiting for partner to join...', details.transportName);
          window.VanishUI.updateParticipants(roomSession.localNickname, '', 1, details.maxParticipants, details.roomType);
          window.VanishUI.setCreatorControls(roomSession.role === 'creator', false);
          refreshSidebar();

          const btnSubmitCreateEl = document.getElementById('btn-submit-create');
          if (btnSubmitCreateEl) {
            btnSubmitCreateEl.disabled = false;
            btnSubmitCreateEl.textContent = 'CREATE ROOM';
          }
          break;

        case window.VANISH_ROOM_STATES.WAITING_FOR_ADMISSION:
          lastAppNoticeState = newState;
          window.VanishUI.showView('chat');
          window.VanishUI.updateChatStatus('waiting', 'Waiting for room creator to admit you...', details.transportName || 'Signaling');
          window.VanishUI.updateParticipants(roomSession.localNickname, 'Host (awaiting admission)');
          chatController.clearMessages();
          chatController.addSystemNotice(details.message || 'Waiting for room creator to admit you to the room...');
          break;

        case window.VANISH_ROOM_STATES.ADMISSION_REQUEST:
          // Prompt shown via onAdmissionRequest
          break;

        case window.VANISH_ROOM_STATES.ADMISSION_REJECTED:
          lastAppNoticeState = newState;
          window.VanishUI.showToast(details.message || 'Admission request declined by host.', 'error', 6000);
          chatController.clearMessages();
          roomSession.leaveRoom();
          window.VanishUI.showView('landing');
          break;

        case window.VANISH_ROOM_STATES.REMOVED_BY_CREATOR:
          lastAppNoticeState = newState;
          window.VanishUI.showToast(details.message || 'You were removed from the room by the creator.', 'error', 6000);
          chatController.clearMessages();
          roomSession.leaveRoom();
          window.VanishUI.showView('landing');
          break;

        case window.VANISH_ROOM_STATES.JOINING:
          window.VanishUI.showView('chat');
          window.VanishUI.updateChatStatus('connecting', 'Connecting to room...', 'Securing...');
          window.VanishUI.updateParticipants(roomSession.localNickname, 'Host (connecting...)');
          if (lastAppNoticeState !== window.VANISH_ROOM_STATES.JOINING) {
            chatController.clearMessages();
            lastAppNoticeState = window.VANISH_ROOM_STATES.JOINING;
          }
          break;

        case window.VANISH_ROOM_STATES.CONNECTING:
          window.VanishUI.showView('chat');
          window.VanishUI.updateChatStatus('connecting', 'Connecting to room...', 'Securing...');
          window.VanishUI.updateParticipants(roomSession.localNickname, 'Host (connecting...)');
          lastAppNoticeState = window.VANISH_ROOM_STATES.CONNECTING;
          break;

        case window.VANISH_ROOM_STATES.SIGNALING:
          window.VanishUI.showView('chat');
          window.VanishUI.updateChatStatus('signaling', 'Connecting to room...', 'Securing...');
          window.VanishUI.updateParticipants(roomSession.localNickname, 'Host (connecting...)');
          lastAppNoticeState = window.VANISH_ROOM_STATES.SIGNALING;
          break;

        case window.VANISH_ROOM_STATES.NEGOTIATING:
          window.VanishUI.showView('chat');
          window.VanishUI.updateChatStatus('negotiating', 'Connecting to room...', 'Securing...');
          window.VanishUI.updateParticipants(roomSession.localNickname, 'Host (connecting...)');
          lastAppNoticeState = window.VANISH_ROOM_STATES.NEGOTIATING;
          break;

        case window.VANISH_ROOM_STATES.VERIFYING:
          window.VanishUI.showView('chat');
          window.VanishUI.updateChatStatus('verifying', 'Securing connection...', 'Securing...');
          window.VanishUI.updateParticipants(roomSession.localNickname, 'Host (connecting...)');
          lastAppNoticeState = window.VANISH_ROOM_STATES.VERIFYING;
          break;

        case window.VANISH_ROOM_STATES.HANDSHAKE:
          lastAppNoticeState = newState;
          window.VanishUI.showView('chat');
          window.VanishUI.updateChatStatus('handshake', 'Securing connection...', 'Securing...');
          break;

        case window.VANISH_ROOM_STATES.CONNECTED:
          window.VanishUI.showView('chat');
          currentVerificationData = details.verification;

          window.VanishUI.updateChatStatus('connected', 'End-to-End Encrypted', 'End-to-End Encrypted');
          window.VanishUI.updateParticipants(
            details.localNickname,
            details.remoteNickname,
            details.participantCount,
            details.maxParticipants,
            details.roomType
          );
          window.VanishUI.setCreatorControls(roomSession.role === 'creator', true);
          refreshSidebar();

          const typeBadgeConn = document.getElementById('chat-type-badge');
          if (typeBadgeConn) {
            if (details.roomType === 'group') {
              typeBadgeConn.style.display = 'inline-block';
              typeBadgeConn.textContent = `Group Room (${details.participantCount || 2}/${details.maxParticipants || 10})`;
            } else {
              typeBadgeConn.style.display = 'none';
            }
          }

          if (window.VanishUI.chatRoomTitle) {
            window.VanishUI.chatRoomTitle.textContent = details.roomName || (details.roomType === 'group' ? 'Group Room' : 'Private Room');
          }

          if (window.VanishUI.btnVerifySession && details.verification) {
            window.VanishUI.btnVerifySession.style.display = 'inline-flex';
            window.VanishUI.btnVerifySession.innerHTML = `<span>🛡️</span><span>Verify</span>`;
          }

          chatController.addSystemNotice('End-to-end encrypted session active.');
          break;

        case window.VANISH_ROOM_STATES.PEER_DISCONNECTED:
          window.VanishUI.updateChatStatus('disconnected', 'Participant Disconnected', roomSession.transport ? roomSession.transport.getTransportName() : '');
          window.VanishUI.updateParticipants(roomSession.localNickname, '');
          window.VanishUI.setCreatorControls(roomSession.role === 'creator', false);
          refreshSidebar();
          chatController.addSystemNotice(details.message || 'Participant left the conversation.', true);
          break;

        case window.VANISH_ROOM_STATES.ROOM_FULL:
          window.VanishUI.showToast(details.message || 'This room is full. Only two participants are allowed.', 'error', 6000);
          window.VanishUI.showView('landing');
          break;

        case window.VANISH_ROOM_STATES.EXPIRED:
          window.VanishUI.showToast(details.message || 'Room session expired. All data permanently destroyed.', 'info', 6000);
          chatController.clearMessages();
          window.VanishUI.showView('landing');
          break;

        case window.VANISH_ROOM_STATES.FAILED:
        case window.VANISH_ROOM_STATES.ERROR:
          window.VanishUI.updateChatStatus('failed', 'Connection Failed', 'Offline');
          window.VanishUI.showToast(details.error || 'Connection failed.', 'error', 6000);
          if (lastAppNoticeState !== window.VANISH_ROOM_STATES.FAILED && lastAppNoticeState !== window.VANISH_ROOM_STATES.ERROR) {
            lastAppNoticeState = window.VANISH_ROOM_STATES.FAILED;
            chatController.addConnectionFailedNotice(
              details.error,
              async () => {
                try {
                  window.VanishUI.showToast('Reconnecting to room...', 'info', 3000);
                  await roomSession.retryConnection();
                } catch (reErr) {
                  console.error('[Retry Connection Failed]', reErr);
                  window.VanishUI.showToast(reErr.message || 'Retry failed.', 'error');
                }
              },
              () => {
                chatController.clearMessages();
                roomSession.leaveRoom();
                window.VanishUI.showView('landing');
              }
            );
          }
          break;

        case window.VANISH_ROOM_STATES.IDLE:
          if (window.VanishUI.btnVerifySession) {
            window.VanishUI.btnVerifySession.style.display = 'none';
          }
          window.VanishUI.setCreatorControls(false, false);
          break;
      }
    });

    // 5. Wire Landing Page Navigation
    const btnOpenCreate = document.getElementById('btn-open-create');
    const btnOpenJoin = document.getElementById('btn-open-join');
    const cardCreateAction = document.getElementById('card-create-action');
    const cardJoinAction = document.getElementById('card-join-action');
    const btnCancelCreate = document.getElementById('btn-cancel-create');
    const btnCancelJoin = document.getElementById('btn-cancel-join');
    const btnPrivacyModal = document.getElementById('btn-privacy-modal');
    const btnClosePrivacyModal = document.getElementById('btn-close-privacy');
    const btnCloseVerifyModal = document.getElementById('btn-close-verify');

    const openCreateView = () => {
      window.VanishUI.showView('create');
      const nickInput = document.getElementById('create-nickname');
      if (nickInput) nickInput.focus();
    };

    const openJoinView = () => {
      window.VanishUI.showView('join');
      const codeInput = document.getElementById('join-code');
      if (codeInput) codeInput.focus();
    };

    if (btnOpenCreate) {
      btnOpenCreate.addEventListener('click', (e) => {
        e.stopPropagation();
        openCreateView();
      });
    }
    if (cardCreateAction) {
      cardCreateAction.addEventListener('click', openCreateView);
    }

    if (btnOpenJoin) {
      btnOpenJoin.addEventListener('click', (e) => {
        e.stopPropagation();
        openJoinView();
      });
    }
    if (cardJoinAction) {
      cardJoinAction.addEventListener('click', openJoinView);
    }

    if (btnCancelCreate) {
      btnCancelCreate.addEventListener('click', () => window.VanishUI.showView('landing'));
    }

    if (btnCancelJoin) {
      btnCancelJoin.addEventListener('click', () => window.VanishUI.showView('landing'));
    }

    const btnCancelInvite = document.getElementById('btn-cancel-invite');
    if (btnCancelInvite) {
      btnCancelInvite.addEventListener('click', () => {
        chatController.clearMessages();
        roomSession.leaveRoom();
        window.VanishUI.showView('landing');
      });
    }

    if (btnPrivacyModal) {
      btnPrivacyModal.addEventListener('click', () => {
        window.VanishUI.openModal(window.VanishUI.modalPrivacy);
      });
    }

    if (btnClosePrivacyModal) {
      btnClosePrivacyModal.addEventListener('click', () => {
        window.VanishUI.closeModal(window.VanishUI.modalPrivacy);
      });
    }

    if (btnCloseVerifyModal) {
      btnCloseVerifyModal.addEventListener('click', () => {
        window.VanishUI.closeModal(window.VanishUI.modalVerification);
      });
    }

    // 6. Create Room Form Submit
    const formCreateRoom = document.getElementById('form-create-room');
    const btnSubmitCreate = document.getElementById('btn-submit-create');

    if (formCreateRoom) {
      formCreateRoom.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nickname = document.getElementById('create-nickname').value;
        const roomName = document.getElementById('create-roomname').value;
        const transportSelect = document.getElementById('create-transport-mode');
        const preferredTransport = transportSelect ? transportSelect.value : 'auto';

        const nickVal = window.VanishValidation.validateNickname(nickname);
        if (!nickVal.valid) {
          window.VanishUI.showToast(nickVal.error, 'error');
          return;
        }

        const maxPartSelect = document.getElementById('create-max-participants');
        const maxParticipants = maxPartSelect ? parseInt(maxPartSelect.value, 10) : 2;
        const roomType = 'direct'; // Strict 1-to-1 private chat only

        btnSubmitCreate.disabled = true;
        btnSubmitCreate.textContent = 'Generating Secure Room...';

        try {
          await roomSession.createRoom(nickname, roomName, preferredTransport, roomType, maxParticipants);
        } catch (err) {
          console.error('[Create Room Error]', err);
          window.VanishUI.showToast(err.message || 'Could not create private room.', 'error');
          btnSubmitCreate.disabled = false;
          btnSubmitCreate.textContent = 'CREATE ROOM';
        } finally {
          if (roomSession.state === window.VANISH_ROOM_STATES.CREATING || roomSession.state === window.VANISH_ROOM_STATES.ERROR || roomSession.state === window.VANISH_ROOM_STATES.IDLE) {
            btnSubmitCreate.disabled = false;
            btnSubmitCreate.textContent = 'CREATE ROOM';
          }
        }
      });
    }

    const selectRoomType = document.getElementById('create-room-type');
    const roomTypeHint = document.getElementById('room-type-hint');
    if (selectRoomType) {
      selectRoomType.addEventListener('change', () => {
        const isGroup = selectRoomType.value === 'group';
        if (roomTypeHint) {
          roomTypeHint.textContent = isGroup
            ? 'Group conversation for up to 10 participants with AES-256-GCM encryption.'
            : 'Direct 1-to-1 conversation with pairwise ECDH end-to-end encryption.';
        }
        if (btnSubmitCreate) {
          btnSubmitCreate.textContent = isGroup ? 'CREATE GROUP ROOM' : 'CREATE PRIVATE ROOM';
        }
      });
    }

    // 7. Invitation Screen Buttons
    if (window.VanishUI.btnCopyCode) {
      window.VanishUI.btnCopyCode.addEventListener('click', () => {
        window.VanishUI.copyInvitationCode(roomSession.formattedCode);
      });
    }

    if (window.VanishUI.btnCopyLink) {
      window.VanishUI.btnCopyLink.addEventListener('click', () => {
        window.VanishUI.copyJoinLink(roomSession.formattedCode);
      });
    }

    if (window.VanishUI.btnShareInvite) {
      window.VanishUI.btnShareInvite.addEventListener('click', () => {
        window.VanishUI.shareInvitationCode(roomSession.formattedCode);
      });
    }

    if (window.VanishUI.btnEnterRoom) {
      window.VanishUI.btnEnterRoom.addEventListener('click', () => {
        window.VanishUI.showView('chat');
        window.VanishUI.updateChatStatus('waiting', 'Waiting for partner to join...', roomSession.transport ? roomSession.transport.getTransportName() : '');
        window.VanishUI.updateParticipants(roomSession.localNickname, '');
        chatController.addSystemNotice(`Room ready. Share invitation code: ${roomSession.formattedCode}`);
      });
    }

    // 8. Join Room Form Submit & Code Auto-formatting
    const formJoinRoom = document.getElementById('form-join-room');
    const joinCodeInput = document.getElementById('join-code');
    const btnSubmitJoin = document.getElementById('btn-submit-join');

    if (joinCodeInput) {
      joinCodeInput.addEventListener('input', (e) => {
        const val = e.target.value;
        const formatted = window.VanishValidation.formatRoomCode(val);
        e.target.value = formatted;
      });
    }

    if (formJoinRoom) {
      formJoinRoom.addEventListener('submit', async (e) => {
        e.preventDefault();
        const rawCode = document.getElementById('join-code').value;
        const nickname = document.getElementById('join-nickname').value;
        const transportSelect = document.getElementById('join-transport-mode');
        const preferredTransport = transportSelect ? transportSelect.value : 'auto';

        const codeVal = window.VanishValidation.validateRoomCode(rawCode);
        if (!codeVal.valid) {
          window.VanishUI.showToast(codeVal.error, 'error');
          return;
        }

        const nickVal = window.VanishValidation.validateNickname(nickname);
        if (!nickVal.valid) {
          window.VanishUI.showToast(nickVal.error, 'error');
          return;
        }

        btnSubmitJoin.disabled = true;
        btnSubmitJoin.textContent = 'Joining & Verifying Slot...';

        try {
          await roomSession.joinRoom(rawCode, nickname, preferredTransport);
        } catch (err) {
          console.error('[Join Room Error]', err);
          if (roomSession.state !== window.VANISH_ROOM_STATES.FAILED && roomSession.state !== window.VANISH_ROOM_STATES.ERROR) {
            window.VanishUI.showToast(err.message || 'Failed to join room.', 'error', 6000);
            chatController.clearMessages();
            roomSession.leaveRoom();
            window.VanishUI.showView('join');
          }
        } finally {
          btnSubmitJoin.disabled = false;
          btnSubmitJoin.textContent = 'JOIN ROOM';
        }
      });
    }

    // 9. Chat Input, Auto-expand & Send Handling
    const chatTextarea = document.getElementById('chat-input-textarea');
    const btnSendMessage = document.getElementById('btn-send-message');
    const charCounter = document.getElementById('chat-char-counter');

    if (chatTextarea) {
      chatTextarea.addEventListener('input', () => {
        // Auto-expand textarea height up to 140px
        chatTextarea.style.height = 'auto';
        chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 140) + 'px';

        const len = chatTextarea.value.length;
        if (charCounter) {
          charCounter.textContent = `${len} / 2000`;
          if (len > 1900) {
            charCounter.classList.add('warning');
          } else {
            charCounter.classList.remove('warning');
          }
        }
      });

      chatTextarea.addEventListener('keydown', (e) => {
        // Enter sends message, Shift+Enter adds newline
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          chatController.handleSendMessage();
        }
      });
    }

    if (btnSendMessage) {
      btnSendMessage.addEventListener('click', () => {
        chatController.handleSendMessage();
      });
    }

    // 9b. One-Time View Image Attachment & Send Handling
    const btnAttachImage = document.getElementById('btn-attach-image');
    const chatImageInput = document.getElementById('chat-image-input');
    if (btnAttachImage && chatImageInput) {
      btnAttachImage.addEventListener('click', () => {
        chatImageInput.click();
      });

      chatImageInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) {
          await chatController.handleSendImage(file);
          chatImageInput.value = '';
        }
      });
    }

    // 9c. Full Screen Chat Toggle
    const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen');
    if (btnToggleFullscreen) {
      btnToggleFullscreen.addEventListener('click', () => {
        window.VanishUI.toggleFullscreen();
      });
    }

    // 9d. One-Time Image Viewer Close & Destroy Button
    const btnCloseImageViewer = document.getElementById('btn-close-image-viewer');
    if (btnCloseImageViewer) {
      btnCloseImageViewer.addEventListener('click', () => {
        window.VanishUI.closeImageViewer();
      });
    }

    // 10. Verification SAS Badge Click
    if (window.VanishUI.btnVerifySession) {
      window.VanishUI.btnVerifySession.addEventListener('click', () => {
        window.VanishUI.showVerificationDetails(
          currentVerificationData,
          roomSession.localNickname,
          roomSession.remoteNickname
        );
      });
    }

    // 11. Leave Room Button (Sidebar & Header)
    const triggerLeaveRoom = () => {
      if (confirm('Leave room and permanently destroy all active chat messages and session keys?')) {
        chatController.clearMessages();
        roomSession.leaveRoom();
        window.VanishUI.showToast('You left the room. Session keys and messages wiped.', 'info');
        window.VanishUI.showView('landing');
      }
    };
    if (window.VanishUI.btnLeaveRoom) {
      window.VanishUI.btnLeaveRoom.addEventListener('click', triggerLeaveRoom);
    }
    const btnHeaderLeave = document.getElementById('btn-header-leave');
    if (btnHeaderLeave) {
      btnHeaderLeave.addEventListener('click', triggerLeaveRoom);
    }

    // 11b. CLEAR CHAT FOR BOTH Button (Synchronized across both devices)
    if (window.VanishUI.btnClearChat) {
      window.VanishUI.btnClearChat.addEventListener('click', () => {
        if (confirm('Clear all chat messages for both participants? This cannot be undone.')) {
          roomSession.clearChatForBoth();
          window.VanishUI.showToast('Chat cleared for both participants.', 'info');
        }
      });
    }

    // 11c. Creator Control: REMOVE GUEST Button
    if (window.VanishUI.btnRemoveGuest) {
      window.VanishUI.btnRemoveGuest.addEventListener('click', () => {
        if (confirm('Remove guest from the room? Their access will be immediately revoked.')) {
          roomSession.removeGuest();
          window.VanishUI.setCreatorControls(true, false);
          chatController.addSystemNotice('You removed the guest from the room. You can invite another guest.');
          window.VanishUI.showToast('Guest removed from room.', 'info');
        }
      });
    }

    // 11d. Admission Request Modal & Sidebar Buttons
    if (window.VanishUI.btnAdmitGuest) {
      window.VanishUI.btnAdmitGuest.addEventListener('click', () => {
        window.VanishUI.hideAdmissionPrompt();
        roomSession.admitGuest();
        window.VanishUI.showToast('Guest admitted to the room.', 'success');
        refreshSidebar();
      });
    }

    if (window.VanishUI.btnRejectGuest) {
      window.VanishUI.btnRejectGuest.addEventListener('click', () => {
        window.VanishUI.hideAdmissionPrompt();
        roomSession.rejectGuest();
        window.VanishUI.showToast('Guest admission declined.', 'info');
        refreshSidebar();
      });
    }

    const btnSidebarAdmit = document.getElementById('btn-sidebar-admit');
    if (btnSidebarAdmit) {
      btnSidebarAdmit.addEventListener('click', () => {
        window.VanishUI.hideAdmissionPrompt();
        roomSession.admitGuest();
        window.VanishUI.showToast('Guest admitted to the room.', 'success');
        refreshSidebar();
      });
    }

    const btnSidebarReject = document.getElementById('btn-sidebar-reject');
    if (btnSidebarReject) {
      btnSidebarReject.addEventListener('click', () => {
        window.VanishUI.hideAdmissionPrompt();
        roomSession.rejectGuest();
        window.VanishUI.showToast('Guest admission declined.', 'info');
        refreshSidebar();
      });
    }

    // 11e. Sidebar Mobile Navigation, Drawer Toggle, Backdrop & Touch Dismiss
    const btnSidebarCopy = document.getElementById('btn-sidebar-copy');
    if (btnSidebarCopy) {
      btnSidebarCopy.addEventListener('click', () => {
        window.VanishUI.copyInvitationCode(roomSession.formattedCode);
      });
    }

    const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
    const chatSidebar = document.getElementById('chat-sidebar');
    const sidebarBackdrop = document.getElementById('sidebar-backdrop');
    const btnCloseSidebar = document.getElementById('btn-close-sidebar');
    const btnCloseSidebarX = document.getElementById('btn-close-sidebar-x');

    const openSidebar = () => {
      if (window.VanishUI && typeof window.VanishUI.openSidebar === 'function') {
        window.VanishUI.openSidebar();
      } else {
        if (!chatSidebar) return;
        chatSidebar.classList.add('mobile-open');
        if (sidebarBackdrop) sidebarBackdrop.classList.add('active');
      }
    };

    const closeSidebar = () => {
      if (window.VanishUI && typeof window.VanishUI.closeSidebar === 'function') {
        window.VanishUI.closeSidebar();
      } else {
        if (!chatSidebar) return;
        chatSidebar.classList.remove('mobile-open');
        if (sidebarBackdrop) sidebarBackdrop.classList.remove('active');
      }
    };

    if (btnToggleSidebar) {
      btnToggleSidebar.addEventListener('click', () => {
        if (chatSidebar && chatSidebar.classList.contains('mobile-open')) {
          closeSidebar();
        } else {
          openSidebar();
        }
      });
    }

    if (btnCloseSidebar) {
      btnCloseSidebar.addEventListener('click', closeSidebar);
    }
    if (btnCloseSidebarX) {
      btnCloseSidebarX.addEventListener('click', closeSidebar);
    }
    if (sidebarBackdrop) {
      sidebarBackdrop.addEventListener('click', closeSidebar);
    }

    // Android hardware / gesture back navigation support
    window.addEventListener('popstate', () => {
      if (chatSidebar && chatSidebar.classList.contains('mobile-open')) {
        closeSidebar();
      }
    });

    // Keyboard ESC closes sidebar
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && chatSidebar && chatSidebar.classList.contains('mobile-open')) {
        closeSidebar();
      }
    });

    // Touch swipe left on mobile sidebar to dismiss
    if (chatSidebar) {
      let touchStartX = 0;
      let touchStartY = 0;
      chatSidebar.addEventListener('touchstart', (e) => {
        if (e.touches && e.touches[0]) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
        }
      }, { passive: true });

      chatSidebar.addEventListener('touchend', (e) => {
        if (e.changedTouches && e.changedTouches[0]) {
          const deltaX = e.changedTouches[0].clientX - touchStartX;
          const deltaY = e.changedTouches[0].clientY - touchStartY;
          if (deltaX < -40 && Math.abs(deltaX) > Math.abs(deltaY)) {
            closeSidebar();
          }
        }
      }, { passive: true });
    }

    // Touch swipe right from screen left edge (<50px) to slide open room details panel
    let edgeTouchStartX = 0;
    let edgeTouchStartY = 0;
    window.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches[0]) {
        edgeTouchStartX = e.touches[0].clientX;
        edgeTouchStartY = e.touches[0].clientY;
      }
    }, { passive: true });

    window.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches[0]) {
        const deltaX = e.changedTouches[0].clientX - edgeTouchStartX;
        const deltaY = e.changedTouches[0].clientY - edgeTouchStartY;
        if (edgeTouchStartX <= 50 && deltaX > 50 && Math.abs(deltaX) > Math.abs(deltaY)) {
          if (window.VanishUI && window.VanishUI.currentView === 'chat') {
            openSidebar();
          }
        }
      }
    }, { passive: true });

    // Dynamic Viewport Resizing & Mobile Keyboard Anchoring
    const updateViewportHeight = () => {
      const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${height}px`);
      
      if (document.activeElement && document.activeElement.id === 'chat-input-textarea') {
        const msgContainer = document.getElementById('chat-messages-container');
        if (msgContainer) {
          msgContainer.scrollTop = msgContainer.scrollHeight;
        }
      }
    };

    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateViewportHeight);
      window.visualViewport.addEventListener('scroll', updateViewportHeight);
    }
    window.addEventListener('resize', updateViewportHeight);
    window.addEventListener('orientationchange', () => {
      setTimeout(updateViewportHeight, 100);
      setTimeout(updateViewportHeight, 300);
    });
    updateViewportHeight();

    const chatInput = document.getElementById('chat-input-textarea');
    if (chatInput) {
      chatInput.addEventListener('focus', () => {
        setTimeout(() => {
          updateViewportHeight();
          const msgContainer = document.getElementById('chat-messages-container');
          if (msgContainer) {
            msgContainer.scrollTop = msgContainer.scrollHeight;
          }
        }, 150);
      });
      chatInput.addEventListener('blur', () => {
        setTimeout(updateViewportHeight, 150);
      });
    }

    // 12. Privacy Blur Shield (Always ON in background)
    window.VanishUI.privacyBlurEnabled = true;
    const togglePrivacyBlur = document.getElementById('toggle-privacy-blur');
    if (togglePrivacyBlur) {
      togglePrivacyBlur.checked = true;
      togglePrivacyBlur.addEventListener('change', () => {
        togglePrivacyBlur.checked = true;
        window.VanishUI.privacyBlurEnabled = true;
      });
    }

    // 13. Immediate cleanup on tab close, page refresh, or navigation
    window.addEventListener('beforeunload', () => {
      chatController.clearMessages();
      roomSession.leaveRoom();
    });
    window.addEventListener('pagehide', () => {
      chatController.clearMessages();
      roomSession.leaveRoom();
    });
  });
})(window);

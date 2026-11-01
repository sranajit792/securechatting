/**
 * VanishText {Made by SUVX}
 * Chat Controller & Memory-Only Message Renderer
 *
 * Enforces:
 * - NO CHAT HISTORY: strictly zero localStorage, sessionStorage, or IndexedDB storage.
 * - Live in-memory message display only.
 * - Safe DOM manipulation: document.createTextNode & element.textContent exclusively.
 * - Immediate memory zeroing and DOM wiping when leaving the room.
 */

(function (window) {
  'use strict';

  class VanishChatController {
    constructor(elements) {
      this.elements = elements; // { messageList, textarea, sendBtn, charCount }
      this.liveMessages = [];   // Transient array in memory ONLY
      this.messageTimers = new Map(); // msgId -> setTimeout timerId
      this.activeImages = new Map();  // imageId -> { dataUrl, opened, expired, unopenedTimer, countdownInterval }
      this.isSending = false;
      this.roomSession = null;

      const cfgTtl = window.CHATSPACE_CONFIG && window.CHATSPACE_CONFIG.messaging && window.CHATSPACE_CONFIG.messaging.messageTtlMinutes;
      this.ttlMinutes = typeof cfgTtl === 'number' ? cfgTtl : 15;
      this.ttlMs = this.ttlMinutes * 60 * 1000; // 15 minutes in ms
      this.lastClearedTimestamp = 0; // Cutoff for server-synchronized clear chat

      this._sweeperInterval = null;
      this._onVisibilityChange = null;
      this._startSweeper();
    }

    /**
     * Start background sweeper to reliably enforce expiration during tab throttling or wake from sleep.
     * @private
     */
    _startSweeper() {
      if (this._sweeperInterval) clearInterval(this._sweeperInterval);
      this._sweeperInterval = setInterval(() => this.purgeExpiredMessages(), 2000);
      if (this._sweeperInterval && typeof this._sweeperInterval.unref === 'function') {
        this._sweeperInterval.unref();
      }

      this._onVisibilityChange = () => {
        if (typeof document !== 'undefined' && !document.hidden) {
          this.purgeExpiredMessages();
        }
      };
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', this._onVisibilityChange);
      }
      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('focus', this._onVisibilityChange);
      }
    }

    /**
     * Purge any messages whose real elapsed lifespan has exceeded 15 minutes.
     */
    purgeExpiredMessages() {
      const now = window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now();
      for (const msg of [...this.liveMessages]) {
        if (now >= msg.expiresAt) {
          this.deleteMessage(msg.id);
        }
      }
    }

    /**
     * Attach an active RoomSession instance to this chat controller.
     * @param {VanishRoomSession} roomSession
     */
    attachRoom(roomSession) {
      this.roomSession = roomSession;
      this.clearMessages();

      // Listen for decrypted messages from roomSession
      this.roomSession.onMessageReceived((msg) => {
        if (msg.isImageStatus) {
          this.handleImageStatus(msg.imageId, msg.status, msg.senderNick);
        } else if (msg.isImage) {
          this.addImageMessage(msg);
        } else {
          this.addMessage(msg);
        }
      });
    }

    /**
     * Clear all messages from UI and memory, canceling all independent deletion timers and wiping images.
     */
    clearMessages() {
      // Close any active image viewer modal immediately
      if (window.VanishUI && typeof window.VanishUI.closeImageViewer === 'function') {
        window.VanishUI.closeImageViewer();
      }

      // Cancel and wipe all active one-time image timers and data
      for (const imgEntry of this.activeImages.values()) {
        if (imgEntry.unopenedTimer) clearTimeout(imgEntry.unopenedTimer);
        if (imgEntry.countdownInterval) clearInterval(imgEntry.countdownInterval);
        imgEntry.dataUrl = null;
      }
      this.activeImages.clear();

      // Cancel all independent message timers
      for (const timerId of this.messageTimers.values()) {
        clearTimeout(timerId);
      }
      this.messageTimers.clear();
      this.liveMessages = [];
      if (this.elements && this.elements.messageList) {
        this.elements.messageList.textContent = '';
      }
      console.log('[VanishChat] In-memory chat messages and image data completely wiped and all message timers cleared.');
    }

    /**
     * Synchronized clear chat action triggered by trusted server coordination.
     * Prevents cleared messages from reappearing.
     * @param {number} clearedAt
     * @param {string} [clearedBy]
     */
    handleClearChat(clearedAt, clearedBy) {
      this.lastClearedTimestamp = typeof clearedAt === 'number' ? clearedAt : Date.now();
      this.clearMessages();
      if (clearedBy) {
        this.addSystemNotice(`Chat was cleared for both participants by ${clearedBy}.`);
      } else {
        this.addSystemNotice('Chat was cleared for both participants.');
      }
    }

    /**
     * Delete an individual message after its independent 15-minute timer expires.
     * @param {string} msgId
     */
    deleteMessage(msgId) {
      if (!msgId) return;

      if (this.messageTimers.has(msgId)) {
        clearTimeout(this.messageTimers.get(msgId));
        this.messageTimers.delete(msgId);
      }

      // If message is an image, cancel its timers and zero its memory
      if (this.activeImages.has(msgId)) {
        const imgEntry = this.activeImages.get(msgId);
        if (imgEntry.unopenedTimer) clearTimeout(imgEntry.unopenedTimer);
        if (imgEntry.countdownInterval) clearInterval(imgEntry.countdownInterval);
        imgEntry.dataUrl = null;
        this.activeImages.delete(msgId);
      }

      this.liveMessages = this.liveMessages.filter(m => m.id !== msgId);

      if (this.elements && this.elements.messageList && typeof this.elements.messageList.querySelector === 'function') {
        const row = this.elements.messageList.querySelector(`[data-msg-id="${msgId}"]`);
        if (row && typeof row.remove === 'function') {
          row.remove();
        }
      }
    }

    /**
     * Safely render and append a new message to the live view.
     * Uses textContent and createTextNode exclusively — NO innerHTML injection.
     * Schedules an independent 15-minute deletion timer.
     * @param {Object} msg { text, senderNick, isSelf, isSystem, isSecurityAlert, timestamp, id }
     */
    addMessage(msg) {
      const timestamp = typeof msg.timestamp === 'number'
        ? msg.timestamp
        : (window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now());

      // Reject any delayed or replayed message sent prior to the chat clear cutoff
      if (this.lastClearedTimestamp && timestamp <= this.lastClearedTimestamp && !msg.isSystem) {
        console.log(`[VanishChat] Message sent prior to chat clear (${timestamp} <= ${this.lastClearedTimestamp}). Discarded.`);
        return;
      }

      const now = window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now();
      const elapsed = now - timestamp;
      const remainingMs = this.ttlMs - elapsed;

      // Discard messages that have already expired
      if (remainingMs <= 0) {
        console.log(`[VanishChat] Incoming message has already expired (${elapsed}ms elapsed >= ${this.ttlMs}ms limit). Discarded.`);
        return;
      }

      const msgId = msg.id || ('msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9));
      const messageData = {
        ...msg,
        id: msgId,
        timestamp: timestamp,
        expiresAt: timestamp + this.ttlMs
      };

      this.liveMessages.push(messageData);

      if (this.elements && this.elements.messageList) {
        const row = document.createElement('div');
        row.className = `message-row ${msg.isSelf ? 'self' : msg.isSystem ? 'system' : 'peer'}`;
        if (msg.isSecurityAlert) row.classList.add('security-alert');
        if (typeof row.setAttribute === 'function') {
          row.setAttribute('data-msg-id', msgId);
        }

        if (msg.isSystem) {
          const sysCard = document.createElement('div');
          sysCard.className = 'system-message-card';

          const sysText = document.createElement('span');
          sysText.textContent = msg.text;

          sysCard.appendChild(sysText);
          row.appendChild(sysCard);
        } else {
          const bubble = document.createElement('div');
          bubble.className = 'message-bubble';

          // Sender header
          const header = document.createElement('div');
          header.className = 'message-header';

          const senderSpan = document.createElement('span');
          senderSpan.className = 'message-sender';
          senderSpan.textContent = msg.isSelf ? 'You' : msg.senderNick;

          const timeSpan = document.createElement('span');
          timeSpan.className = 'message-time';
          timeSpan.textContent = this._formatTime(timestamp);

          header.appendChild(senderSpan);
          header.appendChild(timeSpan);

          // Message text body (strictly textNode)
          const textBody = document.createElement('div');
          textBody.className = 'message-text';
          textBody.textContent = msg.text;

          bubble.appendChild(header);
          bubble.appendChild(textBody);
          row.appendChild(bubble);
        }

        this.elements.messageList.appendChild(row);

        // Scroll smoothly to bottom
        this.elements.messageList.scrollTop = this.elements.messageList.scrollHeight;
      }

      // Schedule independent 15-minute deletion timer
      const timerId = setTimeout(() => {
        this.deleteMessage(msgId);
      }, Math.max(0, remainingMs));

      this.messageTimers.set(msgId, timerId);
    }

    /**
     * Add a system notice into the live chat log (e.g. Handshake complete, partner joined).
     * @param {string} text
     * @param {boolean} [isAlert=false]
     */
    addSystemNotice(text, isAlert = false) {
      this.addMessage({
        text: text,
        senderNick: 'System',
        isSelf: false,
        isSystem: true,
        isSecurityAlert: isAlert,
        timestamp: window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now()
      });
    }

    /**
     * Safely render an interactive connection failure card with retry and back buttons.
     * Prevents infinite loading and duplicate connection attempts.
     * @param {string} errorMsg
     * @param {Function} [retryCallback]
     * @param {Function} [homeCallback]
     */
    addConnectionFailedNotice(errorMsg, retryCallback, homeCallback) {
      if (!this.elements || !this.elements.messageList) return;

      // Clean up any existing failed notice to prevent duplicate cards
      const existing = this.elements.messageList.querySelector('.connection-failed-row');
      if (existing) existing.remove();

      const row = document.createElement('div');
      row.className = 'message-row system connection-failed-row';

      const card = document.createElement('div');
      card.className = 'connection-failed-card';

      const icon = document.createElement('div');
      icon.className = 'connection-failed-icon';
      icon.textContent = '⚠️';

      const content = document.createElement('div');
      content.className = 'connection-failed-content';

      const title = document.createElement('div');
      title.className = 'connection-failed-title';
      title.textContent = 'Connection Failed';

      const desc = document.createElement('div');
      desc.className = 'connection-failed-desc';

      let cleanDesc = '';
      if (typeof errorMsg === 'string') {
        cleanDesc = errorMsg;
      } else if (errorMsg && typeof errorMsg === 'object') {
        cleanDesc = errorMsg.message || errorMsg.error || errorMsg.reason || '';
      }
      if (!cleanDesc || cleanDesc === '[object Object]' || cleanDesc === '{}') {
        cleanDesc = 'Unable to connect to room. Please verify the invitation code or confirm creator is online.';
      } else if (cleanDesc.includes('broker') || cleanDesc.includes('PeerJS') || cleanDesc.includes('timed out while locating')) {
        cleanDesc = 'Unable to locate room host. Please confirm the room code and ensure creator is online.';
      }
      desc.textContent = cleanDesc;

      const hint = document.createElement('div');
      hint.className = 'connection-failed-hint';
      hint.textContent = 'Please make sure both devices have an active internet connection and try reconnecting.';

      const actions = document.createElement('div');
      actions.className = 'connection-failed-actions';

      if (typeof retryCallback === 'function') {
        const btnRetry = document.createElement('button');
        btnRetry.type = 'button';
        btnRetry.className = 'btn-retry-connection';
        btnRetry.textContent = '🔄 Retry Connection';
        btnRetry.addEventListener('click', () => {
          btnRetry.disabled = true;
          btnRetry.textContent = '⏳ Retrying...';
          try {
            retryCallback();
          } catch (e) {
            btnRetry.disabled = false;
            btnRetry.textContent = '🔄 Retry Connection';
          }
        });
        actions.appendChild(btnRetry);
      }

      if (typeof homeCallback === 'function') {
        const btnHome = document.createElement('button');
        btnHome.type = 'button';
        btnHome.className = 'btn-home-return';
        btnHome.textContent = '🏠 Return to Home';
        btnHome.addEventListener('click', () => {
          homeCallback();
        });
        actions.appendChild(btnHome);
      }

      content.appendChild(title);
      content.appendChild(desc);
      content.appendChild(hint);
      content.appendChild(actions);

      card.appendChild(icon);
      card.appendChild(content);
      row.appendChild(card);

      this.elements.messageList.appendChild(row);
      this.elements.messageList.scrollTop = this.elements.messageList.scrollHeight;
    }

    /**
     * Safely render and handle an end-to-end encrypted one-time-view image.
     * Displays a blurred preview thumbnail and VIEW ONCE button for recipients.
     * Starts an independent 60-second unopened timer.
     * On click VIEW ONCE, displays temporary viewer, and permanently wipes image data from memory after closing.
     * @param {Object} msg { id, isSelf, imagePayload: { imageId, fileName, fileType, dataUrl }, senderNick, timestamp }
     */
    addImageMessage(msg) {
      const timestamp = typeof msg.timestamp === 'number'
        ? msg.timestamp
        : (window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now());

      // Reject if sent prior to chat clear cutoff
      if (this.lastClearedTimestamp && timestamp <= this.lastClearedTimestamp) {
        return;
      }

      const now = window.VanishTimeAuthority ? window.VanishTimeAuthority.now() : Date.now();
      const elapsed = now - timestamp;
      const remainingMs = this.ttlMs - elapsed;
      if (remainingMs <= 0) return;

      const imagePayload = msg.imagePayload || {};
      const imageId = msg.id || imagePayload.imageId || ('img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));

      const imageRecord = {
        id: imageId,
        dataUrl: imagePayload.dataUrl || '',
        fileName: imagePayload.fileName || 'photo.jpg',
        fileType: imagePayload.fileType || 'image/jpeg',
        opened: false,
        expired: false,
        unopenedSeconds: 60,
        unopenedTimer: null,
        countdownInterval: null,
        rowElement: null
      };
      this.activeImages.set(imageId, imageRecord);

      const msgData = {
        ...msg,
        id: imageId,
        timestamp: timestamp,
        expiresAt: timestamp + this.ttlMs
      };
      this.liveMessages.push(msgData);

      if (this.elements && this.elements.messageList) {
        const row = document.createElement('div');
        row.className = `message-row message-image-row ${msg.isSelf ? 'self' : 'peer'}`;
        row.setAttribute('data-msg-id', imageId);
        imageRecord.rowElement = row;

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble image-bubble';

        // Message Header
        const header = document.createElement('div');
        header.className = 'message-header';

        const senderSpan = document.createElement('span');
        senderSpan.className = 'message-sender';
        senderSpan.textContent = msg.isSelf ? 'You' : msg.senderNick;

        const timeSpan = document.createElement('span');
        timeSpan.className = 'message-time';
        timeSpan.textContent = this._formatTime(timestamp);

        const badgeSpan = document.createElement('span');
        badgeSpan.className = 'badge-view-once-indicator';
        badgeSpan.textContent = '🔒 ONE-TIME VIEW';

        header.appendChild(senderSpan);
        header.appendChild(badgeSpan);
        header.appendChild(timeSpan);
        bubble.appendChild(header);

        // Body Content
        const imageCard = document.createElement('div');
        imageCard.className = 'one-time-image-card';
        imageCard.setAttribute('id', `card-${imageId}`);

        if (msg.isSelf) {
          // Sender view: Shows outgoing one-time photo card
          const senderInfo = document.createElement('div');
          senderInfo.className = 'sender-image-info';

          const lockIcon = document.createElement('span');
          lockIcon.className = 'info-icon';
          lockIcon.textContent = '📷';

          const descText = document.createElement('div');
          descText.className = 'info-text-wrap';

          const title = document.createElement('strong');
          title.textContent = 'One-Time Photo Sent';

          const sub = document.createElement('span');
          sub.className = 'info-sub';
          sub.textContent = 'Disappears after recipient views once or after 60s.';

          const statusPill = document.createElement('span');
          statusPill.className = 'image-status-pill status-sent';
          statusPill.id = `status-${imageId}`;
          statusPill.textContent = 'Sent • Waiting for recipient';

          descText.appendChild(title);
          descText.appendChild(sub);
          descText.appendChild(statusPill);

          senderInfo.appendChild(lockIcon);
          senderInfo.appendChild(descText);
          imageCard.appendChild(senderInfo);
        } else {
          // Recipient view: Blurred preview thumbnail with VIEW ONCE button and 60s countdown
          const previewWrap = document.createElement('div');
          previewWrap.className = 'image-blur-wrap';

          // Blurred canvas/img thumbnail
          const thumb = document.createElement('img');
          thumb.className = 'blurred-thumb';
          thumb.alt = 'Blurred one-time image';
          thumb.draggable = false;
          // Set src to dataUrl for authentic blurred color silhouette
          if (imageRecord.dataUrl) {
            thumb.src = imageRecord.dataUrl;
          }

          const overlay = document.createElement('div');
          overlay.className = 'view-once-overlay';

          const viewBtn = document.createElement('button');
          viewBtn.type = 'button';
          viewBtn.className = 'btn-view-once';
          viewBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>VIEW ONCE</span>
          `;

          const timerBadge = document.createElement('span');
          timerBadge.className = 'image-unopened-badge';
          timerBadge.id = `unopened-timer-${imageId}`;
          timerBadge.textContent = '⏱️ Expires in 60s if unopened';

          overlay.appendChild(viewBtn);
          overlay.appendChild(timerBadge);

          previewWrap.appendChild(thumb);
          previewWrap.appendChild(overlay);
          imageCard.appendChild(previewWrap);

          const noticeRow = document.createElement('div');
          noticeRow.className = 'image-card-footer';
          noticeRow.textContent = 'Photo will be permanently deleted after viewing. Note: External screen capture cannot be prevented.';
          imageCard.appendChild(noticeRow);

          // 60-Second Unopened Timer
          let unopenedSecs = 60;
          imageRecord.countdownInterval = setInterval(() => {
            unopenedSecs -= 1;
            imageRecord.unopenedSeconds = unopenedSecs;
            const badgeEl = document.getElementById(`unopened-timer-${imageId}`);
            if (badgeEl) {
              badgeEl.textContent = `⏱️ Expires in ${unopenedSecs}s if unopened`;
            }
            if (unopenedSecs <= 0) {
              this._expireUnopenedImage(imageId);
            }
          }, 1000);

          // VIEW ONCE Button Click
          viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (imageRecord.opened || imageRecord.expired) return;

            // Clear unopened countdown
            if (imageRecord.countdownInterval) clearInterval(imageRecord.countdownInterval);
            if (imageRecord.unopenedTimer) clearTimeout(imageRecord.unopenedTimer);

            // Open temporary viewer modal
            if (window.VanishUI && typeof window.VanishUI.openImageViewer === 'function') {
              window.VanishUI.openImageViewer(imageRecord.dataUrl, () => {
                // On viewer closed: mark opened and permanently wipe image
                imageRecord.opened = true;
                imageRecord.expired = true;
                imageRecord.dataUrl = null; // Memory wipe!

                // Replace preview card with permanent destroyed state
                this._renderConsumedImageCard(imageId);

                // Send consumption sync to sender
                if (this.roomSession && typeof this.roomSession.sendImageConsumed === 'function') {
                  this.roomSession.sendImageConsumed(imageId);
                }
              });
            }
          });
        }

        bubble.appendChild(imageCard);
        row.appendChild(bubble);
        this.elements.messageList.appendChild(row);

        // Scroll to bottom
        this.elements.messageList.scrollTop = this.elements.messageList.scrollHeight;
      }

      // Schedule standard 15-minute deletion timer
      const timerId = setTimeout(() => {
        this.deleteMessage(imageId);
      }, Math.max(0, remainingMs));
      this.messageTimers.set(imageId, timerId);
    }

    /**
     * Mark unopened image expired after 60s limit and wipe data.
     * @private
     */
    _expireUnopenedImage(imageId) {
      const entry = this.activeImages.get(imageId);
      if (!entry) return;
      if (entry.countdownInterval) clearInterval(entry.countdownInterval);
      if (entry.unopenedTimer) clearTimeout(entry.unopenedTimer);
      entry.expired = true;
      entry.dataUrl = null; // Memory wipe!

      const card = document.getElementById(`card-${imageId}`);
      if (card) {
        card.innerHTML = '';
        card.className = 'one-time-image-card image-card-expired';
        const wrap = document.createElement('div');
        wrap.className = 'image-destroyed-content';
        wrap.innerHTML = `
          <div class="destroyed-icon">⏱️</div>
          <div class="destroyed-meta">
            <strong>Photo Expired Unopened</strong>
            <span>60s window elapsed. Image data was permanently wiped from session memory.</span>
          </div>
        `;
        card.appendChild(wrap);
      }
    }

    /**
     * Replace consumed image card with destroyed state.
     * @private
     */
    _renderConsumedImageCard(imageId) {
      const card = document.getElementById(`card-${imageId}`);
      if (card) {
        card.innerHTML = '';
        card.className = 'one-time-image-card image-card-consumed';
        const wrap = document.createElement('div');
        wrap.className = 'image-destroyed-content';
        wrap.innerHTML = `
          <div class="destroyed-icon">🔒</div>
          <div class="destroyed-meta">
            <strong>Photo Viewed Once</strong>
            <span>Image data was permanently destroyed from active session memory.</span>
          </div>
        `;
        card.appendChild(wrap);
      }
    }

    /**
     * Handle synchronized image consumption notification from partner.
     * @param {string} imageId
     * @param {string} status
     * @param {string} senderNick
     */
    handleImageStatus(imageId, status, senderNick) {
      if (status === 'consumed') {
        const pill = document.getElementById(`status-${imageId}`);
        if (pill) {
          pill.className = 'image-status-pill status-consumed';
          pill.textContent = `👁️ Opened & destroyed by ${senderNick || 'recipient'}`;
        }
      }
    }

    /**
     * Send one-time image from file input.
     * @param {File} file
     */
    async handleSendImage(file) {
      if (!this.roomSession || this.isSending) return;

      const val = window.VanishValidation.validateImageFile(file);
      if (!val.valid) {
        window.VanishUI.showToast(val.error, 'error');
        return;
      }

      this.isSending = true;
      try {
        window.VanishUI.showToast('Encrypting and sending one-time photo...', 'info', 2000);
        const sentMsg = await this.roomSession.sendImageMessage(file);
        this.addImageMessage(sentMsg);
      } catch (err) {
        console.error('[VanishChat] Send image error:', err);
        window.VanishUI.showToast(err.message || 'Failed to send image.', 'error');
      } finally {
        this.isSending = false;
      }
    }

    /**
     * Send message from input.
     */
    async handleSendMessage() {
      if (!this.roomSession || this.isSending) return;

      const rawText = this.elements.textarea ? this.elements.textarea.value : '';
      const val = window.VanishValidation.validateMessage(rawText);
      if (!val.valid) {
        window.VanishUI.showToast(val.error, 'error');
        return;
      }

      this.isSending = true;
      if (this.elements.sendBtn) this.elements.sendBtn.disabled = true;

      try {
        const sentMsg = await this.roomSession.sendMessage(val.sanitized);
        this.addMessage(sentMsg);

        // Clear input and reset char count
        if (this.elements.textarea) {
          this.elements.textarea.value = '';
          this.elements.textarea.style.height = 'auto';
        }
        if (this.elements.charCount) {
          this.elements.charCount.textContent = '0 / 2000';
        }
      } catch (err) {
        console.error('[VanishChat] Send error:', err);
        window.VanishUI.showToast(err.message || 'Failed to send message.', 'error');
      } finally {
        this.isSending = false;
        if (this.elements.sendBtn) this.elements.sendBtn.disabled = false;
        if (this.elements.textarea) this.elements.textarea.focus();
      }
    }

    _formatTime(timestamp) {
      const d = new Date(timestamp);
      const hours = d.getHours().toString().padStart(2, '0');
      const mins = d.getMinutes().toString().padStart(2, '0');
      return `${hours}:${mins}`;
    }

    destroy() {
      if (this._sweeperInterval) {
        clearInterval(this._sweeperInterval);
        this._sweeperInterval = null;
      }
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function' && this._onVisibilityChange) {
        document.removeEventListener('visibilitychange', this._onVisibilityChange);
      }
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function' && this._onVisibilityChange) {
        window.removeEventListener('focus', this._onVisibilityChange);
      }
      this.clearMessages();
    }
  }

  window.VanishChatController = VanishChatController;
})(window);

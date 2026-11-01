# PRIVACY.md — Privacy Policy & Data Minimization Notice
### VanishText {Made by SUVX}

At **VanishText**, privacy is an absolute structural commitment, not merely a policy statement. Our software is deliberately engineered from the ground up to prevent data collection, persistent tracking, and conversation storage.

---

## 1. Principles of Data Minimization

- **No User Accounts**: You do not register, create passwords, provide email addresses, verify phone numbers, or connect social profiles.
- **Temporary Nicknames Only**: Nicknames are ephemeral strings chosen for the duration of a single conversation and are never indexed or saved.
- **Strictly One-to-One**: No public directories, room searches, or group chats exist.
- **Text-Only**: Image uploads, video chats, voice recordings, and file attachments are completely blocked.

---

---

## 2. Zero Chat History & Ephemeral Lifecycle Rules

- **CLEAR CHAT FOR BOTH (Instant Synchronized Purge)**: Inside an active chat room, either participant can click **CLEAR CHAT FOR BOTH**. Following explicit confirmation, all displayed messages are wiped immediately from both participants' screens, transient memory, and DOM. The action is coordinated across devices with timestamp cutoff filtering to prevent delayed in-flight messages from ever reappearing upon arrival or reconnection.
- **Automatic Message Deletion (15-Minute Lifespan)**: Every message automatically disappears from both users' chat screens exactly 15 minutes after it was sent. Each message operates on its own independent 15-minute timer based on verified creation time.
- **Immediate Wiping on Leave Room**: When either user leaves the room, all displayed chat messages are cleared immediately for that user. Refreshing the page or rejoining does not and cannot restore previous messages.
- **1-Hour Room Expiration (Real Elapsed Time)**: Each room expires exactly 1 hour after creation, measured in real elapsed time. When 1 hour elapses, both users are disconnected, the chat interface is cleared, the invitation code is invalidated, and the expired room is permanently disabled.
- **No Room Reactivation**: An expired room can never be reactivated or re-entered. The creator must create a completely new room with a new invitation code.
- **No Persistent Chat History**: Chat messages are never saved to `localStorage`, `sessionStorage`, `IndexedDB`, databases, persistent queues, or chat logs. VanishText maintains zero persistent records of conversation contents.
- **Reliable Enforcement**: Message expiration and room expiration are enforced using real elapsed time checks, network-synchronized time authorities, and monotonic clock verification to prevent timer drift, tab-sleep suspension, or local clock manipulation from bypassing expiration.

---

## 3. End-to-End Encryption Disclosures

- All messages are encrypted directly inside your browser using **AES-256-GCM** with keys established via ephemeral **ECDH P-256** and **HKDF SHA-256**.
- The signaling provider and STUN/TURN relays only coordinate connection routing and packet forwarding. They receive **only encrypted ciphertext** and **never possess your private encryption keys** or message plaintext.
- Plaintext fallback is strictly prohibited.

---

## 4. Honest Privacy Guarantees & Technical Limitations

We do not make dishonest marketing claims that "every trace is permanently erased from all systems worldwide". True privacy engineering requires honest disclosure of technical realities:

1. **Unavoidable Infrastructure Metadata**: To negotiate direct WebRTC peer connections or relay packets across restrictive firewalls and cellular networks, standard Internet protocols require routing metadata:
   - **IP Addresses & Port Numbers**: Processed by STUN and TURN relay servers (e.g. Google STUN, Cloudflare, OpenRelay) to establish NAT traversal and forward encrypted packets.
   - **Connection Timestamps & Signaling Payloads**: Ephemeral rendezvous packets routed through the signaling broker during the initial handshake and admission coordination.
   - **Provider-Side Retention**: Third-party infrastructure providers (STUN/TURN operators, signaling relays, ISPs, VPNs) maintain their own operational logs that may record connection IPs and access timestamps according to their respective logging policies.
2. **Operating-System & Hardware Realities**:
   - While VanishText zeroizes memory buffers and destroys JavaScript variables, operating system memory management (such as OS swap/paging files, volatile RAM until overwritten, and browser process memory) is governed by the host operating system.
3. **Physical & Screen Capture Limits**:
   - While VanishText provides a Privacy Shield blur overlay upon window unfocus and blocks standard inspection shortcuts, no web application can prevent hardware capture cards, OS-level screen recording tools (OBS, Snipping Tool, ShadowPlay), external cameras, or a conversation partner manually photographing their display.
   - Choose your conversation partners wisely.

---

## 5. Contact & Authorship

VanishText is developed by **SUVX**.
Source code is transparent, framework-free, and open for inspection.

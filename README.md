# VanishText {Made by SUVX}
### Ephemeral, One-to-One, End-to-End Encrypted Private Chat

VanishText is a temporary, private, text-only chat website built strictly with **HTML5, CSS3, and Vanilla JavaScript (ES6+)**. It allows exactly two participants to create a private room, exchange a cryptographically secure random invitation code, establish a peer-to-peer authenticated session with genuine **End-to-End Encryption (AES-256-GCM + ECDH P-256)**, and chat without leaving any trace or chat history behind.

---

## 1. Key Features

- **Strict 1-to-1 Direct Chat & Sequential Guest Admission**: Support conversations between exactly one room creator and one admitted guest at a time. Third participants are rejected while the room is occupied. When a guest leaves or is removed, the creator can admit a new guest.
- **Cross-Network Communication (STUN & TURN Relays)**: Seamless, reliable WebRTC connections across different Wi-Fi networks, cellular/mobile data (CGNAT), different ISPs, and VPNs with fallback TURN relay support (ports 80 & 443 TCP/UDP/TURNS) that preserves genuine end-to-end encryption.
- **CLEAR CHAT FOR BOTH**: A dedicated, prominent button inside the chat room that prompts for confirmation and immediately wipes all displayed messages from both participants' screens, memory, and DOM, with server-side synchronization and delayed message cutoff filtering.
- **Creator Controls**: The room creator can admit the invited guest into the room or remove them at any time. Removing a guest immediately revokes their session token and blocks reconnection with stale credentials.
- **Genuine End-to-End Encryption**: Ephemeral Elliptic Curve Diffie-Hellman (**ECDH P-256**) key exchange with **HKDF (SHA-256)** and **AES-256-GCM** authenticated encryption with fresh 96-bit CSPRNG IVs on every message.
- **Short Authentication String (SAS)**: 6-digit numeric verification code and 4-symbol visual emoji fingerprint to verify session authenticity and eliminate Man-in-the-Middle (MITM) attacks.
- **Automatic 15-Minute Message Deletion**: Every message automatically disappears from all participants' chat screens exactly 15 minutes after it was sent. Each message operates on its own independent 15-minute timer based on real elapsed time.
- **Leave Room Instant Clearing**: When any user leaves the room (or refreshes/closes the page), all displayed chat messages are cleared immediately for that user. Previous messages are never restored upon rejoining or refreshing.
- **1-Hour Real Elapsed Room Expiration**: Each room expires exactly 1 hour after its creation, measured in real elapsed time. Upon expiration, all participants are disconnected, the chat interface is cleared, the invitation code is invalidated, and the expired room is permanently disabled.
- **Create a New Room**: Expired rooms can never be reactivated. To converse again, the creator must create a completely new room with a new invitation code.
- **Zero Chat History & Zero Persistence**: Messages exist exclusively in transient memory for their 15-minute lifespan. No chat text is ever written to `localStorage`, `sessionStorage`, `IndexedDB`, cookies, queues, or remote databases.
- **Strict Text-Only Policy**: Only plain text and Unicode emojis are accepted. Images, video files, voice messages, audio calls, video calls, screen capture, and file uploads are strictly forbidden and structurally excluded.
- **Honest Privacy Disclosures**: VanishText maintains no chat history, but does not falsely claim every trace is erased from all systems worldwide. Unavoidable infrastructure metadata (IPs, connection timestamps, ICE routing packets) processed by signaling brokers and STUN/TURN relays is disclosed.
- **Privacy Deterrents**: Privacy Shield auto-blur upon window blur or document minimization, along with keyboard shortcut interception (F12, PrintScreen, Ctrl+Shift+I/J/C, Ctrl+U, Ctrl+S, Ctrl+P).
- **Multi-Transport Support**:
  1. **Server Signaling Transport (Public Cross-Network WebRTC + STUN/TURN)**: Built-in WebSocket signaling coordinator and TURN credentials service.
  2. **PeerJS WebRTC**: Public PeerJS signaling broker for direct peer-to-peer data channels.
  3. **BroadcastChannel Local Dev Mode**: Built-in offline testing across browser tabs on the same machine without internet dependencies.

---

## 2. Technology Stack

- **Markup**: HTML5 (Semantic, accessible, WCAG AA contrast).
- **Styling**: Vanilla CSS3 (Custom design system, flexbox/grid, glassmorphism, responsive design, dark luxury palette).
- **Logic**: Vanilla JavaScript (ES6+ Native Browser APIs).
- **Cryptography**: Native Web Crypto API (`window.crypto.subtle`, `crypto.getRandomValues`).
- **No Frameworks**: 100% free of React, Angular, Vue, Svelte, TypeScript, Tailwind CSS, Bootstrap, jQuery, Socket.IO, Node.js, Express, or custom backend application servers.

---

## 3. Project Structure

```
SECURECHATSYSTEM/
|-- index.html              # Main application entry point & UI screens
|-- css/
|   |-- style.css           # Core design system, typography, dark mode tokens
|   |-- responsive.css      # Responsive rules for mobile, tablet, and desktop
|-- js/
|   |-- config.js           # Active configuration (public client endpoints only)
|   |-- config.example.js   # Configuration template & documentation
|   |-- validation.js       # Input validation, sanitization & rate limiting
|   |-- crypto.js           # Web Crypto E2EE engine (ECDH, HKDF, AES-GCM, SAS)
|   |-- transport.js        # Transport layer (PeerJS WebRTC & BroadcastChannel)
|   |-- rooms.js            # Room lifecycle, 60-min TTL, 2-participant limits
|   |-- chat.js             # In-memory transient message renderer (zero persistence)
|   |-- ui.js               # UI view switcher, clipboard copy, modals, privacy blur
|   |-- app.js              # Application orchestrator & event wiring
|-- assets/
|   |-- logo.svg            # VanishText vector brand icon
|-- test/
|   |-- runner.html         # Interactive visual test runner for all 50 test cases
|   |-- suite.js            # Automated test suite implementation
|-- README.md               # Architecture, setup, and usage documentation
|-- SECURITY.md             # Threat model, cryptographic protocol, and policies
|-- PRIVACY.md              # Privacy disclosures and data minimization policy
```

---

## 4. Communication Infrastructure & Setup

### Why is external infrastructure necessary?
A static frontend running on two isolated devices (e.g. Alice's phone and Bob's laptop) cannot establish direct contact without a rendezvous mechanism. WebRTC requires an ephemeral signaling exchange (SDP offer/answer and ICE candidates) so the two devices can discover each other's network addresses.

### Selected Architecture
1. **PeerJS WebRTC (Default Multi-Device Mode)**:
   - Uses the public PeerJS signaling broker (`0.peerjs.com:443`) and Google's public STUN servers (`stun.l.google.com:19302`).
   - The signaling broker only routes the ephemeral WebRTC handshake.
   - Once connected, messages flow **directly peer-to-peer via encrypted DataChannels**.
   - No chat messages or private keys ever touch the signaling broker.
2. **Local BroadcastChannel Transport (Built-in Dev Mode)**:
   - Requires zero network or internet access.
   - Connects two browser tabs on the same computer using `BroadcastChannel`.
   - Allows instant testing and verification.
3. **Optional Supabase Realtime**:
   - If enterprise websocket relay is desired, configure `config.js` with your Supabase project URL and public anon key. Only ephemeral realtime broadcast channels are used; no database tables store messages.

### How to Run Locally

You can run the built-in signaling and TURN relay coordination server:

```powershell
# Run the integrated static server, TURN credentials provider & signaling coordinator
node server.js

# Or with custom port
$env:PORT="8080"; node server.js
```

Open your browser to:
`http://localhost:8080` (or your configured port/domain).

---

## 5. How It Works (Step-by-Step)

1. **Room Creation & Creator Authentication**:
   - Alice clicks **CREATE ROOM**, enters nickname `Alice`, and clicks **CREATE PRIVATE ROOM**.
   - VanishText generates a CSPRNG invitation code using `crypto.getRandomValues()` (e.g., `AB7K-M9QP-X4RT`).
   - Alice generates an ephemeral ECDH P-256 keypair in browser memory.
   - Alice receives a private 256-bit unguessable `creatorSecret` proving room ownership on the signaling server.
   - Alice is registered as Participant 1.
2. **Invitation Sharing**:
   - Alice clicks **COPY ROOM CODE** (or **SHARE INVITATION**) to copy `AB7K-M9QP-X4RT`.
   - Alice privately shares the code with Bob out-of-band.
   - Alice clicks **ENTER ROOM**.
3. **Joining & Creator Admission**:
   - Bob opens VanishText on another device or network, clicks **JOIN ROOM**, enters `AB7K-M9QP-X4RT` and nickname `Bob`.
   - Bob generates an ephemeral ECDH P-256 keypair.
   - Bob requests admission from the room creator.
   - Alice receives an admission prompt: `"Bob would like to enter the room. Do you want to admit this guest?"`
   - Alice clicks **ADMIT GUEST** (or **REJECT**).
4. **Strict Admission Control (Max 2 Participants & Rejection of 3rd Participant)**:
   - While Alice and Bob occupy the room, if a third person (Charlie) attempts to join with the same code, the server immediately rejects Charlie with: `"This room is full. Only two participants are allowed."`
5. **Cryptographic Key Agreement (ECDH)**:
   - Alice and Bob exchange their public keys over the transport.
   - Both independently derive the shared 256-bit master secret via ECDH.
   - Using HKDF with SHA-256, both derive:
     - An **AES-256-GCM** encryption key.
     - A 6-digit **Short Authentication String (SAS)** and 4-emoji visual fingerprint.
   - Both verify the matching SAS code (`[ 🛡️ 849 204 ]`).
6. **Encrypted Real-Time Messaging (Direct & TURN Relay)**:
   - Every text message is encrypted using AES-256-GCM with a fresh 96-bit CSPRNG IV.
   - Additional Authenticated Data (AAD) binds `roomId`, `senderId`, and a strictly monotonic sequence number (`seq`) to protect against tampering, replay attacks, and cross-room message injection.
   - Messages travel directly peer-to-peer or via authenticated TURN relay when traversing symmetric NATs or restrictive firewalls.
   - Genuine E2EE is strictly preserved across all transports; signaling and TURN servers only ever route encrypted ciphertext.
7. **CLEAR CHAT FOR BOTH & Creator Removal**:
   - Either participant can click **CLEAR CHAT FOR BOTH** in the header. Upon confirmation, all displayed messages are wiped immediately from memory and the DOM for both users, and the timestamp cutoff drops any delayed in-flight messages.
   - The creator can click **REMOVE GUEST** at any time. This immediately revokes the guest's session token and prevents reconnection with stale credentials.
   - After a guest leaves or is removed, the creator can admit a different guest, but never more than one concurrent guest.
8. **Room Destruction, Expiration & Automatic Message Deletion**:
   - Every message automatically disappears from both users' screens exactly 15 minutes after it was sent on its own independent timer.
   - When a participant clicks **LEAVE ROOM** or closes/refreshes the tab, all displayed messages are wiped immediately for that user, cryptographic keys are zeroized, and state is reset. Previous messages are never restored.
   - Rooms automatically expire after exactly 1 hour from creation in real elapsed time. Upon expiration, both users are disconnected, the chat interface is cleared, the invitation code is invalidated, and the room is permanently disabled. Never reactivated.

---

## 6. Screenshot & Screen Recording Protections: Capabilities & Real Limits

### What VanishText Deterrents DO:
- Intercepts common inspection and capture hotkeys (`F12`, `PrintScreen`, `Ctrl+Shift+I/J/C`, `Ctrl+U`, `Ctrl+S`, `Ctrl+P`) and prevents default actions.
- Automatically blurs the active conversation whenever the window loses focus, is minimized, or the user switches tabs (Privacy Shield).

### What NO Web Application CAN Do:
- **Operating-system level screen capture** (e.g., Snipping Tool, macOS Cmd+Shift+4, third-party screen recorders, ShadowPlay, OBS).
- **Physical cameras** photographing the display.
- **Compromised devices** with kernel-level malware or unauthorized browser extensions.
- **Participants copying text**: Either user can manually write down or duplicate text.

---

## 7. Running the Automated Test Suite

VanishText includes both an automated Node.js CLI runner and an interactive browser test runner verifying all 84 security, cryptography, and network requirements.

### Run via Command Line
```powershell
node test/cli-runner.js
node test/integration-test.js
```

### Run in Browser
1. Open `test/runner.html` in your browser.
2. The test suite automatically executes all 84 unit and integration tests covering:
   - Landing page rendering and actions
   - Room creation and validation
   - Cryptographically secure invitation codes
   - WebRTC STUN/TURN cross-network relay configuration
   - CLEAR CHAT FOR BOTH and replay prevention
   - Strict 1-to-1 admission and third-participant rejection
   - Creator controls: admission, guest removal, and stale token revocation
   - Genuine E2EE over relay transports without plaintext fallback
   - 15-minute message deletion & 1-hour room expiration lifecycle
   - Zero-persistence guarantees
3. Click **RERUN ALL TESTS** to repeat execution.

---

## 8. Deployment Guidance

Deploying VanishText requires only a standard static web server that serves HTTPS:
- **GitHub Pages**
- **Cloudflare Pages**
- **Vercel / Netlify** (as static site)
- **Nginx / Caddy / Apache**

> **Note**: Modern Web Crypto APIs (`window.crypto.subtle`) require a **Secure Context** (`https://` or `http://localhost`). Ensure your production deployment serves traffic exclusively over HTTPS.

---

## 9. License & Credits

- Created by **SUVX**.
- Built with standard Web standards: HTML5, CSS3, ES6+ Vanilla JavaScript.

# SECURITY.md — Cryptographic Architecture & Threat Model
### VanishText {Made by SUVX}

This document details the security model, cryptographic implementation, threat considerations, and verification procedures implemented in **VanishText**.

---

## 1. Threat Model

### Assets to Protect
1. **Chat Message Plaintext**: Must only be readable by the two designated participants in the active room.
2. **Cryptographic Key Material**: Ephemeral private keys and derived AES session keys must never be exposed to signaling brokers, servers, storage, or third parties.
3. **Room Isolation**: Messages belonging to room $A$ must never be decipherable or accepted in room $B$.
4. **Authenticity & Integrity**: In-flight modifications, replays, or injection of messages must be detected and rejected immediately.

### Adversary Capabilities Considered
- **Passive Network Eavesdropper (ISP / Public Wi-Fi)**: Can inspect unencrypted network traffic.
  - *Defense*: Protected by transport encryption (HTTPS / WSS / WebRTC DTLS) and application-layer AES-256-GCM.
- **Compromised Signaling Broker (PeerJS / WebRTC Relay)**: The signaling server facilitates WebRTC rendezvous and could attempt to read payloads.
  - *Defense*: All chat payloads are end-to-end encrypted before transmission. The broker never receives private keys or plaintext.
- **Active Man-in-the-Middle (MITM)**: An attacker attempting to substitute their own public keys during the ECDH handshake.
  - *Defense*: The Short Authentication String (SAS) 6-digit verification code and visual fingerprint derived from the shared secret allow participants to detect key tampering out-of-band.
- **Replay / Reordering Attacker**: Re-transmitting previously intercepted ciphertext payloads.
  - *Defense*: Every message includes a strictly monotonic sequence number ($seq$) authenticated via Additional Authenticated Data (AAD). If $seq \le lastSeenSeq$, the message is rejected.
- **Cross-Room Injection**: Attempting to replay valid ciphertext from one room into another.
  - *Defense*: The unique `roomId` is cryptographically bound into the AAD of every message. Attempting to decrypt the payload in a different room results in an authentication tag failure.

---

## 2. Cryptographic Protocol Specifications

All cryptographic operations are executed natively using the standardized **W3C Web Crypto API** (`window.crypto.subtle`). No custom cipher algorithms are invented.

### A. Invitation Code Generation
- **Entropy Source**: `crypto.getRandomValues(new Uint8Array(12))`
- **Alphabet**: 32 unambiguous alphanumeric characters (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`), eliminating easily confused glyphs (`0`, `O`, `1`, `I`).
- **Keyspace**: $32^{12} \approx 1.15 \times 10^{18}$ possible combinations (~60 bits of cryptographic entropy).
- **Format**: `XXXX-XXXX-XXXX`

### B. Key Agreement: Ephemeral ECDH (P-256)
- **Algorithm**: Elliptic Curve Diffie-Hellman (`ECDH`).
- **Named Curve**: NIST P-256 (`prime256v1`).
- **Key Extractability**: Private key is non-extractable from memory where supported. Public key is exported in JWK format and exchanged over the signaling channel during room rendezvous.
- **Shared Secret Derivation**: Both participants calculate 256 bits of shared secret material via `crypto.subtle.deriveBits()`.

### C. Key Derivation: HKDF (SHA-256)
Using RFC 5869 HKDF:
1. **AES-256-GCM Key**:
   $$\text{AESKey} = \text{HKDF-Expand}(\text{PRK}, \text{"vanishtext-v1-aes-gcm:"} \parallel \text{roomId}, 256)$$
2. **SAS Authentication Bits**:
   $$\text{SASBits} = \text{HKDF-Expand}(\text{PRK}, \text{"vanishtext-v1-sas-auth:"} \parallel \text{roomId}, 128)$$

### D. Short Authentication String (SAS) & Visual Fingerprint
To defend against active MITM on the signaling channel:
- **6-Digit Code**: Computed from the first 4 bytes of $\text{SASBits}$ modulo $1,000,000$ (e.g. `849 204`).
- **Visual Fingerprint**: 4 security emojis mapped from bytes 4–7 (e.g. `🛡️ ⚡ 🔑 🔒`).
- **Hex Fingerprint**: 16 bytes displayed as 32 hex digits grouped into 4-character blocks.
- **Procedure**: Alice and Bob compare this code out-of-band. If they match, the session is free from MITM.

### E. Authenticated Encryption: AES-256-GCM
- **Cipher**: AES-GCM (Galois/Counter Mode) with 256-bit key and 128-bit authentication tag.
- **IV Generation**: A fresh, cryptographically secure 96-bit (12-byte) random initialization vector is generated for every single message via `crypto.getRandomValues()`.
- **Additional Authenticated Data (AAD)**:
  $$\text{AAD} = \text{UTF-8}(\text{roomId} \parallel \text{":"} \parallel \text{senderId} \parallel \text{":"} \parallel \text{seq})$$
- **Decryption & Verification**: If any byte of the ciphertext, IV, tag, or AAD is modified, `crypto.subtle.decrypt()` fails, the message is rejected, and a security warning is logged.
- **Relay Transport Security**: When messages are relayed via WebRTC TURN or the server signaling coordinator, genuine AES-256-GCM E2EE is strictly preserved. Neither the TURN relay nor the signaling server possesses the cryptographic keys or plaintext. Plaintext fallback is structurally prohibited.

---

## 3. Room Authorization & Participant Admission Control

- **Strict Limit**: Exactly 2 authorized participants at most (1 creator and 1 admitted guest).
- **Server-Side Enforcement**:
  - The room creator is assigned an unguessable 256-bit `creatorSecret` generated via `crypto.randomBytes(32)` on room creation.
  - Creator actions (`ADMIT_GUEST`, `REMOVE_GUEST`, `CLEAR_CHAT`) require this secret and are validated strictly on the server.
  - A prospective guest requests admission (`REQUEST_ADMISSION`).
  - Only when the creator accepts (`ADMIT_GUEST`), the server issues a cryptographically random, ephemeral `guestToken`.
  - While the room is occupied by creator and guest, any 3rd participant attempting to connect is immediately rejected by the server with `ROOM_FULL`.
  - The room creator can remove the guest (`REMOVE_GUEST`) at any time. The server immediately revokes the guest's token, adds it to a blacklist, terminates the guest's connection, and prevents reconnection with stale credentials.
  - After a guest leaves or is removed, the creator may admit a different guest, but never more than one concurrent guest.

---

## 4. Zero Message Persistence, Expiration & Clear Chat Lifecycle

- **CLEAR CHAT FOR BOTH**:
  - Either participant can trigger a complete room chat wipe.
  - VanishText requires explicit confirmation before initiating the clear.
  - When confirmed, a `CLEAR_CHAT` command is sent to the server coordinator.
  - The server records `room.clearedAt = Date.now()` and broadcasts `CHAT_CLEARED` to both peers.
  - Both clients immediately purge all in-memory chat messages, cancel all active message deletion timers, wipe the DOM, and update their local `lastClearedTimestamp`.
  - **Replay / Delayed Message Defense**: Any in-flight or delayed messages with timestamp $\le \text{clearedAt}$ are automatically dropped by both server and clients, preventing cleared messages from reappearing after network delays or reconnection.
- **Independent 15-Minute Message Deletion**: Every message automatically disappears from both users' chat screens exactly 15 minutes after it was sent. Each message maintains its own independent 15-minute timer based on verified creation time, with background active sweepers enforcing removal even after tab sleep or background throttling.
- **Immediate Leave-Room Message Wiping**: Clicking **LEAVE ROOM** (or closing/refreshing the page) immediately clears all displayed chat messages for that user and purges all active message timers. Messages are never saved to `localStorage`, `sessionStorage`, `IndexedDB`, databases, persistent queues, or chat logs, and cannot be restored upon rejoining or refreshing.
- **1-Hour Real Elapsed Room Expiration**: Every room has an immutable 1-hour lifespan measured using real elapsed time (monotonic performance clocks and synchronized time authorities). When 1 hour passes from creation:
  - Both participants are immediately disconnected.
  - The chat interface is completely cleared.
  - The room invitation code is permanently invalidated.
  - The expired room is permanently disabled.
- **Prohibition on Room Reactivation**: An expired room cannot be reopened or reactivated. The creator must generate a completely new room with a brand-new CSPRNG invitation code and fresh ephemeral keys.
- **Defense Against Clock Tampering**: Real elapsed time is tracked using `Math.max(wallTimeDelta, monotonicPerfDelta)` and validated server timestamps, preventing clients from rolling back their system clock to prolong message or room lifespans.

---

## 5. Defense Against Common Web Vulnerabilities

- **Cross-Site Scripting (XSS)**: All user-supplied text (nicknames, room names, message bodies) is rendered via `document.createTextNode()` and `element.textContent`. No `innerHTML` interpolation is used for message content.
- **Eval & Dynamic Execution**: Zero use of `eval()`, `new Function()`, or dynamic script injection.
- **No Secret Key Leakage**: The frontend code contains zero private server keys, database credentials, or privileged API tokens.

---

## 6. Known Security Limitations & Non-Goals

1. **Hardware / OS-Level Capture**: No web browser can prevent operating-system screenshot utilities, external screen recorders, or someone photographing the physical screen with another camera.
2. **Client Endpoint Integrity**: If a user's machine is compromised by keyloggers, screen recording trojans, or malicious browser extensions with full DOM access, browser-based cryptography cannot guarantee confidentiality.
3. **Metadata**: External infrastructure (such as STUN servers or signaling relays) necessarily processes network metadata (IP addresses, connection timestamps, packet sizes) to establish network routes.

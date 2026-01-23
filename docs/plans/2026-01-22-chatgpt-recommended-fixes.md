# ChatGPT-Recommended Security & Config Fixes

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix wrangler secrets binding issue and implement security improvements recommended by ChatGPT code review.

**Architecture:** Add `keep_vars = true` to wrangler config, move only actual secrets to `wrangler secret put`, upgrade wrangler, improve WebSocket auth to check during upgrade, add constant-time comparison for API keys.

**Tech Stack:** Cloudflare Workers, Durable Objects, wrangler CLI

---

## Task 1: Fix Wrangler Secrets Binding

**Files:**
- Modify: `ccr-worker/wrangler.toml`

**Step 1: Add keep_vars and restructure vars**

Edit `ccr-worker/wrangler.toml`:

```toml
name = "ccr-router"
main = "src/index.js"
compatibility_date = "2024-01-01"
keep_vars = true  # Prevent deploy from wiping secrets

[durable_objects]
bindings = [
  { name = "ROUTER", class_name = "RouterDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RouterDO"]

[vars]
# Non-sensitive config (safe in version control)
ALLOWED_CHAT_IDS = "8248645256"
# ALLOWED_USER_IDS = ""  # Optional, comma-separated

# Secrets (set via wrangler secret put, NOT here):
# CCR_API_KEY
# TELEGRAM_BOT_TOKEN
# TELEGRAM_WEBHOOK_SECRET
```

**Step 2: Deploy with keep_vars**

```bash
cd /home/dev/projects/ccr-worker
export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"
wrangler deploy
```

**Step 3: Set secrets AFTER deploy**

```bash
# CCR_API_KEY
printf 'OOytSFvLS0Yd5sjMwU2JpJ9PbMgqSE9g' | wrangler secret put CCR_API_KEY

# Verify
wrangler secret list
```

**Step 4: Test that secrets now work**

```bash
# Test unauthenticated (should fail)
curl -s -X POST "https://ccr-router.jonathan-mohrbacher.workers.dev/sessions/register" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test","machineId":"test"}'
# Expected: {"error":"Unauthorized"}

# Test authenticated (should succeed)
curl -s -X POST "https://ccr-router.jonathan-mohrbacher.workers.dev/sessions/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer OOytSFvLS0Yd5sjMwU2JpJ9PbMgqSE9g" \
  -d '{"sessionId":"test","machineId":"test"}'
# Expected: {"ok":true,...}
```

**Step 5: Commit**

```bash
git add wrangler.toml
git commit -m "fix: add keep_vars, move CCR_API_KEY to secret"
```

---

## Task 2: Upgrade Wrangler

**Step 1: Check current version**

```bash
wrangler --version
# Expected: 4.51.0
```

**Step 2: Upgrade wrangler in the devbox config**

Edit `/home/dev/projects/workstation/users/dev/home.linux.nix` to update wrangler if it's pinned there, or use npm:

```bash
# If using npm global:
npm install -g wrangler@latest

# Verify
wrangler --version
# Expected: 4.60.0 or higher
```

**Step 3: Re-deploy to verify upgrade works**

```bash
cd /home/dev/projects/ccr-worker
export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"
wrangler deploy
```

**Step 4: Commit if nix config changed**

---

## Task 3: Add Constant-Time API Key Comparison

**Files:**
- Modify: `ccr-worker/src/router-do.js` (verifyApiKey method)

**Step 1: Replace string comparison with constant-time comparison**

Find `verifyApiKey()` method and replace:

```javascript
verifyApiKey(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.slice(7);
  const expected = this.env.CCR_API_KEY;

  // Constant-time comparison to prevent timing attacks
  if (!expected || token.length !== expected.length) {
    return false;
  }

  const encoder = new TextEncoder();
  const a = encoder.encode(token);
  const b = encoder.encode(expected);

  // crypto.subtle.timingSafeEqual is not available in Workers
  // Use manual constant-time comparison
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
```

**Step 2: Deploy and test**

```bash
wrangler deploy

# Test auth still works
curl -s -X POST "https://ccr-router.jonathan-mohrbacher.workers.dev/sessions/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer OOytSFvLS0Yd5sjMwU2JpJ9PbMgqSE9g" \
  -d '{"sessionId":"test","machineId":"test"}'
```

**Step 3: Commit**

```bash
git add src/router-do.js
git commit -m "security: use constant-time comparison for API key"
```

---

## Task 4: Improve WebSocket Auth (Check During Upgrade)

**Files:**
- Modify: `ccr-worker/src/router-do.js` (handleWebSocket method)
- Modify: `claude-code-remote/src/worker-client/machine-agent.js` (connect method)

**Step 1: Update handleWebSocket to check Sec-WebSocket-Protocol**

The WebSocket handshake can include auth via subprotocol. Replace `handleWebSocket()`:

```javascript
async handleWebSocket(request) {
  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId');

  if (!machineId) {
    return new Response('machineId required', { status: 400 });
  }

  // Check auth via Sec-WebSocket-Protocol header
  // Client sends: Sec-WebSocket-Protocol: ccr, <api-key>
  const protocols = request.headers.get('Sec-WebSocket-Protocol');
  if (!protocols) {
    return new Response('Authentication required', { status: 401 });
  }

  const parts = protocols.split(',').map(p => p.trim());
  if (parts[0] !== 'ccr' || parts.length < 2) {
    return new Response('Invalid protocol', { status: 401 });
  }

  const apiKey = parts[1];
  const expected = this.env.CCR_API_KEY;

  // Constant-time comparison
  if (!expected || apiKey.length !== expected.length) {
    return new Response('Invalid API key', { status: 401 });
  }

  const encoder = new TextEncoder();
  const a = encoder.encode(apiKey);
  const b = encoder.encode(expected);
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  if (result !== 0) {
    return new Response('Invalid API key', { status: 401 });
  }

  // Auth passed - accept WebSocket
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  // Close existing connection for this machine
  const existing = this.machines.get(machineId);
  if (existing && existing !== server) {
    existing.close(4000, 'Replaced by new connection');
  }

  this.machines.set(machineId, server);
  server.accept();

  console.log(`Machine authenticated and connected: ${machineId}`);

  // Flush queued commands
  this.flushCommandQueue(machineId, server);

  server.addEventListener('message', async (event) => {
    try {
      const msg = JSON.parse(event.data);
      await this.handleMachineMessage(machineId, msg);
    } catch (err) {
      console.error('Error handling machine message:', err);
    }
  });

  server.addEventListener('close', () => {
    console.log(`Machine disconnected: ${machineId}`);
    if (this.machines.get(machineId) === server) {
      this.machines.delete(machineId);
    }
  });

  server.addEventListener('error', (err) => {
    console.error(`WebSocket error for ${machineId}:`, err);
    if (this.machines.get(machineId) === server) {
      this.machines.delete(machineId);
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: {
      'Sec-WebSocket-Protocol': 'ccr'  // Echo back the protocol
    }
  });
}
```

**Step 2: Update machine-agent.js to send auth in subprotocol**

In `claude-code-remote/src/worker-client/machine-agent.js`, update `connect()`:

```javascript
async connect() {
  if (!this.workerUrl) {
    logger.warn('CCR_WORKER_URL not set - machine agent disabled');
    return;
  }

  if (!this.apiKey) {
    logger.warn('CCR_API_KEY not set - machine agent disabled');
    return;
  }

  const wsUrl = this.workerUrl.replace(/^http/, 'ws') + `/ws?machineId=${encodeURIComponent(this.machineId)}`;

  logger.info(`Connecting to Worker: ${wsUrl}`);

  try {
    // Send API key via Sec-WebSocket-Protocol header
    // Format: "ccr, <api-key>"
    this.ws = new WebSocket(wsUrl, [`ccr`, this.apiKey]);

    this.ws.on('open', () => {
      logger.info(`Authenticated and connected as ${this.machineId}`);
      this.reconnectDelay = 1000;
      this.startPing();
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });

    this.ws.on('close', (code, reason) => {
      logger.warn(`WebSocket closed (${code}: ${reason}), reconnecting...`);
      this.stopPing();
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      logger.error('WebSocket error:', err.message);
    });

  } catch (err) {
    logger.error('Failed to connect:', err.message);
    this.scheduleReconnect();
  }
}
```

**Step 3: Remove authSuccess handler (no longer needed)**

In `handleMessage()`, remove the `authSuccess` handling since auth now happens during upgrade:

```javascript
handleMessage(data) {
  try {
    const msg = JSON.parse(data);

    if (msg.type === 'pong') {
      return;
    }

    if (msg.type === 'command') {
      logger.info(`Received command for session ${msg.sessionId}: ${msg.command.slice(0, 50)}`);
      this.onCommand(msg);
      return;
    }

    logger.debug('Unknown message:', msg);
  } catch (err) {
    logger.error('Error parsing message:', err.message);
  }
}
```

**Step 4: Deploy Worker**

```bash
cd /home/dev/projects/ccr-worker
wrangler deploy
```

**Step 5: Commit both repos**

```bash
cd /home/dev/projects/ccr-worker
git add src/router-do.js
git commit -m "security: WebSocket auth via Sec-WebSocket-Protocol header"

cd /home/dev/projects/claude-code-remote
git add src/worker-client/machine-agent.js
git commit -m "security: send API key in WebSocket subprotocol"
```

---

## Task 5: Clean Up and Final Test

**Step 1: Remove any debug endpoints**

Verify no `/debug-env` or similar endpoints remain in production code.

**Step 2: Full integration test**

```bash
# 1. Restart the telegram webhook with new machine-agent
cd /home/dev/projects/claude-code-remote
npm run telegram

# 2. Send a test notification via Telegram to verify full flow works
```

**Step 3: Push changes**

```bash
cd /home/dev/projects/ccr-worker
git push

cd /home/dev/projects/claude-code-remote
git push
```

**Step 4: Update beads**

```bash
cd /home/dev/projects/claude-code-remote
bd sync
```

---

## Summary

| Task | What it fixes |
|------|---------------|
| 1 | Wrangler secrets binding (keep_vars + set after deploy) |
| 2 | Upgrade wrangler to latest |
| 3 | Timing attack mitigation (constant-time comparison) |
| 4 | WebSocket auth before accept (no 10s window for resource exhaustion) |
| 5 | Cleanup and integration test |

**After completion:**
- Secrets properly bound via `wrangler secret put`
- No secrets in version-controlled wrangler.toml
- Constant-time API key comparison
- WebSocket connections rejected at upgrade if not authenticated
- No debug endpoints in production

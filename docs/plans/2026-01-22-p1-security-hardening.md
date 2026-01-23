# P1 Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add authentication and access control to CCR Worker to prevent unauthorized access to all endpoints.

**Architecture:** Add API key auth for HTTP endpoints, first-message auth for WebSocket, bind token routing to chat_id, and add Telegram chat/user allowlist. All auth happens in the Worker (router-do.js). Machine agent sends API key in headers.

**Tech Stack:** Cloudflare Workers, Durable Objects, WebSocket

**Beads:** ccr-mvi, ccr-5cq, ccr-g8o, ccr-vt2

---

## Task 1: Add API Key Authentication to HTTP Endpoints

**Beads:** ccr-mvi

**Files:**
- Modify: `ccr-worker/src/router-do.js:485-535` (fetch method)
- Modify: `ccr-worker/wrangler.toml`
- Modify: `claude-code-remote/src/worker-client/machine-agent.js:113-148`

**Step 1: Add CCR_API_KEY to wrangler.toml as secret reference**

Edit `ccr-worker/wrangler.toml` to document the required secret:

```toml
name = "ccr-router"
main = "src/index.js"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "ROUTER", class_name = "RouterDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RouterDO"]

[vars]
# Set via wrangler secret:
# TELEGRAM_WEBHOOK_SECRET = ""
# TELEGRAM_BOT_TOKEN = ""
# CCR_API_KEY = ""
```

**Step 2: Add auth check helper in router-do.js**

Add this method after `verifyWebhookSecret()` (around line 193):

```javascript
verifyApiKey(request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.slice(7);
  return token === this.env.CCR_API_KEY;
}
```

**Step 3: Add auth check to protected routes in fetch()**

In the `fetch()` method, add auth checks before handling protected endpoints. After `await this.initialize();` and path extraction, add:

```javascript
// Routes that require API key authentication
const protectedRoutes = [
  '/sessions/register',
  '/sessions/unregister',
  '/sessions',
  '/notifications/send',
  '/cleanup'
];

const needsAuth = protectedRoutes.some(route => path === route || path.startsWith(route + '/'));

if (needsAuth && !this.verifyApiKey(request)) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}
```

**Step 4: Update machine-agent.js to send API key**

In `claude-code-remote/src/worker-client/machine-agent.js`, update the constructor to accept apiKey:

```javascript
constructor(options = {}) {
  this.workerUrl = options.workerUrl || process.env.CCR_WORKER_URL;
  this.machineId = options.machineId || process.env.CCR_MACHINE_ID || os.hostname();
  this.apiKey = options.apiKey || process.env.CCR_API_KEY;
  this.onCommand = options.onCommand || (() => {});
  // ... rest unchanged
}
```

Update `registerSession()` to include auth header:

```javascript
async registerSession(sessionId, label) {
  if (!this.workerUrl) return;

  const headers = { 'Content-Type': 'application/json' };
  if (this.apiKey) {
    headers['Authorization'] = `Bearer ${this.apiKey}`;
  }

  try {
    const response = await fetch(`${this.workerUrl}/sessions/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sessionId,
        machineId: this.machineId,
        label
      })
    });
    // ... rest unchanged
  }
}
```

Update `unregisterSession()` similarly:

```javascript
async unregisterSession(sessionId) {
  if (!this.workerUrl) return;

  const headers = { 'Content-Type': 'application/json' };
  if (this.apiKey) {
    headers['Authorization'] = `Bearer ${this.apiKey}`;
  }

  try {
    await fetch(`${this.workerUrl}/sessions/unregister`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionId })
    });
    // ... rest unchanged
  }
}
```

Update `sendNotification()` similarly:

```javascript
async sendNotification(sessionId, chatId, text, replyMarkup) {
  if (!this.workerUrl) {
    throw new Error('CCR_WORKER_URL not configured');
  }

  const headers = { 'Content-Type': 'application/json' };
  if (this.apiKey) {
    headers['Authorization'] = `Bearer ${this.apiKey}`;
  }

  const response = await fetch(`${this.workerUrl}/notifications/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sessionId,
      chatId,
      text,
      replyMarkup
    })
  });

  return response.json();
}
```

**Step 5: Set the secret in Cloudflare**

```bash
cd ccr-worker
wrangler secret put CCR_API_KEY
# Enter a strong random key (e.g., openssl rand -base64 32)
```

**Step 6: Update .env.example in claude-code-remote**

Add `CCR_API_KEY=` to the .env.example file.

**Step 7: Commit**

```bash
cd ccr-worker
git add src/router-do.js wrangler.toml
git commit -m "feat: add API key authentication to HTTP endpoints (ccr-mvi)"

cd ../claude-code-remote
git add src/worker-client/machine-agent.js .env.example
git commit -m "feat: send CCR_API_KEY in worker requests (ccr-mvi)"
```

---

## Task 2: Add WebSocket Authentication

**Beads:** ccr-5cq

**Files:**
- Modify: `ccr-worker/src/router-do.js:371-416` (handleWebSocket)
- Modify: `claude-code-remote/src/worker-client/machine-agent.js:30-57` (connect)

**Step 1: Modify handleWebSocket to require auth message**

Replace the current `handleWebSocket()` method with auth-aware version:

```javascript
async handleWebSocket(request) {
  const url = new URL(request.url);
  const machineId = url.searchParams.get('machineId');

  if (!machineId) {
    return new Response('machineId required', { status: 400 });
  }

  // Accept WebSocket upgrade
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  server.accept();

  console.log(`Machine connecting: ${machineId} (awaiting auth)`);

  // Set up auth timeout - close if no auth within 10 seconds
  let authenticated = false;
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      console.warn(`Auth timeout for ${machineId}`);
      server.close(4001, 'Authentication timeout');
    }
  }, 10000);

  // Handle first message as auth
  const authHandler = async (event) => {
    try {
      const msg = JSON.parse(event.data);

      if (msg.type === 'auth') {
        if (msg.apiKey === this.env.CCR_API_KEY) {
          authenticated = true;
          clearTimeout(authTimeout);

          // Close existing connection for this machine if any
          const existing = this.machines.get(machineId);
          if (existing && existing !== server) {
            existing.close(4000, 'Replaced by new connection');
          }

          // Store connection
          this.machines.set(machineId, server);

          // Remove auth handler, add normal message handler
          server.removeEventListener('message', authHandler);
          server.addEventListener('message', async (event) => {
            try {
              const msg = JSON.parse(event.data);
              await this.handleMachineMessage(machineId, msg);
            } catch (err) {
              console.error('Error handling machine message:', err);
            }
          });

          // Send auth success
          server.send(JSON.stringify({ type: 'authSuccess' }));

          console.log(`Machine authenticated: ${machineId}`);

          // Flush queued commands
          this.flushCommandQueue(machineId, server);

        } else {
          console.warn(`Invalid API key from ${machineId}`);
          server.close(4003, 'Invalid API key');
        }
      } else {
        console.warn(`Expected auth message from ${machineId}, got: ${msg.type}`);
        server.close(4002, 'Expected auth message');
      }
    } catch (err) {
      console.error('Auth error:', err);
      server.close(4000, 'Auth error');
    }
  };

  server.addEventListener('message', authHandler);

  server.addEventListener('close', () => {
    console.log(`Machine disconnected: ${machineId}`);
    clearTimeout(authTimeout);
    // Only delete if this is still the active connection
    if (this.machines.get(machineId) === server) {
      this.machines.delete(machineId);
    }
  });

  server.addEventListener('error', (err) => {
    console.error(`WebSocket error for ${machineId}:`, err);
    clearTimeout(authTimeout);
    if (this.machines.get(machineId) === server) {
      this.machines.delete(machineId);
    }
  });

  return new Response(null, {
    status: 101,
    webSocket: client
  });
}
```

**Step 2: Update machine-agent.js connect() to send auth**

Update the `connect()` method:

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
    this.ws = new WebSocket(wsUrl);

    this.ws.on('open', () => {
      logger.info(`WebSocket open, authenticating as ${this.machineId}`);
      // Send auth message immediately
      this.ws.send(JSON.stringify({
        type: 'auth',
        apiKey: this.apiKey
      }));
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

**Step 3: Update handleMessage() to handle authSuccess**

```javascript
handleMessage(data) {
  try {
    const msg = JSON.parse(data);

    if (msg.type === 'pong') {
      return; // Ping response
    }

    if (msg.type === 'authSuccess') {
      logger.info(`Authenticated with Worker as ${this.machineId}`);
      this.reconnectDelay = 1000; // Reset on successful auth
      this.startPing();
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

**Step 4: Commit**

```bash
cd ccr-worker
git add src/router-do.js
git commit -m "feat: add WebSocket authentication with first-message auth (ccr-5cq)"

cd ../claude-code-remote
git add src/worker-client/machine-agent.js
git commit -m "feat: send auth message on WebSocket connect (ccr-5cq)"
```

---

## Task 3: Fix Cross-Chat Token Replay Vulnerability

**Beads:** ccr-g8o

**Files:**
- Modify: `ccr-worker/src/router-do.js:240-253` (handleTelegramMessage - /cmd lookup)
- Modify: `ccr-worker/src/router-do.js:286-294` (handleTelegramCallback - token lookup)

**Step 1: Fix /cmd token lookup to include chat_id**

In `handleTelegramMessage()`, update the /cmd token lookup (around line 246):

Before:
```javascript
const mapping = this.sql.exec(`
  SELECT session_id FROM messages WHERE token = ?
`, token).toArray()[0];
```

After:
```javascript
const mapping = this.sql.exec(`
  SELECT session_id FROM messages WHERE token = ? AND chat_id = ?
`, token, chatId).toArray()[0];
```

**Step 2: Fix callback token lookup to include chat_id**

In `handleTelegramCallback()`, update the token lookup (around line 287):

Before:
```javascript
const mapping = this.sql.exec(`
  SELECT session_id FROM messages WHERE token = ?
`, token).toArray()[0];
```

After:
```javascript
const mapping = this.sql.exec(`
  SELECT session_id FROM messages WHERE token = ? AND chat_id = ?
`, token, chatId).toArray()[0];
```

**Step 3: Commit**

```bash
cd ccr-worker
git add src/router-do.js
git commit -m "fix: bind token routing to chat_id to prevent cross-chat replay (ccr-g8o)"
```

---

## Task 4: Add Telegram Chat/User Allowlist

**Beads:** ccr-vt2

**Files:**
- Modify: `ccr-worker/src/router-do.js:195-217` (handleTelegramWebhook)
- Modify: `ccr-worker/wrangler.toml`

**Step 1: Document allowlist vars in wrangler.toml**

Update `ccr-worker/wrangler.toml`:

```toml
name = "ccr-router"
main = "src/index.js"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "ROUTER", class_name = "RouterDO" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["RouterDO"]

[vars]
# Set via wrangler secret:
# TELEGRAM_WEBHOOK_SECRET = ""
# TELEGRAM_BOT_TOKEN = ""
# CCR_API_KEY = ""
# ALLOWED_CHAT_IDS = "123456789,987654321"  # comma-separated
# ALLOWED_USER_IDS = "123456789"  # comma-separated, optional
```

**Step 2: Add allowlist check helper**

Add this method after `verifyApiKey()`:

```javascript
isAllowedTelegramSource(chatId, userId) {
  // Parse allowed chat IDs
  const allowedChats = this.env.ALLOWED_CHAT_IDS
    ? this.env.ALLOWED_CHAT_IDS.split(',').map(id => id.trim())
    : [];

  // Parse allowed user IDs (optional additional check)
  const allowedUsers = this.env.ALLOWED_USER_IDS
    ? this.env.ALLOWED_USER_IDS.split(',').map(id => id.trim())
    : [];

  // If no allowlist configured, deny all (fail closed)
  if (allowedChats.length === 0) {
    console.warn('ALLOWED_CHAT_IDS not configured - denying all Telegram requests');
    return false;
  }

  // Check chat ID
  if (!allowedChats.includes(String(chatId))) {
    return false;
  }

  // If user allowlist configured, also check user ID
  if (allowedUsers.length > 0 && !allowedUsers.includes(String(userId))) {
    return false;
  }

  return true;
}
```

**Step 3: Add allowlist check to handleTelegramWebhook**

Update `handleTelegramWebhook()` to check allowlist early:

```javascript
async handleTelegramWebhook(request) {
  // Verify webhook secret
  if (!this.verifyWebhookSecret(request)) {
    console.warn('Invalid webhook secret');
    return new Response('Unauthorized', { status: 401 });
  }

  const update = await request.json();
  console.log('Webhook received:', JSON.stringify(update).slice(0, 200));

  // Extract chat and user IDs for allowlist check
  const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
  const userId = update.message?.from?.id || update.callback_query?.from?.id;

  // Check allowlist
  if (!this.isAllowedTelegramSource(chatId, userId)) {
    console.warn(`Blocked: chat=${chatId} user=${userId} not in allowlist`);
    return new Response('ok', { status: 200 }); // Silent reject
  }

  // Handle message (including replies)
  if (update.message) {
    return this.handleTelegramMessage(update.message);
  }

  // Handle callback query (button clicks)
  if (update.callback_query) {
    return this.handleTelegramCallback(update.callback_query);
  }

  // Acknowledge other update types
  return new Response('ok', { status: 200 });
}
```

**Step 4: Set the secrets in Cloudflare**

```bash
cd ccr-worker
wrangler secret put ALLOWED_CHAT_IDS
# Enter your Telegram chat ID (find via @userinfobot or similar)

# Optionally:
wrangler secret put ALLOWED_USER_IDS
```

**Step 5: Commit**

```bash
cd ccr-worker
git add src/router-do.js wrangler.toml
git commit -m "feat: add Telegram chat/user allowlist (ccr-vt2)"
```

---

## Task 5: Deploy and Test

**Step 1: Deploy Worker**

```bash
cd ccr-worker
wrangler deploy
```

**Step 2: Verify secrets are set**

```bash
wrangler secret list
```

Expected: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `CCR_API_KEY`, `ALLOWED_CHAT_IDS`

**Step 3: Test unauthenticated access is blocked**

```bash
# Should return 401
curl -X POST https://ccr-router.<your-subdomain>.workers.dev/sessions/register \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test","machineId":"test"}'
```

**Step 4: Test authenticated access works**

```bash
# Should return 200
curl -X POST https://ccr-router.<your-subdomain>.workers.dev/sessions/register \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"sessionId":"test","machineId":"test"}'
```

**Step 5: Update claude-code-remote .env and test**

Add `CCR_API_KEY=<your-key>` to `.env`, restart the webhook, verify it can register sessions and receive commands.

**Step 6: Close beads**

```bash
cd claude-code-remote
bd close ccr-mvi --reason "Completed: API key auth on HTTP endpoints"
bd close ccr-5cq --reason "Completed: WebSocket auth with first-message protocol"
bd close ccr-g8o --reason "Completed: Token routing bound to chat_id"
bd close ccr-vt2--reason "Completed: Telegram chat/user allowlist"
```

---

## Summary

| Task | Bead | What it fixes |
|------|------|---------------|
| 1 | ccr-mvi | Unauthenticated HTTP endpoints |
| 2 | ccr-5cq | Unauthenticated WebSocket + reconnection race |
| 3 | ccr-g8o | Cross-chat token replay |
| 4 | ccr-vt2 | No Telegram access control |
| 5 | - | Deploy and verify |

**After completion:**
- All Worker endpoints require either API key (HTTP) or first-message auth (WS)
- Tokens only work from the chat where they were issued
- Only allowlisted Telegram chats/users can interact
- WebSocket reconnection race fixed as side effect of Task 2

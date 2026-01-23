# P2/P3 Robustness Improvements

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Address remaining robustness issues from ChatGPT code review - race conditions, command delivery reliability, rate limits, and minor fixes.

**Architecture:** Fix client-side registry race condition with mutex, add ack-based command delivery in Worker, add bounds/limits to prevent DoS, fix Telegram message formatting issues.

**Tech Stack:** Cloudflare Workers with Durable Objects (SQLite), Node.js (client), Telegram Bot API

---

## Task 1: Add Mutex to JSON Session Registry (ccr-066)

**Files:**
- Modify: `src/registry/session-registry.js`

**Problem:** JSON file registry can have race conditions when multiple requests interleave reads/writes.

**Step 1: Install async-mutex**

Run: `npm install async-mutex`
Expected: Package added to package.json

**Step 2: Add mutex to SessionRegistry class**

Edit `src/registry/session-registry.js`, add import at top:

```javascript
const { Mutex } = require('async-mutex');
```

**Step 3: Initialize mutex in constructor**

Add after line 37 (`this.tokensFile = ...`):

```javascript
        // Mutex to prevent race conditions on file operations
        this._sessionsMutex = new Mutex();
        this._tokensMutex = new Mutex();
```

**Step 4: Wrap session operations with mutex**

Replace `_loadSessions` and `_saveSessions` with mutex-aware versions:

```javascript
    async _withSessionLock(fn) {
        const release = await this._sessionsMutex.acquire();
        try {
            return fn();
        } finally {
            release();
        }
    }

    _loadSessionsSync() {
        try {
            if (fs.existsSync(this.sessionsFile)) {
                return JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
            }
        } catch (error) {
            this.logger.warn?.(`Failed to load sessions: ${error.message}`) ||
                this.logger.log?.(`Failed to load sessions: ${error.message}`);
        }
        return {};
    }

    _saveSessionsSync(sessions) {
        this._atomicWrite(this.sessionsFile, sessions);
    }

    // Deprecated sync versions - keep for backwards compat during migration
    _loadSessions() {
        return this._loadSessionsSync();
    }

    _saveSessions(sessions) {
        this._saveSessionsSync(sessions);
    }
```

**Step 5: Update upsertSession to use mutex**

Change `upsertSession` to async and wrap with mutex:

```javascript
    async upsertSession(session) {
        if (!session.session_id) {
            throw new Error('session_id is required');
        }

        return this._withSessionLock(() => {
            const sessions = this._loadSessionsSync();
            const now = Date.now();

            const existing = sessions[session.session_id];

            const updated = {
                session_id: session.session_id,
                ppid: session.ppid ?? existing?.ppid,
                pid: session.pid ?? existing?.pid,
                start_time: session.start_time ?? existing?.start_time,
                cwd: session.cwd ?? existing?.cwd,
                label: session.label ?? existing?.label,
                notify: session.notify ?? existing?.notify ?? false,
                transport: this._buildTransport(session, existing),
                state: session.state ?? existing?.state ?? 'running',
                created_at: existing?.created_at ?? now,
                updated_at: now,
                last_seen: now,
                expires_at: now + DEFAULT_SESSION_TTL_MS,
            };

            sessions[session.session_id] = updated;
            this._saveSessionsSync(sessions);

            this.logger.info?.(`Session upserted: ${session.session_id}`) ||
                this.logger.log?.(`Session upserted: ${session.session_id}`);

            return updated;
        });
    }
```

**Step 6: Update other mutating methods similarly**

Apply same pattern to: `touchSession`, `enableNotify`, `stopSession`, `deleteSession`, `cleanupExpiredSessions`.

**Step 7: Test**

Run: `npm test`
Expected: All tests pass (add tests if none exist for registry)

**Step 8: Commit**

```bash
git add package.json package-lock.json src/registry/session-registry.js
git commit -m "fix(ccr-066): add mutex to prevent session registry race conditions"
```

---

## Task 2: Add Ack-Based Command Queue Deletion (ccr-bj6)

**Files:**
- Modify: `ccr-worker/src/router-do.js`

**Problem:** Commands deleted from queue immediately after `ws.send()` with no ack. If socket dies mid-flush, commands are lost.

**Step 1: Modify flushCommandQueue to track pending acks**

Replace the `flushCommandQueue` method:

```javascript
  async flushCommandQueue(machineId, ws) {
    const commands = this.sql.exec(`
      SELECT id, session_id, command, chat_id
      FROM command_queue
      WHERE machine_id = ?
      ORDER BY created_at ASC
    `, machineId).toArray();

    if (commands.length === 0) return;

    console.log(`Flushing ${commands.length} queued commands to ${machineId}`);

    for (const cmd of commands) {
      try {
        ws.send(JSON.stringify({
          type: 'command',
          id: cmd.id,  // Include queue ID for ack
          sessionId: cmd.session_id,
          command: cmd.command,
          chatId: cmd.chat_id
        }));
        // Don't delete yet - wait for ack
      } catch (err) {
        // Socket write failed - stop flushing, commands stay in queue
        console.error(`Failed to send queued command ${cmd.id} to ${machineId}:`, err.message);
        break;
      }
    }
  }
```

**Step 2: Handle ack messages from machine**

Add ack handling to `handleMachineMessage`:

```javascript
  async handleMachineMessage(machineId, msg) {
    if (msg.type === 'ping') {
      const ws = this.machines.get(machineId);
      if (ws) ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'ack') {
      // Machine acknowledged receipt of queued command
      const { id } = msg;
      if (id) {
        this.sql.exec(`DELETE FROM command_queue WHERE id = ?`, id);
        console.log(`Command ${id} acknowledged and deleted from queue`);
      }
      return;
    }

    if (msg.type === 'commandResult') {
      const { sessionId, success, error, chatId } = msg;
      if (!success && chatId) {
        await this.sendTelegramMessage(chatId, `Command failed: ${error}`);
      }
      return;
    }

    console.log(`Unknown message from ${machineId}:`, msg);
  }
```

**Step 3: Update machine-agent.js to send acks**

Modify `handleMessage` in `src/worker-client/machine-agent.js`:

```javascript
  handleMessage(data) {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'pong') {
        return;
      }

      if (msg.type === 'command') {
        logger.info(`Received command for session ${msg.sessionId}: ${msg.command.slice(0, 50)}`);

        // Send ack immediately if command has queue ID
        if (msg.id && this.ws) {
          this.ws.send(JSON.stringify({ type: 'ack', id: msg.id }));
        }

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
export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"
wrangler deploy
```

**Step 5: Commit both repos**

```bash
cd /home/dev/projects/ccr-worker
git add src/router-do.js
git commit -m "fix(ccr-bj6): add ack-based command queue deletion"

cd /home/dev/projects/claude-code-remote
git add src/worker-client/machine-agent.js
git commit -m "fix(ccr-bj6): send ack for queued commands"
```

---

## Task 3: Add Rate Limits and Queue Bounds (ccr-nyi)

**Files:**
- Modify: `ccr-worker/src/router-do.js`

**Problem:** No limits on command length, queued commands per machine, or sessions stored.

**Step 1: Add configuration constants at top of class**

Add after line 9 (`this.machines = new Map();`):

```javascript
    // Limits to prevent DoS
    this.MAX_COMMAND_LENGTH = 10000;      // 10KB per command
    this.MAX_QUEUE_PER_MACHINE = 100;     // Max queued commands per machine
    this.MAX_SESSIONS = 1000;             // Max total sessions
```

**Step 2: Add limit check in routeCommandToMachine**

Add at start of the method, before getting session:

```javascript
  async routeCommandToMachine(sessionId, command, chatId) {
    // Validate command length
    if (command.length > this.MAX_COMMAND_LENGTH) {
      await this.sendTelegramMessage(chatId,
        `Command too long (${command.length} chars, max ${this.MAX_COMMAND_LENGTH})`);
      return new Response('ok', { status: 200 });
    }

    // Get machine for this session
    // ... rest of existing code
```

**Step 3: Add queue limit check before enqueuing**

In `routeCommandToMachine`, before the INSERT into command_queue:

```javascript
    // Check queue size before adding
    const queueSize = this.sql.exec(`
      SELECT COUNT(*) as count FROM command_queue WHERE machine_id = ?
    `, machineId).toArray()[0].count;

    if (queueSize >= this.MAX_QUEUE_PER_MACHINE) {
      await this.sendTelegramMessage(chatId,
        `Queue full for ${session.label || machineId} (${queueSize} commands pending). Try again later.`);
      return new Response('ok', { status: 200 });
    }

    // Machine offline - queue command
    const now = Date.now();
    this.sql.exec(`
      INSERT INTO command_queue (machine_id, session_id, command, chat_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, machineId, sessionId, command, chatId, now);
```

**Step 4: Add session limit check in handleRegisterSession**

Add after validating sessionId and machineId:

```javascript
  async handleRegisterSession(body) {
    const { sessionId, machineId, label } = body;

    if (!sessionId || !machineId) {
      return new Response(JSON.stringify({ error: 'sessionId and machineId required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Check session limit (only count if this is a new session)
    const existing = this.sql.exec(
      `SELECT 1 FROM sessions WHERE session_id = ?`, sessionId
    ).toArray()[0];

    if (!existing) {
      const sessionCount = this.sql.exec(
        `SELECT COUNT(*) as count FROM sessions`
      ).toArray()[0].count;

      if (sessionCount >= this.MAX_SESSIONS) {
        return new Response(JSON.stringify({ error: 'Session limit reached' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // ... rest of existing code
```

**Step 5: Deploy and test**

```bash
wrangler deploy
```

**Step 6: Commit**

```bash
git add src/router-do.js
git commit -m "fix(ccr-nyi): add rate limits and queue bounds"
```

---

## Task 4: Fix Markdown parse_mode Reliability (ccr-502)

**Files:**
- Modify: `ccr-worker/src/router-do.js`

**Problem:** `parse_mode: 'Markdown'` causes 502 if message contains unescaped Telegram markdown chars.

**Step 1: Remove parse_mode from handleSendNotification**

In `handleSendNotification`, change the Telegram API call:

```javascript
    // Send to Telegram (no parse_mode - raw text is safest)
    const telegramResponse = await fetch(
      `https://api.telegram.org/bot${this.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          // Removed parse_mode: 'Markdown' - causes 502 on unescaped special chars
          reply_markup: replyMarkup || undefined
        })
      }
    );
```

**Step 2: Update sendTelegramMessage helper to also not use parse_mode**

Verify `sendTelegramMessage` doesn't use parse_mode (it doesn't currently - good).

**Step 3: Deploy and test**

```bash
wrangler deploy

# Test with special characters that would break Markdown
curl -s -X POST "https://ccr-router.jonathan-mohrbacher.workers.dev/notifications/send" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer OOytSFvLS0Yd5sjMwU2JpJ9PbMgqSE9g" \
  -d '{"sessionId":"test","chatId":"8248645256","text":"Test with *asterisks* and _underscores_ and `backticks`"}'
```

**Step 4: Commit**

```bash
git add src/router-do.js
git commit -m "fix(ccr-502): remove parse_mode to prevent Markdown formatting errors"
```

---

## Task 5: Add Telegram Update Deduplication (ccr-bj1)

**Files:**
- Modify: `ccr-worker/src/router-do.js`

**Problem:** Telegram retries webhooks on slow responses. Without deduplication, commands can be enqueued twice.

**Step 1: Add seen_updates table in initialize()**

Add after the command_queue table creation:

```javascript
    // Seen updates: deduplicate Telegram webhook retries
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS seen_updates (
        update_id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL
      )
    `);

    // Index for cleanup
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_seen_updates_created ON seen_updates(created_at)
    `);
```

**Step 2: Add deduplication check in handleTelegramWebhook**

Add after verifying webhook secret:

```javascript
  async handleTelegramWebhook(request) {
    // Verify webhook secret
    if (!this.verifyWebhookSecret(request)) {
      console.warn('Invalid webhook secret');
      return new Response('Unauthorized', { status: 401 });
    }

    const update = await request.json();

    // Deduplicate: check if we've seen this update
    const updateId = update.update_id;
    if (updateId) {
      const seen = this.sql.exec(
        `SELECT 1 FROM seen_updates WHERE update_id = ?`, updateId
      ).toArray()[0];

      if (seen) {
        console.log(`Duplicate update ${updateId} ignored`);
        return new Response('ok', { status: 200 });
      }

      // Mark as seen
      this.sql.exec(
        `INSERT INTO seen_updates (update_id, created_at) VALUES (?, ?)`,
        updateId, Date.now()
      );
    }

    console.log('Webhook received:', JSON.stringify(update).slice(0, 200));
    // ... rest of existing code
```

**Step 3: Add cleanup for seen_updates in cleanup()**

Add to the `cleanup` method:

```javascript
    // Clean old seen updates (keep 1 hour worth)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const seenResult = this.sql.exec(`
      DELETE FROM seen_updates WHERE created_at < ?
    `, oneHourAgo);
```

**Step 4: Deploy and test**

```bash
wrangler deploy
```

**Step 5: Commit**

```bash
git add src/router-do.js
git commit -m "fix(ccr-bj1): add Telegram update deduplication"
```

---

## Task 6: Update Session updated_at on Activity (ccr-6a4)

**Files:**
- Modify: `ccr-worker/src/router-do.js`

**Problem:** `updated_at` only set on register, so active sessions can be cleaned up after 24h.

**Step 1: Add helper method to touch session**

Add after `generateToken()`:

```javascript
  touchSession(sessionId) {
    const now = Date.now();
    this.sql.exec(`
      UPDATE sessions SET updated_at = ? WHERE session_id = ?
    `, now, sessionId);
  }
```

**Step 2: Touch session in routeCommandToMachine**

Add after getting the session (before checking WebSocket):

```javascript
  async routeCommandToMachine(sessionId, command, chatId) {
    // ... validation code ...

    const machineId = session.machine_id;

    // Touch session to prevent cleanup of active sessions
    this.touchSession(sessionId);

    // Check if machine is connected via WebSocket
    // ... rest of code
```

**Step 3: Touch session in handleSendNotification**

Add after verifying session exists:

```javascript
    if (!session) {
      return new Response(JSON.stringify({ error: 'Session not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Touch session to prevent cleanup
    this.touchSession(sessionId);

    // Generate token for this notification
    // ... rest of code
```

**Step 4: Deploy and test**

```bash
wrangler deploy
```

**Step 5: Commit**

```bash
git add src/router-do.js
git commit -m "fix(ccr-6a4): update session updated_at on activity"
```

---

## Task 7: Fix Cleanup Logging (ccr-4w2)

**Files:**
- Modify: `ccr-worker/src/router-do.js`

**Problem:** `cleanup()` uses `result.changes` but Cloudflare SQLite returns `cursor.rowsWritten`.

**Step 1: Fix cleanup method to use rowsWritten**

Replace the entire `cleanup` method:

```javascript
  async cleanup() {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    // Clean old messages
    const msgCursor = this.sql.exec(`
      DELETE FROM messages WHERE created_at < ?
    `, oneDayAgo);

    // Clean old queued commands
    const queueCursor = this.sql.exec(`
      DELETE FROM command_queue WHERE created_at < ?
    `, oneDayAgo);

    // Clean stale sessions
    const sessionCursor = this.sql.exec(`
      DELETE FROM sessions WHERE updated_at < ?
    `, oneDayAgo);

    // Clean old seen updates
    const seenCursor = this.sql.exec(`
      DELETE FROM seen_updates WHERE created_at < ?
    `, oneHourAgo);

    console.log(`Cleanup: ${msgCursor.rowsWritten} messages, ${queueCursor.rowsWritten} queued, ${sessionCursor.rowsWritten} sessions, ${seenCursor.rowsWritten} seen_updates`);
  }
```

**Step 2: Deploy and test**

```bash
wrangler deploy

# Trigger cleanup and check logs
curl -s -X POST "https://ccr-router.jonathan-mohrbacher.workers.dev/cleanup" \
  -H "Authorization: Bearer OOytSFvLS0Yd5sjMwU2JpJ9PbMgqSE9g"
```

**Step 3: Commit**

```bash
git add src/router-do.js
git commit -m "fix(ccr-4w2): use rowsWritten for cleanup logging"
```

---

## Task 8: Final Integration Test and Push

**Step 1: Deploy final Worker version**

```bash
cd /home/dev/projects/ccr-worker
export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"
wrangler deploy
```

**Step 2: Run basic API tests**

```bash
# Unauthenticated should fail
curl -s -X POST "https://ccr-router.jonathan-mohrbacher.workers.dev/sessions/register" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test","machineId":"test"}'
# Expected: {"error":"Unauthorized"}

# Authenticated should succeed
curl -s -X POST "https://ccr-router.jonathan-mohrbacher.workers.dev/sessions/register" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer OOytSFvLS0Yd5sjMwU2JpJ9PbMgqSE9g" \
  -d '{"sessionId":"test","machineId":"test"}'
# Expected: {"ok":true,...}

# Cleanup should work
curl -s -X POST "https://ccr-router.jonathan-mohrbacher.workers.dev/cleanup" \
  -H "Authorization: Bearer OOytSFvLS0Yd5sjMwU2JpJ9PbMgqSE9g"
```

**Step 3: Push all changes**

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

| Task | Bead | What it fixes |
|------|------|---------------|
| 1 | ccr-066 | JSON registry race conditions (mutex) |
| 2 | ccr-bj6 | Command queue reliability (ack-based deletion) |
| 3 | ccr-nyi | DoS prevention (rate limits, queue bounds) |
| 4 | ccr-502 | Telegram formatting errors (remove parse_mode) |
| 5 | ccr-bj1 | Telegram webhook retries (update deduplication) |
| 6 | ccr-6a4 | Active session cleanup (touch on activity) |
| 7 | ccr-4w2 | Wrong cleanup metrics (use rowsWritten) |
| 8 | - | Integration test and deploy |

**After completion:**
- Session registry protected from race conditions
- Commands reliably delivered with acknowledgment
- DoS vectors mitigated with limits
- Telegram messages won't fail on special characters
- No duplicate command processing on webhook retries
- Active sessions won't be incorrectly cleaned up
- Accurate cleanup metrics

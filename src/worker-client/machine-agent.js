// src/worker-client/machine-agent.js
const WebSocket = require('ws');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const Logger = require('../core/logger');

const logger = new Logger('MachineAgent');

class MachineAgent {
  constructor(options = {}) {
    this.workerUrl = options.workerUrl || process.env.CCR_WORKER_URL;
    this.machineId = options.machineId || process.env.CCR_MACHINE_ID || os.hostname();
    this.apiKey = options.apiKey || process.env.CCR_API_KEY;
    this.onCommand = options.onCommand || (() => {});

    this.ws = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.cleanupInterval = null;
    this.lastPongAt = null;
    this.PONG_TIMEOUT_MS = 90000; // 3 missed pings (30s each)

    // Durable inbox for exactly-once execution
    this.initInbox();
  }

  initInbox() {
    // Store in user's data directory
    const dataDir = process.env.CCR_DATA_DIR || path.join(process.env.HOME, '.ccr');
    fs.mkdirSync(dataDir, { recursive: true });

    const dbPath = path.join(dataDir, `inbox-${this.machineId}.db`);
    this.inbox = new Database(dbPath);

    // Create inbox table
    this.inbox.exec(`
      CREATE TABLE IF NOT EXISTS inbox (
        command_id TEXT PRIMARY KEY,
        received_at INTEGER NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'received',
        updated_at INTEGER NOT NULL
      )
    `);

    // Prepared statements for performance
    this.stmts = {
      insert: this.inbox.prepare(`
        INSERT OR IGNORE INTO inbox (command_id, received_at, payload, status, updated_at)
        VALUES (?, ?, ?, 'received', ?)
      `),
      markDone: this.inbox.prepare(`
        UPDATE inbox SET status = 'done', updated_at = ? WHERE command_id = ?
      `),
      getUnfinished: this.inbox.prepare(`
        SELECT command_id, payload FROM inbox WHERE status != 'done'
      `),
      cleanup: this.inbox.prepare(`
        DELETE FROM inbox WHERE status = 'done' AND updated_at < ?
      `)
    };

    logger.info(`Inbox initialized at ${dbPath}`);
  }

  // Returns true if this is a new command (inserted), false if duplicate (ignored)
  persistToInbox(commandId, payload) {
    const now = Date.now();
    const result = this.stmts.insert.run(commandId, now, JSON.stringify(payload), now);
    return result.changes > 0;
  }

  markCommandDone(commandId) {
    this.stmts.markDone.run(Date.now(), commandId);
  }

  getUnfinishedCommands() {
    return this.stmts.getUnfinished.all().map(row => ({
      commandId: row.command_id,
      payload: JSON.parse(row.payload)
    }));
  }

  cleanupInbox() {
    // Remove done commands older than 1 hour
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const result = this.stmts.cleanup.run(oneHourAgo);
    if (result.changes > 0) {
      logger.info(`Cleaned ${result.changes} completed inbox entries`);
    }
  }

  async replayUnfinishedCommands() {
    const unfinished = this.getUnfinishedCommands();
    if (unfinished.length === 0) return;

    logger.info(`Replaying ${unfinished.length} unfinished commands from inbox`);

    for (const { commandId, payload } of unfinished) {
      logger.info(`Replaying command ${commandId}`);
      try {
        await Promise.resolve(this.onCommand(payload));
        this.markCommandDone(commandId);
        logger.info(`Replay of ${commandId} completed`);
      } catch (err) {
        logger.error(`Replay of ${commandId} failed:`, err.message);
        // Leave in inbox for next restart
      }
    }
  }

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

        // Clear any pending reconnect timer
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }

        this.startPing();

        // Replay any commands that were received but not finished
        this.replayUnfinishedCommands();

        // Periodic inbox cleanup (every hour)
        this.cleanupInterval = setInterval(() => this.cleanupInbox(), 60 * 60 * 1000);
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        logger.warn(`WebSocket closed (${code}: ${reason}), reconnecting...`);
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
          this.cleanupInterval = null;
        }
        this.scheduleReconnect();
      });

      this.ws.on('error', (err) => {
        logger.error('WebSocket error:', err.message);
        // Clear intervals on error
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
        }
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
          this.cleanupInterval = null;
        }
        // Force clean close
        if (this.ws) {
          this.ws.terminate();
        }
      });

    } catch (err) {
      logger.error('Failed to connect:', err.message);
      this.scheduleReconnect();
    }
  }

  handleMessage(data) {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'pong') {
        this.lastPongAt = Date.now();
        return;
      }

      if (msg.type === 'command') {
        const commandId = msg.commandId || msg.id; // Support both formats

        if (!commandId) {
          logger.warn('Received command without ID, cannot process durably');
          return;
        }

        // Step 1: Persist to durable inbox (INSERT OR IGNORE)
        const isNew = this.persistToInbox(commandId, msg);

        // Step 2: Ack AFTER durable write (tells DO we have it safely stored)
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'ack', commandId }));
        }

        // Step 3: If duplicate, we're done (already processed or in progress)
        if (!isNew) {
          logger.info(`Duplicate command ${commandId} - already in inbox`);
          return;
        }

        logger.info(`Received command ${commandId} for session ${msg.sessionId}`);

        // Execute command (handle both sync and async)
        Promise.resolve()
          .then(() => this.onCommand(msg))
          .then(() => {
            this.markCommandDone(commandId);
            logger.info(`Command ${commandId} completed`);
          })
          .catch(err => {
            logger.error(`Command ${commandId} execution failed:`, err.message);
            // Don't mark done - will retry on restart
            if (this.ws && this.ws.readyState === WebSocket.OPEN && msg.chatId) {
              this.ws.send(JSON.stringify({
                type: 'commandResult',
                commandId,
                success: false,
                error: err.message,
                chatId: msg.chatId
              }));
            }
          });
        return;
      }

      logger.debug('Unknown message:', msg);
    } catch (err) {
      logger.error('Error parsing message:', err.message);
    }
  }

  startPing() {
    this.lastPongAt = Date.now();

    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Check for stale connection (no pong received)
        if (this.lastPongAt && (Date.now() - this.lastPongAt) > this.PONG_TIMEOUT_MS) {
          logger.warn('Connection stale (no pong for 90s), terminating');
          this.ws.terminate();
          return;
        }

        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // Every 30 seconds
  }

  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  scheduleReconnect() {
    // Cancel any existing timer to prevent stacking
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, this.reconnectDelay);
  }

  sendResult(sessionId, success, error, chatId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'commandResult',
        sessionId,
        success,
        error,
        chatId
      }));
    }
  }

  async registerSession(sessionId, label) {
    if (!this.workerUrl) return;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(`${this.workerUrl}/sessions/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sessionId,
          machineId: this.machineId,
          label
        })
      });

      const result = await response.json();
      logger.info(`Session registered with Worker: ${sessionId} -> ${this.machineId}`);
      return result;
    } catch (err) {
      logger.error('Failed to register session with Worker:', err.message);
    }
  }

  async unregisterSession(sessionId) {
    if (!this.workerUrl) return;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      await fetch(`${this.workerUrl}/sessions/unregister`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sessionId })
      });
      logger.info(`Session unregistered from Worker: ${sessionId}`);
    } catch (err) {
      logger.error('Failed to unregister session:', err.message);
    }
  }

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

  close() {
    // Cancel any pending reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.inbox) {
      this.inbox.close();
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = MachineAgent;

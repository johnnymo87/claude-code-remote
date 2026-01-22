// src/worker-client/machine-agent.js
const WebSocket = require('ws');
const os = require('os');
const Logger = require('../core/logger');

const logger = new Logger('MachineAgent');

class MachineAgent {
  constructor(options = {}) {
    this.workerUrl = options.workerUrl || process.env.CCR_WORKER_URL;
    this.machineId = options.machineId || process.env.CCR_MACHINE_ID || os.hostname();
    this.onCommand = options.onCommand || (() => {});

    this.ws = null;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.pingInterval = null;
  }

  async connect() {
    if (!this.workerUrl) {
      logger.warn('CCR_WORKER_URL not set - machine agent disabled');
      return;
    }

    const wsUrl = this.workerUrl.replace(/^http/, 'ws') + `/ws?machineId=${encodeURIComponent(this.machineId)}`;

    logger.info(`Connecting to Worker: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        logger.info(`Connected to Worker as ${this.machineId}`);
        this.reconnectDelay = 1000; // Reset on successful connect
        this.startPing();
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', () => {
        logger.warn('WebSocket closed, reconnecting...');
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

  handleMessage(data) {
    try {
      const msg = JSON.parse(data);

      if (msg.type === 'pong') {
        return; // Ping response
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

  startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
    setTimeout(() => {
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
      const response = await fetch(`${this.workerUrl}/sessions/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      await fetch(`${this.workerUrl}/sessions/unregister`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    const response = await fetch(`${this.workerUrl}/notifications/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = MachineAgent;

#!/usr/bin/env node

/**
 * CCR Server — generic entry point.
 *
 * Wires: ChatProvider + AgentBackend + CommandRouter + MachineAgent.
 * Currently only Telegram + Claude Code, but the architecture supports
 * swapping either axis independently.
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const dotenv = require('dotenv');
const Logger = require('./src/core/logger');
const { TelegramProvider } = require('./src/providers/telegram-provider');
const { ClaudeCodeBackend } = require('./src/backends/claude-code-backend');
const { CommandRouter } = require('./src/core/command-router');
const { ReplyTokenStore } = require('./src/storage/reply-token-store');
const SessionRegistry = require('./src/registry/session-registry');
const { createEventRoutes } = require('./src/routes/events');
const MachineAgent = require('./src/worker-client/machine-agent');

// Load .env
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

// Ensure nix-profile binaries (nvim, tmux) are in PATH for systemd environments
const nixProfileBin = path.join(process.env.HOME || '/home/dev', '.nix-profile/bin');
if (fs.existsSync(nixProfileBin)) {
  process.env.PATH = `${nixProfileBin}:${process.env.PATH}`;
}

// Ensure tmux can find its socket in systemd environments (XDG_RUNTIME_DIR based)
if (!process.env.TMUX_TMPDIR) {
  const xdgRuntime = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
  if (fs.existsSync(xdgRuntime)) {
    process.env.TMUX_TMPDIR = xdgRuntime;
  }
}

const logger = new Logger('CCR-Server');

// ── Validate env ────────────────────────────────────────────
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_GROUP_ID;
const port = process.env.TELEGRAM_WEBHOOK_PORT || 4731;

if (!botToken) { logger.error('TELEGRAM_BOT_TOKEN required'); process.exit(1); }
if (!chatId) { logger.error('TELEGRAM_CHAT_ID or TELEGRAM_GROUP_ID required'); process.exit(1); }

// ── Build components ────────────────────────────────────────
const registry = new SessionRegistry({
  dataDir: path.join(__dirname, 'src/data'),
  logger,
});

const tokenStore = new ReplyTokenStore({
  dbPath: path.join(__dirname, 'src/data/reply-tokens.db'),
  ttlMs: 24 * 60 * 60 * 1000,
  logger,
});

const provider = new TelegramProvider({
  botToken,
  chatId,
  groupId: process.env.TELEGRAM_GROUP_ID,
  whitelist: process.env.TELEGRAM_WHITELIST
    ? process.env.TELEGRAM_WHITELIST.split(',').map(s => s.trim())
    : [],
  webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
  webhookPathSecret: process.env.TELEGRAM_WEBHOOK_PATH_SECRET,
  forceIPv4: process.env.FORCE_IPV4 === 'true',
});

const backend = new ClaudeCodeBackend({ logger });

const router = new CommandRouter({
  provider,
  backend,
  registry,
  tokenStore,
  machineAgent: null, // set after creation
  logger,
});

// ── Machine Agent (Worker communication) ────────────────────
const machineAgent = new MachineAgent({
  onCommand: async (msg) => {
    try {
      await router.processWorkerCommand({
        chatId: msg.chatId,
        sessionId: msg.sessionId,
        command: msg.command,
      });
      machineAgent.sendResult(msg.sessionId, true, null, msg.chatId);
    } catch (err) {
      logger.error('Worker command error:', err);
      machineAgent.sendResult(msg.sessionId, false, err.message, msg.chatId);
    }
  },
});
router.machineAgent = machineAgent;

// ── Express app ─────────────────────────────────────────────
const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ ok: true, provider: provider.name, backend: backend.name }));

// Claude hook event routes
const eventRoutes = createEventRoutes({
  registry,
  logger,
  onStop: router.handleStopEvent.bind(router),
  onNotifyEnabled: async ({ session }) => {
    if (machineAgent && process.env.CCR_WORKER_URL) {
      try {
        await machineAgent.registerSession(session.session_id, session.label);
      } catch (err) {
        logger.warn(`Worker session registration failed: ${err.message}`);
      }
    }
  },
});
app.use(eventRoutes);

// Telegram webhook route
const webhookPath = process.env.TELEGRAM_WEBHOOK_PATH_SECRET
  ? `/webhook/telegram/${process.env.TELEGRAM_WEBHOOK_PATH_SECRET}`
  : '/webhook/telegram';

app.post(webhookPath, async (req, res) => {
  try {
    // Verify webhook secret
    if (process.env.TELEGRAM_WEBHOOK_SECRET) {
      const header = req.get('X-Telegram-Bot-Api-Secret-Token');
      if (header !== process.env.TELEGRAM_WEBHOOK_SECRET) {
        return res.sendStatus(401);
      }
    }
    await provider.handleWebhookUpdate(req.body, { tokenStore, registry });
    res.status(200).send('OK');
  } catch (err) {
    logger.error('Webhook error:', err.message);
    res.status(500).send('Error');
  }
});

// ── Start ───────────────────────────────────────────────────
async function start() {
  logger.info('Starting CCR server...');
  logger.info(`Provider: ${provider.name} | Backend: ${backend.name} | Port: ${port}`);

  machineAgent.connect();
  app.listen(port, () => logger.info(`Listening on :${port}`));

  // Periodic cleanup
  setInterval(async () => {
    try {
      const count = await registry.cleanupDeadSessions();
      if (count > 0) logger.info(`Cleanup: removed ${count} dead sessions`);
    } catch (err) {
      logger.error(`Cleanup error: ${err.message}`);
    }
  }, 60 * 1000);

  // Token store cleanup
  setInterval(() => tokenStore.cleanup(), 60 * 60 * 1000);
}

start();

process.on('SIGINT', () => { machineAgent.close(); tokenStore.close(); process.exit(0); });
process.on('SIGTERM', () => { machineAgent.close(); tokenStore.close(); process.exit(0); });

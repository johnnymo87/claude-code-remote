const Logger = require('./logger');

/**
 * CommandRouter — platform-agnostic command routing.
 *
 * Bridges ChatProvider (messaging) <-> AgentBackend (AI agent).
 * Handles: stop events -> notifications, inbound commands -> injection.
 */
class CommandRouter {
  constructor({ provider, backend, registry, tokenStore, machineAgent, logger } = {}) {
    this.provider = provider;
    this.backend = backend;
    this.registry = registry;
    this.tokenStore = tokenStore;
    this.machineAgent = machineAgent;
    this.logger = logger || new Logger('CommandRouter');

    // Wire up: when provider receives a command, route it to the backend
    this.provider.onCommand(this._handleInboundCommand.bind(this));
  }

  /**
   * Handle a Stop/Notification event from the AI agent.
   * Mints a token, sends notification via provider, stores reply-to mapping.
   */
  async handleStopEvent({ session, event, summary, label }) {
    const chatId = this.provider.chatId || this.provider.config.chatId;

    const token = await this.registry.mintToken(session.session_id, chatId, {
      context: { event, summary },
    });

    const displayLabel = label || session.label || session.session_id.slice(0, 8);

    const buttons = [
      { text: '▶️ Continue', action: 'continue' },
      { text: '✅ Yes', action: 'y' },
      { text: '❌ No', action: 'n' },
      { text: '🛑 Exit', action: 'exit' },
    ];

    const notification = {
      event,
      sessionId: session.session_id,
      label: displayLabel,
      summary,
      cwd: session.cwd,
      token,
      buttons,
    };

    // Send via Worker if available, for reply routing
    if (this.machineAgent && process.env.CCR_WORKER_URL) {
      try {
        // Format via provider so Worker gets the full styled message + buttons
        const formatted = this.provider.formatNotification
          ? this.provider.formatNotification(notification)
          : { text: summary, replyMarkup: null };

        const result = await this.machineAgent.sendNotification(
          session.session_id,
          chatId,
          formatted.text,
          formatted.replyMarkup,
        );
        if (result.ok) {
          this.logger.info(`Notification sent via Worker for session ${session.session_id}`);
          return { token };
        }
        this.logger.warn('Worker notification failed, falling back to direct');
      } catch (err) {
        this.logger.warn(`Worker notification error: ${err.message}, falling back to direct`);
      }
    }

    // Direct send via provider
    const { messageId } = await this.provider.sendNotification(notification);

    // Store reply-to mapping for reply routing
    if (this.tokenStore && messageId) {
      this.tokenStore.store(String(chatId), String(messageId), token);
    }

    return { token };
  }

  /**
   * Handle an inbound command from the chat provider.
   * Looks up the session and injects the command via the backend.
   */
  async _handleInboundCommand({ channelId, sessionId, command, userId }) {
    const session = this.registry.getSession(sessionId);
    if (!session) {
      await this.provider.sendError(channelId, 'Session not found. Wait for a new notification.');
      return;
    }

    try {
      const result = await this.backend.injectCommand(session, command);
      if (result.ok) {
        await this.provider.sendCommandConfirmation(channelId, {
          command,
          transport: result.transport || 'unknown',
          sessionLabel: session.label || session.session_id.slice(0, 8),
        });
        this.logger.info(`Command injected: ${command} → ${session.session_id} via ${result.transport}`);
      } else {
        await this.provider.sendError(channelId, `Injection failed: ${result.error}`);
      }
    } catch (err) {
      this.logger.error(`Command routing error: ${err.message}`);
      await this.provider.sendError(channelId, `Error: ${err.message}`);
    }
  }

  /**
   * Process a command from the Worker (bypasses token validation — Worker already validated).
   */
  async processWorkerCommand({ chatId, sessionId, command }) {
    return this._handleInboundCommand({
      channelId: String(chatId),
      sessionId,
      command,
    });
  }
}

module.exports = { CommandRouter };

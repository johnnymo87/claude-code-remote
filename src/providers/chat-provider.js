/**
 * ChatProvider — abstract interface for messaging platforms.
 *
 * Subclasses implement platform-specific messaging (Telegram, Slack, Discord, …).
 * The CommandRouter works exclusively through this interface.
 */

class ChatProvider {
  constructor(config = {}) {
    if (new.target === ChatProvider) {
      throw new Error('ChatProvider is abstract and cannot be instantiated directly');
    }
    this.config = config;
    this._onCommand = null;
  }

  // ── Abstract (must override) ──────────────────────────────

  /** @returns {string} Provider identifier, e.g. 'telegram' */
  get name() {
    throw new Error('Subclass must implement name getter');
  }

  /**
   * Send a notification to the user (turn-end, question, error).
   * @param {OutboundNotification} notification
   * @returns {Promise<{messageId: string|number|null}>}
   */
  async sendNotification(notification) {
    throw new Error('Subclass must implement sendNotification()');
  }

  /**
   * Start listening for inbound messages (webhook, polling, etc.).
   * Must call this._onCommand(ctx) when a user sends a command.
   * @returns {Promise<void>}
   */
  async start() {
    throw new Error('Subclass must implement start()');
  }

  /** Graceful shutdown. @returns {Promise<void>} */
  async stop() {
    throw new Error('Subclass must implement stop()');
  }

  // ── Optional overrides ────────────────────────────────────

  /** @returns {ProviderCapabilities} */
  get capabilities() {
    return {
      supportsEditing: false,
      supportsButtons: false,
      supportsThreading: false,
      supportsStreaming: false,
      maxMessageLength: 4096,
    };
  }

  /**
   * Send a confirmation that a command was received and injected.
   * @param {string} channelId
   * @param {object} details — {command, transport, sessionLabel}
   * @returns {Promise<void>}
   */
  async sendCommandConfirmation(channelId, details) {
    // Default: no-op. Telegram overrides to send confirmation message.
  }

  /**
   * Send an error message to the user.
   * @param {string} channelId
   * @param {string} errorText
   * @returns {Promise<void>}
   */
  async sendError(channelId, errorText) {
    // Default: no-op. Providers override.
  }

  /**
   * Edit an existing message (for draft streaming).
   * @param {string} channelId
   * @param {string|number} messageId
   * @param {string} newText
   * @returns {Promise<boolean>}
   */
  async editMessage(channelId, messageId, newText) {
    return false;
  }

  // ── Event registration ────────────────────────────────────

  /**
   * Register the command handler (called by CommandRouter).
   * @param {(ctx: InboundCommand) => Promise<void>} handler
   */
  onCommand(handler) {
    this._onCommand = handler;
  }

  // ── Utilities ─────────────────────────────────────────────

  /**
   * Split text into chunks respecting platform message limits.
   * Prefers breaking at newlines, then spaces.
   * @param {string} text
   * @returns {string[]}
   */
  chunkText(text) {
    const limit = this.capabilities.maxMessageLength;
    if (text.length <= limit) return [text];

    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= limit) {
        chunks.push(remaining);
        break;
      }

      // Prefer newline break, then space, then hard cut
      let breakAt = remaining.lastIndexOf('\n', limit);
      if (breakAt < limit * 0.3) {
        breakAt = remaining.lastIndexOf(' ', limit);
      }
      if (breakAt < limit * 0.3) {
        breakAt = limit;
      }

      chunks.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt).replace(/^\n/, '');
    }

    return chunks;
  }
}

// ── Types (JSDoc) ───────────────────────────────────────────

/**
 * @typedef {object} OutboundNotification
 * @property {string} event — 'Stop', 'SubagentStop', 'Notification'
 * @property {string} sessionId
 * @property {string} label — human-friendly session label
 * @property {string} summary — the AI's last message or question
 * @property {string} cwd — working directory
 * @property {string} token — command token for replies
 * @property {object} [buttons] — quick-reply actions [{text, action}]
 */

/**
 * @typedef {object} InboundCommand
 * @property {string} channelId — platform-specific chat/channel ID
 * @property {string} sessionId — resolved session ID
 * @property {string} command — the user's command text
 * @property {string} [userId] — platform-specific user ID
 * @property {string} [replyToMessageId] — if this was a reply-to
 */

/**
 * @typedef {object} ProviderCapabilities
 * @property {boolean} supportsEditing
 * @property {boolean} supportsButtons
 * @property {boolean} supportsThreading
 * @property {boolean} supportsStreaming
 * @property {number} maxMessageLength
 */

module.exports = { ChatProvider };

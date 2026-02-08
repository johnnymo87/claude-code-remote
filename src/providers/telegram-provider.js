const axios = require('axios');
const { ChatProvider } = require('./chat-provider');
const Logger = require('../core/logger');

/**
 * TelegramProvider — ChatProvider implementation for Telegram Bot API.
 *
 * Extracted from TelegramWebhookHandler. Handles:
 * - Sending notifications with inline keyboard buttons
 * - Receiving commands via webhook (messages + callback queries)
 * - Message editing (for draft streaming)
 * - Text chunking at 4096 chars
 */
class TelegramProvider extends ChatProvider {
  constructor(config = {}) {
    super(config);
    this.logger = new Logger('TelegramProvider');
    this.apiBase = `https://api.telegram.org/bot${config.botToken}`;
    this.chatId = config.chatId || config.groupId;
    this.botUsername = null;
    // Allow injecting a custom HTTP client for testing
    this._http = config._http || axios;
  }

  get name() { return 'telegram'; }

  get capabilities() {
    return {
      supportsEditing: true,
      supportsButtons: true,
      supportsThreading: false,
      supportsStreaming: true, // via editMessage
      maxMessageLength: 4096,
    };
  }

  async sendNotification(notification) {
    const { event, label, summary, cwd, token, buttons } = notification;
    const chatId = this.chatId;

    const emoji = event === 'SubagentStop' ? '🔧' : event === 'Notification' ? '❓' : '🤖';
    const cwdShort = cwd ? cwd.split('/').slice(-2).join('/') : 'unknown';

    const message = [
      `${emoji} *${event}*: ${this._escapeMarkdown(label)}`,
      '',
      summary,
      '',
      `📂 \`${cwdShort}\``,
      '',
      `↩️ _Swipe-reply to respond_`,
    ].join('\n');

    // Build inline keyboard from buttons
    let replyMarkup;
    if (buttons && buttons.length > 0) {
      const rows = [];
      // First row: up to 3 buttons
      rows.push(buttons.slice(0, 3).map(b => ({
        text: b.text,
        callback_data: `cmd:${token}:${b.action}`,
      })));
      // Second row: remaining buttons
      if (buttons.length > 3) {
        rows.push(buttons.slice(3).map(b => ({
          text: b.text,
          callback_data: `cmd:${token}:${b.action}`,
        })));
      }
      replyMarkup = { inline_keyboard: rows };
    }

    const response = await this._apiCall('sendMessage', {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    });

    const messageId = response?.result?.message_id || null;
    return { messageId };
  }

  async sendCommandConfirmation(channelId, { command, transport, sessionLabel }) {
    await this._apiCall('sendMessage', {
      chat_id: channelId,
      text: `✅ *Command sent*\n\n📝 \`${command}\`\n🖥️ *Transport:* ${transport}\n📋 *Session:* ${sessionLabel}`,
      parse_mode: 'Markdown',
    });
  }

  async sendError(channelId, errorText) {
    await this._apiCall('sendMessage', {
      chat_id: channelId,
      text: `❌ ${errorText}`,
      parse_mode: 'Markdown',
    });
  }

  async editMessage(channelId, messageId, newText) {
    try {
      await this._apiCall('editMessageText', {
        chat_id: channelId,
        message_id: messageId,
        text: newText,
        parse_mode: 'Markdown',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Handle an incoming Telegram webhook update.
   * Translates to InboundCommand and calls this._onCommand.
   *
   * @param {object} update — raw Telegram update
   * @param {object} deps — {tokenStore, registry} for reply-to resolution
   */
  async handleWebhookUpdate(update, deps) {
    if (update.callback_query) {
      await this._handleCallback(update.callback_query, deps);
    } else if (update.message?.text) {
      await this._handleMessage(update.message, deps);
    }
  }

  async _handleCallback(query, deps) {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data.startsWith('cmd:')) {
      const parts = data.split(':');
      if (parts.length >= 3) {
        const token = parts[1];
        const action = parts.slice(2).join(':');

        // Resolve session from token
        const validation = await deps.registry.validateToken(token, chatId);
        if (!validation.valid) {
          await this._answerCallback(query.id, `❌ ${validation.error}`);
          return;
        }

        await this._answerCallback(query.id, `✅ Sent: ${action}`);

        if (this._onCommand) {
          await this._onCommand({
            channelId: String(chatId),
            sessionId: validation.session_id,
            command: action,
            userId: String(query.from?.id),
          });
        }
      }
    } else if (data.startsWith('personal:')) {
      const token = data.split(':')[1];
      await this._answerCallback(query.id);
      await this._apiCall('sendMessage', {
        chat_id: chatId,
        text: `📝 Reply to the notification message, or use:\n\`/cmd ${token} <your command>\``,
        parse_mode: 'Markdown',
      });
    }
  }

  async _handleMessage(message, deps) {
    const chatId = message.chat.id;
    const userId = message.from.id;
    const text = message.text.trim();

    // Skip bot commands
    if (text === '/start' || text === '/help') return;

    // Authorization check
    if (!this._isAuthorized(userId, chatId)) {
      await this.sendError(String(chatId), 'You are not authorized to use this bot.');
      return;
    }

    // Reply-to routing: if replying to a bot notification, look up the token
    let sessionId = null;
    let command = text;

    const repliedTo = message.reply_to_message;
    if (repliedTo?.message_id && repliedTo.from?.is_bot) {
      const token = deps.tokenStore.lookup(String(chatId), String(repliedTo.message_id));
      if (token) {
        deps.tokenStore.delete(String(chatId), String(repliedTo.message_id));
        const validation = await deps.registry.validateToken(token, String(chatId));
        if (validation.valid) {
          sessionId = validation.session_id;
        }
      }
    }

    // /cmd TOKEN command parsing
    if (!sessionId) {
      const cmdMatch = text.match(/^\/cmd\s+([A-Za-z0-9_-]{8,30})\s+(.+)$/is);
      if (cmdMatch) {
        const validation = await deps.registry.validateToken(cmdMatch[1], String(chatId));
        if (validation.valid) {
          sessionId = validation.session_id;
          command = cmdMatch[2];
        } else {
          await this.sendError(String(chatId), `${validation.error}. Please wait for a new notification.`);
          return;
        }
      }
    }

    // Direct token+command parsing (no /cmd prefix)
    if (!sessionId) {
      const directMatch = text.match(/^([A-Za-z0-9_-]{8,30})\s+(.+)$/s);
      if (directMatch) {
        const validation = await deps.registry.validateToken(directMatch[1], String(chatId));
        if (validation.valid) {
          sessionId = validation.session_id;
          command = directMatch[2];
        }
      }
    }

    if (!sessionId) {
      if (repliedTo?.from?.is_bot) {
        await this.sendError(String(chatId), 'That notification has expired. Wait for a new one.');
      } else {
        await this.sendError(String(chatId), 'Invalid format. Reply to a notification or use `/cmd TOKEN command`.');
      }
      return;
    }

    if (this._onCommand) {
      await this._onCommand({
        channelId: String(chatId),
        sessionId,
        command,
        userId: String(userId),
        replyToMessageId: repliedTo ? String(repliedTo.message_id) : undefined,
      });
    }
  }

  _isAuthorized(userId, chatId) {
    const whitelist = this.config.whitelist || [];
    if (whitelist.includes(String(chatId)) || whitelist.includes(String(userId))) return true;
    if (whitelist.length === 0) {
      const configured = this.chatId;
      if (configured && String(chatId) === String(configured)) return true;
    }
    return false;
  }

  _escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/[_*[\]]/g, '\\$&');
  }

  async _apiCall(method, params) {
    const response = await this._http.post(`${this.apiBase}/${method}`, params, {
      ...(this.config.forceIPv4 ? { family: 4 } : {}),
    });
    return response.data;
  }

  async _answerCallback(queryId, text = '') {
    try {
      await this._apiCall('answerCallbackQuery', {
        callback_query_id: queryId,
        text,
      });
    } catch (err) {
      this.logger.warn(`answerCallbackQuery failed: ${err.message}`);
    }
  }

  // start() and stop() are no-ops for webhook mode.
  // The Express routes are mounted by CommandRouter.
  async start() {}
  async stop() {}
}

module.exports = { TelegramProvider };

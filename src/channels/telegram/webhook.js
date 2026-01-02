/**
 * Telegram Webhook Handler
 * Handles incoming Telegram messages and commands
 */

const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const Logger = require('../../core/logger');
const ControllerInjector = require('../../utils/controller-injector');
const SessionRegistry = require('../../registry/session-registry');
const MessageTokenStore = require('../../storage/message-token-store');
const { createEventRoutes } = require('../../routes/events');
const { createInjector } = require('../../relay/injector-registry');

class TelegramWebhookHandler {
    constructor(config = {}) {
        this.config = config;
        this.logger = new Logger('TelegramWebhook');
        this.sessionsDir = path.join(__dirname, '../../data/sessions');
        this.injector = new ControllerInjector();
        this.app = express();
        this.apiBaseUrl = 'https://api.telegram.org';
        this.botUsername = null; // Cache for bot username

        // Initialize session registry for Claude hook integration
        this.registry = new SessionRegistry({
            dataDir: path.join(__dirname, '../../data'),
            logger: this.logger,
        });

        // Initialize message token store for reply-to routing
        this.messageTokenStore = new MessageTokenStore({
            dbPath: path.join(__dirname, '../../data/message-tokens.db'),
            ttlMs: 24 * 60 * 60 * 1000, // 24 hours
            logger: this.logger,
        });

        this._setupMiddleware();
        this._setupRoutes();
    }

    _setupMiddleware() {
        // Parse JSON for all requests
        this.app.use(express.json());
    }

    _setupRoutes() {
        // Telegram webhook endpoint (with optional secret path segment)
        const webhookPath = this.getWebhookPath();
        this.app.post(webhookPath, this._handleWebhook.bind(this));

        // Health check endpoint
        this.app.get('/health', (req, res) => {
            res.json({ status: 'ok', service: 'telegram-webhook' });
        });

        // Mount event routes for Claude hook integration
        const eventRoutes = createEventRoutes({
            registry: this.registry,
            logger: this.logger,
            onStop: this._handleStopEvent.bind(this),
        });
        this.app.use(eventRoutes);
    }

    /**
     * Handle Stop event from Claude hooks
     * Sends Telegram notification with action buttons
     *
     * @param {object} params
     * @param {object} params.session - Session record
     * @param {string} params.event - "Stop" or "SubagentStop"
     * @param {string} params.summary - Task summary
     * @param {string} params.label - Human-friendly label
     * @returns {Promise<object>} Result with token
     */
    async _handleStopEvent({ session, event, summary, label }) {
        const chatId = this.config.chatId || this.config.groupId;

        if (!chatId) {
            throw new Error('No chat_id configured');
        }

        // Mint a token for this notification
        const token = this.registry.mintToken(session.session_id, chatId, {
            context: { event, summary },
        });

        // Format the notification message
        const emoji = event === 'SubagentStop' ? '🔧' : '🤖';
        const displayLabel = label || session.label || session.session_id.slice(0, 8);
        const cwdShort = session.cwd ? session.cwd.split('/').slice(-2).join('/') : 'unknown';

        const message = [
            `${emoji} *${event}*: ${this._escapeMarkdown(displayLabel)}`,
            '',
            this._escapeMarkdown(summary),
            '',
            `📂 \`${cwdShort}\``,
            '',
            `↩️ _Swipe-reply to respond_`,
        ].join('\n');

        // Create inline keyboard with common actions
        const keyboard = {
            inline_keyboard: [
                [
                    { text: '▶️ Continue', callback_data: `cmd:${token}:continue` },
                    { text: '✅ Yes', callback_data: `cmd:${token}:y` },
                    { text: '❌ No', callback_data: `cmd:${token}:n` },
                ],
                [
                    { text: '🛑 Exit', callback_data: `cmd:${token}:exit` },
                    { text: '📝 Custom...', callback_data: `personal:${token}` },
                ],
            ],
        };

        const response = await this._sendMessage(chatId, message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });

        // Store message_id → token mapping for reply-to routing
        if (response?.ok && response.result?.message_id > 0) {
            this.messageTokenStore.store(chatId, response.result.message_id, token);
            this.logger.debug(`Stored reply-to mapping: ${chatId}:${response.result.message_id} → ${token.slice(0, 8)}...`);
            this.logger.info(`Stop notification sent for session: ${session.session_id} (${displayLabel})`);
        } else {
            this.logger.warn(`Stop notification failed for session: ${session.session_id} (${displayLabel})`);
        }

        return { token };
    }

    /**
     * Escape special characters for Telegram basic Markdown
     * Only escapes: _ * ` [
     */
    _escapeMarkdown(text) {
        if (!text) return '';
        return text.replace(/[_*`[]/g, '\\$&');
    }

    /**
     * Get the webhook path (with optional secret segment for defense-in-depth)
     * @returns {string} The webhook path
     */
    getWebhookPath() {
        const basePath = '/webhook/telegram';
        if (this.config.webhookPathSecret) {
            return `${basePath}/${this.config.webhookPathSecret}`;
        }
        return basePath;
    }

    /**
     * Generate network options for axios requests
     * @returns {Object} Network options object
     */
    _getNetworkOptions() {
        const options = {};
        if (this.config.forceIPv4) {
            options.family = 4;
        }
        return options;
    }

    async _handleWebhook(req, res) {
        try {
            // Verify webhook secret token if configured
            // This prevents forged POSTs from attackers who guess chat_id/user_id
            const webhookSecret = this.config.webhookSecret;
            if (webhookSecret) {
                const headerSecret = req.get('X-Telegram-Bot-Api-Secret-Token');
                if (!headerSecret || headerSecret !== webhookSecret) {
                    this.logger.warn('Webhook request rejected: invalid or missing secret token');
                    return res.sendStatus(401);
                }
            }

            const update = req.body;

            // Handle different update types
            if (update.message) {
                await this._handleMessage(update.message);
            } else if (update.callback_query) {
                await this._handleCallbackQuery(update.callback_query);
            }

            res.status(200).send('OK');
        } catch (error) {
            this.logger.error('Webhook handling error:', error.message);
            res.status(500).send('Internal Server Error');
        }
    }

    async _handleMessage(message) {
        const chatId = message.chat.id;
        const userId = message.from.id;
        const messageText = message.text?.trim();

        if (!messageText) return;

        // Check if user is authorized
        if (!this._isAuthorized(userId, chatId)) {
            this.logger.warn(`Unauthorized user/chat: ${userId}/${chatId}`);
            await this._sendMessage(chatId, '⚠️ You are not authorized to use this bot.');
            return;
        }

        // Handle /start command
        if (messageText === '/start') {
            await this._sendWelcomeMessage(chatId);
            return;
        }

        // Handle /help command
        if (messageText === '/help') {
            await this._sendHelpMessage(chatId);
            return;
        }

        // Check for reply-to routing first
        // If user replies to a bot notification, route using the stored token
        const repliedTo = message.reply_to_message;
        if (repliedTo?.message_id && repliedTo.from?.is_bot) {
            const token = this.messageTokenStore.lookup(chatId, repliedTo.message_id);
            if (token) {
                this.logger.info(`Reply-to routing: ${chatId}:${repliedTo.message_id} → ${token.slice(0, 8)}...`);
                // Delete mapping after lookup (single-use)
                this.messageTokenStore.delete(chatId, repliedTo.message_id);
                await this._processCommand(chatId, token, messageText);
                return;
            }
            // Token not found or expired - fall through to normal parsing
            // This handles the case where user replies to an old message
            this.logger.debug(`No token found for reply to ${chatId}:${repliedTo.message_id}, trying /cmd parsing`);
        }

        // Parse command
        // Support both old 8-char tokens (ABC12345) and new base64url tokens (79y7B05zwzwGcyhotcqREg)
        const commandMatch = messageText.match(/^\/cmd\s+([A-Za-z0-9_-]{8,30})\s+(.+)$/i);
        if (!commandMatch) {
            // Check if it's a direct command without /cmd prefix
            const directMatch = messageText.match(/^([A-Za-z0-9_-]{8,30})\s+(.+)$/);
            if (directMatch) {
                await this._processCommand(chatId, directMatch[1], directMatch[2]);
            } else {
                // Only show error if this wasn't a reply to a bot message
                // (replies to old messages with expired tokens should get a friendlier message)
                if (repliedTo?.from?.is_bot) {
                    await this._sendMessage(chatId,
                        '⏰ That notification has expired. Please use the `/cmd TOKEN` format from a newer notification, or wait for Claude to send a new one.',
                        { parse_mode: 'Markdown' });
                } else {
                    await this._sendMessage(chatId,
                        '❌ Invalid format. Use:\n`/cmd <TOKEN> <command>`\n\nOr reply directly to a notification message.',
                        { parse_mode: 'Markdown' });
                }
            }
            return;
        }

        const token = commandMatch[1]; // Don't uppercase - base64url is case-sensitive
        const command = commandMatch[2];

        await this._processCommand(chatId, token, command);
    }

    async _processCommand(chatId, token, command) {
        // Validate token using registry
        const validation = this.registry.validateToken(token, chatId.toString());
        if (!validation.valid) {
            this.logger.warn(`Token validation failed: ${validation.error} - Token: ${token.slice(0, 8)}..., Command: "${command.slice(0, 50)}..."`);
            await this._sendMessage(chatId,
                `❌ ${validation.error}. Please wait for a new task notification.`,
                { parse_mode: 'Markdown' });
            return;
        }

        // Get session for transport info
        const session = this.registry.getSession(validation.session_id);
        if (!session) {
            await this._sendMessage(chatId,
                '❌ Session not found. Please wait for a new task notification.',
                { parse_mode: 'Markdown' });
            return;
        }

        try {
            // Inject command using session's transport
            await this._injectToSession(session, command);

            // Send confirmation
            const transportDesc = session.transport?.kind === 'nvim' ? 'nvim' : 'tmux';
            await this._sendMessage(chatId,
                `✅ *Command sent successfully*\n\n📝 *Command:* ${command}\n🖥️ *Transport:* ${transportDesc}\n📋 *Session:* ${session.label || session.session_id.slice(0, 8)}\n\nClaude is now processing your request...`,
                { parse_mode: 'Markdown' });

            // Log command execution
            this.logger.info(`Command injected - User: ${chatId}, Token: ${token}, Session: ${session.session_id}, Command: ${command}`);

        } catch (error) {
            this.logger.error('Command injection failed:', error.message);
            await this._sendMessage(chatId,
                `❌ *Command execution failed:* ${error.message}`,
                { parse_mode: 'Markdown' });
        }
    }

    async _handleCallbackQuery(callbackQuery) {
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;

        // Handle cmd:token:command format (from new inline buttons)
        if (data.startsWith('cmd:')) {
            const parts = data.split(':');
            if (parts.length >= 3) {
                const token = parts[1];
                const command = parts.slice(2).join(':'); // In case command has colons

                // Validate token using registry
                const validation = this.registry.validateToken(token, chatId);
                if (!validation.valid) {
                    this.logger.warn(`Callback token validation failed: ${validation.error} - Token: ${token.slice(0, 8)}..., Action: ${command}`);
                    await this._answerCallbackQuery(callbackQuery.id, `❌ ${validation.error}`);
                    return;
                }

                // Get session for transport info
                const session = this.registry.getSession(validation.session_id);
                if (!session) {
                    await this._answerCallbackQuery(callbackQuery.id, '❌ Session not found');
                    return;
                }

                try {
                    // Inject command based on transport type
                    await this._injectToSession(session, command);

                    await this._answerCallbackQuery(callbackQuery.id, `✅ Sent: ${command}`);

                    // Also send confirmation message
                    const displayLabel = session.label || session.session_id.slice(0, 8);
                    await this._sendMessage(chatId,
                        `✅ *Command sent*\n\n📝 \`${command}\`\n🖥️ *Session:* ${displayLabel}`,
                        { parse_mode: 'Markdown' });

                    this.logger.info(`Button command sent: ${command} -> ${session.session_id}`);
                } catch (error) {
                    await this._answerCallbackQuery(callbackQuery.id, `❌ Failed: ${error.message}`);
                    this.logger.error(`Button command failed: ${error.message}`);
                }
                return;
            }
        }

        // Answer callback query to remove loading state
        await this._answerCallbackQuery(callbackQuery.id);

        if (data.startsWith('personal:')) {
            const token = data.split(':')[1];
            // Send personal chat command format
            await this._sendMessage(chatId,
                `📝 *Personal Chat Command Format:*\n\n\`/cmd ${token} <your command>\`\n\n*Example:*\n\`/cmd ${token} please analyze this code\`\n\n💡 *Copy and paste the format above, then add your command!*`,
                { parse_mode: 'Markdown' });
        } else if (data.startsWith('group:')) {
            const token = data.split(':')[1];
            // Send group chat command format with @bot_name
            const botUsername = await this._getBotUsername();
            await this._sendMessage(chatId,
                `👥 *Group Chat Command Format:*\n\n\`@${botUsername} /cmd ${token} <your command>\`\n\n*Example:*\n\`@${botUsername} /cmd ${token} please analyze this code\`\n\n💡 *Copy and paste the format above, then add your command!*`,
                { parse_mode: 'Markdown' });
        } else if (data.startsWith('session:')) {
            const token = data.split(':')[1];
            // For backward compatibility - send help message for old callback buttons
            await this._sendMessage(chatId,
                `📝 *How to send a command:*\n\nType:\n\`/cmd ${token} <your command>\`\n\nExample:\n\`/cmd ${token} please analyze this code\`\n\n💡 *Tip:* New notifications have a button that auto-fills the command for you!`,
                { parse_mode: 'Markdown' });
        }
    }

    /**
     * Inject command into a session based on its transport type
     */
    async _injectToSession(session, command) {
        const transport = session.transport || {};

        switch (transport.kind) {
            case 'nvim': {
                // Try nvim RPC first, fall back to tmux if available
                if (transport.nvim_socket) {
                    try {
                        const instanceName = transport.instance_name || session.label || 'default';
                        const injector = createInjector({
                            logger: this.logger,
                            session: {
                                type: 'nvim',
                                socketPath: transport.nvim_socket,
                                instanceName: instanceName,
                            }
                        });
                        const result = await injector.inject(command);
                        if (result.ok) {
                            this.logger.info('Command injected via nvim RPC');
                            return;
                        }
                        this.logger.warn(`nvim injection failed: ${result.error}, trying tmux fallback`);
                    } catch (error) {
                        this.logger.warn(`nvim injection error: ${error.message}, trying tmux fallback`);
                    }
                }
                // Fall back to tmux if nvim fails and tmux info is available
                // Prefer pane_id (stable) over session:window.pane (can become stale)
                if (transport.tmux_pane_id || transport.tmux_session) {
                    const tmuxInjector = createInjector({
                        logger: this.logger,
                        session: {
                            type: 'tmux',
                            paneId: transport.tmux_pane_id,
                            sessionName: transport.tmux_session
                        }
                    });
                    const result = await tmuxInjector.inject(command);
                    if (!result.ok) {
                        throw new Error(result.error || 'tmux fallback injection failed');
                    }
                    this.logger.info('Command injected via tmux fallback');
                    return;
                }
                throw new Error('nvim injection failed and no tmux fallback available');
            }

            case 'tmux': {
                // Prefer pane_id (stable) over session_name (can become stale)
                const tmuxInjector = createInjector({
                    logger: this.logger,
                    session: {
                        type: 'tmux',
                        paneId: transport.pane_id,
                        sessionName: transport.session_name || 'claude-code'
                    }
                });
                const result = await tmuxInjector.inject(command);
                if (!result.ok) {
                    throw new Error(result.error || 'tmux injection failed');
                }
                break;
            }

            case 'pty':
                // PTY injection needs session key from old system
                await this.injector.injectCommand(command, session.session_id);
                break;

            default:
                // Fall back to label or session_id as injector key
                await this.injector.injectCommand(command, session.label || session.session_id);
        }
    }

    async _sendWelcomeMessage(chatId) {
        const message = `🤖 *Welcome to Claude Code Remote Bot!*\n\n` +
            `I'll notify you when Claude completes tasks or needs input.\n\n` +
            `When you receive a notification with a token, you can send commands back using:\n` +
            `\`/cmd <TOKEN> <your command>\`\n\n` +
            `Type /help for more information.`;
        
        await this._sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

    async _sendHelpMessage(chatId) {
        const message = `📚 *Claude Code Remote Bot Help*\n\n` +
            `*Commands:*\n` +
            `• \`/start\` - Welcome message\n` +
            `• \`/help\` - Show this help\n` +
            `• \`/cmd <TOKEN> <command>\` - Send command to Claude\n\n` +
            `*Example:*\n` +
            `\`/cmd ABC12345 analyze the performance of this function\`\n\n` +
            `*Tips:*\n` +
            `• Tokens are case-insensitive\n` +
            `• Tokens expire after 24 hours\n` +
            `• You can also just type \`TOKEN command\` without /cmd`;
        
        await this._sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }

    _isAuthorized(userId, chatId) {
        // Check whitelist
        const whitelist = this.config.whitelist || [];
        
        if (whitelist.includes(String(chatId)) || whitelist.includes(String(userId))) {
            return true;
        }
        
        // If no whitelist configured, allow configured chat/user
        if (whitelist.length === 0) {
            const configuredChatId = this.config.chatId || this.config.groupId;
            if (configuredChatId && String(chatId) === String(configuredChatId)) {
                return true;
            }
        }
        
        return false;
    }

    async _getBotUsername() {
        if (this.botUsername) {
            return this.botUsername;
        }

        try {
            const response = await axios.get(
                `${this.apiBaseUrl}/bot${this.config.botToken}/getMe`,
                this._getNetworkOptions()
            );
            
            if (response.data.ok && response.data.result.username) {
                this.botUsername = response.data.result.username;
                return this.botUsername;
            }
        } catch (error) {
            this.logger.error('Failed to get bot username:', error.message);
        }
        
        // Fallback to configured username or default
        return this.config.botUsername || 'claude_remote_bot';
    }

    async _findSessionByToken(token) {
        const files = fs.readdirSync(this.sessionsDir);
        
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            
            const sessionPath = path.join(this.sessionsDir, file);
            try {
                const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                if (session.token === token) {
                    return session;
                }
            } catch (error) {
                this.logger.error(`Failed to read session file ${file}:`, error.message);
            }
        }
        
        return null;
    }

    async _removeSession(sessionId) {
        const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
        if (fs.existsSync(sessionFile)) {
            fs.unlinkSync(sessionFile);
            this.logger.debug(`Session removed: ${sessionId}`);
        }
    }

    async _sendMessage(chatId, text, options = {}) {
        try {
            const response = await axios.post(
                `${this.apiBaseUrl}/bot${this.config.botToken}/sendMessage`,
                {
                    chat_id: chatId,
                    text: text,
                    ...options
                },
                this._getNetworkOptions()
            );
            return response.data;
        } catch (error) {
            this.logger.error('Failed to send message:', error.response?.data || error.message);
            return null;
        }
    }

    async _answerCallbackQuery(callbackQueryId, text = '') {
        try {
            await axios.post(
                `${this.apiBaseUrl}/bot${this.config.botToken}/answerCallbackQuery`,
                {
                    callback_query_id: callbackQueryId,
                    text: text
                },
                this._getNetworkOptions()
            );
        } catch (error) {
            this.logger.error('Failed to answer callback query:', error.response?.data || error.message);
        }
    }

    async getWebhookInfo() {
        try {
            const response = await axios.get(
                `${this.apiBaseUrl}/bot${this.config.botToken}/getWebhookInfo`,
                this._getNetworkOptions()
            );
            return response.data.result;
        } catch (error) {
            this.logger.error('Failed to get webhook info:', error.response?.data || error.message);
            throw error;
        }
    }

    async setWebhook(webhookUrl, options = {}) {
        const { force = false } = options;

        try {
            // Check current webhook state to avoid unnecessary updates
            if (!force) {
                const currentInfo = await this.getWebhookInfo();
                if (currentInfo.url === webhookUrl) {
                    this.logger.info('Webhook already configured, skipping setWebhook');
                    return { ok: true, skipped: true, description: 'Webhook already configured' };
                }
            }

            const payload = {
                url: webhookUrl,
                allowed_updates: ['message', 'callback_query']
            };

            // Include secret_token if configured
            // Telegram will send this in X-Telegram-Bot-Api-Secret-Token header
            if (this.config.webhookSecret) {
                payload.secret_token = this.config.webhookSecret;
            }

            // Drop pending updates if configured (useful for dev sessions)
            if (this.config.dropPendingUpdates) {
                payload.drop_pending_updates = true;
            }

            const response = await axios.post(
                `${this.apiBaseUrl}/bot${this.config.botToken}/setWebhook`,
                payload,
                this._getNetworkOptions()
            );

            this.logger.info('Webhook set successfully:', response.data);
            return response.data;
        } catch (error) {
            this.logger.error('Failed to set webhook:', error.response?.data || error.message);
            throw error;
        }
    }

    start(port = 3000) {
        this.app.listen(port, () => {
            this.logger.info(`Telegram webhook server started on port ${port}`);
        });
    }
}

module.exports = TelegramWebhookHandler;

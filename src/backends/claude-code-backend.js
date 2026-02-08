const { AgentBackend } = require('./agent-backend');
const { createInjector: defaultCreateInjector } = require('../channels/telegram/injector');
const Logger = require('../core/logger');

/**
 * ClaudeCodeBackend — injects commands into Claude Code sessions via tmux/nvim.
 *
 * Extracted from TelegramWebhookHandler._injectToSession() (webhook.js:492-581).
 * Logic is identical, just wrapped in the AgentBackend interface.
 */
class ClaudeCodeBackend extends AgentBackend {
  constructor({ createInjector, logger } = {}) {
    super();
    this._createInjector = createInjector || defaultCreateInjector;
    this.logger = logger || new Logger('ClaudeCodeBackend');
  }

  get name() { return 'claude-code'; }

  async injectCommand(session, command) {
    const transport = session.transport || {};

    // Nvim path: try RPC first, fall back to tmux
    if (transport.kind === 'nvim' && transport.nvim_socket) {
      try {
        const injector = this._createInjector({
          logger: this.logger,
          session: {
            type: 'nvim',
            socketPath: transport.nvim_socket,
            instanceName: transport.instance_name || session.label || 'default',
          },
        });
        const result = await injector.inject(command);
        if (result.ok) {
          return { ok: true, transport: 'nvim' };
        }
        this.logger.warn(`nvim injection failed: ${result.error}, trying tmux fallback`);
      } catch (err) {
        this.logger.warn(`nvim injection error: ${err.message}, trying tmux fallback`);
      }
    }

    // Tmux path (primary or fallback)
    const paneId = transport.tmux_pane_id || transport.pane_id;
    const sessionName = transport.tmux_session || transport.session_name;

    if (paneId || sessionName) {
      const injector = this._createInjector({
        logger: this.logger,
        session: {
          type: 'tmux',
          paneId,
          sessionName: sessionName || 'claude-code',
        },
      });
      const result = await injector.inject(command);
      if (result.ok) {
        return { ok: true, transport: 'tmux' };
      }
      return { ok: false, error: result.error || 'tmux injection failed' };
    }

    return { ok: false, error: `No injection method available (transport: ${transport.kind || 'none'})` };
  }
}

module.exports = { ClaudeCodeBackend };

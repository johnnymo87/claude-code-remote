/**
 * AgentBackend — abstract interface for AI agent interaction.
 *
 * Subclasses implement how commands are injected into running AI sessions.
 * ClaudeCodeBackend uses tmux/nvim injection.
 * Future: OpenCodeBackend will use the OpenCode HTTP API.
 */

class AgentBackend {
  constructor() {
    if (new.target === AgentBackend) {
      throw new Error('AgentBackend is abstract and cannot be instantiated directly');
    }
  }

  /** @returns {string} Backend identifier, e.g. 'claude-code', 'opencode' */
  get name() {
    throw new Error('Subclass must implement name getter');
  }

  /**
   * Inject a command into a running session.
   * @param {object} session — session record from SessionRegistry
   * @param {string} command — the user's command text
   * @returns {Promise<{ok: boolean, error?: string, transport?: string}>}
   */
  async injectCommand(session, command) {
    throw new Error('Subclass must implement injectCommand()');
  }
}

module.exports = { AgentBackend };

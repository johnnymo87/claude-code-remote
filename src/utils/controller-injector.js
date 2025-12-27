/**
 * Controller Injector
 *
 * High-level interface for injecting commands into Claude Code sessions.
 * Delegates to the appropriate injector based on session configuration.
 *
 * This is a backward-compatible wrapper around the new injector registry.
 */

const path = require('path');
const fs = require('fs');
const Logger = require('../core/logger');
const { createInjector, spawnAsync } = require('../relay/injector-registry');

class ControllerInjector {
    constructor(config = {}) {
        this.logger = new Logger('ControllerInjector');
        // Default mode for backward compatibility
        this.defaultMode = config.mode || process.env.INJECTION_MODE || 'pty';
        this.defaultSession = config.defaultSession || process.env.TMUX_SESSION || 'claude-code';
        this.sessionMapPath = config.sessionMapPath ||
            process.env.SESSION_MAP_PATH ||
            path.join(__dirname, '../data/session-map.json');

        // Cache of injector instances by session name/token
        this._injectorCache = new Map();
    }

    /**
     * Get or create an injector for the given session
     *
     * @param {string} sessionKey - Session name or token
     * @returns {object} Injector instance
     */
    _getInjector(sessionKey) {
        // Check cache first
        if (this._injectorCache.has(sessionKey)) {
            return this._injectorCache.get(sessionKey);
        }

        // Try to load session config from session-map.json
        let sessionConfig = this._loadSessionConfig(sessionKey);

        // If no session config found, fall back to default mode
        if (!sessionConfig) {
            this.logger.debug(`No session config for '${sessionKey}', using default mode: ${this.defaultMode}`);
            sessionConfig = this._buildDefaultSessionConfig(sessionKey);
        }

        // Create injector using the registry
        const injector = createInjector({
            logger: this.logger,
            session: sessionConfig,
        });

        // Cache it
        this._injectorCache.set(sessionKey, injector);

        return injector;
    }

    /**
     * Load session configuration from session-map.json
     */
    _loadSessionConfig(sessionKey) {
        try {
            if (!fs.existsSync(this.sessionMapPath)) {
                return null;
            }

            const sessionMap = JSON.parse(fs.readFileSync(this.sessionMapPath, 'utf8'));
            const config = sessionMap[sessionKey];

            if (!config) {
                return null;
            }

            // Ensure type is set (for backward compatibility with old session maps)
            if (!config.type) {
                // Infer type from existing fields
                if (config.ptyPath) {
                    config.type = 'pty';
                } else if (config.tmuxSession || config.sessionName) {
                    config.type = 'tmux';
                    config.sessionName = config.sessionName || config.tmuxSession || sessionKey;
                } else if (config.socketPath || config.instanceName) {
                    config.type = 'nvim';
                } else {
                    // Default based on mode
                    config.type = this.defaultMode;
                }
            }

            return config;

        } catch (error) {
            this.logger.warn(`Failed to load session config: ${error.message}`);
            return null;
        }
    }

    /**
     * Build a default session config based on the default mode
     */
    _buildDefaultSessionConfig(sessionKey) {
        switch (this.defaultMode) {
            case 'tmux':
                return {
                    type: 'tmux',
                    sessionName: sessionKey,
                };
            case 'nvim':
                return {
                    type: 'nvim',
                    socketPath: process.env.NVIM_SOCKET || '/tmp/nvim-claude.sock',
                    instanceName: sessionKey,
                };
            case 'pty':
            default:
                return {
                    type: 'pty',
                    // PTY mode needs a ptyPath, which should come from session map
                    // If we don't have one, injection will fail with a clear error
                };
        }
    }

    /**
     * Inject a command into a session
     *
     * @param {string} command - Command to inject
     * @param {string} sessionName - Session name/token (optional, uses default)
     * @returns {Promise<boolean>} Success status
     */
    async injectCommand(command, sessionName = null) {
        const session = sessionName || this.defaultSession;

        try {
            const injector = this._getInjector(session);
            const result = await injector.inject(command);

            if (result.ok) {
                this.logger.info(`Command injected to session '${session}'`);
                return true;
            } else {
                throw new Error(result.error || 'injection failed');
            }

        } catch (error) {
            this.logger.error(`Failed to inject command: ${error.message}`);
            throw error;
        }
    }

    /**
     * Capture output from a session
     *
     * @param {string} sessionName - Session name/token
     * @param {number} lines - Number of lines to capture (default 50)
     * @returns {Promise<string>} Captured output
     */
    async captureOutput(sessionName = null, lines = 50) {
        const session = sessionName || this.defaultSession;

        try {
            const injector = this._getInjector(session);

            if (!injector.capabilities?.capture) {
                throw new Error(`Capture not supported for session type`);
            }

            const result = await injector.capture({ lines });

            if (result.ok) {
                return result.output;
            } else {
                throw new Error(result.error || 'capture failed');
            }

        } catch (error) {
            this.logger.error(`Failed to capture output: ${error.message}`);
            throw error;
        }
    }

    /**
     * List available sessions
     *
     * @returns {string[]} List of session names/tokens
     */
    listSessions() {
        const sessions = new Set();

        // Add sessions from session-map.json
        try {
            if (fs.existsSync(this.sessionMapPath)) {
                const sessionMap = JSON.parse(fs.readFileSync(this.sessionMapPath, 'utf8'));
                Object.keys(sessionMap).forEach(key => sessions.add(key));
            }
        } catch (error) {
            this.logger.warn(`Failed to read session map: ${error.message}`);
        }

        // For tmux mode, also list tmux sessions
        if (this.defaultMode === 'tmux') {
            try {
                const { execSync } = require('child_process');
                const output = execSync('tmux list-sessions -F "#{session_name}"', {
                    encoding: 'utf8',
                    stdio: ['ignore', 'pipe', 'ignore']
                });
                output.trim().split('\n').filter(Boolean).forEach(s => sessions.add(s));
            } catch (error) {
                // tmux might not be running
            }
        }

        return Array.from(sessions);
    }

    /**
     * Clear the injector cache (useful if session config changes)
     */
    clearCache() {
        this._injectorCache.clear();
    }
}

module.exports = ControllerInjector;

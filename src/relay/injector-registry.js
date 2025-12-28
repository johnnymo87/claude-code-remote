/**
 * Injector Registry
 *
 * Provides a pluggable architecture for command injection into Claude Code sessions.
 * Each injector type (tmux, pty, nvim) implements a common interface.
 *
 * Interface:
 *   - inject(command: string): Promise<{ok: boolean, error?: string}>
 *   - capture(opts?: {lines?: number}): Promise<{ok: boolean, output?: string, error?: string}>
 *   - close?(): Promise<void>
 *   - capabilities?: {capture?: boolean}
 *
 * Usage:
 *   const { createInjector } = require('./injector-registry');
 *   const injector = createInjector({ logger, session: { type: 'tmux', sessionName: 'claude' } });
 *   await injector.inject('continue');
 */

const { spawn } = require('child_process');

/**
 * Execute a command using spawn (not exec) to avoid shell interpretation.
 * Returns a promise that resolves with { stdout, stderr, code }.
 *
 * @param {string} cmd - Command to execute
 * @param {string[]} args - Arguments array
 * @param {object} opts - Options (timeout, cwd, etc.)
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function spawnAsync(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: opts.timeout || 10000,
            ...opts,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
            resolve({ stdout, stderr, code });
        });

        proc.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Tmux Injector - Injects commands into tmux sessions
 */
class TmuxInjectorAdapter {
    constructor(logger, session) {
        this.logger = logger;
        this.sessionName = session.sessionName || session.tmuxSession || 'claude-code';
        this.capabilities = { capture: true };
    }

    async inject(command) {
        const delay = (ms) => new Promise(r => setTimeout(r, ms));

        try {
            // Check session exists
            const hasSession = await spawnAsync('tmux', ['has-session', '-t', this.sessionName]);
            if (hasSession.code !== 0) {
                return { ok: false, error: `tmux session '${this.sessionName}' not found` };
            }

            // Clear current input (Ctrl-U)
            await spawnAsync('tmux', ['send-keys', '-t', this.sessionName, 'C-u']);
            await delay(50);

            // Send the command (tmux send-keys handles escaping when passed as argument)
            await spawnAsync('tmux', ['send-keys', '-t', this.sessionName, command]);
            await delay(50);

            // Send Enter (C-m)
            await spawnAsync('tmux', ['send-keys', '-t', this.sessionName, 'C-m']);

            this.logger.debug(`Injected command to tmux session '${this.sessionName}'`);
            return { ok: true };

        } catch (error) {
            this.logger.error(`tmux injection failed: ${error.message}`);
            return { ok: false, error: error.message };
        }
    }

    async capture(opts = {}) {
        try {
            const lines = opts.lines || 50;
            const result = await spawnAsync('tmux', [
                'capture-pane',
                '-t', this.sessionName,
                '-p',
                '-S', `-${lines}`,
            ]);

            if (result.code !== 0) {
                return { ok: false, error: result.stderr || 'capture failed' };
            }

            return { ok: true, output: result.stdout };

        } catch (error) {
            return { ok: false, error: error.message };
        }
    }
}

/**
 * PTY Injector - Injects commands via PTY file writes
 */
class PtyInjectorAdapter {
    constructor(logger, session) {
        this.logger = logger;
        this.ptyPath = session.ptyPath;
        this.cwd = session.cwd;
        this.capabilities = { capture: false };
    }

    async inject(command) {
        const fs = require('fs');

        if (!this.ptyPath) {
            return { ok: false, error: 'no ptyPath configured' };
        }

        try {
            if (!fs.existsSync(this.ptyPath)) {
                return { ok: false, error: `PTY path does not exist: ${this.ptyPath}` };
            }

            fs.writeFileSync(this.ptyPath, command + '\n');
            this.logger.debug(`Injected command via PTY: ${this.ptyPath}`);
            return { ok: true };

        } catch (error) {
            this.logger.error(`PTY injection failed: ${error.message}`);
            return { ok: false, error: error.message };
        }
    }

    async capture() {
        // PTY mode doesn't support capture
        return { ok: false, error: 'capture not supported in PTY mode' };
    }
}

/**
 * Neovim RPC Injector - Injects commands via neovim's RPC mechanism
 *
 * Requires:
 *   - neovim running with --listen <socketPath>
 *   - ccremote.lua plugin loaded in neovim
 *   - Instance registered via :CCRegister <instanceName>
 */
class NvimRpcInjectorAdapter {
    constructor(logger, session) {
        this.logger = logger;
        this.socketPath = session.socketPath || '/tmp/nvim-claude.sock';
        this.instanceName = session.instanceName;
        this.capabilities = { capture: true };
    }

    /**
     * Call neovim's ccremote.dispatch() with a base64-encoded JSON payload
     */
    async _dispatch(payload) {
        const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');

        // Build the Lua expression to evaluate
        const luaExpr = `luaeval('require("ccremote").dispatch(_A)', '${b64}')`;

        try {
            const result = await spawnAsync('nvim', [
                '--server', this.socketPath,
                '--remote-expr', luaExpr,
            ]);

            if (result.code !== 0) {
                return { ok: false, error: result.stderr || 'nvim command failed' };
            }

            // Decode base64 JSON response
            const responseJson = Buffer.from(result.stdout.trim(), 'base64').toString();
            return JSON.parse(responseJson);

        } catch (error) {
            return { ok: false, error: error.message };
        }
    }

    async inject(command) {
        if (!this.instanceName) {
            return { ok: false, error: 'instanceName is required for nvim injection' };
        }

        const result = await this._dispatch({
            type: 'send',
            name: this.instanceName,
            command: command,
        });

        if (result.ok) {
            this.logger.debug(`Injected command to nvim instance '${this.instanceName}'`);
        } else {
            this.logger.error(`nvim injection failed: ${result.error}`);
        }

        return result;
    }

    async capture(opts = {}) {
        if (!this.instanceName) {
            return { ok: false, error: 'instanceName is required for nvim capture' };
        }

        return await this._dispatch({
            type: 'tail',
            name: this.instanceName,
            lines: opts.lines || 50,
        });
    }

    /**
     * List all registered instances in the neovim session
     */
    async listInstances() {
        return await this._dispatch({ type: 'list' });
    }
}

/**
 * Registry of available injector types
 */
const registry = {
    tmux: (ctx) => new TmuxInjectorAdapter(ctx.logger, ctx.session),
    pty: (ctx) => new PtyInjectorAdapter(ctx.logger, ctx.session),
    nvim: (ctx) => new NvimRpcInjectorAdapter(ctx.logger, ctx.session),
};

/**
 * Create an injector for the given session configuration
 *
 * @param {object} ctx - Context object
 * @param {object} ctx.logger - Logger instance
 * @param {object} ctx.session - Session configuration
 * @param {string} ctx.session.type - Injector type: 'tmux', 'pty', or 'nvim'
 * @returns {object} Injector instance
 */
function createInjector(ctx) {
    const type = ctx.session?.type;

    if (!type) {
        throw new Error('session.type is required');
    }

    const factory = registry[type];

    if (!factory) {
        const available = Object.keys(registry).join(', ');
        throw new Error(`Unknown injector type: '${type}'. Available: ${available}`);
    }

    return factory(ctx);
}

/**
 * Register a custom injector type
 *
 * @param {string} type - Type name
 * @param {function} factory - Factory function (ctx) => Injector
 */
function registerInjector(type, factory) {
    if (registry[type]) {
        throw new Error(`Injector type '${type}' already registered`);
    }
    registry[type] = factory;
}

/**
 * Get list of registered injector types
 */
function getRegisteredTypes() {
    return Object.keys(registry);
}

module.exports = {
    createInjector,
    registerInjector,
    getRegisteredTypes,
    // Export adapters for direct use if needed
    TmuxInjectorAdapter,
    PtyInjectorAdapter,
    NvimRpcInjectorAdapter,
    // Export utility
    spawnAsync,
};

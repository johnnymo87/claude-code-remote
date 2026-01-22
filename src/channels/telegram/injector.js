/**
 * Minimal Injector for Telegram Webhook
 *
 * Provides nvim RPC and tmux injection only.
 * PTY injection has been removed in favor of Worker routing.
 */

const { spawn } = require('child_process');

/**
 * Execute a command using spawn (not exec) to avoid shell interpretation.
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
class TmuxInjector {
    constructor(logger, session) {
        this.logger = logger;
        this.target = session.paneId || session.sessionName || 'claude-code';
    }

    async inject(command) {
        const delay = (ms) => new Promise(r => setTimeout(r, ms));

        try {
            const hasTarget = await spawnAsync('tmux', ['has-session', '-t', this.target]);
            if (hasTarget.code !== 0) {
                return { ok: false, error: `tmux target '${this.target}' not found` };
            }

            // Clear current input (Ctrl-U)
            await spawnAsync('tmux', ['send-keys', '-t', this.target, 'C-u']);
            await delay(100);

            // Send the command
            await spawnAsync('tmux', ['send-keys', '-t', this.target, command]);
            await delay(100);

            // Send Enter
            await spawnAsync('tmux', ['send-keys', '-t', this.target, 'C-m']);

            this.logger.debug(`Injected command to tmux target '${this.target}'`);
            return { ok: true };

        } catch (error) {
            this.logger.error(`tmux injection failed: ${error.message}`);
            return { ok: false, error: error.message };
        }
    }
}

/**
 * Neovim RPC Injector - Injects commands via neovim's RPC mechanism
 */
class NvimInjector {
    constructor(logger, session) {
        this.logger = logger;
        this.socketPath = session.socketPath || '/tmp/nvim-claude.sock';
        this.instanceName = session.instanceName;
    }

    async inject(command) {
        if (!this.instanceName) {
            return { ok: false, error: 'instanceName is required for nvim injection' };
        }

        const payload = {
            type: 'send',
            name: this.instanceName,
            command: command,
        };

        const b64 = Buffer.from(JSON.stringify(payload)).toString('base64');
        const luaExpr = `luaeval('require("ccremote").dispatch(_A)', '${b64}')`;

        try {
            const result = await spawnAsync('nvim', [
                '--server', this.socketPath,
                '--remote-expr', luaExpr,
            ]);

            if (result.code !== 0) {
                return { ok: false, error: result.stderr || 'nvim command failed' };
            }

            const responseJson = Buffer.from(result.stdout.trim(), 'base64').toString();
            const response = JSON.parse(responseJson);

            if (response.ok) {
                this.logger.debug(`Injected command to nvim instance '${this.instanceName}'`);
            } else {
                this.logger.error(`nvim injection failed: ${response.error}`);
            }

            return response;

        } catch (error) {
            return { ok: false, error: error.message };
        }
    }
}

/**
 * Create an injector for the given session configuration
 * @param {object} ctx - Context with logger and session
 * @returns {object} Injector instance
 */
function createInjector(ctx) {
    const type = ctx.session?.type;

    if (!type) {
        throw new Error('session.type is required');
    }

    switch (type) {
        case 'tmux':
            return new TmuxInjector(ctx.logger, ctx.session);
        case 'nvim':
            return new NvimInjector(ctx.logger, ctx.session);
        default:
            throw new Error(`Unknown injector type: '${type}'. Available: tmux, nvim`);
    }
}

module.exports = {
    createInjector,
    TmuxInjector,
    NvimInjector,
};

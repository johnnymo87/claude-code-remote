/**
 * SessionRegistry - Manages Claude Code session state
 *
 * This registry tracks active Claude Code sessions and their transport details
 * (nvim socket, tmux session, PTY path). Sessions can opt-in to Telegram
 * notifications via the /notify slash command.
 *
 * Storage: Currently uses JSON file with atomic writes.
 *
 * TODO: For improved robustness with concurrent access, consider migrating
 * to SQLite using better-sqlite3. The API is designed to make this migration
 * straightforward - just replace the _load/_save methods.
 *
 * Data Model:
 * - Sessions are keyed by Claude's session_id (from hook input)
 * - Each session tracks: transport details, notify flag, label, timestamps
 * - Tokens (for Telegram commands) are stored separately and reference session_id
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Mutex } = require('async-mutex');

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

class SessionRegistry {
    /**
     * @param {object} options
     * @param {string} options.dataDir - Directory for data files
     * @param {object} options.logger - Logger instance
     */
    constructor(options = {}) {
        this.dataDir = options.dataDir || path.join(__dirname, '../data');
        this.logger = options.logger || console;

        this.sessionsFile = path.join(this.dataDir, 'claude-sessions.json');
        this.tokensFile = path.join(this.dataDir, 'claude-tokens.json');

        // Mutex to prevent race conditions on file operations
        this._sessionsMutex = new Mutex();
        this._tokensMutex = new Mutex();

        this._ensureDataDir();
    }

    _ensureDataDir() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    // =========================================================================
    // Mutex helpers for thread-safe file operations
    // =========================================================================

    /**
     * Execute a function with the sessions mutex held
     * @param {function} fn - Async or sync function to execute
     * @returns {Promise<*>} Result of fn
     */
    async _withSessionLock(fn) {
        const release = await this._sessionsMutex.acquire();
        try {
            return await fn();
        } finally {
            release();
        }
    }

    /**
     * Execute a function with the tokens mutex held
     * @param {function} fn - Async or sync function to execute
     * @returns {Promise<*>} Result of fn
     */
    async _withTokenLock(fn) {
        const release = await this._tokensMutex.acquire();
        try {
            return await fn();
        } finally {
            release();
        }
    }

    // =========================================================================
    // Session CRUD
    // =========================================================================

    /**
     * Create or update a session
     *
     * @param {object} session
     * @param {string} session.session_id - Claude's session ID (required)
     * @param {number} session.ppid - Parent process ID
     * @param {number} session.pid - Process ID
     * @param {string} session.cwd - Working directory
     * @param {string} session.nvim_socket - Neovim socket path (if in nvim)
     * @param {string} session.label - Human-friendly label
     * @param {boolean} session.notify - Whether to send Telegram notifications
     * @returns {Promise<object>} The created/updated session
     */
    async upsertSession(session) {
        if (!session.session_id) {
            throw new Error('session_id is required');
        }

        return this._withSessionLock(() => {
            const sessions = this._loadSessions();
            const now = Date.now();

            const existing = sessions[session.session_id];

            const updated = {
                session_id: session.session_id,
                ppid: session.ppid ?? existing?.ppid,
                pid: session.pid ?? existing?.pid,
                start_time: session.start_time ?? existing?.start_time,
                cwd: session.cwd ?? existing?.cwd,
                label: session.label ?? existing?.label,
                notify: session.notify ?? existing?.notify ?? false,
                transport: this._buildTransport(session, existing),
                state: session.state ?? existing?.state ?? 'running',
                created_at: existing?.created_at ?? now,
                updated_at: now,
                last_seen: now,
                expires_at: now + DEFAULT_SESSION_TTL_MS,
            };

            sessions[session.session_id] = updated;
            this._saveSessions(sessions);

            this.logger.info?.(`Session upserted: ${session.session_id}`) ||
                this.logger.log?.(`Session upserted: ${session.session_id}`);

            return updated;
        });
    }

    /**
     * Build transport object from session data
     *
     * Priority: nvim > tmux > pty
     * But if running nvim inside tmux, store both so we can fallback to tmux
     */
    _buildTransport(session, existing) {
        // If nvim_socket is provided, primary transport is nvim
        // But also store tmux as fallback if available
        if (session.nvim_socket) {
            return {
                kind: 'nvim',
                nvim_socket: session.nvim_socket,
                buffer: session.buffer ?? existing?.transport?.buffer,
                instance_name: session.instance_name ?? existing?.transport?.instance_name,
                // Store tmux as fallback - prefer pane_id (stable) over session:window.pane (unstable)
                tmux_pane_id: session.tmux_pane_id || existing?.transport?.tmux_pane_id,
                tmux_session: session.tmux_pane || session.tmux_session || existing?.transport?.tmux_session,
            };
        }

        // If tmux_session is provided, it's a tmux session
        // Prefer pane_id (e.g., %47) which is stable within tmux server lifetime
        // Fallback to session:window.pane format (can become stale if windows renumbered)
        if (session.tmux_session || session.tmux_pane || session.tmux_pane_id) {
            return {
                kind: 'tmux',
                pane_id: session.tmux_pane_id,
                session_name: session.tmux_pane || session.tmux_session,
            };
        }

        // If pty_path is provided, it's a PTY session
        if (session.pty_path) {
            return {
                kind: 'pty',
                pty_path: session.pty_path,
            };
        }

        // Preserve existing transport or default to unknown
        return existing?.transport ?? { kind: 'unknown' };
    }

    /**
     * Get a session by ID
     *
     * @param {string} sessionId
     * @returns {object|null}
     */
    getSession(sessionId) {
        const sessions = this._loadSessions();
        return sessions[sessionId] ?? null;
    }

    /**
     * Get a session by PPID (for hooks that only know PPID)
     *
     * @param {number} ppid
     * @returns {object|null}
     */
    getSessionByPpid(ppid) {
        const sessions = this._loadSessions();
        const ppidNum = Number(ppid);

        for (const session of Object.values(sessions)) {
            if (session.ppid === ppidNum && session.state === 'running') {
                return session;
            }
        }
        return null;
    }

    /**
     * List all sessions, optionally filtered
     *
     * @param {object} options
     * @param {boolean} options.activeOnly - Only return non-expired, running sessions
     * @param {boolean} options.notifyOnly - Only return sessions with notify=true
     * @returns {object[]}
     */
    listSessions(options = {}) {
        const sessions = this._loadSessions();
        const now = Date.now();

        let result = Object.values(sessions);

        if (options.activeOnly) {
            result = result.filter(s =>
                s.state === 'running' && s.expires_at > now
            );
        }

        if (options.notifyOnly) {
            result = result.filter(s => s.notify === true);
        }

        // Sort by last_seen descending
        result.sort((a, b) => (b.last_seen ?? 0) - (a.last_seen ?? 0));

        return result;
    }

    /**
     * Update session's last_seen timestamp (heartbeat)
     *
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async touchSession(sessionId) {
        return this._withSessionLock(() => {
            const sessions = this._loadSessions();
            if (sessions[sessionId]) {
                sessions[sessionId].last_seen = Date.now();
                sessions[sessionId].expires_at = Date.now() + DEFAULT_SESSION_TTL_MS;
                this._saveSessions(sessions);
            }
        });
    }

    /**
     * Enable notifications for a session
     *
     * @param {string} sessionId
     * @param {string} label - Human-friendly label
     * @param {object} transport - Optional transport update
     * @returns {Promise<object|null>} Updated session or null if not found
     */
    async enableNotify(sessionId, label, transport = {}) {
        return this._withSessionLock(() => {
            const sessions = this._loadSessions();
            const session = sessions[sessionId];

            if (!session) {
                return null;
            }

            session.notify = true;
            session.label = label || session.label;
            session.updated_at = Date.now();
            session.last_seen = Date.now();

            // Update transport if provided
            if (transport.nvim_socket) {
                session.transport = {
                    ...session.transport,
                    kind: 'nvim',
                    nvim_socket: transport.nvim_socket,
                };
            }

            this._saveSessions(sessions);

            this.logger.info?.(`Notifications enabled for session: ${sessionId} (${label})`) ||
                this.logger.log?.(`Notifications enabled for session: ${sessionId} (${label})`);

            return session;
        });
    }

    /**
     * Mark a session as stopped
     *
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async stopSession(sessionId) {
        return this._withSessionLock(() => {
            const sessions = this._loadSessions();
            if (sessions[sessionId]) {
                sessions[sessionId].state = 'stopped';
                sessions[sessionId].updated_at = Date.now();
                this._saveSessions(sessions);
            }
        });
    }

    /**
     * Delete a session
     *
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async deleteSession(sessionId) {
        await this._withSessionLock(() => {
            const sessions = this._loadSessions();
            if (sessions[sessionId]) {
                delete sessions[sessionId];
                this._saveSessions(sessions);
            }
        });

        // Also clean up any tokens for this session (outside session lock to avoid deadlock)
        await this._cleanupTokensForSession(sessionId);
    }

    /**
     * Clean up expired sessions
     *
     * @returns {Promise<number>} Number of sessions cleaned up
     */
    async cleanupExpiredSessions() {
        return this._withSessionLock(() => {
            const sessions = this._loadSessions();
            const now = Date.now();
            let count = 0;

            for (const [id, session] of Object.entries(sessions)) {
                if (session.expires_at && session.expires_at < now) {
                    delete sessions[id];
                    count++;
                }
            }

            if (count > 0) {
                this._saveSessions(sessions);
                this.logger.info?.(`Cleaned up ${count} expired sessions`) ||
                    this.logger.log?.(`Cleaned up ${count} expired sessions`);
            }

            return count;
        });
    }

    /**
     * Clean up dead sessions by validating PID + start_time
     * This catches sessions where the process has exited (faster than TTL expiry)
     *
     * @returns {Promise<number>} Number of sessions cleaned up
     */
    async cleanupDeadSessions() {
        // First, get a snapshot of sessions to check (short lock)
        const sessionsToCheck = await this._withSessionLock(() => {
            const sessions = this._loadSessions();
            const candidates = [];
            for (const [id, session] of Object.entries(sessions)) {
                // Only check sessions that have notify enabled (they're the ones that matter)
                if (!session.notify) continue;
                // Need at least ppid to validate
                if (!session.ppid) continue;
                candidates.push({ id, ppid: session.ppid, start_time: session.start_time, label: session.label });
            }
            return candidates;
        });

        // Check process liveness outside the lock (can be slow)
        const toDelete = [];
        for (const { id, ppid, start_time, label } of sessionsToCheck) {
            const isAlive = await this._isProcessAlive(ppid, start_time);
            if (!isAlive) {
                toDelete.push(id);
                this.logger.info?.(`Session ${id} (${label}) is dead (PID ${ppid} not running or start_time mismatch)`) ||
                    this.logger.log?.(`Session ${id} (${label}) is dead`);
            }
        }

        if (toDelete.length === 0) {
            return 0;
        }

        // Delete dead sessions (with lock)
        const count = await this._withSessionLock(() => {
            const sessions = this._loadSessions();
            let deleted = 0;
            for (const id of toDelete) {
                if (sessions[id]) {
                    delete sessions[id];
                    deleted++;
                }
            }
            if (deleted > 0) {
                this._saveSessions(sessions);
                this.logger.info?.(`Cleaned up ${deleted} dead sessions`) ||
                    this.logger.log?.(`Cleaned up ${deleted} dead sessions`);
            }
            return deleted;
        });

        // Clean up tokens for deleted sessions (outside session lock)
        for (const id of toDelete) {
            await this._cleanupTokensForSession(id);
        }

        return count;
    }

    /**
     * Check if a process is alive and (optionally) has the expected start time
     * @param {number} pid - Process ID
     * @param {number|undefined} expectedStartTime - Expected start time as epoch seconds (optional)
     * @returns {Promise<boolean>}
     */
    async _isProcessAlive(pid, expectedStartTime) {
        const { exec } = require('child_process');
        const { promisify } = require('util');
        const execAsync = promisify(exec);

        try {
            // Check if process exists and get its start time
            // macOS: ps -o lstart= returns "Tue 30 Dec 13:14:35 2025"
            const { stdout } = await execAsync(`ps -o lstart= -p ${pid} 2>/dev/null`);
            const lstart = stdout.trim();

            if (!lstart) {
                return false; // Process doesn't exist
            }

            // If no expected start time, just check existence
            if (!expectedStartTime) {
                return true; // Process exists, can't validate start time
            }

            // Parse the start time (macOS format)
            // Use date command to convert to epoch
            try {
                const { stdout: epochStr } = await execAsync(
                    `date -j -f "%a %d %b %H:%M:%S %Y" "${lstart}" "+%s" 2>/dev/null`
                );
                const actualStartTime = parseInt(epochStr.trim(), 10);

                // Allow 2 second tolerance for timing differences
                return Math.abs(actualStartTime - expectedStartTime) <= 2;
            } catch {
                // If we can't parse the date, assume process is alive
                // (better to send duplicate notification than miss one)
                return true;
            }
        } catch {
            // ps command failed - process doesn't exist
            return false;
        }
    }

    // =========================================================================
    // Token Management
    // =========================================================================

    /**
     * Mint a new token for a session
     *
     * @param {string} sessionId
     * @param {string|number} chatId - Telegram chat ID to bind token to
     * @param {object} options
     * @param {number} options.ttlMs - Token TTL in milliseconds
     * @param {string[]} options.scopes - Allowed actions
     * @param {object} options.context - Additional context (event type, summary)
     * @returns {Promise<string>} The minted token
     */
    async mintToken(sessionId, chatId, options = {}) {
        return this._withTokenLock(() => {
            const tokens = this._loadTokens();

            const token = crypto.randomBytes(16).toString('base64url');
            const now = Date.now();

            tokens[token] = {
                token,
                session_id: sessionId,
                chat_id: String(chatId),
                created_at: now,
                expires_at: now + (options.ttlMs ?? DEFAULT_TOKEN_TTL_MS),
                scopes: options.scopes ?? ['send_cmd'],
                context: options.context ?? {},
            };

            this._saveTokens(tokens);

            return token;
        });
    }

    /**
     * Validate a token
     *
     * @param {string} token
     * @param {string|number} chatId - Must match the token's bound chat_id
     * @returns {object} { valid: boolean, session_id?: string, scopes?: string[], error?: string }
     */
    validateToken(token, chatId) {
        const tokens = this._loadTokens();
        const record = tokens[token];

        if (!record) {
            return { valid: false, error: 'Token not found' };
        }

        if (record.expires_at < Date.now()) {
            return { valid: false, error: 'Token expired' };
        }

        if (record.chat_id !== String(chatId)) {
            return { valid: false, error: 'Chat ID mismatch' };
        }

        return {
            valid: true,
            session_id: record.session_id,
            scopes: record.scopes,
            context: record.context,
        };
    }

    /**
     * Revoke a token
     *
     * @param {string} token
     * @returns {Promise<void>}
     */
    async revokeToken(token) {
        return this._withTokenLock(() => {
            const tokens = this._loadTokens();
            if (tokens[token]) {
                delete tokens[token];
                this._saveTokens(tokens);
            }
        });
    }

    /**
     * Clean up expired tokens
     *
     * @returns {Promise<number>} Number of tokens cleaned up
     */
    async cleanupExpiredTokens() {
        return this._withTokenLock(() => {
            const tokens = this._loadTokens();
            const now = Date.now();
            let count = 0;

            for (const [token, record] of Object.entries(tokens)) {
                if (record.expires_at < now) {
                    delete tokens[token];
                    count++;
                }
            }

            if (count > 0) {
                this._saveTokens(tokens);
            }

            return count;
        });
    }

    /**
     * Clean up all tokens for a session
     * @param {string} sessionId
     * @returns {Promise<void>}
     */
    async _cleanupTokensForSession(sessionId) {
        return this._withTokenLock(() => {
            const tokens = this._loadTokens();
            let changed = false;

            for (const [token, record] of Object.entries(tokens)) {
                if (record.session_id === sessionId) {
                    delete tokens[token];
                    changed = true;
                }
            }

            if (changed) {
                this._saveTokens(tokens);
            }
        });
    }

    // =========================================================================
    // Storage Layer (JSON file with atomic writes)
    //
    // TODO: Replace these methods with SQLite for better concurrent access:
    //   - Use better-sqlite3 package
    //   - Create tables: sessions, tokens
    //   - Keep same public API, just change storage layer
    // =========================================================================

    _loadSessions() {
        try {
            if (fs.existsSync(this.sessionsFile)) {
                return JSON.parse(fs.readFileSync(this.sessionsFile, 'utf8'));
            }
        } catch (error) {
            this.logger.warn?.(`Failed to load sessions: ${error.message}`) ||
                this.logger.log?.(`Failed to load sessions: ${error.message}`);
        }
        return {};
    }

    _saveSessions(sessions) {
        this._atomicWrite(this.sessionsFile, sessions);
    }

    _loadTokens() {
        try {
            if (fs.existsSync(this.tokensFile)) {
                return JSON.parse(fs.readFileSync(this.tokensFile, 'utf8'));
            }
        } catch (error) {
            this.logger.warn?.(`Failed to load tokens: ${error.message}`) ||
                this.logger.log?.(`Failed to load tokens: ${error.message}`);
        }
        return {};
    }

    _saveTokens(tokens) {
        this._atomicWrite(this.tokensFile, tokens);
    }

    /**
     * Atomic write: write to temp file, then rename
     * This prevents corruption if the process crashes mid-write
     */
    _atomicWrite(filePath, data) {
        const tempPath = `${filePath}.tmp.${process.pid}`;
        try {
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
            fs.renameSync(tempPath, filePath);
        } catch (error) {
            // Clean up temp file on error
            try { fs.unlinkSync(tempPath); } catch {}
            throw error;
        }
    }
}

module.exports = SessionRegistry;

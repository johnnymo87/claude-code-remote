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

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

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

        this._ensureDataDir();
    }

    _ensureDataDir() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
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
     * @returns {object} The created/updated session
     */
    upsertSession(session) {
        if (!session.session_id) {
            throw new Error('session_id is required');
        }

        const sessions = this._loadSessions();
        const now = Date.now();

        const existing = sessions[session.session_id];

        const updated = {
            session_id: session.session_id,
            ppid: session.ppid ?? existing?.ppid,
            pid: session.pid ?? existing?.pid,
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
    }

    /**
     * Build transport object from session data
     *
     * Priority: nvim > tmux > pty
     * But if running nvim inside tmux, store both so we can fallback to tmux
     */
    _buildTransport(session, existing) {
        // If nvim_socket is provided, primary transport is nvim
        // But also store tmux_session as fallback if available
        if (session.nvim_socket) {
            return {
                kind: 'nvim',
                nvim_socket: session.nvim_socket,
                buffer: session.buffer ?? existing?.transport?.buffer,
                instance_name: session.instance_name ?? existing?.transport?.instance_name,
                // Store tmux as fallback if available
                tmux_session: session.tmux_session ?? existing?.transport?.tmux_session,
            };
        }

        // If tmux_session is provided, it's a tmux session
        if (session.tmux_session) {
            return {
                kind: 'tmux',
                session_name: session.tmux_session,
                pane: session.tmux_pane ?? existing?.transport?.pane,
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
     */
    touchSession(sessionId) {
        const sessions = this._loadSessions();
        if (sessions[sessionId]) {
            sessions[sessionId].last_seen = Date.now();
            sessions[sessionId].expires_at = Date.now() + DEFAULT_SESSION_TTL_MS;
            this._saveSessions(sessions);
        }
    }

    /**
     * Enable notifications for a session
     *
     * @param {string} sessionId
     * @param {string} label - Human-friendly label
     * @param {object} transport - Optional transport update
     * @returns {object|null} Updated session or null if not found
     */
    enableNotify(sessionId, label, transport = {}) {
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
    }

    /**
     * Mark a session as stopped
     *
     * @param {string} sessionId
     */
    stopSession(sessionId) {
        const sessions = this._loadSessions();
        if (sessions[sessionId]) {
            sessions[sessionId].state = 'stopped';
            sessions[sessionId].updated_at = Date.now();
            this._saveSessions(sessions);
        }
    }

    /**
     * Delete a session
     *
     * @param {string} sessionId
     */
    deleteSession(sessionId) {
        const sessions = this._loadSessions();
        if (sessions[sessionId]) {
            delete sessions[sessionId];
            this._saveSessions(sessions);

            // Also clean up any tokens for this session
            this._cleanupTokensForSession(sessionId);
        }
    }

    /**
     * Clean up expired sessions
     *
     * @returns {number} Number of sessions cleaned up
     */
    cleanupExpiredSessions() {
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
     * @returns {string} The minted token
     */
    mintToken(sessionId, chatId, options = {}) {
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
     */
    revokeToken(token) {
        const tokens = this._loadTokens();
        if (tokens[token]) {
            delete tokens[token];
            this._saveTokens(tokens);
        }
    }

    /**
     * Clean up expired tokens
     *
     * @returns {number} Number of tokens cleaned up
     */
    cleanupExpiredTokens() {
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
    }

    /**
     * Clean up all tokens for a session
     */
    _cleanupTokensForSession(sessionId) {
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

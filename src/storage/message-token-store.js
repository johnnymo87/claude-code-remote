/**
 * MessageTokenStore - SQLite-backed storage for message_id → token mapping
 *
 * Used for Telegram reply-to-message routing: when the bot sends a notification,
 * we store the message_id → token mapping. When a user replies to that message,
 * we look up the token to route the command.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class MessageTokenStore {
    /**
     * @param {Object} options
     * @param {string} [options.dbPath] - Path to SQLite database file (default: data/message-tokens.db)
     * @param {number} [options.ttlMs] - TTL in milliseconds (default: 24 hours)
     * @param {number} [options.cleanupIntervalMs] - Cleanup interval (default: 1 hour)
     * @param {Object} [options.logger] - Logger instance
     */
    constructor(options = {}) {
        const defaultDbPath = path.join(process.cwd(), 'data', 'message-tokens.db');
        this.dbPath = options.dbPath || defaultDbPath;
        this.ttlMs = options.ttlMs || 24 * 60 * 60 * 1000; // 24 hours
        this.cleanupIntervalMs = options.cleanupIntervalMs || 60 * 60 * 1000; // 1 hour
        this.logger = options.logger || console;

        this._ensureDirectory();
        this._initDatabase();
        this._startCleanupInterval();
    }

    /**
     * Ensure the data directory exists
     */
    _ensureDirectory() {
        const dir = path.dirname(this.dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        }
    }

    /**
     * Initialize the SQLite database and create tables
     */
    _initDatabase() {
        this.db = new Database(this.dbPath);

        // Enable WAL mode for better concurrent access
        this.db.pragma('journal_mode = WAL');

        // Create the table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS message_tokens (
                chat_id INTEGER NOT NULL,
                message_id INTEGER NOT NULL,
                token TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY (chat_id, message_id)
            )
        `);

        // Create index for cleanup queries
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_message_tokens_created_at
            ON message_tokens(created_at)
        `);

        // Prepare statements for performance
        this._stmtInsert = this.db.prepare(`
            INSERT OR REPLACE INTO message_tokens (chat_id, message_id, token, created_at)
            VALUES (?, ?, ?, ?)
        `);

        this._stmtLookup = this.db.prepare(`
            SELECT token, created_at FROM message_tokens
            WHERE chat_id = ? AND message_id = ?
        `);

        this._stmtDelete = this.db.prepare(`
            DELETE FROM message_tokens
            WHERE chat_id = ? AND message_id = ?
        `);

        this._stmtCleanup = this.db.prepare(`
            DELETE FROM message_tokens
            WHERE created_at < ?
        `);

        this._stmtCount = this.db.prepare(`
            SELECT COUNT(*) as count FROM message_tokens
        `);

        // Run cleanup on startup
        this._cleanup();

        this.logger.info?.(`MessageTokenStore initialized at ${this.dbPath}`) ||
            this.logger.log?.(`MessageTokenStore initialized at ${this.dbPath}`);
    }

    /**
     * Store a message_id → token mapping
     * @param {number} chatId - Telegram chat ID
     * @param {number} messageId - Telegram message ID
     * @param {string} token - The token to associate
     */
    store(chatId, messageId, token) {
        if (!messageId || messageId <= 0) {
            this.logger.warn?.('Skipping store: invalid message_id') ||
                this.logger.log?.('Skipping store: invalid message_id');
            return;
        }

        const createdAt = Date.now();
        this._stmtInsert.run(chatId, messageId, token, createdAt);

        this.logger.debug?.(`Stored mapping: ${chatId}:${messageId} → ${token.slice(0, 8)}...`) ||
            this.logger.log?.(`Stored mapping: ${chatId}:${messageId} → ${token.slice(0, 8)}...`);
    }

    /**
     * Look up a token by chat_id and message_id
     * @param {number} chatId - Telegram chat ID
     * @param {number} messageId - Telegram message ID
     * @returns {string|null} The token, or null if not found or expired
     */
    lookup(chatId, messageId) {
        const row = this._stmtLookup.get(chatId, messageId);

        if (!row) {
            return null;
        }

        // Check TTL
        const age = Date.now() - row.created_at;
        if (age > this.ttlMs) {
            // Expired - delete and return null
            this._stmtDelete.run(chatId, messageId);
            this.logger.debug?.(`Token expired for ${chatId}:${messageId}`) ||
                this.logger.log?.(`Token expired for ${chatId}:${messageId}`);
            return null;
        }

        return row.token;
    }

    /**
     * Delete a mapping (call after successful routing)
     * @param {number} chatId - Telegram chat ID
     * @param {number} messageId - Telegram message ID
     */
    delete(chatId, messageId) {
        this._stmtDelete.run(chatId, messageId);
    }

    /**
     * Get the number of stored mappings
     * @returns {number}
     */
    count() {
        return this._stmtCount.get().count;
    }

    /**
     * Clean up expired entries
     */
    _cleanup() {
        const cutoff = Date.now() - this.ttlMs;
        const result = this._stmtCleanup.run(cutoff);

        if (result.changes > 0) {
            this.logger.info?.(`Cleaned up ${result.changes} expired message token mappings`) ||
                this.logger.log?.(`Cleaned up ${result.changes} expired message token mappings`);
        }
    }

    /**
     * Start periodic cleanup
     */
    _startCleanupInterval() {
        this._cleanupInterval = setInterval(() => {
            this._cleanup();
        }, this.cleanupIntervalMs);

        // Don't prevent process exit
        this._cleanupInterval.unref();
    }

    /**
     * Close the database connection
     */
    close() {
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval);
        }
        if (this.db) {
            this.db.close();
        }
    }
}

module.exports = MessageTokenStore;

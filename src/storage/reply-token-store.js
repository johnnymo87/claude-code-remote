/**
 * ReplyTokenStore — maps (channelId, replyKey) -> token for reply-to routing.
 *
 * Generalized from MessageTokenStore. The replyKey is platform-specific:
 * - Telegram: message_id (number)
 * - Slack: ts (timestamp string)
 * - Discord: message_id (snowflake string)
 *
 * All stored as strings for uniformity.
 */
const Database = require('better-sqlite3');
const Logger = require('../core/logger');

class ReplyTokenStore {
  constructor({ dbPath, ttlMs = 24 * 60 * 60 * 1000, logger } = {}) {
    this.ttlMs = ttlMs;
    this.logger = logger || new Logger('ReplyTokenStore');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this._initSchema();
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reply_tokens (
        channel_id TEXT NOT NULL,
        reply_key TEXT NOT NULL,
        token TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
        PRIMARY KEY (channel_id, reply_key)
      )
    `);
    this._storeStmt = this.db.prepare(
      'INSERT OR REPLACE INTO reply_tokens (channel_id, reply_key, token, created_at) VALUES (?, ?, ?, ?)'
    );
    this._lookupStmt = this.db.prepare(
      'SELECT token, created_at FROM reply_tokens WHERE channel_id = ? AND reply_key = ?'
    );
    this._deleteStmt = this.db.prepare(
      'DELETE FROM reply_tokens WHERE channel_id = ? AND reply_key = ?'
    );
    this._cleanupStmt = this.db.prepare(
      'DELETE FROM reply_tokens WHERE created_at < ?'
    );
  }

  store(channelId, replyKey, token) {
    this._storeStmt.run(String(channelId), String(replyKey), token, Date.now());
  }

  lookup(channelId, replyKey) {
    const row = this._lookupStmt.get(String(channelId), String(replyKey));
    if (!row) return null;
    if (Date.now() - row.created_at > this.ttlMs) {
      this.delete(channelId, replyKey);
      return null;
    }
    return row.token;
  }

  delete(channelId, replyKey) {
    this._deleteStmt.run(String(channelId), String(replyKey));
  }

  cleanup() {
    const cutoff = Date.now() - this.ttlMs;
    return this._cleanupStmt.run(cutoff).changes;
  }

  close() {
    this.db.close();
  }
}

module.exports = { ReplyTokenStore };

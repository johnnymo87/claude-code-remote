# Plan: SQLite Storage Consolidation

> **For a planner:** This document provides enough context to design a detailed implementation plan. Deepen each section, resolve open questions, then hand off for execution.

**Priority:** Medium
**Dependencies:** None (can be done before or after the OpenCode plugin)
**Related plans:** Plan 3 (handler decomposition) is easier after this; Plan 6 (borrowed patterns — session key derivation) fits naturally here

---

## Context

### The Problem: Three Storage Backends

The CCR daemon currently uses **three different storage approaches** for closely related data:

1. **JSON files with async-mutex** — Session registry (`data/claude-sessions.json`) and token store (`data/claude-tokens.json`). Load entire file → parse → modify → serialize → atomic write (tmp + rename). Protected by `async-mutex` for thread safety.

2. **SQLite (better-sqlite3)** — MachineAgent's durable inbox for command delivery. `INSERT OR IGNORE` for dedup, proper transactions, FIFO ordering.

3. **SQLite (Cloudflare D1)** — Worker's Durable Object storage for sessions, messages, command queue, and dedup table.

The daemon's JSON approach works for single-user scale (~5-10 sessions) but has known issues:
- **O(n) for all operations**: Every read/write loads and saves the entire file
- **No indexing**: Lookups by session_id, ppid, or transport type scan the full array
- **Race conditions**: The async-mutex only protects within a single process — if two hooks fire simultaneously and both POST to the daemon before the first write completes, data could be lost (though atomic rename prevents corruption)
- **Inconsistency**: The inbox (SQLite) and sessions (JSON) use different patterns for the same daemon, making the code harder to reason about

The session registry code already has a `// TODO: migrate to SQLite` comment, and the API is designed to make this straightforward (all access goes through `SessionRegistry` class methods).

### Current Session Data Model

```javascript
// claude-sessions.json structure
{
  "sessions": {
    "<session_id>": {
      "session_id": "...",
      "ppid": 12345,
      "pid": 12346,
      "start_time": 1770600000,
      "cwd": "/home/dev/projects/foo",
      "label": "foo",
      "notify": true,
      "transport": {
        "kind": "nvim",  // or "tmux", "pty", "unknown"
        "details": {
          "nvim_socket": "/tmp/nvimXXXXXX/0",
          "instance_name": "/dev/pts/12",
          "tmux_session": "main",
          "tmux_pane": "%5"
        }
      },
      "state": "active",
      "created_at": "...",
      "updated_at": "...",
      "expires_at": "..."
    }
  }
}

// claude-tokens.json structure
{
  "<token>": {
    "session_id": "...",
    "chat_id": 123456,
    "created_at": "...",
    "expires_at": "..."
  }
}
```

### Current Access Patterns

**SessionRegistry** (`src/registry/session-registry.js`):
- `register(sessionData)` — Add/update a session
- `get(sessionId)` — Lookup by ID
- `getByPpid(ppid)` — Lookup by parent PID
- `getNotifySessions()` — All sessions with `notify: true`
- `update(sessionId, fields)` — Partial update
- `remove(sessionId)` — Delete
- `cleanupDeadSessions()` — Every 60s, check process liveness, remove dead ones
- `_isProcessAlive(ppid, startTime)` — `/proc` on Linux, `ps` on macOS

**Token operations** (currently in `TelegramWebhookHandler`):
- `storeToken(token, sessionId, chatId)` — Save with 24h TTL
- `getSessionByToken(token)` — Lookup
- `cleanupExpiredTokens()` — Remove expired

### What the Architecture Review Found

- **OpenClaw** uses JSONL files per agent per session — different approach, not relevant
- **Open-Dispatch** uses in-memory Maps — worse than CCR's approach
- **OpenCode** uses JSON files — similar to current CCR
- The daemon's own `MachineAgent` already uses SQLite with proper transactions and dedup — proving the pattern works in this codebase
- The architecture review recommended consolidation to "one database, one concurrency model"

---

## Proposed Approach

### Single SQLite Database

Replace both JSON files with a single SQLite database at `data/ccr.db` (or `data/claude-remote.db`). Use `better-sqlite3` which is already a dependency (used by MachineAgent).

### Schema

```sql
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  ppid INTEGER,
  pid INTEGER,
  start_time INTEGER,
  cwd TEXT,
  label TEXT,
  notify INTEGER DEFAULT 0,
  transport_kind TEXT,  -- 'nvim', 'tmux', 'pty', 'unknown'
  transport_details TEXT,  -- JSON blob for nvim_socket, instance_name, tmux_*, etc.
  state TEXT DEFAULT 'active',
  created_at TEXT,
  updated_at TEXT,
  expires_at TEXT
);

CREATE INDEX idx_sessions_ppid ON sessions(ppid);
CREATE INDEX idx_sessions_notify ON sessions(notify) WHERE notify = 1;
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE tokens (
  token TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE,
  chat_id INTEGER,
  created_at TEXT,
  expires_at TEXT
);

CREATE INDEX idx_tokens_session ON tokens(session_id);
CREATE INDEX idx_tokens_expires ON tokens(expires_at);
```

### Migration Strategy

1. **New `SqliteSessionRegistry`** class implementing the same interface as current `SessionRegistry`
2. **Data migration**: On first startup, if `claude-sessions.json` exists and `ccr.db` doesn't, import existing data
3. **Drop-in replacement**: The rest of the daemon (EventRoutes, TelegramWebhookHandler) calls the same methods — only the storage layer changes
4. **Remove async-mutex dependency** for session access (SQLite handles concurrency natively)

### Benefits

- **Atomic operations**: `register()` becomes a single `INSERT OR REPLACE`
- **Indexed lookups**: `getByPpid()` goes from O(n) scan to indexed lookup
- **Concurrent safety**: SQLite's WAL mode handles concurrent reads/writes without mutex
- **Cleanup is a query**: `DELETE FROM sessions WHERE expires_at < datetime('now')`
- **Consistency**: Same storage backend as MachineAgent's inbox
- **Transaction support**: Can atomically update session + create token in one transaction

---

## Key Files to Modify

| File | Change |
|------|--------|
| `src/registry/session-registry.js` | Rewrite internals from JSON to SQLite, keep public API |
| `src/registry/session-registry.test.js` | Update tests for SQLite (may need temp DB per test) |
| `src/telegram/telegram-webhook-handler.js` | Extract token operations to use new `tokens` table |
| `src/server.js` or `start-server.js` | Initialize SQLite DB, run migrations |
| `package.json` | Remove `async-mutex` dependency (if no longer needed elsewhere) |

---

## Open Questions for the Planner

1. **Database location**: `data/ccr.db` alongside current JSON files? Or a different path?

2. **MachineAgent consolidation**: Should MachineAgent's inbox table move into the same `ccr.db`? Or keep it separate? Consolidating means one DB file, one connection pool. Keeping separate means independent lifecycle.

3. **Migration rollback**: If the SQLite migration has issues, should there be a fallback to JSON? Or is this a one-way migration?

4. **WAL mode**: Should we use WAL mode for better concurrent read performance? It's generally recommended for server workloads.

5. **Transport details**: Store as JSON blob in a TEXT column, or normalize into separate columns? JSON blob is simpler and matches the current flexible structure. Separate columns enable SQL queries on transport fields.

6. **Cleanup interval**: Currently 60s for process-alive checks. With SQLite, could combine cleanup of expired sessions and tokens into a single periodic query. Worth changing the interval?

> **Note (2026-02-10):** The `opencode-pigeon` plugin (see completed plan `2026-02-09-opencode-plugin.md`) now handles OpenCode session cleanup in-process — it sends `session.deleted` and `session.error` events which the daemon receives via `POST /stop`. This means `cleanupDeadSessions()` process-alive polling is **no longer needed for OpenCode sessions**. However, it is **still required for Claude Code sessions**, which use shell hooks and have no lifecycle events for cleanup. The polling should remain until CC hooks are fully retired.

---

## Success Criteria

- [ ] SessionRegistry uses SQLite instead of JSON files
- [ ] Token store uses SQLite instead of JSON files
- [ ] Data migration from existing JSON files on first startup
- [ ] All existing tests pass (adapted for SQLite)
- [ ] async-mutex removed from session/token access paths
- [ ] Concurrent access works correctly (multiple hooks firing simultaneously)
- [ ] cleanupDeadSessions() works with SQLite storage
- [ ] No behavioral changes visible to the rest of the daemon

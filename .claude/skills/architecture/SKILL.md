---
name: architecture
description: Use when you need to understand how Claude Code Remote works, the notification flow, or the project structure
---

# Architecture

## Overview

Claude Code Remote is a notification relay system that bridges Claude Code sessions with external messaging platforms. It supports two modes:

1. **Worker Routing** (recommended for multi-machine): Cloudflare Worker handles webhooks and routes commands to correct machine
2. **Direct Mode** (single machine): Webhooks received directly via tunnel

## Multi-Machine Architecture (Worker Routing)

```
┌─────────────────┐     ┌─────────────────┐
│ macOS (work)    │     │ devbox (side)   │
│                 │     │                 │
│ Claude sessions │     │ Claude sessions │
│ CCR webhook srv │     │ CCR webhook srv │
│ Machine Agent ──┼─────┼── Machine Agent │
│   (WebSocket)   │     │   (WebSocket)   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │  outbound WebSocket   │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │ Cloudflare Worker     │
         │ + Durable Object      │
         │                       │
         │ - Session registry    │
         │ - Message→Session map │
         │ - Command routing     │
         │ - WebSocket hub       │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │ Telegram Bot API      │
         │ (webhook endpoint)    │
         └───────────────────────┘
```

**Key Components:**
- **Machine Agent**: Maintains WebSocket connection to Worker, receives commands
- **Worker**: Routes Telegram webhooks to correct machine based on session registry
- **Session Registry**: Maps session IDs to machine IDs (stored in Durable Objects SQLite)

## Single-Machine Architecture (Direct Mode)

```
┌─────────────────────┐         ┌──────────────────────────┐
│ You (anywhere)      │         │ Claude Code (tmux/PTY)   │
│                     │         │                          │
│ Phone/Laptop/Email  │◀───────▶│ Hooks trigger on Stop    │
│                     │         │ Notifications sent out   │
│ Reply = new command │────────▶│ Command injected         │
└─────────────────────┘         └──────────────────────────┘
```

Requires tunnel (Cloudflare Tunnel, ngrok) exposing port 4731.

## Notification Flow

### With Worker Routing (Multi-Machine)

1. **Claude completes task** → Stop hook fires → `on-stop.sh` POSTs to daemon
2. **CCR formats notification** → `TelegramProvider.formatNotification()` builds styled text + inline keyboard
3. **Sent via Worker** → MachineAgent sends formatted message to Worker's `/notifications/send`
4. **Worker sends to Telegram** → Stores message_id → session mapping
5. **You reply** → Telegram webhook hits Worker
6. **Worker routes command** → Pushes to correct machine via WebSocket
7. **Machine agent receives** → Injects into Claude session via tmux send-keys

### Direct Mode (Single Machine)

1. **Claude completes task** → Stop hook fires
2. **Notifications sent** → Direct to Telegram API
3. **You reply** → Webhook received at CCR
4. **Command injected** → Into active Claude session

## Internal Architecture

The server uses a two-axis abstraction to decouple platform from agent:

```
ChatProvider (messaging platform)     AgentBackend (agent interaction)
  ├── TelegramProvider                  └── ClaudeCodeBackend (nvim/tmux)
  └── (future: Slack, Discord)
                    │                              │
                    └──────── CommandRouter ────────┘
                              (orchestrator)
```

- **ChatProvider** (`src/providers/chat-provider.js`): Abstract interface for sending notifications, receiving commands. Platform-specific subclasses handle API details.
- **AgentBackend** (`src/backends/agent-backend.js`): Abstract interface for injecting commands into agent sessions. `ClaudeCodeBackend` wraps the tmux/nvim injector.
- **CommandRouter** (`src/core/command-router.js`): Bridges provider and backend. Handles outbound (stop event → notification) and inbound (reply → command injection) flows.
- **ReplyTokenStore** (`src/storage/reply-token-store.js`): Maps `(channelId, replyKey)` → session token for reply-to routing.

## Injection Modes

Managed by `ClaudeCodeBackend`, which wraps the injector:

**nvim RPC** (preferred when in nvim terminal):
- Auto-registers terminal buffers by PTY device path on TermOpen (ccremote.lua)
- Session-start hook sends TTY path; daemon sets instance_name to match
- Injects via chansend(job_id) to target the correct terminal buffer without focusing
- PTY keying survives subshells, wrappers, and environment tools (nix shell, devbox shell)
- Falls back to tmux if nvim socket unavailable
- Manual `:CCRegister <name>` still works as override

**tmux Mode**:
- Injects via tmux send-keys
- Works with remote/persistent sessions
- Uses pane ID for stable targeting

## OpenCode Plugin Integration

For [OpenCode](https://opencode.ai) sessions, the [opencode-pigeon](https://github.com/johnnymo87/opencode-pigeon) plugin replaces shell hooks as the session lifecycle manager. The plugin runs inside OpenCode's process and communicates with this daemon via HTTP.

**Plugin → Daemon flow**:
- `POST /session-start`: Plugin registers session with env info (TTY, nvim socket, tmux pane)
- `POST /stop`: Plugin sends markdown-stripped summary when session goes idle

**Key difference from shell hooks**: The plugin detects TTY via `/proc` readlink (not shell `readlink` command), captures assistant content in real-time (not from conversation file), and handles session lifecycle events natively (no hook scripts).

**TTY → instance_name mapping**: Plugin sends `tty: "/dev/pts/N"` → daemon stores as `transport.instance_name` → used by NvimInjector to target the correct ccremote terminal buffer.

The plugin source lives in `~/projects/opencode-pigeon/`. See its `.claude/skills/architecture/SKILL.md` for plugin-side details.

## Project Structure

```
├── start-server.js               # Main entry point (wires all components)
│
├── src/
│   ├── providers/                # Chat platform adapters
│   │   ├── chat-provider.js      # Abstract ChatProvider interface
│   │   └── telegram-provider.js  # Telegram implementation
│   │
│   ├── backends/                 # Agent interaction adapters
│   │   ├── agent-backend.js      # Abstract AgentBackend interface
│   │   └── claude-code-backend.js # nvim/tmux injection wrapper
│   │
│   ├── core/                     # Core logic
│   │   ├── command-router.js     # Orchestrator (provider ↔ backend)
│   │   └── logger.js             # Pino-based logger
│   │
│   ├── storage/                  # Data persistence
│   │   └── reply-token-store.js  # SQLite (channelId,replyKey)→token
│   │
│   ├── registry/                 # Session management
│   │   └── session-registry.js   # Active session tracking
│   │
│   ├── routes/                   # HTTP endpoints
│   │   └── events.js             # Claude hook events
│   │
│   ├── worker-client/            # Cloudflare Worker integration
│   │   └── machine-agent.js      # WebSocket client for Worker
│   │
│   └── channels/telegram/        # Legacy (kept for fallback)
│       ├── webhook.js            # Old monolithic webhook handler
│       └── injector.js           # Raw tmux/nvim injection
│
├── test/                         # Vitest test suite
│   ├── providers/                # ChatProvider + Telegram tests
│   ├── backends/                 # ClaudeCodeBackend tests
│   ├── core/                     # CommandRouter tests
│   └── storage/                  # ReplyTokenStore tests
│
└── .claude/                      # Claude Code integration
    ├── commands/                 # Slash commands
    └── skills/                   # Detailed guides
```

## Key Files

| File | Purpose |
|------|---------|
| `start-server.js` | Main entry point, wires ChatProvider + AgentBackend + CommandRouter |
| `src/providers/telegram-provider.js` | Telegram notifications, webhooks, draft streaming |
| `src/core/command-router.js` | Orchestrates notification → reply → injection flow |
| `src/backends/claude-code-backend.js` | nvim-first with tmux fallback injection |
| `src/worker-client/machine-agent.js` | WebSocket client for Worker routing |
| `src/routes/events.js` | HTTP endpoints for Claude hooks |

## Environment Variables

### Worker Routing (Multi-Machine)

```bash
# Cloudflare Worker URL
CCR_WORKER_URL=https://ccr-router.your-account.workers.dev

# Unique machine identifier
CCR_MACHINE_ID=devbox  # or 'macbook'
```

### Direct Mode (Single Machine)

```bash
# Tunnel public hostname (omit for Worker routing)
WEBHOOK_DOMAIN=ccr.yourdomain.com
```

## Session Tokens

- Base64url tokens (22 characters)
- Map notification message → Claude session
- Stored in SQLite via `ReplyTokenStore` (`src/storage/reply-token-store.js`)
- Expire after 24 hours (TTL checked at lookup time)
- Enable reply-to-command functionality

## Development

```bash
# Activate devenv
direnv allow
node --version  # Should show v22.x

# Start webhook server (connects to Worker if CCR_WORKER_URL set)
npm run webhooks:log

# Check Worker connection in logs:
# [MachineAgent] [INFO] Connected to Worker as devbox
```

## Design Decisions & Known Limitations

### Documented from ChatGPT Code Review (2026-01-23)

**Issue 6: API key in WebSocket subprotocol**
- We send the API key via `Sec-WebSocket-Protocol` header instead of `Authorization`
- Reason: Cloudflare Workers don't forward arbitrary headers on WebSocket upgrade
- The subprotocol approach is a known workaround for this platform limitation
- Risk: Could leak to logs depending on platform tooling (Cloudflare doesn't log it)

**Issue 7: Rate limiting**
- We have queue caps (100 commands/machine) and command size limits (10KB)
- We do NOT have per-minute rate limiting for webhooks or API calls
- If webhook secret leaks, system could be hammered with large updates
- Consider adding SQLite-based counters if this becomes a problem

**Issue 9: WebSocket ArrayBuffer handling**
- Already fixed: we check `typeof message === 'string' ? message.length : message.byteLength`
- Cloudflare may send binary messages, which we now handle

**Issue 10: Webhook I/O before responding**
- We do Telegram API calls before returning 200 OK to webhook
- This increases latency and can cause Telegram to retry
- We handle duplicates via `seen_updates` table, so this is acceptable
- Tradeoff: Simpler code vs. using waitUntil for async sends

### Command Delivery Guarantees

**At-least-once delivery** (DO side):
- Commands persisted to `command_queue` before any send attempt
- Retry sweep runs hourly for unacked `sent` commands
- Commands cleaned up after 24h if never acked (dead letter)

**Exactly-once execution** (Agent side):
- Commands persisted to local SQLite inbox before ack
- Ack sent only after durable write
- Duplicates detected via `INSERT OR IGNORE`
- Commands replayed on restart if not marked done

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

1. **Claude completes task** → Stop hook fires
2. **CCR sends notification** → Via Worker's `/notifications/send` endpoint
3. **Worker sends to Telegram** → Stores message_id → session mapping
4. **You reply** → Telegram webhook hits Worker
5. **Worker routes command** → Pushes to correct machine via WebSocket
6. **Machine agent receives** → Injects into local Claude session

### Direct Mode (Single Machine)

1. **Claude completes task** → Stop hook fires
2. **Notifications sent** → Direct to Telegram API
3. **You reply** → Webhook received at CCR
4. **Command injected** → Into active Claude session

## Injection Modes

**nvim RPC** (preferred when in nvim terminal):
- Injects via Neovim's RPC socket
- Cleanest integration for nvim users
- Falls back to tmux if socket unavailable

**tmux Mode**:
- Injects via tmux send-keys
- Works with remote/persistent sessions
- Uses pane ID for stable targeting

**PTY Mode** (legacy):
- Direct injection via pseudo-terminal
- No tmux required

## Project Structure

```
├── claude-hook-notify.js      # Hook script (called by Claude)
├── start-all-webhooks.js      # Multi-channel webhook server
├── start-telegram-webhook.js  # Telegram webhook + machine agent
│
├── src/
│   ├── worker-client/         # Cloudflare Worker integration
│   │   └── machine-agent.js   # WebSocket client for Worker
│   │
│   ├── channels/              # Notification handlers
│   │   ├── telegram/          # Telegram bot integration
│   │   │   └── webhook.js     # Webhook handler + Worker routing
│   │   ├── email/             # SMTP/IMAP handling
│   │   ├── line/              # LINE Messaging API
│   │   └── desktop/           # System notifications
│   │
│   ├── relay/                 # Command injection
│   │   └── injector-registry.js  # nvim/tmux injection
│   │
│   ├── registry/              # Session management
│   │   └── session-registry.js
│   │
│   ├── routes/                # HTTP endpoints
│   │   └── events.js          # Claude hook events
│   │
│   ├── storage/               # Data persistence
│   │   └── message-token-store.js  # SQLite token storage
│   │
│   └── core/                  # Core utilities
│       └── logger.js
│
└── .claude/                   # Claude Code integration
    ├── commands/              # Slash commands
    └── skills/                # Detailed guides
```

## Key Files

| File | Purpose |
|------|---------|
| `start-telegram-webhook.js` | Main entry point, initializes machine agent |
| `src/worker-client/machine-agent.js` | WebSocket client for Worker routing |
| `src/channels/telegram/webhook.js` | Telegram webhook handling, Worker integration |
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
- Stored in SQLite (`src/data/message-tokens.db`)
- Expire after 24 hours
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

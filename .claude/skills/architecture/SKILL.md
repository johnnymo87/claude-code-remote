---
name: architecture
description: Use when you need to understand how Claude Code Remote works, the notification flow, or the project structure
---

# Architecture

## Overview

Claude Code Remote is a notification relay system that bridges Claude Code sessions with external messaging platforms.

## How It Works

```
┌─────────────────────┐         ┌──────────────────────────┐
│ You (anywhere)      │         │ Claude Code (tmux/PTY)   │
│                     │         │                          │
│ Phone/Laptop/Email  │◀───────▶│ Hooks trigger on Stop    │
│                     │         │ Notifications sent out   │
│ Reply = new command │────────▶│ Command injected         │
└─────────────────────┘         └──────────────────────────┘
```

## Notification Flow

1. **Claude completes task** → Stop hook fires
2. **Hook script runs** → `claude-hook-notify.js completed`
3. **Notifications sent** → Telegram, Email, LINE, Desktop (based on `.env`)
4. **You reply** → Via Telegram bot, email reply, or LINE message
5. **Webhook receives** → `start-all-webhooks.js` handles incoming
6. **Command injected** → Into active Claude session (PTY or tmux mode)

## Injection Modes

**PTY Mode** (default, `INJECTION_MODE=pty`):
- Direct injection via pseudo-terminal
- No tmux required
- Works with local Claude sessions

**tmux Mode** (`INJECTION_MODE=tmux`):
- Injects into tmux session
- Requires active tmux session with Claude running
- Better for remote/persistent sessions

## Project Structure

```
├── claude-remote.js           # Main CLI daemon
├── claude-hook-notify.js      # Hook script (called by Claude)
├── start-all-webhooks.js      # Multi-channel webhook server
├── start-telegram-webhook.js  # Telegram-only webhook
├── start-line-webhook.js      # LINE-only webhook
│
├── src/
│   ├── channels/              # Notification handlers
│   │   ├── telegram/          # Telegram bot integration
│   │   ├── email/             # SMTP/IMAP handling
│   │   ├── line/              # LINE Messaging API
│   │   └── desktop/           # System notifications
│   │
│   ├── relay/                 # Command injection
│   │   ├── pty-relay.js       # PTY mode injection
│   │   └── tmux-relay.js      # tmux mode injection
│   │
│   ├── registry/              # Session management
│   │   └── session-registry.js
│   │
│   ├── storage/               # Data persistence
│   │   └── message-tokens.js  # SQLite token storage
│   │
│   ├── core/                  # Core utilities
│   │   ├── config.js          # Configuration loading
│   │   └── logger.js          # Pino logging
│   │
│   └── utils/                 # Helpers
│       ├── conversation-tracker.js
│       └── tmux-utils.js
│
├── config/                    # Channel configuration
│   ├── default.json
│   └── channels.json
│
└── .claude/                   # Claude Code integration
    ├── commands/              # Slash commands
    └── skills/                # Detailed guides
```

## Key Files

| File | Purpose |
|------|---------|
| `claude-hook-notify.js` | Called by Claude hooks, sends notifications |
| `start-all-webhooks.js` | Receives replies, injects commands |
| `claude-remote.js` | CLI for daemon management |
| `setup.js` | Interactive configuration wizard |

## Data Flow

```
Claude Session
    │
    ▼ (Stop hook)
claude-hook-notify.js
    │
    ├──▶ Telegram API
    ├──▶ SMTP Server
    ├──▶ LINE API
    └──▶ Desktop Notification

User Reply
    │
    ▼ (Webhook)
start-all-webhooks.js
    │
    ▼ (Injection)
relay/pty-relay.js or relay/tmux-relay.js
    │
    ▼
Claude Session
```

## Session Tokens

- 8-character alphanumeric tokens
- Map message → Claude session
- Stored in SQLite (`src/data/message-tokens.db`)
- Expire after 24 hours
- Enable reply-to-command functionality

## Development

```bash
# Activate devenv
direnv allow
node --version  # Should show v22.x

# Start ngrok tunnel (for receiving Telegram/LINE replies)
source .env && ngrok http 4731 --url=$NGROK_DOMAIN

# Start individual services (in another terminal)
npm run telegram      # Telegram webhook only
npm run line          # LINE webhook only
npm run daemon:start  # Email daemon only
npm run webhooks      # All enabled webhooks
npm run webhooks:log  # All webhooks + log to ~/.local/state/claude-code-remote/daemon.log

# Test notifications
node claude-hook-notify.js completed
```

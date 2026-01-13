# CLAUDE.md - Claude Code Remote

Control Claude Code remotely via Telegram, Email, LINE, or Desktop notifications. Start tasks, receive completion alerts, reply to send new commands.

## Table of Contents

- [Quick Start](#quick-start)
- [Commands](#commands)
- [Skills](#skills)
- [Architecture](#architecture)

## Quick Start

```bash
# Install dependencies
npm install

# Interactive setup (creates .env, configures hooks)
npm run setup

# Start all enabled notification channels
npm run webhooks
```

> **Note:** Run `npm run setup` first - it guides you through Email/Telegram/LINE configuration and sets up Claude hooks in `~/.claude/settings.json`.

## Commands

Slash commands for common workflows (in `.claude/commands/`):

| Command | Description |
|---------|-------------|
| `/test-notify` | Test all enabled notification channels |

## Skills

Detailed guidance for specific topics (in `.claude/skills/`):

| Skill | When to use |
|-------|-------------|
| `configuring-notifications` | Setting up Email, Telegram, or LINE channels |
| `troubleshooting` | Notifications not working, commands not executing |

## Architecture

```
┌─────────────────────┐         ┌──────────────────────────┐
│ You (anywhere)      │         │ Claude Code (tmux/PTY)   │
│                     │         │                          │
│ Phone/Laptop/Email  │◀───────▶│ Hooks trigger on Stop    │
│                     │         │ Notifications sent out   │
│ Reply = new command │────────▶│ Command injected         │
└─────────────────────┘         └──────────────────────────┘
```

**Notification flow:**
1. Claude completes a task → Stop hook fires
2. `claude-hook-notify.js` sends to enabled channels (Telegram/Email/LINE/Desktop)
3. You reply with a command
4. Webhook receives reply, injects command into Claude session

## Project Structure

```
├── claude-remote.js           # Main CLI daemon
├── claude-hook-notify.js      # Hook script for notifications
├── start-all-webhooks.js      # Multi-channel webhook server
├── src/
│   ├── channels/              # Telegram, Email, LINE, Desktop handlers
│   ├── relay/                 # Command injection (PTY/tmux)
│   ├── registry/              # Session management
│   └── storage/               # SQLite token storage
├── config/                    # Channel configuration
├── .claude/
│   ├── commands/              # Slash commands
│   └── skills/                # Detailed guides
└── devenv.nix                 # Development environment
```

## Development

```bash
# Ensure devenv is active (direnv allow)
node --version  # Should show v22.x

# Run tests
npm test

# Start individual services
npm run telegram      # Telegram webhook only
npm run line          # LINE webhook only
npm run daemon:start  # Email daemon only
```

## Related

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [LINE Messaging API](https://developers.line.biz/en/docs/messaging-api/)
- [Claude Code Hooks](https://docs.anthropic.com/en/docs/claude-code/hooks)

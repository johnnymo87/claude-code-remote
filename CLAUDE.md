# Claude Code Remote

Control Claude Code remotely via Telegram, Email, LINE, or Desktop notifications.

## Quick Start

```bash
npm install
npm run setup        # Configure channels, set up hooks
npm run webhooks:log # Start services
```

**For Telegram replies**, choose one:
- **Multi-machine**: Configure `CCR_WORKER_URL` and `CCR_MACHINE_ID` (see configuring-notifications skill)
- **Single-machine**: Expose port 4731 via tunnel, set `WEBHOOK_DOMAIN`

## How It Works

1. Claude completes a task → Stop hook fires
2. Notification sent to your phone/email
3. You reply with a command
4. Command injected into Claude session

For multi-machine setups, a Cloudflare Worker routes replies to the correct machine.

## Documentation

| Skill | Description |
|-------|-------------|
| [architecture](.claude/skills/architecture/SKILL.md) | System design, notification flow, project structure |
| [configuring-notifications](.claude/skills/configuring-notifications/SKILL.md) | Setting up Telegram, Email, LINE (Worker vs Direct mode) |
| [troubleshooting](.claude/skills/troubleshooting/SKILL.md) | Worker issues, notifications not sending, commands failing |

## Commands

| Command | Description |
|---------|-------------|
| [/test-notify](.claude/commands/test-notify.md) | Test all enabled notification channels |

## Key Environment Variables

```bash
# Telegram (required for Telegram channel)
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id

# Worker routing (multi-machine)
CCR_WORKER_URL=https://ccr-router.your-account.workers.dev
CCR_MACHINE_ID=devbox

# Direct mode (single-machine, alternative to Worker)
WEBHOOK_DOMAIN=ccr.yourdomain.com
```

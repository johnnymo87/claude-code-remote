# Claude Code Remote

Control Claude Code remotely via Telegram notifications.

## Quick Start

```bash
devenv shell         # Enter dev environment (auto-configures 1Password)
npm install
npm run setup        # Configure hooks
```

**Start webhook server:**
```bash
op run --env-file=.env.1password -- npm run webhooks:log
```

**For reply commands**, choose one:
- **Multi-machine**: Configure `CCR_WORKER_URL` and `CCR_MACHINE_ID` (see configuring-notifications skill)
- **Single-machine**: Expose port 4731 via tunnel, set `WEBHOOK_DOMAIN`

## How It Works

1. Claude completes a task → Stop hook fires
2. Notification with full assistant message sent to Telegram via ChatProvider
3. You reply with a command (swipe-reply or inline button)
4. CommandRouter injects command into Claude session via AgentBackend (tmux send-keys)

For multi-machine setups, a Cloudflare Worker routes replies to the correct machine.

## Development

```bash
npm test             # Run vitest test suite (36 tests)
npm run test:watch   # Watch mode
```

## Documentation

| Skill | Description |
|-------|-------------|
| [architecture](.claude/skills/architecture/SKILL.md) | System design, notification flow, project structure |
| [configuring-notifications](.claude/skills/configuring-notifications/SKILL.md) | Setting up Telegram (Worker vs Direct mode) |
| [machine-setup](.claude/skills/machine-setup/SKILL.md) | Adding a new machine to the CCR network |
| [operations](.claude/skills/operations/SKILL.md) | Logs, restarts, health checks, secret rotation |
| [security](.claude/skills/security/SKILL.md) | Secret management architecture, token flow |
| [hooks](.claude/skills/hooks/SKILL.md) | Claude Code hooks (SessionStart, Stop) |
| [troubleshooting](.claude/skills/troubleshooting/SKILL.md) | Debugging common issues |

## Commands

| Command | Description |
|---------|-------------|
| [/test-notify](.claude/commands/test-notify.md) | Test Telegram notifications |

## Secrets Management

Secrets are managed via **1Password** with a service account for headless access:

```
1Password (Automation vault)
  └── ccr-secrets item
       ├── CCR_API_KEY
       ├── TELEGRAM_BOT_TOKEN
       ├── TELEGRAM_WEBHOOK_SECRET
       └── TELEGRAM_WEBHOOK_PATH_SECRET

sops-nix (bootstrap only)
  └── OP_SERVICE_ACCOUNT_TOKEN
```

- **Devbox**: Token from sops-nix, secrets from 1Password via `op run`
- **macOS**: 1Password desktop app or service account
- **Worker**: Cloudflare secrets (`wrangler secret put`)

See `.env.1password` for secret references and `security` skill for architecture.

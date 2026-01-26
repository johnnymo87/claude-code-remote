# Claude Code Remote

Control Claude Code remotely via Telegram notifications.

## Quick Start

```bash
devenv shell         # Enter dev environment
npm install
npm run setup        # Configure hooks
```

**Start webhook server:**
```bash
# Devbox - secrets auto-loaded from sops-nix on shell entry
npm run webhooks:log

# macOS - secretspec injects from Keychain
secretspec run -- npm run webhooks:log
```

**For reply commands**, choose one:
- **Multi-machine**: Configure `CCR_WORKER_URL` and `CCR_MACHINE_ID` (see configuring-notifications skill)
- **Single-machine**: Expose port 4731 via tunnel, set `WEBHOOK_DOMAIN`

## How It Works

1. Claude completes a task → Stop hook fires
2. Notification sent to Telegram
3. You reply with a command
4. Command injected into Claude session

For multi-machine setups, a Cloudflare Worker routes replies to the correct machine.

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

Secrets are managed via **SecretSpec** with platform-native storage:

- **Devbox**: sops-nix (`/run/secrets/*`) + env provider
- **macOS**: Keychain + keyring provider
- **Worker**: Cloudflare secrets (`wrangler secret put`)

See `secretspec.toml` for secret definitions and `security` skill for details.

Key secrets:
- `CCR_API_KEY` - Shared auth key (all machines + Worker)
- `TELEGRAM_BOT_TOKEN` - From @BotFather
- `TELEGRAM_WEBHOOK_SECRET` - Webhook validation
- `CCR_MACHINE_ID` - Unique per machine

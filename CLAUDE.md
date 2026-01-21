# CLAUDE.md - Claude Code Remote

Control Claude Code remotely via Telegram, Email, LINE, or Desktop notifications.

## Quick Start

```bash
npm install
npm run setup        # Configure channels, set up hooks
npm run webhooks:log # Start services (logs to ~/.local/state/claude-code-remote/daemon.log)

# For Telegram replies, expose port 4731 via tunnel (ngrok, cloudflared, etc.)
# The WEBHOOK_DOMAIN env var should match your tunnel's public hostname
```

## Commands

| Command | Description |
|---------|-------------|
| [`/test-notify`](.claude/commands/test-notify.md) | Test all enabled notification channels |

## Skills

| Skill | When to use |
|-------|-------------|
| [`architecture`](.claude/skills/architecture/SKILL.md) | Understanding how it works, project structure |
| [`configuring-notifications`](.claude/skills/configuring-notifications/SKILL.md) | Setting up Email, Telegram, or LINE channels |
| [`troubleshooting`](.claude/skills/troubleshooting/SKILL.md) | Notifications not working, commands not executing |

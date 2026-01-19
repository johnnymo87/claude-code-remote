# CLAUDE.md - Claude Code Remote

Control Claude Code remotely via Telegram, Email, LINE, or Desktop notifications.

## Quick Start

```bash
npm install
npm run setup    # Configure channels, set up hooks
npm run webhooks # Start notification services

# For Telegram replies, start ngrok in another terminal:
source .env && ngrok http 4731 --url=$NGROK_DOMAIN
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

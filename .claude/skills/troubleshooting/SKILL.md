---
name: troubleshooting
description: Use when notifications aren't being sent, commands aren't executing, or services won't start
---

# Troubleshooting Claude Code Remote

## Overview

Common issues and their solutions for notification and command injection problems.

## Notifications Not Sending

### Check hooks are configured

```bash
# View Claude settings
cat ~/.claude/settings.json | jq '.hooks'
```

Should show `Stop` and `SubagentStop` hooks pointing to `claude-hook-notify.js`.

If missing, run:
```bash
npm run setup
```

### Test notification manually

```bash
node claude-hook-notify.js completed
```

If this works but Claude isn't triggering notifications:
- Ensure Claude was started AFTER hooks were configured
- Restart Claude session

### Check channel-specific issues

**Telegram:**
```bash
# Test bot token
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe"

# Check webhook
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

**Email:**
```bash
node claude-remote.js test
```

## Commands Not Executing

### Check injection mode

```bash
grep INJECTION_MODE .env
```

- `pty` (default): Works without tmux, injects directly
- `tmux`: Requires active tmux session

### For tmux mode

```bash
# List sessions
tmux list-sessions

# Verify Claude is in expected session
tmux list-windows -t claude-session
```

### Test injection

```bash
node test-injection.js
```

## Services Won't Start

### Port already in use

```bash
# Find process on port 3000
lsof -i :3000

# Kill if needed
kill -9 <PID>
```

### Missing dependencies

```bash
npm install
```

### Environment not loaded

```bash
# Check .env exists
ls -la .env

# Check devenv is active
node --version  # Should be v22.x
```

## Debug Mode

Enable verbose logging:

```bash
LOG_LEVEL=debug npm run webhooks
DEBUG=true node claude-hook-notify.js completed
```

## Session Token Issues

### Token expired or invalid

Tokens expire after 24 hours. Check token storage:

```bash
ls -la src/data/
```

### Clear stale sessions

```bash
rm src/data/session-map.json
rm src/data/claude-sessions.json
```

Then restart services.

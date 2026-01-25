---
name: troubleshooting
description: Use when notifications aren't being sent, commands aren't executing, or services won't start
---

# Troubleshooting Claude Code Remote

## Overview

Common issues and their solutions for notification and command injection problems.

## Worker Routing Issues

### Machine agent not connecting

```bash
# Devbox
devenv shell
ccr-start npm run webhooks:log

# macOS
devenv shell
secretspec run -- npm run webhooks:log

# Look for: [MachineAgent] [INFO] Authenticated and connected as <machine-id>
# Or errors: [MachineAgent] [ERROR] WebSocket error: ...
```

**If not connecting:**
1. Verify `CCR_WORKER_URL` is set correctly in secretspec.toml or your secret storage
2. Check Worker is deployed: `curl https://your-worker.workers.dev/sessions`
3. Ensure outbound WebSocket connections allowed (corporate firewalls)
4. Verify `CCR_API_KEY` matches between agent and Worker

### Commands going to wrong machine

Each machine needs unique `CCR_MACHINE_ID`:
- Devbox: Hardcoded in `ccr-start` script
- macOS: Set in Keychain via SecretSpec

Check registered sessions:
```bash
curl https://ccr-router.your-account.workers.dev/sessions
```

### Notifications sent but no reply routing

1. **Check session registered with Worker:**
   ```bash
   # After enabling notifications, check Worker sessions
   curl https://ccr-router.your-account.workers.dev/sessions | jq
   ```

2. **Verify webhook points to Worker:**
   ```bash
   # Devbox
   curl "https://api.telegram.org/bot$(cat /run/secrets/telegram_bot_token)/getWebhookInfo" | jq '.result.url'

   # macOS
   secretspec run -- sh -c 'curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq ".result.url"'
   # Should show Worker URL, not direct tunnel URL
   ```

### Worker returning errors

Check Worker logs in Cloudflare dashboard:
1. Go to Workers & Pages
2. Select ccr-router
3. View Logs tab

Common issues:
- Missing secrets (TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET)
- Durable Object not created (check migrations in wrangler.toml)

### Worker secrets corrupted (Telegram 404 or 401 errors)

If Worker fails with:
- **Telegram 404**: Bot token secret is invalid
- **Telegram 401 Unauthorized**: Webhook secret mismatch

This is often caused by shell escaping when setting secrets via `echo | wrangler secret put`.

**Fix:** Re-set secrets with proper escaping:
```bash
cd ~/projects/ccr-worker
export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"

# Read from sops-nix on devbox
cat /run/secrets/telegram_bot_token | wrangler secret put TELEGRAM_BOT_TOKEN
cat /run/secrets/telegram_webhook_secret | wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

**Verify:**
```bash
# Check webhook status (should show no recent errors)
curl -s "https://api.telegram.org/bot$(cat /run/secrets/telegram_bot_token)/getWebhookInfo" | jq '{url, last_error_message}'
```

## Notifications Not Sending

### Check hooks are configured

```bash
cat ~/.claude/settings.json | jq '.hooks'
```

Should show `Stop` and `SessionStart` hooks pointing to shell scripts in `~/.claude/hooks/`.

If missing:
```bash
npm run setup
```

### Test notification manually

```bash
# Devbox
ccr-start node claude-hook-notify.js completed

# macOS
secretspec run -- node claude-hook-notify.js completed
```

If this works but Claude isn't triggering notifications:
- Ensure Claude was started AFTER hooks were configured
- Restart Claude session

### Check channel-specific issues

**Telegram:**
```bash
# Test bot token (devbox)
curl "https://api.telegram.org/bot$(cat /run/secrets/telegram_bot_token)/getMe"

# Check webhook
curl "https://api.telegram.org/bot$(cat /run/secrets/telegram_bot_token)/getWebhookInfo" | jq
```

## Commands Not Executing

### Check injection mode

The system auto-detects injection method based on session transport:
1. **nvim RPC** - Preferred when Claude is in nvim terminal
2. **tmux** - Fallback when nvim socket unavailable
3. **PTY** - Legacy mode for local sessions

### Verify session is registered

```bash
curl http://localhost:4731/sessions | jq
```

Sessions must have `notify: true` to receive commands.

### Test injection locally

```bash
# Check CCR can reach the session
curl -X POST http://localhost:4731/tokens/validate \
  -H "Content-Type: application/json" \
  -d '{"token": "YOUR_TOKEN", "chat_id": "YOUR_CHAT_ID"}'
```

## Services Won't Start

### Port already in use

```bash
lsof -i :4731
kill -9 <PID>
```

### Missing dependencies

```bash
devenv shell
npm install
```

### Logger import error

If you see `createLogger is not a function`:
```bash
git pull origin master  # Get the fix
# Then restart with ccr-start or secretspec run
```

## Debug Mode

Enable verbose logging:

```bash
# Devbox
LOG_LEVEL=debug ccr-start npm run webhooks:log

# macOS
LOG_LEVEL=debug secretspec run -- npm run webhooks:log
```

Log location: `~/.local/state/claude-code-remote/daemon.log`

## Session Token Issues

### Token expired or invalid

Tokens expire after 24 hours. Check if session exists:
```bash
curl http://localhost:4731/sessions | jq
```

### Clear stale sessions

The sessions database is at `src/data/sessions.db`. To reset:
```bash
rm src/data/sessions.db
```

Then restart services.

## NixOS Systemd Service Issues

If using the systemd service (managed via workstation repo):

```bash
# Check status
sudo systemctl status ccr-webhooks

# View logs
journalctl -u ccr-webhooks -f

# Restart after config changes
sudo systemctl restart ccr-webhooks
```

Note: The systemd service reads secrets from `/run/secrets/*` directly.

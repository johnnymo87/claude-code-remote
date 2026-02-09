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
devenv shell
op run --env-file=.env.1password -- npm run webhooks:log

# Look for: [MachineAgent] [INFO] Authenticated and connected as <machine-id>
# Or errors: [MachineAgent] [ERROR] WebSocket error: ...
```

**If not connecting:**
1. Verify `CCR_WORKER_URL` in `.env.1password` or environment
2. Check Worker is deployed: `curl https://your-worker.workers.dev/sessions`
3. Ensure outbound WebSocket connections allowed (corporate firewalls)
4. Verify `CCR_API_KEY` matches between agent and Worker (check 1Password)

### Commands going to wrong machine

Each machine needs unique `CCR_MACHINE_ID`:
- Devbox: Set in devenv.nix (`export CCR_MACHINE_ID="devbox"`)
- macOS: Set in environment or defaults to "macbook"

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
   op run --env-file=.env.1password -- sh -c 'curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq ".result.url"'
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

# Read from 1Password
op run --env-file=.env.1password -- sh -c 'echo "$TELEGRAM_BOT_TOKEN" | wrangler secret put TELEGRAM_BOT_TOKEN'
op run --env-file=.env.1password -- sh -c 'echo "$TELEGRAM_WEBHOOK_SECRET" | wrangler secret put TELEGRAM_WEBHOOK_SECRET'
```

**Verify:**
```bash
op run --env-file=.env.1password -- sh -c 'curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq "{url, last_error_message}"'
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
op run --env-file=.env.1password -- node claude-hook-notify.js completed
```

If this works but Claude isn't triggering notifications:
- Ensure Claude was started AFTER hooks were configured
- Restart Claude session

### Check channel-specific issues

**Telegram:**
```bash
# Test bot token
op run --env-file=.env.1password -- sh -c 'curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe"'

# Check webhook
op run --env-file=.env.1password -- sh -c 'curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq'
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
# Then restart webhook server
op run --env-file=.env.1password -- npm run webhooks:log
```

## Stop Hook Debug Probe

The `on-stop.sh` script has built-in checkpoint logging:

```bash
# List recent hook executions
ls -lt ~/.claude/runtime/hook-debug/ | head -5

# Read latest probe log
cat "$(ls -t ~/.claude/runtime/hook-debug/stop.*.log | head -1)"
```

Each log traces: `session_id` → `label` → `transcript` → `message` → `payload` → `curl_done`. Missing checkpoints indicate where the script exited.

### Systemd environment issues

When CCR runs as a systemd service, `start-server.js` auto-fixes two common issues:
- **Missing nix-profile binaries**: Prepends `~/.nix-profile/bin` to PATH (for nvim, tmux)
- **tmux socket not found**: Sets `TMUX_TMPDIR` from `XDG_RUNTIME_DIR` (systemd uses `/run/user/<uid>` not `/tmp`)

## Debug Mode

Enable verbose logging:

```bash
LOG_LEVEL=debug op run --env-file=.env.1password -- npm run webhooks:log
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

Note: The systemd service reads secrets via 1Password service account.

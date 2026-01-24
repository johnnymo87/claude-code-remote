---
name: operations
description: Use for CCR operations tasks - checking logs, restarting services, health checks, debugging issues
---

# CCR Operations Runbook

## Log Locations

| Component | Location |
|-----------|----------|
| Webhook server | `~/.local/state/claude-code-remote/daemon.log` |
| Claude hooks | Check Claude Code's hook output in terminal |
| Worker logs | `wrangler tail` (requires Cloudflare auth) |

## Health Checks

### Local Webhook Server

```bash
# Check if running
pgrep -af "node.*telegram-webhook"

# Health endpoint
curl -s http://localhost:4731/health
# Expected: {"status":"ok"}

# Check sessions
curl -s http://localhost:4731/sessions | jq '.sessions[] | {label, session_id}'
```

### Worker

```bash
# Health check
curl -s https://ccr-router.jonathan-mohrbacher.workers.dev/health
# Expected: ok

# List connected machines
curl -s https://ccr-router.jonathan-mohrbacher.workers.dev/sessions | jq
```

### Telegram Webhook

```bash
source ~/projects/claude-code-remote/.env
curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq
```

## Starting/Stopping Services

### Webhook Server

```bash
# Start (foreground with logs)
cd ~/projects/claude-code-remote
npm run webhooks:log

# Start (background)
cd ~/projects/claude-code-remote
nohup npm run webhooks:log >> ~/.local/state/claude-code-remote/daemon.log 2>&1 &

# Stop
pkill -f "node.*telegram-webhook"

# Restart
pkill -f "node.*telegram-webhook"
sleep 1
cd ~/projects/claude-code-remote && nohup npm run webhooks:log >> ~/.local/state/claude-code-remote/daemon.log 2>&1 &
```

### Worker (Cloudflare)

```bash
cd ~/projects/ccr-worker
export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"
wrangler deploy
```

## Common Issues

### WebSocket Disconnects (1006)

Normal behavior - Durable Objects hibernate after ~60s of inactivity. The MachineAgent auto-reconnects:
```
[MachineAgent] [WARN] WebSocket closed (1006: ), reconnecting...
[MachineAgent] [INFO] Authenticated and connected as devbox
```

### Notifications Not Sending

1. Check webhook server is running
2. Verify session is registered:
   ```bash
   curl -s http://localhost:4731/sessions | jq
   ```
3. Check `notify_label` exists:
   ```bash
   ls ~/.claude/runtime/sessions/<session-id>/notify_label
   ```

### Commands Not Reaching Claude

1. Check Worker has the session:
   ```bash
   curl -s https://ccr-router.jonathan-mohrbacher.workers.dev/sessions | jq
   ```
2. Check MachineAgent received command (look for `Received command` in logs)
3. Check injection method:
   - nvim: Needs ccremote plugin loaded
   - tmux: Falls back automatically

### Viewing Worker Logs

```bash
cd ~/projects/ccr-worker
export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"
wrangler tail --format=pretty
```

## Maintenance

### Clean Up Old Sessions

Sessions auto-expire, but to force cleanup:
```bash
curl -s http://localhost:4731/sessions | jq '.sessions[].session_id' | \
  xargs -I{} curl -X POST http://localhost:4731/sessions/{}/disable-notify
```

### Check Disk Usage (runtime files)

```bash
du -sh ~/.claude/runtime/
# Clean old sessions (older than 7 days)
find ~/.claude/runtime/sessions -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;
```

### Update Dependencies

```bash
cd ~/projects/claude-code-remote
git pull
npm install
# Restart webhook server
```

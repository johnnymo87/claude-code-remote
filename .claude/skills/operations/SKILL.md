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
# Health check (replace with your worker URL)
curl -s https://ccr-router.your-account.workers.dev/health
# Expected: ok

# List connected machines
curl -s https://ccr-router.your-account.workers.dev/sessions | jq
```

### Telegram Webhook

```bash
# Using 1Password (all platforms)
op run --env-file=.env.1password -- sh -c 'curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo" | jq'
```

## Starting/Stopping Services

### Webhook Server

**All platforms (same command):**
```bash
# Start (foreground with logs)
cd ~/projects/claude-code-remote
devenv shell
op run --env-file=.env.1password -- npm run webhooks:log

# Start (background)
devenv shell -- op run --env-file=.env.1password -- npm run webhooks:log >> ~/.local/state/claude-code-remote/daemon.log 2>&1 &

# Stop
pkill -f "node.*telegram-webhook"
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
   curl -s https://ccr-router.your-account.workers.dev/sessions | jq
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
devenv shell
npm install
# Restart webhook server (see Starting/Stopping above)
```

## Secret Rotation

### When to Rotate

- Secret leaked (GitGuardian alert, accidental commit, etc.)
- Periodic rotation (recommended: annually)

### If Leaked: Revoke First

Before rotating, revoke the compromised secret at its source:

| Secret | Revocation |
|--------|------------|
| `TELEGRAM_BOT_TOKEN` | Telegram @BotFather → /revoke → select bot |
| `CCR_API_KEY` | No external revocation needed (just rotate) |
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password → Settings → Service Accounts → Revoke |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → API Tokens → Roll |

### Generate New Secrets

```bash
# CCR_API_KEY (base64url, 32 chars)
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

# TELEGRAM_WEBHOOK_SECRET (hex, 64 chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# TELEGRAM_WEBHOOK_PATH_SECRET (hex, 32 chars)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### Update All Locations

**Order matters** - update Worker first, then 1Password, then restart agents:

#### 1. Cloudflare Worker

```bash
cd ~/projects/ccr-worker
export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"

echo "NEW_VALUE" | wrangler secret put CCR_API_KEY
echo "NEW_VALUE" | wrangler secret put TELEGRAM_BOT_TOKEN
echo "NEW_VALUE" | wrangler secret put TELEGRAM_WEBHOOK_SECRET

# Verify
wrangler secret list
```

#### 2. 1Password (single source of truth)

```bash
# Update secrets in 1Password via web UI or CLI
op item edit ccr-secrets --vault=Automation \
  "CCR_API_KEY=NEW_VALUE" \
  "TELEGRAM_BOT_TOKEN=NEW_VALUE" \
  "TELEGRAM_WEBHOOK_SECRET=NEW_VALUE" \
  "TELEGRAM_WEBHOOK_PATH_SECRET=NEW_VALUE"
```

#### 3. Restart Services

```bash
# Restart webhook server (picks up new secrets from 1Password)
pkill -f "node.*telegram-webhook"
cd ~/projects/claude-code-remote
devenv shell
op run --env-file=.env.1password -- npm run webhooks:log
```

### Verify Recovery

```bash
# Check devbox connected
tail -20 ~/.local/state/claude-code-remote/daemon.log | grep -E 'Authenticated|ERROR'

# Check Worker health
curl -s https://ccr-router.your-account.workers.dev/health

# Test notification flow
# In a Claude session: /test-notify
```

### Common Pitfalls

- **Stale env vars**: op run always fetches fresh - no caching issues
- **Worker propagation**: Secrets may take 30-60s to propagate after `wrangler secret put`
- **Plain text vs secret**: Never use `[vars]` in wrangler.toml for secrets. Always `wrangler secret put`

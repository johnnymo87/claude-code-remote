---
name: configuring-notifications
description: Use when setting up Telegram notifications, or when notifications aren't working after setup
---

# Configuring Telegram Notifications

## Overview

Claude Code Remote sends notifications via Telegram and supports reply-to-command functionality.

## Prerequisites

- devenv installed (provides Node.js and 1Password CLI)
- Secrets configured in 1Password (see `machine-setup` skill)

## Telegram Setup

### Step 1: Create Bot

1. Message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow prompts
3. Save the bot token

### Step 2: Get Your Chat ID

```bash
# Send any message to your bot, then:
curl "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
```

### Step 3: Generate Webhook Secrets

```bash
# Generate webhook secret (32 bytes hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate path secret (16 bytes hex)
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### Step 4: Store Secrets in 1Password

Add to the `ccr-secrets` item in the Automation vault:
- `TELEGRAM_BOT_TOKEN` - From BotFather
- `TELEGRAM_WEBHOOK_SECRET` - Generated in step 3
- `TELEGRAM_WEBHOOK_PATH_SECRET` - Generated in step 3

For the Worker, set via `wrangler secret put`.

### Step 5: Point Webhook to Worker

```bash
# Using 1Password to get values
op run --env-file=.env.1password -- sh -c '
  curl -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
    -H "Content-Type: application/json" \
    -d "{
      \"url\": \"${CCR_WORKER_URL}/webhook/telegram/${TELEGRAM_WEBHOOK_PATH_SECRET}\",
      \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\"
    }"
'
```

### Step 6: Verify Connection

```bash
devenv shell
op run --env-file=.env.1password -- npm run webhooks:log

# Look for: [MachineAgent] [INFO] Authenticated and connected as <machine-id>
```

## Direct Mode (Single Machine Alternative)

For single-machine setups without the Worker:

1. Expose port 4731 via Cloudflare Tunnel, ngrok, or similar
2. Set `WEBHOOK_DOMAIN` as environment variable
3. Omit `CCR_WORKER_URL` - webhook URL is set automatically on server start

## Verify Configuration

```bash
# Test notification (from devenv shell)
op run --env-file=.env.1password -- node claude-hook-notify.js completed

# Check webhook status
op run --env-file=.env.1password -- sh -c 'curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"'
```

## Common Issues

### Commands Not Reaching Claude

**Check machine agent connection:**
```bash
# In webhook server logs, look for:
[MachineAgent] [INFO] Authenticated and connected as <machine-id>
```

**Check Worker sessions:**
```bash
curl https://ccr-router.your-account.workers.dev/sessions
```

### Wrong Machine Receives Command

Each machine must have a unique `CCR_MACHINE_ID`:
- Devbox: Set in devenv.nix (hardcoded to "devbox")
- macOS: Set in environment or defaults to "macbook"

### IPv6 Connectivity Issues

Set `TELEGRAM_FORCE_IPV4=true` as environment variable.

## Related Skills

- `machine-setup` - Platform-specific secret storage
- `security` - Secret management architecture
- `operations` - Starting/stopping services

---
name: configuring-notifications
description: Use when setting up Telegram notifications, or when notifications aren't working after setup
---

# Configuring Telegram Notifications

## Overview

Claude Code Remote sends notifications via Telegram and supports reply-to-command functionality.

## Prerequisites

- devenv installed (provides Node.js and SecretSpec)
- Secrets configured (see `machine-setup` skill for platform-specific instructions)

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

### Step 4: Store Secrets

See the `machine-setup` skill for platform-specific instructions:
- **Devbox**: Add to sops-nix in workstation repo
- **macOS**: Store in Keychain via `security add-generic-password`
- **Worker**: Set via `wrangler secret put`

### Step 5: Point Webhook to Worker

```bash
# Get values from your secret storage
BOT_TOKEN="<from keychain or /run/secrets>"
WORKER_URL="https://ccr-router.your-account.workers.dev"
WEBHOOK_SECRET="<from keychain or /run/secrets>"
PATH_SECRET="<from keychain or /run/secrets>"

curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WORKER_URL}/webhook/telegram/${PATH_SECRET}\",
    \"secret_token\": \"${WEBHOOK_SECRET}\"
  }"
```

### Step 6: Verify Connection

```bash
# Devbox
devenv shell
ccr-start npm run webhooks:log

# macOS
devenv shell
secretspec run -- npm run webhooks:log

# Look for: [MachineAgent] [INFO] Authenticated and connected as <machine-id>
```

## Direct Mode (Single Machine Alternative)

For single-machine setups without the Worker:

1. Expose port 4731 via Cloudflare Tunnel, ngrok, or similar
2. Set `WEBHOOK_DOMAIN` in secretspec.toml defaults or as env var
3. Omit `CCR_WORKER_URL` - webhook URL is set automatically on server start

## Verify Configuration

```bash
# Test notification (from devenv shell)
ccr-start node claude-hook-notify.js completed  # devbox
secretspec run -- node claude-hook-notify.js completed  # macOS

# Check webhook status
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
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
- Devbox: Set in `ccr-start` script (hardcoded to "devbox")
- macOS: Store in Keychain as `CCR_MACHINE_ID`

### IPv6 Connectivity Issues

Set `TELEGRAM_FORCE_IPV4=true` in secretspec.toml or as env var override.

## Related Skills

- `machine-setup` - Platform-specific secret storage
- `security` - Secret management architecture
- `operations` - Starting/stopping services

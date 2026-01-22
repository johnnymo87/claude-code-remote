---
name: configuring-notifications
description: Use when setting up Telegram notifications, or when notifications aren't working after setup
---

# Configuring Telegram Notifications

## Overview

Claude Code Remote sends notifications via Telegram and supports reply-to-command functionality.

## Interactive Setup (Recommended)

```bash
npm run setup
```

This wizard:
- Guides you through Telegram configuration
- Creates/updates your `.env` file
- Merges hooks into `~/.claude/settings.json`

## Telegram Setup

### Option A: Worker Routing (Multi-Machine)

Best for running Claude on multiple machines simultaneously.

**Step 1: Create bot**
1. Message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow prompts
3. Save the bot token

**Step 2: Get your Chat ID**
```bash
# Send any message to your bot, then:
curl "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
```

**Step 3: Deploy Worker** (one-time, from any machine)

See the ccr-worker project or workstation's `docs/plans/2026-01-21-ccr-cloudflare-worker-routing.md`

**Step 4: Configure .env** (on each machine)
```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id

# Worker routing (omit WEBHOOK_DOMAIN when using Worker)
CCR_WORKER_URL=https://ccr-router.your-account.workers.dev
CCR_MACHINE_ID=devbox  # unique per machine: 'devbox', 'macbook', etc.
```

**Step 5: Point webhook to Worker**
```bash
BOT_TOKEN="your-bot-token"
WORKER_URL="https://ccr-router.your-account.workers.dev"
WEBHOOK_SECRET="your-webhook-secret"
PATH_SECRET="your-path-secret"

curl -X POST "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WORKER_URL}/webhook/telegram/${PATH_SECRET}\",
    \"secret_token\": \"${WEBHOOK_SECRET}\"
  }"
```

**Step 6: Verify connection**
```bash
npm run webhooks:log
# Look for: [MachineAgent] [INFO] Connected to Worker as devbox
```

### Option B: Direct Mode (Single Machine)

Simpler setup for single-machine use.

**Step 1-2:** Same as above

**Step 3: Set up tunnel**

Expose port 4731 via Cloudflare Tunnel, ngrok, or similar.

**Step 4: Configure .env**
```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
WEBHOOK_DOMAIN=ccr.yourdomain.com

# Security (optional but recommended)
TELEGRAM_WEBHOOK_SECRET=your-32-byte-hex-secret
TELEGRAM_WEBHOOK_PATH_SECRET=your-16-byte-hex-secret
```

The webhook URL is set automatically on server start.

## Verify Configuration

```bash
# Test notification
node claude-hook-notify.js completed

# Check Worker connection (if using Worker routing)
journalctl -u ccr-webhooks -f  # or check console output
```

## Common Issues

### Commands not reaching Claude

**With Worker routing:**
```bash
# Check machine agent is connected
npm run webhooks:log
# Look for: Connected to Worker as <machine-id>

# Check Worker sessions
curl https://ccr-router.your-account.workers.dev/sessions
```

**With direct mode:**
```bash
# Check webhook status
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

### Wrong machine receives command

Ensure each machine has a unique `CCR_MACHINE_ID` in `.env`.

### IPv6 connectivity issues
```env
TELEGRAM_FORCE_IPV4=true
```

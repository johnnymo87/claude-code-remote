---
name: configuring-notifications
description: Use when setting up Email, Telegram, or LINE notification channels, or when channels aren't working after setup
---

# Configuring Notification Channels

## Overview

Claude Code Remote supports multiple notification channels. Configure one or more based on your preferences.

## Interactive Setup (Recommended)

```bash
npm run setup
```

This wizard:
- Guides you through each channel's configuration
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

## Email Setup

**Step 1: Get app password** (Gmail)
- Go to [Google App Passwords](https://myaccount.google.com/apppasswords)
- Generate password for "Mail"

**Step 2: Configure .env**
```env
EMAIL_ENABLED=true
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
IMAP_USER=your-email@gmail.com
IMAP_PASS=your-app-password
EMAIL_TO=notification-recipient@gmail.com
ALLOWED_SENDERS=notification-recipient@gmail.com
```

## LINE Setup

**Step 1: Create LINE channel**
1. Go to [LINE Developers Console](https://developers.line.biz/)
2. Create a Messaging API channel
3. Note the Channel Access Token and Channel Secret

**Step 2: Configure .env**
```env
LINE_ENABLED=true
LINE_CHANNEL_ACCESS_TOKEN=your-token
LINE_CHANNEL_SECRET=your-secret
LINE_USER_ID=your-user-id
```

## Verify Configuration

```bash
# Test all enabled channels
node claude-hook-notify.js completed

# Check Worker connection (if using Worker routing)
journalctl -u ccr-webhooks -f  # or check console output
```

## Common Issues

### Telegram: Commands not reaching Claude

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

### Telegram: Wrong machine receives command

Ensure each machine has a unique `CCR_MACHINE_ID` in `.env`.

### Email: Not receiving
- Check spam folder
- Verify app password (not regular password) for Gmail

### IPv6 connectivity issues (Telegram)
```env
TELEGRAM_FORCE_IPV4=true
```

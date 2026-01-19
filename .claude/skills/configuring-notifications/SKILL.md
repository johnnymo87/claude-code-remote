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

## Manual Configuration

### Telegram

**Step 1: Create bot**
1. Message [@BotFather](https://t.me/BotFather)
2. Send `/newbot` and follow prompts
3. Save the bot token

**Step 2: Get your Chat ID**
```bash
# Send any message to your bot, then:
curl "https://api.telegram.org/bot<TOKEN>/getUpdates" | jq '.result[0].message.chat.id'
```

**Step 3: Configure .env**
```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
NGROK_DOMAIN=your-domain.ngrok-free.dev
```

**Step 4: Set up webhook** (for receiving replies)
```bash
source .env && ngrok http 4731 --url=$NGROK_DOMAIN
```

### Email

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

### LINE

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

# Test specific channel
node test-telegram-notification.js
```

## Common Issues

### Telegram: Bot not responding
```bash
# Check webhook status
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

### Email: Not receiving
- Check spam folder
- Verify app password (not regular password) for Gmail
- Run `node claude-remote.js test`

### IPv6 connectivity issues (Telegram)
Add to `.env`:
```env
TELEGRAM_FORCE_IPV4=true
```

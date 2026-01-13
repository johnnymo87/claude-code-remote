---
description: Test all enabled notification channels
allowed-tools: Bash(node:*)
---

# Test Notifications

Send a test notification to all enabled channels (Telegram, Email, LINE, Desktop).

## When to Use

- After initial setup to verify configuration
- When notifications stop working
- After changing `.env` settings

## Steps

1. **Run the test**:
   ```bash
   node claude-hook-notify.js completed
   ```

2. **Check output** for errors per channel

3. **Verify receipt**:
   - Telegram: Check bot chat
   - Email: Check inbox (and spam)
   - LINE: Check LINE app
   - Desktop: Listen for sound/notification

## Expected Output

```
[Desktop] Notification sent
[Telegram] Message sent successfully
[Email] Notification sent to user@example.com
```

If a channel shows an error, see the `troubleshooting` skill.

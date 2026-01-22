---
description: Test Telegram notifications
allowed-tools: Bash(node:*)
---

# Test Notifications

Send a test notification to Telegram.

## When to Use

- After initial setup to verify configuration
- When notifications stop working
- After changing `.env` settings

## Steps

1. **Run the test**:
   ```bash
   node claude-hook-notify.js completed
   ```

2. **Check output** for errors

3. **Verify receipt**: Check your Telegram bot chat

## Expected Output

```
[Telegram] Message sent successfully
```

If it shows an error, see the `troubleshooting` skill.

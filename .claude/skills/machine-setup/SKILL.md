---
name: machine-setup
description: Use when setting up CCR on a new machine (macOS, Linux, devbox) to join the notification network
---

# Machine Setup

Complete checklist for adding a new machine to the CCR network.

## Prerequisites

- Node.js 18+ installed
- Git access to claude-code-remote repo
- Access to shared secrets (CCR_API_KEY, Telegram tokens)

## Step 1: Clone Repository

```bash
git clone git@github.com:johnnymo87/claude-code-remote.git ~/projects/claude-code-remote
cd ~/projects/claude-code-remote
npm install
```

## Step 2: Create Environment File

Create `~/projects/claude-code-remote/.env`:

```bash
# Telegram Bot Configuration
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=7305572211:AAH8S7yw3GjFIYOofX5-eKxRN3XzUsDTJN0
TELEGRAM_CHAT_ID=8248645256

# Worker Routing (multi-machine setup)
CCR_WORKER_URL=https://ccr-router.jonathan-mohrbacher.workers.dev
CCR_MACHINE_ID=<unique-name>  # e.g., 'macbook', 'devbox', 'workpc'
CCR_API_KEY=OOytSFvLS0Yd5sjMwU2JpJ9PbMgqSE9g

# Optional: Webhook secrets (only needed if running direct mode)
# TELEGRAM_WEBHOOK_SECRET=your-32-byte-hex
# TELEGRAM_WEBHOOK_PATH_SECRET=your-16-byte-hex
# WEBHOOK_DOMAIN=ccr.yourdomain.com
```

**Important:**
- `CCR_MACHINE_ID` must be unique per machine
- `CCR_API_KEY` is shared across all machines (authenticates with Worker)
- Don't set `WEBHOOK_DOMAIN` when using Worker routing

## Step 3: Set Up Claude Hooks

**Option A: NixOS/home-manager (devbox)**

Hooks are managed via workstation repo:
```bash
cd ~/projects/workstation
home-manager switch --flake .#dev
```

This deploys hooks to `~/.claude/hooks/` and merges config into `~/.claude/settings.json`.

**Option B: Manual setup (macOS/other)**

Run the setup wizard:
```bash
npm run setup
```

Or manually add to `~/.claude/settings.json`:
```json
{
  "hooks": {
    "SessionStart": [{
      "matcher": "compact|startup|resume",
      "hooks": [{"type": "command", "command": "~/.claude/hooks/on-session-start.sh"}]
    }],
    "Stop": [{
      "hooks": [{"type": "command", "command": "~/.claude/hooks/on-stop.sh"}]
    }]
  }
}
```

## Step 4: Start Webhook Server

```bash
cd ~/projects/claude-code-remote
npm run webhooks:log
```

**Verify connection:**
```
[MachineAgent] [INFO] Authenticated and connected as <your-machine-id>
```

## Step 5: Test End-to-End

1. Start a Claude Code session
2. Register for notifications:
   ```
   /notify-telegram test-setup
   ```
3. Let Claude respond and stop
4. Check Telegram for notification
5. Reply to test command injection

## Troubleshooting

### "Authentication failed"
- Verify `CCR_API_KEY` matches the Worker secret
- Check `CCR_WORKER_URL` is correct

### "Machine not connected"
- Ensure webhook server is running
- Check for WebSocket connection in logs

### Commands not reaching Claude
- Verify session is registered: check `/sessions` endpoint on Worker
- Ensure hooks are configured in `~/.claude/settings.json`

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | Bot token from @BotFather |
| `TELEGRAM_CHAT_ID` | Yes | Your Telegram chat ID |
| `CCR_WORKER_URL` | Yes* | Worker URL for multi-machine |
| `CCR_MACHINE_ID` | Yes* | Unique machine identifier |
| `CCR_API_KEY` | Yes* | Shared API key for Worker auth |
| `WEBHOOK_DOMAIN` | No | Only for direct mode (no Worker) |

*Required for multi-machine setup (recommended)

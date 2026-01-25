---
name: machine-setup
description: Use when setting up CCR on a new machine (macOS, Linux, devbox) to join the notification network
---

# Machine Setup

Complete checklist for adding a new machine to the CCR network.

## Prerequisites

- devenv installed (provides Node.js and SecretSpec)
- Git access to claude-code-remote repo
- Access to shared secrets (see security skill)

## Step 1: Clone Repository

```bash
git clone git@github.com:johnnymo87/claude-code-remote.git ~/projects/claude-code-remote
cd ~/projects/claude-code-remote
devenv shell  # Enters dev environment with Node.js, npm, etc.
npm install
```

## Step 2: Configure Secrets

Secrets are managed via SecretSpec with platform-native storage.

### Devbox (Headless NixOS)

Secrets come from sops-nix, decrypted at boot to `/run/secrets/*`.

**1. Add secrets to workstation repo:**
```bash
cd ~/projects/workstation
SOPS_AGE_KEY_FILE=/persist/sops-age-key.txt sops secrets/devbox.yaml
```

Add:
```yaml
ccr_api_key: <shared-api-key>
telegram_bot_token: <from-botfather>
telegram_webhook_secret: <32-byte-hex>
telegram_webhook_path_secret: <16-byte-hex>
```

**2. Define secrets in NixOS config:**
```nix
# hosts/devbox/configuration.nix
sops.secrets = {
  ccr_api_key = { owner = "dev"; };
  telegram_bot_token = { owner = "dev"; };
  telegram_webhook_secret = { owner = "dev"; };
  telegram_webhook_path_secret = { owner = "dev"; };
};
```

**3. Rebuild NixOS:**
```bash
sudo nixos-rebuild switch --flake .#devbox
```

**4. Create devenv.local.yaml (gitignored):**
```yaml
secretspec:
  enable: true
  provider: env
  profile: default
```

### macOS

Secrets stored in Keychain via SecretSpec keyring provider.

**Store secrets:**
```bash
security add-generic-password -s secretspec -a CCR_API_KEY -w '<value>' -U
security add-generic-password -s secretspec -a TELEGRAM_BOT_TOKEN -w '<value>' -U
security add-generic-password -s secretspec -a TELEGRAM_WEBHOOK_SECRET -w '<value>' -U
security add-generic-password -s secretspec -a TELEGRAM_WEBHOOK_PATH_SECRET -w '<value>' -U
security add-generic-password -s secretspec -a CCR_MACHINE_ID -w 'macbook' -U
```

**Verify:**
```bash
secretspec check
```

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

### Devbox

```bash
cd ~/projects/claude-code-remote
devenv shell
ccr-start npm run webhooks:log
```

### macOS

```bash
cd ~/projects/claude-code-remote
devenv shell
secretspec run -- npm run webhooks:log
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

## Secrets Reference

See `secretspec.toml` for full list. Key secrets:

| Secret | Description |
|--------|-------------|
| `CCR_API_KEY` | Shared key for Worker auth (same across all machines) |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | 32-byte hex for webhook validation |
| `TELEGRAM_WEBHOOK_PATH_SECRET` | 16-byte hex for URL obfuscation |
| `CCR_MACHINE_ID` | Unique machine name (e.g., 'devbox', 'macbook') |

Config defaults are in `secretspec.toml`:
- `TELEGRAM_CHAT_ID` - Your Telegram user ID
- `CCR_WORKER_URL` - Worker URL for multi-machine routing
- `TELEGRAM_WEBHOOK_PORT` - Default 4731

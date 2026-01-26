---
name: machine-setup
description: Use when setting up CCR on a new machine (macOS, Linux, devbox) to join the notification network
---

# Machine Setup

Complete checklist for adding a new machine to the CCR network.

## Prerequisites

- devenv installed (provides Node.js and 1Password CLI)
- Git access to claude-code-remote repo
- 1Password account with access to Automation vault (see security skill)

## Step 1: Clone Repository

```bash
git clone git@github.com:johnnymo87/claude-code-remote.git ~/projects/claude-code-remote
cd ~/projects/claude-code-remote
devenv shell  # Enters dev environment with Node.js, npm, op CLI
npm install
```

## Step 2: Configure Secrets

Secrets are managed via 1Password with a service account for headless access.

### Devbox (Headless NixOS)

The service account token is stored in sops-nix and auto-exported by devenv.

**1. Add service account token to workstation repo:**
```bash
cd ~/projects/workstation
sudo SOPS_AGE_KEY_FILE=/persist/sops-age-key.txt nix-shell -p sops --run \
  'sops set secrets/devbox.yaml '"'"'["op_service_account_token"] "<your-token>"'"'"''
```

**2. Define secret in NixOS config:**
```nix
# hosts/devbox/configuration.nix
sops.secrets = {
  op_service_account_token = { owner = "dev"; mode = "0400"; };
};
```

**3. Rebuild NixOS:**
```bash
sudo nixos-rebuild switch --flake .#devbox
```

**4. Create devenv.local.yaml (gitignored):**
```yaml
# Disable secretspec - using 1Password instead
secretspec:
  enable: false
```

**5. Verify:**
```bash
cd ~/projects/claude-code-remote
direnv reload
echo "Token set: $([ -n \"$OP_SERVICE_ACCOUNT_TOKEN\" ] && echo 'yes' || echo 'no')"
op whoami
```

### macOS

Two options for 1Password auth:

**Option A: Service Account (headless, same as devbox)**
```bash
export OP_SERVICE_ACCOUNT_TOKEN="<your-token>"
# Add to your shell profile (~/.zshrc or ~/.bashrc)
```

**Option B: Desktop App (interactive)**
```bash
# op CLI will use 1Password app for auth
# No environment variable needed
op signin  # First time setup
```

**Verify:**
```bash
op run --env-file=.env.1password -- env | grep CCR_API_KEY
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

Same command on all platforms:

```bash
cd ~/projects/claude-code-remote
devenv shell
op run --env-file=.env.1password -- npm run webhooks:log
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

### "op: command not found"
- Ensure you're in devenv shell
- Run `direnv reload` if using direnv

### "Could not resolve item"
- Check 1Password vault name matches (Automation)
- Verify service account has access to the vault
- Check item name matches (ccr-secrets)

### "Authentication failed"
- Verify `CCR_API_KEY` in 1Password matches the Worker secret
- Check `CCR_WORKER_URL` is correct

### "Machine not connected"
- Ensure webhook server is running
- Check for WebSocket connection in logs

### Commands not reaching Claude
- Verify session is registered: check `/sessions` endpoint on Worker
- Ensure hooks are configured in `~/.claude/settings.json`

## Secrets Reference

See `.env.1password` for secret references. Key secrets:

| Secret | Description |
|--------|-------------|
| `CCR_API_KEY` | Shared key for Worker auth (same across all machines) |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | 32-byte hex for webhook validation |
| `TELEGRAM_WEBHOOK_PATH_SECRET` | 16-byte hex for URL obfuscation |
| `CCR_MACHINE_ID` | Set in devenv.nix (devbox) or environment (macOS) |

Config is in `secretspec.toml` (defaults) and can be overridden via environment.

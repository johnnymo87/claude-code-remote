# 1Password Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate from sops-nix direct secrets to 1Password as single source of truth, using service account for headless access.

**Architecture:** Store only OP_SERVICE_ACCOUNT_TOKEN in sops-nix. All application secrets live in 1Password Automation vault. Use `op run` everywhere for unified command across all platforms.

**Tech Stack:** 1Password CLI (`op`), sops-nix, devenv, NixOS

---

## Current State

```
┌─────────────────────────────────────────────────────────┐
│ Devbox (NixOS)                                          │
│                                                         │
│  sops-nix → /run/secrets/*                              │
│    ├── ccr_api_key                                      │
│    ├── telegram_bot_token                               │
│    ├── telegram_webhook_secret                          │
│    └── telegram_webhook_path_secret                     │
│                                                         │
│  enterShell reads /run/secrets/* → exports env vars     │
│  npm run webhooks:log                                   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ macOS                                                   │
│                                                         │
│  Keychain (via SecretSpec keyring provider)             │
│    ├── CCR_API_KEY                                      │
│    ├── TELEGRAM_BOT_TOKEN                               │
│    ├── TELEGRAM_WEBHOOK_SECRET                          │
│    └── TELEGRAM_WEBHOOK_PATH_SECRET                     │
│                                                         │
│  secretspec run -- npm run webhooks:log                 │
└─────────────────────────────────────────────────────────┘
```

## Target State

```
┌─────────────────────────────────────────────────────────┐
│ 1Password (Automation vault)                            │
│                                                         │
│  ccr-secrets (item)                                     │
│    ├── CCR_API_KEY                                      │
│    ├── TELEGRAM_BOT_TOKEN                               │
│    ├── TELEGRAM_WEBHOOK_SECRET                          │
│    └── TELEGRAM_WEBHOOK_PATH_SECRET                     │
└─────────────────────────────────────────────────────────┘
          │
          │ OP_SERVICE_ACCOUNT_TOKEN
          ▼
┌─────────────────────────────────────────────────────────┐
│ Devbox (NixOS)                                          │
│                                                         │
│  sops-nix → /run/secrets/op_service_account_token       │
│                                                         │
│  enterShell: export OP_SERVICE_ACCOUNT_TOKEN            │
│  op run --env-file=.env.1password -- npm run ...        │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ macOS                                                   │
│                                                         │
│  Same flow (1Password desktop app OR service account)   │
│  op run --env-file=.env.1password -- npm run ...        │
└─────────────────────────────────────────────────────────┘
```

**Key benefits:**
- One command everywhere: `op run --env-file=.env.1password -- npm run webhooks:log`
- Secrets centralized in 1Password (easy rotation, audit, sharing)
- Only one secret in sops-nix (OP_SERVICE_ACCOUNT_TOKEN)
- macOS can use desktop app auth OR service account

---

## Task 1: Create CCR secrets item in 1Password

**Files:**
- None (1Password web/app)

**Step 1: Create ccr-secrets item in Automation vault**

Using 1Password web UI or CLI, create an item in the Automation vault:

```bash
# In nix-shell with op available
export OP_SERVICE_ACCOUNT_TOKEN="<your-token>"

# Create the item with all secrets
op item create \
  --category=login \
  --title="ccr-secrets" \
  --vault="Automation" \
  --field "CCR_API_KEY[password]=<value>" \
  --field "TELEGRAM_BOT_TOKEN[password]=<value>" \
  --field "TELEGRAM_WEBHOOK_SECRET[password]=<value>" \
  --field "TELEGRAM_WEBHOOK_PATH_SECRET[password]=<value>"
```

Get current values from `/run/secrets/*` on devbox:
```bash
cat /run/secrets/ccr_api_key
cat /run/secrets/telegram_bot_token
cat /run/secrets/telegram_webhook_secret
cat /run/secrets/telegram_webhook_path_secret
```

**Step 2: Verify the item was created**

```bash
op item get ccr-secrets --vault=Automation --format=json | jq '.fields[] | {label, value}'
```

Expected: All 4 fields visible with correct values.

**Step 3: Test reading individual secrets**

```bash
op read "op://Automation/ccr-secrets/CCR_API_KEY"
op read "op://Automation/ccr-secrets/TELEGRAM_BOT_TOKEN"
```

Expected: Values match what was stored.

---

## Task 2: Create .env.1password template

**Files:**
- Create: `.env.1password`

**Step 1: Create the env template file**

This file maps environment variable names to 1Password references:

```bash
# .env.1password - 1Password secret references
# Used with: op run --env-file=.env.1password -- <command>

CCR_API_KEY=op://Automation/ccr-secrets/CCR_API_KEY
TELEGRAM_BOT_TOKEN=op://Automation/ccr-secrets/TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET=op://Automation/ccr-secrets/TELEGRAM_WEBHOOK_SECRET
TELEGRAM_WEBHOOK_PATH_SECRET=op://Automation/ccr-secrets/TELEGRAM_WEBHOOK_PATH_SECRET
```

**Step 2: Test op run with the template**

```bash
export OP_SERVICE_ACCOUNT_TOKEN="<your-token>"
op run --env-file=.env.1password -- env | grep -E "CCR_API_KEY|TELEGRAM"
```

Expected: All 4 variables shown with their decrypted values.

**Step 3: Commit**

```bash
git add .env.1password
git commit -m "feat: add 1Password env template for op run"
```

---

## Task 3: Add OP_SERVICE_ACCOUNT_TOKEN to sops-nix

**Files:**
- Modify: `~/projects/workstation/secrets/devbox.yaml`
- Modify: `~/projects/workstation/hosts/devbox/configuration.nix`

**Step 1: Add token to sops secrets file**

```bash
cd ~/projects/workstation
sops secrets/devbox.yaml
```

Add:
```yaml
op_service_account_token: ops_eyJ...your-actual-token...
```

**Step 2: Add secret path to NixOS configuration**

In `hosts/devbox/configuration.nix`, add to `sops.secrets`:

```nix
op_service_account_token = { owner = "dev"; group = "dev"; mode = "0400"; };
```

**Step 3: Rebuild NixOS**

```bash
sudo nixos-rebuild switch --flake .#devbox
```

**Step 4: Verify secret is available**

```bash
sudo cat /run/secrets/op_service_account_token
```

Expected: Token value visible.

**Step 5: Commit workstation changes**

```bash
cd ~/projects/workstation
git add secrets/devbox.yaml hosts/devbox/configuration.nix
git commit -m "feat: add 1Password service account token to sops-nix"
```

---

## Task 4: Update devenv.nix for 1Password

**Files:**
- Modify: `/home/dev/projects/claude-code-remote/devenv.nix`

**Step 1: Update enterShell to export OP_SERVICE_ACCOUNT_TOKEN**

Replace the current enterShell with:

```nix
enterShell = ''
  # On devbox, export 1Password service account token from sops-nix
  if [ -f /run/secrets/op_service_account_token ]; then
    export OP_SERVICE_ACCOUNT_TOKEN="$(< /run/secrets/op_service_account_token)"
    echo "Claude Code Remote - Node $(node --version)"
    echo "1Password service account configured"
    echo ""
    echo "Start webhook server:"
    echo "  op run --env-file=.env.1password -- npm run webhooks:log"
  else
    echo "Claude Code Remote - Node $(node --version)"
    echo ""
    echo "Start webhook server (requires 1Password):"
    echo "  op run --env-file=.env.1password -- npm run webhooks:log"
  fi
'';
```

**Step 2: Remove ccr-start script**

Delete the entire `scripts.ccr-start.exec` block - no longer needed.

**Step 3: Add op CLI to packages**

Add 1Password CLI to devenv packages:

```nix
packages = [
  pkgs.python3
  pkgs._1password-cli
];
```

Note: This requires `nixpkgs.config.allowUnfree = true` in devenv or system config.

**Step 4: Test the new flow**

```bash
cd ~/projects/claude-code-remote
direnv reload  # or exit and re-enter

# Verify token is exported
echo $OP_SERVICE_ACCOUNT_TOKEN | head -c 20

# Test op run
op run --env-file=.env.1password -- env | grep TELEGRAM
```

Expected: Token exported, secrets injected.

**Step 5: Commit**

```bash
git add devenv.nix
git commit -m "feat: migrate to 1Password for secrets injection"
```

---

## Task 5: Update devenv.yaml for unfree packages

**Files:**
- Modify: `/home/dev/projects/claude-code-remote/devenv.yaml`

**Step 1: Add allowUnfree configuration**

```yaml
inputs:
  nixpkgs:
    url: github:NixOS/nixpkgs/nixos-unstable

allowUnfree: true

secretspec:
  enable: true
  provider: keyring
  profile: default
```

**Step 2: Test direnv reload**

```bash
direnv reload
which op
```

Expected: op CLI available at nix store path.

**Step 3: Commit**

```bash
git add devenv.yaml
git commit -m "chore: allow unfree packages for 1Password CLI"
```

---

## Task 6: Clean up deprecated sops-nix secrets

**Files:**
- Modify: `~/projects/workstation/secrets/devbox.yaml`
- Modify: `~/projects/workstation/hosts/devbox/configuration.nix`

**Step 1: Remove old CCR secrets from sops file**

```bash
cd ~/projects/workstation
sops secrets/devbox.yaml
```

Remove these keys (keep op_service_account_token):
- `ccr_api_key`
- `telegram_bot_token`
- `telegram_webhook_secret`
- `telegram_webhook_path_secret`

**Step 2: Remove old secret paths from NixOS config**

In `hosts/devbox/configuration.nix`, remove from `sops.secrets`:
```nix
# Remove these lines:
ccr_api_key = { ... };
telegram_bot_token = { ... };
telegram_webhook_secret = { ... };
telegram_webhook_path_secret = { ... };
```

Keep only:
```nix
op_service_account_token = { owner = "dev"; group = "dev"; mode = "0400"; };
```

**Step 3: Rebuild NixOS**

```bash
sudo nixos-rebuild switch --flake .#devbox
```

**Step 4: Verify old secrets are gone**

```bash
ls /run/secrets/
```

Expected: Only `op_service_account_token` (and any other non-CCR secrets).

**Step 5: Commit**

```bash
git add secrets/devbox.yaml hosts/devbox/configuration.nix
git commit -m "chore: remove deprecated CCR secrets from sops-nix"
```

---

## Task 7: Update devenv.local.yaml for devbox

**Files:**
- Modify: `/home/dev/projects/claude-code-remote/devenv.local.yaml`

**Step 1: Simplify devenv.local.yaml**

The file currently disables secretspec. With 1Password, we might keep or remove secretspec entirely. For now, keep it simple:

```yaml
# Machine-specific override for devbox (headless NixOS)
# Using 1Password service account for secrets (via OP_SERVICE_ACCOUNT_TOKEN)
secretspec:
  enable: false
```

**Step 2: Test full flow**

```bash
cd ~/projects/claude-code-remote
direnv reload
op run --env-file=.env.1password -- npm run webhooks:log
```

Expected: Webhook server starts with all secrets injected.

**Step 3: Commit (if changed)**

```bash
git add devenv.local.yaml
git commit -m "docs: update devenv.local.yaml comment for 1Password"
```

---

## Task 8: Update documentation

**Files:**
- Modify: `/home/dev/projects/claude-code-remote/CLAUDE.md`
- Modify: `/home/dev/projects/claude-code-remote/.claude/skills/configuring-notifications/SKILL.md`
- Modify: `/home/dev/projects/claude-code-remote/.claude/skills/machine-setup/SKILL.md`
- Modify: `/home/dev/projects/claude-code-remote/.claude/skills/security/SKILL.md`

**Step 1: Update CLAUDE.md Quick Start**

Update the Quick Start section:

```markdown
## Quick Start

```bash
npm install
npm run setup        # Configure Telegram, set up hooks

# Start services (requires 1Password CLI configured)
op run --env-file=.env.1password -- npm run webhooks:log
```
```

**Step 2: Update configuring-notifications skill**

Add 1Password setup section, update startup commands.

**Step 3: Update machine-setup skill**

Add steps for:
- Installing 1Password CLI
- Configuring service account token (devbox: sops-nix, macOS: env or desktop app)

**Step 4: Update security skill**

Document the new architecture:
- Single bootstrap secret (OP_SERVICE_ACCOUNT_TOKEN) in sops-nix
- All app secrets in 1Password Automation vault
- Service account scoped to Automation vault only

**Step 5: Commit**

```bash
git add CLAUDE.md .claude/skills/
git commit -m "docs: update for 1Password secrets management"
```

---

## Task 9: Optional - Remove secretspec.toml

**Files:**
- Delete: `/home/dev/projects/claude-code-remote/secretspec.toml`
- Modify: `/home/dev/projects/claude-code-remote/devenv.yaml`

**Decision point:** SecretSpec is no longer needed if using 1Password everywhere. However, keeping it provides:
- Documentation of what secrets exist
- Fallback for macOS users who prefer Keychain

**If removing:**

```bash
rm secretspec.toml
```

Update devenv.yaml:
```yaml
inputs:
  nixpkgs:
    url: github:NixOS/nixpkgs/nixos-unstable

allowUnfree: true
# secretspec removed - using 1Password
```

**If keeping:** Update secretspec.toml comment:
```toml
# Note: Primary secrets management is via 1Password
# This file documents secrets and provides Keychain fallback for macOS
```

**Step: Commit**

```bash
git add -A
git commit -m "chore: remove secretspec (using 1Password) OR docs: note 1Password as primary"
```

---

## Task 10: End-to-end verification

**Step 1: Fresh shell test on devbox**

```bash
cd ~/projects/claude-code-remote
direnv reload

# Verify OP token is set
[ -n "$OP_SERVICE_ACCOUNT_TOKEN" ] && echo "✓ Token exported" || echo "✗ Token missing"

# Verify op CLI works
op whoami

# Verify secrets injection
op run --env-file=.env.1password -- env | grep -E "CCR_API_KEY|TELEGRAM_BOT_TOKEN"

# Start webhook server
op run --env-file=.env.1password -- npm run webhooks:log
```

**Step 2: Send test notification**

In another terminal:
```bash
cd ~/projects/claude-code-remote
op run --env-file=.env.1password -- npm run notify:test
```

Expected: Telegram notification received.

**Step 3: Document any issues**

If any steps fail, document and fix before marking complete.

---

## Summary

After completing all tasks:

| Before | After |
|--------|-------|
| 4 secrets in sops-nix | 1 secret in sops-nix |
| Different commands per platform | Same command everywhere |
| Secrets scattered | Secrets centralized in 1Password |
| ccr-start wrapper script | Direct op run |
| secretspec for macOS | 1Password for all |

**Single command everywhere:**
```bash
op run --env-file=.env.1password -- npm run webhooks:log
```

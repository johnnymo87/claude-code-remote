---
name: security
description: Use when you need to understand CCR's secret management architecture, token flow, or security model
---

# Security Architecture

## Secret Management Overview

CCR uses **1Password** as the single source of truth for secrets, with a service account for headless access.

```
1Password (Automation vault)
  └── ccr-secrets item
       ├── CCR_API_KEY
       ├── TELEGRAM_BOT_TOKEN
       ├── TELEGRAM_WEBHOOK_SECRET
       └── TELEGRAM_WEBHOOK_PATH_SECRET

sops-nix (bootstrap only)
  └── OP_SERVICE_ACCOUNT_TOKEN

Cloudflare Worker
  └── Secrets set via wrangler secret put
```

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Cloudflare Worker                        │
│  Secrets set via: wrangler secret put                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ CCR_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET││
│  └─────────────────────────────────────────────────────────┘│
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket (API key in subprotocol)
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
        ▼                                     ▼
┌───────────────────┐                ┌───────────────────┐
│     Devbox        │                │      macOS        │
│                   │                │                   │
│  sops-nix         │                │  1Password app    │
│  ↓                │                │  or service acct  │
│  OP_SERVICE_ACCT  │                │                   │
│  ↓                │                │                   │
│  op run           │                │  op run           │
│  ↓                │                │  ↓                │
│  1Password        │                │  1Password        │
└───────────────────┘                └───────────────────┘
```

## Secrets Inventory

| Secret | Purpose | Locations |
|--------|---------|-----------|
| `CCR_API_KEY` | Authenticates Machine Agent ↔ Worker | 1Password + Worker |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API access | 1Password + Worker |
| `TELEGRAM_WEBHOOK_SECRET` | Validates webhook requests from Telegram | 1Password + Worker |
| `TELEGRAM_WEBHOOK_PATH_SECRET` | URL obfuscation for webhook endpoint | 1Password |
| `OP_SERVICE_ACCOUNT_TOKEN` | 1Password service account auth | sops-nix (devbox) |
| `CLOUDFLARE_API_TOKEN` | Wrangler deploys to Worker | sops-nix (devbox) |

## Authentication Points

1. **Machine Agent → Worker**: `CCR_API_KEY` sent via WebSocket subprotocol header
2. **Telegram → Worker**: `TELEGRAM_WEBHOOK_SECRET` in `X-Telegram-Bot-Api-Secret-Token` header
3. **Worker → Telegram API**: `TELEGRAM_BOT_TOKEN` in API calls
4. **op CLI → 1Password**: `OP_SERVICE_ACCOUNT_TOKEN` (service account auth)
5. **Wrangler → Cloudflare**: `CLOUDFLARE_API_TOKEN`

## 1Password Setup

### Service Account

The service account provides headless access without browser auth:

- **Vault**: Automation (not Personal/Private - those can't be shared with service accounts)
- **Item**: ccr-secrets
- **Token**: Stored in sops-nix, exported as `OP_SERVICE_ACCOUNT_TOKEN`

### .env.1password

References secrets using 1Password URI format:

```bash
CCR_API_KEY=op://Automation/ccr-secrets/CCR_API_KEY
TELEGRAM_BOT_TOKEN=op://Automation/ccr-secrets/TELEGRAM_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET=op://Automation/ccr-secrets/TELEGRAM_WEBHOOK_SECRET
TELEGRAM_WEBHOOK_PATH_SECRET=op://Automation/ccr-secrets/TELEGRAM_WEBHOOK_PATH_SECRET
```

### Usage

```bash
# devenv automatically exports OP_SERVICE_ACCOUNT_TOKEN
op run --env-file=.env.1password -- npm run webhooks:log
```

## Platform-Specific Configuration

### Devbox (Headless NixOS)

**Bootstrap**: sops-nix decrypts `OP_SERVICE_ACCOUNT_TOKEN` to `/run/secrets/`

**devenv.nix** exports the token on shell entry:
```nix
enterShell = ''
  if [ -f /run/secrets/op_service_account_token ]; then
    export OP_SERVICE_ACCOUNT_TOKEN="$(< /run/secrets/op_service_account_token)"
  fi
'';
```

**Files:**
- `~/projects/workstation/secrets/devbox.yaml` - sops-encrypted token
- `~/projects/workstation/hosts/devbox/configuration.nix` - Declares sops.secrets

### macOS

Options:
1. **Service account** (same as devbox): Export `OP_SERVICE_ACCOUNT_TOKEN`
2. **Desktop app**: `op` CLI uses 1Password app for auth (interactive)

### Cloudflare Worker

**Storage:** Cloudflare secrets (encrypted at rest)

**How to set:**
```bash
export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"
echo "<value>" | wrangler secret put CCR_API_KEY
```

**Important:** Never use `[vars]` in wrangler.toml for secrets.

## Key Principles

1. **One source of truth** - 1Password Automation vault
2. **One bootstrap secret** - OP_SERVICE_ACCOUNT_TOKEN in sops-nix
3. **Same command everywhere** - `op run --env-file=.env.1password -- <cmd>`
4. **No secrets in git** - Not in `.env`, not in code, not in docs
5. **Secrets vs vars in Worker** - Always use `wrangler secret put`, never `[vars]`
6. **Rotate immediately if leaked** - See operations skill for procedure

---
name: security
description: Use when you need to understand CCR's secret management architecture, token flow, or security model
---

# Security Architecture

## Secret Management Overview

CCR uses **devenv SecretSpec** for declarative secrets management with platform-native storage.

```
secretspec.toml (in CCR repo)
    │
    ├── Defines WHAT secrets exist
    │   └── CCR_API_KEY, TELEGRAM_BOT_TOKEN, etc.
    │
    └── Each machine provides WHERE via native storage
        ├── Devbox (headless NixOS): sops-nix → /run/secrets/* → env provider
        ├── macOS: Keychain → keyring provider
        └── Worker: Cloudflare secrets (wrangler secret put)
```

### Why Different Providers?

Devbox is headless NixOS without `org.freedesktop.secrets` D-Bus service (required by keyring provider). Instead, sops-nix decrypts secrets at boot to `/run/secrets/*`, and the `ccr-start` script injects them as environment variables.

macOS has Keychain which SecretSpec's keyring provider supports natively.

## Secrets Inventory

| Secret | Purpose | Locations |
|--------|---------|-----------|
| `CCR_API_KEY` | Authenticates Machine Agent ↔ Worker | All machines + Worker |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API access | All machines + Worker |
| `TELEGRAM_WEBHOOK_SECRET` | Validates webhook requests from Telegram | All machines + Worker |
| `TELEGRAM_WEBHOOK_PATH_SECRET` | URL obfuscation for webhook endpoint | All machines |
| `CLOUDFLARE_API_TOKEN` | Wrangler deploys to Worker | Devbox only (sops-nix) |

## Secret Flow

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
│  secretspec.toml  │                │  secretspec.toml  │
│        +          │                │        +          │
│  sops-nix         │                │  Keychain         │
│  /run/secrets/*   │                │  (keyring provider)│
│  (env provider)   │                │                   │
└───────────────────┘                └───────────────────┘
```

## Authentication Points

1. **Machine Agent → Worker**: `CCR_API_KEY` sent via WebSocket subprotocol header
2. **Telegram → Worker**: `TELEGRAM_WEBHOOK_SECRET` in `X-Telegram-Bot-Api-Secret-Token` header
3. **Worker → Telegram API**: `TELEGRAM_BOT_TOKEN` in API calls
4. **Wrangler → Cloudflare**: `CLOUDFLARE_API_TOKEN` (devbox only, via sops-nix)

## SecretSpec Configuration

Secrets are defined in `secretspec.toml` at the CCR repo root:

```toml
[project]
name = "claude-code-remote"

[profiles.default]
# Secrets (no defaults - must be provided)
CCR_API_KEY = { description = "Shared key for Worker auth", required = true }
TELEGRAM_BOT_TOKEN = { description = "From @BotFather", required = true }
TELEGRAM_WEBHOOK_SECRET = { description = "Webhook validation", required = true }
TELEGRAM_WEBHOOK_PATH_SECRET = { description = "URL obfuscation", required = true }

# Config with defaults
TELEGRAM_CHAT_ID = { default = "8248645256" }
CCR_WORKER_URL = { default = "https://ccr-router.jonathan-mohrbacher.workers.dev" }
LOG_LEVEL = { default = "info" }
```

## Platform-Specific Storage

### Devbox (Headless NixOS)

**Storage:** sops-nix (age-encrypted in workstation repo, decrypted at boot)

**Location:** `/run/secrets/<secret_name>`

**Provider:** `env` (via `devenv.local.yaml` override)

**How it works:**
1. Secrets defined in `~/projects/workstation/secrets/devbox.yaml` (sops-encrypted)
2. NixOS decrypts to `/run/secrets/*` at boot
3. `ccr-start` script reads files and injects as env vars
4. SecretSpec validates via `env` provider

**Files:**
- `~/projects/workstation/secrets/devbox.yaml` - Encrypted secrets
- `~/projects/workstation/hosts/devbox/configuration.nix` - Declares sops.secrets
- `devenv.local.yaml` - Sets `provider: env` (gitignored)

### macOS

**Storage:** Keychain

**Provider:** `keyring` (default in `devenv.yaml`)

**How it works:**
1. Secrets stored via `security add-generic-password -s secretspec -a <NAME> -w <VALUE>`
2. `secretspec run -- <cmd>` reads from Keychain
3. SecretSpec injects as env vars for the process

### Cloudflare Worker

**Storage:** Cloudflare secrets (encrypted at rest)

**How to set:**
```bash
export CLOUDFLARE_API_TOKEN="$(cat /run/secrets/cloudflare_api_token)"
echo "<value>" | wrangler secret put CCR_API_KEY
```

**Important:** Never use `[vars]` in wrangler.toml for secrets.

## Key Principles

1. **No secrets in git** - Not in `.env`, not in code, not in docs
2. **No `.env` files** - Use SecretSpec + platform-native storage
3. **Secrets vs vars in Worker** - Always use `wrangler secret put`, never `[vars]`
4. **Rotate immediately if leaked** - See operations skill for procedure

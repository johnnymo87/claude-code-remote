---
name: hooks
description: Use when debugging Claude Code hooks, understanding the SessionStart/Stop flow, or setting up hooks on a new machine
---

# Claude Code Hooks

## Overview

Claude Code hooks are shell scripts that run at specific lifecycle events. CCR uses two hooks:

| Hook | Event | Purpose |
|------|-------|---------|
| `SessionStart` | Session starts, resumes, or compacts | Register session with daemon, create runtime files |
| `Stop` | Claude stops (task complete, needs input) | Send Telegram notification if opted in |


## How It Works

```
┌─────────────────────┐
│   Claude Session    │
│                     │
│  User sends message │
│         │           │
│         ▼           │
│  Claude processes   │
│         │           │
│         ▼           │
│  Claude stops       │──────▶ Stop hook fires
│                     │              │
└─────────────────────┘              ▼
                              ┌──────────────────┐
                              │ on-stop.sh       │
                              │                  │
                              │ 1. Find session  │
                              │ 2. Check opt-in  │
                              │ 3. Extract msg   │
                              │ 4. POST /stop    │
                              └────────┬─────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │ Webhook Server   │
                              │                  │
                              │ Send to Telegram │
                              └──────────────────┘
```

## Hook Scripts

### on-session-start.sh

**Triggered:** When session starts, resumes from compact, or restarts

**Input:** JSON on stdin with `session_id`, `transcript_path`

**Actions:**
1. Creates `~/.claude/runtime/sessions/<session_id>/` directory
2. Stores transcript path, PPID, tmux info
3. Creates lookup maps (ppid-map, pane-map) for command routing
4. Notifies webhook daemon via POST to `localhost:4731/session-start`

### on-stop.sh

**Triggered:** When Claude stops (NOT on user interrupt/Ctrl+C)

**Input:** JSON on stdin with `session_id`, `transcript_path`

**Actions:**
1. Resolves session ID (from input or fallback maps)
2. Checks if session opted into notifications (`notify_label` file)
3. Extracts last assistant message from transcript
4. Sends notification via POST to `localhost:4731/stop`

## Deployment Methods

### NixOS/home-manager (Recommended for devbox)

Hooks are managed in the workstation repo:

```
workstation/
├── assets/claude/hooks/
│   ├── on-session-start.sh   # Raw scripts
│   └── on-stop.sh
└── users/dev/claude-hooks.nix  # Nix wrapper module
```

The `claude-hooks.nix` module:
1. Wraps scripts with `writeShellApplication` for consistent PATH
2. Includes `jq`, `curl`, `coreutils` (provides `tac` on macOS)
3. Deploys to `~/.claude/hooks/`
4. Adds hooks config to `managedSettings` → merged into `settings.json`

Apply with:
```bash
home-manager switch --flake .#dev
```

### Manual Setup

1. Copy hook scripts to `~/.claude/hooks/`
2. Make executable: `chmod +x ~/.claude/hooks/*.sh`
3. Add to `~/.claude/settings.json`:
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

## Opting Into Notifications

Hooks only send notifications if the session has opted in. To opt in:

```bash
# In Claude session
/notify-telegram my-project-label
```

This creates `~/.claude/runtime/sessions/<session_id>/notify_label` containing the label.

## Debugging

### Check if hooks are configured

```bash
jq '.hooks' ~/.claude/settings.json
```

### Test session-start hook manually

```bash
echo '{"session_id":"test-123","transcript_path":"/tmp/test.jsonl"}' | ~/.claude/hooks/on-session-start.sh
ls ~/.claude/runtime/sessions/test-123/
# Should show: ppid, transcript_path
```

### Check webhook daemon received session

```bash
curl -s http://localhost:4731/sessions | jq '.sessions[] | {session_id, label}'
```

### Hook not firing?

1. Check `~/.claude/settings.json` has hooks configured
2. Restart Claude session (hooks load on start)
3. Check Claude Code version supports hooks
### Check on-stop.sh debug probe

The Stop hook logs checkpoints to `~/.claude/runtime/hook-debug/stop.*.log`:

```bash
ls -lt ~/.claude/runtime/hook-debug/ | head -5
cat "$(ls -t ~/.claude/runtime/hook-debug/stop.*.log | head -1)"
```

Each log traces: `session_id` → `label` → `transcript` → `message` → `payload` → `curl_done`. Missing checkpoints indicate where the script exited.

### Notification not sending?

1. Check `notify_label` exists:
   ```bash
   cat ~/.claude/runtime/sessions/<session_id>/notify_label
   ```
2. Check webhook server is running:
   ```bash
   curl -s http://localhost:4731/health
   ```
3. Check daemon log for errors:
   ```bash
   tail -50 ~/.local/state/claude-code-remote/daemon.log
   ```

## Dependencies

The hook scripts require:
- `jq` - JSON parsing
- `curl` - HTTP requests
- `coreutils` - `tac` for reverse file reading (on macOS via Nix)

On NixOS/home-manager, these are injected via `writeShellApplication` wrapper.
On other systems, ensure they're in PATH.

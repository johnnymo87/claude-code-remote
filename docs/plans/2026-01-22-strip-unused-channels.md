# Strip Unused Channels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove all code not related to Telegram + Cloudflare Worker routing, reducing codebase from ~10,800 lines to ~3,000-4,000 lines.

**Architecture:** Keep only: Telegram channel, Machine Agent (Worker client), session registry, event routes, hook notification. Remove: Email, LINE, Desktop channels, PTY/tmux injection, automation, conversation tracking, daemon mode.

**Tech Stack:** Node.js, Express, SQLite (better-sqlite3), WebSocket (ws), axios

---

## Phase 1: Remove Unused Channel Implementations

### Task 1: Remove Email Channel

**Files:**
- Delete: `src/channels/email/smtp.js`
- Delete: `src/channels/email/smtp.js.backup` (if exists)
- Delete: `src/relay/email-listener.js`
- Delete: `config/email-template.json`

**Step 1: Delete email channel files**

```bash
rm -f src/channels/email/smtp.js src/channels/email/smtp.js.backup
rm -f src/relay/email-listener.js
rm -f config/email-template.json
rmdir src/channels/email 2>/dev/null || true
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: remove email channel"
```

---

### Task 2: Remove LINE Channel

**Files:**
- Delete: `src/channels/line/line.js`
- Delete: `src/channels/line/webhook.js`
- Delete: `start-line-webhook.js`

**Step 1: Delete LINE channel files**

```bash
rm -f src/channels/line/line.js src/channels/line/webhook.js
rmdir src/channels/line 2>/dev/null || true
rm -f start-line-webhook.js
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: remove LINE channel"
```

---

### Task 3: Remove Desktop Channel

**Files:**
- Delete: `src/channels/local/desktop.js`

**Step 1: Delete desktop channel files**

```bash
rm -f src/channels/local/desktop.js
rmdir src/channels/local 2>/dev/null || true
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: remove desktop channel"
```

---

## Phase 2: Remove Unused Relay/Injection Code

### Task 4: Remove PTY Relay

**Files:**
- Delete: `src/relay/relay-pty.js`
- Delete: `start-relay-pty.js`

**Step 1: Delete PTY relay files**

```bash
rm -f src/relay/relay-pty.js
rm -f start-relay-pty.js
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: remove PTY relay"
```

---

### Task 5: Remove Tmux/Smart Injection

**Files:**
- Delete: `src/relay/tmux-injector.js`
- Delete: `src/relay/smart-injector.js`
- Delete: `src/relay/injector-registry.js`
- Delete: `src/relay/claude-command-bridge.js`
- Delete: `src/relay/command-relay.js`

**Step 1: Delete injection files**

```bash
rm -f src/relay/tmux-injector.js
rm -f src/relay/smart-injector.js
rm -f src/relay/injector-registry.js
rm -f src/relay/claude-command-bridge.js
rm -f src/relay/command-relay.js
rmdir src/relay 2>/dev/null || true
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: remove tmux/smart injection"
```

---

## Phase 3: Remove Unused Utilities

### Task 6: Remove Automation Modules

**Files:**
- Delete: `src/automation/claude-automation.js`
- Delete: `src/automation/simple-automation.js`
- Delete: `src/automation/clipboard-automation.js`

**Step 1: Delete automation files**

```bash
rm -rf src/automation
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: remove automation modules"
```

---

### Task 7: Remove Tracking Utilities

**Files:**
- Delete: `src/utils/conversation-tracker.js`
- Delete: `src/utils/subagent-tracker.js`
- Delete: `src/utils/tmux-monitor.js`
- Delete: `src/utils/trace-capture.js`
- Delete: `src/utils/controller-injector.js`

**Step 1: Delete tracking utility files**

```bash
rm -f src/utils/conversation-tracker.js
rm -f src/utils/subagent-tracker.js
rm -f src/utils/tmux-monitor.js
rm -f src/utils/trace-capture.js
rm -f src/utils/controller-injector.js
rmdir src/utils 2>/dev/null || true
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: remove tracking utilities"
```

---

### Task 8: Remove Daemon Mode

**Files:**
- Delete: `src/daemon/taskping-daemon.js`

**Step 1: Delete daemon files**

```bash
rm -rf src/daemon
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: remove daemon mode"
```

---

## Phase 4: Remove Test Scripts

### Task 9: Remove Test Scripts

**Files:**
- Delete: `test-injection.js`
- Delete: `test-nvim-injection.js`
- Delete: `test-telegram-notification.js`
- Delete: `test-long-email.js`
- Delete: `test-real-notification.js`
- Delete: `smart-monitor.js`
- Delete: `config/test-with-subagent.json`

**Step 1: Delete test scripts**

```bash
rm -f test-injection.js test-nvim-injection.js test-telegram-notification.js
rm -f test-long-email.js test-real-notification.js smart-monitor.js
rm -f config/test-with-subagent.json
```

**Step 2: Commit**

```bash
git add -A && git commit -m "chore: remove test scripts"
```

---

## Phase 5: Clean Up Core Files

### Task 10: Simplify Notifier

**Files:**
- Modify: `src/core/notifier.js`

**Step 1: Read current notifier.js**

Read the file to understand what channels it loads.

**Step 2: Remove non-Telegram channel loading**

Edit to only load Telegram channel, remove Email/LINE/Desktop imports and initialization.

**Step 3: Commit**

```bash
git add src/core/notifier.js && git commit -m "refactor: notifier only loads telegram"
```

---

### Task 11: Simplify Config

**Files:**
- Modify: `src/core/config.js`

**Step 1: Read current config.js**

Read to see what channel configs it loads.

**Step 2: Remove non-Telegram config handling**

Remove Email/LINE/Desktop config sections.

**Step 3: Commit**

```bash
git add src/core/config.js && git commit -m "refactor: config only handles telegram"
```

---

### Task 12: Simplify Main CLI (claude-remote.js)

**Files:**
- Modify: `claude-remote.js`

**Step 1: Read current claude-remote.js**

Read to understand all commands it supports.

**Step 2: Remove unused commands**

Remove: relay, daemon, setup-email, setup-line, and any other non-Telegram commands.

**Step 3: Commit**

```bash
git add claude-remote.js && git commit -m "refactor: CLI only supports telegram commands"
```

---

### Task 13: Simplify Setup Script

**Files:**
- Modify: `setup.js`

**Step 1: Read current setup.js**

Read to understand what it configures.

**Step 2: Remove Email/LINE setup flows**

Remove all Email and LINE setup prompts and configuration.

**Step 3: Commit**

```bash
git add setup.js && git commit -m "refactor: setup only configures telegram"
```

---

### Task 14: Simplify start-all-webhooks.js

**Files:**
- Modify: `start-all-webhooks.js`

**Step 1: Read current file**

Read to see what webhooks it starts.

**Step 2: Remove LINE/Email daemon spawning**

Only start Telegram webhook (or just rename to start-telegram.js and delete this file).

**Step 3: Commit**

```bash
git add start-all-webhooks.js && git commit -m "refactor: only start telegram webhook"
```

---

## Phase 6: Clean Up Config Files

### Task 15: Simplify channels.json

**Files:**
- Modify: `config/channels.json`

**Step 1: Read current channels.json**

**Step 2: Remove non-Telegram channel definitions**

Keep only telegram channel config.

**Step 3: Commit**

```bash
git add config/channels.json && git commit -m "refactor: channels.json telegram only"
```

---

### Task 16: Simplify default.json

**Files:**
- Modify: `config/default.json`

**Step 1: Read current default.json**

**Step 2: Remove non-Telegram defaults**

Remove Email/LINE/Desktop defaults, relay settings if unused.

**Step 3: Commit**

```bash
git add config/default.json && git commit -m "refactor: default.json telegram only"
```

---

### Task 17: Clean Up Config Defaults Directory

**Files:**
- Modify or delete: `config/defaults/config.json`
- Modify or delete: `config/defaults/claude-hooks.json`
- Delete: `config/defaults/i18n.json` (if only Chinese translations for unused features)

**Step 1: Review defaults directory**

Check what's needed vs cruft.

**Step 2: Simplify or delete**

**Step 3: Commit**

```bash
git add config/defaults && git commit -m "refactor: simplify config defaults"
```

---

## Phase 7: Clean Up .env and Documentation

### Task 18: Create Minimal .env.example

**Files:**
- Modify: `.env.example`

**Step 1: Read current .env.example**

**Step 2: Create minimal version**

Only Telegram + Worker config:

```bash
# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_WEBHOOK_PORT=4731
TELEGRAM_WEBHOOK_SECRET=
TELEGRAM_DROP_PENDING_UPDATES=true

# Cloudflare Worker routing
CCR_WORKER_URL=
CCR_MACHINE_ID=

# System
LOG_LEVEL=info
```

**Step 3: Commit**

```bash
git add .env.example && git commit -m "docs: minimal .env.example for telegram+worker"
```

---

### Task 19: Update Package.json Scripts

**Files:**
- Modify: `package.json`

**Step 1: Read current package.json**

**Step 2: Remove unused scripts**

Remove: relay:*, line, daemon:*, config commands. Keep: setup, telegram, webhooks, webhooks:log.

**Step 3: Remove unused dependencies**

Remove: imapflow, mailparser, node-imap, nodemailer, node-pty (if not needed).

**Step 4: Commit**

```bash
git add package.json && git commit -m "refactor: package.json minimal scripts and deps"
```

---

### Task 20: Update CLAUDE.md Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Read current CLAUDE.md**

**Step 2: Simplify for telegram+worker only**

Remove Email/LINE/Desktop documentation, simplify setup instructions.

**Step 3: Commit**

```bash
git add CLAUDE.md && git commit -m "docs: CLAUDE.md for telegram+worker only"
```

---

### Task 21: Update README.md

**Files:**
- Modify: `README.md`

**Step 1: Update README to reflect stripped-down scope**

Remove mentions of Email, LINE, Desktop. Focus on Telegram + multi-machine routing.

**Step 2: Commit**

```bash
git add README.md && git commit -m "docs: README.md for telegram+worker only"
```

---

## Phase 8: Clean Up Skills and Commands

### Task 22: Review and Clean .claude/ Directory

**Files:**
- Review: `.claude/skills/`
- Review: `.claude/commands/`

**Step 1: List all skills and commands**

```bash
find .claude -name "*.md" -type f
```

**Step 2: Remove or update skills that reference removed features**

Remove Email/LINE setup skills, update troubleshooting to remove Email/LINE sections.

**Step 3: Commit**

```bash
git add .claude && git commit -m "docs: clean up skills for telegram+worker only"
```

---

## Phase 9: Final Verification

### Task 23: Run npm install and verify

**Step 1: Remove node_modules and reinstall**

```bash
rm -rf node_modules package-lock.json
npm install
```

**Step 2: Verify no missing dependencies**

**Step 3: Commit package-lock.json if changed**

```bash
git add package-lock.json && git commit -m "chore: update package-lock after dep cleanup"
```

---

### Task 24: Test Telegram Webhook Starts

**Step 1: Start webhook**

```bash
npm run telegram
```

**Step 2: Verify it starts without errors**

Check logs for successful startup and Worker connection.

**Step 3: Test a notification if possible**

---

### Task 25: Final Line Count Comparison

**Step 1: Count lines before/after**

```bash
find src -name "*.js" | xargs wc -l
```

**Step 2: Document reduction achieved**

Should be ~60% reduction from ~10,800 to ~4,000 lines.

---

## Summary

**Removed:**
- Email channel (~1000 LOC)
- LINE channel (~300 LOC)
- Desktop notifications (~100 LOC)
- PTY/Tmux injection (~2000 LOC)
- Automation modules (~900 LOC)
- Tracking utilities (~900 LOC)
- Daemon mode (~300 LOC)
- Test scripts (~1000 LOC)

**Kept:**
- Telegram channel + webhook
- Machine Agent (Worker client)
- Session registry + token validation
- Event routes
- Hook notification
- Minimal config system

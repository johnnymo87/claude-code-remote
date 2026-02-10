# Plan: OpenCode Plugin (`ccr-opencode-plugin`)

> **Status: ✅ COMPLETE** (2026-02-10)
>
> Implemented as [opencode-pigeon](https://github.com/johnnymo87/opencode-pigeon) — 114 tests, deployed via workstation Nix config.
>
> **Intentional divergences from plan:**
> - **Approach A (plugin-only) instead of Approach C (hybrid):** The plugin handles registration, idle detection, and message capture entirely in-process. No daemon SSE subscriber (Component 2) was needed — the plugin posts directly to the existing `/session-start` and `/stop` endpoints. Simpler, one component instead of two.
> - **Local repo instead of npm package:** Distributed as a git repo (`opencode-pigeon`) loaded via `mkOutOfStoreSymlink` in `opencode-config.nix`, not published to npm. Appropriate for a single-user setup.
> - **Cross-platform TTY detection added:** Plan only mentioned Linux `/proc` readlink. Implementation added macOS support via `lsof -p <pid> -a -d 0 -Fn` with parent PID fallback on both platforms.

**Priority:** Highest — migration-critical
**Dependencies:** None (greenfield)
**Related plans:** All other plans benefit from this but none block it

---

## Context

### The Current System

Claude Code Remote (CCR) notifies users via Telegram when Claude Code finishes a task, and lets them reply to inject commands back into the running session. The current integration with Claude Code uses **shell hooks** — two bash scripts that fire on lifecycle events:

1. **SessionStart hook** (`on-session-start.sh`): Fires when CC starts or compacts. Detects the environment (nvim socket, tmux pane, PTY path), auto-enables notifications, and registers the session with the daemon via `POST http://127.0.0.1:4731/session-start`.

2. **Stop hook** (`on-stop.sh`): Fires when CC completes a turn. Sleeps 0.2s (waiting for CC to flush transcript to disk), extracts the last assistant message by parsing the transcript JSONL (`tail -n 3000 | tac | jq`), resolves the session ID via a 4-layer fallback, and posts everything to `POST http://127.0.0.1:4731/stop`.

These hooks are plain bash scripts wrapped by Nix (`writeShellApplication`) to guarantee `jq`, `curl`, and `coreutils` are in PATH. They're deployed to `~/.claude/hooks/` by home-manager.

### The Problem

The user is migrating from Claude Code to **OpenCode** — an open-source AI coding agent built as a Bun/TypeScript monorepo. OpenCode has a fundamentally different and more powerful extensibility model:

- **30+ typed events** via SSE stream at `GET /event` (vs CC's 2 shell hooks)
- **TypeScript plugin system** where plugins receive a full SDK client (vs JSON-on-stdin for shell scripts)
- **`session.status` event** with idle/busy/retry states (vs no idle detection in CC)
- **`message.updated` events** with full content (vs parsing transcript JSONL files)
- **HTTP API** at `localhost:4096` for querying sessions, messages, status

The current CC hooks have several hacks that OpenCode's model eliminates:
- The **0.2s sleep** waiting for CC to flush transcript to disk
- **Transcript JSONL parsing** (`tail | tac | jq`) to extract the last assistant message
- **Process-alive polling** via `/proc` reads every 60s to detect dead sessions
- **4-layer session ID resolution fallback** (session dir → ppid-map → pane-map → legacy)

### What the Architecture Review Found

An architecture review compared CCR against openclaw (21-channel gateway), open-dispatch (chat-to-CLI relay), and the opencode ecosystem. Key findings relevant to this plan:

1. **OpenCode's plugin model** is described in `packages/opencode/src/plugin/`. Plugins are TypeScript functions returning a `Hooks` object with 15+ hook points including `event` (all bus events), `chat.message`, `tool.execute.before/after`, and `permission.ask`.

2. **Plugins receive rich context**: `{ client, project, directory, worktree, serverUrl, $ }` — the `client` is a full SDK client that can call any server API.

3. **oh-my-opencode** (the user's installed OpenCode framework) has a `detectExternalNotificationPlugin()` function that checks if another plugin with "notification" in its name is loaded, and defers to it. It also has a `force_enable` config to override. The plugin should integrate with this mechanism.

4. **OpenCode ships a reference Slack bot** in `packages/slack/` that demonstrates the SSE subscription pattern: `opencode.client.event.subscribe()`.

5. Three migration approaches were identified:
   - **Approach A (Plugin-only):** In-process plugin handles everything
   - **Approach B (External SSE subscriber):** Daemon subscribes to SSE stream directly
   - **Approach C (Hybrid — recommended):** Thin plugin for registration + daemon subscribes to SSE for events

### Why Hybrid (Approach C)

- Plugin handles session registration at startup (replaces SessionStart hook)
- Plugin can detect environment (nvim, tmux, PTY) using the Bun shell `$` context
- Daemon subscribes to SSE `/event` endpoint for `session.idle` and `message.updated` events
- Message content comes from SSE stream — no transcript parsing needed
- Session status comes from `session.status` events — no process-alive polling needed
- Daemon's existing infrastructure (Telegram sending, Worker communication, command injection) stays unchanged

---

## Proposed Approach

### Component 1: The OpenCode Plugin

A TypeScript plugin published as an npm package (or local `file://` reference) that:

1. **On load**: Registers with the CCR daemon via `POST /session-start` with environment context
2. **Detects environment**: Uses Bun shell `$` to detect nvim socket, tmux session/pane, PTY path
3. **Exposes config**: Plugin reads CCR daemon URL from oh-my-opencode config or env var
4. **Integrates with oh-my-opencode**: Named to trigger `detectExternalNotificationPlugin()` (e.g., `ccr-notification-plugin` or `opencode-ccr-notifications`)
5. **Optionally subscribes to events in-process**: Could handle `session.idle` directly instead of the daemon subscribing to SSE

### Component 2: Daemon SSE Subscriber (if hybrid)

The daemon gains a new module that:

1. **Connects to OpenCode's SSE endpoint**: `GET http://localhost:4096/event?directory=<project>`
2. **Filters for relevant events**: `session.status` (idle detection), `message.updated` (content extraction)
3. **Replaces stop-hook logic**: When session goes idle + last message is from assistant, triggers the same notification flow as the current `/stop` endpoint
4. **Auto-reconnects**: SSE connections can drop; needs exponential backoff reconnection

### Component 3: Workstation Deployment

- New Nix module to deploy the plugin config to `.opencode/plugins/` or `opencode.json`
- Plugin config in `opencode-config.nix` (already has oh-my-opencode plugin configured)
- CC hooks remain for backward compatibility until migration is complete

---

## Key Files to Study

| File | Repo | Why |
|------|------|-----|
| `assets/claude/hooks/on-session-start.sh` | workstation | Current SessionStart hook — the plugin replaces this |
| `assets/claude/hooks/on-stop.sh` | workstation | Current Stop hook — the plugin replaces this |
| `src/routes/events.js` | claude-code-remote | Daemon's `/session-start` and `/stop` endpoints — plugin posts here |
| `src/registry/session-registry.js` | claude-code-remote | Session data model the plugin must match |
| `packages/opencode/src/plugin/` | opencode | Plugin SDK, hook types, plugin loading |
| `packages/opencode/src/bus/` | opencode | Event system, all 30+ event types |
| `packages/opencode/src/session/` | opencode | Session lifecycle, status events |
| `packages/slack/` | opencode | Reference SSE subscriber implementation |
| oh-my-opencode source | oh-my-opencode | `detectExternalNotificationPlugin()`, notification hook, config |
| `modules/home/opencode-config.nix` | workstation | Current OpenCode config deployment |

---

## Open Questions for the Planner

1. **Plugin-only vs hybrid?** Should the plugin handle idle detection in-process (simpler, one component) or should the daemon subscribe to SSE (keeps daemon as the brain, plugin is thin)?

2. **Plugin distribution**: npm package, local file reference, or inline in workstation assets?

3. **Port discovery**: OpenCode defaults to 4096 but can vary. How does the daemon discover the port? Plugin could post it during registration.

4. **Multiple OpenCode instances**: If multiple OC instances run in different project dirs, each has its own SSE stream. How does the daemon manage multiple SSE subscriptions?

5. **Backward compatibility**: Should the daemon support both CC hooks AND the OC plugin simultaneously during migration? The `/session-start` and `/stop` endpoints should work for both.

6. **PTY detection in Bun**: The current hook uses `readlink /proc/$PPID/fd/0` (Linux) and `ps -o tty=` (macOS). Does this work from a Bun plugin context? The plugin has `$` (Bun shell) available.

---

## Success Criteria

- [ ] OpenCode plugin registers sessions with daemon on startup
- [ ] Daemon receives idle notifications without CC hooks
- [ ] Daemon gets message content without transcript JSONL parsing
- [ ] No 0.2s sleep hack
- [ ] No process-alive polling (uses session.status events)
- [ ] oh-my-opencode's local notifications defer to the plugin
- [ ] Existing CC hooks continue to work during migration
- [ ] Deployed via workstation Nix config
- [ ] Tests cover plugin event handling and daemon SSE subscription

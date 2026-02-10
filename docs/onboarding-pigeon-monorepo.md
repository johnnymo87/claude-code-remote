# Onboarding: Pigeon Monorepo Consolidation

> **Purpose:** Context document for evaluating the consolidation of `claude-code-remote`, `ccr-worker`, and `opencode-pigeon` into a single monorepo, potentially renamed to `pigeon` / `pigeon-worker` / `pigeon-plugin`. Also covers pending work across all repos.

---

## 1. The Three Repos Today

### claude-code-remote (CCR) — The Daemon

**Repo:** `~/projects/claude-code-remote` (branch: master)
**Runtime:** Node.js 22, Express, better-sqlite3
**What it does:** Runs on the devbox as a daemon. Receives lifecycle events from AI coding sessions (Claude Code via shell hooks, OpenCode via pigeon plugin), sends Telegram notifications, and injects reply commands back into the correct terminal session.

**Key components:**
- **Session Registry** — tracks active AI sessions (JSON files, pending SQLite migration)
- **Event Routes** — HTTP API (`POST /session-start`, `POST /stop`) that hooks/plugins call
- **TelegramWebhookHandler** — 776-line god object that sends notifications + receives replies
- **MachineAgent** — WebSocket client connecting to the Worker for multi-machine routing
- **Injectors** — nvim RPC and tmux send-keys for command injection

**Tests:** ~39 tests (vitest), focused on SessionRegistry concurrency.

### ccr-worker — The Cloudflare Worker

**Repo:** `~/projects/ccr-worker` (separate repo)
**Runtime:** Cloudflare Workers, Durable Objects, D1 SQLite
**What it does:** Sits between Telegram and the daemon(s). Routes webhook updates to the correct machine, queues commands for delivery, handles auth, dedup, and session management at the edge.

**Key components:**
- `router-do.js` — 1,084-line Durable Object singleton handling everything
- 15+ API endpoints for sessions, notifications, commands, WebSocket, admin
- 4 SQLite tables in DO storage

**Tests:** Zero. All testing is manual via `wrangler dev` + `curl`.

### opencode-pigeon — The OpenCode Plugin

**Repo:** `~/projects/opencode-pigeon` (branch: main)
**Runtime:** Bun/TypeScript, runs inside OpenCode's process
**What it does:** Bridges OpenCode sessions with the CCR daemon. Detects environment (TTY, tmux, nvim), registers sessions on startup, captures assistant message content in real-time, sends notifications when sessions go idle.

**Key components:**
- `src/index.ts` — Plugin entry point, event routing
- `src/env-detect.ts` — Cross-platform TTY detection (Linux `/proc`, macOS `lsof`)
- `src/daemon-client.ts` — HTTP client for CCR daemon
- `src/message-tail.ts` — Head-first content buffer with markdown stripping
- `src/session-state.ts` — Session state machine with dedup

**Tests:** 114 tests (bun:test), comprehensive coverage.

**Deployed via:** workstation's `opencode-config.nix` using `mkOutOfStoreSymlink` pointing to `src/index.ts`. Uses `devenv.nix` for Bun + Node.

---

## 2. How They Run Together

```
┌─────────────────────────────────────────────────────────────┐
│ Devbox (NixOS)                                              │
│                                                             │
│  ┌─────────────────┐     ┌─────────────────┐               │
│  │  Claude Code     │────▶│  Shell Hooks     │──┐           │
│  │  (CC sessions)   │     │  (bash scripts)  │  │           │
│  └─────────────────┘     └─────────────────┘  │           │
│                                                │           │
│  ┌─────────────────┐     ┌─────────────────┐  │  POST     │
│  │  OpenCode        │────▶│  opencode-pigeon │──┤ /session  │
│  │  (OC sessions)   │     │  (TS plugin)     │  │ -start    │
│  └─────────────────┘     └─────────────────┘  │ /stop     │
│                                                │           │
│                           ┌─────────────────┐  │           │
│                           │  CCR Daemon      │◀─┘           │
│                           │  (Node.js)       │              │
│                           │  :4731           │              │
│                           └────────┬────────┘              │
│                                    │ WebSocket              │
└────────────────────────────────────┼────────────────────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  ccr-worker          │
                          │  (Cloudflare Worker) │
                          │  Durable Object      │
                          └──────────┬──────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  Telegram Bot API    │
                          └─────────────────────┘
```

- CC sessions use shell hooks (bash scripts deployed by workstation)
- OC sessions use opencode-pigeon (in-process TypeScript plugin)
- Both hit the same CCR daemon HTTP endpoints
- Daemon connects to Worker via WebSocket for multi-machine Telegram routing
- Replies flow back: Telegram → Worker → Daemon → injector → terminal

---

## 3. Why "Pigeon"?

"CCR" stands for "Claude Code Remote" — but the system now serves both Claude Code and OpenCode. The name no longer fits. "Pigeon" is the carrier pigeon metaphor — it carries messages between the user (Telegram) and their AI coding sessions.

Proposed rename:
| Current | Proposed | Role |
|---------|----------|------|
| `claude-code-remote` | `pigeon` (or `pigeon-daemon`) | Daemon |
| `ccr-worker` | `pigeon-worker` | Cloudflare Worker |
| `opencode-pigeon` | `pigeon-plugin` | OpenCode plugin |

---

## 4. The Monorepo Question

### Arguments For

1. **These components run together.** The daemon, worker, and plugin share types (session schema, event payloads, API contracts). Changes to one often require coordinated changes to others.

2. **Shared contracts.** The plugin posts to `/session-start` and `/stop` — the exact shape of these payloads is defined by the daemon. Currently there's no shared type definition; the plugin just knows the shape by convention.

3. **Atomic commits.** When the session registration payload gains a new field (like `tty`), it requires changes in: plugin (send it), daemon (accept it), and sometimes worker (forward it). Currently this is 2-3 separate PRs across repos.

4. **Simpler CI.** One repo, one CI pipeline, one set of linting/formatting rules.

5. **Already partially there.** ccr-worker was originally inside claude-code-remote before being extracted. The extraction created friction (separate git history, separate issues, separate deploys).

### Arguments Against

1. **Different runtimes.** Daemon = Node.js, Plugin = Bun/TypeScript, Worker = Cloudflare Workers. A monorepo needs to handle all three build/test toolchains.

2. **Deploy independence.** The Worker deploys to Cloudflare via `wrangler`. The daemon runs on the devbox via systemd. The plugin is loaded by OpenCode at runtime. They have independent deploy lifecycles.

3. **Plugin independence.** opencode-pigeon only runs when using OpenCode. It's conceptually a different thing — an OpenCode plugin that happens to talk to the daemon. It could talk to any notification backend, not just pigeon.

4. **Complexity.** Monorepo tooling (nx, turborepo, or manual) adds overhead for a single-user project.

### Middle Ground

A monorepo with **workspace packages** (npm/bun workspaces) but independent deploy scripts:
```
pigeon/
├── packages/
│   ├── daemon/          # Node.js daemon (current claude-code-remote)
│   ├── worker/          # Cloudflare Worker (current ccr-worker)
│   ├── plugin/          # OpenCode plugin (current opencode-pigeon)
│   └── shared/          # Shared types, session schema, API contracts
├── package.json         # Workspace root
└── docs/plans/          # Plans (already here)
```

---

## 5. Recent History: opencode-pigeon Extraction

opencode-pigeon was built from scratch in a single multi-session sprint (Feb 8-10, 2026). It was created as a separate repo rather than inside CCR because:

1. **Different runtime** — Bun/TypeScript vs Node.js/CJS
2. **Plugin loading** — OpenCode loads plugins from a file path; having a standalone repo with `devenv.nix` made local dev clean
3. **Speed** — Greenfield was faster than fitting into CCR's structure

### What was built (chronological):

1. **Core plugin** — Event routing for `session.created`, `session.idle`, `message.updated`, `message.part.updated`, `session.deleted`, `session.error`
2. **Session state machine** — Tracks Created → Registered → Notified with dedup guards and parent/child session awareness
3. **Head-first content buffer** — Captures first 4KB of assistant messages with markdown stripping (replaces CC's transcript JSONL parsing)
4. **TTY detection (Linux)** — Reads `/proc/<ppid>/fd/0` readlink for PTY device path, with parent PID fallback
5. **TTY detection (macOS)** — `lsof -p <pid> -a -d 0 -Fn` for PTY discovery
6. **devenv setup** — `devenv.nix` provides Bun + Node via Nix
7. **Workstation integration** — `opencode-config.nix` uses `mkOutOfStoreSymlink` to load the plugin, `projects.nix` declares the repo for auto-cloning
8. **Documentation** — CLAUDE.md, architecture skill, development skill

### The plan that drove it:

`docs/plans/2026-02-09-opencode-plugin.md` — now marked ✅ COMPLETE. Originally proposed a hybrid approach (thin plugin + daemon SSE subscriber), but we built plugin-only (simpler, one component). All 9 success criteria met.

---

## 6. Pending Plans (Not Yet Executed)

### 6a. SQLite Storage Consolidation
**File:** `docs/plans/2026-02-09-sqlite-consolidation.md`
**Priority:** Medium
**What:** Replace daemon's JSON file storage (sessions + tokens) with SQLite. Single `ccr.db` using `better-sqlite3` (already a dependency). Drop `async-mutex` for session access.
**Status:** Plan written, annotated with note that `cleanupDeadSessions()` is still needed for CC sessions (pigeon handles OC cleanup in-process).
**Monorepo relevance:** If consolidating, the shared session schema would live in `packages/shared/`.

### 6b. Handler Decomposition
**File:** `docs/plans/2026-02-09-handler-decomposition.md`
**Priority:** Medium
**Depends on:** SQLite consolidation
**What:** Break the 776-line `TelegramWebhookHandler` god object into 4 focused modules: NotificationSender, WebhookReceiver, CommandRouter, TokenManager.
**Note:** The channel-abstraction-refactor plan (6f) already does much of this. These two plans overlap significantly — a planner should reconcile them.

### 6c. Message Batching
**File:** `docs/plans/2026-02-09-message-batching.md`
**Priority:** Low
**Depends on:** Handler decomposition
**What:** Add rate-aware message queuing between notification logic and Telegram API. Handle 429s with retry, optional coalescing of rapid notifications.
**Monorepo relevance:** Low — this is daemon-internal.

### 6d. Borrowed Patterns
**File:** `docs/plans/2026-02-09-borrowed-patterns.md`
**Priority:** Low
**What:** Four independent improvements from the architecture review: (1) Config validation + doctor command, (2) Deterministic session key derivation, (3) Output formatter pipeline, (4) Structured error types.
**Monorepo relevance:** Config validation would cover all packages. Error types could be shared.

### 6e. Worker Test Coverage
**File:** `docs/plans/2026-02-09-worker-test-coverage.md`
**Priority:** Medium
**What:** The 1,084-line Worker has zero tests. Plan covers extracting pure logic for unit tests + integration tests via Miniflare or `@cloudflare/vitest-pool-workers`.
**Monorepo relevance:** High — if consolidated, the shared types would help test contracts between daemon and worker.

### 6f. Channel Abstraction Refactor
**File:** `docs/plans/2026-02-08-channel-abstraction-refactor.md`
**Priority:** High (largest plan)
**What:** Full architectural refactor: ChatProvider interface (Telegram abstraction), AgentBackend interface (CC/OC abstraction), CommandRouter, ReplyTokenStore, new `start-server.js` entry point. 8 tasks with TDD approach.
**Status:** Partially implemented — some of these files already exist in CCR's `src/providers/` and `src/backends/` directories (from earlier work that may be incomplete).
**Monorepo relevance:** Very high — this is the natural place to define the shared interfaces that all three packages would use.

### 6g. nvim RPC Auto-Registration
**File:** `docs/plans/2026-02-09-nvim-rpc-auto-registration.md`
**Priority:** Medium
**What:** Auto-register nvim terminal buffers by PTY device path so reply commands target the correct buffer. Requires changes to workstation (ccremote.lua, hook script) and CCR daemon (accept `tty` field).
**Status:** Plan written with detailed implementation steps. NOT started.
**Note:** opencode-pigeon already sends `tty` — this plan is about making the CC hooks and nvim plugin do the same.

---

## 7. Repo Health Summary

| Repo | Tests | CI | Lint | Types | Debt |
|------|-------|----|------|-------|------|
| claude-code-remote | 39 (vitest) | None | None | CJS (no types) | JSON storage, god object, no CI |
| ccr-worker | 0 | None | None | CJS (no types) | Zero tests, 1084-line monolith |
| opencode-pigeon | 114 (bun:test) | None | tsc | TypeScript | Clean — newest repo |
| workstation | N/A (nix) | `nix flake check` | N/A | Nix | Dual-platform complexity |

---

## 8. Key Technical Decisions to Make

1. **Monorepo or keep separate?** — The core question. See Section 4 for tradeoffs.

2. **If monorepo, what tooling?** — npm workspaces (simple), bun workspaces (pigeon uses Bun), turborepo (caching), or nx (full monorepo framework). For a single-user project, simplicity wins.

3. **Shared types package?** — Even without a monorepo, extracting session schema, event payloads, and API contracts into a shared package would reduce drift.

4. **TypeScript migration?** — opencode-pigeon is already TS. The daemon and worker are CJS. A monorepo consolidation is a natural time to migrate, but it's a big scope increase.

5. **Which plans to execute first?** — The channel-abstraction-refactor (6f) creates the ChatProvider/AgentBackend interfaces that would become the shared contracts. SQLite consolidation (6a) is independent and could go first or in parallel. Worker tests (6e) are independent.

6. **Rename timing** — Rename before or after consolidation? Renaming the GitHub repo (`claude-code-remote` → `pigeon`) changes remote URLs, which affects workstation's `projects.nix`, systemd services, and any scripts that reference the repo path.

---

## 9. Workstation Integration Points

The workstation repo (`~/projects/workstation`) deploys and configures all three components:

| Component | Workstation file | How deployed |
|-----------|-----------------|--------------|
| CCR daemon | `hosts/devbox/configuration.nix` | systemd service, 1Password secrets via `op run` |
| CCR Worker | (deployed via `wrangler deploy`) | Not managed by workstation directly |
| opencode-pigeon | `users/dev/opencode-config.nix` | `mkOutOfStoreSymlink` to `src/index.ts` |
| CC hooks | `users/dev/claude-hooks.nix` + `assets/claude/hooks/` | Deployed to `~/.claude/hooks/` |
| OpenCode config | `users/dev/opencode-config.nix` | Merge-on-activate pattern |
| Projects list | `projects.nix` | Auto-clone on login/switch |

**If consolidating to a monorepo**, workstation changes needed:
- `projects.nix`: Remove individual repos, add `pigeon`
- `opencode-config.nix`: Update `mkOutOfStoreSymlink` path to `~/projects/pigeon/packages/plugin/src/index.ts`
- `configuration.nix`: Update systemd service working directory
- `claude-hooks.nix`: Update if hook scripts move

---

## 10. Files to Read for Deep Context

| File | Why |
|------|-----|
| `~/projects/claude-code-remote/CLAUDE.md` | CCR architecture overview |
| `~/projects/claude-code-remote/.claude/skills/architecture/SKILL.md` | Detailed daemon architecture |
| `~/projects/opencode-pigeon/CLAUDE.md` | Plugin overview |
| `~/projects/opencode-pigeon/.claude/skills/architecture/SKILL.md` | Cross-repo integration details |
| `~/projects/ccr-worker/CLAUDE.md` | Worker overview |
| `~/projects/workstation/CLAUDE.md` | How everything is deployed |
| `~/projects/workstation/.claude/skills/understanding-workstation/SKILL.md` | Nix config structure |
| `~/projects/workstation/users/dev/opencode-config.nix` | How the plugin is wired in |
| All files in `docs/plans/2026-02-09-*.md` | Pending plans |
| `docs/plans/2026-02-08-channel-abstraction-refactor.md` | Largest pending plan |

# Opencode-Pigeon Hardening: 11-Fix Pass

## TL;DR

> **Quick Summary**: Implement all 11 fixes identified by ChatGPT expert review to harden opencode-pigeon — the OpenCode plugin that bridges session lifecycle events to a Telegram notification daemon. Fixes span logging, error handling, dead code removal, dedup, race conditions, and robustness.
>
> **Deliverables**:
> - Logging switched from file-based to `client.app.log()` (SDK-native)
> - Error serialization fixed (no more `{}` from `JSON.stringify(Error)`)
> - `const enum` replaced with `as const` objects in 2 files
> - Dead code removed (`onIdle`, `IDLE_DEBOUNCE_MS`, `State.IdlePending`, timer field)
> - Circuit breaker checks `res.ok` before treating response as success
> - Notification dedup via `lastNotifiedMessageId` per session
> - Registration race condition fixed via per-session `registrationPromise`
> - Lazy init — `detectEnvironment` no longer blocks hook registration
> - Late discovery resolves `parentID` via `ctx.client.session.get()`
> - MessageTail handles parts arriving before `onMessageUpdated`
> - TTL eviction for stale sessions in Maps
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 (logging) → Task 4 (dead code) → Task 6 (dedup) → Task 8 (lazy init)

---

## Context

### Original Request
Implement all 11 fixes from a ChatGPT expert review of the opencode-pigeon plugin. User confirmed: all fixes, try `client.app.log()` and remove file fallback if it works, remove `onIdle`/debounce + add dedup guard.

### Interview Summary
**Key Discussions**:
- **Logging approach**: User chose "Try `client.app.log()`, remove file fallback if works." Metis recommended keeping fallback behind env flag — user overrode this. If `client.app.log()` works in live OpenCode, file logger is deleted entirely.
- **Debounce strategy**: User chose "Remove `onIdle` + debounce, add dedup guard." The `session.idle` handler currently notifies immediately; dedup guard prevents duplicate notifications.
- **Scope**: All 11 fixes (5 critical + 6 improvements).

### Research Findings
- `client.app.log()` confirmed to exist in OpenCode SDK (`@opencode-ai/plugin` types)
- `ctx.client.session.get()` confirmed in SDK for resolving `parentID`
- OpenCode events are at-least-once, not exactly-once (documented bug history)
- Hooks run in sequence — slow plugin init delays the whole pipeline
- `const enum` relies on TS-specific compile behavior; Bun transpiler may change

### Metis Review
**Identified Gaps** (addressed):
- Ordering: Fix #4 (logging) must go first as a decision gate for the rest
- Dedup guard must be synchronous (set BEFORE async `notifyStop`, not after)
- When replacing `const enum`, preserve numeric ordering with explicit values
- For lazy init, create shared `Promise<EnvironmentInfo>` triggered on first event
- `session.error` after `session.idle` could send two notifications — dedup handles this
- Plugin reload loses all in-memory state — accepted limitation

---

## Work Objectives

### Core Objective
Harden opencode-pigeon by implementing 11 fixes that address logging, error handling, dead code, deduplication, race conditions, and robustness issues.

### Concrete Deliverables
- Modified files: `src/index.ts`, `src/daemon-client.ts`, `src/session-state.ts`, `src/message-tail.ts`, `src/env-detect.ts`, `src/logger.ts` (deleted or gutted)
- Modified tests: `test/session-state.test.ts`, `test/daemon-client.test.ts`, `test/message-tail.test.ts`
- All tests passing: `bun test`
- Type-clean: `bunx tsc --noEmit`

### Definition of Done
- [x] `bunx tsc --noEmit` exits 0
- [x] `bun test` — all tests pass (count will change as ~10 old tests are deleted and new ones added)
- [x] `src/logger.ts` deleted (if `client.app.log()` works) or reduced to thin wrapper
- [x] No `const enum` anywhere in src/
- [x] No `onIdle` method, `IDLE_DEBOUNCE_MS`, `State.IdlePending`, or timer field in `session-state.ts`
- [x] Duplicate `session.idle` events do NOT produce duplicate Telegram notifications

### Must Have
- Zero runtime dependencies (only devDependencies)
- `export default` only from `index.ts`
- No modifications to the CCR daemon codebase (`~/projects/claude-code-remote`)
- Every fix verified by `bunx tsc --noEmit && bun test` after implementation

### Must NOT Have (Guardrails)
- Do NOT change the daemon HTTP protocol or routes
- Do NOT add runtime npm dependencies
- Do NOT export anything other than `export default plugin` from `index.ts`
- Do NOT add debounce/timer logic back — it was explicitly removed
- Do NOT over-engineer TTL eviction (simple `setInterval` + staleness check is enough)
- Do NOT create abstractions "for future use" — solve current problems only
- Do NOT add desktop notification features (user explicitly declined)

---

## Verification Strategy (MANDATORY)

> **UNIVERSAL RULE: ZERO HUMAN INTERVENTION**
>
> ALL tasks in this plan MUST be verifiable WITHOUT any human action.

### Test Decision
- **Infrastructure exists**: YES (`bun test` already works, 45 tests passing)
- **Automated tests**: Tests-after (add/modify tests per fix)
- **Framework**: `bun:test` (built into Bun)

### Agent-Executed QA Scenarios (MANDATORY — ALL tasks)

> Every task includes QA scenarios verified by the executing agent using Bash commands.
> The agent runs `bunx tsc --noEmit && bun test` after EVERY fix.
> For the logging decision gate (Task 1), the agent must do a live verification
> by restarting OpenCode and checking if `client.app.log()` output appears.

**Verification Tool by Deliverable Type:**

| Type | Tool | How Agent Verifies |
|------|------|-------------------|
| **TypeScript module** | Bash (`bunx tsc --noEmit`) | Type-check all source files |
| **Test suite** | Bash (`bun test`) | Run all tests, assert 0 failures |
| **Dead code removal** | Bash (grep) | Verify removed symbols don't exist in source |
| **Live plugin behavior** | Bash (tail log, restart opencode) | Verify logging works in live environment |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately):
├── Task 1: Logging spike (decision gate — MUST complete first in wave)
├── Task 2: Error serialization (independent)
└── Task 3: Replace const enum (independent)

Wave 2 (After Wave 1):
├── Task 4: Remove dead code (depends: Task 3 for enum values)
├── Task 5: Circuit breaker res.ok (depends: Task 2 for error serialize helper)
└── Task 9: MessageTail robustness (independent after Wave 1)

Wave 3 (After Wave 2):
├── Task 6: Notification dedup (depends: Task 4 for clean state machine)
├── Task 7: Registration race (independent after Wave 2)
└── Task 10: TTL eviction (independent after Wave 2)

Wave 4 (After Wave 3):
├── Task 8: Lazy init (depends: Task 1 for logging, Task 7 for registration promise pattern)
└── Task 11: Late discovery parentID (depends: Task 8 for lazy init pattern, Task 6 for dedup)
```

### Dependency Matrix

| Task | Depends On | Blocks | Can Parallelize With |
|------|------------|--------|---------------------|
| 1 (logging) | None | 8 | 2, 3 |
| 2 (error serialize) | None | 5 | 1, 3 |
| 3 (const enum) | None | 4 | 1, 2 |
| 4 (dead code) | 3 | 6 | 5, 9 |
| 5 (res.ok) | 2 | None | 4, 9 |
| 6 (dedup) | 4 | 11 | 7, 10 |
| 7 (registration race) | None* | 8 | 6, 10 |
| 8 (lazy init) | 1, 7 | 11 | None |
| 9 (MessageTail) | None* | None | 4, 5 |
| 10 (TTL eviction) | None* | None | 6, 7 |
| 11 (late discovery) | 6, 8 | None | None (final) |

### Agent Dispatch Summary

| Wave | Tasks | Recommended Agents |
|------|-------|-------------------|
| 1 | 1, 2, 3 | task(category="quick") for each — small, focused changes |
| 2 | 4, 5, 9 | task(category="quick") for 5, 9; task(category="unspecified-low") for 4 (test rewrite) |
| 3 | 6, 7, 10 | task(category="unspecified-low") for 6 (new tests); task(category="quick") for 7, 10 |
| 4 | 8, 11 | task(category="unspecified-high") for 8 (architectural); task(category="quick") for 11 |

---

## TODOs

- [x] 1. Switch logging to `client.app.log()` (DECISION GATE)

  **What to do**:
  - In `src/index.ts`, the plugin function receives `ctx` which has `ctx.client.app.log()`.
  - Create a module-level `log` function that wraps `client.app.log()`.
  - The challenge: `ctx` is only available inside the plugin function, but `log` is imported by other modules (`daemon-client.ts`, `env-detect.ts`).
  - **Approach**: Instead of a shared logger module, pass a `log` function from `index.ts` into the modules that need it, OR create a `setLogger(fn)` pattern, OR inline logging into `index.ts` and remove log calls from sub-modules.
  - **Simplest approach**: Create a `createLogger(client)` function that returns a `log` function. Call it in `index.ts` after plugin init. Pass the `log` function to `registerSession`, `notifyStop`, etc. as an optional parameter. For sub-modules that currently import `log`, either pass it via options or remove those log calls (they're mostly debug logging).
  - **Decision gate**: After implementing, restart OpenCode and verify `client.app.log()` output appears in OpenCode's log viewer. If it works → delete `src/logger.ts` entirely. If it doesn't work → keep `src/logger.ts` as-is and move on.
  - Serialize Error objects properly when logging (use the `serializeError` helper from Task 2 if it's done first, otherwise inline `err instanceof Error ? { message: err.message, stack: err.stack } : String(err)`)

  **Must NOT do**:
  - Do NOT keep `appendFileSync` as a fallback (user explicitly chose to remove it if `client.app.log()` works)
  - Do NOT add `console.log` — it's swallowed by OpenCode

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Requires exploring `client.app.log()` API and making a design decision about logger threading, but not deeply complex
  - **Skills**: []
    - No special skills needed — standard TypeScript refactoring
  - **Skills Evaluated but Omitted**:
    - `playwright`: No browser interaction needed
    - `frontend-ui-ux`: Not a UI task

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 2, 3)
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Task 8 (lazy init needs to know if logging approach changed)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/logger.ts:1-20` — Current file-based logger to be replaced. Uses `fs.appendFileSync` which is a perf concern.
  - `~/projects/opencode-pigeon/src/index.ts:6,21` — Where `log` is imported and first used. The `ctx` object (line 8) provides `ctx.client` for SDK logging.

  **API/Type References**:
  - `~/projects/opencode/packages/plugin/src/index.ts` — Plugin SDK types. Look for `client.app.log()` method signature. The `ctx` parameter of the plugin function provides `ctx.client`.
  - `@opencode-ai/plugin` — The plugin's only devDependency providing types.

  **Files that import `log`** (all need updating):
  - `src/index.ts:6` — `import { log } from "./logger"`
  - `src/daemon-client.ts:1` — `import { log } from "./logger"`
  - `src/env-detect.ts:2` — `import { log } from "./logger"`

  **WHY Each Reference Matters**:
  - `logger.ts` — This is the file being replaced/deleted. Understand its API surface.
  - `index.ts:8` — The `ctx` parameter is where `client.app.log()` lives. Plugin function signature shows available SDK methods.
  - Plugin SDK types — Verify `client.app.log()` exists and its signature before depending on it.

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` — all existing tests still pass
  - [ ] `src/logger.ts` is deleted (if `client.app.log()` works)
  - [ ] No `fs.appendFileSync` calls remain in source
  - [ ] No `import * as fs` remains in source (after logger deletion)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Verify type-check passes after logging refactor
    Tool: Bash
    Preconditions: All source files modified
    Steps:
      1. Run: bunx tsc --noEmit
      2. Assert: exit code 0
      3. Assert: no error output
    Expected Result: Clean type-check
    Evidence: Terminal output captured

  Scenario: Verify all tests pass after logging refactor
    Tool: Bash
    Preconditions: Source files modified, tests may need updating
    Steps:
      1. Run: bun test
      2. Assert: exit code 0
      3. Assert: output contains "pass" for all test files
    Expected Result: All tests green
    Evidence: Test output captured

  Scenario: Verify logger.ts is deleted
    Tool: Bash
    Preconditions: client.app.log() confirmed working
    Steps:
      1. Run: test -f src/logger.ts && echo "EXISTS" || echo "DELETED"
      2. Assert: output is "DELETED"
      3. Run: grep -r "appendFileSync" src/ && echo "FOUND" || echo "CLEAN"
      4. Assert: output is "CLEAN"
    Expected Result: No file-based logging remains
    Evidence: Command output captured

  Scenario: Verify no orphan logger imports
    Tool: Bash
    Preconditions: logger.ts deleted
    Steps:
      1. Run: grep -r 'from "./logger"' src/ && echo "FOUND" || echo "CLEAN"
      2. Assert: output is "CLEAN"
    Expected Result: No files import from deleted module
    Evidence: Command output captured
  ```

  **Commit**: YES
  - Message: `fix(logging): switch to client.app.log(), remove file-based logger`
  - Files: `src/index.ts`, `src/daemon-client.ts`, `src/env-detect.ts`, `src/logger.ts` (deleted)
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

- [x] 2. Fix error serialization (`JSON.stringify(Error)` → `{}`)

  **What to do**:
  - Create a `serializeError` helper function. Can live in a new `src/utils.ts` or inline where needed.
  - `function serializeError(err: unknown): Record<string, unknown> { if (err instanceof Error) return { message: err.message, stack: err.stack, name: err.name }; return { value: String(err) } }`
  - Find all `log("...", err)` and `JSON.stringify(data)` calls where `err` could be an Error object.
  - In `daemon-client.ts:92-93` and `119-120`: the `catch(err)` blocks pass `err` to `log()` which does `JSON.stringify(data)` — this produces `{}`.
  - In `index.ts:49-51`, `92-94`, `116-117`, `203-205`: similar patterns passing `err` to `log()`.
  - Fix: ensure the logging function (whether file-based or `client.app.log()`) serializes errors properly.
  - **If Task 1 completes first**: integrate `serializeError` into the new logging approach.
  - **If Task 1 not done yet**: fix `serializeError` in the existing `logger.ts` — specifically in the `log()` function's `JSON.stringify(data)` call on line 12.

  **Must NOT do**:
  - Do NOT add a full logging framework — just a simple helper function

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small, focused change — add one helper function, update ~5 call sites
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 1, 3)
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Task 5 (circuit breaker may use serialize helper)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/logger.ts:12` — Current `JSON.stringify(data)` call that silently produces `{}` for Error objects
  - `~/projects/opencode-pigeon/src/daemon-client.ts:92-93` — `catch(err)` block that logs errors in `registerSession`
  - `~/projects/opencode-pigeon/src/daemon-client.ts:119-120` — `catch(err)` block that logs errors in `notifyStop`
  - `~/projects/opencode-pigeon/src/index.ts:49-51` — `catch(err)` in late discovery registration
  - `~/projects/opencode-pigeon/src/index.ts:203-205` — `catch(err)` in plugin init

  **WHY Each Reference Matters**:
  - `logger.ts:12` — This is THE bug: `JSON.stringify(data)` where data is an Error → `{}`
  - `daemon-client.ts` catch blocks — These are the most important error logging sites (HTTP failures)
  - `index.ts` catch blocks — These capture plugin-level errors

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` passes
  - [ ] `JSON.stringify(new Error("test"))` is NOT used directly — errors go through `serializeError`
  - [ ] New test: `serializeError(new Error("test"))` returns `{ message: "test", name: "Error", stack: "..." }`
  - [ ] New test: `serializeError("string error")` returns `{ value: "string error" }`

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Error objects are serialized with message and stack
    Tool: Bash
    Preconditions: serializeError helper exists
    Steps:
      1. Run: bun test
      2. Assert: tests for serializeError pass
      3. Run: grep -n "JSON.stringify(err" src/ -r && echo "FOUND" || echo "CLEAN"
      4. Assert: output is "CLEAN" (no raw Error stringification)
    Expected Result: All error serialization goes through helper
    Evidence: Test output + grep output captured
  ```

  **Commit**: YES
  - Message: `fix(logging): serialize Error objects with message/stack/name`
  - Files: `src/logger.ts` (or `src/utils.ts`), modified call sites
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

- [x] 3. Replace `const enum` with `as const` plain objects

  **What to do**:
  - In `src/session-state.ts:1-7`: Replace `const enum State { Created, Registering, Registered, IdlePending, Notified }` with:
    ```ts
    const State = { Created: 0, Registering: 1, Registered: 2, IdlePending: 3, Notified: 4 } as const
    type State = (typeof State)[keyof typeof State]
    ```
  - In `src/daemon-client.ts:25-29`: Replace `const enum BreakerState { Closed, Open, HalfOpen }` with:
    ```ts
    const BreakerState = { Closed: 0, Open: 1, HalfOpen: 2 } as const
    type BreakerState = (typeof BreakerState)[keyof typeof BreakerState]
    ```
  - **CRITICAL**: Preserve explicit numeric values. `isRegistered()` uses `entry.state >= State.Registered` — numeric ordering matters.
  - Update all usage sites. The syntax `BreakerState.Closed`, `State.Created` etc. stays the same — `as const` objects support the same dot-access pattern.
  - Type annotations: anywhere `State` or `BreakerState` is used as a type, the new `type State = ...` alias will work.

  **Must NOT do**:
  - Do NOT change the numeric values — `Created=0, Registering=1, Registered=2, IdlePending=3, Notified=4`
  - Do NOT change comparison logic in `isRegistered` (the `>=` comparison)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical replacement — 2 files, well-defined transform
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 1, 2)
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 4 (dead code removal needs new enum values in place)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/session-state.ts:1-7` — `const enum State` to replace. Note: `IdlePending` and `Notified` will be removed in Task 4, but replace them here first.
  - `~/projects/opencode-pigeon/src/daemon-client.ts:25-29` — `const enum BreakerState` to replace
  - `~/projects/opencode-pigeon/src/session-state.ts:87` — `entry.state >= State.Registered` — this comparison REQUIRES numeric values to be preserved

  **WHY Each Reference Matters**:
  - `session-state.ts:1-7` — Primary replacement target. All State values used throughout the class.
  - `daemon-client.ts:25-29` — Secondary replacement target. BreakerState used in circuit breaker logic.
  - `session-state.ts:87` — CRITICAL: this `>=` comparison only works if numeric ordering is preserved.

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` — all 45 tests still pass (zero behavior change)
  - [ ] No `const enum` anywhere in `src/` directory
  - [ ] `State.Registered` still equals `2` (verify in test)
  - [ ] `BreakerState.Closed` still equals `0` (verify in test)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: No const enum remains in source
    Tool: Bash
    Preconditions: Both files modified
    Steps:
      1. Run: grep -r "const enum" src/ && echo "FOUND" || echo "CLEAN"
      2. Assert: output is "CLEAN"
    Expected Result: Zero const enum usage
    Evidence: grep output captured

  Scenario: Numeric values preserved
    Tool: Bash
    Preconditions: Tests exist that verify numeric values
    Steps:
      1. Run: bun test
      2. Assert: all tests pass including new value-check tests
    Expected Result: Enum values unchanged
    Evidence: Test output captured

  Scenario: Full type-check passes
    Tool: Bash
    Steps:
      1. Run: bunx tsc --noEmit
      2. Assert: exit code 0
    Expected Result: No type errors
    Evidence: Terminal output
  ```

  **Commit**: YES
  - Message: `refactor: replace const enum with as-const objects for Bun compatibility`
  - Files: `src/session-state.ts`, `src/daemon-client.ts`
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

- [x] 4. Remove dead code: `onIdle`, `IDLE_DEBOUNCE_MS`, `State.IdlePending`, timer

  **What to do**:
  - In `src/session-state.ts`:
    - Remove `State.IdlePending` (value `3`) and `State.Notified` (value `4`) from the State object. Remaining: `{ Created: 0, Registering: 1, Registered: 2 } as const`
    - Remove `IDLE_DEBOUNCE_MS` constant (line 9)
    - Remove `timer` field from `SessionEntry` type (line 14)
    - Remove `onIdle()` method entirely (lines 52-69)
    - Remove `clearTimer()` private method (lines 90-94)
    - Remove all timer-related logic from `onBusy()` (remove `this.clearTimer(entry)` call; simplify to just check state)
    - Simplify `onBusy()`: since there's no `IdlePending` state, `onBusy` only needs to handle the `Notified` → `Registered` transition (if we keep Notified), OR remove `onBusy` entirely if dedup (Task 6) replaces the state machine.
    - **Decision**: Keep `onBusy()` for resetting `Notified` state — Task 6 will add `Notified` back as part of dedup. So for NOW: remove `IdlePending`, `timer`, `clearTimer`, `onIdle`, `IDLE_DEBOUNCE_MS`. Keep `Notified` state and keep `onBusy` but remove the `clearTimer` call and `IdlePending` check from it.
    - Remove `timer: undefined` from `onSessionCreated` (line 27)
    - Remove `this.clearTimer(entry)` from `cleanupSession` (line 100)
    - Simplify `cleanupSession` — without timers, just return the entry check or remove entirely if trivial
  - In `test/session-state.test.ts`:
    - Delete ALL tests in `describe("idle timer")` block (lines 44-108) — ~4 tests about idle delay
    - Delete ALL tests in `describe("busy event cancels timer")` block (lines 110-175) — ~3 tests about timer cancellation
    - Delete/rewrite tests in `describe("isRegistered")` that test `IdlePending` state (lines 230-237)
    - Delete/rewrite tests in `describe("isRegistered")` that test `Notified` state (lines 239-248)
    - Keep and verify: `describe("main session detection")`, `describe("cleanup")`, basic `isRegistered` tests
    - Update remaining tests to not use `Bun.sleep` (no more async timer waits needed)
  - In `src/index.ts`:
    - The `session.idle` handler (lines 100-122) does NOT use `onIdle()` — it directly checks `isMainSession` and `isRegistered`. No changes needed here from dead code perspective.

  **Must NOT do**:
  - Do NOT remove `State.Notified` — Task 6 (dedup) will use it
  - Do NOT remove `onBusy()` — it will be needed after dedup adds `Notified` back
  - Do NOT change the `session.idle` handler in `index.ts` — that's Task 6's job

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Medium scope — deleting code and ~10 tests, rewriting some tests. Careful to not remove too much.
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 5, 9)
  - **Parallel Group**: Wave 2 (with Tasks 5, 9)
  - **Blocks**: Task 6 (dedup builds on cleaned state machine)
  - **Blocked By**: Task 3 (needs `as const` enum values in place first)

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/session-state.ts:1-103` — FULL FILE. Understand the state machine before deleting.
  - `~/projects/opencode-pigeon/src/session-state.ts:9` — `IDLE_DEBOUNCE_MS = 1500` to delete
  - `~/projects/opencode-pigeon/src/session-state.ts:14` — `timer` field in `SessionEntry` to delete
  - `~/projects/opencode-pigeon/src/session-state.ts:52-69` — `onIdle()` method to delete entirely
  - `~/projects/opencode-pigeon/src/session-state.ts:90-94` — `clearTimer()` method to delete
  - `~/projects/opencode-pigeon/src/session-state.ts:41-49` — `onBusy()` — remove `clearTimer` call, remove `IdlePending` from condition

  **Test References**:
  - `~/projects/opencode-pigeon/test/session-state.test.ts:44-108` — "idle timer" test block — DELETE ALL
  - `~/projects/opencode-pigeon/test/session-state.test.ts:110-175` — "busy event cancels timer" test block — DELETE ALL
  - `~/projects/opencode-pigeon/test/session-state.test.ts:230-248` — isRegistered tests for IdlePending/Notified states — REWRITE

  **Usage References**:
  - `~/projects/opencode-pigeon/src/index.ts:100-122` — `session.idle` handler. Does NOT call `onIdle()`. No change needed here.

  **WHY Each Reference Matters**:
  - Full session-state.ts — Need to understand complete state machine before surgically removing parts
  - Test line ranges — These are the specific test blocks to delete (saves time finding them)
  - index.ts idle handler — Verify it does NOT depend on the removed code

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` passes (fewer tests than before — that's expected)
  - [ ] No `IDLE_DEBOUNCE_MS` in source
  - [ ] No `onIdle` method in `SessionManager`
  - [ ] No `clearTimer` method in `SessionManager`
  - [ ] No `timer` field in `SessionEntry`
  - [ ] No `State.IdlePending` in source
  - [ ] No `Bun.sleep` in `test/session-state.test.ts` (no more timer waits)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Dead code fully removed
    Tool: Bash
    Steps:
      1. Run: grep -n "IDLE_DEBOUNCE" src/session-state.ts && echo "FOUND" || echo "CLEAN"
      2. Assert: CLEAN
      3. Run: grep -n "onIdle" src/session-state.ts && echo "FOUND" || echo "CLEAN"
      4. Assert: CLEAN
      5. Run: grep -n "clearTimer" src/session-state.ts && echo "FOUND" || echo "CLEAN"
      6. Assert: CLEAN
      7. Run: grep -n "IdlePending" src/ -r && echo "FOUND" || echo "CLEAN"
      8. Assert: CLEAN
    Expected Result: All dead code gone
    Evidence: grep outputs captured

  Scenario: No timer waits in session-state tests
    Tool: Bash
    Steps:
      1. Run: grep -n "Bun.sleep" test/session-state.test.ts && echo "FOUND" || echo "CLEAN"
      2. Assert: CLEAN
    Expected Result: Tests are synchronous now
    Evidence: grep output captured

  Scenario: Remaining tests all pass
    Tool: Bash
    Steps:
      1. Run: bunx tsc --noEmit && bun test
      2. Assert: exit code 0
    Expected Result: Type-check and tests both green
    Evidence: Terminal output captured
  ```

  **Commit**: YES
  - Message: `refactor(session-state): remove dead debounce/timer code`
  - Files: `src/session-state.ts`, `test/session-state.test.ts`
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

- [x] 5. Circuit breaker: check `res.ok` before treating response as success

  **What to do**:
  - In `src/daemon-client.ts`, both `registerSession` (lines 69-96) and `notifyStop` (lines 98-124):
    - After `const res = await fetch(...)`, check `if (!res.ok)` before calling `res.json()`
    - If `!res.ok`: call `onFailure()` and return `null` (same as catch block behavior)
    - Optionally: try to read error body for logging: `const text = await res.text().catch(() => ""); log("daemon returned error", { status: res.status, body: text })`
    - Be defensive about `res.json()` too — if daemon returns HTML (e.g., reverse proxy error), `res.json()` will throw. The current catch block handles this, but explicit `res.ok` check is cleaner.
  - Update existing test "should handle non-200 response" (`test/daemon-client.test.ts:112-136`):
    - Currently this test expects `null` for 500 response — it passes because `res.json()` throws on the non-JSON "Internal Server Error" body.
    - After fix, `null` is returned explicitly via `!res.ok` check. The test assertion stays the same but the reason changes.
    - Add a NEW test: server returns `500` with JSON body `{ ok: false, error: "internal" }` — should still return `null` (not the JSON body).
  - Add test: server returns `200` with `{ ok: false }` — should this succeed or fail? Currently it succeeds (calls `onSuccess`). This is an edge case to consider — for now, keep existing behavior (treat 2xx as success regardless of body).

  **Must NOT do**:
  - Do NOT change the daemon HTTP protocol
  - Do NOT add retry logic (breaker handles retries via backoff)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small change — add `if (!res.ok)` check in 2 functions, add 1-2 tests
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 4, 9)
  - **Parallel Group**: Wave 2 (with Tasks 4, 9)
  - **Blocks**: None
  - **Blocked By**: Task 2 (error serialization helper for logging)

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/daemon-client.ts:69-96` — `registerSession()`: line 88 does `const data = await res.json()` then `onSuccess()` — needs `!res.ok` guard before this
  - `~/projects/opencode-pigeon/src/daemon-client.ts:98-124` — `notifyStop()`: same pattern at line 116
  - `~/projects/opencode-pigeon/src/daemon-client.ts:56-62` — `onFailure()` function — call this when `!res.ok`

  **Test References**:
  - `~/projects/opencode-pigeon/test/daemon-client.test.ts:112-136` — Existing "should handle non-200 response" test. Currently works by accident (non-JSON body throws). After fix, works by design.

  **WHY Each Reference Matters**:
  - `daemon-client.ts:88,116` — The exact lines where the bug is: `res.json()` + `onSuccess()` without checking HTTP status
  - `onFailure()` — The function to call when `!res.ok` (trips the breaker)
  - Existing test — Verify it still passes, then add the new "500 with JSON body" case

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` passes
  - [ ] New test: 500 response with JSON body `{ ok: false }` → returns `null`, breaker trips
  - [ ] Existing test: 500 with non-JSON body → still returns `null`
  - [ ] 200 response with `{ ok: true }` → still returns data (no regression)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Non-2xx with JSON body still returns null
    Tool: Bash
    Steps:
      1. Run: bun test test/daemon-client.test.ts
      2. Assert: new "500 with JSON body" test passes
      3. Assert: existing "non-200 response" test passes
    Expected Result: Circuit breaker trips on non-2xx regardless of body format
    Evidence: Test output captured
  ```

  **Commit**: YES
  - Message: `fix(daemon-client): check res.ok before treating HTTP response as success`
  - Files: `src/daemon-client.ts`, `test/daemon-client.test.ts`
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

- [x] 6. Add notification dedup via `lastNotifiedMessageId`

  **What to do**:
  - **Strategy**: Track `lastNotifiedMessageId` per session. On `session.idle`, compare the current assistant message ID with the last notified one. If they match → skip (already notified for this message).
  - In `src/session-state.ts`:
    - Add `lastNotifiedMessageId: string | undefined` to `SessionEntry`
    - Add method `setNotified(sessionID: string, messageId: string): void` — sets `lastNotifiedMessageId` and transitions state to `Notified`
    - Add method `shouldNotify(sessionID: string, currentMessageId: string | undefined): boolean`:
      - Returns `false` if session is unknown or not registered
      - Returns `false` if `currentMessageId` is undefined (no message to report)
      - Returns `false` if `currentMessageId === entry.lastNotifiedMessageId` (already notified)
      - Returns `true` otherwise
    - Keep `State.Notified` — set it when `setNotified()` is called
    - `onBusy()` resets state from `Notified` to `Registered` (already does this)
  - In `src/index.ts`, modify `session.idle` handler (lines 100-122):
    - Get current assistant message ID from `messageTail` (need to expose this — see below)
    - Call `sessionManager.shouldNotify(sessionID, currentMessageId)` — if `false`, skip
    - **CRITICAL**: Set the dedup guard SYNCHRONOUSLY before the async `notifyStop()` call:
      ```ts
      const currentMsgId = messageTail.getCurrentMessageId(sessionID)
      if (!sessionManager.shouldNotify(sessionID, currentMsgId)) return
      sessionManager.setNotified(sessionID, currentMsgId!) // Synchronous — prevents concurrent dupes
      const summary = messageTail.getSummary(sessionID) || "Task completed"
      notifyStop({ ... }).catch(...)
      ```
    - This ensures that if two `session.idle` events fire in rapid succession, the second one sees `lastNotifiedMessageId` already set and skips.
  - In `src/message-tail.ts`:
    - Add method `getCurrentMessageId(sessionID: string): string | undefined` that returns `tail.currentMessageId`
  - In `src/index.ts`, also protect `session.error` handler similarly:
    - Before sending notifyStop on error, check dedup. Use a special marker like `"error:" + sessionID` as the messageId for error notifications, so errors can still notify even if the same message was already notified for idle.
  - **Tests**:
    - New test in `test/session-state.test.ts`: `shouldNotify` returns `true` for new message, `false` for same message
    - New test: `shouldNotify` returns `true` after `onBusy` resets state (new work happened)
    - New test: `setNotified` transitions state to `Notified`
    - New test in `test/message-tail.test.ts`: `getCurrentMessageId` returns correct ID

  **Must NOT do**:
  - Do NOT add debounce/timer — dedup is the replacement
  - Do NOT block notification on async operations — dedup guard must be synchronous

  **Recommended Agent Profile**:
  - **Category**: `unspecified-low`
    - Reason: Medium complexity — touches 3 source files, adds new methods, writes several new tests, needs careful synchronization reasoning
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 7, 10)
  - **Parallel Group**: Wave 3 (with Tasks 7, 10)
  - **Blocks**: Task 11 (late discovery uses dedup)
  - **Blocked By**: Task 4 (needs clean state machine without dead code)

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/session-state.ts` — Full file. The state machine to extend with `lastNotifiedMessageId` and `shouldNotify`/`setNotified` methods.
  - `~/projects/opencode-pigeon/src/index.ts:100-122` — `session.idle` handler to modify with dedup check
  - `~/projects/opencode-pigeon/src/index.ts:172-200` — `session.error` handler — also needs dedup protection
  - `~/projects/opencode-pigeon/src/message-tail.ts:56-64` — `getSummary` method — nearby is where to add `getCurrentMessageId`

  **External References**:
  - ChatGPT review answer (strategy A: "Notify once per assistant message id"): `/tmp/research-opencode-pigeon-review-answer.md:107-114`

  **WHY Each Reference Matters**:
  - `session-state.ts` — Where dedup state lives. Need to understand `SessionEntry` type and state transitions.
  - `index.ts:100-122` — The idle handler is THE place where dedup guard must be applied synchronously.
  - `index.ts:172-200` — Error handler also calls `notifyStop` — needs dedup too.
  - `message-tail.ts` — Need to expose `currentMessageId` for dedup comparison.

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` passes (including new dedup tests)
  - [ ] New test: duplicate `session.idle` with same message ID → `shouldNotify` returns `false` on second call
  - [ ] New test: `onBusy` after `Notified` → `shouldNotify` returns `true` for same message ID (state reset)
  - [ ] New test: `getCurrentMessageId` returns correct assistant message ID
  - [ ] Dedup guard is set BEFORE `notifyStop` is called (synchronous)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Dedup prevents double notification
    Tool: Bash
    Steps:
      1. Run: bun test test/session-state.test.ts
      2. Assert: "shouldNotify returns false for same messageId" test passes
    Expected Result: Second idle with same message skipped
    Evidence: Test output captured

  Scenario: Busy resets dedup allowing re-notification
    Tool: Bash
    Steps:
      1. Run: bun test test/session-state.test.ts
      2. Assert: "shouldNotify returns true after onBusy" test passes
    Expected Result: New work allows notification for same message
    Evidence: Test output captured

  Scenario: Full test suite passes
    Tool: Bash
    Steps:
      1. Run: bunx tsc --noEmit && bun test
      2. Assert: exit code 0
    Expected Result: All tests green
    Evidence: Terminal output captured
  ```

  **Commit**: YES
  - Message: `feat(dedup): add per-session notification deduplication via lastNotifiedMessageId`
  - Files: `src/session-state.ts`, `src/message-tail.ts`, `src/index.ts`, `test/session-state.test.ts`, `test/message-tail.test.ts`
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

- [x] 7. Fix registration race: store per-session `registrationPromise`

  **What to do**:
  - **Problem**: `session.idle` can fire before `registerSession()` HTTP call completes. Currently `isRegistered()` returns `false` and notification is silently dropped.
  - In `src/session-state.ts`:
    - Add `registrationPromise: Promise<void> | undefined` to `SessionEntry`
    - Add method `setRegistrationPromise(sessionID: string, promise: Promise<void>): void`
    - Add method `awaitRegistration(sessionID: string): Promise<void>` — resolves immediately if no pending promise or already registered
  - In `src/index.ts`:
    - When calling `registerSession()` (in both `session.created` handler and `lateDiscoverSession`):
      ```ts
      const regPromise = registerSession({ ... })
        .then((result) => {
          if (result?.ok) sessionManager.onRegistered(sessionID)
        })
        .catch((err) => log("registerSession error:", err))
      sessionManager.setRegistrationPromise(sessionID, regPromise)
      ```
    - In `session.idle` handler, before checking `isRegistered`:
      ```ts
      await sessionManager.awaitRegistration(sessionID)
      ```
    - This closes the race window: idle waits for pending registration to complete before checking registration status.
  - **Tests**:
    - New test: `awaitRegistration` resolves immediately for unknown session
    - New test: `awaitRegistration` resolves immediately for already-registered session
    - New test: `awaitRegistration` waits for pending promise, then `isRegistered` returns `true`

  **Must NOT do**:
  - Do NOT add timeout to `awaitRegistration` — `registerSession` already has `AbortSignal.timeout(1000)`
  - Do NOT retry registration — just wait for the single attempt to complete

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small addition — 2 new methods, 1 await insertion, 3 tests
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 10)
  - **Parallel Group**: Wave 3 (with Tasks 6, 10)
  - **Blocks**: Task 8 (lazy init uses registration promise pattern)
  - **Blocked By**: None (conceptually independent, but placed in Wave 3 for clean ordering)

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/index.ts:73-95` — `session.created` handler where `registerSession()` is called fire-and-forget via `.then()`. This is the registration that can race with `session.idle`.
  - `~/projects/opencode-pigeon/src/index.ts:31-52` — `lateDiscoverSession` where `registerSession()` is also called fire-and-forget.
  - `~/projects/opencode-pigeon/src/index.ts:100-122` — `session.idle` handler where `isRegistered()` check happens. Need to `await` registration first.
  - `~/projects/opencode-pigeon/src/session-state.ts:11-15` — `SessionEntry` type to extend with `registrationPromise`

  **External References**:
  - ChatGPT review strategy: `/tmp/research-opencode-pigeon-review-answer.md:216-221` — "Store a per-session registrationPromise. On idle, await it before calling /stop."

  **WHY Each Reference Matters**:
  - `index.ts:73-95` and `31-52` — Where registration promises are created but NOT stored. Need to store them.
  - `index.ts:100-122` — Where the race manifests: `isRegistered()` returns false during pending registration.
  - `SessionEntry` type — Where to add the promise field.

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` passes
  - [ ] New test: idle handler awaits registration before checking `isRegistered`
  - [ ] New test: `awaitRegistration` resolves after promise completes

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Registration race is closed
    Tool: Bash
    Steps:
      1. Run: bun test test/session-state.test.ts
      2. Assert: registration promise tests pass
    Expected Result: Idle waits for registration
    Evidence: Test output captured
  ```

  **Commit**: YES
  - Message: `fix(session-state): await pending registration before idle notification`
  - Files: `src/session-state.ts`, `src/index.ts`, `test/session-state.test.ts`
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

- [x] 8. Lazy init: make `detectEnvironment` non-blocking

  **What to do**:
  - **Problem**: `const envInfo = await detectEnvironment(ctx.$)` on line 17 of `index.ts` blocks hook registration. If tmux probing is slow, OpenCode events (including `session.created`) fire before hooks are listening.
  - **Solution**: Start detection eagerly but don't await it. Return hooks immediately. Await the shared promise inside the event handler.
  - In `src/index.ts`:
    ```ts
    const plugin: Plugin = async (ctx) => {
      const messageTail = new MessageTail()
      const sessionManager = new SessionManager()

      const daemonUrl = process.env.PIGEON_DAEMON_URL ?? `http://127.0.0.1:${...}`
      const label = ctx.directory.split("/").filter(Boolean).pop() ?? "unknown"

      // Start detection eagerly but DON'T await
      const envInfoP = detectEnvironment(ctx.$).catch((err) => {
        log("env detection failed, using fallback", err)
        return { pid: process.pid, ppid: process.ppid } as EnvironmentInfo
      })

      // Return hooks IMMEDIATELY — don't block on tmux probing
      return {
        event: async (input) => {
          const envInfo = await envInfoP  // Resolved by first event usually
          // ... rest of handler unchanged
        }
      }
    }
    ```
  - **Type export**: `EnvironmentInfo` type needs to be exported from `env-detect.ts` for the fallback object's type annotation.
  - **Logging**: The `log("plugin initialized", ...)` call at line 21 must move inside the event handler (first invocation) or be removed, since `envInfo` isn't available at hook registration time.
  - **Impact on lateDiscoverSession**: The `lateDiscoverSession` closure captures `envInfo`. After this change, it needs to capture `envInfoP` and await it, OR receive `envInfo` as a parameter from the event handler where it's already awaited.
  - **Tests**: No new unit tests needed — this is structural, verified by E2E (hooks respond to early events) and type-check.

  **Must NOT do**:
  - Do NOT remove `detectEnvironment` — just make it non-blocking
  - Do NOT add a second `detectEnvironment` call
  - Do NOT cache `envInfo` in module scope — keep it scoped to the plugin closure

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Architectural change affecting the plugin's initialization model. Must carefully thread `envInfoP` through closures. Multiple code paths (session.created handler, lateDiscoverSession, session.idle handler) all reference `envInfo`.
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: NO (sequential in Wave 4)
  - **Parallel Group**: Wave 4 (with Task 11)
  - **Blocks**: Task 11 (late discovery depends on lazy init pattern)
  - **Blocked By**: Task 1 (logging approach), Task 7 (registration promise — needed to understand full init flow)

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/index.ts:8-21` — Plugin initialization: `await detectEnvironment(ctx.$)` blocks here. This is THE line to change.
  - `~/projects/opencode-pigeon/src/index.ts:25-52` — `lateDiscoverSession` closure — references `envInfo` (lines 35-39). Must be updated to await `envInfoP`.
  - `~/projects/opencode-pigeon/src/index.ts:54-56` — Hook return: `return { event: async (input) => { ... } }`. Hooks must be returned WITHOUT awaiting envInfo.
  - `~/projects/opencode-pigeon/src/index.ts:74-85` — `session.created` handler also references `envInfo` (lines 78-83). Must await `envInfoP` first.
  - `~/projects/opencode-pigeon/src/env-detect.ts:4-11` — `EnvironmentInfo` type — needs to be exported for fallback type annotation.

  **External References**:
  - ChatGPT review recommendation: `/tmp/research-opencode-pigeon-review-answer.md:26-41` — The exact lazy init pattern to follow.

  **WHY Each Reference Matters**:
  - `index.ts:17` — The blocking `await` that causes missed `session.created` events. THE root cause this fixes.
  - `index.ts:25-52` — Closure that captures `envInfo` — must be updated to handle the promise.
  - `index.ts:74-85` — Another reference to `envInfo` in the session.created handler.
  - `env-detect.ts` type — Need to export type for fallback annotation.

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` passes
  - [ ] `await detectEnvironment(ctx.$)` is NOT called before `return { event: ... }`
  - [ ] `detectEnvironment(ctx.$)` IS called (eagerly) but its promise is stored, not awaited
  - [ ] `envInfoP` is awaited inside the event handler
  - [ ] Fallback `{ pid: process.pid, ppid: process.ppid }` is used if detection fails

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Plugin returns hooks without blocking
    Tool: Bash
    Steps:
      1. Run: bunx tsc --noEmit
      2. Assert: exit code 0
      3. Run: grep -n "await detectEnvironment" src/index.ts
      4. Assert: the await is INSIDE the event handler, NOT before return
    Expected Result: Hooks returned immediately
    Evidence: grep output + type-check output

  Scenario: Fallback works when detection fails
    Tool: Bash
    Steps:
      1. Run: grep -A2 "detectEnvironment.*catch" src/index.ts
      2. Assert: catch block returns fallback with pid/ppid
    Expected Result: Graceful degradation
    Evidence: grep output captured
  ```

  **Commit**: YES
  - Message: `fix(init): return hooks immediately, make env detection lazy`
  - Files: `src/index.ts`, `src/env-detect.ts` (export type)
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

- [x] 9. MessageTail robustness: handle parts before `onMessageUpdated`

  **What to do**:
  - **Problem**: If `message.part.updated` arrives before `message.updated`, `currentMessageId` is `undefined` and the part is dropped (line 42: `if (tail.currentMessageId !== part.messageID) return`).
  - **Fix**: In `onPartUpdated()`, if `currentMessageId` is `undefined`, set it to `part.messageID` instead of dropping. This makes MessageTail tolerant of event ordering.
  - In `src/message-tail.ts`:
    ```ts
    onPartUpdated(part: PartInfo, delta?: string): void {
      if (part.type !== "text") return

      const tail = this.getOrCreate(part.sessionID)

      // Tolerate parts arriving before onMessageUpdated
      if (tail.currentMessageId === undefined) {
        tail.currentMessageId = part.messageID
      }

      if (tail.currentMessageId !== part.messageID) return

      // ... rest unchanged
    }
    ```
  - **Tests**:
    - New test: `onPartUpdated` before `onMessageUpdated` → text is accumulated (not dropped)
    - New test: After late-start accumulation, `onMessageUpdated` with same messageID → continues accumulating
    - New test: After late-start accumulation, `onMessageUpdated` with DIFFERENT messageID → resets text

  **Must NOT do**:
  - Do NOT maintain a map of all message IDs (over-engineering) — single `currentMessageId` with tolerance is enough
  - Do NOT change the "parts from old messages are ignored" behavior when `currentMessageId` IS set

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 3-line code change + 3 new tests
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 4, 5)
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: None
  - **Blocked By**: None (conceptually independent)

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/message-tail.ts:37-54` — `onPartUpdated()` method. Line 42 is the guard that drops parts when `currentMessageId` doesn't match. This is the line to modify.
  - `~/projects/opencode-pigeon/src/message-tail.ts:26-35` — `onMessageUpdated()` method — sets `currentMessageId`. Understanding the normal flow helps reason about the edge case.

  **Test References**:
  - `~/projects/opencode-pigeon/test/message-tail.test.ts:11-39` — "should accumulate text from assistant messages only" — the normal happy path pattern to follow for new tests
  - `~/projects/opencode-pigeon/test/message-tail.test.ts:187-231` — "should ignore parts from previous messages" — this existing behavior must NOT change when `currentMessageId` IS set

  **External References**:
  - ChatGPT review: `/tmp/research-opencode-pigeon-review-answer.md:243-252` — "If currentMessageId is undefined, set it to part.messageID"

  **WHY Each Reference Matters**:
  - `message-tail.ts:42` — THE line to change: the strict guard that drops valid parts
  - Existing test patterns — Follow same style for new tests
  - "ignore parts from previous messages" test — Must verify this still works after the change

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` passes
  - [ ] New test: part arrives before message.updated → text is accumulated
  - [ ] Existing test: parts from OLD messages still ignored when currentMessageId IS set

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Parts before onMessageUpdated are not dropped
    Tool: Bash
    Steps:
      1. Run: bun test test/message-tail.test.ts
      2. Assert: new "parts before onMessageUpdated" test passes
      3. Assert: existing "ignore parts from previous messages" test still passes
    Expected Result: Tolerant of event ordering
    Evidence: Test output captured
  ```

  **Commit**: YES
  - Message: `fix(message-tail): accept parts arriving before onMessageUpdated`
  - Files: `src/message-tail.ts`, `test/message-tail.test.ts`
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

- [x] 10. TTL eviction for stale sessions in Maps

  **What to do**:
  - **Problem**: Sessions that are never explicitly deleted (missed `session.deleted` event) leak memory in `SessionManager.sessions` and `MessageTail.sessions` Maps.
  - **Solution**: Add a periodic cleanup using `setInterval`. Simple staleness check.
  - In `src/session-state.ts`:
    - Add `lastSeenAt: number` to `SessionEntry` — update on every state transition (`onSessionCreated`, `onRegistered`, `onBusy`, `setNotified`)
    - Add a `startEviction(intervalMs?: number)` method that starts `setInterval`:
      ```ts
      private evictionTimer: ReturnType<typeof setInterval> | undefined

      startEviction(intervalMs = 3600_000): void {  // Default: every hour
        this.evictionTimer = setInterval(() => {
          const cutoff = Date.now() - 86_400_000  // 24h staleness
          for (const [id, entry] of this.sessions) {
            if (entry.lastSeenAt < cutoff) {
              this.sessions.delete(id)
              if (this.mainSessionId === id) this.mainSessionId = undefined
            }
          }
        }, intervalMs)
        // Don't let this prevent process exit
        if (this.evictionTimer.unref) this.evictionTimer.unref()
      }
      ```
    - Call `sessionManager.startEviction()` from `index.ts` after creating the manager.
  - In `src/message-tail.ts`:
    - Add `lastSeenAt: number` to `SessionTail`
    - Update `lastSeenAt` in `getOrCreate` and `onPartUpdated`
    - Add similar `startEviction()` method
    - Call `messageTail.startEviction()` from `index.ts`.
  - **Cap**: Also add a defensive cap — if Map size exceeds 100 sessions, evict oldest entries immediately.
  - **Tests**:
    - New test: session not seen for >24h is evicted
    - New test: recently-seen session is NOT evicted
    - New test: eviction doesn't break concurrent operations

  **Must NOT do**:
  - Do NOT make eviction aggressive — 24h staleness + 1h interval is plenty
  - Do NOT add WeakRef/FinalizationRegistry — overkill for this
  - Do NOT evict sessions that are actively being used (check `lastSeenAt`)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward interval + staleness check, no complex logic
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Tasks 6, 7)
  - **Parallel Group**: Wave 3 (with Tasks 6, 7)
  - **Blocks**: None
  - **Blocked By**: None (conceptually independent)

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/session-state.ts:11-15` — `SessionEntry` type — add `lastSeenAt` field
  - `~/projects/opencode-pigeon/src/session-state.ts:18` — `sessions` Map — this is what grows without bound
  - `~/projects/opencode-pigeon/src/message-tail.ts:9-12` — `SessionTail` type — add `lastSeenAt` field
  - `~/projects/opencode-pigeon/src/message-tail.ts:15` — `sessions` Map — also grows without bound

  **External References**:
  - ChatGPT review: `/tmp/research-opencode-pigeon-review-answer.md:295-305` — TTL eviction recommendation

  **WHY Each Reference Matters**:
  - `SessionEntry` and `SessionTail` types — Where to add `lastSeenAt`
  - Both `sessions` Maps — These are the leak sources

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` passes
  - [ ] New test: stale session evicted after TTL
  - [ ] New test: fresh session NOT evicted
  - [ ] `setInterval` timer calls `.unref()` (doesn't prevent process exit)

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Stale sessions are evicted
    Tool: Bash
    Steps:
      1. Run: bun test
      2. Assert: TTL eviction tests pass
    Expected Result: Memory leak prevented
    Evidence: Test output captured
  ```

  **Commit**: YES
  - Message: `fix(memory): add TTL eviction for stale sessions`
  - Files: `src/session-state.ts`, `src/message-tail.ts`, `src/index.ts`, `test/session-state.test.ts`, `test/message-tail.test.ts`
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

- [x] 11. Late discovery: resolve `parentID` via `ctx.client.session.get()`

  **What to do**:
  - **Problem**: `lateDiscoverSession()` calls `onSessionCreated(sessionID, undefined)` — if the session is actually a child, it's incorrectly treated as main session.
  - **Solution**: Use `ctx.client.session.get()` to resolve `parentID` before registering.
  - In `src/index.ts`, modify `lateDiscoverSession`:
    ```ts
    const lateDiscoverSession = async (sessionID: string) => {
      if (sessionManager.isKnown(sessionID)) return  // Need new isKnown() method

      const envInfo = await envInfoP

      try {
        const session = await ctx.client.session.get({ path: { id: sessionID } })
        const parentID = session.data?.parentID
        sessionManager.onSessionCreated(sessionID, parentID)

        if (!parentID) {
          const regPromise = registerSession({ ... })
            .then((result) => { if (result?.ok) sessionManager.onRegistered(sessionID) })
            .catch(...)
          sessionManager.setRegistrationPromise(sessionID, regPromise)
        }
      } catch (err) {
        // Fallback: register without parentID (current behavior)
        log("session.get failed, registering without parentID", err)
        sessionManager.onSessionCreated(sessionID, undefined)
        // ... register as before
      }
    }
    ```
  - In `src/session-state.ts`:
    - Add `isKnown(sessionID: string): boolean` method — returns `true` if sessionID exists in the Map (regardless of state). This replaces the current `isMainSession || isRegistered` guard.
  - **Note**: `lateDiscoverSession` becomes async now. Currently it's sync (fire-and-forget). Callers (in `message.updated` handler) do `lateDiscoverSession(info.sessionID)` without await — this is fine since registration was already fire-and-forget.
  - **Tests**:
    - New test in `test/session-state.test.ts`: `isKnown` returns `true` for any known session
    - Integration-level: difficult to test `session.get` without mocking SDK. Consider adding a comment about E2E verification.

  **Must NOT do**:
  - Do NOT make `lateDiscoverSession` blocking for the event handler — it should remain fire-and-forget
  - Do NOT call `session.get()` for every event — only for late discovery (first time seeing a session ID)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small change — modify one function, add one method, add SDK call
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - None relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES (with Task 8)
  - **Parallel Group**: Wave 4 (with Task 8)
  - **Blocks**: None (final task)
  - **Blocked By**: Task 6 (dedup must be in place), Task 8 (lazy init provides `envInfoP` pattern)

  **References**:

  **Pattern References**:
  - `~/projects/opencode-pigeon/src/index.ts:25-52` — Current `lateDiscoverSession` function. Line 29: `onSessionCreated(sessionID, undefined)` — the bug (parentID always undefined).
  - `~/projects/opencode-pigeon/src/index.ts:129-131` — Where `lateDiscoverSession` is called from `message.updated` handler.

  **API/Type References**:
  - `~/projects/opencode/packages/plugin/src/index.ts` — Plugin SDK types. Look for `ctx.client.session.get()` method.
  - `~/projects/opencode/packages/sdk/js/src/gen/types.gen.ts` — Session type with `parentID` field.

  **External References**:
  - ChatGPT review: `/tmp/research-opencode-pigeon-review-answer.md:64-82` — "Use session.get() to resolve parentID when you late-discover"

  **WHY Each Reference Matters**:
  - `index.ts:29` — THE line with the bug: `undefined` passed where `parentID` should be resolved
  - SDK types — Need to verify `session.get()` API signature and response shape
  - `index.ts:129-131` — The call site — confirms `lateDiscoverSession` can remain fire-and-forget

  **Acceptance Criteria**:
  - [ ] `bunx tsc --noEmit` exits 0
  - [ ] `bun test` passes
  - [ ] `lateDiscoverSession` calls `ctx.client.session.get()` before `onSessionCreated`
  - [ ] Fallback: if `session.get()` fails, still registers with `parentID: undefined` (no regression)
  - [ ] New `isKnown()` method exists on `SessionManager`
  - [ ] New test: `isKnown` returns `true` for known sessions, `false` for unknown

  **Agent-Executed QA Scenarios:**

  ```
  Scenario: Late discovery resolves parentID
    Tool: Bash
    Steps:
      1. Run: grep -n "session.get" src/index.ts
      2. Assert: ctx.client.session.get is called in lateDiscoverSession
      3. Run: bunx tsc --noEmit && bun test
      4. Assert: exit code 0
    Expected Result: parentID resolved via SDK
    Evidence: grep + test output captured

  Scenario: Fallback when session.get fails
    Tool: Bash
    Steps:
      1. Run: grep -A5 "session.get.*catch" src/index.ts
      2. Assert: catch block falls back to onSessionCreated with undefined parentID
    Expected Result: Graceful degradation
    Evidence: grep output captured
  ```

  **Commit**: YES
  - Message: `fix(late-discovery): resolve parentID via session.get() before registration`
  - Files: `src/index.ts`, `src/session-state.ts`, `test/session-state.test.ts`
  - Pre-commit: `bunx tsc --noEmit && bun test`

---

## Commit Strategy

| After Task | Message | Key Files | Verification |
|------------|---------|-----------|--------------|
| 1 | `fix(logging): switch to client.app.log()` | index.ts, daemon-client.ts, logger.ts (deleted) | `bunx tsc --noEmit && bun test` |
| 2 | `fix(logging): serialize Error objects` | logger.ts or utils.ts | `bunx tsc --noEmit && bun test` |
| 3 | `refactor: replace const enum with as-const` | session-state.ts, daemon-client.ts | `bunx tsc --noEmit && bun test` |
| 4 | `refactor(session-state): remove dead debounce code` | session-state.ts, tests | `bunx tsc --noEmit && bun test` |
| 5 | `fix(daemon-client): check res.ok` | daemon-client.ts, tests | `bunx tsc --noEmit && bun test` |
| 6 | `feat(dedup): per-session notification dedup` | session-state.ts, message-tail.ts, index.ts, tests | `bunx tsc --noEmit && bun test` |
| 7 | `fix(session-state): await registration promise` | session-state.ts, index.ts, tests | `bunx tsc --noEmit && bun test` |
| 8 | `fix(init): lazy env detection` | index.ts, env-detect.ts | `bunx tsc --noEmit && bun test` |
| 9 | `fix(message-tail): tolerate out-of-order parts` | message-tail.ts, tests | `bunx tsc --noEmit && bun test` |
| 10 | `fix(memory): TTL eviction for stale sessions` | session-state.ts, message-tail.ts, index.ts, tests | `bunx tsc --noEmit && bun test` |
| 11 | `fix(late-discovery): resolve parentID via session.get()` | index.ts, session-state.ts, tests | `bunx tsc --noEmit && bun test` |

---

## Success Criteria

### Verification Commands
```bash
# Type-check (must exit 0)
bunx tsc --noEmit

# All tests pass
bun test

# No const enum in source
grep -r "const enum" src/ && echo "FAIL" || echo "PASS"

# No file-based logging (if client.app.log works)
test -f src/logger.ts && echo "FAIL: logger.ts exists" || echo "PASS"

# No dead debounce code
grep -r "IDLE_DEBOUNCE\|IdlePending\|clearTimer" src/ && echo "FAIL" || echo "PASS"
```

### Final Checklist
- [x] All "Must Have" present (zero runtime deps, export default only, no daemon changes)
- [x] All "Must NOT Have" absent (no debounce timers, no over-engineering, no desktop notifications)
- [x] All 45+ tests pass (test count will change: ~10 removed, ~15 added)
- [x] `bunx tsc --noEmit` exits 0
- [x] All 11 fixes implemented and committed
- [x] Git push to `github.com/johnnymo87/opencode-pigeon`

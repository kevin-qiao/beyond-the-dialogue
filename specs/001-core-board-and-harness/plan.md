# Implementation Plan: Core Board and Agent Harness

**Branch**: `feature/001-core-board-and-harness` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-core-board-and-harness/spec.md`

## Summary

Feature 001 is a **refactor-in-place** of the POC (ADR-0001), not a rewrite: the layer
shape of the target architecture (hosts → services → pure core → adapters → the single
portable data folder) is what the repo already has. The work is (1) closing the gaps
between the shipped board and spec 001 — List UI restored with *unassign* deletion
semantics, a real generic attachment feature (application-owned copies), overdue
presentation of missed alarms, secrets redacted from every interface and machine-bound
for copy-migration — and (2) demoting the assistant machinery (preprocess, suggestions,
finish behaviours beyond complete-only, chat, proposals, ingest) behind one declared
**assistant-runtime switch**, so the harness is configured and *inert* exactly as
FR-014/FR-015 require. Nothing is deleted yet; the switch is replaced per surface by the
002 redesign, which deletes what it supersedes.

## Technical Context

**Language/Version**: TypeScript (ESM) throughout; Node ≥ 22 for `node:sqlite` (built-in), Electron runtime for the app shells

**Primary Dependencies**: electron-vite; Pi coding-agent SDK (`@earendil-works/pi-coding-agent` / `pi-ai`, exact-pinned) used **only** at the existing seams (`agent-runtime.ts`, `session-factory.ts`, `mcpAdapter.ts`); `pi-mcp-adapter@2.35.0` via jiti; no new runtime dependencies planned

**Storage**: SQLite at `<userData>/app.db` (tasks, lists, settings, secrets moved out — see data-model) plus files under the one `<userData>` folder: `vault/` (existing), `attachments/` (new), `pi-agent/` (auth/models/mcp), `skills/`

**Testing**: `tsx --test` headless (node:test), no Electron, no network — existing suite plus new unit tests for attachment store, List unassign, secret redaction/machine binding, overdue alarm presentation, and the assistant-switch gate points; `npm run typecheck` (both named projects) as catalog-parity gate

**Target Platform**: Linux and Windows desktops (Electron); development happens under WSL2

**Project Type**: desktop-app, single repo, three build targets (`src/main`, `src/preload`, `src/renderer`) + `src/core`/`src/shared` compiled into both hosts (layering guard enforced)

**Performance Goals**: board interaction local-only, sub-frame; capture-to-saved < 10 s interaction (SC-001); cold start with 5,000 tasks renders the board in under 2 s (documented personal-use ceiling)

**Constraints**: offline-capable (FR-015: zero outbound calls for board operation); harness inert (FR-014); the whole board portable as one folder copy (FR-021); secrets never full-displayed and machine-bound after copy (FR-020); bilingual UI via the catalog ratchet (FR-017)

**Scale/Scope**: single local user; thousands of tasks, tens of Lists, hundreds of attachments (generous per-file size cap chosen at tasks phase); no sync, no accounts

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I — dispatch on declarations | The assistant switch is one declared setting read at the existing service choke points (`taskService` enqueue, `finishService`, job registration, chat) — no new `kind === …` branches; List/attachment behavior dispatched on entity rules in `src/core` | PASS |
| II — deterministic/dynamic boundary | Annotated below; 001 is deterministic by construction, the only dynamic-adjacent path (`ai:test-connection`) is an explicit user click with a stated-failure degradation | PASS |
| III — agentic by design | Pi SDK remains confined to the existing seam modules; no sessions are built while the switch is off; test seams unchanged | PASS |
| IV — unit tests for core | Every changed core rule (attachment, unassign, redaction, overdue, switch) gets headless tests; the layering/i18n/MCP guard tests must still fail on deliberate violations | PASS |
| V — Linux & Windows parity | Notification delivery and folder portability exercised on both targets in quickstart; WSL2 dev caveat documented, not a shipping excuse | PASS |
| i18n parity | New strings enter `en.ts` + `zhCn.ts` as keys; literal-drift ratchet stays empty | PASS |

**Principle II annotation — the deterministic/dynamic split for this feature:**

| Capability | Deterministic (code) | Dynamic (AI) | Degradation path |
|---|---|---|---|
| Board: tasks, Lists, alarms, attachments, views | all of it | none | n/a |
| AI readiness state (FR-016) | stored last-check result rendered plainly | none in 001 | never blocked on AI |
| `ai:test-connection` | the request/response plumbing, timeout, error mapping | the model's completion itself | failure → state "last check failed", config retained (US3-AC3) |
| Skills / tool servers | registration, enable/disable, storage | execution (002+) | inert by declaration (FR-014) — nothing reads them |
| Assistant legacy surfaces | switch: off → surfaces hidden, jobs refused, triggers no-op | — | board unaffected; artifacts preserved for 002 |

**Post-Phase-1 re-check**: PASS — data-model and contracts introduce no new dynamic surface; the switch keeps FR-014/015 literally testable; no complexity-tracking rows needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-core-board-and-harness/
├── plan.md              # this file
├── research.md          # Phase 0 — decisions, rationale, rejected alternatives
├── data-model.md        # Phase 1 — entities, migrations v10–v12, state rules
├── quickstart.md        # Phase 1 — validation/run guide per success criterion
├── contracts/
│   └── core-board-ipc.md   # the typed command/event surface for 001
└── tasks.md             # Phase 2 (/speckit-tasks) — NOT created here
```

### Source Code (repository root)

The existing tree **is** the target architecture's shape; 001 changes behavior inside it
rather than restructuring it. Touched areas marked; only two new modules are added.

```text
src/
├── shared/              # types.ts + ipc.ts: Attachment entity, command/event additions
├── core/                # domain: attachment.ts (new: pure attachment rules),
│   │                    #   categories/validation/i18n unchanged; services:
│   │                    #   taskService (list-delete unassign, switch-gated enqueues),
│   │                    #   settingsService (secrets redaction rules), assistant.ts (new:
│   │                    #   the switch declaration + isAssistantEnabled pure rule)
│   ├── i18n/            # new keys: attachments, list CRUD UI, overdue, readiness states
├── main/
│   ├── db.ts            # migrations v10 (secrets out), v11 (list_id nullable), v12 (task_attachments)
│   ├── paths.ts         # attachments/ under the data folder root
│   ├── tasks.ts         # unassign-on-list-delete; cascade purge of attachment rows
│   ├── alarms.ts        # overdue presentation at start (labeled, once)
│   ├── index.ts         # redacted settings in snapshot/events; attachment IPC handlers;
│   │                    #   job-handler registration gated by the switch
│   ├── secrets.ts       # (new adapter) machine-bound secret file: write/read/validate
│   └── adapters/…       # attachment store adapter (copy-in, relative paths, purge)
├── preload/             # pass-through for new channels
└── renderer/src/
    ├── components/board/   # ListsRail: real create/rename/delete; TaskDetail: attachments
    ├── components/overlays/ # SettingsView: readiness state; assistant sections hidden while off
    └── store.tsx           # snapshot merge for redacted settings + attachments

test/                    # unit + e2e-scripted additions per Constitution Check IV
doc/                     # architecture-layers.drawio (already committed — the plan's shape)
```

**Structure Decision**: keep the electron-vite three-host split with the pure
`src/core` domain layer and port/adapter boundaries as drawn in
`doc/architecture-layers.drawio`; the two new modules (`core/domain/attachment.ts`,
`core/domain/assistant.ts`) live in the pure core because both encode deterministic
rules the FRs test; `secrets.ts` is a main-process adapter because it is I/O. The
assistant legacy code (wiki, ingest, chat, preprocess, MCP) is **not restructured in
001** — it is switched off, reviewed by, and deleted or re-argued by the 002 redesign
per ADR-0001.

## Complexity Tracking

> No constitution violations — section intentionally empty per the gate.

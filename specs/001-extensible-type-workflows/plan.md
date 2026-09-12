# Implementation Plan: Extensible Type Workflows

**Branch**: `001-extensible-type-workflows` | **Date**: 2026-09-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-extensible-type-workflows/spec.md`

**Design artifacts**: [research.md](./research.md) · [data-model.md](./data-model.md) ·
[contracts/](./contracts) · [quickstart.md](./quickstart.md)

---

## Summary

Turn the task type from a fixed menu of three workflows into a declarative workflow
definition, and give the application a layered architecture that can be driven by more than
one front end.

Four deliverables:

1. **A Meeting type** — pre-processes to a suggested agenda and core topics, offers a
   markdown minutes editor, and on Finish polishes the minutes and files them as plain
   markdown into a configured folder.
2. **Per-type output destinations** — the destination stops being one application-wide wiki
   path and becomes a declaration on the type, resolved through the confinement check the
   wiki ingest path already relies on. The existing Learning behaviour is preserved exactly
   by expressing it as one type's declaration.
3. **User-defined types that declare their own artifact, finish behaviour, and prompt** —
   four fixed finish behaviours (`complete-only`, `file-as-is`, `polish-then-file`,
   `deposit-then-curate`), replacing a hardcoded kind comparison.
4. **Live plugin grants** — skills and tool servers become usable by agent sessions, granted
   per type, with confined operations receiving nothing by construction. MCP support is
   adopted from a community adapter rather than written; remote changes are structurally
   un-makeable by the model without a per-change user confirmation.

The architectural work is not incidental to these: the destination, behaviour, and grant
declarations only become expressible once workflow orchestration moves out of the IPC
handlers into a host-agnostic core.

---

## Technical Context

**Language/Version**: TypeScript 5.6, targeting ES2022. Node.js ≥ 22 required (`node:sqlite`);
the packaged app runs on Electron's bundled Node.

**Primary Dependencies**: Electron 44, React 18, `node:sqlite` (built-in), CodeMirror 6,
`@earendil-works/pi-coding-agent` / `pi-ai` ^0.84.4 (the agent runtime, pinned, already
confined to adapter modules). P4 additionally introduces the community package
`pi-mcp-adapter`, pinned to an exact version — see Complexity Tracking.

**Storage**: SQLite via `node:sqlite` (synchronous, so no `await` around DB calls), plus
vault files under the user data directory and user-owned markdown files at configured
destinations. Schema version 4 today; this feature adds version 5.

**Testing**: `node:test` + `tsx`, headless — no Electron, no network, no API key. Agent
sessions are replaced with scripted stand-ins through `setSessionFactory` /
`setSimplePromptOverride`; each test redirects its own storage root via `setUserDataRoot`.
Eleven existing test files, ~1570 lines.

**Target Platform**: Windows and Linux desktop. The core must additionally remain
host-neutral so a web front end can drive it later; building that front end is out of scope.

**Project Type**: Desktop application, single repository, four layers
(`shared` → `core` → `main` adapters → hosts).

**Performance Goals**: No new target. Two behavioural requirements carry latency
implications rather than numeric ones: a finish must validate its destination **before**
marking the task complete, so the user learns about a bad destination while the task is
still actionable; and polish latency is bounded by the configured provider, with a
degradation path rather than a blocking failure.

**Constraints**:
- `src/core/` MUST NOT import `electron`, `node:*`, or DOM globals — it is bundled into
  both the main and renderer targets.
- Local-first: all persisted state under the platform user data directory. No network
  dependency for any non-AI function.
- No credential material in the repository or in settings.
- The agent runtime and the MCP adapter stay behind their adapter seams.
- Packaging targets are host-platform specific; native modules require per-platform builds.

**Scale/Scope**: Single-user local application. Four behaviour categories, four finish
behaviours, one new built-in type. Roughly 31 existing transport commands; ~10 of them
currently hold logic that moves into the core.

---

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1 design.*

| # | Gate | Status | Evidence |
|---|---|---|---|
| I | **Cross-platform desktop** | **PASS with a tracked risk** | Feature code is platform-neutral; paths continue to resolve through the centralized path module. The MCP adapter introduces native modules (`@napi-rs/keyring`, `fs-native-extensions`) needing per-platform builds, and Linux keyring typically needs `libsecret`. Verification is a named gate before P4 completes (`quickstart.md` S9); an unexercised platform must be recorded, not assumed. |
| II | **Clean, simple UI; function before polish** | **PASS** | No new surface beyond a settings section for behaviour/destination/grants and a minutes editor that reuses the existing markdown editor. The plan deliberately rejects a history directory for artifacts (FR-026 uses distinct names instead), on the ground that invisible machinery next to the user's notes must justify itself. |
| III | **Layered architecture** | **PASS — this is the core of the plan** | Populates the reserved `src/core/` layer, introduces ports and adapters, and removes the hardcoded finish branch at `src/main/index.ts:348` in favour of declared behaviours and destinations. All external runtimes (Pi SDK, MCP adapter) remain behind adapter seams. |
| IV | **Complete unit test coverage (NON-NEGOTIABLE)** | **PASS** | Every new core module gets tests. All scenarios run headless with scripted sessions and isolated storage roots. Two regression boundaries are pinned by test: the learning flow (SC-003) and the silent-plain-fallback hazard (S7). |
| V | **Git-managed development** | **PASS** | Spec, plan, and design artifacts committed alongside code. No build artifacts, no credentials. The MCP adapter's OAuth/credential-store surface is explicitly constrained out of settings and logs. |
| VI | **Avoid hardcoding** | **PASS, with debt paid** | The category set is currently restated in four places (`data-model.md` §7.4); this plan collapses them to one declaration and retires the dead `BUILTIN_TYPE_KEYS`. The SQL `CHECK` literals cannot reference a TypeScript constant — they remain literal and MUST carry a comment naming the declaration they mirror, which is exactly the unavoidable case the principle covers. |
| — | **Platform & technology constraints** | **PASS with one justified deviation** | Node ≥22, Electron three-process split, TypeScript, ESM main, local-first, pinned agent runtime all hold. The MCP adapter adds a dependency whose transitive pins are not published npm versions — recorded in Complexity Tracking. |
| — | **Quality gates (all 7)** | **PASS** | Tests, typecheck, behaviour coverage, layering, both platforms considered, specs current, no unexplained hardcoding. Gate 7 is satisfied by the category-list consolidation plus the commented `CHECK` literals. |

**No gate fails.** One deviation requires justification and is recorded in Complexity
Tracking below.

---

## Project Structure

### Documentation (this feature)

```text
specs/001-extensible-type-workflows/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — decisions R1–R11
├── data-model.md        # Phase 1 — entities, transitions, migration
├── quickstart.md        # Phase 1 — validation scenarios S0–S9
├── checklists/
│   └── requirements.md  # Spec quality checklist
├── contracts/
│   ├── app-client.md          # Layering + host-agnostic client contract
│   ├── type-definition.md     # The declarative type contract
│   ├── finish-behaviours.md   # The four finish strategies
│   ├── destination.md         # Destination + confinement contract
│   └── plugin-grants.md       # Grants, confinement, egress, remote actions, MCP
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

As built. See "Structure deviations" below for where this differs from the layout
originally proposed, and why.

```text
src/
├── shared/                        # The contract. Pure types + constants.
│   ├── types.ts                     #   + finishBehaviour, Destination, PluginGrant, meeting
│   └── ipc.ts                       #   + typed AppCommands/AppEvents maps
│
├── core/                          # NEW — domain + application. No electron, node:*, or DOM.
│   ├── README.md                    #   the layering rule, in one paragraph
│   ├── domain/
│   │   ├── categories.ts            #   the single category + finish-behaviour declaration
│   │   ├── taskType.ts              #   effective type, declared workflow, category legacy
│   │   ├── validation.ts            #   input + type-definition validation
│   │   ├── destination.ts           #   resolution + confinement + override confinement
│   │   ├── finish.ts                #   the four finish strategies + the polish bound
│   │   ├── grant.ts                 #   grant resolution, egress, propose/confirm
│   │   ├── chatContext.ts           #   per-category chat grounding (T076)
│   │   ├── preprocess.ts            #   per-category pre-process registry
│   │   ├── hashing.ts               #   pre-process input hash
│   │   ├── slug.ts                  #   filename derivation + distinct-name collision
│   │   ├── workingArea.ts           #   category → surface, finish affordance wording
│   │   ├── plugins.ts               #   skills/MCP entry validation
│   │   └── config.ts                #   isConfigured
│   ├── services/
│   │   ├── finishService.ts         #   finish orchestration (was index.ts:321-355)
│   │   ├── taskService.ts           #   create/edit/My Day (was index.ts:202-255, :279-296)
│   │   ├── preprocessService.ts     #   pre-process guards (was index.ts:256-266) (T079)
│   │   └── settingsService.ts       #   settings save + plugin validation
│   └── ports/
│       ├── storage.ts               #   StoragePort — the repository seam
│       ├── artifactStore.ts         #   ArtifactStorePort — prepare/write/deposit/snapshot/diff
│       ├── agent.ts                 #   AgentSessionPort + resolveGrant re-export
│       ├── notifier.ts              #   NotifierPort
│       ├── clock.ts                 #   ClockPort
│       └── paths.ts                 #   PathPort — path primitives, so core stays platform-free
│
├── main/                          # Electron host + adapters
│   ├── index.ts                     #   composition root: adapters → services → transport
│   ├── adapters/
│   │   ├── sqlite/storageAdapter.ts #     StoragePort over db.ts
│   │   ├── artifacts/
│   │   │   ├── wikiStore.ts         #     wiki artifact store (delegates to wiki/*)
│   │   │   ├── folderStore.ts       #     NEW — plain-folder artifact store
│   │   │   ├── deposit.ts           #     shared deposit-first helper
│   │   │   └── index.ts             #     destination.store → store lookup
│   │   ├── agent/sessionAdapter.ts  #     AgentSessionPort over the Pi SDK seam
│   │   ├── notifier.ts              #     NotifierPort over the IPC broadcast
│   │   └── paths.ts                 #     PathPort over node:path
│   ├── db.ts                        #   SQLite store + migrations (v5, v6, v7)
│   ├── types.ts                     #   db-bound wrappers over the core domain rules
│   ├── job-queue.ts                 #   the persisted queue
│   ├── tasks.ts, alarms.ts, plugins.ts, paths.ts, skills.ts
│   ├── preprocess.ts                #   preprocess job host (uses the core registry)
│   ├── suggestions.ts               #   suggestion job
│   ├── ai/                          #   Pi-SDK seams: agent-runtime, session-factory, chat, triggers
│   └── wiki/                        #   wiki.ts, vault.ts, ingest.ts (deposit-then-curate host)
│
├── preload/                       # Electron host implementation of the client contract
└── renderer/                      # UI. Imports only src/shared and src/core.
    └── src/lib/typeCatalog.ts       #   renderer-side effective-type resolution

test/                                # 20 files, all headless
├── (existing 11 — the learning ones pass UNMODIFIED: wiki, queue, failure)
├── destination.test.ts              #   resolution, confinement, forward-only retargeting
├── artifactStore.test.ts            #   folder-store failure paths, collisions, the audit walk
├── finish.test.ts                   #   the four behaviours + the polish bound + degradation
├── finishService.test.ts            #   ordering: validate before completing
├── grants.test.ts                   #   grant resolution, confinement, egress, propose/confirm
├── chatContext.test.ts              #   per-category grounding + the meeting regression
├── workingArea.test.ts, categories.test.ts, preprocessService.test.ts,
├── taskService.test.ts, sessionAdapter.test.ts, mcpAdapter.test.ts, layering.test.ts
└── helpers/finishHarness.ts         #   shared finish setup
```

### Structure deviations

Recorded rather than silently taken, because the "Structure Decision" below is a boundary
claim and a claim that no longer matches the tree is worse than a narrower one.

| Proposed | As built | Why |
|---|---|---|
| `main/jobs/` for the job handlers | handlers stay at `src/main/{preprocess,suggestions}.ts` and `src/main/wiki/ingest.ts` | Each is now a thin host over a core strategy or registry. Moving them would churn imports that three test files depend on and the implementation tasks forbid editing. |
| `main/transport/ipc.ts` | IPC registration stays in `src/main/index.ts` | The handlers are thin enough that a separate module would add a file boundary without enforcing one. The composition root still does exactly the three things the contract names. |
| `adapters/sqlite/db.ts`, `migrate.ts` | `db.ts` stays at `src/main/db.ts`; the port impl is `adapters/sqlite/storageAdapter.ts` | `db.ts` is imported directly by **13** test files. Moving it breaks the SC-003 boundary for no boundary gain — the port is what matters, and the adapter provides it. |
| `adapters/agent/runtime.ts`, `sessionFactory.ts` | retained at `src/main/ai/{agent-runtime,session-factory}.ts` | `session-factory` is the documented test seam and is imported by three test files. `sessionAdapter.ts` is the port implementation over it. |
| a `polish` job handler | none — polishing runs inside the finish | `polish-then-file` must not mark the task complete until the artifact is written, so the polish is awaited by the finish service rather than handed to the queue. The plan's own performance goal ("polish latency is bounded by the configured provider, with a degradation path") is met by the degradation path, and progress is still reported through `onStep`. |

**Structure Decision**: Single repository, layered in place rather than split into
workspace packages. `src/core/` is not a new directory — it is already listed in the
`include` array of both `tsconfig.node.json` and `tsconfig.web.json` and has been since the
initial scaffold commit, so the build already expects a layer importable by the main
process and the renderer alike. Filling it costs no new tooling and gives the web-host
boundary compile-time enforcement: an `electron` or `node:*` import in `src/core/` fails
the typecheck in the project that cannot support it.

---

## Implementation Sequencing

Ordered so each step is independently verifiable. P1–P3 do not depend on P4's outcome.

| Phase | Work | Gate |
|---|---|---|
| 0 | **Capture the baseline** — `npm test`, `npm run typecheck`, record the result | Required before any code change; makes SC-003 attributable |
| 1 | **Core layer + ports** — create `src/core/`, move type-engine rules and validation, define ports, keep behaviour identical | Existing tests pass unmodified |
| 2 | **Category widening** — schema v5: three table rebuilds, new columns, Meeting seed, collapse the four category lists | Migration tests on a legacy database; S7 (no silent fallback) |
| 3 | **Destinations** — descriptor, resolution, confinement, folder store, extend the snapshot/diff walk | S2, S6 (collision, refusal, audit trail) |
| 4 | **Finish behaviours** — four strategies, removed kind branch, Meeting end to end | S1, S5 (learning unchanged — existing tests unmodified) |
| 5 | **User-defined types** — settings surface for behaviour/destination/prompt | S3 |
| 6 | **Grants (P4)** — grant seam, confined-session conformance, egress boundary, propose-then-confirm | S4, S8 |
| 7 | **MCP adapter (P4)** — adopt, pin, verify the dependency gates on both platforms | S9 + the Complexity Tracking gates; fall back to R7a if they fail |
| 8 | **Cross-platform validation** | S9; record any platform limitation explicitly |

Sequencing note: phases 1–2 are prerequisites for phase 3, which is a prerequisite for
phase 4. Phases 6 and 7 are independent of 3–5 except that grants are declared on a type,
so the field must exist (phase 2).

---

## Complexity Tracking

One constitution deviation requires justification.

| Violation / risk | Why needed | Simpler alternative rejected because |
|---|---|---|
| **New dependency `pi-mcp-adapter` with non-npm transitive pins and two native modules.** Its `@modelcontextprotocol/client` and `@modelcontextprotocol/core` resolve to `pkg.pr.new` preview commit URLs rather than published npm versions; it pulls `@napi-rs/keyring` and `fs-native-extensions` (per-platform native builds), plus an `@earendil-works/pi-tui` terminal-UI peer. | The agent runtime has **no MCP support at all** — a deliberate product decision. Its own documentation states it and directs users to build an extension. There is no MCP module, example, or dependency to enable, so a package is the only route that avoids writing MCP connection code, which the user explicitly excluded. | *Writing the bridge ourselves* — excluded by user direction. *Adopting the official `@modelcontextprotocol/sdk` behind a thin extension* — still requires authoring a Pi extension, the excluded thing. *Deferring MCP entirely* — retained as the fallback (research R7a), not the default, because a vetted community package exists. |
| **Mitigation and gates.** The deviation is bounded rather than accepted blindly. | | |
| — Exact-version pin, consistent with the existing rule that the agent runtime is pinned and not floated. | | |
| — A clean `npm install` must succeed reproducibly on **both** platforms with resolved artifacts recorded in the lockfile, before P4 is declared done. | | |
| — Native module builds verified on Windows and Linux; the Linux secret-service requirement documented alongside existing packaging prerequisites. | | |
| — The terminal-UI peer must be satisfiable without shipping a terminal renderer into a GUI app. | | |
| — If any gate fails, the tool-server half is deferred and **FR-018 must be amended** rather than left claiming unbuilt behaviour. The grant seam, confinement guarantee, and all of P1–P3 ship regardless. | | |

**Outcome (2026-09-12).** The gates were run. **The tool-server half was deferred**: T061
failed on its stated criterion — the pinned adapter resolves `@modelcontextprotocol/client`
and `@modelcontextprotocol/core` to `pkg.pr.new` preview commit URLs rather than published
npm versions — and the native-module, terminal-UI and credential-containment gates could
not be completed (Linux only; the Windows half unexercised). The fallback recorded above
was therefore invoked: the grant seam, confinement, egress boundary and propose/confirm
model ship and are tested, and FR-018 was amended rather than left claiming unbuilt
behaviour. Evidence: `research.md` R7a.

**No other complexity is introduced.** Notably, the plan rejects a workspace-package split
(the reserved directory achieves the same boundary at zero tooling cost), rejects a
per-artifact history directory (FR-026 uses distinct names in the user's own folder), and
rejects lifting all 31 transport handlers at once (only the ~10 the feature must touch
move).

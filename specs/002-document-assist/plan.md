# Implementation Plan: Document Type AI Assistant

**Branch**: `feature/002-document-assist-plan` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-document-assist/spec.md`

## Summary

002 is the **re-argument in place** that ADR-0001 promised: it lights the harness 001
made inert, on the master specification's taxonomy, and deletes the reference
implementation's category-keyed assistance. Concretely: (1) the vocabulary switches from
the four POC categories to **Families** (`document | working-system | coding`, plus
family-less no-assist Types like `plain`), declared once in core and mirrored (with
rebuild discipline) into SQL — migrations v13–v15 retire `kind`, re-home every task that
pointed at a deleted built-in, and keep all user data; (2) the **Document loop** — the
working area is the existing per-task note re-argued as a declared surface; Finish offers
organize vs as-written (FR-003) with the existing `verifyPolish` traceability gate
re-argued as the deterministic validator of the organizing step (FR-005), filing to the
Type's declared destination (which ships unpointed on the generic built-in — first Finish
is the guided refusal, FR-007); (3) **conversation** becomes task-owned durable state
(new tables, per-turn confined sessions disposed at end of turn), grounded by
declaration, available on every task (FR-008); (4) the **knowledge-base destination** is
carried forward as `deposit-then-curate` with its guarantee re-argued — create-only
scaffold on first destined finish, snapshot taken after the deposit so **undo reverses
curation without touching the deposit** (Q3=A), ledger + retry unchanged, new explicit
undo action. Grants stay inert by construction (FR-015): no Type ships one, no UI offers
one, and `resolveGrant` still cannot yield reach for the confined purposes.

## Technical Context

**Language/Version**: TypeScript (ESM) throughout; Node ≥ 22 for `node:sqlite` (built-in), Electron runtime for the app shells

**Primary Dependencies**: unchanged — electron-vite; Pi coding-agent SDK (`@earendil-works/pi-coding-agent` / `pi-ai`, exact-pinned) used **only** at the existing seams (`agent-runtime.ts`, `session-factory.ts`, `chat.ts`, `mcpAdapter.ts`); no new runtime dependencies planned (MCP/skills machinery stays registered-but-inert, reached by nothing this feature)

**Storage**: SQLite at `<userData>/app.db` — new tables for conversations/messages and ingest-undo bookkeeping; re-built tables retiring the category `CHECK` restatements; files under `<userData>` unchanged in kind: `vault/notes/<taskId>.md` **is** the working-area draft (re-argued, not forked), `attachments/`, `pi-agent/`; the knowledge base lives at each wiki-destined Type's declared root (outside the data folder, by design — FR-024)

**Testing**: `tsx --test` headless (node:test), no Electron, no network — scripted sessions at the existing seams; new unit tests per Principle IV (finish-mode dispatch, traceability gate, destination-less refusal, conversation persistence, undo-restores-curation-not-deposit, create-only scaffold, family registry totality); existing guard tests re-keyed (chatContext totalities, i18n literal ratchet, layering, portability scan); `npm run typecheck` (both named projects) remains the catalog-parity gate

**Target Platform**: Linux and Windows desktops (Electron); development happens under WSL2

**Project Type**: desktop-app, single repo, three build targets (`src/main`, `src/preload`, `src/renderer`) + `src/core`/`src/shared` compiled into both hosts (layering guard enforced)

**Performance Goals**: personal-use ceilings inherited from 001 (cold board < 2 s at 5,000 tasks); working-area save round-trip local-only sub-frame; assistant steps are user-initiated runs whose latency is the model's — UI reports step state, never blocks the board (SC-001/SC-002)

**Constraints**: every Document assistance confined — structurally, because purposes resolve NO_GRANT and nothing grants (FR-015); zero outbound calls on the as-written and degraded paths and while the switch is off (FR-021, SC-002); agent output never persisted unvalidated (traceability gate + JSON-out on curate); no file outside a declared destination is ever written (single confinement implementation); bilingual catalogs; both platforms

**Scale/Scope**: single local user; thousands of tasks, one knowledge base per wiki-destined Type, conversations of tens of turns each; curate jobs bounded by the existing per-run caps; no sync, no accounts

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I — dispatch on declarations | The POC's `kind === …` ternaries are deleted with their engines; chat grounding and finish dispatch read the Type's **declarations** (family, inputs, instruction, finishBehaviour, destination); the family set is declared once and the SQL `CHECK` restatements carry the naming comment; no branch on a type key outside dispatch registries | PASS |
| II — deterministic/dynamic boundary | Annotated below; organizing, curating, and conversation are the three dynamic steps, each with a deterministic validator or structural confinement and a stated degradation; confirmation machinery is untouched (no remote writes in scope) | PASS |
| III — agentic by design | All runtime use stays at the seams; curate runs as the persisted job (retry/backoff/requeue, disposal contract honored — sessions disposed, not just aborted); conversational turns build ephemeral in-memory sessions disposed at turn end; confined purposes remain incapable of yielding grants | PASS |
| IV — unit tests for core | Headless tests for every new/changed core rule (see Testing); every touched guard test re-verified to fail on a deliberate violation; both typecheck projects still named explicitly | PASS |
| V — Linux & Windows parity | Working area, conversation, destination confinement, undo, and the bilingual finish flow exercised on both targets in quickstart; path handling stays through `src/main/paths.ts` and the confinement helper (single implementation) | PASS |
| i18n parity | New strings (finish choice, refusal guidance, conversation surface, undo) enter `en.ts` + `zhCn.ts`; the literal-drift ratchet stays empty | PASS |

**Principle II annotation — the deterministic/dynamic split for this feature:**

| Capability | Deterministic (code) | Dynamic (AI) | Degradation path |
|---|---|---|---|
| Working area (draft persistence) | note store, vault mirror, portability | none | n/a |
| Finish choice (FR-003) | mode parameter, default from declaration, as-written files exact text | the organizing run itself | as-written chosen or forced → no session built at all |
| Organize-then-file (FR-005/006) | `verifyPolish` traceability gate (re-argued), destination resolve + confinement, collision-distinct filing, file-as-is fallback | re-organizing the user's draft per the Type's declared instruction | off/unconfigured/failed/refused-by-gate → draft filed as written, step reported failed, task still completes |
| Destination refusal (FR-007) | resolve + `isRelativeStoredPath`/confinement check, localized issue codes | none | refusal names what to fix; task stays actionable |
| Knowledge-base destination (FR-018) | deposit copy (slug + distinct names), create-only scaffold, snapshot **after** deposit, ledger records | the confined curation agent (read/write/edit/grep/find/ls; no shell; cwd = collection) | deposit survives every curation outcome; failure → ledger 'failed', retryable from Activity |
| Curation undo (FR-020, Q3) | snapshot restore of touched curated files; deposits excluded from rollback; ledger 'undone' state | none in the undo itself | undo of a never-completed curation is refused with reason |
| Conversation (FR-008–FR-011) | per-task persistence (SQLite), grounding constructed from the task's own material at context-build time, session disposal | the model's replies | unconfigured/off → surface states why; board unaffected; send failure keeps history intact |
| Grants (FR-015) | every purpose resolves NO_GRANT; no Type carries one; no UI path to set one | — | structural, not prompted: the reach does not exist this feature |

**Post-Phase-1 re-check**: PASS — the design adds three dynamic surfaces (organize, curate, converse), all confined and all with coded degradation paths as above; no new ports without adapters, no new dispatch outside registries; no Complexity Tracking rows needed.

## Project Structure

### Documentation (this feature)

```text
specs/002-document-assist/
├── plan.md              # this file
├── research.md          # Phase 0 — decisions, rationale, rejected alternatives
├── data-model.md        # Phase 1 — family taxonomy, conversations, ledger/undo, migrations v13–v15
├── quickstart.md        # Phase 1 — validation guide per success criterion
├── contracts/
│   └── document-assist-ipc.md  # the typed command/event additions
└── tasks.md             # Phase 2 (/speckit-tasks) — NOT created here
```

### Source Code (repository root)

The 001 tree remains the architecture; 002 **replaces** the switched-off assistant
surfaces rather than adding beside them. Areas touched; deleted ones marked, two new core
modules.

```text
src/
├── shared/              # types.ts: TaskTypeDef gains family?: Family, loses kind;
│                        #   Conversation/CurationUndo types; ipc.ts: new channels (contracts/)
├── core/
│   ├── domain/          # family.ts (new: the declared family set — leaf, mirrors into SQL
│   │                    #   CHECKs with the naming comment); categories.ts retired (its
│   │                    #   finish/destination declarations move with it);
│   │                    #   finish.ts: polish-then-file re-argued as organize (generic
│   │                    #   instruction-driven, action-item append removed with the
│   │                    #   minutes engine); grant.ts unchanged (confined = NO_GRANT);
│   │                    #   preprocess.ts + hash/trigger registry DELETED;
│   │                    #   chatContext.ts re-keyed: grounding built from declarations
│   ├── i18n/            # new keys: finish choice, refusal guidance, conversations, undo
│   └── services/        # finishService: finish mode ('assisted' | 'as-written');
│                        #   conversationService (new port + service: per-task persistence)
├── main/
│   ├── db.ts            # migrations v13 (task_types.family + seed surgery + re-home),
│   │                    #   v14 (conversations/messages), v15 (ledger undo columns);
│   │                    #   CHECK rebuilds per the gated-rebuild discipline
│   ├── types.ts         # effectiveTypeDef reads declarations; effectiveKind deleted
│   ├── preprocess.ts / suggestions.ts   # DELETED (job kinds unregistered; rows stay)
│   ├── ai/              # chat.ts: persisted turns, per-turn session + dispose;
│   │                    #   triggers.ts: preprocess-on-add deleted; session-factory seam unchanged
│   ├── wiki/            # ingest.ts: snapshot-after-deposit pinned by test; undo action;
│   │                    #   scaffold call sites unchanged (create-only already true)
│   ├── adapters/        # conversation storage adapter (sqlite); artifacts stores unchanged
│   └── index.ts         # command handlers for the new channels; localized refusals
├── preload/             # pass-through for new channels
└── renderer/src/
    ├── components/focus/  # working area = the note editor, now declared-surface;
    │                      #   ChatPanel → persisted conversations (list + new-conversation);
    │                      #   finish choice UI at the TaskBand finish step
    ├── components/overlays/ # Type editor: family + instruction + destination (no grants
    │                        #   section — it does not exist yet); ActivityView: undo curation
    └── typeCatalog.ts / store.tsx  # family-aware; snapshot merge for conversations

test/                    # per Constitution Check IV; deleted-engine guards removed
docs/adr/                # (unchanged — ADR-0001 is the mandate this plan executes)
```

**Structure Decision**: single-repo electron-vite split preserved. `core/domain/family.ts`
is added (pure declaration, leaf) and `categories.ts` is **retired**, not repurposed —
keeping a vocabulary CONTEXT.md explicitly avoids would leave two truths. The new
`conversationService` enters through a port because it is I/O; the working area adds no
storage at all (the draft is the existing per-task note — one content, two names would
fork the truth). Deleting `preprocess`/`suggestions` removes two of the three registered
job kinds; the job machinery itself is untouched and the `ingest` job carries the curation
run exactly as the POC proved it, with the re-argued ordering pinned by a test.

## Complexity Tracking

> No constitution violations — section intentionally empty per the gate.

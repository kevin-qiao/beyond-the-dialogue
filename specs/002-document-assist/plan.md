# Implementation Plan: Document Type AI Assistant

**Branch**: `feature/002-document-assist-plan` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-document-assist/spec.md`

## Summary

Feature 002 changes the application in place. ADR-0001 required this review. Feature
001 made the agent harness configured but idle. This feature starts the first
assistance family, Document, and deletes the POC assistance built on task categories.

The work has five parts:

1. The vocabulary changes. The four POC categories are replaced by Families:
   `document`, `working-system`, and `coding`. One file in `src/core` declares this
   set. Migrations v13–v15 update the database. Types without a family, such as
   `plain`, need no assistance.
2. The Document loop starts. The working area is the existing per-task note. The
   Finish step offers two paths: organize the draft, or file it as written. The Type
   declaration sets the default. A code check validates any organized text before the
   app files it.
3. Conversations become durable. A task can hold conversations with the assistant.
   They survive restarts. The app stores them in SQLite. Each turn builds a short-lived
   agent session and disposes it when the reply ends.
4. The knowledge-base destination is kept and reviewed. A finish first deposits the
   user's material. Then the agent curates the collection. Undo reverses only the
   curation. It never removes the deposit.
5. Grants stay inert. No Type grants skill or tool-server access in this feature. The
   grant code cannot return access for the purposes this feature uses. This is a code
   fact, not a setting.

## Technical Context

**Language/Version**: TypeScript (ESM) everywhere. Node ≥ 22, for the built-in
`node:sqlite`. Electron hosts the app shells.

**Primary Dependencies**: unchanged. electron-vite; the Pi coding-agent SDK
(`@earendil-works/pi-coding-agent` / `pi-ai`), pinned to exact versions, used only at
the existing seams: `agent-runtime.ts`, `session-factory.ts`, `chat.ts`,
`mcpAdapter.ts`. No new runtime dependency is planned. The MCP and skills machinery
stays registered but unused, as 001 left it.

**Storage**: SQLite at `<userData>/app.db`. New tables store conversations and messages,
plus curation-undo records. Rebuilt tables remove the old category checks. Files under
`<userData>` keep their current kinds: `vault/notes/<taskId>.md` is the working-area
draft — the same file, a new meaning; `attachments/`; `pi-agent/`. The knowledge base
lives at the location each wiki-destined Type declares. That location is outside the
data folder by design (FR-024).

**Testing**: `tsx --test`, headless (node:test). No Electron, no network. Agent
behaviour is scripted at the existing seams. New unit tests cover: the finish-mode
dispatch, the organize validation gate, the refusal for a destination-less Type,
conversation persistence, the rule that undo restores curation but not deposits, the
create-only wiki setup, and totality over the family registry. Existing guard tests are
updated with the vocabulary change (chatContext coverage, i18n literal check, layering,
portability scan). `npm run typecheck` names both projects and stays the catalog
parity gate.

**Target Platform**: Linux and Windows desktops (Electron). Development happens under
WSL2.

**Project Type**: desktop app, single repo. Three build targets (`src/main`,
`src/preload`, `src/renderer`) plus `src/core` and `src/shared`, which compile into
both hosts. The layering guard enforces the boundary.

**Performance Goals**: the board is local-only and stays under that one-frame feel.
Capture-to-saved under 10 seconds (001's SC-001). Cold start with 5,000 tasks renders
the board in under 2 seconds. Assistant steps are user-started; their wait time belongs
to the model. The UI reports each step and never blocks the board for AI (SC-001/SC-002).

**Constraints**: every Document assistance is confined. The purpose resolver returns no
grant, and no Type carries one (FR-015). The as-written path and every degraded path
make zero outbound calls. So does the whole app while the assistant switch is off
(FR-021, SC-002). No agent output is stored before a code validation accepts it. No
file outside a declared destination is ever written; one confinement helper implements
that rule. The UI is bilingual. Both platforms are required.

**Scale/Scope**: one local user. Thousands of tasks. One knowledge base per
wiki-destined Type. Conversations of tens of messages. The existing per-run caps bound
curation. No sync, no accounts.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|---|---|---|
| I — dispatch on declarations | The category branches (`kind === …`) are deleted with the engines that needed them. Chat grounding and Finish read the Type's declarations: family, inputs, instruction, finish behaviour, destination. The family set is declared once. Its SQL checks carry the comment that names the source file. No branch uses a Type key outside the dispatch registries | PASS |
| II — deterministic/dynamic boundary | Annotated in the table below. The feature has three dynamic steps: organize, curate, converse. Each one has a code validator or a structural confinement, and each one has a written degradation path. Nothing in scope writes to a remote system, so the confirmation machinery is not touched | PASS |
| III — agentic by design | All SDK use stays inside the named seam modules. Curation runs as the persisted job: retry, backoff, progress, requeue after a crash, and an explicit dispose — stopping is not disposing. Chat turns build an in-memory session and dispose it at the end of the turn. A confined purpose cannot produce a grant | PASS |
| IV — unit tests for core | Every new or changed core rule has a headless test (see Testing). Each touched guard test is verified to fail on a deliberate violation. Both typecheck projects stay named in the script | PASS |
| V — Linux & Windows parity | The quickstart exercises the working area, conversations, destination confinement, undo, and the bilingual finish flow on both targets. Path work goes through `src/main/paths.ts` and the confinement helper, each the single implementation | PASS |
| i18n parity | New UI strings (finish choice, refusal messages, conversation surface, undo) enter `en.ts` and `zhCn.ts`. The literal-drift baseline stays empty | PASS |

**Principle II annotation — the deterministic/dynamic split for this feature:**

| Capability | Deterministic (code) | Dynamic (AI) | Degradation path |
|---|---|---|---|
| Working area (draft persistence) | note store, vault file, portability | none | not applicable |
| Finish choice (FR-003) | mode parameter; the Type sets the default; the as-written path files the exact text | the organize run | if as-written is chosen or forced, no session is built at all |
| Organize-then-file (FR-005/006) | the re-argued `verifyPolish` traceability check; destination resolve and confinement; distinct names on collision; the file-as-written fallback | the assistant re-organizes the draft using the Type's declared instruction | off, unconfigured, failed, or the check refuses the draft: the app files the draft as written, marks the assistant step failed, and still completes the task |
| Destination refusal (FR-007) | resolve plus the confinement check; localized issue codes | none | the refusal states what to fix; the task stays actionable |
| Knowledge base (FR-018) | deposit copy (slug, distinct names); create-only setup; snapshot taken after the deposit; the ledger record | the confined curation agent (read, write, edit, grep, find, ls; no shell; cwd = the collection) | the deposit survives every later failure; a failed curation shows in the ledger and can be retried from the Activity view |
| Curation undo (FR-020, Q3) | restore of the touched curated files from the snapshot; deposits are outside the rollback; the ledger gains an `undone` state | none | undo of a curation that never completed is refused with a reason |
| Conversation (FR-008–FR-011) | task-owned storage in SQLite; the grounding block is built from the task's own material when the context is created; session disposal | the model's replies | off or unconfigured: the surface states why it is unavailable; the board is unaffected; a failed send keeps the stored history intact |
| Grants (FR-015) | every purpose resolves to NO_GRANT; no Type carries one; the UI shows no grants control | — | structural: this feature has no external reach at all, so nothing to degrade |

**Post-Phase-1 re-check**: PASS. The design adds three dynamic surfaces (organize,
curate, converse). All three are confined, and all three degrade in code, as the table
above states. No new port exists without its adapter. No new dispatch happens outside a
registry. The Complexity Tracking section stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-document-assist/
├── plan.md              # this file
├── research.md          # Phase 0 — decisions, reasons, rejected alternatives
├── data-model.md        # Phase 1 — families, conversations, ledger/undo, migrations v13–v15
├── quickstart.md        # Phase 1 — validation guide per success criterion
├── contracts/
│   └── document-assist-ipc.md  # the typed command and event additions
└── tasks.md             # Phase 2 (/speckit-tasks) — NOT created here
```

### Source Code (repository root)

The 001 tree stays the architecture. This feature replaces the switched-off assistant
surfaces. It does not build a second set beside them. The tree below marks what is
touched and what is deleted. Two new core modules appear.

```text
src/
├── shared/              # types.ts: TaskTypeDef gains family?: Family, loses kind;
│                        #   new Conversation types; ipc.ts: new channels (see contracts/)
├── core/
│   ├── domain/          # family.ts (new: the declared family set; a leaf module, its
│   │                    #   SQL mirrors carry the naming comment); categories.ts is
│   │                    #   retired (the finish and destination declarations move to
│   │                    #   their dispatch modules); finish.ts: polish-then-file is
│   │                    #   re-argued as the organize step driven by the declared
│   │                    #   instruction, and the meeting-only action-items append is
│   │                    #   deleted with the meeting engine; grant.ts unchanged
│   │                    #   (confined purposes return NO_GRANT);
│   │                    #   preprocess.ts and the hash/trigger registry are DELETED;
│   │                    #   chatContext.ts re-keyed: grounding is built from declarations
│   ├── i18n/            # new keys: finish choice, refusal messages, conversations, undo
│   └── services/        # finishService: the finish mode ('assisted' | 'as-written');
│                        #   conversationService (new port + service: per-task storage)
├── main/
│   ├── db.ts            # migrations v13 (task_types.family + seed changes + re-home),
│   │                    #   v14 (conversations/messages), v15 (ledger undo columns);
│   │                    #   CHECK rebuilds follow the gated-rebuild discipline
│   ├── types.ts         # effectiveTypeDef reads declarations; effectiveKind is deleted
│   ├── preprocess.ts / suggestions.ts   # DELETED (job kinds unregistered; rows stay)
│   ├── ai/              # chat.ts: stored turns, one session per turn, disposed after it;
│   │                    #   triggers.ts: the preprocess-on-add trigger is deleted;
│   │                    #   the session-factory seam is unchanged
│   ├── wiki/            # ingest.ts: the snapshot-after-deposit order is pinned by a
│   │                    #   test; new undo action; the scaffold call sites are unchanged
│   │                    #   (create-only was already the rule)
│   ├── adapters/        # conversation storage adapter (sqlite); artifacts stores unchanged
│   └── index.ts         # command handlers for the new channels; localized refusals
├── preload/             # pass-through for the new channels
└── renderer/src/
    ├── components/focus/  # the note editor becomes the declared working area;
    │                      #   ChatPanel becomes stored conversations (list + new);
    │                      #   the finish choice appears in the TaskBand finish step
    ├── components/overlays/ # Type editor: family, instruction, destination — no grants
    │                        #   section, because grants do not exist yet; ActivityView:
    │                        #   undo a curation
    └── typeCatalog.ts / store.tsx  # family-aware; snapshot merge for conversations

test/                    # unit + e2e additions per Constitution Check item IV
docs/adr/                # unchanged — ADR-0001 is the mandate this plan executes
```

**Structure Decision**: the single-repo electron-vite split stays. `core/domain/family.ts`
is added: a leaf module with one pure declaration. `categories.ts` is retired, not
reused. CONTEXT.md avoids the word "Category"; keeping a second name for the same fact
would give future code two definitions to read. `conversationService` enters through a
port because it performs I/O. The working area adds no storage: the draft is the note
that already exists, and storing the same content in two places would create two
records that can disagree. Deleting `preprocess` and `suggestions` removes two of the
three registered job kinds. The job machinery itself is untouched. The `ingest` job
carries the curation run on the path the POC proved, with the reviewed order pinned by
a test.

## Complexity Tracking

> No constitution violations — section intentionally empty per the gate.

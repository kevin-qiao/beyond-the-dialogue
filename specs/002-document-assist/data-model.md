# Data Model: Document Type AI Assistant

Covers the Key Entities in [spec.md](./spec.md). Decisions are in
[research.md](./research.md). The constitution splits storage by the nature of the
data: structured state in SQLite, user-owned documents as plain files, history as
snapshots. Paths stored inside the data folder stay relative (FR-024). The rule is
`isRelativeStoredPath`; `test/portability.test.ts` is the scan.

## Vocabulary (declared once)

- **Family** — `'document' | 'working-system' | 'coding'`. Declared in the new leaf
  module `src/core/domain/family.ts`. A Type with no family needs no assistance; `plain`
  and its user-defined equivalents are such Types. SQL `CHECK` restatements mirror this
  set and carry the comment naming the source module.
- **Finish behaviour** — the existing closed set (`complete-only | file-as-is |
  polish-then-file | deposit-then-curate`). Its shape does not change (D2).
- **Destination** — unchanged shape: `{ store: 'wiki' | 'folder', rootPath: string,
  subdir: string }`. An empty `rootPath` is legal only on the seeded built-in Types
  (they ship without a location, Q1). It is never legal on a saved user Type (FR-013
  refuses at save).
- **Retired** — `TaskCategory` / `TaskKind`. The four-value vocabulary and its SQL
  checks are deleted (migration v13). Nothing dispatches on them.

## Entities

### TaskType (table `task_types` — rebuilt in v13)

| Field | Type | Rules |
|---|---|---|
| key | TEXT PK | stable id; after v13 the built-ins are `plain` and `document`, plus user-defined Types |
| family | TEXT NULL | CHECK IN ('document','working-system','coding') or NULL — mirrors `family.ts` |
| label / emoji / description / color | TEXT | display only; the default-label detection (compare the stored row against the `en` catalog) is unchanged, so a user rename is never overwritten |
| input_schema_json | TEXT | the declared inputs; D10 grounding reads them; `validateInputs` is unchanged |
| ai_guidance | TEXT NULL | the declared assistant instruction; it drives the organize step (D2) |
| is_builtin | INT | after v13 only `plain` and `document` are built-ins |
| finish_behaviour | TEXT | one of the four; CHECK unchanged |
| destination_json | TEXT NULL | required for behaviours that file; an empty `rootPath` is allowed only on seeded built-ins |
| grants_json | TEXT | always `{skills:[],toolServers:[]}` in this feature (D9); the column shape is unchanged |

Deleted rows: the built-ins `learning`, `jira`, `meeting`. User-defined Types keep their
declarations and gain a family by the D11 map. A user Type that configured the learning
kind becomes a document-family Type that still declares `deposit-then-curate` — and it
works. That is the re-argument proving itself: the behaviour was always a declaration.

Relationships: each Task references one TaskType by key. Tasks pointing at a deleted
key are re-homed to `plain` in v13. Their content is untouched (FR-017).

### Task (shape unchanged; vocabulary rebuilt)

`type` TEXT — if a CHECK listing the four built-in keys is live (see the reconciliation
point in research.md), v13's rebuild removes it; user-defined keys must be assignable.
Background, target, attachments, and notes stay as 001 defined them. The working area
of a Document task is the existing `task_notes` content — the same storage, a new
meaning by declaration (D3). No finish path may clear the draft (FR-002); a test
asserts the note is byte-identical after each strategy.

### Conversation (new, v14)

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| task_id | TEXT | FK → tasks; deleting the task deletes its conversations (final, as 001 FR-004) |
| created_at | TEXT | ISO; stored records keep the language they were written in |

### ConversationMessage (new, v14)

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| conversation_id | TEXT | FK → conversations; cascade |
| role | TEXT | CHECK IN ('user','assistant') |
| content | TEXT | must not be empty; an assistant message stores its usage metadata — the chatMessages rule: without it the SDK's context estimator throws inside the provider call |
| created_at | TEXT | order is insertion order; persistence comes from storage, not memory |

Validation rules: a grounded send builds its context from this task's material only
(FR-011 — the egress-at-construction mechanism is unchanged). A conversation never
modifies task state (FR-010); the handler enforces it structurally: the conversation
service receives no task port.

### CurationRun (table `ingest_ledger` — extended in v15)

| Field | Type | Rules |
|---|---|---|
| id / task_id / state / deposit_files / attempts / created_at | unchanged | states now: `queued → running → done` or `failed`; new: `done → undone` |
| snapshot_dir | TEXT | the `.history/<run>/` directory, stored relative to the collection; taken **after** the deposit — the order is load-bearing (D7) and a test pins it |
| undone_at | TEXT NULL | set by the undo action |

Undo (FR-020, Q3=A): restore the files the curation touched — `diffTouchedFiles`
already names them — from `snapshot_dir`. The deposit files inside that snapshot return
to the content they already had; they stand. Refuse the undo when: the state is not
`done`; the collection no longer resolves under the Type's destination (the same rule
as at finish — never mis-restore); or the snapshot directory is missing (report it, do
not guess).

### Destination and confinement (mechanism unchanged; new requirements to meet)

One implementation: the path must be relative, not start with `..`, and not be
absolute. The wiki store may establish the minimal structure create-only at the first
destined finish (D6). The folder store never establishes anything (unchanged). An empty
`rootPath` is legal only on the seeded `document` Type; the finish then refuses with a
localized code (FR-007). Saving a user Type with an empty `rootPath` refuses (FR-013).

## State transitions that matter

- **Finish of a Document task** (FR-003/006/007, mode per D8):
  `active → choose mode (default from the declaration) → resolve destination (fail → the
  task stays active, refusal carries a code) → as-written: write the draft as-is |
  assisted: organize → the traceability check (pass → write the organized document;
  fail → write the draft as-is and report the step failed) → mark complete, clear the
  alarm → report the artifact path and the path taken`. The `deposit-then-curate`
  variant: validate → deposit synchronously → mark complete → enqueue the curation job;
  the job runs snapshot → curate → records `done`; the Activity view offers undo.
- **Blank working area** → the finish refuses with a code; the task stays active
  (US1-AC6).
- **Assistant off or unconfigured** → the mode is forced to as-written; no session is
  constructed (FR-021).
- **Curation failure** → the ledger shows `failed`; retry from the Activity view is
  unchanged; the deposit already stands.

## Cross-checks (guard tests to update or add)

- The family set and its SQL CHECK restatements stay mirrored; the naming-comment
  convention applies, as it did for the retired categories.
- The chatContext registry must cover both cases: document-family tasks and
  family-less tasks (D10). The test fails on a missing entry.
- Layering: no renderer import of `src/main`; the conversation port lives in
  `src/core/ports` and its adapter in `src/main/adapters`.
- Portability: no absolute path in any row, including the new tables.
- i18n: new user-visible strings enter the catalogs only; the literal baseline stays
  empty.

# Data Model: Document Type AI Assistant

Spec: [spec.md](./spec.md) Key Entities; decisions in [research.md](./research.md).
Storage split per the constitution: structured state in SQLite; user-owned documents as
plain files; history as snapshots. All paths relative to the data folder stay relative
(FR-024; `isRelativeStoredPath` is the rule, `test/portability.test.ts` is the scan).

## Vocabulary (declared once)

- **Family** — `'document' | 'working-system' | 'coding'` (new leaf declaration in
  `src/core/domain/family.ts`). Absent/null on a Type = no-assist Type (`plain` and its
  user-defined equivalents). SQL `CHECK` restatements name this module as their source.
- **Finish behaviour** — the existing closed set
  (`complete-only | file-as-is | polish-then-file | deposit-then-curate`), unchanged in
  shape (D2).
- **Destination** — unchanged shape: `{ store: 'wiki' | 'folder', rootPath: string,
  subdir: string }`; `rootPath` may be empty on a *seeded built-in* (ships
  destination-less, Q1), never on a saved user Type (FR-013 refuses at save).
- **Retired**: `TaskCategory`/`TaskKind` — the four-value vocabulary and its SQL CHECKs
  are deleted (migration v13); nothing dispatches on them.

## Entities

### TaskType (table `task_types` — rebuilt in v13)

| Field | Type | Rules |
|---|---|---|
| key | TEXT PK | stable id; built-ins: `plain`, `document` (+ user-defined) |
| family | TEXT NULL | CHECK IN ('document','working-system','coding') or NULL — mirrors `family.ts` |
| label / emoji / description / color | TEXT | display; default-label detection unchanged (compares vs `en` catalog values) |
| input_schema_json | TEXT | declared inputs (D10 grounding reads it); `validateInputs` unchanged |
| ai_guidance | TEXT NULL | the **declared assistant instruction** — drives organize (D2) |
| is_builtin | INT | `plain` and `document` are the only built-ins after v13 |
| finish_behaviour | TEXT | one of the four; CHECK unchanged |
| destination_json | TEXT NULL | required for behaviours that file; empty `rootPath` allowed only for seeded built-ins |
| grants_json | TEXT | always `{skills:[],toolServers:[]}` this feature (D9); column shape unchanged |

**Deleted rows**: built-ins `learning`, `jira`, `meeting`. **User-defined Types**: family
mapped per D11; declarations kept — a user `learning`-kind Type becomes a
document-family Type still declaring `deposit-then-curate`, and it works (that is the
re-argument proving itself).

**Relationships**: Task → one TaskType by key; tasks pointing at deleted keys are
re-homed to `plain` in v13 (content untouched, FR-017).

### Task (unchanged shape; vocabulary rebuilt)

`type` TEXT — CHECK (if any restatement exists) replaced by a plain FK-ish key with the
category CHECK dropped (v13; reconcile against the fresh `SCHEMA` const — if a
four-value CHECK survived on `tasks.type`, deleting it is also the fix that lets
user-defined Type keys be assigned at all; verify with a test assigning a custom key).
Background/target/attachments/notes as 001. The **working area** (Document tasks) is the
existing `task_notes` content — same storage, new meaning by declaration (D3). Draft is
never cleared by finish (FR-002): every strategy path is tested to leave the note
untouched.

### Conversation (new, v14)

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| task_id | TEXT | FK → tasks; cascade delete with the task (final deletion, 001 FR-004) |
| created_at | TEXT | ISO; presentation of history keeps the language it was written in |

### ConversationMessage (new, v14)

| Field | Type | Rules |
|---|---|---|
| id | TEXT PK | |
| conversation_id | TEXT | FK → conversations; cascade |
| role | TEXT | CHECK IN ('user','assistant') |
| content | TEXT | non-empty; assistant messages persist with usage metadata (chatMessages rule — a missing usage breaks the SDK estimator) |
| created_at | TEXT | order = insertion; restart-safe by storage, not memory |

Validation rules: every grounded send constructs from the task's own material only
(FR-011 — egress at context construction, unchanged mechanism); chat never mutates task
state (FR-010 enforced at the handler: the conversation service receives no task-port).

### CurationRun (table `ingest_ledger` — extended v15)

| Field | Type | Rules |
|---|---|---|
| id / task_id / state / deposit_files / attempts / created_at | (unchanged) | states now: `queued → running → done | failed`; **new**: `done → undone` |
| snapshot_dir | TEXT | relative-to-wiki `.history/<run>/`; taken **after** deposit — ordering is load-bearing (D7); pinned by test |
| undone_at | TEXT NULL | set by the undo action |

Undo (FR-020, Q3=A): deterministic restore of files touched by the curation
(`diffTouchedFiles` already names them) from `snapshot_dir`; the deposit files present in
that snapshot are restored *to themselves* — they stand. Refused when: state ≠ `done`;
the wiki no longer resolves under the Type's destination (same refusal rule as finish —
never silently mis-restore); the snapshot directory is missing (reported, not guessed).

### Destination & confinement (unchanged mechanism; new requirements to hold)

One implementation (relative + not-`..` + not-absolute). wiki store: create-only
scaffold at first destined finish (D6); folder store: never scaffolds (unchanged).
Empty `rootPath`: built-in `document` Type may carry it (seeded, not saved); finish
refuses via FR-007 localized codes. User Types: save refuses (FR-013).

## State transitions that matter

- **Finish of a Document task** (FR-003/006/007, mode per D8):
  `active → [choose mode, default from declaration] → resolve destination (refuse → stay
  active with code) → as-written? write draft as-is : organize → verifyPolish-gate →
  (pass) write organized / (fail) write as-is + report failed step → mark complete +
  clear alarm → report artifact path + path taken`. `deposit-then-curate` variant:
  write → **deposit synchronously** → mark complete → enqueue curation job; job:
  snapshot → curate → record `done` (+ Activity shows undo).
- **Blank working area** → finish refused with code (US1-AC6); task stays active.
- **Assistant off/unconfigured** → mode forced as-written; zero session construction
  (FR-021).
- **Curation failure** → ledger `failed`, retryable from Activity (unchanged), the
  deposit already stands.

## Cross-checks (guard tests to update or add)

- family set ↔ SQL CHECK mirrors (the naming-comment convention; same drill as the
  retired categories).
- chatContext registry total over: document-family tasks + family-less tasks (D10).
- layering: no new `src/main` import in renderer; conversation port in `src/core/ports`,
  adapter in `src/main/adapters`.
- portability scan: no absolute paths in any board row, including new tables.
- i18n literal ratchet: new user-facing strings only via catalog keys.

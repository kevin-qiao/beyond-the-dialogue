# Phase 1 Data Model: Extensible Type Workflows

**Feature**: `specs/001-extensible-type-workflows/spec.md`
**Date**: 2026-09-12
**Storage**: SQLite (`node:sqlite`, synchronous) under the app's user data directory

This document describes the domain entities the feature introduces or changes, their
validation rules, and the storage migration required. Field-level TypeScript for the
wire contracts lives in `contracts/`; this file is the conceptual model.

---

## 1. Task Type (extended)

A workflow template. Already exists as `task_types` (`src/main/db.ts:57-68`) and as the
`TaskTypeDef` domain type (`src/shared/types.ts:41-52`). This feature adds three
declarations to it.

| Field | Meaning | New? |
|---|---|---|
| `key` | Stable identifier, `/^[a-z0-9_]{2,32}$/` | existing |
| `kind` | Behaviour category — now `plain \| learning \| jira \| meeting` | widened |
| `label`, `emoji`, `description`, `color` | Display identity | existing |
| `inputSchema` | Declared inputs the task must supply | existing |
| `aiGuidance` | Instruction injected into pre-processing | existing |
| `isBuiltin` | Built-ins are non-deletable and category-immutable | existing |
| **`finishBehaviour`** | One of the four behaviours (see §3) | **new** |
| **`destination`** | Where the finished artifact is written (see §2) | **new** |
| **`grants`** | Skills and tool servers granted to sessions for this type (see §4) | **new** |

**Validation rules**:
- `finishBehaviour` MUST be one of the four enumerated behaviours. An unrecognised value
  is rejected at write time, never defaulted.
- A type whose `finishBehaviour` is `complete-only` MUST NOT declare a destination.
- A type whose `finishBehaviour` writes an artifact MUST declare a destination that
  resolves inside its root.
- A built-in type's `kind` and `finishBehaviour` are immutable once created; its display
  fields remain editable (FR-017).
- `grants` entries MUST reference skills or tool servers currently registered in settings.
  A grant naming a removed entry is inert, not an error — removal happens elsewhere.

**Relationship to the existing "kind" concept**: the category continues to determine
pre-processing and the working area. It no longer determines finish behaviour or
destination — those become explicit declarations. The existing Learning type's behaviour is
re-expressed as `kind: learning` + `finishBehaviour: deposit-then-curate` + a wiki
destination, which must reproduce today's behaviour exactly (FR-003, SC-003).

---

## 2. Output Destination

The location a type's finished artifacts are written to. Declared as structured data so
confinement can be checked, rather than stored as a raw absolute path.

| Field | Meaning |
|---|---|
| `store` | Which artifact store handles the write: `wiki` or `folder` |
| `rootPath` | Absolute base directory, declared by the type for BOTH stores — there is no global wiki location and no built-in default. For `store: wiki` a blank root is an incomplete config refused at Finish; for `store: folder` it is refused at save |
| `subdir` | Relative directory beneath the root where artifacts land (for example `meeting-minutes`) |

**Derived at write time**, not stored: the artifact's filename (a slug of the task title),
and the absolute resolved path.

**Validation rules**:
- The resolved absolute path MUST lie inside the resolved root. Resolution reuses the
  proven technique from `resolveLearningNotePath` (`src/main/wiki/wiki.ts:121-132`):
  compute `path.relative(root, abs)` and reject when the result is absolute or begins with
  `..` (FR-006).
- `rootPath` MUST be an absolute path. A relative or empty `rootPath` for `store: folder`
  is rejected.
- The destination MUST be writable, or the failure MUST be reported before the task is
  marked complete (FR-024, FR-028).
- Changing a destination affects subsequent finishes only. Existing artifacts are never
  moved, rewritten, or deleted (FR-005).

**Resolved roots per store**:
- `wiki` → `rootPath` as declared by the type; a blank root is refused at
  Finish (`wiki.notConfigured`), never resolved against a global setting or a
  built-in default (both were removed)
- `folder` → `rootPath` as declared by the type

---

## 3. Finish Behaviour

A closed set of exactly four, per the clarification session (FR-014).

| Behaviour | Input | Output | Existing analogue |
|---|---|---|---|
| `complete-only` | nothing | nothing written; task marked complete | today's plain and jira finishes |
| `file-as-is` | the task's working content | content written to the destination unchanged | new |
| `polish-then-file` | the task's working content | the assistant rewrites it, then it is written | new — used by Meeting |
| `deposit-then-curate` | the task's working content + declared inputs | raw material preserved first, then the assistant authors the artifact | today's Learning ingest |

**Rules applying to every behaviour**:
- The finish MUST succeed even when no AI provider is configured (FR-025). Behaviours that
  involve the assistant degrade to writing the user's content unpolished, never to failing.
- The user's written content MUST remain retrievable even when an assistant step fails
  (FR-011, FR-027).
- A failed finish MUST leave the task retriable without retyping (FR-027).
- Outcome and failures MUST surface in the activity record (FR-028).

**Rules specific to `polish-then-file`** (FR-009, from the clarification session):
- The transformation MUST preserve every fact, decision, and action item the user recorded.
- It MUST NOT introduce content the user did not write.
- It MUST present the recorded action items as a distinct section of the finished document.

**Rules specific to `deposit-then-curate`**: unchanged from today — deposit first, snapshot,
confined agent authors the artifact, diff to report what was touched.

---

## 4. Plugin Grant

The association between a task type and the capabilities its assistant sessions may use.

| Field | Meaning |
|---|---|
| `skills` | Names of registered skills this type may load |
| `toolServers` | Names of registered tool servers this type may reach |

**Rules**:
- A grant is declared on the type, not on the task (FR-019).
- Confined operations — material ingestion, minute polishing, suggestion generation —
  receive **no grant**, by construction rather than by convention (FR-020, SC-006).
- When a type has any grant, the session context excludes the user's working content
  (notes, minutes, drafts) and includes only declared inputs and the user's request
  (FR-029, SC-010). See research R9 — this is the only correct enforcement point.
- A remote change is never directly callable by the model. The model may propose; the
  application performs the change after the user confirms that specific change
  (FR-022, FR-023, SC-005). See research R8.

**Related entities that already exist and are unchanged in shape**:
- **Skill** — a user-imported capability entry (`{ name, description, path }`,
  `src/shared/types.ts:56-61`). Its folder is copied to `<userData>/skills` on import.
  Note: the SDK does not enforce skill-level tool permissions; a skill is not a grant.
- **Tool Server** — a registered external system. Today stored with a `stdio` transport
  (`{ type: 'stdio', command, args?, env? }`, `src/shared/types.ts:63-73`), validated by
  `validatePluginEntries` (`src/main/plugins.ts:11-36`). Its connection is handled by the
  adopted community adapter, not by this project.

---

## 5. Meeting Type (the new built-in)

| Aspect | Value |
|---|---|
| `key` | `meeting` |
| `kind` | `meeting` (new category) |
| `label` / `emoji` | Meeting / 🗓 |
| `finishBehaviour` | `polish-then-file` |
| `destination` | `store: folder`, `subdir: ''` (or a configured default such as `meeting-minutes`), root defaulting to a folder under the user's documents |
| Declared inputs | title, description, target/objective, optional attachment, optional purpose prompt — mirroring the existing Learning shape minus the wiki-specific note path |
| Pre-process output | a suggested agenda and the core topics, from the task's own inputs |
| Working area | the existing markdown editing surface (the working area is still determined by category; per-type working-area declaration is out of scope) |

**Explicitly not included**: publishing minutes to an external system. The destination is
plain markdown in a configured folder (FR-010), per the spec's scope boundary.

---

## 6. State Transitions

**Pre-process lifecycle** — unchanged: `none → queued → running → ready | failed`, with
re-run gating by input hash. Meeting pre-processing follows the same path as learning.

**Finish lifecycle** (was implicit, now explicit):

```
in-progress
  → [validate required inputs]        → fail: refuse, list missing fields
  → [validate destination resolves]   → fail: refuse, report (never mis-save)
  → [preserve user content]           → the working content is retained regardless
  → [perform behaviour]
      complete-only      → done
      file-as-is         → write artifact → done
      polish-then-file   → assistant rewrite (may fail → still file unpolished)
                         → write artifact → done
      deposit-then-curate→ deposit raw → confined agent authors → diff → done
  → mark complete, clear alarm
  → surface outcome in activity record
```

**Failure invariants**: a failure at any step leaves the task not-completed, the user's
content intact, and the finish retriable. No step may delete or relocate an existing
artifact (FR-026).

**Artifact collision**: when a finish would produce an artifact where one already exists,
the new artifact is written under a distinct name alongside it. Nothing is overwritten or
moved (FR-026, SC-008). This supersedes the wiki's dedupe-on-copy loop
(`src/main/wiki/wiki.ts:157`) by applying the same principle more broadly.

---

## 7. Storage Changes and Migration

**Current schema version: 4.** This feature adds version 5.

### 7.1 New columns on `task_types`

Added by `ALTER TABLE ... ADD COLUMN` — no table rebuild needed for a new column:

| Column | Type | Default | Holds |
|---|---|---|---|
| `finish_behaviour` | `TEXT` | `'complete-only'` | the declared behaviour |
| `destination_json` | `TEXT` | `NULL` | the destination descriptor, or NULL |
| `grants_json` | `TEXT` | `'{"skills":[],"toolServers":[]}'` | the grant declaration |

Backfill in the same step: existing built-ins get their behaviour set explicitly —
`learning` → `deposit-then-curate` with a wiki destination; `jira` and `plain` →
`complete-only`. This is the `UPDATE ... WHERE key = ? AND is_builtin = 1` pattern already
used for the learning schema in v4 (`src/main/db.ts:512`).

**Trap to respect**: `upsertType` (`src/main/db.ts:756-776`) writes an explicit column list
and currently always writes `sort = 0`. Every new column must be threaded through that
statement's insert list and its `ON CONFLICT DO UPDATE SET` list, or saved types will
silently lose the new declarations.

### 7.2 Widening the category check (three tables)

SQLite cannot `ALTER` a `CHECK` constraint; a rebuild is required for each table carrying
`('plain','learning','jira')`:

| Table | Constraint | Child-row hazard |
|---|---|---|
| `tasks` | `db.ts:40` (+ restated at `:392`) | **Yes** — `suggestions`, `ingest_ledger`, `task_preprocess` reference it. Requires `PRAGMA foreign_keys = OFF` around the swap, as v3 documents at `:379-382` |
| `task_types` | `db.ts:59` | No — safe to rebuild freely |
| `task_preprocess` | `db.ts:87` | No — it is the child, not the parent |

(For completeness: `enrichment_jobs.kind` at `db.ts:72` constrains *job* kinds and is
unrelated to this change.)

The `SCHEMA` constant must be updated at `db.ts:40`, `:59`, `:87` so fresh installs get the
widened constraint directly. Gate each rebuild by detecting the old constraint in
`sqlite_master.sql`, the technique demonstrated at `db.ts:434-457`.

### 7.3 No migration needed for the new built-in type

`builtinTypeSeeds()` (`db.ts:172-202`) runs at the tail of `migrate()` outside every
version gate (`:555-561`) and inserts with `INSERT OR IGNORE`. Adding a Meeting entry to
that function inserts it into existing databases on the next startup.

### 7.4 Retiring the hardcoded category lists (Principle VI)

The category set is currently restated in four places. All must derive from one
declaration:

| Location | Current form |
|---|---|
| `src/shared/types.ts:9-13` | `TaskType`/`TaskKind` unions, `BUILTIN_TYPE_KEYS`, `KINDS` |
| `src/main/types.ts:102` | `KINDS.includes(def.kind)` validation |
| `src/main/types.ts:123` | `new Set(['plain','learning','jira'])` guarding built-in keys |
| `src/main/db.ts:40,59,87,392` | the SQL `CHECK` literals |

`BUILTIN_TYPE_KEYS` is currently unused dead code (defined, referenced nowhere) — it is
either given a purpose here or removed.

### 7.5 Where the new fields are consumed

| Concern | Current site | Change |
|---|---|---|
| Finish dispatch | `src/main/index.ts:348` | becomes a lookup on `finishBehaviour` |
| Destination confinement | `src/main/index.ts:335-341` | generalized from the learning-note check |
| Destination resolution | `src/main/wiki/wiki.ts:121-132` | generalized from `resolveLearningNotePath` |
| Wiki scaffolding | `src/main/wiki/wiki.ts:37-57` | the hardcoded `learning-notes` directory becomes conditional |
| Snapshot/diff file set | `src/main/wiki/wiki.ts:228` | **MUST be extended** — a new destination directory is otherwise invisible to the audit trail |
| Session grants | `src/main/ai/session-factory.ts:51-91` | evaluates `grants` |
| Chat context | `src/main/index.ts:72-92` | becomes grant-aware (R9) |
| Type editing UI | `SettingsView.tsx:526-652` | exposes behaviour, destination, grants |

---

## 8. Entities That Do Not Change

Listed to bound the change surface — these keep their current shape:

- **Task** — gains no fields. `inputs`, `inMyDay`, `completed`, `alarmAt` and the rest are
  untouched. There is still no ordering column and no due date.
- **List** — unchanged. Column 1 continues to show only My Day and To Do (spec scope boundary).
- **Suggestion**, **IngestRecord**, **JobRecord**, **TaskPreprocess** — unchanged in shape.
- **Skill**, **Tool Server** entries in settings — unchanged in shape; they gain a consumer.

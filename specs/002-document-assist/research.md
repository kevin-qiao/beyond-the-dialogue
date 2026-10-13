# Phase 0 Research: Document Type AI Assistant

This file resolves the decisions the plan and the Constitution Check depend on.
Spec: [spec.md](./spec.md). Mandate: ADR-0001 — redesign in place; the POC engines are
reviewed here and either deleted or re-argued; the constitution is the floor.

## D1 — Taxonomy: Families replace the POC categories

**Decision**: Add `FAMILIES = ['document', 'working-system', 'coding']`. Declare it once
in a new leaf module, `src/core/domain/family.ts`. `TaskTypeDef` gains `family?: Family`
and loses `kind`. A Type with no family needs no assistance — `plain` is such a Type.
`categories.ts` is retired. Its still-true parts, the finish-behaviour set and the
destination-store set, move to the modules that dispatch on them. SQL `CHECK`
restatements mirror the new set and carry the comment that names the source module.

**Rationale**: CONTEXT.md is explicit. The word "Category" is retired from both senses:
use "List" for grouping and "Family" for assist classification. ADR-0001 resolves the
taxonomy conflict by changing the code, not by keeping two vocabularies. Principle I
forbids a second dispatch axis. If `kind` stayed beside `family`, a later branch would
eventually read the retired one.

**Alternatives considered**: (a) keep `kind` as an internal axis beside `family` —
rejected: one fact would have two definitions, and drift is certain. (b) treat `plain`
as a fourth family — rejected: the family set is canonical at three (master spec), and
"no assistance" is the absence of a family, not a family.

## D2 — Re-argue the four finish behaviours; add none; name none after a workflow

**Decision**: The closed set stays: `complete-only | file-as-is | polish-then-file |
deposit-then-curate`. `polish-then-file` is re-argued as the generic organize step. The
instruction that drives it is the Type's declared guidance, not a meeting-minutes
template. The meeting-only action-items append is deleted with the meeting engine. The
code validator of the dynamic step stays the re-argued `verifyPolish` traceability
check. FR-005 states the rule: every fact and every action item in the filed document
must appear in the user's draft. If the check fails, the app files the draft as written
and reports the step as failed. The documented limit of the check — it catches asserted
content, not invented prose between assertions — stays annotated at `verifyPolish`.
`deposit-then-curate` continues as the knowledge-base behaviour (D6–D7).

**Rationale**: the behaviours were always selected by declaration, never by Type name.
They survive D1's change unchanged in shape — that is the point of Principle I. The
spec's organize step and the POC's polish step are the same guarantee, now argued for
the family that needs it. ADR-0001 requires each mechanism to be re-argued by the
feature that uses it; this feature re-argues the traceability bound.

**Alternatives considered**: rename the behaviour to `organize-then-file` — rejected.
The name is internal vocabulary. A rename forces a `task_types` CHECK rebuild and a
data migration for no user benefit. A comment at the definition records the re-argument.

## D3 — The working area is the existing note; no new draft storage

**Decision**: The per-task working note — the `task_notes` row with its mirror file
`vault/notes/<taskId>.md` — is re-argued as the working area of Document Types. A
Document Type surfaces it as the writing space. The finish loop reads its content as the
draft. Tasks of other Types keep the same note as ordinary additional information.

**Rationale**: FR-002 requires written content that survives edits, reopens, and
restarts. The note mechanism already does that, and it is already portable (FR-024) and
platform-neutral. One content needs one store. The spec's "written content" and the
shipped note are the same thing, seen through different declarations.

**Alternatives considered**: a separate `document_drafts` store — rejected. It would
keep the same content in two places. It would complicate the deletion of the learning
engine, whose notes already are this data. It adds work and no value.

## D4 — Delete the preprocess and suggestion engines; keep their rows as history

**Decision**: Remove the `preprocess` and `suggestion` job kinds: their handlers, their
per-category instruction registries, the on-add triggers, and their renderer surfaces.
Existing `task_preprocess` and `suggestions` rows stay in the database. No new code
reads them. `chatContext.ts` survives, re-keyed (D10).

**Rationale**: FR-016 retires the reference engines. Pre-process-on-add and suggestion
chips were machinery keyed to the old categories, and built for exactly the engines this
feature deletes. The 002 spec asks for no automatic job when a task is added. Keeping
the rows follows two standing rules: records keep the language they were written in, and
FR-017 preserves user data. Deleting history the spec did not ask to delete would be a
surprise the user cannot undo.

**Alternatives considered**: (a) re-argue preprocess as an outline step for Document
tasks at add time — rejected: not in the spec, and scope discipline applies. (b) drop
the tables — rejected: it destroys records for no requirement.

## D5 — Conversations: SQLite storage, one short-lived session per turn

**Decision**: Add tables `task_conversations` (id, task_id, created_at) and
`conversation_messages` (id, conversation_id, role, content, created_at) — migration
v14. On each send, the service builds an in-memory agent session from the stored
history plus the task grounding. The session streams the reply. The service stores the
reply and disposes the session at the end of the turn. Stopping a session does not
close its resources; dispose must be called — the standing rule. A task can hold
multiple conversations. Message order survives restart (FR-009).

**Rationale**: the POC chat lived in memory only. FR-009 requires it to survive
restarts. A transcript is structured application state, not a user-owned document, so
the constitution's persistence split puts it in the embedded database. Disposing per
turn keeps the resource contract simple: no session stays open while the panel is idle.
Rebuilding the session is cheap at personal-use sizes.

**Alternatives considered**: one long-lived session per open panel — rejected: closing
the window, a crash, and moving panels each become their own teardown problem. File-
based transcripts — rejected: they are not documents the user edits, and SQLite keeps
ordering and task lifecycle together (deleting the task deletes its conversations,
final as 001's FR-004).

## D6 — Knowledge base: create-only setup at the first destined finish

**Decision**: A wiki-destined Type uses the existing confinement-resolved destination.
The first destined finish establishes the minimal structure of the pattern, using the
existing `scaffoldWikiIfNeeded` — create-only. The app never restructures a collection
the user has since changed. Then the finish deposits, snapshots, and curates (FR-018,
US4-AC5). A destination with no location set is refused with a localized issue code
(FR-007) — the same rule for both stores.

**Rationale**: the POC's learning engine already behaved this way. This feature makes
the guarantee explicit and puts it under test: structure files are never rewritten on
later finishes. The behaviour extends to any user-declared Type. Q4's answer — establish
the collection, do not refuse — is what makes the learning case reachable for a new
user. No user will hand-write the pattern skeleton.

**Alternatives considered**: refuse until a collection exists — rejected by Q4: the
learning case would be unreachable. Set the structure at app start for every wiki Type —
rejected: that creates folders for Types the user may never finish; setup belongs to the
first use.

## D7 — Undo reverses the curation only; deposits are never rolled back

**Decision**: The ingest job order is fixed: deposit first (synchronous, at finish),
then snapshot, then curate. The test suite pins this order. Because the snapshot is
taken after the deposit, the deposited file is inside it. A new undo action restores the
files the curation touched from that snapshot. The deposit returns to the same content
it already had — it stands. The ledger row gains an `undone` state (FR-020, Q3=A,
US4-AC3).

**Rationale**: this re-argues the reference implementation's guarantee, as ADR-0001
requires. The POC had the snapshot mechanism. This feature makes the order
load-bearing and adds the undo control the spec asks for. The rule from Q3 follows from
the order of operations; no extra bookkeeping is needed to make it true.

**Alternatives considered**: per-file versioning instead of a snapshot per run —
rejected: the snapshot is the proven, simple unit, and fine-grained versioning is the
collection's own feature, not the app's to invent. A whole-directory restore that also
deletes the deposit — rejected by Q3.

## D8 — Finish takes a mode: 'assisted' or 'as-written', default from the declaration

**Decision**: The finish command carries an optional mode. The Type's declaration sets
the default that the UI presents: an organize-capable Type defaults to assisted; a
`file-as-is` Type defaults to as-written. The as-written mode runs no assistant step: no
session, no outbound call, and the user's exact words are filed (FR-003, US1-AC7). While
the assistant switch is off, or no model is configured, only the as-written path exists
(FR-021, SC-002).

**Rationale**: Q5's answer gives the user a choice at the moment of finishing. The
guarantee that the app will not silently rewrite the user's prose then does not depend
on a failure path. Because the default still comes from the declaration, Principle I
holds: no new branch on a Type identity. The off-switch case collapses into the one
path that already documents it.

**Alternatives considered**: Type-level choice only, no per-run choice (Q5 option C) —
rejected by the user. Showing a "skip AI" prompt for Types that have no AI step —
rejected: there is nothing to skip; the choice appears only where an assistant step
would run.

## D9 — Grants stay structurally inert; the UI shows no grants control

**Decision**: No Type ships a non-empty grant. The Type editor shows no grants section.
`resolveGrant` and the egress-at-construction boundary stay as they are: every purpose
this feature uses — organize, curate, converse — resolves NO_GRANT. Skills and tool
servers stay as 001 left them: registered, visible in Settings, and used by nothing.

**Rationale**: Q2's answer is no grants in this feature. Principle II prefers
structural control over instructions. Withholding the declaration too means even the
configuration cannot pretend. A later grants feature adds one declared field and its
UI; FR-014 stays true until then.

**Alternatives considered**: show the grant UI but ignore it — rejected: a checkbox
that changes nothing tells the user something untrue about their control.

## D10 — Chat grounding is built from declarations; the registry stays total

**Decision**: `chatContext.ts`, re-keyed per D4, builds the grounding block from: task
title, background, target, the Type's declared inputs (FR-011's egress rule — the
session sees only this task's material), and the working-area note when the task has
one. The registry must cover every case: Document-family tasks and family-less tasks
(plain chat, per the Q2 session answer). `test/chatContext.test.ts` is re-pointed at
the new axis. A task case the registry does not cover fails that test.

**Rationale**: 001 learned this lesson directly: the added `meeting` category silently
received less chat grounding because the ternaries did not know it. The totality guard
is what makes that impossible for the next family. Chat now attaches to every task
(FR-008), so the no-family case is a first-class entry, not an absence.

**Alternatives considered**: one generic prompt for all tasks — rejected: it loses the
per-source grounding the master spec asks for, and it removes the guard's value.

## D11 — Migrations v13–v15 and the seed changes

**Decision**:
- **v13** — rebuild `task_types`: `kind` becomes `family`, CHECK restated against
  `family.ts`; the built-in seeds change: `plain` is kept with family NULL; the
  `learning`, `jira`, and `meeting` rows are deleted; a new `document` built-in is
  seeded with `polish-then-file`, store `folder`, and an empty `rootPath` — it ships
  without a location (Q1); user-defined Types map kind to family (`learning→document`,
  `jira→working-system`, `meeting→document`) and keep their declared behaviour and
  destination. Tasks whose `type` referenced a deleted built-in are re-homed to `plain`.
  Their content is not touched (FR-017). The rebuild uses the established discipline:
  `PRAGMA foreign_keys` off inside the swap, gated by detection of the old constraint.
- **v14** — add `task_conversations` and `conversation_messages`; both cascade-delete
  with the task (deletion is final, as 001 FR-004 defined).
- **v15** — `ingest_ledger` gains the undo columns (`undone_at`, the `undone` state);
  the category CHECKs on `task_preprocess` and `tasks` are rebuilt to remove the retired
  vocabulary; all rows are preserved.

Each step follows the `ran(v)`/`mark(v)` ladder. Row mappers are updated snake↔camel.
The portability scan stays green: no board row stores an absolute path; Type
destinations keep the v8 `rootPath` shape.

**Rationale**: the three steps mirror the shape of the change: vocabulary (v13), new
state (v14), history columns (v15). Re-homing to `plain` is the smallest honest move:
the tasks keep all user content, lose only an engine that no longer exists, and the user
can re-point any of them at a Type later.

**Alternatives considered**: re-home to the new `document` built-in — rejected: it would
silently give old learning, jira, and meeting tasks a writing-assistant finish they
never declared. Drop the history tables — rejected (D4). One combined migration —
rejected: per-step gates are what made v5–v12 safe to build.

## Open reconciliation point (carried to the tasks phase, not a NEEDS CLARIFICATION)

`src/shared/types.ts` still shows the fresh-database `tasks.type` CHECK listing the four
built-in keys, while user-defined Types exist. At implementation time, verify whether
that CHECK is live on current databases. If it is live, it blocks user-defined Type
keys — a contradiction of the custom-Type promise — and v13's rebuild removes it. If it
is only a detection string from the migration history, delete the stale restatement.
Either way, one guard test settles the fact: assign a user-defined Type key to a task
and require success.

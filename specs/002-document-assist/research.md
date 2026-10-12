# Phase 0 Research: Document Type AI Assistant

Resolves every decision the plan's Technical Context and Constitution Check lean on.
Spec: [spec.md](./spec.md); mandate: ADR-0001 (re-design in place; POC engines reviewed
here and deleted or re-argued; constitution is the floor).

## D1 — Taxonomy: Families replace the POC categories

**Decision**: Introduce `FAMILIES = ['document', 'working-system', 'coding']` declared
once in a new leaf module `src/core/domain/family.ts`; `TaskTypeDef` gains
`family?: Family` (absent = no-assist Type, e.g. `plain`) and loses `kind`.
`categories.ts` is retired; its still-true declarations (finish-behaviour set,
destination-store set) move to their dispatch modules. SQL `CHECK` restatements mirror
the new set with the naming comment, rebuilt under the established gated-repair
discipline.

**Rationale**: CONTEXT.md is explicit — "Category … retired from both senses; use List
for grouping, Family for assist classification" — and ADR-0001 resolves the taxonomy
conflict by refactoring the code away, not by keeping two vocabularies. Principle I
forbids a second axis of dispatch: leaving `kind` beside `family` guarantees some future
branch reads the dead one.

**Alternatives considered**: (a) keep `kind` as an internal implementation axis beside
`family` — rejected: two truths, drift guaranteed; (b) treat `plain` as a fourth family —
rejected: the family set is canonical at three (master spec), and "no assistance" is the
absence of a family, not a family.

## D2 — Re-argue the four finish behaviours; add none, name none after a workflow

**Decision**: the closed set stays `complete-only | file-as-is | polish-then-file |
deposit-then-curate`. `polish-then-file` is re-argued as the generic **organize** step:
the instruction driving it is the Type's declared guidance (no longer minutes-shaped),
the meeting-specific appended action-items section is deleted with the meeting engine,
and the deterministic validator of the dynamic step remains the re-argued `verifyPolish`
traceability gate (FR-005: every asserted fact or action item must trace to the user's
draft, else the draft is filed as written with the step reported failed).
`deposit-then-curate` is carried forward as the knowledge-base behaviour (D6–D8).

**Rationale**: the behaviours were always declared, never type-keyed — they survive
D1's surgery unchanged in shape, which is the point of Principle I. The spec's
organize step and the POC's polish step are the same guarantee re-argued for the family
that needs it (ADR-0001: mechanisms are re-litigated by the feature that needs them —
here the traceability bound, whose documented honest limit stays annotated at
`verifyPolish`).

**Alternatives considered**: rename the behaviour to `organize-then-file` — rejected:
the name is internal vocabulary; the rename would force a `task_types` CHECK rebuild and
a data migration for zero user value; the comment at the definition names the re-argument.

## D3 — The working area is the existing note; no new draft storage

**Decision**: the per-task working note (`task_notes` row + vault mirror
`vault/notes/<taskId>.md`) is re-argued as the Document Type's declared working area.
Document-family Types surface it as the writing space; the finish loop reads its content
as the draft. Non-Document tasks keep it as ordinary additional information.

**Rationale**: FR-002 demands durable written content that survives reopens/restarts —
which the note machinery already is, portable under FR-024 and platform-neutral. One
content, one store; the spec's "written content" and the shipped note are the same
thing seen through different declarations.

**Alternatives considered**: a separate `document_drafts` store — rejected: forks the
truth, complicates the deletion of the learning engine (whose notes already are this
data), and violates nothing except taste and the migration budget.

## D4 — Delete the preprocess/suggestion engines; keep their rows as history

**Decision**: remove the `preprocess` and `suggestion` job kinds, their handlers,
per-category instruction registries, hash-gating triggers, and renderer surfaces.
Existing `task_preprocess`/`suggestions` rows are retained, unread by any new code.
`chatContext.ts` survives but is re-keyed (D10).

**Rationale**: FR-016 retires the reference engines; pre-process-on-add and suggestion
chips were per-category machinery for exactly those engines, and the 002 spec asks for
no automatic job at capture time. Keeping the rows honors the "records keep the language
they were written in" principle and FR-017's data-preservation duty at zero cost —
deleting records the spec never asked to delete would itself be a surprise.

**Alternatives considered**: (a) re-argue preprocess as a Document "on-add outline" step —
rejected: not in the spec; scope discipline; (b) drop the tables — rejected: silent
destruction of history exceeds the mandate.

## D5 — Conversations: SQLite persistence, per-turn ephemeral sessions

**Decision**: new tables `task_conversations` (id, task_id, created_at) and
`conversation_messages` (id, conversation_id, role, content, created_at) —
migration v14. Each send builds an in-memory agent session from the persisted history
plus task grounding, streams the reply, persists it, and **disposes the session at turn
end** (abort is not dispose — standing rule). Multiple conversations per task; history
order preserved across restart (FR-009).

**Rationale**: the master spec's ask-anytime chat was in-memory only; persistence is a
spec requirement (FR-009). Transcripts are structured application state, not user-owned
documents → embedded database per the constitution's persistence split. Disposing per
turn avoids long-lived child-process ownership while the panel is idle — the resource
contract stays trivially satisfiable.

**Alternatives considered**: one long-lived session per open panel — rejected: disposal
across window close/crash/navigation becomes its own machinery; per-turn rebuild is
cheap at personal-use sizes. File-backed transcripts — rejected: they are not documents
the user owns and edits; SQLite keeps ordering and lifecycle with the task (deletion
cascades with the task, final like 001's FR-004).

## D6 — Knowledge base: create-only establishment at first destined finish

**Decision**: wiki-destined Types use the existing confinement-resolved destination; the
first destined finish establishes the pattern's minimal structure (the existing
`scaffoldWikiIfNeeded`, create-only — never restructures a collection the user has since
changed), then deposits, snapshots, and curates (FR-018, US4-AC5). A destination whose
location is unset is refused with a localized issue code (FR-007) — unchanged semantics,
new requirement to satisfy for both stores.

**Rationale**: the machinery already behaves this way for the POC's learning engine;
the re-argument pins it by test (a scaffolded collection's files are never rewritten on
later finishes) and extends the guarantee to any user-declared Type. Q4's answer
(establish, don't refuse) is what makes the learning case reachable by a fresh user at
all — nobody hand-writes a skeleton.

**Alternatives considered**: refuse-until-exists — rejected (Q4): strands the promise;
scaffold-on-app-start — rejected: creates directories for Types the user never finishes;
per-Type scaffolding must happen at the moment of use.

## D7 — Undo is a deterministic curation rollback; deposits never roll back

**Decision**: the ingest job's ordering — **deposit first (synchronous, at finish), then
snapshot, then curate** — is pinned: because the snapshot is taken after the deposit,
restoring touched curated files from `.history/<run>/` returns the curated content to its
pre-curation state while the deposit (present in the snapshot, already a user record)
stands. A new explicit undo action (Activity → curation record) performs the restore,
marks the ledger row `undone`, and refuses to undo a run that never completed curation
(FR-020, Q3=A, US4-AC3).

**Rationale**: this is the reference implementation's honest guarantee re-litigated
(ADR-0001): the POC had the snapshot; 002 makes the *order load-bearing* and surfaces
the undo the spec now demands. Q3's answer follows from the ordering rather than needing
extra bookkeeping — undo semantics fall out of when the snapshot is taken.

**Alternatives considered**: per-file versioning instead of run snapshots — rejected:
the snapshot is the proven, coarse, restorable unit; fine-grained versioning is a wiki
feature the user owns, not the app's to invent. Full-directory restore including
deleting deposits — rejected by Q3.

## D8 — Finish takes a mode: 'assisted' | 'as-written', default from declaration

**Decision**: the finish command carries an optional mode; the Type's declaration decides
which is presented as the default (organize-capable Type → assisted; `file-as-is` Type →
as-written). `as-written` runs no assistant step at all — no session, no outbound call —
and files the user's exact words (FR-003, US1-AC7). While the assistant switch is off,
or the model is unconfigured, only the as-written path exists (FR-021, SC-002).

**Rationale**: Q5's answer makes the non-rewrite guarantee exercisable at the decision
point rather than only via failure paths; keeping the default declaration-driven means
Principle I holds (no new branching on identity) and the off-switch case collapses to
the single path it already documents.

**Alternatives considered**: type-level-only choice (Q5 option C) — rejected by user;
a "skip AI this once" prompt every finish even for as-is Types — rejected: nothing to
skip there; the mode is shown only where an assistant step would run.

## D9 — Grants stay structurally inert; no UI pretends otherwise

**Decision**: no Type ships a non-empty grant; the Type editor does not show a grants
section (it would offer a control nothing honors); `resolveGrant` and the egress-at-
construction boundary are untouched and still resolve NO_GRANT for every purpose in use
(organize, curate, converse). Skills/tool-server management stays exactly as 001 left it:
registered, visible in Settings, reachable by nothing.

**Rationale**: Q2=C. Principle II prefers structural to instructed — but here even the
declaration is withheld, so the honest interface shows none of it. Re-adding the section
in a grants feature is one declared field away (FR-014 stays true).

**Alternatives considered**: ship the grant UI inert — rejected: a checkbox that changes
no behavior is a lie about control.

## D10 — Chat grounding is built from declarations, once, per category of source

**Decision**: `chatContext.ts` (re-keyed, D4) builds the grounding block from: task title
+ background + target + declared inputs (the egress rule — the session sees only this
task's material, FR-011) + the working-area draft when the task carries one. Registry
totality is preserved by re-pointing `test/chatContext.test.ts` at the new axis: every
family with a live surface (document) plus the family-less no-assist task case (plain
chat, Q2 session answer) has an explicit grounding entry; a task kind the registry does
not cover fails the test.

**Rationale**: the 001 lesson (a silently under-grounded `meeting` category) is exactly
why the registry-totality guard moves with the re-key. Chat now attaches to *every* task
(FR-008), so the no-family case is first-class, not an absence.

**Alternatives considered**: one generic prompt for all tasks — rejected: loses the
per-source grounding the master spec's "according to your context" asks for and drops
the guard's bite.

## D11 — Migration ladder v13–v15 and the seed surgery

**Decision**:
- **v13** — rebuild `task_types` (`kind` → `family`, CHECK restated against
  `family.ts`, the built-in seeds surgically updated: `plain` kept with family NULL;
  `learning`, `jira`, `meeting` rows deleted; new `document` generic built-in seeded with
  `polish-then-file`, store `folder`, empty `rootPath` (ships destination-less per Q1);
  user-defined Types mapped kind→family (`learning→document`, `jira→working-system`,
  `meeting→document`) keeping their declared behaviour and destination); tasks whose
  `type` referenced a deleted built-in are re-homed to `plain` (content untouched —
  FR-017). Rebuild follows the `PRAGMA foreign_keys` + gated-detect discipline.
- **v14** — `task_conversations` + `conversation_messages`; cascade-delete with the task
  (final like 001 FR-004).
- **v15** — `ingest_ledger` gains undo bookkeeping (undone_at, undone state);
  relaxed kind CHECKs on `task_preprocess`/`tasks` rebuilt to drop the retired category
  vocabulary; rows preserved.
  Each step: `ran(v)`/`mark(v)` gate, snake↔camel mappers updated, portability scan still
  green (no new absolute paths stored — Type destinations keep the v8 rootPath shape).

**Rationale**: the ladder mirrors the shape of the change — vocabulary (v13), new state
(v14), history columns (v15). Re-homing to `plain` is the minimum honest move: those
tasks keep every byte of user content, lose only an engine that no longer exists, and
the user can re-point any of them at a Type afterwards.

**Alternatives considered**: re-home to the new `document` built-in — rejected: would
silently give learning/jira/meeting tasks a writing-assistant finish they never declared;
drop the historical tables — rejected (D4); one big migration — rejected: the ladder's
per-step gates are what made v5–v12 safe.

## Open reconciliation point (carried to tasks phase, not a NEEDS CLARIFICATION)

`src/shared/types.ts` still declares the *fresh* `tasks.type` CHECK enumerating the four
built-in keys while custom Types exist — verify at implementation whether that CHECK is
live on current databases (if so it contradicts the custom-Type promise and v13's
rebuild retires it; if it is detection-only history, delete the stale restatement).
Either way the data-model's guard test ("assign a user-defined Type key") pins the truth.

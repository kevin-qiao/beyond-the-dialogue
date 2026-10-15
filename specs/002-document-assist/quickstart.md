# Quickstart: Validating Document Type AI Assistant

This guide validates the success criteria in [spec.md](./spec.md). The entities are in
[data-model.md](./data-model.md). The interface surface is in
[contracts/document-assist-ipc.md](./contracts/document-assist-ipc.md). Run everything
headless first. The test suite scripts agent sessions at the existing seams
(`setSessionFactory` / `setSimplePromptOverride`). No test needs network or a provider
key (Principles III and IV).

## Prerequisites

- Node ≥ 22 (the repo floor).
- Linux or Windows. Development under WSL2 is normal. Windows runs are required before
  the feature lands (Principle V).
- `npm install`. The `.npmrc` mirrors are already configured; leave them alone.

## Standing gates (run these first, every time)

```bash
npm run typecheck     # both projects named; also the catalog parity gate
npm test              # the full headless suite
```

Expected: green. The boundaries changed, so each guard drill below must also be
verified to fail on a deliberate violation. A check that cannot fail is broken, not
passing (Principle IV).

## Guard drills (fail-on-violation checks)

| Drill | Deliberate violation | Must fail |
|---|---|---|
| Family check mirror | add a fourth family to `family.ts` without updating the SQL mirror and its comment | the family-mirror guard test |
| chatContext coverage | remove the family-less (plain) grounding entry | `test/chatContext.test.ts` |
| Layering | import a `src/main` module from a renderer component | `test/layering.test.ts` |
| Portability | store an absolute destination path in a row | `test/portability.test.ts` |
| i18n baseline | add a user-visible string outside the catalogs | `test/i18n.test.ts` |
| Deposit and snapshot order | move the snapshot before the deposit in the curate job | the ordering test from D7 — the undo rule depends on this order |

## Scripted validation, per user story

Run one file with `npx tsx --test <file>`. Filter cases with `--test-name-pattern="..."`.

1. **US1 — write, organize, file (P1)**: a scripted session returns organized output for
   a `document`-Type task. Assert: the draft note is byte-identical after the finish
   (FR-002); the artifact lands at the destination with a distinct name on collision and
   no overwrite (FR-004); the task completes and its alarm clears; the result names the
   path taken. Mode `as-written`: assert the session factory is never called (spy), and
   the exact words are filed. A blank draft: the finish refuses; the task stays active.
2. **US1/US2 degradation (SC-002)**: run the assistant-off case and the
   never-configured case. Assert zero outbound calls (the seam is never invoked), the
   as-is filing lands, and the finish reports the skipped step. A scripted malformed
   organize output must file the draft as written and report the step failed (the FR-005
   check).
3. **FR-007 / Q1 first run**: start from a fresh database. The built-in `document` Type
   has no location. A finish must refuse with the localized
   `destination.not_configured` message, and the task must stay actionable. Point the
   Type at a scratch folder. The same finish now files.
4. **US2 — conversations (FR-008–FR-011)**: run a multi-turn scripted chat on a
   Document task and on a plain task. Assert: history survives a service re-creation
   (the restart stand-in); a new conversation does not see the old one; a failed send
   keeps the stored history; and the outbound context, captured from the scripted
   session, contains only that task's material (FR-011).
5. **US3 — user-declared Types (FR-012/013/014)**: create a document-family Type with
   its own instruction and destination. A task of that Type files per its declaration,
   on the same dispatch path as the built-in (the dispatch-by-declaration test). Saving
   a destination-less user Type must refuse. Edit the instruction; the next finish
   changes; an already-filed artifact does not (FR-014).
6. **US4 — knowledge base (FR-018–FR-020)**: finish a task of a wiki-destined Type
   into an empty location. Assert: the minimal pattern structure appears; the deposit
   lands before the curation starts (the order is pinned); the curation writes only
   inside the collection (a write outside is refused by the tool surface, not by a
   prompt); the ledger records `done` with the touched-file report. The assistant-off
   variant: the deposit lands alone, and the curation reports "did not run". **Undo**:
   restore returns the touched curated files to the snapshot state while the deposit
   file stands (Q3=A). Refuse an undo of a failed run, a never-run curation, or a
   collection whose location no longer resolves.
7. **E2E flagship** (the `test/e2e.test.ts` pattern): idea → Document task → draft
   across a simulated restart → finish organized → wiki curation → Activity ledger →
   undo → re-finish as-written. All scripted. Assert the board never blocks on AI
   (FR-006).

## Manual run (one machine, then both)

```bash
npm run dev
```

Steps:

1. Turn the assistant switch on in Settings.
2. Create a document task. Finish it with no destination set. Expect the guided refusal.
3. Point the built-in Type at a scratch folder. Finish once as-written, once organized.
4. Create a knowledge-base-destined Type at an empty directory. Finish a task into it.
   Watch the Activity view: setup, deposit, curate. Try the undo.
5. Open a chat on a plain task while AI is not configured. Expect the stated reason and
   no other effect on the board.
6. Repeat on Windows. Switch the interface language and check both catalogs render.

## Packaging note

No new runtime dependency is planned. A change to the Pi SDK pins would be a
supply-chain review item (the constitution's Technology Baseline). None is expected in
this feature.

## Acceptance harness

The drills and the seven scripted validations are the acceptance harness for
`/speckit-tasks`. A task that cannot name one of the numbered validations above is
suspect. No story is complete while a standing gate or a drill is red.

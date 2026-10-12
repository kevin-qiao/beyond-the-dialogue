# Quickstart: Validating Document Type AI Assistant

Validation/run guide for [spec.md](./spec.md)'s success criteria. Entities:
[data-model.md](./data-model.md); interface surface:
[contracts/document-assist-ipc.md](./contracts/document-assist-ipc.md). Everything runs
headless first — the test suite scripts agent sessions at the existing seams
(`setSessionFactory` / `setSimplePromptOverride`); **no test needs network or a provider
key** (Principle III/IV).

## Prerequisites

- Node ≥ 22 (repo floor), Linux or Windows (dev under WSL2 is normal; Windows runs are
  mandatory before the feature lands — Principle V).
- `npm install` (`.npmrc` mirrors are already configured — leave them alone).

## Standing gates (run first, always)

```bash
npm run typecheck     # both named projects; also the i18n catalog-parity gate
npm test              # full headless suite
```

Expected: green, and — because boundaries were touched — the guard drills below must
each be *verified to fail on a deliberate violation* (Principle IV: a gate that cannot
fail is broken, not passing).

## Guard drills (fail-on-violation checks)

| Drill | Deliberate violation | Must fail |
|---|---|---|
| Family CHECK mirror | add a fourth family in `family.ts` without touching `db.ts` mirror comments/CHECKs | the family-mirror guard test |
| chatContext totality | remove the family-less (plain) grounding entry | `test/chatContext.test.ts` |
| Layering | import `src/main` from a renderer component | `test/layering.test.ts` |
| Portability | store an absolute destination path in a new row | `test/portability.test.ts` |
| i18n ratchet | add a user-visible literal outside the catalog | `test/i18n.test.ts` |
| Deposit/snapshot ordering | move the snapshot before the deposit in the curate job | the new ordering test (D7 — undo semantics depend on it) |

## Scripted validation per user story

Run single files with `npx tsx --test <file>` (filter cases with
`--test-name-pattern="..."`).

1. **US1 — write → organize → file (P1)**: seeded session scripts the organized output
   for a `document`-Type task; assert: draft note byte-identical after finish (FR-002),
   artifact at destination with collision-distinct naming, no overwrite (FR-004),
   completion + alarm cleared, path taken reported. Mode `as-written`: **no session
   constructed at all** (spy on the factory seam), exact words filed. Empty draft:
   refused, task stays active.
2. **US1/US2 degradation (SC-002)**: assistant off *and* unconfigured variants — zero
   outbound calls (seam never invoked), as-is filing still lands, finish reports the
   skipped step. A scripted "malformed organize output" run must file as-is with the
   step reported failed (FR-005 gate).
3. **FR-007 / Q1 first-run**: fresh install, built-in `document` Type (destination-less
   seed) — finish refuses with the localized `destination.not_configured` reason and the
   task stays actionable; after pointing the Type at a folder, the same finish files.
4. **US2 — conversations (FR-008–FR-011)**: multi-turn scripted chat on a Document task
   and on a plain task; assert persistence across service re-instantiation (restart
   proxy), fresh-conversation isolation, send-failure keeps prior history, and — via the
   scripted session's captured prompt — the outbound context contains only that task's
   material (FR-011).
5. **US3 — user-declared Types (FR-012/013/014)**: create a document-family Type with
   its own instruction + destination; a task of it files per declaration identically to
   the built-in (dispatch-by-declaration test); save with no location → refused; edit
   instruction → next finish changes, already-filed artifacts untouched (FR-014).
6. **US4 — knowledge base (FR-018–FR-020)**: destined finish into an empty location →
   create-only scaffold appears, deposit lands before curation (ordering pinned),
   curation confined to the collection (writes outside refused), ledger `done` with
   touched-file report. Assistant-off variant: deposit only, curation reported not run.
   **Undo**: restore returns touched curated files to the snapshot state while the
   deposit file stands (Q3=A); undo of failed/never-run or unresolved-wiki refused.
7. **E2E flagship extension** (`test/e2e.test.ts` pattern): idea → Document task →
   draft across a simulated restart → finish (organized) → wiki curation → activity
   ledger → undo → re-finish as-written — all scripted, asserting board never blocks on
   AI (FR-006).

## Manual run (dev machine)

```bash
npm run dev
```

Checklist: switch the assistant ON in Settings; create a document task; finish once with
no destination set (expect the guided refusal); point the built-in at a scratch folder;
finish as-written, then organize; create a knowledge-base-destined Type over an empty
directory and finish a task into it (watch scaffold → deposit → curate in Activity; try
undo); start a chat on a plain task with no AI configured (expect the stated unavailability,
board unaffected). Repeat on Windows; verify both catalogs render (Settings → language).

## Packaging note

No new runtime dependencies are planned; a pin change to the Pi SDK peers would be a
supply-chain review item (constitution Technology Baseline) — none expected this feature.

## Release artifact

This quickstart's drills and story scripts constitute the acceptance harness for
`/speckit-tasks`; tasks that cannot point at one of the numbered validations above are
suspicious, and no story is complete while a standing gate or drill is red.

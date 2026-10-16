# Quickstart Results: Document Type AI Assistant (feature 002)

Record of the validation runs for [quickstart.md](./quickstart.md). Headless results
are complete and reproducible with `npm test`; the interactive GUI passes are
partially complete and the remainder is flagged honestly below.

## Standing gates (2026-10-16, branch `feature/002-implementation`)

```
npm run typecheck   → green (both projects named: tsconfig.node.json + tsconfig.web.json)
npm test            → green, 337 tests, 0 failures (headless, no network, no provider key)
```

## Guard drills (fail-on-violation, each verified red then restored)

| Drill | Violation applied | Result |
|---|---|---|
| Family check mirror | fourth family added to `family.ts`, SQL mirror untouched | `test/family.test.ts` RED (2 failures) → reverted → green |
| chatContext coverage | family-less grounding entry removed | `test/chatContext.test.ts` RED (4 failures) → restored → green |
| Layering | renderer import of `src/main/db` — both `from '…'` and bare side-effect form | `test/layering.test.ts` RED for both forms → restored → green. **Finding:** the guard previously matched only the `from` form; a bare `import '…'` walked through. The guard was strengthened (both forms scanned) as part of this drill. |
| Portability | (a) attachment row storing an absolute path; (b) `snapshot_dir` stored absolute | (a) `test/portability.test.ts` RED; (b) the order pin's FR-024 assertion in `test/knowledgeBase.test.ts` RED → both restored → green. The portability scan now also covers `ingest_ledger.snapshot_dir`. |
| i18n baseline | user-visible JSX literal added outside the catalogs | `test/i18n.test.ts` RED → removed → green (baseline stays empty) |
| Deposit/snapshot order | snapshot moved before the deposit in `depositThenCurate` | `test/knowledgeBase.test.ts` order pin RED → reverted → green |

## Scripted validations (§1–§7 of quickstart.md)

| § | Scenario | Test file(s) | Status |
|---|---|---|---|
| 1 | US1 write→organize→file; draft byte-identical; distinct name on collision; as-written spies zero sessions; blank draft refuses | `test/organize.test.ts`, `test/finish.test.ts`, `test/finishService.test.ts` | PASS |
| 2 | Degradation: assistant-off and never-configured make zero outbound calls; malformed organize files the draft as written with the step reported failed | `test/organize.test.ts`, `test/assistantSwitch.test.ts`, `test/e2e.test.ts` | PASS |
| 3 | FR-007/Q1 first run: fresh DB, built-in Document Type with no location, guided `destination.notConfigured` refusal (localized in both languages), point-and-file, destination-loss `destination.unreachable` | `test/freshInstall.test.ts` | PASS |
| 4 | US2 conversations: multi-turn grounded chat on document and plain tasks; restart stand-in (service re-creation) keeps order; new conversation isolation; failed send keeps history; FR-011 zero cross-task leak; FR-010 task byte-identical; usage metadata stored | `test/conversations.test.ts`, `test/chat.test.ts`, `test/chatMessages.test.ts` | PASS |
| 5 | US3 user Types: identical declarations dispatch identically to the built-in; destination-less save refused; instruction edits apply going forward only, filed artifact byte-identical; removal re-homes; user-defined key assignable (reconciliation point settled) | `test/userTypes.test.ts`, `test/types.test.ts`, `test/typeLabels.test.ts` | PASS |
| 6 | US4 knowledge base: create-only minimal structure at first destined finish; deposit before the curation session is constructed (order pinned); curation confined by the tool surface; ledger `done` with touched-file report; assistant-off deposit-alone with "did not run" report; undo restores touched files while the deposit stands; refusals for not-done / snapshot-missing / unresolvable | `test/knowledgeBase.test.ts`, `test/undo.test.ts`, `test/failure.test.ts`, `test/wiki.test.ts` | PASS |
| 7 | E2E flagship: idea → Document task → draft across simulated restart → finish organized → wiki curation → ledger → undo → re-finish as-written; board never blocks on AI; zero outbound calls in off segments | `test/e2e.test.ts` | PASS |

Migration ladder v13–v15 (including the legacy v2/v4/v12 fixtures, idempotence, and
history-row preservation): `test/core.test.ts`. Retired-job-kind history rule:
`test/ai.test.ts`.

## Smoke launch (Linux, WSL2)

`npm run dev` (2026-10-16): main bundle, preload and renderer built cleanly; the
Electron app started against a live userData database (running the full v2–v15 ladder
at startup), registered its IPC handlers and opened its window; 60 s run produced no
main-process error output (only WSLg zygote noise and pre-existing dynamic-import
advisories). Startup-level wiring is green.

## Manual interactive passes — PENDING (require a human at the GUI)

The following quickstart steps need interactive desktop sessions and have NOT been
performed by the implementation run; they are recorded here so the state is honest:

- **T047 (Linux interactive, `npm run dev`)**: the six manual steps — guided refusal
  toast, pointing the built-in at a scratch folder via the Types editor, one
  as-written and one organized finish through the TaskBand choice, a wiki-destined
  Type finished into an empty directory (watching setup/deposit/curate in Activity),
  the undo action, and a plain-task chat with AI unconfigured (stated reason, no
  board effect). **SC-001 timing** (write→file < 3 min) and **SC-010 timing**
  (learning case < 15 min) belong to this pass — they measure the real UI with a
  real provider and cannot be produced headlessly.
- **T048 (Windows + language toggle)**: the same pass on a Windows desktop build,
  plus the interface-language toggle through every new surface (FR-022/FR-023,
  SC-007), path confinement on Windows separators, and the wiki scaffold there.

Every behavior these passes exercise is pinned by the scripted validations above;
the manual passes confirm the rendered surfaces, timings, and platform parity.

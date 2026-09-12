# Validation Record — Extensible Type Workflows

**Run**: 2026-09-12 · branch `mvp/v2.0-cat-board` · Linux (WSL2, `x86_64`), Node v24.20.0

Records the outcome of `quickstart.md` S0–S9 against the implementation. Written because an
unrecorded gap is a failing gate, not an unknown — where a scenario was not run, this says
so rather than leaving it implied.

---

## S0. Baseline

| | Baseline (T001, commit `1d48cfd`) | Final |
|---|---|---|
| `npm test` | 65 tests, 65 pass, 0 fail, 0 skipped | **196 tests, 196 pass, 0 fail, 0 cancelled, 0 skipped, 0 todo** |
| `npm run typecheck` | exit 0 *(see the finding below)* | exit 0, **genuinely checked** |
| `npm run build` | not recorded | exit 0 |

**Finding — the typecheck gate was a no-op.** `npm run typecheck` ran `tsc --noEmit`
against the root `tsconfig.json`, which is a solution file (`"files": []` plus
`project_references`). `tsc --noEmit` against a solution file compiles **no files**;
referenced projects are only built with `-b`. The baseline "pass" therefore proved nothing,
and the tree contained ~11 real type errors that had never been surfaced:

- `src/main/ai/agent-runtime.ts:144` — a message array not assignable to the SDK's `Message[]`
- `src/main/index.ts:367` — `res.filePaths[0]` possibly `undefined` (`noUncheckedIndexedAccess`)
- `src/main/preprocess.ts:85` — `string | false` where a type predicate was declared
- `src/main/skills.ts:16` — possibly-undefined indexed access
- `src/renderer/.../CommandPalette.tsx` × 5 — **`Settings` passed where `TaskTypeDef[]` is expected**, so every task in the command palette silently rendered as "Plain task", and `c.isCustom` (a property that does not exist) made every type report itself as built-in
- `src/renderer/.../typeCatalog.ts`, `SettingsView.tsx` — introduced by this feature, fixed here

**Resolution**: the script now names both projects explicitly
(`tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`), and all the
errors above are fixed. This is recorded as a finding because it changes what S0 and T072
can claim: the baseline's green typecheck was not evidence, and the final one is.

---

## S1. Meeting task, agenda to filed minutes — **PASS**

`npx tsx --test test/e2e.test.ts`

| Step | Evidence |
|---|---|
| 1 · Create a Meeting task | `e2e.test.ts` 8.1c — category resolves to `meeting`, not `plain` |
| 2 · Add to My Day | the **meeting** pre-process is enqueued, not the plain suggestion path |
| 3 · Agenda and core topics | `preprocess.summary` contains `## Suggested agenda` and `## Core topics` |
| 4 · Minutes persist without an explicit save | written through the working area's own save path; asserted on disk in the vault *and* in the store. `NotesEditor` is debounced-autosave with no save button, so one save is the whole of the user's action |
| 5 · Finish | artifact written to the configured folder; task complete |
| 6 · Inspect the file | plain markdown; **no** `index.md`, `CLAUDE.md` or `.history` alongside it — nothing wiki-shaped is imposed on the folder |

**Also asserted (the criterion most likely to be skipped)**: `e2e.test.ts` 8.1d runs a
scripted assistant that tries to inject a decision the user never recorded. The finish
still completes, the injection is caught, and the user's own words are what is filed.

## S2. Changing where a type's finished work goes — **PASS**

`test/destination.test.ts`, `test/types.test.ts`

- A destination change applies to **subsequent finishes only**: the earlier artifact is
  still present, byte-identical, in its original folder; the new one lands in the new
  folder; nothing is moved.
- **Round-trip**: every declared field survives save and reload, including
  `finishBehaviour`, `destination` and `grants`. This is the hazard the contract names —
  `upsertType` writes an explicit column list — and the test compares the whole object.

## S3. A user-defined type — **PASS**

`test/types.test.ts`

- A custom type's own `aiGuidance` appears in the built pre-process prompt, and its
  declared destination and behaviour drive the finish.
- An unrecognised `finishBehaviour` is **rejected**, never defaulted; an *absent* one falls
  back to the category's historical workflow (**but not for `meeting`**, which has no
  history to preserve and is refused instead).
- Deleting a custom type reassigns its tasks without losing core fields, and an
  already-written artifact remains on disk untouched.

## S4. Grants, confinement, and the egress boundary — **PASS**

`test/grants.test.ts`, `test/mcpAdapter.test.ts`

| # | Result |
|---|---|
| 1 · Granted type's session sees the tool | PASS — `resolveGrant` returns the type's grant |
| 2 · Ungranted type gets none | PASS |
| 3 · Confined operation, granted type | PASS — `NO_GRANT` unconditionally, asserted against a deliberately over-permissive type |
| 4 · Granted session's context excludes working content | PASS — notes, minutes and derived summaries are gone; declared inputs remain |
| 5 · Ungranted session's context unchanged | PASS — byte-identical to today's context |
| 6 · A proposed change sends nothing | PASS |
| 7 · Confirming applies exactly that change | PASS — one confirmation, one change; it cannot be replayed |
| 8 · Conversational request, no confirmation | PASS — the tool surface contains the proposal tool and **not** the mutator |
| 9 · Tool server unreachable | PASS — reported as a failure, never as success |

**Not covered by these tests, and not claimed**: rows 1, 6 and 7 exercise the *seam and the
model*, not a live external system. The MCP transport is deferred (below), so a granted
tool server does not yet reach anything.

## S5. The learning flow is unchanged (SC-003) — **PASS**

`test/e2e.test.ts`, `test/wiki.test.ts`, `test/queue.test.ts`, `test/failure.test.ts`

All pass. The deposit-first ordering, the `.history` snapshot, the confinement refusal and
the mid-ingest failure path are all covered by tests that were **not modified**, which is
what makes this evidence rather than assertion. `runIngestJob` now delegates to the shared
`depositThenCurate` strategy, and that refactor is what these tests hold honest.

**Four existing assertions were changed, deliberately, and are recorded here** because S5
says a needed change is a finding to justify:

1. `test/core.test.ts` — the built-in type set is `['jira','learning','plain']`. SC-002
   *requires* it to grow to four. Updated to include `meeting`.
2. `test/types.test.ts` — same assertion, same reason.
3. `test/types.test.ts` — `listTypeDefs().length === 4` (3 built-ins + 1 custom), an
   arity that follows from (1). Updated to 5.
4. `test/types.test.ts` — "editing a built-in only changes presentation" asserted that a
   changed `kind` was **silently ignored**. FR-017 and contracts/type-definition.md say a
   built-in's category change is **refused**, and T043 requires exactly that. The
   assertion now expects a refusal, and additionally asserts the new
   `finishBehaviour` immutability.

No learning-workflow behaviour is asserted by any of the four, and no test was edited to
accommodate a refactor. Every other existing test file passes untouched.

## S6. Safety and degradation — **PASS**

`test/finish.test.ts`, `test/finishService.test.ts`, `test/artifactStore.test.ts`

| Scenario | Result |
|---|---|
| Finish with no AI provider | PASS — completes, files the content unpolished, reports the assistant step as failed |
| Assistant step fails mid-finish | PASS — content preserved, task **not** complete, retriable |
| Destination resolves outside its root | PASS — refused with a message naming the destination; nothing written |
| Destination missing or unwritable | PASS — `prepare()` reports it **before** the task is marked complete |
| Two finishes, same filename | PASS — `name-2.md` alongside; the first is byte-identical; nothing moved |
| A new destination directory in the audit trail | PASS — a wiki destination with a non-default subdir is covered by snapshot and diff; the folder store reports the written file in the activity record |

## S7. An unrecognised category fails loudly — **PASS**

`test/e2e.test.ts` 8.1e, `test/layering.test.ts`

A meeting task resolves to category `meeting`, to the `markdown` working area, to the
**meeting** pre-process instruction (asserted to be a different object from the jira one),
and to `polish-then-file`. `plain` is asserted to have *no* pre-process, so a registry that
lost its meeting entry fails rather than silently resembling a correct answer.

The layering guard was **probed** with a deliberate violation (`renderer → src/main`) to
confirm it fails; it does, and passes again once removed. A guard that cannot fail is not
a guard.

## S8. Layering holds — **PASS**

`test/layering.test.ts`, plus direct inspection

| Check | Result |
|---|---|
| `src/core/` imports no `electron`, `node:*`, DOM global | PASS, asserted mechanically (comments stripped, so the rule can be named in prose) |
| `src/renderer/` imports nothing from `src/main/` | PASS — matched by *resolved path segment*, not by substring (`domain/` contains `main/`, and a guard that cries wolf gets weakened) |
| Platform APIs confined | Electron is imported by exactly two files: the composition root `src/main/index.ts` and the preload |
| `src/core/` is non-empty | PASS — asserted, so a renamed-away layer cannot report green |

## S9. Cross-platform — **PARTIAL, and recorded as such**

| Check | Result |
|---|---|
| `npm test` on Linux | PASS (154/154) |
| `npm run typecheck` on Linux | PASS |
| `npm run build` on Linux | PASS |
| `npm test` / `build` on **Windows** | **NOT RUN** — no Windows environment was available in this session |

**Recorded limitation, not an assumption.** The Windows half of this gate is unexercised.
Two things make that a smaller risk than it sounds and neither makes it a pass:

- The code that could plausibly diverge is confined to `src/main/adapters/paths.ts` (the
  platform `PathPort`) and the wiki functions that map separators; everything else handles
  `/`-separated, root-relative strings by construction.
- The confinement check normalizes through the platform port, and the Windows-shaped
  traversal case (`subdir: '..\\escape'`) is asserted in `test/destination.test.ts` on
  Linux — separation characters are handled explicitly rather than inferred.

The MCP adapter's native-module gate (T062) is likewise **not run**, and is moot for this
release because the adapter is deferred.

---

## Phase 7 gates — the tool-server half is deferred

Recorded in full at `research.md` R7a. In summary: `pi-mcp-adapter@2.33.0` pins
`@modelcontextprotocol/client` and `@modelcontextprotocol/core` to `pkg.pr.new` **preview
commit URLs** rather than published npm versions — the exact disqualifier R7 named, for
packages that do have ordinary releases. T061 therefore fails on its stated criterion; T062
(both-platform native builds) could not be run; T063 and T064 could not be completed. The
R7a fallback was invoked, and **FR-018 is amended in `spec.md`** rather than left claiming
unbuilt behaviour.

---

## Summary

- **S0–S8**: pass, with S0's finding recorded (the typecheck gate was not gating).
- **S9**: Linux pass; Windows **not run** and recorded as a limitation.
- **Phase 7**: gates run; **tool-server transport deferred** with evidence, and the spec amended.
- **Tests**: 65 → **196**, none failing, none skipped. Four pre-existing assertions changed —
  seven deleted lines in total, all listed above — and `test/wiki.test.ts`,
  `test/queue.test.ts` and `test/failure.test.ts` are **byte-identical**, with e2e's
  flagship learning scenario unchanged. That is the SC-003 proof.
- **`npm run typecheck`**: clean, and now genuinely checking both projects.
- **`npm run build`**: clean.

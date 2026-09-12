# Quickstart Validation: Extensible Type Workflows

**Feature**: `specs/001-extensible-type-workflows/spec.md`
**Date**: 2026-09-12

Runnable scenarios that prove the feature works end to end. Each names what to run, what
to observe, and which requirement it demonstrates. Behavioural detail lives in the
contracts and `data-model.md` — this file is the validation guide, not a design document.

---

## Prerequisites

```bash
node --version        # MUST be >= 22 (node:sqlite)
npm install
```

No API key is required. Every scenario below runs headless: agent sessions are replaced
with scripted stand-ins through the existing seams (`setSessionFactory`,
`setSimplePromptOverride` in `src/main/ai/session-factory.ts`), and each test redirects its
own storage root via `setUserDataRoot()` — so no scenario touches real user data.

---

## S0. Capture the baseline first

**Do this before any implementation.** It is the only way a later regression is
attributable rather than ambiguous.

```bash
npm test
npm run typecheck
```

**Expected**: both pass, with no pre-existing failures. **Record the result.** If either is
already failing, that is a precondition to fix or explicitly note — not something to
discover midway through the change.

**Why this matters here specifically**: SC-003 requires the learning flow to behave
identically, and the proof is the existing learning tests passing *unmodified*. That claim
is only checkable against a known-good starting point.

---

## S1. Meeting task, agenda to filed minutes (US1, P1)

```bash
npx tsx --test test/e2e.test.ts
```

With a scripted session that returns an agenda and topics for the pre-process call and a
polished document for the finish call:

| Step | Action | Expected |
|---|---|---|
| 1 | Create a task of the Meeting type with its required inputs | task created, category `meeting` |
| 2 | Add it to My Day | pre-process enqueued (not the plain-task suggestion path) |
| 3 | Let pre-process complete | an agenda and core topics are presented |
| 4 | Write minutes into the working area | content persists without an explicit save |
| 5 | Finish | the artifact is written to the configured folder, task marked complete |
| 6 | Inspect the written file | plain markdown, readable with no workspace or schema |

**Pass condition**: a polished markdown file exists at the configured location, contains a
distinct action-items section drawn from the written minutes, and the task is complete.

**Also assert** (this is the acceptance criterion most likely to be skipped): the finished
document contains **no** fact, decision, or action item the user did not record (FR-009,
SC-011). A scripted session that tries to inject an extra decision MUST be caught.

---

## S2. Changing where a type's finished work goes (US2, P2)

| Step | Action | Expected |
|---|---|---|
| 1 | Finish a task of a type | artifact lands at the type's destination |
| 2 | Change that type's destination in settings | the change saves and round-trips |
| 3 | Finish another task of the same type | artifact lands at the **new** destination |
| 4 | Inspect the first artifact | still present, unmodified, in its original location |

**Pass condition**: step 4 shows the earlier artifact untouched. A destination change
applies to subsequent finishes only (FR-005).

**Round-trip check** (do not skip): read a type, edit it, save, read it again. Every
declared field — including the new behaviour, destination, and grants — must survive. The
persistence statement writes an explicit column list, so a field omitted there is silently
dropped on save.

---

## S3. A user-defined type (US3, P3)

From the settings surface, with no code changes:

1. Create a type: label, icon, AI instruction, output destination, finish behaviour.
2. Create a task of that type and add it to My Day.
3. Let pre-process complete.
4. Finish the task.

**Pass condition**: the custom instruction is reflected in the analysis, and Finish routes
to the declared destination using the declared behaviour (SC-004).

**Then**: delete the type. Tasks referencing it MUST be reassigned, not destroyed, and
already-written artifacts MUST remain on disk (FR-016).

---

## S4. Grants, confinement, and the egress boundary (US4, P4)

Uses a scripted tool double — no real external system and no live MCP connection.

| # | Scenario | Expected |
|---|---|---|
| 1 | A session for a type with a granted tool server | the granted tool is available |
| 2 | A session for a type without the grant | the tool is unavailable |
| 3 | A type with the grant, but a confined operation (ingest, polish, suggestions) | the confined session receives **no** grant |
| 4 | A type with the grant, interactive session | context excludes notes, minutes, drafts, the wiki, and other tasks |
| 5 | Same type, no grant, interactive session | context is today's full context, **unchanged** |

**Pass conditions**: #3 holds for every configuration a user can produce (SC-006), and #4
holds structurally — a granted session sees less of the user's material, deliberately
(FR-029, SC-010).

**Remote actions**:

| # | Scenario | Expected |
|---|---|---|
| 6 | Ask the assistant to change an external status | a proposal is produced; **nothing is sent** |
| 7 | Confirm the proposal | exactly that change is applied; the outcome is reported |
| 8 | Ask in conversation, do not confirm | no remote change ever occurs (FR-023, SC-005) |
| 9 | The tool server is unreachable | failure is reported; never presented as success |

**The check that matters for #8**: there must be no code path from a model tool call to a
remote write. Verify by inspecting the tool surface exposed to the model — it must contain
the proposal tool and not the mutator.

---

## S5. The learning flow is unchanged (SC-003)

```bash
npx tsx --test test/*.test.ts
```

**Pass condition**: the existing learning tests pass **unmodified**. Editing them to
accommodate the change weakens the proof that `deposit-then-curate` still behaves
identically — if a test needs to change, that is a finding to justify, not an adjustment
to make.

Explicitly re-verify the deposit-first ordering, the `.history` snapshot, and the confinement
refusal: these are the reasons the flow is trustworthy and they must survive the
destination generalization.

---

## S6. Safety and degradation

| Scenario | Expected |
|---|---|
| Finish with no AI provider configured | succeeds; content filed unpolished; task complete (FR-025) |
| Assistant step fails mid-finish | user content preserved; task not complete; retriable without retyping (FR-011, FR-027) |
| Destination resolves outside its root | refused with a clear message; **nothing written** (FR-006) |
| Destination folder missing or unwritable | reported before the task is marked complete |
| Two finishes produce the same filename | second written under a distinct name; first untouched; nothing moved (FR-026, SC-008) |
| A new destination directory | appears in the snapshot/diff audit trail — **not silently absent** |

The last row is the subtlest: the existing snapshot walk covers a hardcoded directory list,
so a new destination is invisible to it unless the walk is derived from the destinations in
use. Verify by checking that the activity record lists the touched file.

---

## S7. An unrecognised category fails loudly

With a category that has no working-area or pre-process branch:

**Expected**: the task routes to the correct surface for its category, or fails visibly.
It MUST NOT silently behave like a plain task.

**Why this is its own scenario**: the category resolver falls back to `plain` on an
unrecognised value, so a missing branch degrades silently — producing a plausible-looking
task that quietly does the wrong thing. This is the highest-risk silent failure in the
feature.

---

## S8. Layering holds

```bash
npm run typecheck
```

| Check | Expected |
|---|---|
| `src/core/` imports | no `electron`, no `node:*`, no DOM globals |
| `src/renderer/` imports | nothing from `src/main` |
| Platform API usage | confined to `src/main/adapters/` |

**Why it is checkable now**: `src/core/` is included in both the node and web TypeScript
projects, so an environment-specific import fails the typecheck in the project that cannot
support it. The web host is not built by this feature — the point is that its absence is
enforced at build time rather than by convention.

---

## S9. Both platforms

Per Constitution Principle I, a feature is not complete until exercised on Windows and
Linux, or its limitation is documented.

| Check | Notes |
|---|---|
| `npm test` on Windows and Linux | must pass on both |
| `npm run build` on both | must produce a working bundle |
| If the MCP adapter is adopted: native modules build on both | `@napi-rs/keyring` and `fs-native-extensions` need per-platform builds; Linux typically needs `libsecret` — document it with the existing packaging prerequisites |

**If a platform cannot be exercised**, record the limitation explicitly. An unrecorded
platform gap is treated as a failing gate, not an unknown.

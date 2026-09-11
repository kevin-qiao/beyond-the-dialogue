<!--
Sync Impact Report
==================
Version change: 1.0.0 → 1.1.0
Rationale: MINOR — a principle is added (VI. Avoid Hardcoding) and the
  Development Workflow & Quality Gates section gains a corresponding gate.
  No principle is removed or redefined, and no previously compliant work
  becomes non-compliant.

Modified principles:
  - None renamed or redefined. Principle III (Layered Architecture) already
    forbade hardcoded dispatch on a concrete key; Principle VI generalizes
    that rule beyond dispatch and adds the comment obligation for the
    unavoidable cases. The overlap is deliberate and cross-referenced, not
    duplicated.

Added sections:
  - Core Principles → VI. Avoid Hardcoding
  - Development Workflow & Quality Gates → gate 7

Removed sections: none

Follow-up TODOs: none.
-->

# Beyond the Dialogue Constitution

## Core Principles

### I. Cross-Platform Desktop First

The application is a desktop product and MUST run natively on both Windows and
Linux from the same codebase. Platform-specific behavior MUST be isolated at
defined boundaries rather than scattered through feature code.

- No feature may be declared complete until it has been exercised on both
  Windows and Linux, or an explicit, documented platform limitation is recorded.
- Path handling MUST go through the centralized path module — never string
  concatenation of separators, and never a hardcoded user-data location.
- Shell invocations, file-mode assumptions, and anything that behaves
  differently across platforms MUST be confined to a single adapter module so
  the divergence is auditable in one place.
- Platform-specific bugs are correctness bugs, not polish items; they block
  release exactly as a failing test does.

Rationale: supporting two platforms is a product commitment. Scattered platform
conditionals make that commitment unverifiable and expensive to keep.

### II. Clean, Simple UI — Function Before Polish

The interface MUST stay clean and simple. Completing the function is the first
priority; visual refinement is secondary and MUST NOT delay or displace
functional completeness.

- Every feature MUST be functionally complete and usable before it receives
  cosmetic refinement.
- A screen MUST present only what the current task needs. Adding a control
  requires that the control carry a function the user cannot reach otherwise.
- Visual complexity MUST be justified by a functional requirement, not by
  preference or novelty.
- Consistency of interaction patterns across views is required; a new view MUST
  reuse existing shared primitives rather than introduce a parallel idiom.
- No feature may trade a broken or absent function for a better-looking shell.

Rationale: the value of this product is the work it completes. Simplicity is a
constraint on design, not an aesthetic preference.

### III. Layered Architecture

The design MUST be clearly layered, extensible, and honest about its
boundaries. Each layer has a defined responsibility and MUST NOT reach across
layers to shortcut work.

- Process layers (main, preload, renderer, shared) MUST respect their
  boundaries: the renderer reaches the main process only through the declared
  IPC surface, never by direct import of main-process modules.
- Feature dispatch MUST go through the declared abstraction (a type's kind, or
  the equivalent extension point) — never through a hardcoded branch on a
  specific concrete key.
- External runtimes MUST be confined behind adapter seams so the rest of the
  system depends on an interface rather than a vendor SDK. New external
  dependencies follow the same rule: introduce the seam, then the dependency.
- Adding a feature MUST mean extending the layer that owns the concern, not
  editing every layer it passes through.
- Persistence boundaries MUST be respected: serialization concerns (for example
  column naming) stay in the storage layer and MUST NOT leak into domain types.
- Layering violations are treated as defects and MUST be corrected before the
  work is considered done.

Rationale: a layered design is what makes the system extensible. A boundary
that can be crossed casually provides no guarantee at all.

### IV. Complete Unit Test Coverage (NON-NEGOTIABLE)

Every behavior-bearing module MUST have unit tests. Work without tests is
incomplete work, regardless of how small the change appears.

- Every module containing logic MUST have a corresponding test file under
  `test/`, and new behavior MUST arrive with tests covering it.
- Tests MUST run headless and MUST NOT require a GUI runtime, a network
  connection, or an API key. External dependencies are replaced with scripted
  test doubles through the designated seams.
- Tests MUST be deterministic and self-contained: no dependence on wall-clock
  time, execution order, or shared mutable state between cases. Each test
  isolates its own storage root.
- Bug fixes MUST be accompanied by a regression test that fails before the fix
  and passes after.
- The full suite (`npm test`) and the typecheck (`npm run typecheck`) MUST both
  pass before any change is considered complete. A test skipped to make a build
  green is a failure, not a pass.

Rationale: the test suite is the mechanism that keeps a layered, extensible
design from degrading. Coverage is a condition of correctness here, not a
metric to optimize later.

### V. Git-Managed Development

All work is managed in git. The repository's history is the record of what
changed and why.

- Every change MUST land as a reviewable, self-contained commit or commit
  series with a message that states the intent of the change.
- Direct, unreviewed work on the main branch is prohibited; changes are
  prepared on a branch first.
- Generated output, local agent workspaces, and local workflow data MUST remain
  untracked. Committing build artifacts or local state is prohibited.
- Secrets and credentials MUST NOT be committed. Access credentials belong in
  user data locations, never in the repository.
- Specs and documentation MUST be updated in the same change as the code they
  describe, so the repository never records a documented behavior the code does
  not have.

Rationale: traceability depends on the history being truthful and complete.

### VI. Avoid Hardcoding

Values and behavior that describe intent MUST be declared where that intent is
owned, and consumed from there — never embedded in the logic that happens to
use them. A literal that carries meaning is configuration, not a constant.

- Values a user, operator, or future change could reasonably need to alter —
  paths, limits, thresholds, labels, allowed values, lists, defaults — MUST be
  declared in the place that owns them and read from there.
- A meaningful literal appearing in more than one place MUST be extracted to a
  single named declaration. Two occurrences are already one too many.
- Behavior dispatch MUST NOT branch on a concrete key. That is the dispatch
  case of Principle III and remains governed there.
- Defaults MUST be declared exactly once. A default duplicated at a call site
  and in its declaration is a defect, because the two will drift apart.
- Hardcoded values MUST NOT be introduced to satisfy a test by matching a
  fixture. Tests adapt to the declared source, never the reverse.

**When hardcoding is genuinely unavoidable**, and only then, it MUST be made
explicit rather than incidental:

- A comment MUST state why the value is hardcoded, and what would have to
  change for it to become configurable. "This is fixed" is not a reason. A
  named external constraint, a protocol requirement, a platform behavior, or a
  measured performance need is.
- The value MUST be isolated to a single named location, never scattered as
  bare literals across several files.
- The comment MUST sit with the value itself, not in a commit message or a
  document the next reader will not open.

Rationale: hardcoding is how a codebase quietly stops being extensible. Each
literal is cheap on its own and expensive in aggregate, and the cost only
appears when someone finally needs to change one. The comment obligation exists
because the unavoidable cases are legitimate; what is not legitimate is leaving
the next reader unable to tell a deliberate constraint from an oversight.

## Platform & Technology Constraints

- **Runtime baseline**: Node.js ≥ 22 is required. The application depends on
  runtime features unavailable in earlier versions, and this floor MUST NOT be
  lowered without removing that dependency.
- **Desktop shell**: Electron. The three-process split (main, preload,
  renderer) is fixed; the preload bridge is the only sanctioned channel between
  renderer and main.
- **Language**: TypeScript throughout. Type checking is a build gate, not a
  suggestion; `any` used to bypass a genuine type conflict MUST be justified in
  the change.
- **Module formats**: the main process builds as ESM. ESM-only dependencies
  MUST be loaded through dynamic import at their adapter seam rather than
  forcing a format change on the build.
- **Storage**: local-first. All persisted state lives under the platform's user
  data directory, resolved through the centralized path module. Tests MUST be
  able to redirect that root so no test touches real user data.
- **Build output**: build artifacts are disposable and are never committed.
  A clean checkout MUST be buildable from the repository contents alone.
- **Dependency pinning**: the embedded agent runtime is pinned to exact
  versions. It MUST NOT be floated, and its usage MUST remain confined to the
  designated adapter modules.

## Development Workflow & Quality Gates

A change is complete only when all of the following hold:

1. **Tests pass.** The full suite passes locally with no skipped or disabled
   cases related to the change.
2. **Types pass.** The typecheck completes with no errors.
3. **Behavior is covered.** New and changed behavior has unit tests that would
   fail if the behavior regressed.
4. **Layering holds.** No boundary described in Principle III was crossed, and
   any new external dependency arrived behind a seam.
5. **Both platforms are considered.** The change is exercised on Windows and
   Linux, or its platform limitation is documented.
6. **Specs are current.** The specification source of truth reflects the
   behavior that shipped, updated within the same change.
7. **No unexplained hardcoding.** No new meaningful literal is embedded in
   logic, or any that is carries a comment stating why it is unavoidable and
   what would make it configurable (Principle VI).

Review of any change MUST verify these gates explicitly. A gate that cannot be
verified is treated as not met.

Complexity MUST be justified against the simplest alternative that satisfies
the requirement. When a simpler design would meet the need, the simpler design
is required.

## Governance

This constitution supersedes other development practices and conventions where
they conflict. Where guidance documents describe runtime or architectural
detail, those documents MUST be read as elaborations of these principles, not
as replacements for them.

**Amendment procedure**: an amendment is proposed as a written change to this
file, stating the principle or section affected, the reason, and any migration
required for work already in flight. Amendment requires explicit approval by
the project maintainer before it is committed. Amending the constitution is
itself a change subject to the workflow gates above, with the exception of the
gates that the amendment itself alters.

**Versioning policy**: versions follow semantic versioning.

- **MAJOR** — a principle is removed or redefined in a way that makes
  previously compliant work non-compliant.
- **MINOR** — a principle or section is added, or existing guidance is
  materially expanded.
- **PATCH** — clarifications, wording corrections, and non-semantic
  refinements that do not change what compliance requires.

**Compliance review**: every change MUST be checked against the principles
before it is considered complete. Non-compliance found in existing code MUST be
either corrected or recorded as a known deviation with a plan to correct it;
unrecorded non-compliance is a defect. When a principle is genuinely
impractical for a specific case, the correct action is an amendment, not a
silent exception.

**Version**: 1.1.0 | **Ratified**: 2026-09-10 | **Last Amended**: 2026-09-11

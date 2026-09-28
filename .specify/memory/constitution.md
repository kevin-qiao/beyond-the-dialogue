# Beyond the Dialogue Constitution

## Core Principles

### I. Extensible Architecture, Decoupled Components (NON-NEGOTIABLE)

Every feature MUST be added by extension — declaration, registration, dispatch on declared
capability — not by modifying existing behaviour.

- Components MUST depend only toward stable abstractions: the domain/core layer performs no
  I/O; all side effects enter through declared ports implemented at the edges.
- Behaviour is dispatched on declarations (a type's declared inputs, instruction, finish
  behaviour, grants), never on hardcoded identity: no branching on a type key, a name string,
  or a `kind === …` comparison outside the dispatch registries themselves.
- Cross-layer contracts (domain types, IPC channels, events) are defined once and changed in
  lockstep; drift between producer and consumer MUST fail mechanically — a compile error or a
  guard test — not at runtime on one host only.
- Boundaries are enforced by tests, not by convention alone.

Rationale: the product is a type engine whose promise is that users extend it without
forking it. Code that couples to a concrete identity turns every new capability into a
rewrite of the old ones.

### II. The Deterministic / Dynamic Boundary (NON-NEGOTIABLE)

Every design MUST state explicitly which parts are deterministic (implemented in code) and
which are dynamic (powered by an AI agent), and the guarantees each side carries.

- Correctness, safety, and permission guarantees belong to deterministic code. A model's
  compliance is never a control: operations that require confirmation or confinement MUST be
  structurally unreachable from the agent's tool surface, not merely instructed against.
- Agent output that reaches persisted state MUST pass a deterministic validation before
  acceptance; when validation fails, the defined fallback (file the user's own content,
  record the AI step as failed) applies.
- No user-facing flow may fail solely because AI is unavailable or produced garbage — every
  AI-powered step declares its degradation path.
- Specs and plans MUST annotate the deterministic/dynamic split for each feature they
  introduce; an un-annotated plan is incomplete.

Rationale: an agentic app that cannot say which of its guarantees the model is load-bearing
for has no guarantees. Keeping the boundary explicit is what makes AI output trustworthy
and failures survivable.

### III. Agentic by Design

This is an agentic application: agent cases are first-class in every design, from the happy
path to failure, cancellation, and absence of a configured provider.

- The built-in agent runtime is the Pi coding agent (https://pi.dev/docs/latest). SDK usage
  is confined to explicitly named seam modules; no other file imports the runtime directly.
- Agent sessions are built from the run's declared purpose. A purpose that grants nothing
  must be incapable of yielding a grant, even under a misconfigured type or setting.
- Tests MUST be able to replace agent behaviour at the seams (scripted sessions, prompt
  overrides); no test may require network access or a provider key.
- Long-running agent work goes through the persisted job machinery — retries with backoff,
  progress reporting, requeue-after-crash — never through an ad-hoc promise.
- Sessions that own external resources (child processes, MCP servers) MUST have an explicit
  disposal contract; aborting is not disposing.

Rationale: confining the runtime to seams keeps the domain headlessly testable, keeps
confinement guarantees independent of configuration, and keeps a runtime or model failure
from leaking into everything it touched.

### IV. Unit Tests for Core Components (NON-NEGOTIABLE)

- Core components — domain rules, application services, port contracts, and every dispatch
  registry — require unit tests before the feature they support is considered complete.
- Tests run headless: plain Node, no desktop host is launched, no network, no API key.
- Every guard test added to protect a boundary (layering, naming, drift, totals over a
  registry) MUST be verified to fail on a deliberate violation. A gate that cannot fail is
  treated as broken, not as passing.
- The full suite and the typecheck pass before any change lands; both name their targets
  explicitly so neither can silently compile nothing.

Rationale: the extensibility promise only holds if adding a feature provably does not break
the others. A guard that quietly stopped guarding once cost the repo eleven hidden type
errors; testability is the load-bearing part of the architecture, so it is itself tested.

### V. Cross-Platform Desktop (Linux & Windows)

- The product targets desktop Linux and desktop Windows. Platform-sensitive behaviour —
  paths, notifications, launch-at-login, packaging, credential storage — goes behind a
  neutral interface with per-target implementations.
- A feature MUST work on both targets or degrade explicitly and visibly on one; a design
  that only works on the developer's machine does not ship.
- Release artifacts follow the per-target convention (AppImage/deb for Linux, installer for
  Windows); a change to packaging or paths is reviewed against both targets.

Rationale: two targets from day one is cheaper than retrofitted portability later; naming
the targets is what makes "works for me" a failing condition.

## Technology Baseline

- The sanctioned implementation languages are **TypeScript** and **Python**.
  - TypeScript carries the application: desktop host, UI, domain, and integration layers,
    built ESM with a strict typecheck as a hard gate.
  - Python MUST be confined to agent-facing skills, tooling, and data components around
    the app; it MUST NOT appear inside the desktop host, UI, or domain layers. Each such
    component obeys Principle I's boundary rules like any other.
  - Introducing any other language requires a constitution amendment (MAJOR or MINOR per
    the Governance versioning policy).
- The desktop host is Electron; the Node runtime floor is the version documented in
  `CLAUDE.md` (currently ≥ 22, for its built-in SQLite).
- Agent runtime packages (the Pi coding agent SDK and its peers) are pinned to exact
  versions; a pin change is a supply-chain decision and goes through review.
- Persistence is split by nature of the data: structured state in an embedded database,
  user-owned documents as plain files the user can open anywhere, and history/snapshots as
  the undo story.

## Development Workflow & Quality Gates

- Features follow the Spec Kit flow: `/speckit-specify` → `/speckit-clarify` (optional) →
  `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`. Specs are updated alongside the
  code; a change that contradicts the spec is a defect in one of them, found at review.
- Planning MUST check each principle explicitly: the deterministic/dynamic annotation
  (II), dispatch-by-declaration (I), agent failure paths (III), test obligations (IV), and
  both-platform behaviour (V).
- Merge gates: `npm run typecheck` and the full test suite pass; guard tests still fail on
  deliberate violations when a boundary is touched.
- UI text is bilingual: every user-visible string goes through the message catalog, and the
  parity of the catalogs is a typechecked gate.
- Runtime developer guidance lives in `CLAUDE.md`; it is subordinate to this constitution
  and MUST NOT contradict it.

## Governance

- This constitution supersedes all other practice, guidance, and preference documents.
  When they conflict, this document wins; `CLAUDE.md` and specs carry it into effect.
- Amendments are proposed in writing (diff plus rationale), reviewed by the project owner,
  and land in `.specify/memory/constitution.md` with the header version and dates updated.
- Versioning policy (semantic):
  - **MAJOR**: removing or redefining a principle in a way that changes existing obligations.
  - **MINOR**: adding a principle or materially extending guidance.
  - **PATCH**: clarifications, wording, non-semantic refinements.
- Compliance review: every spec, plan, and change is checked against these principles;
  unjustified complexity or a boundary exception must be recorded with its rationale in the
  feature's artifacts or rejected.
- The version and dates in the footer are authoritative for the document's state; the git
  history of this file is the amendment log.

**Version**: 1.0.0 | **Ratified**: 2026-09-28 | **Last Amended**: 2026-09-28

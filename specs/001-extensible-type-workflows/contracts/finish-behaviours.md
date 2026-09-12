# Contract: Finish Behaviours

**Feature**: `specs/001-extensible-type-workflows/spec.md`
**Consumers**: the finish service, the artifact store adapters, the job queue, the
session factory.

Exactly four behaviours exist (FR-014). This contract defines what each must do, so that
adding a fifth is a deliberate act with a known shape rather than an edit to a conditional.

---

## Common strategy contract

```ts
interface FinishContext {
  task: Task
  typeDef: TaskTypeDef
  destination: ResolvedDestination | null   // null only for 'complete-only'
  workingContent: string                     // the user's content (note / minutes)
  declaredInputs: Record<string, unknown>
  session: AgentSessionPort | null           // null when no provider is configured
  store: ArtifactStorePort
  clock: ClockPort
  signal: AbortSignal
}

interface FinishResult {
  artifactPath: string | null   // null when nothing was written
  assistantStep: 'skipped' | 'succeeded' | 'failed'
  touchedFiles: string[]        // what the finish actually wrote or modified
}

type FinishStrategy = (ctx: FinishContext) => Promise<FinishResult>
```

---

## The four behaviours

### `complete-only`
Writes nothing. Marks the task complete and clears its alarm. Used by `plain` and `jira`
today. `destination` MUST be absent; supplying one is a validation error.

### `file-as-is`
Writes the user's working content to the destination **unchanged**. No assistant step.
`assistantStep` is always `'skipped'`.

### `polish-then-file`
The assistant rewrites the content; the result is then written.

**The bound matters more than the transformation** (FR-009, from the clarification
session):
- MUST preserve every fact, decision, and action item the user recorded.
- MUST NOT introduce content the user did not write.
- MUST present the recorded action items as a distinct section of the finished document.

These are acceptance-testable properties, not style guidance. A polish that adds a
plausible-sounding decision the user never recorded is a **failure** of this behaviour,
because minutes are a factual record.

**Degradation**: if no provider is configured, or the assistant step fails, the behaviour
falls back to writing the user's content unpolished and reports `assistantStep: 'failed'`.
It never fails the finish outright (FR-025, FR-011).

### `deposit-then-curate`
The existing Learning flow, preserved exactly:
1. Deposit the working content, the pre-process summary, and any attachment into the
   store's raw area **first** — this survives any later failure.
2. Snapshot the existing artifact set.
3. Run a confined agent session to author the artifact at the resolved path.
4. Diff against the snapshot to report what was actually touched.

**Unchanged-by-design**: the deposit-first ordering, the confinement (agent `cwd` bound to
the destination root, tool allowlist `read|write|edit|grep|find|ls`, no shell), and the
create-only scaffolding. These are the reasons this flow is trustworthy; generalizing the
destination must not weaken them.

---

## Invariants for every behaviour

| Invariant | Requirement |
|---|---|
| Succeeds without AI | FR-025 — a finish never fails solely because AI is unconfigured |
| User content preserved | FR-011 — the written content remains retrievable even if an assistant step fails |
| No overwrite, no relocation | FR-026 — a colliding artifact is written under a distinct name alongside |
| Retriable | FR-027 — a failed finish leaves work intact and needs no retyping |
| Reported | FR-028 — outcome and failures appear in the activity record |
| Destination validated first | FR-006 — refusal happens before anything is written |
| Confined operations unprivileged | FR-020 — no assistant step inside a finish receives a plugin grant |

**The last row is absolute.** Minute polishing and material curation are confined
operations by definition. A finish is not a place where external reach is granted, even
when the type declares grants — grants apply to interactive sessions only.

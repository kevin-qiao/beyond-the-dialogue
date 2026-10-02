# The POC is reference only; the application is redesigned in-place under the master specification

The current shipping code proved the shape of an AI-native work board, but its taxonomy
and flows grew from prototypes, not from `doc/specification/Specification.md`. We
decided to treat the whole application as a **redesign**: the POC is a reference to mine
for useful ideas, conflicts between the master specification's taxonomy (`Document`,
`Working system`, `Coding` families) and the POC's (`plain | learning | jira | meeting`
categories) are resolved by refactoring the code away, and the redesign proceeds
**in-place** as capability-slice Spec Kit features under the version-plan milestones
(v1.0 ≈ `001` core board + agent harness, then `002` Document assist). During the
redesign, POC flows receive bug fixes only — any new work goes through the design.

## Considered options

- Re-baseline: keep the POC as the trunk and renumber the roadmap around it — rejected;
  the user wants the design first, the code second.
- Greenfield rewrite in a parallel tree — rejected; the app is the user's daily driver
  and in-place evolution keeps it runnable at every step with honest git history.

## Consequences

- POC safety machinery is **not inherited by default**: confined ingest, `.history`
  undo, `verifyPolish` traceability, egress-at-context-construction, and the
  propose/confirm remote-write path are each re-litigated by the feature that needs
  them. The ratified constitution is the non-re-litigable floor (Principle II binds);
  a feature must argue its own way to the guarantee — or to a better version of it —
  and annotate the deterministic/AI split either way.
- The close-out summary of a Coding task files through the **Type-declared
  destination**, like every other family. The old global-path setting stays abolished
  (see migration v8): "configured in Settings" means per-Type, never app-global.
- Meeting minutes are retired as an engine category; if the workflow survives, it
  re-enters as a Document-family type in a future feature.
- The v1.0/2.0/3.0 numbering in the master specification restarts from zero; version
  numbers already used by the POC (0.8/0.9) belong to the reference implementation and
  will not be continued.

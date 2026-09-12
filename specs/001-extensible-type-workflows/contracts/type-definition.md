# Contract: Task Type Definition

**Feature**: `specs/001-extensible-type-workflows/spec.md`
**Consumers**: the type registry service, the settings UI, the finish dispatcher, the
session factory, the pre-process dispatcher.

A task type is the extension point of this product. Everything a type can declare is
listed here; anything not listed is either derived from the type's category or out of
scope. This is the contract a user edits through the settings surface, so it is also the
contract the UI must be able to round-trip without loss.

---

## Shape

```ts
type TaskKind = 'plain' | 'learning' | 'jira' | 'meeting'

type FinishBehaviour =
  | 'complete-only'
  | 'file-as-is'
  | 'polish-then-file'
  | 'deposit-then-curate'

interface TaskTypeDef {
  key: string                    // /^[a-z0-9_]{2,32}$/
  kind: TaskKind                 // determines pre-processing + working area
  label: string
  emoji: string
  description?: string
  color?: string
  inputSchema: TypeInputField[]  // declared inputs; validated on every write
  aiGuidance?: string            // injected into the pre-process instruction
  isBuiltin: boolean

  // --- added by this feature ---
  finishBehaviour: FinishBehaviour
  destination?: Destination      // required unless finishBehaviour is 'complete-only'
  grants: PluginGrant            // { skills: string[]; toolServers: string[] }
}
```

`Destination` and `PluginGrant` are specified in `destination.md` and `plugin-grants.md`.

---

## Category (kind) semantics

The category no longer implies finish behaviour or destination — those are explicit. The
category retains exactly two responsibilities:

1. **Pre-processing dispatch** — which analysis the assistant performs and which inputs
   feed it.
2. **Working area** — which editing surface the task opens.

Per-type working-area declaration is explicitly out of scope for this version (spec scope
boundary), so the category remains the only determinant of the surface.

| Category | Pre-process produces | Working area |
|---|---|---|
| `plain` | nothing (no pre-process runs) | plain notes |
| `learning` | working prompt, summary, activity suggestions | markdown editor + chat |
| `jira` | summary of pasted source + next steps | source panel, comment drafts, chat |
| `meeting` (new) | suggested agenda + core topics | markdown editor + chat |

---

## Validation rules

Enforced in one place, on every write path (create, update, and finish gating).

| Rule | Failure |
|---|---|
| `key` matches `/^[a-z0-9_]{2,32}$/` | reject |
| `kind` is a known category | reject |
| `label` and `emoji` are non-empty | reject |
| `inputSchema` field keys are unique within the type | reject |
| `finishBehaviour` is one of the four | reject — never default silently |
| `complete-only` declares no destination | reject |
| A writing behaviour declares a destination that resolves inside its root | reject |
| `grants` names are non-empty strings | reject |
| On update: a built-in's `kind` and `finishBehaviour` are unchanged | reject |
| On update: a built-in's display fields may change | allow |
| On delete: `isBuiltin` types | reject (FR-017) |
| On delete: a custom type referenced by tasks | allow — tasks are reassigned, never destroyed (FR-016) |

---

## What a type cannot declare

Stated explicitly so the boundary is not rediscovered later:

- **New input field kinds.** A custom type selects from the fields its category already
  declares; it cannot invent a new field shape. (Spec scope boundary.)
- **A working area.** Derived from the category. (Spec scope boundary.)
- **A new finish behaviour.** The set is closed at four. (FR-014.)
- **Alternate storage engines.** Storage is chosen from the `store` values in
  `destination.md`.

---

## Categories are declared once

The four categories exist in one declaration, and every other site derives from it. The
current code restates them in four places (see `data-model.md` §7.4); this contract
requires the restatements be collapsed. Constitution Principle VI applies: a meaningful
literal repeated in more than one place MUST be extracted to a single named declaration.

The SQL `CHECK` constraints cannot reference a TypeScript constant, so they remain a
literal — and because they cannot be derived, they MUST carry a comment naming the
declaration they mirror, per Principle VI's unavoidable-hardcoding rule.

---

## Round-trip requirement

The settings surface MUST be able to read a type, edit it, and write it back without
losing any declared field. This is not cosmetic: `upsertType` (`src/main/db.ts:756-776`)
writes an explicit column list, so a field omitted from that statement is silently
dropped on save. Every field above MUST be threaded through both the insert and the
`ON CONFLICT DO UPDATE SET` clause.

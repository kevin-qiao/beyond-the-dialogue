# Contract: Output Destination

**Feature**: `specs/001-extensible-type-workflows/spec.md`
**Consumers**: the settings UI, the finish service, the artifact store adapters.

A destination says where a type's finished artifacts go. It is declared as structured data
and resolved at write time, so confinement can be checked by construction rather than by
inspection (FR-002, FR-006).

---

## Shape

```ts
type DestinationStore = 'wiki' | 'folder'

interface Destination {
  store: DestinationStore
  rootPath: string | null   // absolute; required for 'folder', declared by the type for 'wiki' (blank = refused at Finish)
  subdir: string            // relative dir under the root; '' means the root itself
}

interface ResolvedDestination {
  root: string       // absolute root
  subdir: string     // '' when unset
  absRoot: string    // normalized absolute path of root/subdir
}
```

Filenames are derived, never stored: a slug of the task title, with a distinct-name suffix
on collision (§4). This mirrors the existing `slugify` (`src/main/wiki/wiki.ts:101-110`),
which is already constrained to `[a-z0-9-]` and 60 characters and therefore cannot contain
a separator or `..`.

---

## 1. Resolution

```
resolveRoot(dest):
  wiki   → dest.rootPath as declared by the type (there is no global wiki
           location and no built-in default); blank is refused at Finish,
           a named-but-relative root at save
  folder → dest.rootPath; MUST be absolute and non-empty

resolveArtifact(dest, title, taskId):
  root   = resolveRoot(dest)
  absRoot= normalize(join(root, dest.subdir))
  abs    = normalize(join(absRoot, slugify(title, taskId) + '.md'))
  rel    = relative(absRoot, abs)
  inside = rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  return { root, subdir, absRoot, abs, inside }
```

**The confinement test is `relative` + not-`..`-prefixed + not-absolute.** This is lifted
verbatim from `resolveLearningNotePath` (`src/main/wiki/wiki.ts:121-132`), which is already
the app's proven control. It MUST NOT be reimplemented a second way — two implementations
of a security check drift, and the drift is invisible.

**On `inside === false`**: the finish is refused with a message pointing at the
destination, and nothing is written. The existing behaviour at
`src/main/index.ts:335-341` — refuse rather than silently mis-save — is the model. A
refusal is always preferable to writing to an unintended location (FR-006).

---

## 2. Store adapter contract

Each `store` value is a strategy behind one port, so a new storage location is added
without touching the finish service:

```ts
interface ArtifactStorePort {
  // Verify the destination is usable before anything is written.
  prepare(dest: ResolvedDestination): Promise<void>

  // Write the artifact. MUST NOT overwrite or relocate an existing file.
  writeArtifact(dest: ResolvedDestination, content: string): Promise<string>

  // Deposit raw material ahead of an assistant step (deposit-then-curate only).
  deposit(dest: ResolvedDestination, taskId: string, parts: DepositParts): Promise<string>

  // Snapshot the artifact set before a mutating step, so it can be diffed and undone.
  snapshot(dest: ResolvedDestination): Promise<SnapshotHandle>
  diff(snapshot: SnapshotHandle): Promise<string[]>
}
```

`prepare` exists so that "the destination folder does not exist or is not writable" is
detected **before** the task is marked complete — the user finds out while the task is
still actionable, not after.

---

## 3. Safety invariants that MUST survive generalization

Carried over from the wiki implementation; each has a live reason.

| Invariant | Current site | Consequence if dropped |
|---|---|---|
| Confinement by `relative`, reject `..`/absolute | `wiki.ts:121-132` | Writes escape the destination root (FR-006 violated) |
| Create-only scaffolding | `wiki.ts:37-57` | A user's existing directory gets restructured |
| Snapshot before mutating, diff after | `wiki.ts:198-215`, `:238-262` | Writes become unauditable and non-reversible |
| Agent `cwd` bound to the root, tool allowlist, no shell | `wiki/ingest.ts:45-51` | A confined agent can reach outside the destination |

**Concrete hazard — the audit set is a hardcoded list.** `listExistingWikiFiles` walks only
`['wiki','learning-notes']` (`src/main/wiki/wiki.ts:228`). A destination whose `subdir` is
anything else is **invisible to snapshot and diff**. Wiring a new destination without
extending that walk would leave the audit trail silently empty while every finish still
reported success — a worse failure than an error, because nothing signals it. The walk
MUST be derived from the destinations actually in use.

**Also conditional now**: `ensureWikiDir` (`wiki.ts:37-57`) hardcodes creation of a
`learning-notes` directory. Creating that for a meeting-minutes destination would be
wrong; scaffolding MUST be scoped to the destination actually being used.

---

## 4. Collisions (FR-026, SC-008)

When a finish would produce an artifact where one already exists:

- The new artifact is written under a **distinct name alongside** the existing one.
- Nothing is overwritten, moved, or deleted.
- The destination folder holds every version as an ordinary file the user manages.

There is deliberately **no history directory and no retention policy**. The destination is
a plain folder the user owns; an invisible sibling directory appearing next to their notes
is machinery the simplicity principle asks to justify, and it would have to be explained,
backed up, and eventually cleaned.

The existing wiki already dedupes on copy (`wiki.ts:157`, a loop appending a suffix). That
same principle is generalized here rather than replaced.

---

## 5. Validation rules

| Rule | Failure |
|---|---|
| `store` is `wiki` or `folder` | reject the type |
| `store: folder` requires an absolute `rootPath` | reject the type |
| `store: wiki` with a named `rootPath` requires it to be absolute; blank is incomplete and refused at Finish | reject the type |
| `subdir` is relative and contains no `..` segment | reject the type |
| A writing `finishBehaviour` requires a destination | reject the type |
| `complete-only` forbids a destination | reject the type |
| The resolved artifact path lies inside the root | refuse the **finish**, report, write nothing |
| The destination is writable | refuse the finish before marking complete |

The first six are type-configuration errors, caught when the type is saved. The last two are
runtime conditions, caught when the finish runs.

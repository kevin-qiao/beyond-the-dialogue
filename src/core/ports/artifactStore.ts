import type { DestinationStore } from '../../shared/types'

// ArtifactStorePort — where a finished artifact is written.
//
// One implementation per `store` value (contracts/destination.md §2), so a new
// storage location is added without touching the finish service. The port is
// deliberately shaped around the safety invariants the wiki ingest path
// already proved, so generalizing the destination cannot weaken them:
//
//   - `prepare` runs BEFORE the task is marked complete, so "the folder is
//     missing or read-only" is something the user learns while the task is
//     still actionable.
//   - `writeArtifact` never overwrites and never relocates: a colliding name
//     gets a distinct one alongside (FR-026).
//   - `snapshot`/`diff` make a mutating step auditable and reversible.

/** A normalized, confined location for an artifact set. */
export interface DestinationRef {
  store: DestinationStore
  /** Absolute root. */
  root: string
  /** Relative subdirectory under the root; '' means the root itself. */
  subdir: string
  /** Absolute root + subdir. */
  absRoot: string
}

/** A destination plus the concrete file this finish will produce. */
export interface ArtifactRef extends DestinationRef {
  /** Absolute path of the artifact. */
  abs: string
  /** Artifact path relative to `absRoot`, '/'-separated. */
  rel: string
}

/** The raw material preserved ahead of a curating assistant step. */
export interface DepositParts {
  taskId: string
  title: string
  /** The user's working content (note, minutes). */
  content: string
  /** Pre-rendered AI pre-process summary, when one exists. */
  summary?: string
  /** Absolute path of an attachment to copy in, when the task has one. */
  attachmentPath?: string
}

export interface DepositResult {
  /** Absolute directory the material was deposited into. */
  dir: string
  /** File names written, in deposit order. */
  files: string[]
}

/** Opaque handle to a pre-mutation snapshot, consumed by `diff`. */
export interface SnapshotHandle {
  store: DestinationStore
  /** Absolute root that was snapshotted. */
  root: string
  /** Subdirectory under the root that was covered; '' means the root itself. */
  subdir: string
  /** Absolute location of the backup, when the store keeps one. */
  location: string | null
  /** Files that existed before the mutation, '/'-separated and root-relative. */
  files: string[]
}

export interface ArtifactStorePort {
  /**
   * Verify the destination is usable before anything is written. MUST reject a
   * missing or unwritable destination.
   */
  prepare(target: DestinationRef): Promise<void>

  /**
   * Write the artifact. MUST NOT overwrite or relocate an existing file — a
   * collision is written under a distinct name alongside. Returns the absolute
   * path actually written.
   */
  writeArtifact(target: ArtifactRef, content: string): Promise<string>

  /** Deposit raw material ahead of an assistant step (deposit-then-curate). */
  deposit(target: ArtifactRef, parts: DepositParts): Promise<DepositResult>

  /** Snapshot the artifact set before a mutating step. */
  snapshot(target: DestinationRef): Promise<SnapshotHandle>

  /** Report which files changed since `handle` was taken. */
  diff(handle: SnapshotHandle): Promise<string[]>
}

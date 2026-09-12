// THE single declaration of the behaviour-category set and the finish-behaviour
// set. Constitution Principle VI: a meaningful literal repeated in more than one
// place MUST be declared once, and every other site MUST derive from that
// declaration.
//
// This module is a leaf: it imports nothing, so it can be consumed by
// src/shared, src/core, src/main and src/renderer alike without creating a
// dependency cycle. Keep it that way.
//
// Known, unavoidable restatements that MUST name this file as their source:
//   - the SQL `CHECK` constraints in src/main/db.ts (SQL cannot reference a
//     TypeScript constant — see the comments on those columns)
//   - the built-in type seeds in src/main/db.ts (data, not a vocabulary)

/** A task's behaviour category. Determines pre-processing and the working area. */
export const CATEGORIES = ['plain', 'learning', 'jira', 'meeting'] as const
export type TaskCategory = (typeof CATEGORIES)[number]

/**
 * How Finish behaves for a type. A closed set of exactly four (FR-014): users
 * select among these, they cannot define new ones.
 */
export const FINISH_BEHAVIOURS = [
  'complete-only',
  'file-as-is',
  'polish-then-file',
  'deposit-then-curate'
] as const
export type FinishBehaviour = (typeof FINISH_BEHAVIOURS)[number]

/**
 * Which store an artifact destination is handled by (contracts/destination.md).
 */
export const DESTINATION_STORES = ['wiki', 'folder'] as const
export type DestinationStore = (typeof DESTINATION_STORES)[number]

export function isCategory(value: unknown): value is TaskCategory {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
}

export function isFinishBehaviour(value: unknown): value is FinishBehaviour {
  return typeof value === 'string' && (FINISH_BEHAVIOURS as readonly string[]).includes(value)
}

export function isDestinationStore(value: unknown): value is DestinationStore {
  return typeof value === 'string' && (DESTINATION_STORES as readonly string[]).includes(value)
}

export function writesArtifact(behaviour: FinishBehaviour): boolean {
  return behaviour !== 'complete-only'
}

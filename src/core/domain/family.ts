// THE single declaration of the assistance-family set (feature 002, research D1).
// Constitution Principle I: a meaningful literal repeated in more than one place
// MUST be declared once, and every other site MUST derive from that declaration.
//
// This module is a leaf: it imports nothing, so it can be consumed by
// src/shared, src/core, src/main and src/renderer alike without creating a
// dependency cycle. Keep it that way.
//
// Known, unavoidable restatements that MUST name this file as their source:
//   - the SQL `CHECK` constraints in src/main/db.ts (SQL cannot reference a
//     TypeScript constant — see the comments on those columns)
//
// The retired vocabulary: `CATEGORIES` / `TaskCategory` lived in
// src/core/domain/categories.ts. Feature 002 deletes it (ADR-0001's
// review-and-delete mandate, FR-016). "Category" is gone from both senses:
// Lists group, Families classify assistance (CONTEXT.md). A Type with NO
// family needs no assistance — `plain` and its user-defined equivalents are
// such Types. The absence of a family is not a fourth family.

/** One of the master specification's three classifications of assistance. */
export const FAMILIES = ['document', 'working-system', 'coding'] as const
export type Family = (typeof FAMILIES)[number]

export function isFamily(value: unknown): value is Family {
  return typeof value === 'string' && (FAMILIES as readonly string[]).includes(value)
}

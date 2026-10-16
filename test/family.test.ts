import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { FAMILIES, isFamily } from '../src/core/domain/family'

// The family-mirror guard (quickstart drill #1, T009).
//
// SQL cannot reference a TypeScript constant, so the `CHECK` constraints in
// src/main/db.ts necessarily restate the family set. That is the constitution's
// one allowed hardcoding exception — and this test is what keeps the exception
// honest: every restatement must match the declaration EXACTLY, and every
// restatement must carry the comment naming its source.
//
// The drill: add a fourth family to src/core/domain/family.ts without updating
// the SQL mirrors — this file must go red. Revert.

const dbSource = fs.readFileSync(path.join(process.cwd(), 'src/main/db.ts'), 'utf-8')

/** Every `family IN (…)` restatement in db.ts, parsed into literal lists. */
function familyCheckLiterals(): { list: string[]; index: number }[] {
  const out: { list: string[]; index: number }[] = []
  for (const m of dbSource.matchAll(/family IN \(([^)]*)\)/g)) {
    const list = m[1]!
      .split(',')
      .map((s) => s.trim().replace(/^'/, '').replace(/'$/, ''))
      .filter((s) => s.length > 0)
    out.push({ list, index: m.index! })
  }
  return out
}

test('the family declaration is the closed three-value set', () => {
  assert.deepEqual([...FAMILIES], ['document', 'working-system', 'coding'])
  for (const f of FAMILIES) assert.equal(isFamily(f), true)
  assert.equal(isFamily('plain'), false, 'the absence of a family is not a family (D1)')
  assert.equal(isFamily('learning'), false, 'the retired categories are not families')
  assert.equal(isFamily(null), false)
  assert.equal(isFamily(undefined), false)
  assert.equal(isFamily(7), false)
})

test('every SQL CHECK restatement in db.ts mirrors FAMILIES exactly', () => {
  const restatements = familyCheckLiterals()
  // At least the fresh-database SCHEMA and the v13 rebuild restate the set;
  // a future migration may add more. Zero restatements would mean the guard
  // lost its subject — fail loudly rather than pass vacuously.
  assert.ok(restatements.length >= 2, `expected the SCHEMA and v13 mirrors, found ${restatements.length}`)
  for (const { list } of restatements) {
    assert.deepEqual(list, [...FAMILIES], 'a SQL family CHECK drifted from src/core/domain/family.ts')
  }
})

test('every restatement carries the comment naming family.ts as its source', () => {
  // The convention the retired categories used: the unavoidable hardcoding
  // names the declaration it mirrors in the comment right above it — a
  // distant file-header mention is not enough, because a later edit could
  // restate the set anywhere in the file and pass.
  for (const { index } of familyCheckLiterals()) {
    const before = dbSource.slice(Math.max(0, index - 300), index)
    assert.ok(
      /family\.ts/.test(before),
      `the family CHECK at db.ts offset ${index} does not name src/core/domain/family.ts in the comment above it`
    )
  }
})

test('no stale restatement of the retired category set survives in db.ts SCHEMA or migrations', () => {
  // The four-value vocabulary is deleted (D11): the only places its literals
  // may survive are the migration steps that DETECT or REWRITE the old shape
  // (gates keyed on the stored DDL, the v13 re-home, kind→family map) — never
  // a live CHECK. Assert no CREATE TABLE in the file restates it as a CHECK.
  for (const m of dbSource.matchAll(/CHECK \((?:type|kind) IN \('plain','learning','jira'(?:,'meeting')?\)\)/g)) {
    // Allowed only inside the historical rebuilds that widen/detect it; the
    // fresh SCHEMA and the v13 output must not contain any.
    const after = dbSource.slice(m.index!, m.index! + 400)
    assert.ok(
      /tasks_new|task_types_new|task_preprocess_new/.test(dbSource.slice(Math.max(0, m.index! - 500), m.index!) + after),
      `a retired category CHECK survives outside a historical staging rebuild at offset ${m.index}`
    )
  }
})

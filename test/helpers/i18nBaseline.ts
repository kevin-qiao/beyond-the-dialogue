import * as fs from 'node:fs'
import * as path from 'node:path'
import { ROOT, censusSource, countUntranslated, readSource, rendererSources } from './sourceScan'
import { ALLOWED_SET } from '../i18n-allowlist'

// The per-file count of user-visible English that is not yet in the catalog.
//
// A ratchet, not a rule: the count may fall, never rise. A hard "every JSX
// literal must be a key" rule cannot tell `<code>plain</code>` from
// `<span>Plain task</span>`, so it would flag the tree as it stands and be
// silenced by an allowlist until it caught nothing. This fails only on a
// literal that was *just added*, which is the moment the reminder is useful.
//
// Regenerate with `npx tsx test/helpers/i18nBaseline.ts` — and expect the diff
// to show numbers going down.

export const BASELINE_PATH = path.join(ROOT, 'test', 'i18n-literal-baseline.json')

export interface FileCounts {
  /** `placeholder` / `title` / `aria-label` / `alt` literals. */
  attributes: number
  /** Literal JSX text children. */
  texts: number
  /** Literal values inside a `Record<…>` label map. */
  labels: number
}

export type Baseline = Record<string, FileCounts>

/** Count what is still English in every renderer source file. */
export function censusTree(): Baseline {
  const out: Baseline = {}
  for (const file of rendererSources()) {
    const census = censusSource(readSource(file))
    const counts: FileCounts = {
      attributes: countUntranslated(census.attributes, ALLOWED_SET),
      texts: countUntranslated(census.texts, ALLOWED_SET),
      labels: countUntranslated(census.labels, ALLOWED_SET)
    }
    // A file that is fully translated leaves no trace, which keeps the
    // baseline shrinking toward empty as the sweep proceeds.
    if (counts.attributes + counts.texts + counts.labels > 0) {
      out[path.relative(ROOT, file).split(path.sep).join('/')] = counts
    }
  }
  return out
}

export function readBaseline(): Baseline {
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8')) as Baseline
}

export function writeBaseline(baseline: Baseline): void {
  const sorted = Object.fromEntries(Object.entries(baseline).sort(([a], [b]) => a.localeCompare(b)))
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(sorted, null, 2) + '\n')
}

// `npx tsx test/helpers/i18nBaseline.ts` rewrites the file.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const baseline = censusTree()
  writeBaseline(baseline)
  const total = Object.values(baseline).reduce((n, c) => n + c.attributes + c.texts + c.labels, 0)
  console.log(`wrote ${BASELINE_PATH}: ${Object.keys(baseline).length} file(s), ${total} literal(s)`)
}

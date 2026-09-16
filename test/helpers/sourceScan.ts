import * as fs from 'node:fs'
import * as path from 'node:path'
import { isMessageKey } from '../../src/core/i18n'

// Reading the tree as text, for the guards that enforce a property of the
// source rather than of a running system (test/layering.test.ts and
// test/i18n.test.ts).
//
// Extracted so both guards walk and strip identically: a rule that matched a
// different view of the file than the one it was written against is a guard
// that passes for the wrong reason.

export const ROOT = path.resolve(import.meta.dirname, '..', '..')

export function walk(dir: string, filter: (file: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, filter))
    else if (filter(full)) out.push(full)
  }
  return out
}

/**
 * Comments are stripped before matching so a rule may be *named* in prose
 * (e.g. "MUST NOT import node:fs") without tripping itself.
 *
 * Note the line-comment pattern requires a non-colon character before the
 * slashes, so a URL inside a string (`https://…`) survives. A string
 * containing a bare `//` is still truncated — no such string exists in the
 * renderer today; if one appears, it is this function to fix, not the rule.
 */
export function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** The text of one file, read and comment-stripped. */
export function readSource(file: string): string {
  return stripComments(fs.readFileSync(file, 'utf-8'))
}

/** Every source file under the renderer's `src/`, which is where UI copy lives. */
export function rendererSources(): string[] {
  return walk(path.join(ROOT, 'src', 'renderer'), (f) => /\.tsx?$/.test(f)).filter(
    (f) => !f.includes(`${path.sep}core${path.sep}i18n${path.sep}`)
  )
}

/**
 * A user-facing attribute holding a literal string, e.g. `title="Settings"`.
 * `title={t('…')}` is an expression and deliberately does not match — that is
 * what a translated call site looks like.
 */
const UI_ATTRIBUTE = /\b(placeholder|title|aria-label|alt)\s*=\s*"([^"]*)"/g

/**
 * JSX text that begins with a letter and ends at a closing tag or at the start
 * of an expression: `<h4>Appearance</h4>`, `<span>Saved {when}</span>`.
 *
 * The closing-context requirement is what keeps TypeScript generics out:
 * `Record<string, Promise<void>>` also has letters between a `>` and a `<`, but
 * not followed by a tag close.
 */
const JSX_TEXT = />\s*([A-Za-z][^<>{}]*?)\s*(?:<\/|\{)/g

/**
 * Reads as code, not as copy: an assignment, a call, a logical operator, a
 * statement. `<Tag>` followed by `void saveSettings(` is a matched JSX-text
 * shape that is obviously not a label, and leaving it in the census would let a
 * refactor raise the count and trip the guard for no reason.
 *
 * Deliberately narrow: real copy contains colons ("Pre-process failed:"),
 * question marks and parentheses ("auto-retry (attempt 2)"), so none of those
 * are grounds for rejection on their own.
 */
const CODE_LIKE = /[=;]|\($|\)\s*$|\bvoid\b|&&|\|\||=>|\bconst\b|\breturn\b/

/** A `Record<…>` of labels, e.g. `const FINISH_BEHAVIOUR_LABELS: Record<X, string> = {…}`. */
const LABEL_BLOCK = /:\s*Record<[^>]*>\s*=\s*\{([\s\S]*?)\n\}/g
const STRING_VALUE = /'([^'\\]*)'/g

export interface Census {
  /** Literal values of user-facing attributes. */
  attributes: string[]
  /** Literal JSX text children. */
  texts: string[]
  /** Literal values inside a `Record<…>` label map. */
  labels: string[]
}

/**
 * The user-visible English in one file, as three lists of literal values.
 *
 * Approximate by construction — it cannot know that `<code>plain</code>` is a
 * type key and `<span>Plain task</span>` is prose. That is why the guard built
 * on it is a ratchet over counts rather than a hard rule over contents: it
 * needs to be sensitive to a *new* literal, not correct about every old one.
 */
export function censusSource(src: string): Census {
  const code = stripComments(src)
  const attributes: string[] = []
  const texts: string[] = []
  const labels: string[] = []
  for (const m of code.matchAll(UI_ATTRIBUTE)) attributes.push(m[2]!)
  for (const m of code.matchAll(JSX_TEXT)) {
    const text = m[1]!.trim()
    if (!CODE_LIKE.test(text)) texts.push(text)
  }
  for (const block of code.matchAll(LABEL_BLOCK)) {
    for (const value of block[1]!.matchAll(STRING_VALUE)) {
      // A map from a closed set to catalog KEYS is the translated form of the
      // thing this census is looking for, not an instance of it.
      if (!isMessageKey(value[1]!)) labels.push(value[1]!)
    }
  }
  return { attributes, texts, labels }
}

/** How many of `values` are not deliberately left in English. */
export function countUntranslated(values: string[], allowed: ReadonlySet<string>): number {
  return values.filter((v) => {
    const trimmed = v.trim()
    return trimmed.length > 0 && !allowed.has(trimmed)
  }).length
}

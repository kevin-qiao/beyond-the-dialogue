import assert from 'node:assert/strict'
import { isLocalizedError } from '../../src/core/i18n/issues'

// Reading a refusal in a test.
//
// The domain states refusals as message codes, and the language is applied
// where it is known (the renderer, or the main process before IPC). A test that
// asserted on the English sentence would be asserting on a translation that no
// longer exists at that layer — and would break the moment the wording changed,
// which is the thing codes exist to make cheap.

/** The message codes of a refusal, in order. */
export function issueKeysOf(e: unknown): string[] {
  if (!isLocalizedError(e)) {
    throw new Error(`expected a code-carrying refusal, got ${e instanceof Error ? e.message : String(e)}`)
  }
  return e.issues.map((i) => i.key)
}

/** Assert a call refuses with a specific code. */
export function assertRefusedWith(fn: () => unknown, key: string): void {
  assert.throws(fn, (e: unknown) => {
    assert.deepEqual(issueKeysOf(e), [key])
    return true
  })
}

/** The params of a refusal's single issue, for asserting what it is about. */
export function issueParamsOf(e: unknown): Record<string, unknown> {
  if (!isLocalizedError(e)) throw new Error('expected a code-carrying refusal')
  return (e.issues[0]?.params ?? {}) as Record<string, unknown>
}

import type { MessageKey, MessageParams } from '.'

// A refusal, carried as a code rather than as a sentence.
//
// The domain validates inputs, destinations, type definitions and plugin
// entries, and each refusal is something the user reads. But the domain has no
// language: it is compiled into both hosts and is handed no settings, so a
// message formatted here would be formatted in whatever language happened to be
// hardcoded. It carries the CODE, and whoever owns the language — the renderer
// for its own checks, the main process for the IPC boundary — formats it.
//
// Errors cross the IPC boundary as strings, so this is also why the formatting
// has to happen before the throw: nothing structured survives `ipcRenderer.invoke`.

export interface MessageIssue {
  key: MessageKey
  params?: MessageParams
}

export type IssueList = MessageIssue[]

/**
 * The keys of an issue list, for logs and for callers that cannot localise.
 *
 * Deliberately not user-facing: a user must never be shown a key, which is why
 * `LocalizedError`'s own message is this rather than something that reads like
 * prose and could be mistaken for a finished sentence.
 */
export function issueKeys(issues: IssueList): string[] {
  return issues.map((i) => i.key)
}

/**
 * A refusal the user must read, awaiting a language.
 *
 * A plain `Error` means a bug (an invariant, a missing row); this means
 * something the user did or configured, phrased for them.
 */
export class LocalizedError extends Error {
  readonly issues: IssueList

  constructor(issues: IssueList) {
    super(issueKeys(issues).join('; '))
    this.name = 'LocalizedError'
    this.issues = issues
  }
}

export function isLocalizedError(e: unknown): e is LocalizedError {
  return e instanceof LocalizedError
}

import { message, type Language } from '../core/i18n'
import { isLocalizedError, type IssueList } from '../core/i18n/issues'

// Turning the domain's codes into sentences, at the one moment a language is
// known on the way out.
//
// Errors cross the IPC boundary as strings — an `ipcRenderer.invoke` rejection
// arrives with Electron's own wrapping and nothing structured survives it — so
// a code cannot be handed to the renderer to phrase. It is phrased here, before
// the throw, in the language the app is set to.

/** The issues as one sentence, joined the way this language joins a list. */
export function issuesToText(issues: IssueList, language: Language): string {
  return issues.map((i) => message(language, i.key, i.params)).join(message(language, 'common.listSeparator'))
}

/**
 * Rewrite a code-carrying error in the active language, and pass everything
 * else through UNCHANGED.
 *
 * The pass-through is what makes it safe to apply this to every handler: a
 * plain `Error` means a bug or a transient failure, and rebuilding it would
 * risk losing what the caller matches on — `isTransientError` reads the
 * message, and a job that failed transiently must still be retried.
 */
export function localizeThrown(e: unknown, language: Language): Error {
  if (isLocalizedError(e)) return new Error(issuesToText(e.issues, language))
  return e instanceof Error ? e : new Error(String(e))
}

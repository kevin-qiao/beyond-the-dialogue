import { useApp } from '../store'
import type { Language, Translate } from '../../../core/i18n'

// Reading the app's language, from the one place that holds it.
//
// These are thin on purpose: the language lives in the store because settings
// do, and every component already re-renders when settings change. A module
// global with a setter would be invisible to React and would leave any
// memoised subtree rendering the previous language.

/** Translate a message key in the active language. */
export function useT(): Translate {
  return useApp().t
}

/** The active language, for the few places that need the value itself. */
export function useLanguage(): Language {
  return useApp().language
}

/**
 * The locale dates are formatted with. Derived from the language rather than
 * read from the system, so switching the language also switches the dates —
 * and so the one declaration of which locale a language uses (core/i18n) is
 * the only one.
 */
export function useLocale(): string {
  return useApp().locale
}

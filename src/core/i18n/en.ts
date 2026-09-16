// The English catalog — and the single declaration of the message key set.
//
// THE VERBATIM RULE: every value here is the literal the app used before it was
// translated, character for character. Two things depend on it:
//
//   1. `displayTypeLabel` and friends decide whether a seeded type label is
//      still the default by comparing the stored value against these strings,
//      so a seeded type translates only while the user has not renamed it.
//   2. Changing a value changes what users see for a string they may have been
//      reading for months, which is a product decision rather than a tidy-up.
//
// The only permitted edit while translating a literal into a key is turning
// interpolation into a `{param}` hole.
//
// This file is also the key set's type: `MessageKey` is derived from it, and
// zhCn.ts is annotated with `Catalog`, so a missing or misspelled Chinese key
// is a compile error in `npm run typecheck` rather than a blank label at runtime.

export const en = {
  // ---- common ----
  'common.listSeparator': '; ',
  'common.stepJoiner': ' — ',

  // ---- settings ----
  'settings.appearance.language': 'Language',
  'settings.appearance.language.hint': '(applies immediately, saved on Save)'
} satisfies Record<string, string>

export type MessageKey = keyof typeof en

/**
 * Every language's catalog must carry exactly these keys. Annotating the other
 * catalogs with this type is what enforces coverage.
 */
export type Catalog = Record<MessageKey, string>

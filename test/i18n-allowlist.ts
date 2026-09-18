// English that is deliberately left as it is.
//
// The guard in test/i18n.test.ts counts user-visible literals per file and
// requires the count never to rise. Anything listed here is subtracted first,
// so a line in this file is a claim: "this reads the same in every language".
//
// Keep it to things that are genuinely language-independent. A string belongs
// here only if translating it would be *wrong* — not because translating it is
// inconvenient; a label that is merely untranslated yet goes in the catalog,
// not here.

export const ALLOWED_LITERALS: readonly string[] = [
  // ---- Brand, named in every language ----
  'BeTD',
  'Beyond the Dialogue',
  'v2 · preview',

  // ---- Keyboard glyphs and shortcuts ----
  '⌘K',
  'Ctrl K',
  '⌘,',
  '⌘1',
  'esc',

  // ---- Symbols and emoji used as icons ----
  '×',
  '✓',
  '＋',
  '✎',
  '🗑',
  '📦',
  '🔌',
  '⚙',
  '▤',
  '✦',
  '☀',
  '☾',
  '💬',
  '⏰',
  '📌',
  '📝',
  '🎓',
  '🎫',
  '🗓',
  '·',
  '—',

  // ---- Protocol, filenames and identifiers shown verbatim ----
  'SKILL.md',
  'CLAUDE.md',
  'index.md',
  'log.md',
  'raw/',
  'wiki/',
  'stdio',
  'npx',

  // ---- Input placeholders that are examples rather than prose ----
  // A path or a model id is copied by the user, not read as a sentence, and
  // the examples are the same in both languages.
  'sk-…',
  '/path/to/your/folder',
  'e.g. minutes/2026',
  '-y some-mcp-server',
  'e.g. gpt-4o, claude-sonnet-4-5',
  'e.g. gpt-4o, claude-sonnet-4-5, gemini-2.5-pro'
]

export const ALLOWED_SET: ReadonlySet<string> = new Set(ALLOWED_LITERALS)

// PathPort — the path primitives src/core is allowed to use.
//
// src/core is compiled into the main target AND the renderer target, so it
// cannot import node:path. It still needs path semantics to resolve
// destinations and enforce confinement, and those semantics must be the
// *platform's* (Windows separators differ), so they arrive through this port
// and are implemented by src/main/adapters/paths.ts over node:path.
//
// Interfaces only — no implementations live in this layer.

export interface PathPort {
  join(...parts: string[]): string
  /** Path from `from` to `to`. Returns an absolute path when there is no relation. */
  relative(from: string, to: string): string
  normalize(p: string): string
  isAbsolute(p: string): boolean
  /** The platform separator: '\\' on Windows, '/' elsewhere. */
  readonly sep: string
  /** The platform's conventional segment separator for stored, displayable paths. */
  readonly posixSep: '/'
}

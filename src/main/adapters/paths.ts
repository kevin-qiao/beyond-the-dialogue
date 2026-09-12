import * as nodePath from 'node:path'
import type { PathPort } from '../../core/ports/paths'

// The platform implementation of PathPort. This is the only place in the
// destination code that touches node:path — src/core sees the interface.

export const nodePathPort: PathPort = {
  join: (...parts) => nodePath.join(...parts),
  relative: (from, to) => nodePath.relative(from, to),
  normalize: (p) => nodePath.normalize(p),
  isAbsolute: (p) => nodePath.isAbsolute(p),
  sep: nodePath.sep,
  posixSep: '/'
}

/**
 * A PathPort whose separators are always POSIX, for stored/displayable
 * wiki-relative paths. Windows `path.relative` yields `..\foo`, which would
 * not be recognised by a POSIX-shaped `..` test; normalizing through this
 * port keeps the confinement check platform-independent.
 */
export const posixPathPort: PathPort = {
  join: (...parts) => nodePath.posix.join(...parts),
  relative: (from, to) => nodePath.posix.relative(from, to),
  normalize: (p) => nodePath.posix.normalize(p),
  isAbsolute: (p) => nodePath.posix.isAbsolute(p),
  sep: '/',
  posixSep: '/'
}

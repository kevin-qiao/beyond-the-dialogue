import * as nodePath from 'node:path'
import type { PathPort } from '../../core/ports/paths'

// The platform implementation of PathPort. This is the only place in the
// destination code that touches node:path — src/core sees the interface.

export const nodePathPort: PathPort = {
  join: (...parts) => nodePath.join(...parts),
  relative: (from, to) => nodePath.relative(from, to),
  normalize: (p) => nodePath.normalize(p),
  isAbsolute: (p) => nodePath.isAbsolute(p),
  sep: nodePath.sep
}

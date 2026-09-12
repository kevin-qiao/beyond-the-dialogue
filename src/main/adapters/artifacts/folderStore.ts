import * as fs from 'node:fs'
import * as path from 'node:path'
import type {
  ArtifactRef,
  ArtifactStorePort,
  DepositParts,
  DepositResult,
  DestinationRef,
  SnapshotHandle
} from '../../../core/ports/artifactStore'
import { distinctName } from '../../../core/domain/slug'

// The plain-folder artifact store: a destination the user owns and reads in any
// editor. No wiki workspace, no schema, no indexing (FR-010).
//
// Two deliberate non-behaviours:
//
//   - It never scaffolds. It does not create `wiki/`, `learning-notes/` or a
//     schema file — a meeting-minutes folder must not be restructured into
//     something the user did not ask for. `ensureDestination` exists so the app
//     can create the folder at the moment the user *declares* it (type save or
//     startup), which is a different act from a finish silently inventing a
//     directory.
//   - It never overwrites. A colliding artifact gets a distinct name alongside
//     the existing one; nothing is moved or deleted (FR-026, SC-008).

/** True when `dir` exists and a file could be created in it. */
function isWritableDir(dir: string): boolean {
  try {
    const st = fs.statSync(dir)
    if (!st.isDirectory()) return false
  } catch {
    return false
  }
  try {
    fs.accessSync(dir, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Create a declared destination folder if it is missing. Called when the user
 * declares where their artifacts go — NOT from `prepare`, so a finish can
 * still fail loudly on a folder that vanished after the type was saved.
 */
export function ensureDestination(root: string): void {
  if (!root || !path.isAbsolute(root)) return
  fs.mkdirSync(root, { recursive: true })
}

export class FolderArtifactStore implements ArtifactStorePort {
  async prepare(target: DestinationRef): Promise<void> {
    if (!target.absRoot) {
      throw new Error('destination is not configured')
    }
    if (!fs.existsSync(target.absRoot)) {
      throw new Error(`destination folder does not exist: ${target.absRoot} — create it or choose another in Settings`)
    }
    if (!isWritableDir(target.absRoot)) {
      throw new Error(`destination folder is not writable: ${target.absRoot}`)
    }
  }

  async writeArtifact(target: ArtifactRef, content: string): Promise<string> {
    fs.mkdirSync(target.absRoot, { recursive: true })
    const ext = path.extname(target.rel) || '.md'
    const base = path.basename(target.rel, ext)
    // Distinct name alongside an existing file; the first version is untouched.
    const name = distinctName(base, ext, (n) => fs.existsSync(path.join(target.absRoot, n)))
    const dest = path.join(target.absRoot, name)
    fs.writeFileSync(dest, content, 'utf-8')
    return dest
  }

  async deposit(target: ArtifactRef, parts: DepositParts): Promise<DepositResult> {
    // Raw material goes to raw/<taskId>/ under the destination root — the same
    // deposit-first convention the wiki uses, so the material survives any
    // later failure of the curating step.
    const dir = path.join(target.absRoot, 'raw', parts.taskId)
    fs.mkdirSync(dir, { recursive: true })
    const files: string[] = []

    if (parts.content.trim()) {
      const name = distinctName(path.basename(target.rel, '.md'), '.md', (n) => fs.existsSync(path.join(dir, n)))
      fs.writeFileSync(path.join(dir, name), parts.content, 'utf-8')
      files.push(name)
    }
    if (parts.summary) {
      fs.writeFileSync(path.join(dir, 'ai-summary.md'), parts.summary, 'utf-8')
      files.push('ai-summary.md')
    }
    const attachment = parts.attachmentPath
    if (attachment && fs.existsSync(attachment)) {
      const name = `attachment-${path.basename(attachment)}`
      fs.copyFileSync(attachment, path.join(dir, name))
      files.push(name)
    }
    return { dir, files }
  }

  async snapshot(target: DestinationRef): Promise<SnapshotHandle> {
    const location = path.join(target.absRoot, '.history', new Date().toISOString().replace(/[:.]/g, '-'))
    const files = listFiles(target.absRoot)
    // Only materialize a backup directory when there is something to protect;
    // an empty `.history` in a user's folder is noise with no undo value.
    if (files.length > 0) {
      fs.mkdirSync(location, { recursive: true })
      for (const rel of files) {
        const dest = path.join(location, rel)
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(path.join(target.absRoot, rel), dest)
      }
    }
    return {
      store: 'folder',
      root: target.absRoot,
      subdir: '',
      location: files.length > 0 ? location : null,
      files
    }
  }

  async diff(handle: SnapshotHandle): Promise<string[]> {
    const before = new Set(handle.files)
    const touched: string[] = []
    for (const rel of listFiles(handle.root)) {
      const abs = path.join(handle.root, rel)
      if (!before.has(rel)) {
        touched.push(rel)
        continue
      }
      const snapshotCopy = handle.location ? path.join(handle.location, rel) : null
      if (snapshotCopy && fs.existsSync(snapshotCopy)) {
        if (fs.readFileSync(snapshotCopy, 'utf-8') !== fs.readFileSync(abs, 'utf-8')) touched.push(rel)
      }
    }
    return touched
  }
}

/** Every file under `root`, '/'-separated and root-relative. `.history` is excluded. */
function listFiles(root: string): string[] {
  const out: string[] = []
  if (!fs.existsSync(root)) return out
  const walk = (dir: string, base: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.history' || entry.name === 'raw') continue
      const full = path.join(dir, entry.name)
      const rel = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(full, rel)
      else out.push(rel)
    }
  }
  walk(root, '')
  return out
}

export const folderArtifactStore = new FolderArtifactStore()

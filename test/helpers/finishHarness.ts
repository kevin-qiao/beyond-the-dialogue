import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { openDB, migrate, saveSettings, createTask, createList, saveNotes, type DB } from '../../src/main/db'
import { createTypeDef, updateTypeDef, getTypeDef } from '../../src/main/types'
import { createSqliteStorage } from '../../src/main/adapters/sqlite/storageAdapter'
import { folderArtifactStore, ensureDestination } from '../../src/main/adapters/artifacts/folderStore'
import { nodePathPort } from '../../src/main/adapters/paths'
import { systemClock } from '../../src/core/ports/clock'
import { finishTask, type FinishDeps, type FinishOutcome } from '../../src/core/services/finishService'
import { setUserDataRoot } from '../../src/main/paths'
import type { AgentSessionPort } from '../../src/core/ports/agent'

// A shared harness for the destination/round-trip tests that need a real
// finish against a real folder. Kept in test/helpers so the test files
// themselves stay about behaviour rather than setup.

export const HARNESS_MINUTES = 'MINUTES'

/** A session that declines to assist: these tests are about destinations. */
export const noSession: AgentSessionPort = {
  isAvailable: () => false,
  async run() {
    throw new Error('the assistant must not be called for this behaviour')
  }
}

export function harness(): { conn: DB; dir: string; task: ReturnType<typeof createTask>; firstDir: string; secondDir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dest-'))
  setUserDataRoot(dir)
  const conn = openDB(dir)
  migrate(conn.db)
  saveSettings(conn.db, {
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: 'sk-scripted',
    defaultListId: null,
    maxConcurrentJobs: 2,
    showWelcome: false,
    theme: 'light',
    skills: [],
    mcpServers: []
  })
  const firstDir = path.join(dir, 'first')
  const secondDir = path.join(dir, 'second')
  ensureDestination(firstDir)
  ensureDestination(secondDir)

  createTypeDef(conn.db, {
    key: 'notes_type',
    kind: 'meeting',
    label: 'Notes',
    emoji: '📝',
    inputSchema: [{ key: 'learningNotePath', label: 'Note path', type: 'text' }],
    isBuiltin: false,
    finishBehaviour: 'file-as-is',
    destination: { store: 'folder', rootPath: firstDir, subdir: '' },
    grants: { skills: [], toolServers: [] }
  })

  const list = createList(conn.db, 'Work')
  const task = createTask(conn.db, {
    listId: list.id,
    title: 'Weekly sync',
    type: 'meeting',
    customTypeKey: 'notes_type',
    inputs: {}
  })
  saveNotes(conn.db, { taskId: task.id, notePath: path.join(dir, 'note.md'), content: HARNESS_MINUTES })
  return { conn, dir, task, firstDir, secondDir }
}

/** Point the task's type at `destDir`, then finish it. */
export async function finishWith(conn: DB, destDir: string, taskId: string, _behaviour?: string): Promise<FinishOutcome> {
  updateTypeDef(conn.db, {
    ...getTypeDef(conn.db, 'notes_type')!,
    destination: { store: 'folder', rootPath: destDir, subdir: '' }
  })
  const deps: FinishDeps = {
    // Tests render English; the language is explicit rather than absent so a
    // missing one cannot hide as a silent fallback.
    language: 'en',
    paths: nodePathPort,
    storage: createSqliteStorage(conn.db),
    storeFor: () => folderArtifactStore,
    session: noSession,
    clock: systemClock,
    notifier: { toast: () => {}, progress: () => {} },
    enqueueCurate: () => {},
    taskTargetOverride: (t) =>
      typeof t.inputs.learningNotePath === 'string' ? t.inputs.learningNotePath : undefined
  }
  return finishTask(deps, taskId)
}

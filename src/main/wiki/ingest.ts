import type { JobContext } from '../job-queue'
import type { IngestRecord, TaskPreprocess } from '../../shared/types'
import { getTask, listTypes, loadSettings, updateIngest } from '../db'
import { message } from '../../core/i18n'
import { LocalizedError } from '../../core/i18n/issues'
import { effectiveType } from '../../core/domain/taskType'
import { declaredWorkflow } from '../../core/domain/taskType'
import { depositThenCurate } from '../../core/domain/finish'
import { confineOverride, resolveArtifact } from '../../core/domain/destination'
import { createSqliteStorage } from '../adapters/sqlite/storageAdapter'
import { wikiArtifactStoreFor } from '../adapters/artifacts/wikiStore'
import { createAgentSessionAdapter } from '../adapters/agent/sessionAdapter'
import { systemClock } from '../../core/ports/clock'
import { nodePathPort } from '../adapters/paths'
import { resolveWikiPath } from './wiki'

// The background half of a `deposit-then-curate` finish.
//
// The behaviour itself lives in src/core/domain/finish.ts; this handler is the
// host that gives it a store, a confined session, and an activity record. The
// ordering it preserves is the point: the raw material is deposited and
// recorded FIRST, so it survives any later failure of the curating agent.

export async function runIngestJob(ctx: JobContext): Promise<void> {
  const { db, job } = ctx
  const taskId = job.taskId
  if (!taskId) throw new Error('ingest job missing task id')
  const task = getTask(db, taskId)
  if (!task) throw new Error('task not found')

  const settings = loadSettings(db)
  const wikiRoot = resolveWikiPath(settings.wikiPath)
  const def = effectiveType(listTypes(db), task)
  if (!def) throw new Error('no type definition resolves for this task')

  const workflow = declaredWorkflow(def)
  const dest = workflow.destination
  if (!dest || dest.store !== 'wiki') {
    throw new LocalizedError([{ key: 'ingest.typeNotDestined', params: { type: def.label } }])
  }

  const storage = createSqliteStorage(db)
  const target = resolveArtifact(nodePathPort, dest, wikiRoot, task.title, task.id)
  const session = createAgentSessionAdapter(() => loadSettings(db))
  const preprocess = storage.getPreprocess(taskId)

  const record = (patch: Parameters<typeof updateIngest>[2]): void => updateIngest(db, job.id, patch)

  // A learning task may override where its curated note lands. The default is
  // the destination's own subdir + slug, which is exactly what
  // resolveLearningNotePath produces when nothing is overridden.
  const rawOverride = task.inputs.learningNotePath
  const override = typeof rawOverride === 'string' && rawOverride.trim() ? rawOverride.trim() : ''
  // Confined through the same check the destination uses; an override that
  // escapes is refused rather than quietly replaced by the default.
  const confined = override ? confineOverride(nodePathPort, dest, wikiRoot, override) : null
  if (override && !confined) {
    throw new LocalizedError([{ key: 'ingest.notePathOutside', params: { path: override } }])
  }
  const noteTargetRel = confined?.rootRel

  const result = await depositThenCurate({
    task,
    // The curating step's labels are produced here, so this is where the
    // language is known — the strategy is handed the answer, not the question.
    language: settings.uiLanguage,
    typeDef: def,
    destination: target,
    workingContent: (storage.getNotes(taskId)?.content ?? '').trim(),
    declaredInputs: task.inputs,
    store: wikiArtifactStoreFor(wikiRoot),
    session,
    clock: systemClock,
    signal: new AbortController().signal,
    onStep: (label, progress) => ctx.setStep(label, progress),
    onDetail: (detail) => {
      if (detail.depositFiles) record({ depositFiles: detail.depositFiles })
      if (detail.protectedFiles) record({ touchedFiles: detail.protectedFiles })
    },
    summary: renderSummary(taskId, preprocess),
    attachmentPath: typeof task.inputs.filePath === 'string' ? task.inputs.filePath : undefined,
    noteTargetRel: noteTargetRel || undefined
  })

  // What the agent actually created or modified.
  record({ touchedFiles: result.touchedFiles })
  ctx.setStep(message(settings.uiLanguage, 'job.step.complete'), message(settings.uiLanguage, 'ingest.done'))
}

function renderSummary(taskId: string, p: TaskPreprocess | null): string | undefined {
  if (!p) return undefined
  return `# AI Pre-process Summary — ${taskId}

## Summary
${p.summary || '(none)'}

## Analysis
${p.analysis || '(none)'}

## Activity suggestions
${p.suggestions.map((s) => `- ${s}`).join('\n') || '(none)'}
`
}

// Re-exported for callers and tests that already import it from here.
export { depositTask } from './wiki'
export type { IngestRecord }

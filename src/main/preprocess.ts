import type { JobContext } from './job-queue'
import { getTask, updateTask, savePreprocess, addSuggestion, clearSuggestions, loadSettings } from './db'
import { message } from '../core/i18n'
import { createJobSession } from './ai/session-factory'
import { effectiveTypeDef, preprocessInputHash } from './types'
import {
  hasPreprocess,
  parsePreprocessOutput,
  preprocessInstruction
} from '../core/domain/preprocess'
import { hasAnyGrant } from '../shared/types'
import { resolveGrant } from '../core/domain/grant'
import { vaultDir } from './paths'
import type { TaskKind } from '../shared/types'

// Pre-process job engine (design D3): one job per task, dispatched to the
// task's effective category through the registry in src/core/domain/preprocess.
// Outputs are strict JSON from one agent turn — a working prompt, a summary,
// and 2-3 suggestions that also land in the suggestions table as chips.
//
// This is a CONFINED operation: the session is built with purpose 'confined',
// so it never receives a plugin grant, whatever the task's type declares.

function extractAssistantText(msg: any): string {
  if (!msg) return ''
  const content = msg.content
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('\n')
  }
  return typeof content === 'string' ? content : ''
}

export async function runPreprocessJob(ctx: JobContext): Promise<void> {
  const { db, job } = ctx
  const taskId = job.taskId
  if (!taskId) throw new Error('preprocess job missing task id')
  const task = getTask(db, taskId)
  if (!task) throw new Error('task not found')
  const def = effectiveTypeDef(db, task)
  const kind = (def?.kind ?? 'plain') as TaskKind

  // A category with no pre-process has nothing to do. Guarded here rather than
  // by the caller so a stray job cannot produce a nonsense analysis.
  if (!hasPreprocess(kind)) return
  const instruction = preprocessInstruction(kind)!

  const settings = loadSettings(db)
  if (!settings.apiKey || !settings.model) {
    // Fail fast when no key is configured (task ops unaffected).
    updateTask(db, taskId, { preprocessStatus: 'failed', preprocessError: 'AI not configured: no API key' })
    throw new Error('AI not configured: no API key')
  }

  const inputsHash = preprocessInputHash(task, def)
  const lang = settings.uiLanguage
  ctx.setStep(message(lang, 'preprocess.step.running'), message(lang, instruction.step))

  const prompt = instruction.buildPrompt({
    context: instruction.buildContext(task, task.inputs),
    userPrompt: typeof task.inputs.purpose === 'string' ? task.inputs.purpose : '',
    aiGuidance: def?.aiGuidance ?? '',
    inputs: task.inputs,
    // This job is confined, so the grant is always empty — but the instruction
    // is built from the resolved grant rather than from an assumption, so the
    // two cannot drift apart.
    granted: hasAnyGrant(resolveGrant({ purpose: 'confined', typeDef: def }))
  })

  const session = await createJobSession({
    settings,
    // The session is bound to the app-owned vault: a pre-process never reads
    // the user's working content beyond the task's own declared inputs.
    cwd: vaultDir(),
    systemPrompt: `You produce structured JSON analysis for work-board tasks. Follow the output contract exactly.`,
    thinkingLevel: 'medium',
    tools: [],
    noContextFiles: true,
    purpose: 'confined',
    typeDef: def,
    grant: { skills: [], toolServers: [] }
  })

  // User cancel (jobs:cancel) aborts the in-flight agent call.
  ctx.onCancel(() => {
    void session.abort().catch(() => undefined)
  })

  try {
    await session.prompt(prompt, { expandPromptTemplates: false })
    const last = [...session.messages].reverse().find((m: any) => m.role === 'assistant' && m.content?.length)
    const text = extractAssistantText(last)
    if (!text) throw new Error('pre-process agent produced no output')
    const out = parsePreprocessOutput(text)

    savePreprocess(db, {
      taskId,
      kind,
      summary: out.summary,
      analysis: out.analysis,
      suggestions: out.suggestions,
      status: 'ready',
      inputsHash
    })
    // Activity suggestions land as dismissible chips (existing UI path).
    clearSuggestions(db, taskId)
    for (const s of out.suggestions) addSuggestion(db, taskId, s)
    updateTask(db, taskId, { preprocessStatus: 'ready', preprocessError: null })
    ctx.setStep(message(lang, 'job.step.complete'), message(lang, 'preprocess.done'))
  } catch (e: any) {
    // Do not mark the task failed here: transient errors are re-queued by the
    // job queue (status stays 'queued'), and the terminal 'failed' marker is
    // written by the queue's failed event (index.ts wireJobEvents).
    throw e instanceof Error ? e : new Error(String(e?.message ?? e))
  } finally {
    await session.abort().catch(() => undefined)
    // End the session properly (stops any MCP servers its shutdown handler
    // owns — none for this confined run, but the ordering is uniform).
    await session.dispose?.().catch(() => undefined)
  }
}

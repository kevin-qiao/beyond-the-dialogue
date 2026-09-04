import type { JobContext } from './job-queue'
import { getTask, addSuggestion, listSuggestions, loadSettings } from './db'
import { isConfigured } from './ai/ai-config'

// My Day suggestion job: a single non-looping LLM call that produces 2-3
// dismissible suggestion chips based on the task, its list, My Day titles,
// and local time. Never mutates the task.

export async function runSuggestionJob(ctx: JobContext): Promise<void> {
  const { db, job } = ctx
  const taskId = job.taskId
  if (!taskId) throw new Error('suggestion job missing task id')
  const task = getTask(db, taskId)
  if (!task) throw new Error('task not found')

  const settings = loadSettings(db)
  if (!isConfigured(settings)) {
    // No key configured: gracefully no-op. The renderer shows the
    // "AI not configured" indicator instead.
    return
  }

  ctx.setStep('Suggesting', 'Generating suggestions')

  const list = db.prepare('SELECT name FROM lists WHERE id = ?').get(task.listId) as { name: string } | undefined
  const myDayTitles = (
    db.prepare("SELECT title FROM tasks WHERE deleted_at IS NULL AND in_my_day = 1 AND id != ?").all(taskId) as {
      title: string
    }[]
  ).map((r) => r.title)

  const localTime = new Date().toLocaleString('en-US', {
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit'
  })

  const prompt = `You are a thoughtful personal productivity coach. Given a task, produce 2 to 3 short, concrete, actionable suggestions that help the user get it done today.

Task title: ${task.title}
Task notes: ${task.notes || '(none)'}
List: ${list?.name ?? '?'}
Other tasks planned today: ${myDayTitles.length ? myDayTitles.join('; ') : '(none)'}
Local time: ${localTime}

Return your answer as a JSON array of 2 to 3 strings. Each string must be a single, specific, helpful suggestion (max ~12 words). Output ONLY the JSON array, nothing else.`

  const scripted = await (await import('./ai/session-factory')).runScriptedSimplePrompt(prompt)
  const raw = scripted ?? (await (await import('./ai/agent-runtime')).runSimplePrompt(settings, prompt, { reasoning: 'minimal' }))
  const cleaned = raw.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1) throw new Error('suggestion agent returned no list')
  const arr = JSON.parse(cleaned.slice(start, end + 1))
  const items = Array.isArray(arr) ? arr.filter((s: unknown): s is string => typeof s === 'string').slice(0, 3) : []
  if (items.length === 0) throw new Error('suggestion agent returned empty list')

  for (const text of items) {
    addSuggestion(db, taskId, text)
  }
  ctx.setStep('Complete', `${items.length} suggestions generated`)
  void listSuggestions(db, taskId)
}

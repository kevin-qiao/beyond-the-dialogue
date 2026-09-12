import type { Task, TaskTypeDef } from '../../shared/types'

// Stable hash over the inputs that drive a type's pre-process. Used to gate
// re-runs when a task's inputs change while it sits in My Day (design D3).
//
// "Relevant" means the non-inert declared fields — the skill/MCP placeholders
// do not change what the assistant produces, so they do not invalidate a run.
// Title and notes are folded in because the pre-process prompt includes them.
export function preprocessInputHash(task: Task, def: TaskTypeDef | null): string {
  const relevant = (def?.inputSchema ?? [])
    .filter((f) => !f.inert)
    .map((f) => f.key)
    .sort()
  const parts = [`title=${task.title}`, `notes=${task.notes}`]
  for (const k of relevant) parts.push(`${k}=${typeof task.inputs[k] === 'string' ? (task.inputs[k] as string) : ''}`)
  const s = parts.join('\n')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) | 0
  return `h${(h >>> 0).toString(36)}`
}

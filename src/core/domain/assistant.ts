import type { Settings } from '../../shared/types'

// The assistant-runtime switch, as a pure rule (feature 001, research D1).
//
// FR-014/FR-015 require the harness to be configured and INERT: while the
// switch is off, nothing may construct an agent session, an MCP extension, or
// an outbound call from the assistant machinery. That reachability is decided
// at the existing service choke points (taskService enqueues, finishService
// behaviour dispatch, job-handler registration, the IPC handlers) — each one
// asks HERE rather than comparing the string itself, so the declared value is
// dispatched on in exactly one place (Principle I).
//
// An unrecognised value is off: the safe answer to a question the data failed
// to ask. Anything that only reaches the network when told to must default to
// not reaching it.

export function isAssistantEnabled(settings: Pick<Settings, 'assistantRuntime'>): boolean {
  return settings.assistantRuntime === 'on'
}

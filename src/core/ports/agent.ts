import type { TaskTypeDef } from '../../shared/types'

// AgentSessionPort — the seam where an agent session is built and run.
//
// This is where plugin grants are evaluated, and the evaluation is driven by
// the *purpose* of the run rather than by the caller's intent
// (contracts/plugin-grants.md §2). A confined run returns NO_GRANT
// unconditionally: there is no code path that yields a grant for material
// ingestion, minute polishing, or suggestion generation, so the confinement
// guarantee is architectural and holds even for a misconfigured type.

/**
 * `confined` — a background operation with no external reach: material
 * ingestion, minute polishing, suggestion generation.
 * `interactive` — a session the user is driving, which may use the type's
 * granted skills and tool servers.
 */
export type SessionPurpose = 'interactive' | 'confined'

export interface AgentRunRequest {
  purpose: SessionPurpose
  /** The type whose grants apply. Ignored for confined runs, by construction. */
  typeDef?: TaskTypeDef | null
  /** Working directory the session is bound to. */
  cwd: string
  systemPrompt: string
  prompt: string
  /** Tool allowlist. `[]` means no tools at all. */
  tools: string[]
  thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  /** Report progress to the activity surface. */
  onStep?: (label: string, progress?: string) => void
  /** Abort signal; a cancelled run rejects. */
  signal?: AbortSignal
}

export interface AgentSessionPort {
  /** Whether a provider is configured and usable right now. */
  isAvailable(): boolean
  /**
   * Run one turn and return the assistant's text output.
   *
   * Rejects when the run fails; callers degrade rather than propagate (a
   * finish never fails solely because AI is unavailable — FR-025).
   */
  run(req: AgentRunRequest): Promise<string>
}

// Grant resolution lives in the domain (src/core/domain/grant.ts); re-exported
// here because this is the seam callers reach for it from.
export { resolveGrant } from '../domain/grant'

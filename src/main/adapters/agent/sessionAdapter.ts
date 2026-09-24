import type { Settings } from '../../../shared/types'
import type { AgentRunRequest, AgentSessionPort } from '../../../core/ports/agent'
import { resolveGrant } from '../../../core/ports/agent'
import { createJobSession } from '../../ai/session-factory'

// The AgentSessionPort implementation: one confined-or-interactive turn through
// the Pi SDK seam.
//
// Everything that touches the agent runtime arrives here, so the SDK stays
// behind one adapter and core keeps its no-platform-imports property.
// `createJobSession` is the test seam (`setSessionFactory`), which is why this
// adapter delegates to it rather than reaching for the SDK itself.

export function extractAssistantText(msg: any): string {
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

export function createAgentSessionAdapter(getSettings: () => Settings): AgentSessionPort {
  return {
    isAvailable(): boolean {
      const s = getSettings()
      return !!(s.apiKey && s.model && s.provider)
    },

    async run(req: AgentRunRequest): Promise<string> {
      const settings = getSettings()
      // Grants are resolved from the PURPOSE, here at the build seam — a
      // confined run gets none by construction (contracts/plugin-grants.md §2).
      const grant = resolveGrant({ purpose: req.purpose, typeDef: req.typeDef })

      const session = await createJobSession({
        settings,
        cwd: req.cwd,
        systemPrompt: req.systemPrompt,
        thinkingLevel: req.thinkingLevel ?? 'medium',
        tools: req.tools,
        noContextFiles: true,
        purpose: req.purpose,
        typeDef: req.typeDef ?? null,
        grant
      })

      const onAbort = () => {
        void session.abort().catch(() => undefined)
      }
      req.signal?.addEventListener('abort', onAbort, { once: true })

      try {
        await session.prompt(req.prompt, { expandPromptTemplates: false })
        const last = [...session.messages]
          .reverse()
          .find((m: any) => m.role === 'assistant' && m.content?.length)
        // An empty result is returned as-is, not thrown: a tool-using
        // curating session legitimately finishes without assistant prose,
        // and it is the caller that knows whether text was required.
        return extractAssistantText(last)
      } finally {
        req.signal?.removeEventListener('abort', onAbort)
        await session.abort().catch(() => undefined)
        // Dispose the session so the MCP adapter's session_shutdown handler
        // runs (stopping any child processes). Confined sessions have no
        // such handler and dispose is harmless. Optional so scripted
        // doubles — which do not implement it — are unaffected.
        await session.dispose?.().catch(() => undefined)
      }
    }
  }
}

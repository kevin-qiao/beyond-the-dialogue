import type { Settings } from '../shared/types'

// Validation for the managed Skills/MCP collections (spec skills-mcp-settings,
// design D6). These entries are persisted and snapshot-delivered but inert in
// v0.8: NOTHING on the agent path (agent-runtime, session-factory, preprocess,
// ingest, suggestions) imports them — the future wiring is a per-type grant
// evaluated at session build in session-factory.ts. Keep that invariant true:
// if you are about to read Settings.skills/Settings.mcpServers from agent
// code, v0.8 says no (the add-mcp-support change gates that).

export function validatePluginEntries(s: Settings): string[] {
  const errors: string[] = []
  const skillNames = new Set<string>()
  for (const [i, sk] of (s.skills ?? []).entries()) {
    if (!sk.name?.trim()) errors.push(`skill #${i + 1}: name is required`)
    else if (skillNames.has(sk.name)) errors.push(`skill "${sk.name}": name must be unique`)
    else skillNames.add(sk.name)
    if (!sk.description?.trim()) errors.push(`skill "${sk.name ?? i + 1}": description is required`)
  }
  const serverNames = new Set<string>()
  for (const [i, sv] of (s.mcpServers ?? []).entries()) {
    if (!sv.name?.trim()) errors.push(`MCP server #${i + 1}: name is required`)
    else if (serverNames.has(sv.name)) errors.push(`MCP server "${sv.name}": name must be unique`)
    else serverNames.add(sv.name)
    const t = sv.transport
    if (!t || typeof t !== 'object') {
      errors.push(`MCP server "${sv.name ?? i + 1}": transport definition is required`)
      continue
    }
    if (t.type !== 'stdio') errors.push(`MCP server "${sv.name}": unsupported transport type "${t.type}" (only stdio in this version)`)
    if (!t.command?.trim()) errors.push(`MCP server "${sv.name}": a command is required for the stdio transport`)
    if (t.args && !Array.isArray(t.args)) errors.push(`MCP server "${sv.name}": args must be a list`)
    if (t.env && (typeof t.env !== 'object' || Array.isArray(t.env))) errors.push(`MCP server "${sv.name}": env must be a name→value map`)
  }
  return errors
}

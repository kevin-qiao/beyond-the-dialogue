import type { Settings } from '../../shared/types'
import type { IssueList } from '../i18n/issues'
import { validateMcpServerConfig } from './mcpConfig'

// Validation for the managed Skills/MCP collections (spec skills-mcp-settings).
//
// Lives in the domain because it is a pure rule about configuration, and the
// settings service — not the Electron handler — is what applies it. The per-
// server MCP rules are delegated to mcpConfig.ts so the same code decides what
// a paste may hold and what a save may persist.

export function validatePluginEntries(s: Settings): IssueList {
  const errors: IssueList = []
  const skillNames = new Set<string>()
  for (const [i, sk] of (s.skills ?? []).entries()) {
    if (!sk.name?.trim()) errors.push({ key: 'plugin.skill.nameRequired', params: { n: i + 1 } })
    else if (skillNames.has(sk.name)) errors.push({ key: 'plugin.skill.nameUnique', params: { name: sk.name } })
    else skillNames.add(sk.name)
    if (!sk.path?.trim()) errors.push({ key: 'plugin.skill.pathRequired', params: { name: sk.name ?? i + 1 } })
  }
  const serverNames = new Set<string>()
  for (const [i, sv] of (s.mcpServers ?? []).entries()) {
    if (!sv.name?.trim()) errors.push({ key: 'plugin.mcp.nameRequired', params: { n: i + 1 } })
    else if (serverNames.has(sv.name)) errors.push({ key: 'plugin.mcp.nameUnique', params: { name: sv.name } })
    else serverNames.add(sv.name)
    errors.push(...validateMcpServerConfig(sv.name ?? String(i + 1), sv.config))
  }
  return errors
}

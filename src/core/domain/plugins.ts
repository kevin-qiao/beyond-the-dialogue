import type { Settings } from '../../shared/types'
import type { IssueList } from '../i18n/issues'

// Validation for the managed Skills/MCP collections (spec skills-mcp-settings).
//
// Lives in the domain because it is a pure rule about configuration, and the
// settings service — not the Electron handler — is what applies it.

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
    const t = sv.transport
    if (!t || typeof t !== 'object') {
      errors.push({ key: 'plugin.mcp.transportRequired', params: { name: sv.name ?? i + 1 } })
      continue
    }
    if (t.type !== 'stdio')
      errors.push({ key: 'plugin.mcp.unsupportedTransport', params: { name: sv.name, type: t.type } })
    if (!t.command?.trim()) errors.push({ key: 'plugin.mcp.commandRequired', params: { name: sv.name } })
    if (t.args && !Array.isArray(t.args)) errors.push({ key: 'plugin.mcp.argsNotList', params: { name: sv.name } })
    if (t.env && (typeof t.env !== 'object' || Array.isArray(t.env)))
      errors.push({ key: 'plugin.mcp.envNotMap', params: { name: sv.name } })
  }
  return errors
}

import type { McpServerEntry } from '../../shared/types'
import type { IssueList, MessageIssue } from '../i18n/issues'

// The MCP server configuration rules, pure and I/O-free like the rest of the
// domain: the settings rows are the source of truth, this module decides what
// counts as a valid server, turns user-pasted JSON into rows, and renders the
// rows back into the standard `mcp.json` shape. The only consumer that ever
// CONNECTS lives under src/main/adapters/agent/ and receives the in-memory
// form (contracts/plugin-grants.md §5).

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Validate one server config — the object that would live at
 * `mcpServers.<name>` in a standard mcp.json. Only structural sanity is
 * decided here; everything else (lifecycle, headers, env interpolation,
 * includeTools …) passes through to the adapter uninterpreted, which is what
 * lets the user supply the FULL standard configuration manually.
 */
export function validateMcpServerConfig(name: string, config: unknown): IssueList {
  if (!isPlainObject(config)) return [{ key: 'plugin.mcp.configNotObject', params: { name } }]
  const errors: MessageIssue[] = []
  const transports = (['command', 'url', 'socket'] as const).filter(
    (k) => typeof config[k] === 'string' && (config[k] as string).trim()
  )
  if (transports.length !== 1) errors.push({ key: 'plugin.mcp.transportAmbiguous', params: { name } })
  if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some((a) => typeof a !== 'string')))
    errors.push({ key: 'plugin.mcp.argsNotList', params: { name } })
  for (const key of ['env', 'headers'] as const) {
    const v = config[key]
    if (
      v !== undefined &&
      (!isPlainObject(v) || Object.values(v).some((x) => typeof x !== 'string'))
    )
      errors.push({ key: key === 'env' ? 'plugin.mcp.envNotMap' : 'plugin.mcp.headersNotMap', params: { name } })
  }
  if (config.cwd !== undefined && typeof config.cwd !== 'string')
    errors.push({ key: 'plugin.mcp.cwdNotString', params: { name } })
  return errors
}

/**
 * A user-pasted manual configuration. Two shapes are accepted, mirroring how
 * MCP configs are shared in the wild:
 *
 *   1. a complete `{"mcpServers": { "<name>": { … }, … }}` block, or
 *   2. a bare map `{ "<name>": { … }, … }` (one or more servers).
 *
 * Anything else (arrays, scalars, a lone server body without its name) is
 * refused with pasteShape — a server body without a name would silently invent
 * one from its transport fields. The parsed rows carry the same validation
 * issues `validateMcpServerConfig` produces, so a paste can be refused before
 * it reaches the draft.
 */
export function parseMcpJsonPaste(raw: string): { entries: McpServerEntry[]; issues: IssueList } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { entries: [], issues: [{ key: 'plugin.mcp.invalidJson', params: { error: e instanceof Error ? e.message : String(e) } }] }
  }
  let servers: unknown = parsed
  if (isPlainObject(parsed) && 'mcpServers' in parsed) servers = parsed.mcpServers
  if (!isPlainObject(servers) || Object.keys(servers).length === 0)
    return { entries: [], issues: [{ key: 'plugin.mcp.pasteShape' }] }
  // A name→config map has an OBJECT for every server. A value that is not an
  // object is the sign of a lone server body pasted without its name
  // ({"command": "npx"}), so the whole paste is refused with one clear shape
  // error instead of per-key nonsense like 'server "command": config must be
  // an object'.
  if (!Object.values(servers).every((v) => isPlainObject(v)))
    return { entries: [], issues: [{ key: 'plugin.mcp.pasteShape' }] }

  const entries: McpServerEntry[] = []
  const issues: MessageIssue[] = []
  for (const [key, config] of Object.entries(servers)) {
    const name = key.trim()
    if (!name) {
      issues.push({ key: 'plugin.mcp.nameRequired', params: { n: entries.length + 1 } })
      continue
    }
    if (entries.some((e) => e.name === name)) {
      issues.push({ key: 'plugin.mcp.nameUnique', params: { name } })
      continue
    }
    issues.push(...validateMcpServerConfig(name, config))
    entries.push({ name, config: isPlainObject(config) ? config : {} })
  }
  return { entries, issues }
}

/** The entries whose name is granted, as the adapter's mcpServers map. */
export function snapshotFromGrant(
  entries: McpServerEntry[],
  names: readonly string[]
): Record<string, Record<string, unknown>> {
  const wanted = new Set(names)
  const out: Record<string, Record<string, unknown>> = {}
  for (const e of entries) if (wanted.has(e.name)) out[e.name] = e.config
  return out
}

/** The deterministic standard mcp.json body for these entries (output-only). */
export function buildMcpSettingsJson(entries: readonly McpServerEntry[]): string {
  const mcpServers: Record<string, unknown> = {}
  for (const e of entries) mcpServers[e.name] = e.config
  return JSON.stringify({ mcpServers }, null, 2) + '\n'
}

/** One-line transport summary for a settings row (never reveals secrets). */
export function describeMcpServer(entry: McpServerEntry): string {
  const c = entry.config
  if (typeof c.command === 'string' && c.command.trim()) {
    const args = Array.isArray(c.args) ? c.args.filter((a): a is string => typeof a === 'string') : []
    return [c.command, ...args].join(' ')
  }
  if (typeof c.url === 'string' && c.url.trim()) return c.url.trim()
  if (typeof c.socket === 'string' && c.socket.trim()) return c.socket.trim()
  // Unreachable for saved entries (validation insists on one transport).
  return '—'
}

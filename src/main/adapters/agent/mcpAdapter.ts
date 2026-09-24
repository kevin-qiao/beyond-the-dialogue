import type { McpServerEntry, PluginGrant } from '../../../shared/types'
import { snapshotFromGrant } from '../../../core/domain/mcpConfig'

// The one place the app reaches the outside world through MCP.
//
// pi-mcp-adapter is the transport (research R7b: 2.35.0 cleared the
// reproducibility gate that deferred 2.33.0). It is driven ONLY through
// `createMcpAdapter({ config })` — the in-memory isolated form, which the
// package documents as "a complete, isolated snapshot… not merged with files,
// imports, global config, project config, or --mcp-config" and which disables
// its own ambient setup commands. That keeps the contract's non-negotiable
// isolation property (contracts/plugin-grants.md §5) true of this app: no
// session ever reads ~/.config/mcp, a project .mcp.json, or the user's ~/.pi.
//
// The DEFAULT export of the package is the ambient-file adapter and must
// NEVER be used — only the named `createMcpAdapter`, with a config, always.
// test/mcpAdapter.test.ts enforces this mechanically.
//
// Confinement is decided upstream and not re-decided here: the caller hands
// over an already-resolved grant (`resolveGrant`), so a confined run arrives
// with no tool servers and this module constructs nothing.

export interface McpExtensionResult {
  /** The adapter's extension factory, or null when no session MCP is wanted. */
  extension: unknown | null
  /** Extension tool names that must be present in the session's `tools` allowlist. */
  toolNames: string[]
  /** Names the type granted but that have no registered config — reported, not swallowed (FR-024). */
  missingGranted: string[]
}

const NO_MCP: McpExtensionResult = { extension: null, toolNames: [], missingGranted: [] }

/** Build the extension from an isolated snapshot. Replaceable in tests. */
export type McpAdapterFactory = (snapshot: Record<string, Record<string, unknown>>) => unknown

let adapterFactory: McpAdapterFactory | null = null

// Tests inject a scripted adapter factory here (same seam pattern as
// setSessionFactory and setGitHubFetcher).
export function setMcpAdapterFactory(f: McpAdapterFactory | null): void {
  adapterFactory = f
}

export async function buildMcpExtension(
  entries: readonly McpServerEntry[],
  grant: PluginGrant
): Promise<McpExtensionResult> {
  if (grant.toolServers.length === 0) return NO_MCP

  const snapshot = snapshotFromGrant(entries as McpServerEntry[], grant.toolServers)
  const missingGranted = grant.toolServers.filter((name) => !(name in snapshot))
  if (Object.keys(snapshot).length === 0)
    return { extension: null, toolNames: [], missingGranted }

  const factory = adapterFactory ?? (await loadRealAdapterFactory())
  return { extension: factory(snapshot), toolNames: ['mcp'], missingGranted }
}

// The package entry is TypeScript (its exports map "." to index.ts), so it
// cannot be imported by the compiled ESM main directly. Pi loads its own
// extensions exactly this way — jiti, the same version pi-coding-agent pins —
// transpiling the .ts entry at load. `pi-mcp-adapter` may appear as a string
// nowhere else in src (guard test).
async function loadRealAdapterFactory(): Promise<McpAdapterFactory> {
  const { createJiti } = await import('jiti/static')
  const jiti = createJiti(import.meta.url)
  const ns = (await jiti.import('pi-mcp-adapter')) as {
    createMcpAdapter: (options: { config: { mcpServers: Record<string, unknown> } }) => unknown
  }
  return (snapshot) => ns.createMcpAdapter({ config: { mcpServers: snapshot } })
}

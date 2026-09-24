import * as fs from 'node:fs'
import * as path from 'node:path'
import type { McpServerEntry } from '../shared/types'
import { buildMcpSettingsJson } from '../core/domain/mcpConfig'
import { piMcpConfigPath } from './paths'

// The app-owned mcp.json (src/main/paths.ts names the location). The user
// asked the app to keep it current: every settings save and every startup
// rewrites the whole file from the settings rows — a single writer, no merge,
// so the file can never disagree with what the app will hand to the adapter.
//
// It is OUTPUT ONLY. Nothing on the agent path reads it back: sessions
// receive the in-memory isolated snapshot built from the rows themselves
// (src/main/adapters/agent/mcpAdapter.ts). The file exists to be inspected,
// diffed, and picked up by external tools that understand the standard shape —
// and because writing a config INTO a file by hand is exactly what manual
// server management should feel like, even though the app does it here.

export function materializeMcpConfig(entries: readonly McpServerEntry[]): void {
  const file = piMcpConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, buildMcpSettingsJson(entries))
}

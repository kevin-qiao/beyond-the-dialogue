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
//
// Feature 001 changed WHERE the env values are stored (migration v10 moved
// them to the machine-bound secret store), not the file's shape: T047 merges
// them back at write time through `envFor`, which the caller wires to the
// gated store — so on a copied folder the re-entry story applies here too,
// and this file only ever carries what THIS machine's store already holds.
// The record of that accepted trade-off lives in the spec analysis (M4).

export function materializeMcpConfig(
  entries: readonly McpServerEntry[],
  envFor?: (serverName: string) => Record<string, string>
): void {
  const file = piMcpConfigPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const merged: McpServerEntry[] = !envFor
    ? [...entries]
    : entries.map((e) => {
        const env = envFor(e.name)
        if (!env || Object.keys(env).length === 0) return e
        // A row's own stored config wins nowhere else: env lives in the
        // store, so the merge is the only place the value re-appears.
        return { ...e, config: { ...e.config, env: { ...env } } }
      })
  fs.writeFileSync(file, buildMcpSettingsJson(merged))
}

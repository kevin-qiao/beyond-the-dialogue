import * as fs from 'node:fs'
import * as path from 'node:path'
import { skillsDir } from './paths'
import type { SkillEntry } from '../shared/types'

// Skill import (Settings → Skills): a skill is a folder containing SKILL.md
// (plus any supporting files). Importing copies the folder into the app-owned
// skills dir and returns the managed entry. Entries stay inert in this version
// (the agent does not load them) — this module only manages folders and never
// touches the agent path.

function parseFrontmatter(raw: string): { name?: string; description?: string } {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(raw)
  if (!m) return {}
  const out: { name?: string; description?: string } = {}
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
    if (key === 'name') out.name = value
    else if (key === 'description') out.description = value
  }
  return out
}

function sanitizeName(name: string): string {
  const clean = name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return clean || 'skill'
}

export function importSkillFolder(sourceDir: string): SkillEntry {
  const skillMd = path.join(sourceDir, 'SKILL.md')
  if (!fs.existsSync(skillMd) || !fs.statSync(skillMd).isFile()) {
    throw new Error('A skill folder must contain SKILL.md')
  }
  const raw = fs.readFileSync(skillMd, 'utf-8')
  const fm = parseFrontmatter(raw)
  const name = (fm.name?.trim() || sanitizeName(path.basename(sourceDir))).trim()
  const description = (fm.description ?? '').trim()
  const target = path.join(skillsDir(), name)
  fs.mkdirSync(skillsDir(), { recursive: true })
  fs.cpSync(sourceDir, target, { recursive: true })
  return { name, description, path: target }
}

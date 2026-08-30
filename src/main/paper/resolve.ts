import type { AnalysisLevel } from '../../shared/types'
// classifyLink lives in src/shared/link.ts so the renderer's quick capture
// can detect paper links without importing main code; re-exported here for
// paper resolution and existing tests.
import { classifyLink } from '../../shared/link'

// Link resolution for paper-reading tasks. arXiv links get full metadata via
// the arXiv API; DOI/Crossref and citation_* meta tags are fallbacks. The
// achieved analysis level (full / abstract / metadata) is always recorded.

export interface ResolvedPaper {
  title: string
  authors: string[]
  abstract: string
  pdfUrl: string | null
  level: AnalysisLevel
  externalId?: string
  doi?: string
  source: 'arxiv' | 'crossref' | 'meta'
}

export type ResolveError =
  | { kind: 'no_link'; message: string }
  | { kind: 'network'; message: string }
  | { kind: 'parse'; message: string }
  | { kind: 'unsupported'; message: string }

export { classifyLink, isPaperLink, type LinkClassification, type LinkType } from '../../shared/link'

function parseXml(xml: string): Record<string, string> {
  const out: Record<string, string> = {}
  const get = (tag: string, scope?: string): string => {
    const src = scope ?? xml
    const m = src.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
    return m && m[1] ? m[1].trim() : ''
  }
  // arXiv API responses have a feed-level <title> (the query echo) followed by
  // per-entry <title>/<summary>. Prefer the first <entry> block.
  const entry = get('entry') || xml
  out.title = get('title', entry)
  out.summary = get('summary', entry)
  out.id = get('id', entry)
  out.pdf = ''
  out.authors = (entry.match(/<name>([\s\S]*?)<\/name>/g) ?? [])
    .map((s) => s.replace(/<\/?name>/g, '').trim())
    .join(' | ')
  return out
}

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WorkBoard/0.1 (research app)', Accept: 'application/xml,text/html,*/*', ...headers }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  return res.text()
}

let resolverOverride: ((raw: string) => Promise<ResolvedPaper | ResolveError>) | null = null

// Tests inject a scripted resolver to avoid network calls.
export function setResolverOverride(f: ((raw: string) => Promise<ResolvedPaper | ResolveError>) | null): void {
  resolverOverride = f
}

export async function resolvePaper(raw: string): Promise<ResolvedPaper | ResolveError> {
  if (resolverOverride) return resolverOverride(raw)
  const link = classifyLink(raw)
  try {
    if (link.type === 'arxiv' && link.id) {
      const xml = await fetchText(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(link.id)}`)
      const parsed = parseXml(xml)
      if (!parsed.title) return { kind: 'parse', message: 'arXiv returned no entry for that id' }
      const authors = (parsed.authors ?? '').split(' | ').filter(Boolean)
      const pdfUrl = `https://arxiv.org/pdf/${link.id}.pdf`
      return {
        title: parsed.title.replace(/\.$/, ''),
        authors,
        abstract: (parsed.summary ?? '').replace(/\s+/g, ' ').trim(),
        pdfUrl,
        level: 'full',
        externalId: link.id,
        source: 'arxiv'
      }
    }
    if (link.type === 'doi' && link.id) {
      const json = await fetchText(`https://api.crossref.org/works/${encodeURIComponent(link.id)}`, {
        Accept: 'application/json'
      })
      const data = JSON.parse(json)
      const msg = data?.message
      if (!msg?.title?.[0]) return { kind: 'parse', message: 'Crossref returned no metadata' }
      return {
        title: msg.title[0],
        authors: (msg.author ?? []).map((a: any) => `${a.given ?? ''} ${a.family ?? ''}`.trim()).filter(Boolean),
        abstract: (msg.abstract ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
        pdfUrl: null,
        level: 'abstract',
        doi: link.id,
        source: 'crossref'
      }
    }
    if (link.type === 'meta' && link.id) {
      const html = await fetchText(link.id)
      const title = html.match(/<meta\s+property=["']citation_title["']\s+content=["']([^"']+)["']/i)?.[1] ??
        html.match(/<meta\s+name=["']citation_title["']\s+content=["']([^"']+)["']/i)?.[1] ??
        html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
      const authors = [...html.matchAll(/<meta\s+(?:name|property)=["']citation_author["']\s+content=["']([^"']+)["']/gi)].map((m) => m[1] ?? '')
      const abstract = html.match(/<meta\s+(?:name|property)=["']citation_abstract["']\s+content=["']([^"']+)["']/i)?.[1] ?? ''
      const pdf = html.match(/<meta\s+(?:name|property)=["']citation_pdf_url["']\s+content=["']([^"']+)["']/i)?.[1] ?? null
      if (!title) return { kind: 'parse', message: 'No citation metadata found at that URL' }
      return {
        title,
        authors: authors.filter(Boolean),
        abstract: abstract.replace(/\s+/g, ' ').trim(),
        pdfUrl: pdf,
        level: pdf ? 'full' : abstract ? 'abstract' : 'metadata',
        source: 'meta'
      }
    }
    return { kind: 'unsupported', message: 'Unsupported link. Provide an arXiv link, a DOI, or a publisher URL.' }
  } catch (e: any) {
    return { kind: 'network', message: e?.message ?? String(e) }
  }
}

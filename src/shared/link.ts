// Pure link classification shared by main (paper resolution) and renderer
// (quick capture auto-detection). No main-only imports allowed here.

export type LinkType = 'arxiv' | 'doi' | 'meta' | 'unknown'

export interface LinkClassification {
  type: LinkType
  id?: string
}

export function classifyLink(raw: string): LinkClassification {
  const url = raw.trim()
  if (!url) return { type: 'unknown' }
  // arXiv: arxiv.org/abs/..., arxiv.org/pdf/..., arxiv.org/...., or bare ID
  let m = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)/i)
  if (m) return { type: 'arxiv', id: m[1] }
  m = url.match(/arxiv\.org\/abs\/([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)/i)
  if (m) return { type: 'arxiv', id: m[1] }
  m = url.match(/^([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)$/)
  if (m) return { type: 'arxiv', id: m[1] }
  // DOI
  m = url.match(/doi\.org\/(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i)
  if (m) return { type: 'doi', id: m[1] }
  m = url.match(/^10\.\d{4,9}\/[-._;()/:A-Z0-9]+$/i)
  if (m) return { type: 'doi', id: url }
  // Any http(s) URL -> try citation meta tags
  if (/^https?:\/\//i.test(url)) return { type: 'meta', id: url }
  return { type: 'unknown' }
}

// "Can this input be treated as a paper link?" — true for anything the
// resolver will accept (arXiv/DOI/bare ID/URL).
export function isPaperLink(raw: string): boolean {
  return classifyLink(raw).type !== 'unknown'
}

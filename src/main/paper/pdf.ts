import * as fs from 'node:fs'
import * as path from 'node:path'

// pdf.js v4 is ESM-only; load it lazily via dynamic import (main is CJS).

type PdfJsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs')

let pdfjsPromise: Promise<PdfJsModule> | null = null

function getPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    // The legacy build runs a fake worker on the main thread in Node;
    // setting workerSrc to '' would break that, so leave it unset.
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs')
  }
  return pdfjsPromise
}

export interface ExtractedPdf {
  text: string
  pageCount: number
  scanned: boolean
  error?: string
}

export async function fetchPdf(url: string, destPath: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'WorkBoard/0.1 (research app)' }
  })
  if (!res.ok) throw new Error(`Failed to fetch PDF: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(path.dirname(destPath), { recursive: true })
  fs.writeFileSync(destPath, buf)
}

export async function extractTextFromPdf(pdfPath: string, opts: { maxChars?: number } = {}): Promise<ExtractedPdf> {
  const maxChars = opts.maxChars ?? 1_500_000
  try {
    const pdfjs = await getPdfjs()
    const buf = new Uint8Array(fs.readFileSync(pdfPath))
    const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise
    const pageCount = doc.numPages
    let text = ''
    let scanned = true
    for (let i = 1; i <= pageCount; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items
        .map((it: any) => ('str' in it ? it.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (pageText.length > 40) scanned = false
      text += pageText + '\n\n'
      if (text.length > maxChars) {
        text = text.slice(0, maxChars)
        break
      }
    }
    await doc.destroy()
    return { text: text.trim(), pageCount, scanned }
  } catch (e: any) {
    return { text: '', pageCount: 0, scanned: true, error: e?.message ?? String(e) }
  }
}

export function abstractOnlyResult(): ExtractedPdf {
  return { text: '', pageCount: 0, scanned: true }
}

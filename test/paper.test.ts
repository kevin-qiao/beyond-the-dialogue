import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { classifyLink, resolvePaper } from '../src/main/paper/resolve'
import { extractTextFromPdf } from '../src/main/paper/pdf'

test('5.2 resolvePaper resolves a real arXiv link (network)', { timeout: 30000 }, async () => {
  const res = await resolvePaper('https://arxiv.org/abs/2301.00001')
  if ('kind' in res) {
    // network may be unavailable in CI; skip gracefully
    console.log('skip: network unavailable:', res.message)
    return
  }
  assert.equal(res.source, 'arxiv')
  assert.equal(res.level, 'full')
  assert.ok(res.title.length > 0)
  assert.ok(res.abstract.length > 0)
  assert.ok(res.pdfUrl)
})

test('5.2 paywalled/unresolvable link degrades to an error, not a crash', { timeout: 30000 }, async () => {
  const res = await resolvePaper('https://doi.org/10.1038/nonexistent-doi-99999')
  assert.ok('kind' in res)
})

test('5.3 extractTextFromPdf on a real arXiv PDF', { timeout: 30000 }, async () => {
  // fetch the PDF first
  const url = 'https://arxiv.org/pdf/2301.00001.pdf'
  const dest = path.join(os.tmpdir(), 'wb-test-paper.pdf')
  const res = await fetch(url)
  if (!res.ok) {
    console.log('skip: cannot fetch PDF')
    return
  }
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
  const ext = await extractTextFromPdf(dest)
  assert.ok(ext.pageCount >= 1, `expected pages, got ${ext.pageCount}`)
  assert.equal(ext.scanned, false)
  assert.ok(ext.text.length > 500, 'expected substantial extracted text')
})

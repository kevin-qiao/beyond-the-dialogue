import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyLink, isPaperLink } from '../src/shared/link'

test('classifyLink: arxiv forms', () => {
  assert.deepEqual(classifyLink('https://arxiv.org/abs/2301.00001'), { type: 'arxiv', id: '2301.00001' })
  assert.deepEqual(classifyLink('https://arxiv.org/pdf/2301.00001v2'), { type: 'arxiv', id: '2301.00001v2' })
  assert.deepEqual(classifyLink('2301.00001'), { type: 'arxiv', id: '2301.00001' })
})

test('classifyLink: doi and meta', () => {
  assert.deepEqual(classifyLink('https://doi.org/10.1038/s41586-024-00000-0'), {
    type: 'doi',
    id: '10.1038/s41586-024-00000-0'
  })
  assert.equal(classifyLink('10.1038/s41586-024-00000-0').type, 'doi')
  assert.equal(classifyLink('https://publisher.org/paper').type, 'meta')
  assert.equal(classifyLink('not a link').type, 'unknown')
  assert.equal(classifyLink('').type, 'unknown')
})

test('isPaperLink: accepts resolvable inputs, rejects plain text', () => {
  assert.equal(isPaperLink('https://arxiv.org/abs/2301.00001'), true)
  assert.equal(isPaperLink('2301.00001'), true)
  assert.equal(isPaperLink('10.1038/s41586-024-00000-0'), true)
  assert.equal(isPaperLink('https://publisher.org/paper'), true)
  assert.equal(isPaperLink('Write a report on attention'), false)
  assert.equal(isPaperLink(''), false)
})

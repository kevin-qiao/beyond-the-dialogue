import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ATTACHMENT_BYTES,
  checkAttachment,
  isRelativeStoredPath,
  storedRelativePath
} from '../src/core/domain/attachment'

// The pure attachment rules (feature 001 T014, FR-002/FR-003/FR-021). The
// refusal codes are what cross IPC — the adapter does the copying, the domain
// decides.

test('checkAttachment: a readable file within the cap is accepted', () => {
  assert.deepEqual(checkAttachment({ size: 1024, readable: true }), [])
  assert.deepEqual(checkAttachment({ size: MAX_ATTACHMENT_BYTES, readable: true }), [])
})

test('checkAttachment: over-cap refuses with the stated limit (data-model edge case)', () => {
  const issues = checkAttachment({ size: MAX_ATTACHMENT_BYTES + 1, readable: true })
  assert.equal(issues.length, 1)
  assert.equal(issues[0]!.key, 'attachment.tooLarge')
  assert.ok(issues[0]!.params?.limit, 'the refusal states its reason')
})

test('checkAttachment: an unreadable source refuses with a reason, and unreadability outranks size', () => {
  const issues = checkAttachment({ size: MAX_ATTACHMENT_BYTES + 1, readable: false })
  assert.deepEqual(issues, [{ key: 'attachment.unreadable' }])
})

test('storedRelativePath: relative to the data-folder root only (FR-021)', () => {
  assert.equal(storedRelativePath('a1', 'paper.pdf'), 'attachments/a1/paper.pdf')
  // Only the final segment is kept, whichever separator the source used.
  assert.equal(storedRelativePath('a1', '/home/u/Downloads/paper.pdf'), 'attachments/a1/paper.pdf')
  assert.equal(storedRelativePath('a1', 'C:\\Users\\u\\Downloads\\paper.pdf'), 'attachments/a1/paper.pdf')
})

test('storedRelativePath: a name with no usable segment is refused, never stored', () => {
  // A deliberate absolute path cannot be made a stored value: the refusal is
  // the point — an absolute path anywhere in the board store breaks the
  // folder-copy promise silently.
  assert.equal(storedRelativePath('a1', '/etc/passwd/'), null)
  assert.equal(storedRelativePath('a1', ''), null)
  assert.equal(storedRelativePath('a1', 'C:\\'), null)
  assert.equal(storedRelativePath('', 'x.txt'), null)
})

test('isRelativeStoredPath: the rule the portability scan uses (T040, D6)', () => {
  assert.equal(isRelativeStoredPath('attachments/a1/paper.pdf'), true)
  assert.equal(isRelativeStoredPath('/home/u/attachments/a1/paper.pdf'), false)
  assert.equal(isRelativeStoredPath('C:\\Users\\u\\attachments\\a1\\paper.pdf'), false)
  assert.equal(isRelativeStoredPath('attachments/../../escape'), false)
  assert.equal(isRelativeStoredPath(''), false)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractAttachmentRefs, extractMessageText } from '../src/lib/attachments.js'

// ── extractMessageText ──

test('text message: resolves mention keys to names', () => {
  const content = JSON.stringify({ text: '@_user_1 please deploy' })
  const text = extractMessageText('text', content, [{ key: '@_user_1', name: 'Abi' }])
  assert.equal(text, '@Abi please deploy')
})

test('text message: malformed JSON falls back to the raw content', () => {
  assert.equal(extractMessageText('text', 'not json', []), 'not json')
})

test('post message: renders title, text runs, links, mentions and attachment placeholders', () => {
  const content = JSON.stringify({
    title: 'Question',
    content: [
      [{ tag: 'text', text: 'what animal is this ' }, { tag: 'at', user_id: 'ou_bot', user_name: 'Abi' }],
      [{ tag: 'img', image_key: 'img_v2_cat' }],
      [{ tag: 'a', text: 'docs', href: 'https://example.com' }]
    ]
  })
  const text = extractMessageText('post', content, [])
  assert.equal(text, 'Question\nwhat animal is this @Abi\n[image]\ndocs (https://example.com)')
})

test('post message: tolerates the locale-wrapped shape', () => {
  const content = JSON.stringify({ en_us: { title: 'Hi', content: [[{ tag: 'text', text: 'hello' }]] } })
  assert.equal(extractMessageText('post', content, []), 'Hi\nhello')
})

test('attachment-only messages render readable placeholders instead of raw JSON', () => {
  assert.equal(extractMessageText('image', JSON.stringify({ image_key: 'img_1' }), []), '[image]')
  assert.equal(extractMessageText('file', JSON.stringify({ file_key: 'file_1', file_name: 'report.pdf' }), []), '[file: report.pdf]')
  assert.equal(extractMessageText('media', JSON.stringify({ file_key: 'file_2', file_name: 'demo.mp4', image_key: 'img_cover' }), []), '[video: demo.mp4]')
  assert.equal(extractMessageText('audio', JSON.stringify({ file_key: 'file_3', duration: 1200 }), []), '[audio]')
  assert.equal(extractMessageText('sticker', JSON.stringify({ file_key: 'stk_1' }), []), '[sticker]')
})

test('unknown message types keep the JSON fallback', () => {
  const content = JSON.stringify({ foo: 'bar' })
  assert.equal(extractMessageText('share_chat', content, []), content)
})

// ── extractAttachmentRefs ──

test('image message yields one image ref', () => {
  assert.deepEqual(extractAttachmentRefs('image', JSON.stringify({ image_key: 'img_1' })), [
    { key: 'img_1', type: 'image', name: undefined }
  ])
})

test('file and media messages yield file refs with the original name; the media cover image is skipped', () => {
  assert.deepEqual(extractAttachmentRefs('file', JSON.stringify({ file_key: 'file_1', file_name: 'report.pdf' })), [
    { key: 'file_1', type: 'file', name: 'report.pdf' }
  ])
  assert.deepEqual(extractAttachmentRefs('media', JSON.stringify({ file_key: 'file_2', file_name: 'demo.mp4', image_key: 'img_cover' })), [
    { key: 'file_2', type: 'file', name: 'demo.mp4' }
  ])
})

test('post message yields refs for img and media nodes across rows', () => {
  const content = JSON.stringify({
    title: '',
    content: [
      [{ tag: 'text', text: 'two pics' }, { tag: 'img', image_key: 'img_a' }],
      [{ tag: 'img', image_key: 'img_b' }, { tag: 'media', file_key: 'file_v', file_name: 'clip.mp4' }]
    ]
  })
  assert.deepEqual(extractAttachmentRefs('post', content), [
    { key: 'img_a', type: 'image', name: undefined },
    { key: 'img_b', type: 'image', name: undefined },
    { key: 'file_v', type: 'file', name: 'clip.mp4' }
  ])
})

test('duplicate keys are deduped and stickers/text yield no refs', () => {
  const content = JSON.stringify({ content: [[{ tag: 'img', image_key: 'img_a' }, { tag: 'img', image_key: 'img_a' }]] })
  assert.equal(extractAttachmentRefs('post', content).length, 1)
  assert.deepEqual(extractAttachmentRefs('sticker', JSON.stringify({ file_key: 'stk_1' })), [])
  assert.deepEqual(extractAttachmentRefs('text', JSON.stringify({ text: 'hi' })), [])
  assert.deepEqual(extractAttachmentRefs('image', 'not json'), [])
})

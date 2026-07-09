import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applySubscriptionPatch, createLineDecoder, encodeFrame, matchesStreamFilter } from '../src/lib/watcherGateway.js'
import { MessageEventRecord, MessageSubscription } from '../src/types/events.js'

function makeRecord(overrides: Partial<MessageEventRecord> = {}): MessageEventRecord {
  return {
    receivedAt: '2026-07-10T00:00:00.000Z',
    subscriptionIds: ['sub_a'],
    chatId: 'oc_1',
    chatType: 'group',
    messageId: 'om_1',
    messageType: 'text',
    text: 'hello',
    content: '{"text":"hello"}',
    senderType: 'user',
    mentionedBot: false,
    mentions: [],
    createTime: '1752105600000',
    ...overrides
  }
}

test('line decoder reassembles frames split across chunks', () => {
  const decoder = createLineDecoder()
  assert.deepEqual(decoder.push('{"a"'), [])
  assert.deepEqual(decoder.push(':1}\n{"b":2}\n{"c"'), ['{"a":1}', '{"b":2}'])
  assert.deepEqual(decoder.push(':3}\n'), ['{"c":3}'])
  assert.equal(decoder.overflowed, false)
})

test('line decoder is UTF-8 safe across chunk boundaries', () => {
  const decoder = createLineDecoder()
  const bytes = Buffer.from('{"text":"héllo"}\n')
  const splitAt = bytes.indexOf(0xc3) + 1 // mid multi-byte char
  decoder.push(bytes.subarray(0, splitAt))
  const lines = decoder.push(bytes.subarray(splitAt))
  assert.deepEqual(lines, ['{"text":"héllo"}'])
})

test('line decoder flags oversized lines', () => {
  const decoder = createLineDecoder(16)
  assert.deepEqual(decoder.push('x'.repeat(32)), [])
  assert.equal(decoder.overflowed, true)
})

test('encodeFrame emits one newline-terminated JSON line', () => {
  assert.equal(encodeFrame({ v: 1, id: 'c1' }), '{"v":1,"id":"c1"}\n')
})

test('subscription patch: set, clear, omit', () => {
  const subscription: MessageSubscription = {
    id: 'sub_a',
    chatId: 'oc_1',
    keywords: ['deploy'],
    webhookUrl: 'http://localhost:9999/hook',
    onEventCommand: 'echo hi',
    createdAt: '2026-07-10T00:00:00.000Z'
  }
  const updated = applySubscriptionPatch(subscription, {
    keywords: ['deploy', 'release'], // set
    webhookUrl: null, // clear
    mentionBot: true // set a previously-absent field
    // chatId / onEventCommand omitted → unchanged
  })
  assert.equal(updated.id, 'sub_a')
  assert.equal(updated.chatId, 'oc_1')
  assert.equal(updated.onEventCommand, 'echo hi')
  assert.deepEqual(updated.keywords, ['deploy', 'release'])
  assert.equal(updated.mentionBot, true)
  assert.equal('webhookUrl' in updated, false)
  // Original untouched
  assert.equal(subscription.webhookUrl, 'http://localhost:9999/hook')
})

test('stream filter: deliver matched (default) requires a matched subscription', () => {
  assert.equal(matchesStreamFilter({}, makeRecord()), true)
  assert.equal(matchesStreamFilter({}, makeRecord({ subscriptionIds: [] })), false)
  assert.equal(matchesStreamFilter({ deliver: 'all' }, makeRecord({ subscriptionIds: [] })), true)
})

test('stream filter: chatId, subscriptionId, mentionedBot narrowing', () => {
  const record = makeRecord({ subscriptionIds: ['sub_a', 'sub_b'], mentionedBot: true })
  assert.equal(matchesStreamFilter({ chatId: 'oc_1' }, record), true)
  assert.equal(matchesStreamFilter({ chatId: 'oc_2' }, record), false)
  assert.equal(matchesStreamFilter({ subscriptionId: 'sub_b' }, record), true)
  assert.equal(matchesStreamFilter({ subscriptionId: 'sub_c' }, record), false)
  assert.equal(matchesStreamFilter({ mentionedBot: true }, record), true)
  assert.equal(matchesStreamFilter({ mentionedBot: false }, record), false)
  assert.equal(matchesStreamFilter({ mentionedBot: false }, makeRecord()), true)
})

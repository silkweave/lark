import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { addPendingAck, listPendingAcks, PendingAck, takePendingAckByUserMessage, takePendingAcks, takeStalePendingAcks } from '../src/lib/pendingAcks.js'

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), 'acks-'))
  return { dir, path: join(dir, 'pending-acks.json') }
}

function ack(chatId: string, n: number, createdAt = new Date().toISOString()): PendingAck {
  return { chatId, userMessageId: `um_${n}`, ackMessageId: `om_${n}`, createdAt }
}

test('add + list round-trips entries', () => {
  const { dir, path } = tempStore()
  addPendingAck(ack('oc_a', 1), path)
  addPendingAck(ack('oc_b', 2), path)
  assert.deepEqual(listPendingAcks(path).map((a) => a.ackMessageId), ['om_1', 'om_2'])
  assert.throws(() => statSync(`${path}.lock`)) // lock released
  rmSync(dir, { recursive: true, force: true })
})

test('takePendingAcks removes and returns only the chat\'s entries', () => {
  const { dir, path } = tempStore()
  addPendingAck(ack('oc_a', 1), path)
  addPendingAck(ack('oc_b', 2), path)
  addPendingAck(ack('oc_a', 3), path)
  const taken = takePendingAcks('oc_a', path)
  assert.deepEqual(taken.map((a) => a.ackMessageId), ['om_1', 'om_3'])
  assert.deepEqual(listPendingAcks(path).map((a) => a.ackMessageId), ['om_2'])
  assert.deepEqual(takePendingAcks('oc_a', path), []) // idempotent once taken
  rmSync(dir, { recursive: true, force: true })
})

test('takePendingAckByUserMessage takes the exact match and leaves the rest', () => {
  const { dir, path } = tempStore()
  addPendingAck(ack('oc_a', 1), path)
  addPendingAck(ack('oc_a', 2), path)
  const taken = takePendingAckByUserMessage('um_2', path)
  assert.equal(taken?.ackMessageId, 'om_2')
  assert.deepEqual(listPendingAcks(path).map((a) => a.ackMessageId), ['om_1'])
  assert.equal(takePendingAckByUserMessage('um_2', path), undefined)
  rmSync(dir, { recursive: true, force: true })
})

test('takeStalePendingAcks removes only entries older than maxAge', () => {
  const { dir, path } = tempStore()
  const old = new Date(Date.now() - 60_000).toISOString()
  addPendingAck(ack('oc_a', 1, old), path)
  addPendingAck(ack('oc_a', 2), path)
  const stale = takeStalePendingAcks(30_000, path)
  assert.deepEqual(stale.map((a) => a.ackMessageId), ['om_1'])
  assert.deepEqual(listPendingAcks(path).map((a) => a.ackMessageId), ['om_2'])
  rmSync(dir, { recursive: true, force: true })
})

test('missing or corrupt store reads as empty', () => {
  const { dir, path } = tempStore()
  assert.deepEqual(listPendingAcks(path), [])
  assert.deepEqual(takePendingAcks('oc_a', path), [])
  rmSync(dir, { recursive: true, force: true })
})

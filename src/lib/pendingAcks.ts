import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { withFileLock } from './fileLock.js'

/**
 * Cross-process registry of in-flight processing-indicator cards (see src/lib/indicator.ts).
 * The reflex registers a card here when it hands a task off to the heavy workload; whichever process
 * later replies in that chat (ImMessageSend/ImMessageReply from the MCP server, CLI, or a spawned
 * onEventCommand) takes the entries and morphs the cards into their final state. The watcher sweeps
 * stale entries on its heartbeat so an indicator never outlives a workload that died without replying.
 */
export const PENDING_ACKS_PATH = join(homedir(), '.silkweave-lark.pending-acks.json')

export interface PendingAck {
  chatId: string
  /** The user message that triggered the indicator */
  userMessageId: string
  /** The indicator card message to morph into its final state once processed */
  ackMessageId: string
  createdAt: string
}

function read(storePath: string): PendingAck[] {
  if (!existsSync(storePath)) { return [] }
  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf-8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** All writes go through here: re-read under the file lock, transform, atomic-write (temp + rename) — the registry is multi-writer. */
function mutate(storePath: string, fn: (entries: PendingAck[]) => PendingAck[]): PendingAck[] {
  let result: PendingAck[] = []
  withFileLock(storePath, () => {
    result = fn(read(storePath))
    const tmpPath = `${storePath}.${process.pid}.tmp`
    writeFileSync(tmpPath, JSON.stringify(result, null, 2))
    renameSync(tmpPath, storePath)
  })
  return result
}

export function addPendingAck(ack: PendingAck, storePath = PENDING_ACKS_PATH): void {
  mutate(storePath, (entries) => [...entries, ack])
}

export function listPendingAcks(storePath = PENDING_ACKS_PATH): PendingAck[] {
  return read(storePath)
}

/** Remove and return the pending ack whose indicator replied to this user message — the caller morphs the card into the reply. */
export function takePendingAckByUserMessage(userMessageId: string, storePath = PENDING_ACKS_PATH): PendingAck | undefined {
  let taken: PendingAck | undefined
  mutate(storePath, (entries) => {
    taken = entries.find((e) => e.userMessageId === userMessageId)
    return entries.filter((e) => e.userMessageId !== userMessageId)
  })
  return taken
}

/** Remove and return every pending ack for a chat — the caller resolves the cards. */
export function takePendingAcks(chatId: string, storePath = PENDING_ACKS_PATH): PendingAck[] {
  let taken: PendingAck[] = []
  mutate(storePath, (entries) => {
    taken = entries.filter((e) => e.chatId === chatId)
    return entries.filter((e) => e.chatId !== chatId)
  })
  return taken
}

/** Remove and return every pending ack older than maxAgeMs — the watcher's heartbeat sweep resolves them. */
export function takeStalePendingAcks(maxAgeMs: number, storePath = PENDING_ACKS_PATH): PendingAck[] {
  const cutoff = Date.now() - maxAgeMs
  let taken: PendingAck[] = []
  mutate(storePath, (entries) => {
    taken = entries.filter((e) => new Date(e.createdAt).getTime() <= cutoff)
    return entries.filter((e) => new Date(e.createdAt).getTime() > cutoff)
  })
  return taken
}

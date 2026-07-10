import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { HistoryEntry } from '../types/events.js'

/** Shared, cross-process rolling chat history — every inbound message, reflex reply, and agent reply is appended here (all processes: lark-serve, the MCP server, the CLI) so context can be reconstructed regardless of who is asking. */
export const HISTORY_PATH = join(homedir(), '.silkweave-lark.history.jsonl')

const MAX_LINES = 4000
const TRIM_TO = 1500
const TRIM_EVERY = 200

let writesSinceTrim = 0

export function appendHistory(entry: HistoryEntry): void {
  appendFileSync(HISTORY_PATH, JSON.stringify(entry) + '\n')
  writesSinceTrim++
  if (writesSinceTrim >= TRIM_EVERY) {
    writesSinceTrim = 0
    trimHistory()
  }
}

function trimHistory(): void {
  if (!existsSync(HISTORY_PATH)) { return }
  const lines = readFileSync(HISTORY_PATH, 'utf-8').split('\n').filter(Boolean)
  if (lines.length > MAX_LINES) {
    writeFileSync(HISTORY_PATH, lines.slice(-TRIM_TO).join('\n') + '\n')
  }
}

/** Most recent `limit` history entries for a chat, oldest first */
export function readHistory(chatId: string, limit: number): HistoryEntry[] {
  if (!existsSync(HISTORY_PATH)) { return [] }
  const lines = readFileSync(HISTORY_PATH, 'utf-8').split('\n').filter(Boolean)
  const entries: HistoryEntry[] = []
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    try {
      const entry = JSON.parse(lines[i]) as HistoryEntry
      if (entry.chatId === chatId) { entries.push(entry) }
    } catch {
      // skip malformed line
    }
  }
  return entries.reverse()
}

/** Render a chronological, role-labeled transcript for LLM/agent context, noting direct replies where the parent is in range */
export function formatHistory(entries: HistoryEntry[]): string {
  const byId = new Map(entries.map((e) => [e.messageId, e]))
  return entries.map((e) => {
    const who = e.role === 'user' ? `user:${e.senderOpenId ?? 'unknown'}` : e.role
    const parent = e.parentId ? byId.get(e.parentId) : undefined
    const replyNote = parent ? ` (replying to "${parent.text.slice(0, 60)}")` : ''
    const attachmentNote = e.attachments?.length ? ` [attached: ${e.attachments.map((a) => a.path).join(', ')}]` : ''
    return `[${new Date(Number(e.createTime)).toISOString()}] ${who}${replyNote}: ${e.text}${attachmentNote}`
  }).join('\n')
}

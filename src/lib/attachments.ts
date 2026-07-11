import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { MessageAttachment } from '../types/events.js'
import { ATTACHMENTS_DIR } from './paths.js'

/**
 * Attachment sideloading: message resources (images, files, media, audio — including images inside
 * rich-text `post` messages) are downloaded by the watcher to local disk so delegated agents can read
 * them directly (e.g. `Read /path/to/image.png` to answer "what animal is this?"). Sideloaded copies
 * land in ATTACHMENTS_DIR/<messageId>/ and are referenced from the event record
 * (`event.attachments`), the shared history log, the webhook payload, and `LARK_ATTACHMENTS_JSON`.
 * The watcher's heartbeat sweeps message directories older than the retention window.
 */

const LARK_BASE = 'https://open.larksuite.com/open-apis'
/** Sideloaded copies older than this are removed by the watcher's sweep — attachments are working files, not an archive. */
export const ATTACHMENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
/** The watcher heartbeat runs the sweep at most this often. */
export const ATTACHMENT_SWEEP_INTERVAL_MS = 60 * 60 * 1000
/** Resources larger than this (per Content-Length) are skipped rather than buffered. */
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024

const log = {
  error: (...msg: unknown[]) => console.error('[lark-attachments]', ...msg)
}

/** A downloadable resource referenced by a message, before it is sideloaded. `type` selects the download endpoint's query param. */
export interface AttachmentRef {
  key: string
  type: 'image' | 'file'
  /** Original file name where the message carries one (file/media messages, post media nodes) */
  name?: string
}

/** One node of a rich-text `post` message's content grid (only the fields we read) */
interface PostNode {
  tag?: string
  text?: string
  href?: string
  user_id?: string
  user_name?: string
  emoji_type?: string
  image_key?: string
  file_key?: string
  file_name?: string
}

interface PostContent {
  title?: string
  content?: PostNode[][]
}

/** im.message.receive_v1 delivers post content as { title, content } — but tolerate the locale-wrapped send shape too. */
function parsePost(parsed: Record<string, unknown>): PostContent | undefined {
  if (Array.isArray(parsed.content)) { return parsed }
  for (const value of Object.values(parsed)) {
    if (value && typeof value === 'object' && Array.isArray((value as PostContent).content)) { return value }
  }
  return undefined
}

function postNodeText(node: PostNode): string {
  switch (node.tag) {
    case 'text': return node.text ?? ''
    case 'a': return node.href ? `${node.text ?? node.href} (${node.href})` : node.text ?? ''
    case 'at': return `@${node.user_name ?? node.user_id ?? 'user'}`
    case 'emotion': return node.emoji_type ? `[${node.emoji_type}]` : ''
    case 'img': return '[image]'
    case 'media': return node.file_name ? `[video: ${node.file_name}]` : '[video]'
    default: return node.text ?? ''
  }
}

/**
 * Plain-text rendering of a message's content for history/classification: real text for `text`/`post`
 * (attachments become inline placeholders), readable placeholders for attachment-only types, and the
 * raw JSON fallback for anything unknown. Mention placeholder keys are resolved to `@Name`.
 */
export function extractMessageText(messageType: string, rawContent: string, mentions: { key: string; name: string }[]): string {
  let text: string
  try {
    const parsed = JSON.parse(rawContent) as Record<string, unknown>
    switch (messageType) {
      case 'post': {
        const post = parsePost(parsed)
        const rows = (post?.content ?? []).map((row) => row.map(postNodeText).join('')).filter((row) => row.trim())
        text = [post?.title, ...rows].filter(Boolean).join('\n')
        break
      }
      case 'image': text = '[image]'; break
      case 'file': text = typeof parsed.file_name === 'string' ? `[file: ${parsed.file_name}]` : '[file]'; break
      case 'media': text = typeof parsed.file_name === 'string' ? `[video: ${parsed.file_name}]` : '[video]'; break
      case 'audio': text = '[audio]'; break
      case 'sticker': text = '[sticker]'; break
      default: text = typeof parsed.text === 'string' ? parsed.text : JSON.stringify(parsed)
    }
  } catch {
    return rawContent
  }
  for (const mention of mentions) {
    text = text.replaceAll(mention.key, `@${mention.name}`)
  }
  return text
}

/** Downloadable resources referenced by a message's content. Stickers are excluded (not served by the resources endpoint). */
export function extractAttachmentRefs(messageType: string, rawContent: string): AttachmentRef[] {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawContent) as Record<string, unknown>
  } catch {
    return []
  }
  const refs: AttachmentRef[] = []
  const add = (key: unknown, type: AttachmentRef['type'], name?: unknown) => {
    if (typeof key === 'string' && key && !refs.some((r) => r.key === key)) {
      refs.push({ key, type, name: typeof name === 'string' && name ? name : undefined })
    }
  }
  switch (messageType) {
    case 'image': add(parsed.image_key, 'image'); break
    case 'file': add(parsed.file_key, 'file', parsed.file_name); break
    case 'media': add(parsed.file_key, 'file', parsed.file_name); break // the cover image_key is skipped — the video is the payload
    case 'audio': add(parsed.file_key, 'file'); break
    case 'post': {
      for (const node of (parsePost(parsed)?.content ?? []).flat()) {
        if (node.tag === 'img') { add(node.image_key, 'image') }
        if (node.tag === 'media') { add(node.file_key, 'file', node.file_name) }
      }
      break
    }
  }
  return refs
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'audio/opus': '.opus',
  'audio/ogg': '.ogg',
  'application/pdf': '.pdf'
}

function attachmentFileName(ref: AttachmentRef, index: number, mimeType: string, used: Set<string>): string {
  // basename() + dot-strip so a hostile file_name can't escape the message directory or hide the file
  let name = ref.name ? basename(ref.name).replace(/^\.+/, '') : ''
  if (!name) { name = `${ref.type}-${index + 1}${EXT_BY_MIME[mimeType] ?? '.bin'}` }
  if (used.has(name)) { name = `${index + 1}-${name}` }
  used.add(name)
  return name
}

/**
 * Download each referenced resource via GET /im/v1/messages/:messageId/resources/:key (tenant token;
 * requires the `im:resource` app permission) into ATTACHMENTS_DIR/<messageId>/. Best-effort per
 * attachment — failures are logged and skipped, never thrown.
 */
export async function sideloadAttachments(token: string, messageId: string, refs: AttachmentRef[]): Promise<MessageAttachment[]> {
  const results: MessageAttachment[] = []
  const used = new Set<string>()
  for (const [index, ref] of refs.entries()) {
    try {
      const response = await fetch(`${LARK_BASE}/im/v1/messages/${messageId}/resources/${ref.key}?type=${ref.type}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const mimeType = (response.headers.get('content-type') ?? '').split(';')[0].trim()
      // The resources endpoint returns binary on success — a JSON body is a Lark error envelope regardless of status
      if (!response.ok || mimeType === 'application/json') {
        const detail = mimeType === 'application/json' ? JSON.stringify(await response.json()) : `HTTP ${response.status}`
        log.error(`download failed for ${ref.type} ${ref.key} of ${messageId}:`, detail)
        continue
      }
      const declaredSize = Number(response.headers.get('content-length') ?? 0)
      if (declaredSize > MAX_ATTACHMENT_BYTES) {
        log.error(`skipping ${ref.key} of ${messageId}: ${declaredSize} bytes exceeds the ${MAX_ATTACHMENT_BYTES}-byte sideload cap`)
        continue
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      const dir = join(ATTACHMENTS_DIR, messageId)
      mkdirSync(dir, { recursive: true })
      const name = attachmentFileName(ref, index, mimeType, used)
      const path = join(dir, name)
      writeFileSync(path, bytes)
      results.push({ key: ref.key, type: ref.type, name, path, size: bytes.length, mimeType: mimeType || undefined })
    } catch (error) {
      log.error(`download error for ${ref.key} of ${messageId}:`, (error as Error).message)
    }
  }
  return results
}

/** Remove per-message attachment directories older than the retention window. Returns how many were removed. */
export function sweepAttachments(maxAgeMs = ATTACHMENT_RETENTION_MS): number {
  if (!existsSync(ATTACHMENTS_DIR)) { return 0 }
  const cutoff = Date.now() - maxAgeMs
  let removed = 0
  for (const entry of readdirSync(ATTACHMENTS_DIR)) {
    const dir = join(ATTACHMENTS_DIR, entry)
    try {
      if (statSync(dir).mtimeMs <= cutoff) {
        rmSync(dir, { recursive: true, force: true })
        removed++
      }
    } catch {
      // raced with another sweep or manual cleanup — fine
    }
  }
  return removed
}

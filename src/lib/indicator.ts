import { TENANT_USER_ID, TokenClient } from '../classes/TokenClient.js'
import { INDICATOR_ASSET_VERSION, INDICATOR_GIF_BASE64 } from './indicatorAsset.js'
import { takePendingAckByUserMessage, takePendingAcks } from './pendingAcks.js'

/**
 * The processing indicator: a minimal single-line note card (animated spinner + muted text) sent as a
 * reply to the triggering message the instant the reflex picks it up. It is never recalled — Lark shows
 * a "<bot> recalled a message." tombstone for recalls — instead it is always PATCHED into its final
 * state: the bot's first text reply morphs the card into the reply itself (resolveIndicatorWithReply),
 * other replies resolve it to a muted "done" note (clearPendingIndicators), and the watcher's stale
 * sweep resolves abandoned cards to a "no response" note.
 */

const LARK_BASE = 'https://open.larksuite.com/open-apis'

export const INDICATOR_TEXT = 'Working on it — I\'ll reply here when done.'
/** Final state when the real reply landed elsewhere (non-text reply, or a send not tied to the trigger message) */
export const RESOLVED_TEXT = '✓ Done — see the reply below.'
/** Final state for a mistaken/passing mention the bot decided not to answer */
export const IGNORED_TEXT = '👍'
/** Final state applied by the watcher's stale sweep when no reply ever arrived */
export const STALE_TEXT = '✕ No response — the task may have failed.'

const log = {
  error: (...msg: unknown[]) => console.error('[lark-indicator]', ...msg)
}

interface LarkResult {
  code?: number
  msg?: string
  data?: Record<string, unknown>
}

async function larkFetch(token: string, method: string, path: string, body?: unknown): Promise<LarkResult> {
  const response = await fetch(`${LARK_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  })
  return await response.json() as LarkResult
}

/** The in-flight look: spinner icon + muted single-line note */
export function buildIndicatorCard(imageKey: string, text = INDICATOR_TEXT) {
  return {
    config: { wide_screen_mode: false },
    elements: [
      {
        tag: 'note',
        elements: [
          { tag: 'img', img_key: imageKey, alt: { tag: 'plain_text', content: 'working' } },
          { tag: 'plain_text', content: text }
        ]
      }
    ]
  }
}

/** A resolved end state: muted single-line note, no spinner */
export function buildNoteCard(text: string) {
  return {
    config: { wide_screen_mode: false },
    elements: [{ tag: 'note', elements: [{ tag: 'plain_text', content: text }] }]
  }
}

/** The morphed-into-the-reply end state: regular message text */
export function buildReplyCard(text: string) {
  return {
    config: { wide_screen_mode: false },
    elements: [{ tag: 'div', text: { tag: 'lark_md', content: text } }]
  }
}

/** Upload the embedded spinner GIF once and cache its image_key in ~/.silkweave-lark.json, keyed by asset version. */
async function ensureIndicatorImageKey(client: TokenClient): Promise<string | undefined> {
  const cached = client.getWatcherConfig().indicatorImage
  if (cached?.assetVersion === INDICATOR_ASSET_VERSION) { return cached.imageKey }
  const form = new FormData()
  form.append('image_type', 'message')
  form.append('image', new Blob([Buffer.from(INDICATOR_GIF_BASE64, 'base64')], { type: 'image/gif' }), 'indicator.gif')
  const response = await fetch(`${LARK_BASE}/im/v1/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${client.tenantToken}` },
    body: form
  })
  const json = await response.json() as LarkResult
  const imageKey = json.data?.image_key
  if (json.code !== 0 || typeof imageKey !== 'string') {
    log.error('spinner upload failed:', json.msg ?? JSON.stringify(json))
    return undefined
  }
  client.setWatcherConfig({ indicatorImage: { imageKey, assetVersion: INDICATOR_ASSET_VERSION } })
  return imageKey
}

/** Reply to the triggering message with the indicator card. Best-effort — returns the card's message_id, or undefined. */
export async function sendIndicatorCard(client: TokenClient, messageId: string): Promise<string | undefined> {
  try {
    const imageKey = await ensureIndicatorImageKey(client)
    if (!imageKey) { return undefined }
    const result = await larkFetch(client.tenantToken!, 'POST', `/im/v1/messages/${messageId}/reply`, {
      msg_type: 'interactive',
      content: JSON.stringify(buildIndicatorCard(imageKey))
    })
    if (result.code !== 0) { log.error('indicator send failed:', result.msg ?? JSON.stringify(result)); return undefined }
    const cardId = result.data?.message_id
    return typeof cardId === 'string' ? cardId : undefined
  } catch (error) {
    log.error('indicator send error:', (error as Error).message)
    return undefined
  }
}

/** Replace the card's content in place. Best-effort — returns whether the patch landed. */
async function patchCard(token: string, ackMessageId: string, card: unknown): Promise<boolean> {
  try {
    const result = await larkFetch(token, 'PATCH', `/im/v1/messages/${ackMessageId}`, { content: JSON.stringify(card) })
    if (result.code !== 0) { log.error('indicator patch failed:', result.msg ?? JSON.stringify(result)); return false }
    return true
  } catch (error) {
    log.error('indicator patch error:', (error as Error).message)
    return false
  }
}

/** Update the in-flight card's text (e.g. to the classifier's task-specific acknowledgement), keeping the spinner. Best-effort. */
export async function patchIndicatorCard(client: TokenClient, ackMessageId: string, text: string): Promise<void> {
  const imageKey = await ensureIndicatorImageKey(client)
  if (!imageKey) { return }
  await patchCard(client.tenantToken!, ackMessageId, buildIndicatorCard(imageKey, text))
}

/** Morph the card into a resolved end state (regular reply text, or a muted note). Best-effort — returns whether it landed. */
export async function resolveIndicatorCard(client: TokenClient, ackMessageId: string, text: string, style: 'reply' | 'note' = 'note'): Promise<boolean> {
  return patchCard(client.tenantToken!, ackMessageId, style === 'reply' ? buildReplyCard(text) : buildNoteCard(text))
}

/**
 * Morph the pending indicator card for this user message into the bot's reply text — the card becomes the
 * reply, so no extra message is sent and nothing is recalled. Returns the card's chat/message ids when it
 * morphed, or undefined when there is no matching pending card (or the patch failed) and the caller should
 * send a normal message instead.
 */
export async function resolveIndicatorWithReply(userMessageId: string, text: string): Promise<{ chatId: string; messageId: string } | undefined> {
  try {
    const ack = takePendingAckByUserMessage(userMessageId)
    if (!ack) { return undefined }
    const client = new TokenClient(TENANT_USER_ID)
    await client.assertValidTenantToken()
    if (await resolveIndicatorCard(client, ack.ackMessageId, text, 'reply')) {
      return { chatId: ack.chatId, messageId: ack.ackMessageId }
    }
    return undefined
  } catch (error) {
    log.error('resolve with reply error:', (error as Error).message)
    return undefined
  }
}

/**
 * Resolve every pending indicator card in a chat to a muted "done" note — called after the bot's real reply
 * landed somewhere the cards can't morph into (non-text reply, or a send not tied to the trigger message).
 * Best-effort: any failure leaves the remaining cards to the watcher's stale sweep.
 */
export async function clearPendingIndicators(chatId: string): Promise<void> {
  try {
    const acks = takePendingAcks(chatId)
    if (!acks.length) { return }
    const client = new TokenClient(TENANT_USER_ID)
    if (!client.clientId || !client.clientSecret) { return }
    await client.assertValidTenantToken()
    for (const ack of acks) {
      await resolveIndicatorCard(client, ack.ackMessageId, RESOLVED_TEXT)
    }
  } catch (error) {
    log.error('clear pending indicators error:', (error as Error).message)
  }
}

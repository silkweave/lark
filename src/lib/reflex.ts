import { TENANT_USER_ID, TokenClient } from '../classes/TokenClient.js'
import { HistoryEntry, MessageEventRecord, ReflexConfig } from '../types/events.js'
import { formatHistory, readHistory } from './history.js'

const LARK_BASE = 'https://open.larksuite.com/open-apis'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const DEFAULT_MODEL = 'claude-haiku-4-5'
const DEFAULT_EMOJI = 'Typing'
const DEFAULT_HISTORY_LIMIT = 15

/** Reflex logging goes to stderr — stdout is reserved for the MCP stdio protocol */
const log = {
  info: (...msg: unknown[]) => console.error('[lark-reflex]', ...msg),
  error: (...msg: unknown[]) => console.error('[lark-reflex]', ...msg)
}

export type ReflexCategory = 'trivial' | 'task' | 'ignore'

export interface ReflexOutcome {
  /** Whether the caller should still spawn the subscription onEventCommand (the heavy workload) */
  dispatch: boolean
  category?: ReflexCategory
  replied?: boolean
  /** message_id of the reflex's own reply, if one was sent — used to record it in the shared history log */
  replyMessageId?: string
  replyText?: string
}

interface ClassifyResult {
  category: ReflexCategory
  reply: string
}

interface LarkResult {
  code?: number
  msg?: string
  data?: Record<string, unknown>
}

interface AnthropicContentBlock {
  type: string
  name?: string
  input?: unknown
}

interface AnthropicResponse {
  content?: AnthropicContentBlock[]
}

async function larkFetch(token: string, method: string, path: string, body?: unknown): Promise<LarkResult> {
  const response = await fetch(`${LARK_BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined
  })
  return await response.json() as LarkResult
}

/** Add an emoji reaction to the user's message as an instant, zero-model acknowledgement. Best-effort. */
async function addReaction(token: string, messageId: string, emoji: string): Promise<string | undefined> {
  try {
    const result = await larkFetch(token, 'POST', `/im/v1/messages/${messageId}/reactions`, { reaction_type: { emoji_type: emoji } })
    if (result.code !== 0) { log.error(`reaction failed (${emoji}):`, result.msg ?? JSON.stringify(result)); return undefined }
    const reactionId = result.data?.reaction_id
    return typeof reactionId === 'string' ? reactionId : undefined
  } catch (error) {
    log.error('reaction error:', (error as Error).message)
    return undefined
  }
}

/** Remove a previously-added reaction (used when a mention turns out to be a mistaken/passing mention). Best-effort. */
async function removeReaction(token: string, messageId: string, reactionId: string): Promise<void> {
  try {
    await larkFetch(token, 'DELETE', `/im/v1/messages/${messageId}/reactions/${reactionId}`)
  } catch (error) {
    log.error('reaction removal error:', (error as Error).message)
  }
}

/** Reply to the user's message as the bot (tenant identity). Best-effort. */
async function replyText(token: string, messageId: string, text: string): Promise<string | undefined> {
  try {
    const result = await larkFetch(token, 'POST', `/im/v1/messages/${messageId}/reply`, {
      msg_type: 'text',
      content: JSON.stringify({ text })
    })
    if (result.code !== 0) { log.error('reply failed:', result.msg ?? JSON.stringify(result)); return undefined }
    const replyId = result.data?.message_id
    return typeof replyId === 'string' ? replyId : undefined
  } catch (error) {
    log.error('reply error:', (error as Error).message)
    return undefined
  }
}

function buildSystemPrompt(botName: string, playbook: string | undefined): string {
  const base = [
    `You are the fast-response dispatcher (the "reflex") for a Lark chat bot named "${botName}".`,
    'A message addressed to the bot has just arrived. Classify it into exactly one category and produce a short reply the bot will send immediately.',
    '',
    'Categories:',
    '- "trivial": a simple question you can answer correctly right now with no tools or lookups (e.g. the current time, a greeting, a fact you are certain of). Put the actual answer in "reply".',
    '- "task": the user wants the bot to do real work that needs tools, code, or investigation. Put a brief, natural acknowledgement in "reply" (e.g. "Got it — looking into this now."). A separate worker will do the actual task and follow up.',
    '- "ignore": the message only mentions the bot in passing or by mistake and is not actually asking the bot for anything (e.g. "well done setting up @Bot for us"). Leave "reply" empty.',
    '',
    'Rules: keep "reply" to one short, natural sentence. Never invent facts for a "trivial" answer — if you are not certain, treat it as a "task". When unsure between trivial and task, choose "task".'
  ]
  if (playbook?.trim()) {
    base.push('', 'Playbook / context (rules, background, and tone provided by the operator):', playbook.trim())
  }
  return base.join('\n')
}

function buildUserContent(record: MessageEventRecord, history: HistoryEntry[]): string {
  const lines = [
    `Current time (ISO 8601): ${new Date().toISOString()}`,
    `Chat: ${record.chatType}${record.chatId ? ` (${record.chatId})` : ''}`,
    `Sender open_id: ${record.senderOpenId ?? 'unknown'}`,
    `Directly @-mentioned the bot: ${record.mentionedBot}`
  ]
  if (history.length) {
    lines.push(
      '',
      `Recent chat history (oldest first, ${history.length} messages — "user:<open_id>" is a chat member, "reflex" is your own prior fast replies, "agent" is the bot's background worker replying to earlier tasks):`,
      formatHistory(history)
    )
  }
  lines.push('', 'Latest message to classify:', record.text)
  return lines.join('\n')
}

async function classify(apiKey: string, model: string, botName: string, playbook: string | undefined, record: MessageEventRecord, history: HistoryEntry[]): Promise<ClassifyResult | undefined> {
  const body = {
    model,
    max_tokens: 300,
    system: buildSystemPrompt(botName, playbook),
    messages: [{ role: 'user', content: buildUserContent(record, history) }],
    tools: [{
      name: 'classify',
      description: 'Classify the incoming message and produce the immediate reply text.',
      input_schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: {
            type: 'string',
            enum: ['trivial', 'task', 'ignore'],
            description: 'trivial = answerable now with no tools; task = needs real work; ignore = passing/mistaken mention'
          },
          reply: {
            type: 'string',
            description: 'For trivial: the actual answer. For task: a brief acknowledgement. For ignore: an empty string.'
          }
        },
        required: ['category', 'reply']
      },
      strict: true
    }],
    tool_choice: { type: 'tool', name: 'classify' }
  }
  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!response.ok) { log.error(`anthropic ${response.status}:`, await response.text()); return undefined }
    const json = await response.json() as AnthropicResponse
    const block = (json.content ?? []).find((b) => b.type === 'tool_use' && b.name === 'classify')
    if (!block?.input) { log.error('anthropic response had no classify tool_use'); return undefined }
    const input = block.input as Partial<ClassifyResult>
    if (input.category !== 'trivial' && input.category !== 'task' && input.category !== 'ignore') { return undefined }
    return { category: input.category, reply: typeof input.reply === 'string' ? input.reply : '' }
  } catch (error) {
    log.error('anthropic error:', (error as Error).message)
    return undefined
  }
}

/**
 * Reflex fast-response flow for a message addressed to the bot.
 * 1. Instantly react (zero-model "seen it") while the classifier runs in parallel.
 * 2. Classify via Haiku: trivial → answer inline; task → ack + let the caller spawn the heavy workload; ignore → say nothing (remove the reaction).
 * On any failure it falls back safe: dispatch = true, so the heavy workload still runs and the message is never silently dropped.
 */
export async function runReflex(record: MessageEventRecord, config: ReflexConfig, botName: string): Promise<ReflexOutcome> {
  const apiKey = config.apiKey
  if (!apiKey) { log.error('No Anthropic API key configured — falling back to normal dispatch'); return { dispatch: true } }
  const model = config.model || DEFAULT_MODEL
  const emoji = config.reactionEmoji || DEFAULT_EMOJI
  const historyLimit = config.historyLimit ?? DEFAULT_HISTORY_LIMIT
  const history = readHistory(record.chatId, historyLimit).filter((e) => e.messageId !== record.messageId)

  const client = new TokenClient(TENANT_USER_ID)
  try {
    await client.assertValidTenantToken()
  } catch (error) {
    log.error('tenant token error:', (error as Error).message)
    return { dispatch: true }
  }
  const token = client.tenantToken
  if (!token) { return { dispatch: true } }

  // Instant acknowledgement reaction runs concurrently with the classification.
  const reactionPromise = addReaction(token, record.messageId, emoji)
  const result = await classify(apiKey, model, botName, config.playbook, record, history)
  const reactionId = await reactionPromise

  if (!result) {
    // Classification failed — fail safe by running the heavy workload rather than dropping the message.
    return { dispatch: true }
  }

  if (result.category === 'ignore') {
    if (reactionId) { await removeReaction(token, record.messageId, reactionId) }
    return { dispatch: false, category: 'ignore' }
  }

  const text = result.reply.trim() || (result.category === 'task' ? 'Got it — working on this now.' : '')
  const replyMessageId = text ? await replyText(token, record.messageId, text) : undefined

  return { dispatch: result.category === 'task', category: result.category, replied: !!replyMessageId, replyMessageId, replyText: text }
}

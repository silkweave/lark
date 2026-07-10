import { createAction } from '@silkweave/core'
import z from 'zod'
import { gatewayRequest } from '../../lib/watcherClient.js'
import { SubscriptionResult } from '../../types/gateway.js'

export const EventSubscriptionCreate = createAction({
  name: 'eventSubscriptionCreate',
  description: 'Create a persistent message subscription on the RUNNING watcher (applied live over its control gateway and persisted — fails if no `lark-serve` watcher process is running; check EventWatchStatus). Matching messages received by the bot are appended to the local event log (readable via EventList) and can optionally trigger a shell command and/or a webhook. Requires the Lark app to have the im.message.receive_v1 event enabled with long-connection mode.',
  input: z.object({
    chatId: z.string().optional().describe('Restrict to a specific chat (chat_id from ImChatList); omit to match all chats the bot is in'),
    chatName: z.string().optional().describe('Human-readable chat name (informational only)'),
    mentionBot: z.boolean().optional().describe('Only match messages that @-mention the bot'),
    keywords: z.array(z.string()).optional().describe('Only match messages containing at least one of these keywords (case-insensitive)'),
    onEventCommand: z.string().optional().describe('Shell command spawned (detached) per matching message; event details are passed via LARK_* env vars (LARK_EVENT_JSON, LARK_HISTORY_JSON, LARK_CHAT_ID, LARK_TEXT, ...)'),
    webhookUrl: z.string().optional().describe('URL POSTed with { subscriptionId, event, history } per matching message — an alternative/addition to onEventCommand for a persistent listener instead of spawning a process per message'),
    webhookSecret: z.string().optional().describe('Sent as the X-Silkweave-Signature header on webhook requests so the receiver can verify authenticity'),
    reflexTrigger: z.object({
      alwaysEngage: z.boolean().optional().describe('Engage the reflex fast-responder on every message this subscription matches, without requiring an @-mention'),
      keywords: z.array(z.string()).optional().describe('Engage the reflex (without requiring a mention) when the message contains one of these keywords, case-insensitive — independent of the keywords field above')
    }).optional().describe('Per-subscription override for when the reflex fast-responder engages, independent of the global default (a direct @-mention, or a reply in a mention-started thread required)')
  }),
  run: async (input) => {
    const { subscription } = await gatewayRequest<SubscriptionResult>('subscriptions.add', input)
    return { subscription }
  }
})

import { createAction } from '@silkweave/core'
import z from 'zod'
import { TENANT_USER_ID, TokenClient } from '../../classes/TokenClient.js'
import { messageWatcher } from '../../lib/messageWatcher.js'
import { MessageSubscription } from '../../types/events.js'

export const EventSubscriptionCreate = createAction({
  name: 'eventSubscriptionCreate',
  description: 'Create a persistent message subscription. Matching messages received by the bot are appended to the local event log (readable via EventList) and can optionally trigger a shell command. The subscription only receives events while the watcher is running (EventWatchStart or the standalone `lark-serve` service) and the Lark app has the im.message.receive_v1 event enabled with long-connection mode.',
  input: z.object({
    chatId: z.string().optional().describe('Restrict to a specific chat (chat_id from ImChatList); omit to match all chats the bot is in'),
    chatName: z.string().optional().describe('Human-readable chat name (informational only)'),
    mentionBot: z.boolean().optional().describe('Only match messages that @-mention the bot'),
    keywords: z.array(z.string()).optional().describe('Only match messages containing at least one of these keywords (case-insensitive)'),
    onEventCommand: z.string().optional().describe('Shell command spawned (detached) per matching message; event details are passed via LARK_* env vars (LARK_EVENT_JSON, LARK_CHAT_ID, LARK_TEXT, ...)')
  }),
  run: async ({ chatId, chatName, mentionBot, keywords, onEventCommand }) => {
    const client = new TokenClient(TENANT_USER_ID)
    const subscription: MessageSubscription = {
      id: `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      chatId,
      chatName,
      mentionBot,
      keywords,
      onEventCommand,
      createdAt: new Date().toISOString()
    }
    client.addSubscription(subscription)
    return { subscription, watcher: messageWatcher.getStatus() }
  }
})

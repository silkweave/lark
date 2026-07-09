import { createAction } from '@silkweave/core'
import z from 'zod'
import { gatewayRequest } from '../../lib/watcherClient.js'
import { SubscriptionPatch, SubscriptionResult } from '../../types/gateway.js'

export const EventSubscriptionUpdate = createAction({
  name: 'eventSubscriptionUpdate',
  description: 'Update an existing message subscription in place (id-stable — no delete+recreate) on the RUNNING watcher, applied live over its control gateway (fails if no `lark-serve` watcher process is running). Patch semantics per field: pass a value to set it, pass null to clear the optional field, omit it to leave it unchanged — e.g. { webhookUrl: null } removes the webhook without touching anything else.',
  input: z.object({
    id: z.string().describe('Subscription ID (from EventSubscriptionList)'),
    chatId: z.string().nullable().optional().describe('Restrict to a specific chat; null clears the restriction (match all chats)'),
    chatName: z.string().nullable().optional().describe('Human-readable chat name (informational only); null clears'),
    mentionBot: z.boolean().nullable().optional().describe('Only match messages that @-mention the bot; null clears the requirement'),
    keywords: z.array(z.string()).nullable().optional().describe('Only match messages containing at least one of these keywords; null clears'),
    onEventCommand: z.string().nullable().optional().describe('Shell command spawned per matching message; null clears'),
    webhookUrl: z.string().nullable().optional().describe('URL POSTed per matching message; null clears'),
    webhookSecret: z.string().nullable().optional().describe('X-Silkweave-Signature header value for webhook requests; null clears')
  }),
  run: async ({ id, ...patch }) => {
    const { subscription } = await gatewayRequest<SubscriptionResult>('subscriptions.update', { id, patch: patch satisfies SubscriptionPatch })
    return { subscription }
  }
})

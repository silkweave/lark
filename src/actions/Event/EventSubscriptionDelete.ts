import { createAction } from '@silkweave/core'
import z from 'zod'
import { gatewayRequest } from '../../lib/watcherClient.js'
import { SubscriptionRemoveResult } from '../../types/gateway.js'

export const EventSubscriptionDelete = createAction({
  name: 'eventSubscriptionDelete',
  description: 'Delete a persistent message subscription by ID, applied live on the RUNNING watcher over its control gateway (fails if no `lark-serve` watcher process is running).',
  args: ['id'],
  input: z.object({
    id: z.string().describe('Subscription ID (from EventSubscriptionList)')
  }),
  run: async ({ id }) => {
    const { removed } = await gatewayRequest<SubscriptionRemoveResult>('subscriptions.remove', { id })
    return { deleted: removed }
  }
})

import { createAction } from '@silkweave/core'
import z from 'zod'
import { TENANT_USER_ID, TokenClient } from '../../classes/TokenClient.js'

export const EventSubscriptionDelete = createAction({
  name: 'eventSubscriptionDelete',
  description: 'Delete a persistent message subscription by ID.',
  args: ['id'],
  input: z.object({
    id: z.string().describe('Subscription ID (from EventSubscriptionList)')
  }),
  run: async ({ id }) => {
    const client = new TokenClient(TENANT_USER_ID)
    if (!client.removeSubscription(id)) { throw new Error(`No subscription found with id ${id}`) }
    return { deleted: id }
  }
})

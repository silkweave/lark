import { createAction } from '@silkweave/core'
import z from 'zod'
import { TENANT_USER_ID, TokenClient } from '../../classes/TokenClient.js'
import { gatewayRequest, isWatcherUnavailable } from '../../lib/watcherClient.js'
import { readWatcherStatus } from '../../lib/watcherStatus.js'
import { WatcherStatus } from '../../types/events.js'
import { SubscriptionsListResult } from '../../types/gateway.js'

export const EventSubscriptionList = createAction({
  name: 'eventSubscriptionList',
  description: 'List all persistent message subscriptions and the current watcher status. Reads live from the running watcher\'s control gateway; if no watcher is running, falls back to the persisted config file (still shows configured subscriptions).',
  input: z.object({}),
  run: async () => {
    try {
      const [{ subscriptions }, watcher] = await Promise.all([
        gatewayRequest<SubscriptionsListResult>('subscriptions.list'),
        gatewayRequest<WatcherStatus>('status')
      ])
      return { subscriptions, watcher }
    } catch (error) {
      if (!isWatcherUnavailable(error)) { throw error }
      const client = new TokenClient(TENANT_USER_ID)
      return { subscriptions: client.getWatcherConfig().subscriptions, watcher: readWatcherStatus() }
    }
  }
})

import { createAction } from '@silkweave/core'
import z from 'zod'
import { TENANT_USER_ID, TokenClient } from '../../classes/TokenClient.js'
import { readWatcherStatus } from '../../lib/watcherStatus.js'

export const EventSubscriptionList = createAction({
  name: 'eventSubscriptionList',
  description: 'List all persistent message subscriptions and the current watcher status.',
  input: z.object({}),
  run: async () => {
    const client = new TokenClient(TENANT_USER_ID)
    const config = client.getWatcherConfig()
    return { subscriptions: config.subscriptions, watcher: readWatcherStatus() }
  }
})

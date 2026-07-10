import { createAction } from '@silkweave/core'
import z from 'zod'
import { gatewayRequest } from '../../lib/watcherClient.js'
import { ReconnectResult } from '../../types/gateway.js'

export const EventWatchReconnect = createAction({
  name: 'eventWatchReconnect',
  description: 'Tell the RUNNING watcher to tear down and re-establish its Lark WebSocket connection, re-reading app credentials and bot info — use after changing app credentials, or to recover a wedged connection. The control gateway and any live event streams stay up throughout. Fails if no `lark-serve` watcher process is running.',
  input: z.object({}),
  run: async () => gatewayRequest<ReconnectResult>('reconnect', undefined, { timeoutMs: 30000 })
})

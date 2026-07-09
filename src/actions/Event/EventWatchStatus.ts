import { createAction } from '@silkweave/core'
import z from 'zod'
import { messageWatcher } from '../../lib/messageWatcher.js'

export const EventWatchStatus = createAction({
  name: 'eventWatchStatus',
  description: 'Get message watcher status: running state, counters, recent matched events. If externalPid is set, a watcher is running in another process (e.g. the standalone lark-serve service).',
  input: z.object({}),
  run: async () => messageWatcher.getStatus()
})

import { createAction } from '@silkweave/core'
import z from 'zod'
import { TENANT_USER_ID, TokenClient } from '../../classes/TokenClient.js'
import { messageWatcher } from '../../lib/messageWatcher.js'

export const EventWatchStop = createAction({
  name: 'eventWatchStop',
  description: 'Stop the message watcher running in this process. Optionally disable auto-start on MCP server boot.',
  input: z.object({
    disableAutoStart: z.boolean().optional().default(true).describe('Also disable auto-start on MCP server boot')
  }),
  run: async ({ disableAutoStart }) => {
    if (disableAutoStart) { new TokenClient(TENANT_USER_ID).setWatcherConfig({ autoStart: false }) }
    return messageWatcher.stop()
  }
})

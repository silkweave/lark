import { createAction } from '@silkweave/core'
import z from 'zod'
import { TENANT_USER_ID, TokenClient } from '../../classes/TokenClient.js'
import { messageWatcher } from '../../lib/messageWatcher.js'

export const EventWatchStart = createAction({
  name: 'eventWatchStart',
  description: 'Start the message watcher in this process (WebSocket long connection to Lark). It receives im.message.receive_v1 events, matches them against subscriptions, and logs/dispatches them. Runs for as long as this MCP server process lives; for an agent-independent service run `lark-serve` instead. Sets autoStart so the watcher resumes on MCP server boot (disable via EventWatchStop).',
  input: z.object({
    autoStart: z.boolean().optional().default(true).describe('Auto-start the watcher whenever the MCP server boots')
  }),
  run: async ({ autoStart }) => {
    new TokenClient(TENANT_USER_ID).setWatcherConfig({ autoStart })
    return messageWatcher.start()
  }
})

import { createAction } from '@silkweave/core'
import z from 'zod'
import { WatcherStatus } from '../../types/events.js'
import { gatewayRequest, isWatcherUnavailable } from '../../lib/watcherClient.js'
import { readWatcherStatus } from '../../lib/watcherStatus.js'

export const EventWatchStatus = createAction({
  name: 'eventWatchStatus',
  description: 'Report message-watcher status — read-only, never starts or stops anything. Queries the running watcher live over its control gateway (Unix socket); if no watcher is running, falls back to the persisted heartbeat file. The watcher is a SEPARATE OS process (`lark-serve`); this MCP server never runs it. Returns running, pid, startedAt, wsConnected, activeStreams, counters (received/matched/dispatched/errors), reflex config + counters, and recent events. When running is false, notRunningReason explains why and gives the exact shell command to start it.',
  input: z.object({}),
  run: async () => {
    try {
      return await gatewayRequest<WatcherStatus>('status')
    } catch (error) {
      if (isWatcherUnavailable(error)) { return readWatcherStatus() }
      throw error
    }
  }
})

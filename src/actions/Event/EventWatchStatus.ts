import { createAction } from '@silkweave/core'
import z from 'zod'
import { readWatcherStatus } from '../../lib/watcherStatus.js'

export const EventWatchStatus = createAction({
  name: 'eventWatchStatus',
  description: 'Report message-watcher status by reading its heartbeat + pidfile — read-only, never starts or stops anything. The watcher is a SEPARATE OS process (`lark-serve`); this MCP server never runs it. Returns running, pid, startedAt, counters (received/matched/dispatched/errors), reflex config + counters, and recent events. When running is false, notRunningReason explains why and gives the exact shell command to start it.',
  input: z.object({}),
  run: async () => readWatcherStatus()
})

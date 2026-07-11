import { createAction } from '@silkweave/core'
import { existsSync, readFileSync } from 'fs'
import z from 'zod'
import { EVENTS_PATH } from '../../lib/paths.js'
import { MessageEventRecord } from '../../types/events.js'

export const EventList = createAction({
  name: 'eventList',
  description: 'Read collected message events from the local event log (newest last). Events are recorded by the message watcher for messages matching a subscription. Use this to poll for new messages, e.g. requests that @-mention the bot.',
  input: z.object({
    chatId: z.string().optional().describe('Filter to a specific chat'),
    subscriptionId: z.string().optional().describe('Filter to events matched by a specific subscription'),
    mentionedBot: z.boolean().optional().describe('Filter to messages that @-mention the bot'),
    since: z.string().optional().describe('Only events received after this ISO 8601 timestamp'),
    limit: z.int().optional().default(20).describe('Maximum number of events to return (newest kept)')
  }),
  run: async ({ chatId, subscriptionId, mentionedBot, since, limit }) => {
    if (!existsSync(EVENTS_PATH)) { return { events: [], total: 0 } }
    const events = readFileSync(EVENTS_PATH, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MessageEventRecord)
      .filter((e) => !chatId || e.chatId === chatId)
      .filter((e) => !subscriptionId || e.subscriptionIds.includes(subscriptionId))
      .filter((e) => mentionedBot == null || e.mentionedBot === mentionedBot)
      .filter((e) => !since || e.receivedAt > since)
    return { events: events.slice(-limit), total: events.length }
  }
})

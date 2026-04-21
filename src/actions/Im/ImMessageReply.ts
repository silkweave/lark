import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const ImMessageReply = createAction({
  name: 'imMessageReply',
  description: 'Reply to a specific message in a thread. Messages are sent as the bot.',
  input: z.object({
    messageId: z.string().describe('The ID of the message to reply to'),
    msgType: z.enum(['text', 'post', 'interactive']).describe('Message type'),
    content: z.string().describe('Message content as a JSON string'),
    replyInThread: z.boolean().optional().describe('Whether to reply in a thread'),
    uuid: z.string().optional().describe('Idempotency key to prevent duplicate sends')
  }),
  run: async ({ messageId, msgType, content, replyInThread, uuid }) => {
    const client = new TokenClient('default')
    return client.withTenant((lark, options) => lark.im.message.reply({
      path: { message_id: messageId },
      data: { msg_type: msgType, content, reply_in_thread: replyInThread, uuid }
    }, options))
  }
})

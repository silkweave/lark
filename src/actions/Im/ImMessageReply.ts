import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const ImMessageReply = createAction({
  name: 'imMessageReply',
  description: 'Reply to a specific message in a thread. Replies as the bot by default (userId: tenant); pass a user token store key to reply as that user.',
  args: ['userId'],
  input: z.object({
    messageId: z.string().describe('The ID of the message to reply to'),
    msgType: z.enum(['text', 'post', 'interactive']).describe('Message type'),
    content: z.string().describe('Message content as a JSON string'),
    replyInThread: z.boolean().optional().describe('Whether to reply in a thread'),
    uuid: z.string().optional().describe('Idempotency key to prevent duplicate sends'),
    userId: userIdSchema('tenant')
  }),
  run: async ({ messageId, msgType, content, replyInThread, uuid, userId }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.im.message.reply({
      path: { message_id: messageId },
      data: { msg_type: msgType, content, reply_in_thread: replyInThread, uuid }
    }, options))
  }
})

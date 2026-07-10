import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'
import { appendHistory } from '../../lib/history.js'
import { clearPendingIndicators } from '../../lib/indicator.js'

export const ImMessageSend = createAction({
  name: 'imMessageSend',
  description: 'Send a message (text, rich text, or interactive card) to a user or group chat. Sends as the bot by default (userId: tenant); pass a user token store key to send as that user.',
  args: ['userId'],
  input: z.object({
    receiveId: z.string().describe('The ID of the message recipient (user or chat)'),
    receiveIdType: z.enum(['open_id', 'user_id', 'union_id', 'email', 'chat_id']).describe('Type of receive_id'),
    msgType: z.enum(['text', 'post', 'interactive']).describe('Message type'),
    content: z.string().describe('Message content as a JSON string'),
    uuid: z.string().optional().describe('Idempotency key to prevent duplicate sends'),
    userId: userIdSchema('tenant')
  }),
  run: async ({ receiveId, receiveIdType, msgType, content, uuid, userId }) => {
    const client = new TokenClient(userId)
    const result = await client.withAuth((lark, options) => lark.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: receiveId, msg_type: msgType, content, uuid }
    }, options))
    const chatId = receiveIdType === 'chat_id' ? receiveId : (result as { chat_id?: string }).chat_id
    const messageId = (result as { message_id?: string }).message_id
    if (chatId && messageId) {
      let text = content
      if (msgType === 'text') {
        try { text = JSON.parse(content).text ?? content } catch { /* keep raw content */ }
      }
      appendHistory({ chatId, messageId, role: 'agent', text, createTime: String(Date.now()) })
      // The bot's real reply has landed — resolve any indicator cards still pending in this chat to a "done" note.
      await clearPendingIndicators(chatId)
    }
    return result
  }
})

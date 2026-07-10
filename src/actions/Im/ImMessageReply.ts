import { createAction } from '@silkweave/core'
import z from 'zod'
import { TENANT_USER_ID, TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'
import { appendHistory } from '../../lib/history.js'
import { clearPendingIndicators, resolveIndicatorWithReply } from '../../lib/indicator.js'

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
    let text = content
    if (msgType === 'text') {
      try { text = JSON.parse(content).text ?? content } catch { /* keep raw content */ }
    }
    if (msgType === 'text' && userId === TENANT_USER_ID) {
      // A bot text reply to a message with a pending indicator card morphs the card into the reply in place —
      // no extra message, no recall tombstone. (Only as the bot: the card is a tenant message.)
      const morphed = await resolveIndicatorWithReply(messageId, text)
      if (morphed) {
        appendHistory({ chatId: morphed.chatId, messageId: morphed.messageId, parentId: messageId, role: 'agent', text, createTime: String(Date.now()) })
        return { chat_id: morphed.chatId, message_id: morphed.messageId, morphedIndicator: true }
      }
    }
    const client = new TokenClient(userId)
    const result = await client.withAuth((lark, options) => lark.im.message.reply({
      path: { message_id: messageId },
      data: { msg_type: msgType, content, reply_in_thread: replyInThread, uuid }
    }, options))
    const chatId = (result as { chat_id?: string }).chat_id
    const replyId = (result as { message_id?: string }).message_id
    if (chatId && replyId) {
      appendHistory({ chatId, messageId: replyId, parentId: messageId, role: 'agent', text, createTime: String(Date.now()) })
      // The bot's real reply has landed — resolve any indicator cards still pending in this chat to a "done" note.
      await clearPendingIndicators(chatId)
    }
    return result
  }
})

import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const ImMessageSend = createAction({
  name: 'imMessageSend',
  description: 'Send a message (text, rich text, or interactive card) to a user or group chat. Messages are sent as the bot.',
  input: z.object({
    receiveId: z.string().describe('The ID of the message recipient (user or chat)'),
    receiveIdType: z.enum(['open_id', 'user_id', 'union_id', 'email', 'chat_id']).describe('Type of receive_id'),
    msgType: z.enum(['text', 'post', 'interactive']).describe('Message type'),
    content: z.string().describe('Message content as a JSON string'),
    uuid: z.string().optional().describe('Idempotency key to prevent duplicate sends')
  }),
  run: async ({ receiveId, receiveIdType, msgType, content, uuid }) => {
    const client = new TokenClient('default')
    return client.withTenant((lark, options) => lark.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: receiveId, msg_type: msgType, content, uuid }
    }, options))
  }
})

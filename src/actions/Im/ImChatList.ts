import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const ImChatList = createAction({
  name: 'imChatList',
  description: 'List chats that the current user or bot is in. Does not include P2P single chats.',
  args: ['userId'],
  input: z.object({
    sortType: z.enum(['ByCreateTimeAsc', 'ByActiveTimeDesc']).optional().describe('Sort order'),
    pageSize: z.int().optional().describe('Number of results per page'),
    pageToken: z.string().optional().describe('Pagination token for next page'),
    userId: userIdSchema()
  }),
  run: async ({ userId, sortType, pageSize, pageToken }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.im.chat.list({
      params: {
        user_id_type: 'open_id',
        sort_type: sortType,
        page_size: pageSize,
        page_token: pageToken
      }
    }, options))
  }
})

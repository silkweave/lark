import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const ImChatSearch = createAction({
  name: 'imChatSearch',
  description: 'Search for chats visible to the current user or bot by keyword.',
  args: ['userId'],
  input: z.object({
    query: z.string().describe('Search keyword'),
    pageSize: z.int().optional().describe('Number of results per page'),
    pageToken: z.string().optional().describe('Pagination token for next page'),
    userId: userIdSchema()
  }),
  run: async ({ userId, query, pageSize, pageToken }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.im.chat.search({
      params: {
        user_id_type: 'open_id',
        query,
        page_size: pageSize,
        page_token: pageToken
      }
    }, options))
  }
})

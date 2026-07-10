import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const WikiSpaceList = createAction({
  name: 'wikiSpaceList',
  description: 'List Wiki Spaces',
  input: z.object({
    userId: userIdSchema(),
    pageSize: z.int().optional().describe('Number of results per page'),
    pageToken: z.string().optional().describe('Pagination token for next page')
  }),
  run: async ({ userId, pageSize, pageToken }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.wiki.space.list({
      params: { page_size: pageSize, page_token: pageToken }
    }, options))
  }
})

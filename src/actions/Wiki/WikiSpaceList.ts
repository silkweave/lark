import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const WikiSpaceList = createAction({
  name: 'wikiSpaceList',
  description: 'List Wiki Spaces',
  input: z.object({
    userId: z.string().optional().default('default'),
    pageSize: z.int().optional(),
    pageToken: z.string().optional()
  }),
  run: async ({ userId, pageSize, pageToken }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.wiki.space.list({
      params: { page_size: pageSize, page_token: pageToken }
    }, options))
  }
})

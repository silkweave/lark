import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const BitableTableList = createAction({
  name: 'bitableTableList',
  description: 'List all tables in a Lark Base (bitable).',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    pageToken: z.string().optional().describe('Pagination token'),
    pageSize: z.coerce.number().optional().describe('Number of results per page (max 100)'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, appToken, pageToken, pageSize }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.bitable.appTable.list({
      path: { app_token: appToken },
      params: { page_token: pageToken, page_size: pageSize }
    }, options))
  }
})

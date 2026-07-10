import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const BitableFieldList = createAction({
  name: 'bitableFieldList',
  description: 'List all fields in a Lark Base table.',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    tableId: z.string().describe('The table_id to list fields for'),
    viewId: z.string().optional().describe('View ID to scope field visibility'),
    pageToken: z.string().optional().describe('Pagination token'),
    pageSize: z.coerce.number().optional().describe('Number of results per page (max 100)'),
    userId: userIdSchema()
  }),
  run: async ({ userId, appToken, tableId, viewId, pageToken, pageSize }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.bitable.appTableField.list({
      path: { app_token: appToken, table_id: tableId },
      params: { view_id: viewId, page_token: pageToken, page_size: pageSize }
    }, options))
  }
})

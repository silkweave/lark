import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const BitableRecordDelete = createAction({
  name: 'bitableRecordDelete',
  description: 'Delete multiple records from a Lark Base table (max 500 per call).',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    tableId: z.string().describe('The table_id containing the records'),
    recordIds: z.array(z.string()).describe('Array of record_ids to delete'),
    userId: userIdSchema()
  }),
  run: async ({ userId, appToken, tableId, recordIds }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.bitable.appTableRecord.batchDelete({
      path: { app_token: appToken, table_id: tableId },
      data: { records: recordIds }
    }, options))
  }
})

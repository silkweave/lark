import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const BitableRecordBatchCreate = createAction({
  name: 'bitableRecordBatchCreate',
  description: 'Create multiple records in a Lark Base table (max 500 per call).',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    tableId: z.string().describe('The table_id to create records in'),
    records: z.array(z.object({
      fields: z.record(z.string(), z.unknown()).describe('Field values as { fieldName: value }')
    })).describe('Array of records to create'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, appToken, tableId, records }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.bitable.appTableRecord.batchCreate({
      path: { app_token: appToken, table_id: tableId },
      data: { records: records as Array<{ fields: Record<string, string> }> }
    }, options))
  }
})

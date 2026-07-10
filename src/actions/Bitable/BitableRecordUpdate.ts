import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const BitableRecordUpdate = createAction({
  name: 'bitableRecordUpdate',
  description: 'Update multiple records in a Lark Base table (max 500 per call).',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    tableId: z.string().describe('The table_id containing the records'),
    records: z.array(z.object({
      recordId: z.string().describe('The record_id to update'),
      fields: z.record(z.string(), z.unknown()).describe('Field values to update as { fieldName: value }')
    })).describe('Array of records to update'),
    userId: userIdSchema()
  }),
  run: async ({ userId, appToken, tableId, records }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.bitable.appTableRecord.batchUpdate({
      path: { app_token: appToken, table_id: tableId },
      data: {
        records: records.map((r) => ({
          record_id: r.recordId,
          fields: r.fields as Record<string, string>
        }))
      }
    }, options))
  }
})

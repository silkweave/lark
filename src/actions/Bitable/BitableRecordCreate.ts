import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const BitableRecordCreate = createAction({
  name: 'bitableRecordCreate',
  description: 'Create a new record in a Lark Base table.',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    tableId: z.string().describe('The table_id to create the record in'),
    fields: z.record(z.string(), z.unknown()).describe('Field values as { fieldName: value } — use field names, not IDs'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, appToken, tableId, fields }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.bitable.appTableRecord.create({
      path: { app_token: appToken, table_id: tableId },
      data: { fields: fields as Record<string, string> }
    }, options))
  }
})

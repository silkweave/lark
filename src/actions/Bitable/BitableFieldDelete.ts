import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const BitableFieldDelete = createAction({
  name: 'bitableFieldDelete',
  description: 'Delete a field from a Lark Base table.',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    tableId: z.string().describe('The table_id containing the field'),
    fieldId: z.string().describe('The field_id to delete'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, appToken, tableId, fieldId }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.bitable.appTableField.delete({
      path: { app_token: appToken, table_id: tableId, field_id: fieldId }
    }, options))
  }
})

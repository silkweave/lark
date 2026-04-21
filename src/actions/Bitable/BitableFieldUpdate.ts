import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const BitableFieldUpdate = createAction({
  name: 'bitableFieldUpdate',
  description: 'Update a field in a Lark Base table (e.g. rename, change options).',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    tableId: z.string().describe('The table_id containing the field'),
    fieldId: z.string().describe('The field_id to update'),
    fieldName: z.string().describe('Field name'),
    type: z.coerce.number().describe('Field type (1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, 13=Phone, 15=Url, 17=Attachment, 18=SingleLink, 20=Formula, 21=DuplexLink, 22=Location, 1001=CreatedTime, 1002=ModifiedTime, 1003=CreatedUser, 1004=ModifiedUser, 1005=AutoNumber)'),
    uiType: z.string().optional().describe('UI type hint (e.g. Text, Number, Currency, Rating)'),
    property: z.string().optional().describe('Field property as JSON string (options for select fields, etc.)'),
    description: z.string().optional().describe('Field description'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, appToken, tableId, fieldId, fieldName, type, uiType, property, description }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.bitable.appTableField.update({
      path: { app_token: appToken, table_id: tableId, field_id: fieldId },
      data: {
        field_name: fieldName,
        type,
        ui_type: uiType as 'Text' | undefined,
        property: property ? JSON.parse(property) : undefined,
        description: description ? { text: description } : undefined
      }
    }, options))
  }
})

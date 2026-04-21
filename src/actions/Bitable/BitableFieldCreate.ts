import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const BitableFieldCreate = createAction({
  name: 'bitableFieldCreate',
  description: 'Create a new field in a Lark Base table.',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    tableId: z.string().describe('The table_id to add the field to'),
    fieldName: z.string().describe('Field name'),
    type: z.coerce.number().describe('Field type (1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, 13=Phone, 15=Url, 17=Attachment, 18=SingleLink, 20=Formula, 21=DuplexLink, 22=Location, 1001=CreatedTime, 1002=ModifiedTime, 1003=CreatedUser, 1004=ModifiedUser, 1005=AutoNumber)'),
    uiType: z.string().optional().describe('UI type hint (e.g. Text, Number, Currency, Rating)'),
    property: z.string().optional().describe('Field property as JSON string (options for select fields, formula_expression, etc.)'),
    description: z.string().optional().describe('Field description'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, appToken, tableId, fieldName, type, uiType, property, description }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.bitable.appTableField.create({
      path: { app_token: appToken, table_id: tableId },
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

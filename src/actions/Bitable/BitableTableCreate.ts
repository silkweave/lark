import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

const fieldSchema = z.object({
  fieldName: z.string().describe('Field name'),
  type: z.coerce.number().describe('Field type (1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, 13=Phone, 15=Url, 17=Attachment, 18=SingleLink, 20=Formula, 21=DuplexLink, 22=Location, 1001=CreatedTime, 1002=ModifiedTime, 1003=CreatedUser, 1004=ModifiedUser, 1005=AutoNumber)'),
  uiType: z.string().optional().describe('UI type hint (e.g. Text, Number, Currency, Rating, etc.)')
})

export const BitableTableCreate = createAction({
  name: 'bitableTableCreate',
  description: 'Create a new table in a Lark Base (bitable), optionally with initial fields.',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    name: z.string().describe('Table name'),
    defaultViewName: z.string().optional().describe('Default view name'),
    fields: z.array(fieldSchema).optional().describe('Initial fields to create with the table'),
    userId: userIdSchema()
  }),
  run: async ({ userId, appToken, name, defaultViewName, fields }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.bitable.appTable.create({
      path: { app_token: appToken },
      data: {
        table: {
          name,
          default_view_name: defaultViewName,
          fields: fields?.map((f) => ({
            field_name: f.fieldName,
            type: f.type,
            ui_type: f.uiType as 'Text' | undefined
          }))
        }
      }
    }, options))
  }
})

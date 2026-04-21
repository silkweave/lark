import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const ContactUserList = createAction({
  name: 'contactUserList',
  description: 'List users in the organization. Use department_id "0" for root department to get all users.',
  args: ['userId'],
  input: z.object({
    departmentId: z.string().optional().default('0').describe('Department ID ("0" for root/all users)'),
    pageSize: z.int().optional().describe('Number of results per page (max 50)'),
    pageToken: z.string().optional().describe('Pagination token for next page'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, departmentId, pageSize, pageToken }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.contact.user.list({
      params: {
        user_id_type: 'open_id',
        department_id: departmentId,
        page_size: pageSize,
        page_token: pageToken
      }
    }, options))
  }
})

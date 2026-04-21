import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const BitableAppGet = createAction({
  name: 'bitableAppGet',
  description: 'Get metadata of a Lark Base (bitable), including name, revision, and permissions.',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, appToken }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.bitable.app.get({
      path: { app_token: appToken }
    }, options))
  }
})

import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const BitableAppGet = createAction({
  name: 'bitableAppGet',
  description: 'Get metadata of a Lark Base (bitable), including name, revision, and permissions.',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    userId: userIdSchema()
  }),
  run: async ({ userId, appToken }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.bitable.app.get({
      path: { app_token: appToken }
    }, options))
  }
})

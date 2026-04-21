import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const AuthenUserInfo = createAction({
  name: 'authenUserInfo',
  description: 'Get Authorized User Info',
  input: z.object({
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.authen.v1.userInfo.get(undefined, options))
  }
})

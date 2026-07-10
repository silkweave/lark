import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient, TokenEntry } from '../../classes/TokenClient.js'

export const AuthenOauthToken = createAction({
  name: 'authenOauthToken',
  description: 'Get Oauth Token from Authorization Code',
  args: ['code'],
  input: z.object({
    userId: z.string().optional().default('default').describe('Token store key under which the user\'s OAuth tokens will be saved (default: \'default\')'),
    code: z.string().describe('Authorization code from the OAuth callback URL')
  }),
  run: async ({ userId, code }) => {
    const client = new TokenClient(userId)
    const response = await client.createAccessToken(code)
    const now = Date.now()
    const entry: TokenEntry = {
      accessToken: response.access_token,
      accessTokenExpiresAt: now + response.expires_in * 1000,
      refreshToken: response.refresh_token,
      refreshTokenExpiresAt: now + response.refresh_token_expires_in * 1000
    }
    client.setEntry(entry)
    return entry
  }
})

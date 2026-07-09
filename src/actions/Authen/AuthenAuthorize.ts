import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const AuthenAuthorize = createAction({
  name: 'authenAuthorize',
  description: 'Generate Authorization URL',
  input: z.object({
    clientId: z.string().optional().describe('Lark App ID (persisted; required on first call)'),
    clientSecret: z.string().optional().describe('Lark App Secret (persisted; required on first call)'),
    redirectUri: z.string().optional().default('http://localhost:3000/callback').describe('OAuth redirect URI registered in the Lark app'),
    userId: z.string().optional().default('default').describe('Token store key under which the user\'s OAuth tokens will be saved (default: \'default\'). Not needed for tenant/bot access — the Tenant Access Token only requires app credentials.')
  }),
  run: async (params) => {
    const client = new TokenClient(params.userId)
    const clientId = params.clientId ?? client.clientId
    const clientSecret = params.clientSecret ?? client.clientSecret
    if (!clientId) { throw new Error('Client ID is required') }
    if (!clientSecret) { throw new Error('Client Secret is required') }
    client.setAppCredentials(clientId, clientSecret, params.redirectUri)
    return { authorizeUrl: client.getAuthorizeUrl(params.userId) }
  }
})

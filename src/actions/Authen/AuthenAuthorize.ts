import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const AuthenAuthorize = createAction({
  name: 'authenAuthorize',
  description: 'Generate Authorization URL',
  input: z.object({
    clientId: z.string().optional(),
    clientSecret: z.string().optional(),
    redirectUri: z.string().optional().default('http://localhost:3000/callback'),
    userId: z.string().optional().default('default')
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

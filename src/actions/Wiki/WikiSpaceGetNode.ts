import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const WikiSpaceGetNode = createAction({
  name: 'wikiSpaceGetNode',
  description: 'Get Wiki Space Node',
  args: ['userId'],
  input: z.object({
    token: z.string().describe('The Wiki Node Token to retrieve'),
    objType: z.enum(['doc', 'docx', 'sheet', 'mindnote', 'bitable', 'file', 'slides', 'wiki']).optional().describe('Object type of the node'),
    userId: userIdSchema()
  }),
  run: async ({ userId, token, objType }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.wiki.space.getNode({
      params: { token, obj_type: objType }
    }, options))
  }
})

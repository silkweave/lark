import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const WikiSpaceNodeMove = createAction({
  name: 'wikiSpaceNodeMove',
  description: 'Move a wiki node (and its children) to a different parent or a different space.',
  args: ['userId'],
  input: z.object({
    spaceId: z.string().describe('Source wiki space ID'),
    nodeToken: z.string().describe('Token of the node to move'),
    targetParentToken: z.string().optional().describe('Target parent node token'),
    targetSpaceId: z.string().optional().describe('Target space ID for cross-space moves'),
    userId: userIdSchema()
  }),
  run: async ({ userId, spaceId, nodeToken, targetParentToken, targetSpaceId }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.wiki.spaceNode.move({
      path: { space_id: spaceId, node_token: nodeToken },
      data: { target_parent_token: targetParentToken, target_space_id: targetSpaceId }
    }, options))
  }
})

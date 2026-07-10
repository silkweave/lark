import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const WikiSpaceNodeCopy = createAction({
  name: 'wikiSpaceNodeCopy',
  description: 'Copy a wiki node to create new documents from templates. Supports cross-space copies.',
  args: ['userId'],
  input: z.object({
    spaceId: z.string().describe('Source wiki space ID'),
    nodeToken: z.string().describe('Token of the node to copy'),
    targetParentToken: z.string().optional().describe('Target parent node token'),
    targetSpaceId: z.string().optional().describe('Target space ID for cross-space copies'),
    title: z.string().optional().describe('Title override for the copied node'),
    userId: userIdSchema()
  }),
  run: async ({ userId, spaceId, nodeToken, targetParentToken, targetSpaceId, title }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.wiki.spaceNode.copy({
      path: { space_id: spaceId, node_token: nodeToken },
      data: { target_parent_token: targetParentToken, target_space_id: targetSpaceId, title }
    }, options))
  }
})

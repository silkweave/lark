import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const WikiSpaceNodeCreate = createAction({
  name: 'wikiSpaceNodeCreate',
  description: 'Create a new document node in a Wiki space. Returns the node_token and obj_token (document ID) which can be used with DocxDocumentImport to populate content.',
  args: ['userId'],
  input: z.object({
    spaceId: z.string().describe('Wiki space ID'),
    parentNodeToken: z.string().optional().describe('Parent node token. Omit to create a top-level node.'),
    title: z.string().optional().describe('Document title'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, spaceId, parentNodeToken, title }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.wiki.spaceNode.create({
      path: { space_id: spaceId },
      data: {
        obj_type: 'docx',
        node_type: 'origin',
        parent_node_token: parentNodeToken,
        title
      }
    }, options))
  }
})

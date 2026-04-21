import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const WikiSpaceNodeDelete = createAction({
  name: 'wikiSpaceNodeDelete',
  description: 'Delete a wiki document by removing its underlying Drive file (moves to trash, recoverable for 30 days). Requires the obj_token from WikiSpaceGetNode, not the node_token.',
  args: ['userId'],
  input: z.object({
    fileToken: z.string().describe('The obj_token of the wiki node (from WikiSpaceGetNode), not the node_token'),
    type: z.enum(['doc', 'docx', 'sheet', 'mindnote', 'bitable', 'file', 'slides']).describe('The document type'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, fileToken, type }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.drive.file.delete({
      path: { file_token: fileToken },
      params: { type }
    }, options))
  }
})

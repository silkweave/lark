import { createAction } from '@silkweave/core'
import { z } from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

export const DocxDocumentBlockList = createAction({
  name: 'docxDocumentBlockList',
  description: 'List Document Blocks',
  input: z.object({
    documentId: z.string().describe('Lark document ID (or wiki node token)'),
    userIdType: z.enum(['user_id', 'union_id', 'open_id']).optional().describe('ID type used for user fields in the response'),
    documentRevisionId: z.int().optional().describe('Document revision to read (-1 for latest)'),
    pageSize: z.int().optional().describe('Number of results per page'),
    pageToken: z.string().optional().describe('Pagination token for next page'),
    userId: userIdSchema()
  }),
  run: async ({ documentId, userIdType, documentRevisionId, pageSize, pageToken, userId }) => {
    const client = new TokenClient(userId)
    return client.withAuth((lark, options) => lark.docx.documentBlock.list({
      path: { document_id: documentId },
      params: { user_id_type: userIdType, document_revision_id: documentRevisionId, page_size: pageSize, page_token: pageToken }
    }, options))
  }
})

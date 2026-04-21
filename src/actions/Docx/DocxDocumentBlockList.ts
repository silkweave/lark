import { createAction } from '@silkweave/core'
import { z } from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const DocxDocumentBlockList = createAction({
  name: 'docxDocumentBlockList',
  description: 'List Document Blocks',
  input: z.object({
    documentId: z.string(),
    userIdType: z.enum(['user_id', 'union_id', 'open_id']).optional(),
    documentRevisionId: z.int().optional(),
    pageSize: z.int().optional(),
    pageToken: z.string().optional(),
    userId: z.string().optional().default('default')
  }),
  run: async ({ documentId, userIdType, documentRevisionId, pageSize, pageToken, userId }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.docx.documentBlock.list({
      path: { document_id: documentId },
      params: { user_id_type: userIdType, document_revision_id: documentRevisionId, page_size: pageSize, page_token: pageToken }
    }, options))
  }
})

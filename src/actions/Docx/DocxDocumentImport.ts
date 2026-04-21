import { createAction } from '@silkweave/core'
import { existsSync, readFileSync } from 'fs'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export const DocxDocumentImport = createAction({
  name: 'docxDocumentImport',
  description: 'Import Markdown into exsting Lark Document',
  input: z.object({
    documentId: z.string(),
    path: z.string().describe('Local file path to markdown file'),
    userIdType: z.enum(['user_id', 'union_id', 'open_id']).optional(),
    userId: z.string().optional().default('default')
  }),
  run: async ({ documentId, path, userIdType, userId }) => {
    const client = new TokenClient(userId)
    if (!existsSync(path)) { throw new Error(`File ${path} does not exist`) }
    let content = readFileSync(path, 'utf-8')

    // Set up Tool Response
    const toolResponse = {
      documentId,
      spaceId: '',
      blocksDeleted: 0,
      blocksCreated: 0,
      title: ''
    }

    // Load Document
    const nodeResponse = await client.withUser((lark, options) => lark.wiki.space.getNode({
      params: { token: documentId, obj_type: 'docx' }
    }, options))
    if (!nodeResponse.node) { throw new Error('Wiki node not found') }
    toolResponse.title = nodeResponse.node.title ?? ''
    toolResponse.spaceId = nodeResponse.node.space_id ?? ''

    // Extract H1 title from markdown before conversion
    // Lark documents have a separate title field, so we strip the first H1
    // and set it as the wiki node title instead of including it in the body
    const h1Match = content.match(/^#\s+(.+)\n?/)
    if (h1Match) {
      const title = h1Match[1].trim()
      await client.withUser((lark, options) => lark.wiki.spaceNode.updateTitle({
        path: { space_id: nodeResponse.node!.space_id!, node_token: nodeResponse.node!.node_token! },
        data: { title }
      }, options))
      toolResponse.title = title
      content = content.slice(h1Match[0].length).replace(/^\n+/, '')
    }

    // Prepare Blocks (before deleting existing content)
    const convertResponse = await client.withUser((lark, options) => lark.docx.v1.document.convert({
      data: { content, content_type: 'markdown' },
      params: { user_id_type: userIdType }
    }, options))
    if (!convertResponse.blocks || !convertResponse.first_level_block_ids) {
      throw new Error('No blocks generated')
    }

    // Strip read-only merge_info from table blocks (causes 400 on insert)
    for (const b of convertResponse.blocks) {
      if (b.table?.property) {
        delete (b.table.property as Record<string, unknown>).merge_info
      }
    }

    // Delete existing blocks (after conversion succeeds)
    const blocksResponse = await client.withUser((lark, options) => lark.docx.documentBlock.list({
      path: { document_id: documentId },
      params: { user_id_type: userIdType }
    }, options))
    const block = blocksResponse.items?.at(0)
    if (!block?.block_id) { throw new Error('No block found') }
    if (block.children && block.children.length > 0) {
      await client.withUser((lark, options) => lark.docx.v1.documentBlockChildren.batchDelete({
        path: { document_id: documentId, block_id: block.block_id! },
        data: { start_index: 0, end_index: block.children!.length }
      }, options))
      toolResponse.blocksDeleted = block.children.length
    }

    // Insert Blocks
    let insertResponse
    try {
      insertResponse = await client.withUser((lark, options) => lark.docx.v1.documentBlockDescendant.create({
        path: { document_id: documentId, block_id: documentId },
        params: { user_id_type: userIdType },
        data: {
          children_id: convertResponse.first_level_block_ids!,
          descendants: convertResponse.blocks!
        }
      }, options))
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: unknown } }
      if (axiosErr.response?.data) {
        throw new Error(`Insert blocks failed: ${JSON.stringify(axiosErr.response.data)}`)
      }
      throw err
    }
    toolResponse.blocksCreated = insertResponse.children!.length

    return toolResponse
  }
})

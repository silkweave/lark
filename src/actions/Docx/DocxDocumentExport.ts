import { createAction } from '@silkweave/core'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import z from 'zod'
import { DocxParser } from '../../classes/DocxParser.js'
import { TokenClient } from '../../classes/TokenClient.js'

export const DocxDocumentExport = createAction({
  name: 'docxDocumentExport',
  description: 'Export Document to Markdown',
  input: z.object({
    documentId: z.string(),
    includeTitle: z.boolean().optional().default(true),
    path: z.string().optional().describe('Write to path instead of returning results'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ documentId, includeTitle, path, userId }) => {
    const client = new TokenClient(userId)

    const nodeResponse = await client.withUser((lark, options) => lark.wiki.space.getNode({
      params: { token: documentId, obj_type: 'docx' }
    }, options))
    if (!nodeResponse.node) { throw new Error('Wiki node not found') }
    const nodeResult = {
      title: nodeResponse.node.title,
      objToken: nodeResponse.node.obj_token,
      nodeToken: nodeResponse.node.node_token
    }

    const parser = new DocxParser(client, { includeTitle })
    const markdown = await parser.process(documentId)
    if (path) {
      const fullPath = resolve(path)
      const dirName = dirname(fullPath)
      if (!existsSync(dirName)) { mkdirSync(dirName, { recursive: true }) }
      writeFileSync(fullPath, markdown, 'utf-8')
      return { ...nodeResult, path: fullPath, length: markdown.length }
    } else {
      return { ...nodeResult, markdown }
    }
  }
})

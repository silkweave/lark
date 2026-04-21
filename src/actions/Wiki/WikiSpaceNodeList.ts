import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

export interface LarkNode {
  space_id?: string
  node_token?: string
  has_child?: boolean
}

export const WikiSpaceNodeList = createAction({
  name: 'wikiSpaceNodeList',
  description: 'List Wiki Space Nodes',
  args: ['userId'],
  input: z.object({
    spaceId: z.string(),
    pageSize: z.int().optional(),
    pageToken: z.string().optional(),
    parentNodeToken: z.string().optional(),
    recursive: z.boolean().describe('Traverse the tree recursively').optional().default(false),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, spaceId, pageSize, pageToken, parentNodeToken, recursive }) => {
    const client = new TokenClient(userId)

    async function fetchChildrenRecursive(parentNode: LarkNode): Promise<LarkNode[]> {
      if (!parentNode.has_child) { return [] }
      const childNodes = await fetchChildren(parentNode.node_token)
      const descendantNodeLists = await Promise.all(childNodes.map((childNode) => fetchChildrenRecursive(childNode)))
      for (const descendantNodes of descendantNodeLists) { childNodes.push(...descendantNodes) }
      return childNodes
    }

    async function fetchChildren(token?: string): Promise<LarkNode[]> {
      const response = await client.withUser((lark, options) => lark.wiki.spaceNode.list({
        path: { space_id: spaceId },
        params: { page_size: pageSize, page_token: pageToken, parent_node_token: token }
      }, options))
      return response.items ?? []
    }

    if (recursive) {
      return fetchChildrenRecursive({ node_token: parentNodeToken, space_id: spaceId, has_child: true })
    } else {
      return fetchChildren(parentNodeToken)
    }
  }
})

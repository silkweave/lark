import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'

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
    spaceId: z.string().describe('Wiki space ID'),
    pageSize: z.int().optional().describe('Number of results per page'),
    pageToken: z.string().optional().describe('Pagination token for next page'),
    parentNodeToken: z.string().optional().describe('Filter to children of this node'),
    recursive: z.boolean().describe('Traverse the tree recursively').optional().default(false),
    userId: userIdSchema()
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
      const response = await client.withAuth((lark, options) => lark.wiki.spaceNode.list({
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

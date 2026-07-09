import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'
import { userIdSchema } from '../../lib/auth.js'
import { fetchLark, parseLarkResponse } from '../../lib/api.js'

export const WikiSearch = createAction({
  name: 'wikiSearch',
  description: 'Full-text search across wiki spaces. Returns matching nodes with titles, space IDs, and metadata.',
  args: ['userId'],
  input: z.object({
    query: z.string().describe('Search query text'),
    spaceId: z.string().optional().describe('Filter results to a specific wiki space'),
    nodeId: z.string().optional().describe('Filter results to descendants of a specific node (requires spaceId)'),
    pageSize: z.int().optional().describe('Number of results per page (max 50, default 20)'),
    pageToken: z.string().optional().describe('Pagination token for next page'),
    userId: userIdSchema()
  }),
  run: async ({ userId, query, spaceId, nodeId, pageSize, pageToken }) => {
    const client = new TokenClient(userId)
    return parseLarkResponse(fetchLark('POST', 'WikiV2NodesSearch', {
      page_token: pageToken,
      page_size: pageSize
    }, { query, space_id: spaceId, node_id: nodeId }, client.accessToken))
  }
})

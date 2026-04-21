import { createAction } from '@silkweave/core'
import z from 'zod'
import { TokenClient } from '../../classes/TokenClient.js'

const conditionSchema = z.object({
  fieldName: z.string().describe('Field name to filter on'),
  operator: z.enum(['is', 'isNot', 'contains', 'doesNotContain', 'isEmpty', 'isNotEmpty', 'isGreater', 'isGreaterEqual', 'isLess', 'isLessEqual', 'like', 'in']).describe('Filter operator'),
  value: z.array(z.string()).optional().describe('Filter values')
})

const sortSchema = z.object({
  fieldName: z.string().optional().describe('Field name to sort by'),
  desc: z.boolean().optional().describe('Sort descending')
})

export const BitableRecordSearch = createAction({
  name: 'bitableRecordSearch',
  description: 'Search records in a Lark Base table with optional filtering and sorting.',
  args: ['userId'],
  input: z.object({
    appToken: z.string().describe('The app_token of the bitable'),
    tableId: z.string().describe('The table_id to search in'),
    viewId: z.string().optional().describe('View ID to scope the search'),
    fieldNames: z.array(z.string()).optional().describe('Fields to return (omit for all)'),
    filter: z.object({
      conjunction: z.enum(['and', 'or']).describe('How to combine conditions'),
      conditions: z.array(conditionSchema).optional().describe('Filter conditions')
    }).optional().describe('Filter criteria'),
    sort: z.array(sortSchema).optional().describe('Sort order'),
    automaticFields: z.boolean().optional().describe('Include auto fields (created_time, etc.)'),
    pageToken: z.string().optional().describe('Pagination token'),
    pageSize: z.coerce.number().optional().describe('Number of results per page (max 100)'),
    userId: z.string().optional().default('default')
  }),
  run: async ({ userId, appToken, tableId, viewId, fieldNames, filter, sort, automaticFields, pageToken, pageSize }) => {
    const client = new TokenClient(userId)
    return client.withUser((lark, options) => lark.bitable.appTableRecord.search({
      path: { app_token: appToken, table_id: tableId },
      params: { page_token: pageToken, page_size: pageSize },
      data: {
        view_id: viewId,
        field_names: fieldNames,
        filter: filter ? {
          conjunction: filter.conjunction,
          conditions: filter.conditions?.map((c) => ({
            field_name: c.fieldName,
            operator: c.operator,
            value: c.value
          }))
        } : undefined,
        sort: sort?.map((s) => ({ field_name: s.fieldName, desc: s.desc })),
        automatic_fields: automaticFields
      }
    }, options))
  }
})

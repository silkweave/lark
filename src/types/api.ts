/* eslint-disable @typescript-eslint/no-explicit-any */
export interface LarkRequestOptions {
  lark?: Record<any, string>
  params?: Record<string, string>
  data?: Record<string, string>
  headers?: Record<string, string>
  path?: Record<string, string>
}

export interface LarkResponse<T> {
  code?: number
  msg?: string
  data?: T
}

export interface ListOptions {
  pageSize?: number
  pageToken?: string
  parentNodeToken?: string
}

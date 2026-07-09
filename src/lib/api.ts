import { LarkResponse } from '../types/api.js'

export interface LarkTokenInfo {
  token_type: 'Bearer'
  access_token: string
  expires_in: number
  refresh_token: string
  refresh_token_expires_in: number
  scope: string
  code: number
}

export interface LarkUserInfo {
  avatar_big: string
  avatar_middle: string
  avatar_thumb: string
  avatar_url: string
  email: string
  en_name: string
  mobile: string
  name: string
  open_id: string
  tenant_key: string
  union_id: string
  user_id: string
}

export interface ApiSchema {
  'AuthV3TenantAccessTokenInternal': {
    QUERY: void
    BODY: { app_id: string; app_secret: string }
    RESPONSE: { tenant_access_token: string; expire: number }
  }
  'AuthenV1Authorize': {
    QUERY: { client_id: string; redirect_uri: string; state: string; scope?: string }
    BODY: void
    RESPONSE: unknown
  }
  'AuthenV2OauthToken': {
    QUERY: void
    BODY: (
      { grant_type: 'authorization_code'; client_id: string; client_secret: string; code: string; redirect_uri: string; scope?: string } |
      { grant_type: 'refresh_token'; client_id: string; client_secret: string; refresh_token: string }
    )
    RESPONSE: LarkTokenInfo
  }
  'AuthenV1UserInfo': {
    QUERY: void
    BODY: void
    RESPONSE: { code: number; msg: string; data: LarkUserInfo }
  }
  'BotV3Info': {
    QUERY: void
    BODY: void
    RESPONSE: { code: number; msg: string; bot?: { activate_status?: number; app_name?: string; avatar_url?: string; open_id?: string } }
  }
  'WikiV2NodesSearch': {
    QUERY: { page_token?: string; page_size?: number }
    BODY: { query: string; space_id?: string; node_id?: string }
    RESPONSE: LarkResponse<{
      items: {
        node_id: string
        space_id: string
        obj_type: number
        obj_token: string
        title: string
        url: string
        icon?: string
        parent_id?: string
        sort_id?: number
      }[]
      has_more: boolean
      page_token: string | null
    }>
  }
}

export type ApiUrl = keyof ApiSchema

export const ApiUrlMap: Record<ApiUrl, string> = {
  'AuthV3TenantAccessTokenInternal': 'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
  'AuthenV1Authorize': 'https://open.larksuite.com/open-apis/authen/v1/authorize',
  'AuthenV2OauthToken': 'https://open.larksuite.com/open-apis/authen/v2/oauth/token',
  'AuthenV1UserInfo': 'https://open.larksuite.com/open-apis/authen/v1/user_info',
  'BotV3Info': 'https://open.larksuite.com/open-apis/bot/v3/info',
  'WikiV2NodesSearch': 'https://open.larksuite.com/open-apis/wiki/v2/nodes/search'
}

export async function parseLarkResponse<T>(promise: Promise<LarkResponse<T>>) {
  const result = await promise
  if (result.code == null || !result.data) { throw new Error(`Invalid Response: ${result.msg ?? 'unknown'}`) }
  if (result.code !== 0) { throw new Error(`Invalid Response ${result.code}: ${result.msg ?? 'unknown'}`) }
  return result.data
}

export async function fetchLark<K extends ApiUrl, S extends ApiSchema[K]>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', key: K, query: S['QUERY'], body: S['BODY'], token?: string): Promise<S['RESPONSE']> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' }
  const init: RequestInit = { method, headers }
  if (token) { headers['Authorization'] = `Bearer ${token}` }
  const uri = buildLarkUrl(key, query)
  if (body) { init.body = JSON.stringify(body) }
  const response = await fetch(uri.toString(), init)
  if (!response.ok) {
    const message = await response.text()
    throw new Error(message)
  }
  return response.json()
}

export function buildLarkUrl<K extends ApiUrl, S extends ApiSchema[K]>(key: K, params: S['QUERY']): string {
  const uri = new URL(ApiUrlMap[key])
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v != null) { uri.searchParams.set(k, String(v)) }
  }
  return uri.toString()
}

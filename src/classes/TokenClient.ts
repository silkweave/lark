/* eslint-disable @typescript-eslint/no-explicit-any */
import { AppType, Client, Domain, LoggerLevel, withTenantToken, withUserAccessToken } from '@larksuiteoapi/node-sdk'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { buildLarkUrl, fetchLark, parseLarkResponse } from '../lib/api.js'
import { withFileLock } from '../lib/fileLock.js'
import { scopes } from '../lib/scopes.js'
import { LarkResponse } from '../types/api.js'
import { MessageSubscription, WatcherConfig } from '../types/events.js'

export interface TokenEntry {
  accessToken: string
  accessTokenExpiresAt: number
  refreshToken: string
  refreshTokenExpiresAt: number
}

export interface LarkAuthOptions {
  lark?: any
  params?: Record<string, string>
  data?: Record<string, string>
  headers?: Record<string, string>
  path?: Record<string, string>
}

/** Sentinel userId that selects the app's Tenant Access Token (bot identity) instead of a user OAuth token */
export const TENANT_USER_ID = 'tenant'

export interface TokenRegistry {
  clientId: string
  clientSecret: string
  redirectUri: string
  tenantToken?: string
  tenantTokenExpiresAt?: number
  entries: Record<string, TokenEntry>
  watcher?: WatcherConfig
}

export class TokenClient {
  private key: string
  private storePath: string
  private registry: TokenRegistry

  constructor(key = 'default', storePath = join(homedir(), '.silkweave-lark.json')) {
    this.key = key
    this.storePath = storePath
    this.registry = this.readRegistry()
  }

  private readRegistry(): TokenRegistry {
    return existsSync(this.storePath)
      ? JSON.parse(readFileSync(this.storePath, 'utf-8'))
      : { clientId: '', clientSecret: '', redirectUri: '', entries: {} }
  }

  /**
   * Every write goes through here: re-read the store under an advisory file lock, apply the mutation to the
   * fresh state, then atomic-write (temp + rename). The store is multi-writer (MCP OAuth, watcher token
   * refresh, gateway persistence) — mutating a constructor-time snapshot would lose concurrent updates.
   */
  private mutate(fn: (registry: TokenRegistry) => void): void {
    withFileLock(this.storePath, () => {
      const registry = this.readRegistry()
      fn(registry)
      const dirName = dirname(this.storePath)
      if (!existsSync(dirName)) { mkdirSync(dirName, { recursive: true }) }
      const tmpPath = `${this.storePath}.${process.pid}.tmp`
      writeFileSync(tmpPath, JSON.stringify(registry, null, 2))
      renameSync(tmpPath, this.storePath)
      this.registry = registry
    })
  }

  public setAppCredentials(clientId: string, clientSecret: string, redirectUri: string) {
    this.mutate((registry) => {
      registry.clientId = clientId
      registry.clientSecret = clientSecret
      registry.redirectUri = redirectUri
    })
  }

  public getAuthorizeUrl(state: string) {
    return buildLarkUrl('AuthenV1Authorize', {
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: scopes.join(' '),
      state
    })
  }

  public createAccessToken(code: string) {
    return fetchLark('POST', 'AuthenV2OauthToken', undefined, {
      grant_type: 'authorization_code',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      code,
      scope: scopes.join(' ')
    })
  }

  public get isTenant() { return this.key === TENANT_USER_ID }

  public async withAuth<T>(fn: (lark: Client, options: LarkAuthOptions) => Promise<LarkResponse<T>>) {
    return this.isTenant ? this.withTenant(fn) : this.withUser(fn)
  }

  public async withUser<T>(fn: (lark: Client, options: LarkAuthOptions) => Promise<LarkResponse<T>>) {
    if (this.isTenant) { throw new Error(`This action requires a user token — userId '${TENANT_USER_ID}' is not supported here`) }
    await this.assertValidAccessToken()
    if (!this.clientId) { throw new Error('Client ID is required, please re-authenticate') }
    if (!this.clientSecret) { throw new Error('Client Secret is required, please re-authenticate') }
    const client = new Client({ appId: this.clientId, appSecret: this.clientSecret, appType: AppType.SelfBuild, domain: Domain.Lark, loggerLevel: LoggerLevel.error })
    return parseLarkResponse(fn(client, withUserAccessToken(this.accessToken)))
  }

  public async withTenant<T>(fn: (lark: Client, options: LarkAuthOptions) => Promise<LarkResponse<T>>) {
    if (!this.clientId) { throw new Error('Client ID is required, please run AuthenAuthorize first') }
    if (!this.clientSecret) { throw new Error('Client Secret is required, please run AuthenAuthorize first') }
    await this.assertValidTenantToken()
    const client = new Client({ appId: this.clientId, appSecret: this.clientSecret, appType: AppType.SelfBuild, domain: Domain.Lark, loggerLevel: LoggerLevel.error })
    return parseLarkResponse(fn(client, withTenantToken(this.tenantToken!)))
  }

  public get clientId() { return this.registry.clientId }
  public get clientSecret() { return this.registry.clientSecret }
  public get redirectUri() { return this.registry.redirectUri }
  public get tenantToken() { return this.registry.tenantToken }
  public get tenantTokenExpiresAt() { return this.registry.tenantTokenExpiresAt }
  public get accessToken() { return this.getEntry().accessToken }
  public get accessTokenExpiresAt() { return this.getEntry().accessTokenExpiresAt }
  public get refreshToken() { return this.getEntry().refreshToken }
  public get refreshTokenExpiresAt() { return this.getEntry().refreshTokenExpiresAt }

  private async assertValidAccessToken() {
    const now = Date.now()
    if (now >= this.refreshTokenExpiresAt) {
      throw new Error('Refresh Token expired, please re-authenticate')
    }
    if (now >= this.accessTokenExpiresAt) {
      const response = await fetchLark('POST', 'AuthenV2OauthToken', undefined, {
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken
      })
      this.setEntry({
        accessToken: response.access_token,
        accessTokenExpiresAt: now + response.expires_in * 1000,
        refreshToken: response.refresh_token,
        refreshTokenExpiresAt: now + response.refresh_token_expires_in * 1000
      })
    }
  }

  async assertValidTenantToken(): Promise<void> {
    const now = Date.now()
    if (this.tenantToken && this.tenantTokenExpiresAt && now < this.tenantTokenExpiresAt) { return }
    const response = await fetchLark('POST', 'AuthV3TenantAccessTokenInternal', undefined, {
      app_id: this.registry.clientId,
      app_secret: this.registry.clientSecret
    })
    this.mutate((registry) => {
      registry.tenantToken = response.tenant_access_token
      registry.tenantTokenExpiresAt = now + response.expire * 1000
    })
  }

  public getWatcherConfig(): WatcherConfig {
    return this.registry.watcher ?? { subscriptions: [] }
  }

  public setWatcherConfig(patch: Partial<WatcherConfig>): WatcherConfig {
    this.mutate((registry) => {
      registry.watcher = { ...(registry.watcher ?? { subscriptions: [] }), ...patch }
    })
    return this.getWatcherConfig()
  }

  public addSubscription(subscription: MessageSubscription): void {
    this.mutate((registry) => {
      const watcher = registry.watcher ?? { subscriptions: [] }
      watcher.subscriptions = [...watcher.subscriptions, subscription]
      registry.watcher = watcher
    })
  }

  /** Apply a transform to the subscription with the given id; returns the updated subscription, or undefined if not found. */
  public updateSubscription(id: string, apply: (subscription: MessageSubscription) => MessageSubscription): MessageSubscription | undefined {
    let updated: MessageSubscription | undefined
    this.mutate((registry) => {
      const watcher = registry.watcher ?? { subscriptions: [] }
      watcher.subscriptions = watcher.subscriptions.map((s) => {
        if (s.id !== id) { return s }
        updated = apply(s)
        return updated
      })
      registry.watcher = watcher
    })
    return updated
  }

  public removeSubscription(id: string): boolean {
    let removed = false
    this.mutate((registry) => {
      const watcher = registry.watcher ?? { subscriptions: [] }
      const subscriptions = watcher.subscriptions.filter((s) => s.id !== id)
      removed = subscriptions.length !== watcher.subscriptions.length
      watcher.subscriptions = subscriptions
      registry.watcher = watcher
    })
    return removed
  }

  public setEntry(token: TokenEntry): void {
    this.mutate((registry) => {
      registry.entries[this.key] = token
    })
  }

  public getEntry() {
    const entry = this.registry.entries[this.key]
    if (!entry) { throw new Error(`No tokens stored for ${this.key}`) }
    return entry
  }
}

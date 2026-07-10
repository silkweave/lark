import { Domain, EventDispatcher, LoggerLevel, WSClient } from '@larksuiteoapi/node-sdk'
import { spawn } from 'child_process'
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { TENANT_USER_ID, TokenClient } from '../classes/TokenClient.js'
import { MessageEventRecord, MessageSubscription, ReflexConfig, WatcherStatus } from '../types/events.js'
import { ReflexInput, ReflexView, StreamReflexInfo, SubscriptionInput, SubscriptionPatch } from '../types/gateway.js'
import { fetchLark } from './api.js'
import { appendHistory, readHistory } from './history.js'
import { resolveIndicatorCard, STALE_TEXT } from './indicator.js'
import { listPendingAcks, takeStalePendingAcks } from './pendingAcks.js'
import { runReflex } from './reflex.js'
import { applySubscriptionPatch, GatewayError, GatewayHost, WatcherGateway } from './watcherGateway.js'
import { clearWatcherStatus, EVENTS_PATH, HEARTBEAT_MS, isProcessAlive, PID_PATH, writeWatcherStatus } from './watcherStatus.js'

export { EVENTS_PATH }
const DISPATCH_HISTORY_LIMIT = 20
/** Indicator cards whose workload never replied are resolved to a "no response" note after this long — a stale spinner is a lie. */
const STALE_ACK_MS = 10 * 60 * 1000

/** All SDK log output goes to stderr — stdout is reserved for the MCP stdio protocol */
const stderrLogger = {
  error: (...msg: unknown[]) => console.error('[lark-watcher]', ...msg),
  warn: (...msg: unknown[]) => console.error('[lark-watcher]', ...msg),
  info: (...msg: unknown[]) => console.error('[lark-watcher]', ...msg),
  debug: () => {},
  trace: () => {}
}

interface MessageEvent {
  sender: { sender_id?: { open_id?: string }; sender_type: string }
  message: {
    message_id: string
    root_id?: string
    thread_id?: string
    parent_id?: string
    create_time: string
    chat_id: string
    chat_type: string
    message_type: string
    content: string
    mentions?: { key: string; id: { open_id?: string }; name: string }[]
  }
}

function readExternalPid(): number | undefined {
  if (!existsSync(PID_PATH)) { return undefined }
  const pid = Number(readFileSync(PID_PATH, 'utf-8').trim())
  if (!pid || pid === process.pid || !isProcessAlive(pid)) { return undefined }
  return pid
}

function extractText(message: MessageEvent['message']): string {
  try {
    const content = JSON.parse(message.content)
    let text: string = typeof content.text === 'string' ? content.text : JSON.stringify(content)
    for (const mention of message.mentions ?? []) {
      text = text.replaceAll(mention.key, `@${mention.name}`)
    }
    return text
  } catch {
    return message.content
  }
}

export class MessageWatcher implements GatewayHost {
  private ws?: WSClient
  private gateway?: WatcherGateway
  private wsConnected = false
  private running = false
  private startedAt?: number
  private botOpenId?: string
  private botName?: string
  private processed = new Set<string>()
  private engagedThreads = new Set<string>()
  private counters = { received: 0, matched: 0, dispatched: 0, errors: 0 }
  private reflexCounters = { trivial: 0, task: 0, ignored: 0, failed: 0 }
  private recent: WatcherStatus['recent'] = []
  private lastError?: string
  private notRunningReason?: string
  private heartbeat?: ReturnType<typeof setInterval>

  public async start(): Promise<WatcherStatus> {
    if (this.running) { throw new Error('Message watcher is already running in this process') }
    const externalPid = readExternalPid()
    if (externalPid) { throw new Error(`Message watcher is already running in process ${externalPid} — stop it first or use that instance`) }
    const client = new TokenClient(TENANT_USER_ID)
    if (!client.clientId || !client.clientSecret) { throw new Error('App credentials missing — call AuthenAuthorize first') }
    const reflexConfig = client.getWatcherConfig().reflex
    if (reflexConfig?.enabled && !reflexConfig.apiKey) {
      throw new Error('Reflex is enabled but no Anthropic API key is configured — set one via EventReflexConfigure (apiKey) or disable reflex')
    }
    await client.assertValidTenantToken()
    await this.fetchBotInfo(client)
    await this.connectWs(client)
    // Bind the control gateway after the WS is up: from here on, connectability to the socket = a live watcher.
    this.gateway = new WatcherGateway(this)
    try {
      await this.gateway.start()
    } catch (error) {
      this.ws?.close({ force: true })
      this.ws = undefined
      this.wsConnected = false
      this.gateway = undefined
      throw error
    }
    writeFileSync(PID_PATH, String(process.pid))
    this.running = true
    this.startedAt = Date.now()
    this.notRunningReason = undefined
    // Persist a heartbeat so any other process (MCP server, CLI) can report accurate status without owning the watcher.
    this.persistStatus()
    this.heartbeat = setInterval(() => {
      this.persistStatus()
      void this.sweepStaleAcks()
    }, HEARTBEAT_MS)
    this.heartbeat.unref?.()
    return this.getStatus()
  }

  /** Best-effort — without it, bot-mention detection falls back to matching by name only. */
  private async fetchBotInfo(client: TokenClient) {
    try {
      const info = await fetchLark('GET', 'BotV3Info', undefined, undefined, client.tenantToken)
      this.botOpenId = info.bot?.open_id
      this.botName = info.bot?.app_name
    } catch (error) {
      stderrLogger.warn('Could not fetch bot info, bot-mention detection will match by name only:', (error as Error).message)
    }
  }

  /** Establish the Lark WebSocket long-connection (a fresh WSClient — the SDK client is not restartable after close). */
  private async connectWs(client: TokenClient) {
    const eventDispatcher = new EventDispatcher({ loggerLevel: LoggerLevel.error, logger: stderrLogger }).register({
      'im.message.receive_v1': async (data) => this.handleMessage(data as MessageEvent)
    })
    this.ws = new WSClient({
      appId: client.clientId,
      appSecret: client.clientSecret,
      domain: Domain.Lark,
      loggerLevel: LoggerLevel.error,
      logger: stderrLogger
    })
    await this.ws.start({ eventDispatcher })
    this.wsConnected = true
  }

  // ── GatewayHost: the gateway applies all runtime mutations through these (single applier, serialized on this event loop) ──

  public getLiveStatus(): WatcherStatus {
    return this.getStatus()
  }

  public listSubscriptions(): MessageSubscription[] {
    return new TokenClient(TENANT_USER_ID).getWatcherConfig().subscriptions
  }

  public addSubscription(input: SubscriptionInput): MessageSubscription {
    const subscription: MessageSubscription = {
      id: `sub_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      chatId: input.chatId,
      chatName: input.chatName,
      mentionBot: input.mentionBot,
      keywords: input.keywords,
      onEventCommand: input.onEventCommand,
      webhookUrl: input.webhookUrl,
      webhookSecret: input.webhookSecret,
      createdAt: new Date().toISOString()
    }
    new TokenClient(TENANT_USER_ID).addSubscription(subscription)
    this.persistStatus()
    return subscription
  }

  public updateSubscription(id: string, patch: SubscriptionPatch): MessageSubscription {
    const updated = new TokenClient(TENANT_USER_ID).updateSubscription(id, (s) => applySubscriptionPatch(s, patch))
    if (!updated) { throw new GatewayError('not_found', `No subscription found with id ${id}`) }
    return updated
  }

  public removeSubscription(id: string): void {
    if (!new TokenClient(TENANT_USER_ID).removeSubscription(id)) {
      throw new GatewayError('not_found', `No subscription found with id ${id}`)
    }
    this.persistStatus()
  }

  public getReflex(): ReflexView {
    return this.toReflexView(new TokenClient(TENANT_USER_ID).getWatcherConfig().reflex ?? {})
  }

  public setReflex(input: ReflexInput): ReflexView {
    const client = new TokenClient(TENANT_USER_ID)
    const reflex: ReflexConfig = { ...client.getWatcherConfig().reflex }
    if (input.enabled !== undefined) { reflex.enabled = input.enabled }
    if (input.apiKey !== undefined) { reflex.apiKey = input.apiKey }
    if (input.model !== undefined) { reflex.model = input.model }
    if (input.playbook !== undefined) { reflex.playbook = input.playbook }
    if (input.historyLimit !== undefined) { reflex.historyLimit = input.historyLimit }
    if (reflex.enabled && !reflex.apiKey) {
      throw new GatewayError('conflict', 'Reflex cannot be enabled without an apiKey — pass one now or set it in a prior call')
    }
    client.setWatcherConfig({ reflex })
    this.persistStatus()
    return this.toReflexView(reflex)
  }

  /** Tear down and re-establish the Lark WS connection, re-reading app credentials. The gateway and its streams stay up. */
  public async reconnect(): Promise<{ reconnected: true; wsConnected: boolean }> {
    this.wsConnected = false
    if (this.ws) { this.ws.close({ force: true }) }
    this.ws = undefined
    const client = new TokenClient(TENANT_USER_ID)
    if (!client.clientId || !client.clientSecret) { throw new GatewayError('unavailable', 'App credentials missing — call AuthenAuthorize first') }
    await client.assertValidTenantToken()
    await this.fetchBotInfo(client)
    await this.connectWs(client)
    this.persistStatus()
    return { reconnected: true, wsConnected: this.wsConnected }
  }

  private toReflexView(reflex: ReflexConfig): ReflexView {
    return {
      enabled: reflex.enabled ?? false,
      model: reflex.model ?? 'claude-haiku-4-5',
      hasApiKey: !!reflex.apiKey,
      hasPlaybook: !!reflex.playbook?.trim(),
      historyLimit: reflex.historyLimit ?? 15
    }
  }

  /** Resolve indicator cards whose workload never replied (see src/lib/pendingAcks.ts). Best-effort, runs on the heartbeat. */
  private async sweepStaleAcks() {
    try {
      const cutoff = Date.now() - STALE_ACK_MS
      if (!listPendingAcks().some((a) => new Date(a.createdAt).getTime() <= cutoff)) { return }
      const client = new TokenClient(TENANT_USER_ID)
      await client.assertValidTenantToken()
      for (const ack of takeStalePendingAcks(STALE_ACK_MS)) {
        await resolveIndicatorCard(client, ack.ackMessageId, STALE_TEXT)
        stderrLogger.warn(`Resolved stale indicator card ${ack.ackMessageId} in ${ack.chatId} (no reply within ${STALE_ACK_MS / 60000}m)`)
      }
    } catch (error) {
      stderrLogger.error('Stale-ack sweep failed:', (error as Error).message)
    }
  }

  /** Write the current in-memory status to the shared heartbeat file (see readWatcherStatus). */
  private persistStatus() {
    if (!this.running) { return }
    writeWatcherStatus({
      pid: process.pid,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      botName: this.botName,
      botOpenId: this.botOpenId,
      counters: { ...this.counters },
      reflexCounters: { ...this.reflexCounters },
      lastError: this.lastError,
      recent: [...this.recent],
      wsConnected: this.wsConnected,
      activeStreams: this.gateway?.activeStreams ?? 0
    })
  }

  public stop(): WatcherStatus {
    if (this.gateway) { this.gateway.stop(); this.gateway = undefined }
    if (this.ws) { this.ws.close({ force: true }) }
    this.ws = undefined
    this.wsConnected = false
    this.running = false
    this.notRunningReason = 'stopped'
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = undefined }
    clearWatcherStatus()
    if (existsSync(PID_PATH) && readFileSync(PID_PATH, 'utf-8').trim() === String(process.pid)) { rmSync(PID_PATH) }
    return this.getStatus()
  }

  public getStatus(): WatcherStatus {
    const config = new TokenClient(TENANT_USER_ID).getWatcherConfig()
    const reflex = config.reflex
    return {
      running: this.running,
      pid: this.running ? process.pid : undefined,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : undefined,
      botName: this.botName,
      botOpenId: this.botOpenId,
      subscriptions: config.subscriptions.length,
      counters: { ...this.counters },
      lastError: this.lastError,
      notRunningReason: this.running ? undefined : this.notRunningReason,
      recent: [...this.recent],
      wsConnected: this.running ? this.wsConnected : undefined,
      activeStreams: this.running ? this.gateway?.activeStreams ?? 0 : undefined,
      reflex: reflex ? {
        enabled: reflex.enabled ?? false,
        model: reflex.model ?? 'claude-haiku-4-5',
        hasApiKey: !!reflex.apiKey,
        hasPlaybook: !!reflex.playbook?.trim(),
        counters: { ...this.reflexCounters }
      } : undefined
    }
  }

  private async handleMessage(data: MessageEvent) {
    try {
      this.counters.received++
      const message = data.message
      if (this.processed.has(message.message_id)) { return }
      if (this.processed.size > 10000) { this.processed.clear() }
      this.processed.add(message.message_id)
      const text = extractText(message)
      const mentions = message.mentions ?? []
      const mentionedBot = mentions.some((m) =>
        (this.botOpenId && m.id?.open_id === this.botOpenId) || (this.botName && m.name === this.botName)
      )
      // Record every message seen (regardless of subscription match) so chat context is complete for reflex/agent history
      appendHistory({
        chatId: message.chat_id,
        messageId: message.message_id,
        rootId: message.root_id,
        threadId: message.thread_id,
        parentId: message.parent_id,
        role: 'user',
        senderOpenId: data.sender.sender_id?.open_id,
        text,
        createTime: message.create_time
      })
      // Re-read subscriptions on every event so changes made by other processes (e.g. the MCP server) apply live
      const config = new TokenClient(TENANT_USER_ID).getWatcherConfig()
      const matched = config.subscriptions.filter((s) => this.matches(s, message.chat_id, mentionedBot, text))
      const record: MessageEventRecord = {
        receivedAt: new Date().toISOString(),
        subscriptionIds: matched.map((s) => s.id),
        chatId: message.chat_id,
        chatType: message.chat_type,
        messageId: message.message_id,
        rootId: message.root_id,
        threadId: message.thread_id,
        messageType: message.message_type,
        text,
        content: message.content,
        senderOpenId: data.sender.sender_id?.open_id,
        senderType: data.sender.sender_type,
        mentionedBot,
        mentions: mentions.map((m) => ({ name: m.name, openId: m.id?.open_id })),
        createTime: message.create_time
      }
      if (!matched.length) {
        // Not persisted, but still fanned out to `deliver: 'all'` streams (full-transcript consumers).
        this.gateway?.emitEvent({ event: record })
        return
      }
      this.counters.matched++
      appendFileSync(EVENTS_PATH, JSON.stringify(record) + '\n')
      this.recent.unshift({ receivedAt: record.receivedAt, chatId: record.chatId, text: record.text.slice(0, 200) })
      this.recent = this.recent.slice(0, 10)

      // A message is "engaged" when it directly @-mentions the bot, or is a reply in a thread that a mention started.
      const engaged = mentionedBot || this.isEngagedThread(message)
      if (engaged) { this.engageThread(message) }

      const reflex = config.reflex
      const senderOpenId = data.sender.sender_id?.open_id
      const fromUser = data.sender.sender_type === 'user' && (!this.botOpenId || senderOpenId !== this.botOpenId)
      let reflexInfo: StreamReflexInfo | undefined
      if (reflex?.enabled && engaged && message.message_type === 'text' && fromUser) {
        const outcome = await runReflex(record, reflex, this.botName ?? 'the bot')
        if (outcome.category === 'trivial') { this.reflexCounters.trivial++ } else if (outcome.category === 'task') { this.reflexCounters.task++ } else if (outcome.category === 'ignore') { this.reflexCounters.ignored++ } else { this.reflexCounters.failed++ }
        if (outcome.category) {
          reflexInfo = { category: outcome.category, replied: !!outcome.replied, replyText: outcome.replyText, dispatched: outcome.dispatch, ackMessageId: outcome.ackMessageId }
        }
        if (outcome.replied && outcome.replyMessageId) {
          appendHistory({
            chatId: record.chatId,
            messageId: outcome.replyMessageId,
            rootId: record.rootId,
            threadId: record.threadId,
            parentId: record.messageId,
            role: 'reflex',
            text: outcome.replyText ?? '',
            createTime: String(Date.now())
          })
        }
        if (outcome.dispatch) { this.dispatchMatched(matched, record, outcome.ackMessageId) }
      } else {
        this.dispatchMatched(matched, record)
      }
      // Emit to streams only after processing completes, so the reflex outcome is known and included.
      this.gateway?.emitEvent({ event: record, reflex: reflexInfo })
    } catch (error) {
      this.counters.errors++
      this.lastError = (error as Error).message
      stderrLogger.error('Failed to handle message event:', this.lastError)
    } finally {
      this.persistStatus()
    }
  }

  private dispatchMatched(matched: MessageSubscription[], record: MessageEventRecord, ackMessageId?: string) {
    for (const subscription of matched) {
      if (subscription.onEventCommand) { this.dispatchCommand(subscription, record, ackMessageId) }
      if (subscription.webhookUrl) { this.dispatchWebhook(subscription, record, ackMessageId) }
    }
  }

  /** POST the event + recent history to the subscription's webhook. Fire-and-forget from the caller's perspective — errors are counted, never thrown. */
  private async dispatchWebhook(subscription: MessageSubscription, record: MessageEventRecord, ackMessageId?: string) {
    try {
      const history = readHistory(record.chatId, DISPATCH_HISTORY_LIMIT).filter((e) => e.messageId !== record.messageId)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (subscription.webhookSecret) { headers['X-Silkweave-Signature'] = subscription.webhookSecret }
      const response = await fetch(subscription.webhookUrl!, {
        method: 'POST',
        headers,
        body: JSON.stringify({ subscriptionId: subscription.id, event: record, history, ackMessageId }),
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) { throw new Error(`webhook responded ${response.status}`) }
      this.counters.dispatched++
    } catch (error) {
      this.counters.errors++
      this.lastError = (error as Error).message
      stderrLogger.error('Failed to dispatch webhook:', this.lastError)
    } finally {
      // Webhook completes asynchronously (after handleMessage returns) — persist so the counter change is visible promptly.
      this.persistStatus()
    }
  }

  /** Record a message's ids so later replies in the same thread are treated as engaged (even without a re-mention). */
  private engageThread(message: MessageEvent['message']) {
    if (this.engagedThreads.size > 5000) { this.engagedThreads.clear() }
    this.engagedThreads.add(message.message_id)
    if (message.root_id) { this.engagedThreads.add(message.root_id) }
    if (message.thread_id) { this.engagedThreads.add(message.thread_id) }
  }

  private isEngagedThread(message: MessageEvent['message']): boolean {
    return (!!message.root_id && this.engagedThreads.has(message.root_id)) ||
      (!!message.thread_id && this.engagedThreads.has(message.thread_id))
  }

  private matches(subscription: MessageSubscription, chatId: string, mentionedBot: boolean, text: string): boolean {
    if (subscription.chatId && subscription.chatId !== chatId) { return false }
    if (subscription.mentionBot && !mentionedBot) { return false }
    if (subscription.keywords?.length && !subscription.keywords.some((k) => text.toLowerCase().includes(k.toLowerCase()))) { return false }
    return true
  }

  private dispatchCommand(subscription: MessageSubscription, record: MessageEventRecord, ackMessageId?: string) {
    try {
      const history = readHistory(record.chatId, DISPATCH_HISTORY_LIMIT).filter((e) => e.messageId !== record.messageId)
      const child = spawn(subscription.onEventCommand!, {
        shell: true,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          LARK_EVENT_JSON: JSON.stringify(record),
          LARK_HISTORY_JSON: JSON.stringify(history),
          LARK_SUBSCRIPTION_ID: subscription.id,
          LARK_CHAT_ID: record.chatId,
          LARK_MESSAGE_ID: record.messageId,
          LARK_MESSAGE_TYPE: record.messageType,
          LARK_TEXT: record.text,
          LARK_SENDER_OPEN_ID: record.senderOpenId ?? '',
          LARK_MENTIONED_BOT: String(record.mentionedBot),
          LARK_ACK_MESSAGE_ID: ackMessageId ?? ''
        }
      })
      child.unref()
      this.counters.dispatched++
    } catch (error) {
      this.counters.errors++
      this.lastError = (error as Error).message
      stderrLogger.error('Failed to dispatch onEventCommand:', this.lastError)
    }
  }
}

export const messageWatcher = new MessageWatcher()

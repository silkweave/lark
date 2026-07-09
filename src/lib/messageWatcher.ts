import { Domain, EventDispatcher, LoggerLevel, WSClient } from '@larksuiteoapi/node-sdk'
import { spawn } from 'child_process'
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { TENANT_USER_ID, TokenClient } from '../classes/TokenClient.js'
import { MessageEventRecord, MessageSubscription, WatcherStatus } from '../types/events.js'
import { fetchLark } from './api.js'

export const EVENTS_PATH = join(homedir(), '.silkweave-lark.events.jsonl')
const PID_PATH = join(homedir(), '.silkweave-lark.watcher.pid')

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
    create_time: string
    chat_id: string
    chat_type: string
    message_type: string
    content: string
    mentions?: { key: string; id: { open_id?: string }; name: string }[]
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
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

export class MessageWatcher {
  private ws?: WSClient
  private running = false
  private startedAt?: number
  private botOpenId?: string
  private botName?: string
  private processed = new Set<string>()
  private counters = { received: 0, matched: 0, dispatched: 0, errors: 0 }
  private recent: WatcherStatus['recent'] = []
  private lastError?: string
  private notRunningReason?: string

  public async start(): Promise<WatcherStatus> {
    if (this.running) { throw new Error('Message watcher is already running in this process') }
    const externalPid = readExternalPid()
    if (externalPid) { throw new Error(`Message watcher is already running in process ${externalPid} — stop it first or use that instance`) }
    const client = new TokenClient(TENANT_USER_ID)
    if (!client.clientId || !client.clientSecret) { throw new Error('App credentials missing — call AuthenAuthorize first') }
    await client.assertValidTenantToken()
    try {
      const info = await fetchLark('GET', 'BotV3Info', undefined, undefined, client.tenantToken)
      this.botOpenId = info.bot?.open_id
      this.botName = info.bot?.app_name
    } catch (error) {
      stderrLogger.warn('Could not fetch bot info, bot-mention detection will match by name only:', (error as Error).message)
    }
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
    writeFileSync(PID_PATH, String(process.pid))
    this.running = true
    this.startedAt = Date.now()
    this.notRunningReason = undefined
    return this.getStatus()
  }

  public stop(): WatcherStatus {
    if (this.ws) { this.ws.close({ force: true }) }
    this.ws = undefined
    this.running = false
    this.notRunningReason = 'stopped'
    if (existsSync(PID_PATH) && readFileSync(PID_PATH, 'utf-8').trim() === String(process.pid)) { rmSync(PID_PATH) }
    return this.getStatus()
  }

  public setNotRunningReason(reason: string) {
    this.notRunningReason = reason
  }

  public getStatus(): WatcherStatus {
    const subscriptions = new TokenClient(TENANT_USER_ID).getWatcherConfig().subscriptions
    return {
      running: this.running,
      pid: this.running ? process.pid : undefined,
      startedAt: this.startedAt ? new Date(this.startedAt).toISOString() : undefined,
      botName: this.botName,
      botOpenId: this.botOpenId,
      subscriptions: subscriptions.length,
      counters: { ...this.counters },
      lastError: this.lastError,
      notRunningReason: this.running ? undefined : this.notRunningReason,
      externalPid: this.running ? undefined : readExternalPid(),
      recent: [...this.recent]
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
      // Re-read subscriptions on every event so changes made by other processes (e.g. the MCP server) apply live
      const config = new TokenClient(TENANT_USER_ID).getWatcherConfig()
      const matched = config.subscriptions.filter((s) => this.matches(s, message.chat_id, mentionedBot, text))
      if (!matched.length) { return }
      this.counters.matched++
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
      appendFileSync(EVENTS_PATH, JSON.stringify(record) + '\n')
      this.recent.unshift({ receivedAt: record.receivedAt, chatId: record.chatId, text: record.text.slice(0, 200) })
      this.recent = this.recent.slice(0, 10)
      for (const subscription of matched) {
        if (subscription.onEventCommand) { this.dispatchCommand(subscription, record) }
      }
    } catch (error) {
      this.counters.errors++
      this.lastError = (error as Error).message
      stderrLogger.error('Failed to handle message event:', this.lastError)
    }
  }

  private matches(subscription: MessageSubscription, chatId: string, mentionedBot: boolean, text: string): boolean {
    if (subscription.chatId && subscription.chatId !== chatId) { return false }
    if (subscription.mentionBot && !mentionedBot) { return false }
    if (subscription.keywords?.length && !subscription.keywords.some((k) => text.toLowerCase().includes(k.toLowerCase()))) { return false }
    return true
  }

  private dispatchCommand(subscription: MessageSubscription, record: MessageEventRecord) {
    try {
      const child = spawn(subscription.onEventCommand!, {
        shell: true,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          LARK_EVENT_JSON: JSON.stringify(record),
          LARK_SUBSCRIPTION_ID: subscription.id,
          LARK_CHAT_ID: record.chatId,
          LARK_MESSAGE_ID: record.messageId,
          LARK_MESSAGE_TYPE: record.messageType,
          LARK_TEXT: record.text,
          LARK_SENDER_OPEN_ID: record.senderOpenId ?? '',
          LARK_MENTIONED_BOT: String(record.mentionedBot)
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

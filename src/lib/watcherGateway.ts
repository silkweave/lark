import { chmodSync, existsSync, readFileSync, unlinkSync } from 'fs'
import { connect, createServer, Server, Socket } from 'net'
import { StringDecoder } from 'string_decoder'
import { MessageEventRecord, MessageSubscription, WatcherStatus } from '../types/events.js'
import {
  GATEWAY_VERSION,
  GatewayErrorCode,
  GatewayEventFrame,
  GatewayRequest,
  GatewayResponse,
  MAX_LINE_BYTES,
  MAX_MALFORMED_FRAMES,
  MAX_REPLAY_EVENTS,
  MAX_STREAM_BUFFER_BYTES,
  ReflexInput,
  ReflexView,
  StreamFilter,
  StreamMessagePayload,
  STREAM_HEARTBEAT_MS,
  SubscriptionInput,
  SubscriptionPatch
} from '../types/gateway.js'
import { readHistory } from './history.js'
import { EVENTS_PATH, SOCK_PATH } from './watcherStatus.js'

/** Gateway logging goes to stderr — stdout is reserved for the MCP stdio protocol */
const log = {
  info: (...msg: unknown[]) => console.error('[lark-gateway]', ...msg),
  error: (...msg: unknown[]) => console.error('[lark-gateway]', ...msg)
}

/** Thrown by gateway method handlers to produce a typed error response. */
export class GatewayError extends Error {
  constructor(
    public code: Exclude<GatewayErrorCode, 'watcher_unavailable' | 'timeout'>,
    message: string,
    public data?: Record<string, unknown>
  ) {
    super(message)
  }
}

/**
 * What the gateway needs from its host (the MessageWatcher). Kept as an interface so the gateway never
 * imports the watcher (the watcher owns and starts the gateway). All mutations are applied by the host —
 * the single applier of watcher config — and run on the one event loop, so they are serialized.
 */
export interface GatewayHost {
  getLiveStatus(): WatcherStatus
  listSubscriptions(): MessageSubscription[]
  addSubscription(input: SubscriptionInput): MessageSubscription
  updateSubscription(id: string, patch: SubscriptionPatch): MessageSubscription
  removeSubscription(id: string): void
  getReflex(): ReflexView
  setReflex(input: ReflexInput): ReflexView
  reconnect(): Promise<{ reconnected: true; wsConnected: boolean }>
}

export function encodeFrame(frame: object): string {
  return JSON.stringify(frame) + '\n'
}

export interface LineDecoder {
  /** Push a chunk; returns any complete lines. Sets `overflowed` when a line exceeds the byte bound. */
  push(chunk: Buffer | string): string[]
  overflowed: boolean
}

/** Incremental NDJSON line splitter, UTF-8 safe across chunk boundaries. */
export function createLineDecoder(maxLineBytes = MAX_LINE_BYTES): LineDecoder {
  const utf8 = new StringDecoder('utf8')
  let buffer = ''
  const decoder: LineDecoder = {
    overflowed: false,
    push(chunk: Buffer | string): string[] {
      buffer += typeof chunk === 'string' ? chunk : utf8.write(chunk)
      const lines: string[] = []
      let index: number
      while ((index = buffer.indexOf('\n')) >= 0) {
        lines.push(buffer.slice(0, index))
        buffer = buffer.slice(index + 1)
      }
      if (buffer.length > maxLineBytes) {
        decoder.overflowed = true
        buffer = ''
      }
      return lines
    }
  }
  return decoder
}

/** Apply SubscriptionPatch semantics: present & non-null → set; null → clear; omitted → unchanged. */
export function applySubscriptionPatch(subscription: MessageSubscription, patch: SubscriptionPatch): MessageSubscription {
  const next: Record<string, unknown> = { ...subscription }
  const keys = ['chatId', 'chatName', 'mentionBot', 'keywords', 'onEventCommand', 'webhookUrl', 'webhookSecret'] as const
  for (const key of keys) {
    const value = patch[key]
    if (value === undefined) { continue }
    if (value === null) { delete next[key] } else { next[key] = value }
  }
  return next as unknown as MessageSubscription
}

/** Whether an event payload passes a stream's filter. `deliver: 'matched'` (default) requires ≥1 matched subscription. */
export function matchesStreamFilter(filter: StreamFilter, event: MessageEventRecord): boolean {
  if ((filter.deliver ?? 'matched') === 'matched' && !event.subscriptionIds.length) { return false }
  if (filter.chatId && event.chatId !== filter.chatId) { return false }
  if (filter.subscriptionId && !event.subscriptionIds.includes(filter.subscriptionId)) { return false }
  if (filter.mentionedBot !== undefined && event.mentionedBot !== filter.mentionedBot) { return false }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface StreamEntry {
  id: string
  socket: Socket
  filter: StreamFilter
}

interface ConnectionState {
  decoder: LineDecoder
  malformed: number
}

/**
 * The watcher control gateway: a Unix-domain-socket server (0600) inside the watcher process exposing a
 * request/response + streaming NDJSON protocol (see types/gateway.ts). Connectability = liveness.
 */
export class WatcherGateway {
  private server?: Server
  private streams = new Map<string, StreamEntry>()
  private streamCounter = 0
  private heartbeat?: ReturnType<typeof setInterval>
  private startedAt = Date.now()

  constructor(private host: GatewayHost) {}

  public get activeStreams(): number {
    return this.streams.size
  }

  public async start(): Promise<void> {
    if (existsSync(SOCK_PATH)) {
      if (await this.isSocketAlive()) {
        throw new Error(`Another watcher gateway is already serving ${SOCK_PATH} — stop that process first`)
      }
      unlinkSync(SOCK_PATH)
    }
    await new Promise<void>((resolve, reject) => {
      const server = createServer((socket) => this.handleConnection(socket))
      server.once('error', reject)
      server.listen(SOCK_PATH, () => {
        server.off('error', reject)
        this.server = server
        resolve()
      })
    })
    chmodSync(SOCK_PATH, 0o600)
    this.startedAt = Date.now()
    this.heartbeat = setInterval(() => this.emitHeartbeat(), STREAM_HEARTBEAT_MS)
    this.heartbeat.unref?.()
    log.info(`Control gateway listening on ${SOCK_PATH}`)
  }

  public stop(): void {
    if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = undefined }
    for (const stream of this.streams.values()) { stream.socket.destroy() }
    this.streams.clear()
    if (this.server) {
      this.server.close()
      this.server = undefined
    }
    if (existsSync(SOCK_PATH)) {
      try { unlinkSync(SOCK_PATH) } catch { /* already removed */ }
    }
  }

  /** Probe an existing socket file: connectable ⇒ another live gateway owns it. */
  private isSocketAlive(): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = connect(SOCK_PATH)
      const done = (alive: boolean) => {
        probe.destroy()
        resolve(alive)
      }
      probe.once('connect', () => done(true))
      probe.once('error', () => done(false))
      probe.setTimeout(500, () => done(false))
    })
  }

  private handleConnection(socket: Socket) {
    const state: ConnectionState = { decoder: createLineDecoder(), malformed: 0 }
    socket.on('data', (chunk) => {
      for (const line of state.decoder.push(chunk)) {
        if (!line.trim()) { continue }
        void this.handleLine(socket, state, line)
      }
      if (state.decoder.overflowed) {
        log.error('Dropping connection: request line exceeded 1 MiB')
        socket.destroy()
      }
    })
    socket.on('error', () => { /* client went away mid-write — cleanup happens on close */ })
    socket.on('close', () => {
      for (const [id, stream] of this.streams) {
        if (stream.socket === socket) {
          this.streams.delete(id)
          log.info(`Stream ${id} closed (client disconnected)`)
        }
      }
    })
  }

  private async handleLine(socket: Socket, state: ConnectionState, line: string) {
    let request: GatewayRequest | undefined
    try {
      const parsed: unknown = JSON.parse(line)
      if (isRecord(parsed) && typeof parsed.id === 'string' && typeof parsed.method === 'string') {
        request = parsed as unknown as GatewayRequest
      }
    } catch { /* not JSON */ }
    if (!request) {
      state.malformed++
      if (state.malformed >= MAX_MALFORMED_FRAMES) {
        log.error(`Dropping connection after ${state.malformed} malformed frames`)
        socket.destroy()
      }
      return
    }
    if (request.v !== GATEWAY_VERSION) {
      this.respondError(socket, request.id, 'unsupported_version', `Unsupported protocol version ${request.v} — this gateway speaks v${GATEWAY_VERSION}`)
      return
    }
    try {
      const { result, after } = await this.dispatch(socket, request)
      this.write(socket, { v: GATEWAY_VERSION, id: request.id, ok: true, result } satisfies GatewayResponse)
      after?.()
    } catch (error) {
      if (error instanceof GatewayError) {
        this.respondError(socket, request.id, error.code, error.message, error.data)
      } else {
        log.error(`${request.method} failed:`, (error as Error).message)
        this.respondError(socket, request.id, 'internal', (error as Error).message)
      }
    }
  }

  private async dispatch(socket: Socket, request: GatewayRequest): Promise<{ result: unknown; after?: () => void }> {
    const params = request.params
    switch (request.method) {
      case 'ping':
        return { result: { pong: true, pid: process.pid, version: GATEWAY_VERSION, uptimeMs: Date.now() - this.startedAt } }
      case 'status':
        return { result: this.host.getLiveStatus() }
      case 'subscriptions.list':
        return { result: { subscriptions: this.host.listSubscriptions() } }
      case 'subscriptions.add': {
        if (!isRecord(params)) { throw new GatewayError('invalid_params', 'subscriptions.add expects an object of subscription fields') }
        const subscription = this.host.addSubscription(params)
        log.info(`Subscription ${subscription.id} added`)
        return { result: { subscription } }
      }
      case 'subscriptions.update': {
        if (!isRecord(params) || typeof params.id !== 'string' || !isRecord(params.patch)) {
          throw new GatewayError('invalid_params', 'subscriptions.update expects { id: string, patch: object }')
        }
        const subscription = this.host.updateSubscription(params.id, params.patch)
        log.info(`Subscription ${params.id} updated`)
        return { result: { subscription } }
      }
      case 'subscriptions.remove': {
        if (!isRecord(params) || typeof params.id !== 'string') {
          throw new GatewayError('invalid_params', 'subscriptions.remove expects { id: string }')
        }
        this.host.removeSubscription(params.id)
        log.info(`Subscription ${params.id} removed`)
        return { result: { removed: params.id } }
      }
      case 'reflex.get':
        return { result: { reflex: this.host.getReflex() } }
      case 'reflex.set': {
        if (!isRecord(params)) { throw new GatewayError('invalid_params', 'reflex.set expects an object of reflex fields') }
        const reflex = this.host.setReflex(params)
        log.info(`Reflex config applied (enabled: ${reflex.enabled})`)
        return { result: { reflex } }
      }
      case 'reconnect': {
        log.info('Reconnect requested')
        return { result: await this.host.reconnect() }
      }
      case 'subscribe': {
        if (params !== undefined && !isRecord(params)) { throw new GatewayError('invalid_params', 'subscribe expects a StreamFilter object') }
        const filter = (params ?? {}) as StreamFilter
        const streamId = `s${++this.streamCounter}`
        this.streams.set(streamId, { id: streamId, socket, filter })
        log.info(`Stream ${streamId} opened (deliver: ${filter.deliver ?? 'matched'}${filter.sinceTs ? `, replay since ${filter.sinceTs}` : ''})`)
        // Replay runs after the subscribe response is written, so the client sees { streamId } first.
        const after = filter.sinceTs ? () => this.replay(streamId, socket, filter) : undefined
        return { result: { streamId }, after }
      }
      case 'unsubscribe': {
        if (!isRecord(params) || typeof params.streamId !== 'string') {
          throw new GatewayError('invalid_params', 'unsubscribe expects { streamId: string }')
        }
        if (!this.streams.delete(params.streamId)) {
          throw new GatewayError('not_found', `No active stream with id ${params.streamId}`)
        }
        log.info(`Stream ${params.streamId} closed (unsubscribe)`)
        return { result: { closed: params.streamId } }
      }
      default:
        throw new GatewayError('not_found', `Unknown method '${request.method}'`)
    }
  }

  /** Replay matched events from events.jsonl with receivedAt >= sinceTs (inclusive — clients dedupe by messageId). */
  private replay(streamId: string, socket: Socket, filter: StreamFilter) {
    if (!existsSync(EVENTS_PATH)) { return }
    try {
      const lines = readFileSync(EVENTS_PATH, 'utf-8').split('\n').filter(Boolean)
      const matching: MessageEventRecord[] = []
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as MessageEventRecord
          if (record.receivedAt >= filter.sinceTs! && matchesStreamFilter(filter, record)) { matching.push(record) }
        } catch { /* skip corrupt line */ }
      }
      const bounded = matching.slice(-MAX_REPLAY_EVENTS)
      if (matching.length > bounded.length) {
        log.error(`Stream ${streamId}: replay truncated to the newest ${MAX_REPLAY_EVENTS} of ${matching.length} matching events`)
      }
      for (const record of bounded) {
        if (!this.streams.has(streamId)) { return }
        this.sendToStream(streamId, socket, { event: record })
      }
    } catch (error) {
      log.error(`Stream ${streamId}: replay failed:`, (error as Error).message)
    }
  }

  /** Fan an event out to all matching streams. Called by the watcher at the end of handleMessage. Never throws. */
  public emitEvent(payload: StreamMessagePayload): void {
    for (const stream of [...this.streams.values()]) {
      try {
        if (!matchesStreamFilter(stream.filter, payload.event)) { continue }
        const includeHistory = stream.filter.includeHistory ?? 0
        const history = includeHistory > 0
          ? readHistory(payload.event.chatId, includeHistory).filter((e) => e.messageId !== payload.event.messageId)
          : undefined
        this.sendToStream(stream.id, stream.socket, { ...payload, history })
      } catch (error) {
        log.error(`Stream ${stream.id}: emit failed:`, (error as Error).message)
      }
    }
  }

  /** Write a message frame with backpressure protection: a saturated socket gets an overflow frame and is closed. */
  private sendToStream(streamId: string, socket: Socket, payload: StreamMessagePayload) {
    if (socket.writableLength > MAX_STREAM_BUFFER_BYTES) {
      log.error(`Stream ${streamId}: overflow (slow consumer, ${socket.writableLength} bytes buffered) — closing`)
      this.streams.delete(streamId)
      this.write(socket, { v: GATEWAY_VERSION, kind: 'event', streamId, type: 'overflow', dropped: 1 } satisfies GatewayEventFrame)
      socket.end()
      return
    }
    this.write(socket, { v: GATEWAY_VERSION, kind: 'event', streamId, type: 'message', payload } satisfies GatewayEventFrame)
  }

  private emitHeartbeat() {
    for (const stream of [...this.streams.values()]) {
      this.write(stream.socket, { v: GATEWAY_VERSION, kind: 'event', streamId: stream.id, type: 'heartbeat' } satisfies GatewayEventFrame)
    }
  }

  private respondError(socket: Socket, id: string, code: GatewayErrorCode, message: string, data?: Record<string, unknown>) {
    this.write(socket, { v: GATEWAY_VERSION, id, ok: false, error: { code, message, data } } satisfies GatewayResponse)
  }

  private write(socket: Socket, frame: object) {
    if (socket.destroyed || !socket.writable) { return }
    try {
      socket.write(encodeFrame(frame))
    } catch (error) {
      log.error('Socket write failed:', (error as Error).message)
    }
  }
}

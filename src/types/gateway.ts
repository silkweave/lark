import { HistoryEntry, MessageEventRecord, MessageSubscription, ReflexTrigger, WatcherStatus } from './events.js'

/** Protocol version carried in every frame; the server rejects unknown versions with `unsupported_version`. */
export const GATEWAY_VERSION = 1

/** Max bytes for a single NDJSON request line before the connection is treated as malformed. */
export const MAX_LINE_BYTES = 1024 * 1024
/** Server drops a connection after this many malformed frames. */
export const MAX_MALFORMED_FRAMES = 3
/** Client-side default timeout for a single request/response roundtrip. */
export const REQUEST_TIMEOUT_MS = 10000
/** Server emits a heartbeat event frame to every stream at this interval. */
export const STREAM_HEARTBEAT_MS = 15000
/** A streaming client treats this long without any frame as a dead connection and reconnects. */
export const STREAM_DEAD_AFTER_MS = 45000
/** Upper bound on events replayed from events.jsonl for a `sinceTs` subscribe. */
export const MAX_REPLAY_EVENTS = 500
/** If a stream's socket buffer exceeds this, the stream is overflowed and closed (slow consumer). */
export const MAX_STREAM_BUFFER_BYTES = 8 * 1024 * 1024

/** Server-side error codes; `watcher_unavailable` and `timeout` are synthesised by the client. */
export type GatewayErrorCode =
  | 'unsupported_version'
  | 'invalid_params'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'internal'
  | 'watcher_unavailable'
  | 'timeout'

export type GatewayMethod =
  | 'ping'
  | 'status'
  | 'subscriptions.list'
  | 'subscriptions.add'
  | 'subscriptions.update'
  | 'subscriptions.remove'
  | 'reflex.get'
  | 'reflex.set'
  | 'reconnect'
  | 'subscribe'
  | 'unsubscribe'

export interface GatewayRequest {
  v: number
  id: string
  method: GatewayMethod | string
  params?: unknown
}

export interface GatewayErrorShape {
  code: GatewayErrorCode
  message: string
  data?: Record<string, unknown>
}

/** Response correlated to a request by `id`. Server-initiated frames carry `kind: 'event'` instead. */
export interface GatewayResponse {
  v: number
  id: string
  ok: boolean
  result?: unknown
  error?: GatewayErrorShape
}

export type GatewayEventType = 'message' | 'heartbeat' | 'overflow'

/** Unsolicited server → client frame, only sent on a connection with an active `subscribe`. */
export interface GatewayEventFrame {
  v: number
  kind: 'event'
  streamId: string
  type: GatewayEventType
  /** Present for `type: 'message'` */
  payload?: StreamMessagePayload
  /** Present for `type: 'overflow'` — events dropped before the stream was closed */
  dropped?: number
}

/** Same fields as MessageSubscription minus the server-generated `id`/`createdAt`. */
export interface SubscriptionInput {
  chatId?: string
  chatName?: string
  mentionBot?: boolean
  keywords?: string[]
  onEventCommand?: string
  webhookUrl?: string
  webhookSecret?: string
  reflexTrigger?: ReflexTrigger
}

/** Patch semantics: field present & non-null → set; `null` → clear the optional field; omitted → unchanged. */
export interface SubscriptionPatch {
  chatId?: string | null
  chatName?: string | null
  mentionBot?: boolean | null
  keywords?: string[] | null
  onEventCommand?: string | null
  webhookUrl?: string | null
  webhookSecret?: string | null
  reflexTrigger?: ReflexTrigger | null
}

/** `apiKey: ''` / `playbook: ''` clear the respective field (matches EventReflexConfigure semantics). */
export interface ReflexInput {
  enabled?: boolean
  apiKey?: string
  model?: string
  playbook?: string
  historyLimit?: number
}

/** Sanitized reflex config — never exposes the API key or playbook text. */
export interface ReflexView {
  enabled: boolean
  model: string
  hasApiKey: boolean
  hasPlaybook: boolean
  historyLimit: number
}

export interface StreamFilter {
  /** 'matched' (default) = only events matched by ≥1 subscription (events.jsonl semantics); 'all' = every inbound message */
  deliver?: 'matched' | 'all'
  /** Only events from this chat */
  chatId?: string
  /** Only events matched by this subscription */
  subscriptionId?: string
  /** Only events that did/didn't @-mention the bot */
  mentionedBot?: boolean
  /** Attach the last N history entries (excluding the trigger message) to each live payload */
  includeHistory?: number
  /**
   * Replay matched events with receivedAt >= sinceTs from events.jsonl before going live (gap-free reconnect).
   * Only matched events are persisted, so replay cannot recover unmatched messages for a `deliver: 'all'` stream.
   * The bound is inclusive to avoid same-timestamp gaps — clients dedupe by messageId.
   */
  sinceTs?: string
}

/** Outcome of the reflex for the triggering event, when the reflex ran and produced a classification. */
export interface StreamReflexInfo {
  category: 'trivial' | 'task' | 'ignore'
  replied: boolean
  replyText?: string
  /** Whether the heavy workload (onEventCommand/webhook) was dispatched for this event */
  dispatched: boolean
  /** message_id of the processing-indicator card left in the chat for a dispatched task — morphed into the bot's real reply once it lands */
  ackMessageId?: string
}

export interface StreamMessagePayload {
  event: MessageEventRecord
  /** Live frames only, when the filter sets includeHistory > 0 — never attached to replayed frames */
  history?: HistoryEntry[]
  reflex?: StreamReflexInfo
}

export interface PingResult {
  pong: true
  pid: number
  version: number
  uptimeMs: number
}

export interface SubscriptionsListResult { subscriptions: MessageSubscription[] }
export interface SubscriptionResult { subscription: MessageSubscription }
export interface SubscriptionRemoveResult { removed: string }
export interface ReflexResult { reflex: ReflexView }
export interface ReconnectResult { reconnected: true; wsConnected: boolean }
export interface SubscribeResult { streamId: string }
export interface UnsubscribeResult { closed: string }
export type StatusResult = WatcherStatus

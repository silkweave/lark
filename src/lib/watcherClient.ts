import { connect, Socket } from 'net'
import {
  GATEWAY_VERSION,
  GatewayErrorCode,
  GatewayEventFrame,
  GatewayMethod,
  GatewayResponse,
  PingResult,
  REQUEST_TIMEOUT_MS,
  StreamFilter,
  StreamMessagePayload,
  STREAM_DEAD_AFTER_MS
} from '../types/gateway.js'
import { SOCK_PATH } from './paths.js'
import { createLineDecoder, encodeFrame } from './watcherGateway.js'
import { START_HINT } from './watcherStatus.js'

/** How many recently-seen messageIds a stream remembers to dedupe `sinceTs` replay overlap. */
const DEDUPE_WINDOW = 200
const INITIAL_BACKOFF_MS = 500
const MAX_BACKOFF_MS = 30000

/** Error from a gateway roundtrip. `watcher_unavailable` / `timeout` mean the watcher itself is down or stuck. */
export class WatcherClientError extends Error {
  constructor(public code: GatewayErrorCode, message: string, public data?: Record<string, unknown>) {
    super(message)
  }
}

/** True when the error means "no live watcher answered" (down or stuck) — the caller may fall back to file reads. */
export function isWatcherUnavailable(error: unknown): boolean {
  return error instanceof WatcherClientError && (error.code === 'watcher_unavailable' || error.code === 'timeout')
}

let requestCounter = 0

/**
 * One request/response roundtrip against the running watcher's control gateway: connect, send, await the
 * correlated response, close. Throws WatcherClientError — `watcher_unavailable` (with the start hint) when
 * no watcher is listening on the socket.
 */
export function gatewayRequest<T>(method: GatewayMethod, params?: unknown, options?: { timeoutMs?: number }): Promise<T> {
  const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS
  return new Promise<T>((resolve, reject) => {
    const id = `c${++requestCounter}`
    const socket = connect(SOCK_PATH)
    const decoder = createLineDecoder()
    let settled = false
    const settle = (fn: () => void) => {
      if (settled) { return }
      settled = true
      clearTimeout(timer)
      socket.destroy()
      fn()
    }
    const timer = setTimeout(() => settle(() => reject(new WatcherClientError('timeout', `Gateway request '${method}' timed out after ${timeoutMs}ms — the watcher may be stuck`))), timeoutMs)
    timer.unref?.()
    socket.on('connect', () => {
      socket.write(encodeFrame({ v: GATEWAY_VERSION, id, method, params }))
    })
    socket.on('error', (error) => {
      settle(() => reject(new WatcherClientError('watcher_unavailable', `${START_HINT} (socket: ${error.message})`)))
    })
    socket.on('close', () => {
      settle(() => reject(new WatcherClientError('watcher_unavailable', START_HINT)))
    })
    socket.on('data', (chunk) => {
      for (const line of decoder.push(chunk)) {
        let frame: GatewayResponse
        try {
          frame = JSON.parse(line) as GatewayResponse
        } catch {
          continue
        }
        if (frame.id !== id) { continue }
        settle(() => {
          if (frame.ok) {
            resolve(frame.result as T)
          } else {
            reject(new WatcherClientError(frame.error?.code ?? 'internal', frame.error?.message ?? 'Unknown gateway error', frame.error?.data))
          }
        })
      }
    })
  })
}

/** Cheap liveness probe: can we connect and get a pong? */
export async function isWatcherAvailable(): Promise<boolean> {
  try {
    await gatewayRequest<PingResult>('ping', undefined, { timeoutMs: 2000 })
    return true
  } catch {
    return false
  }
}

export interface StreamHandle {
  close(): void
}

export interface StreamOptions {
  /** Connection lifecycle notices (connected/disconnected/overflow) — stdout stays clean for event payloads */
  onStatus?: (message: string) => void
}

/**
 * Persistent event stream from the watcher with exponential-backoff auto-reconnect. On every (re)connect it
 * re-subscribes carrying the last-seen `receivedAt` as `sinceTs`, so the gateway's replay closes any gap;
 * replay overlap is deduped by messageId. 45s without any frame (heartbeats come every 15s) ⇒ reconnect.
 */
export function streamEvents(filter: StreamFilter, onEvent: (payload: StreamMessagePayload) => void, options?: StreamOptions): StreamHandle {
  const onStatus = options?.onStatus ?? (() => {})
  let closed = false
  let socket: Socket | undefined
  let backoff = INITIAL_BACKOFF_MS
  let lastSeenTs = filter.sinceTs
  const seen: string[] = []
  const seenSet = new Set<string>()

  const remember = (messageId: string): boolean => {
    if (seenSet.has(messageId)) { return false }
    seenSet.add(messageId)
    seen.push(messageId)
    if (seen.length > DEDUPE_WINDOW) { seenSet.delete(seen.shift()!) }
    return true
  }

  let silenceTimer: ReturnType<typeof setTimeout> | undefined
  const resetSilence = () => {
    if (silenceTimer) { clearTimeout(silenceTimer) }
    silenceTimer = setTimeout(() => {
      onStatus(`No frames for ${STREAM_DEAD_AFTER_MS / 1000}s — reconnecting`)
      socket?.destroy()
    }, STREAM_DEAD_AFTER_MS)
    silenceTimer.unref?.()
  }

  const connectOnce = () => {
    if (closed) { return }
    const current = connect(SOCK_PATH)
    socket = current
    const decoder = createLineDecoder()
    current.on('connect', () => {
      backoff = INITIAL_BACKOFF_MS
      resetSilence()
      const params: StreamFilter = { ...filter, sinceTs: lastSeenTs }
      current.write(encodeFrame({ v: GATEWAY_VERSION, id: `sub${++requestCounter}`, method: 'subscribe', params }))
      onStatus(`Connected to ${SOCK_PATH}${lastSeenTs ? ` (replaying since ${lastSeenTs})` : ''}`)
    })
    current.on('data', (chunk) => {
      resetSilence()
      for (const line of decoder.push(chunk)) {
        let frame: GatewayResponse | GatewayEventFrame
        try {
          frame = JSON.parse(line) as GatewayResponse | GatewayEventFrame
        } catch {
          continue
        }
        if ('kind' in frame && frame.kind === 'event') {
          if (frame.type === 'overflow') {
            onStatus('Stream overflowed (slow consumer) — server closed it; reconnecting with sinceTs to catch up')
          } else if (frame.type === 'message' && frame.payload) {
            const event = frame.payload.event
            lastSeenTs = event.receivedAt
            if (remember(event.messageId)) { onEvent(frame.payload) }
          }
        } else if ('ok' in frame && !frame.ok) {
          onStatus(`Subscribe failed: ${frame.error?.message ?? 'unknown error'}`)
        }
      }
    })
    current.on('error', () => { /* close handler schedules the reconnect */ })
    current.on('close', () => {
      if (silenceTimer) { clearTimeout(silenceTimer) }
      if (closed) { return }
      onStatus(`Disconnected — retrying in ${backoff}ms`)
      // Not unref'd: while disconnected, this timer is the only thing keeping the process
      // alive to retry — unref'ing it let the process exit before the reconnect ever fired.
      setTimeout(connectOnce, backoff)
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
    })
  }

  connectOnce()
  return {
    close() {
      closed = true
      if (silenceTimer) { clearTimeout(silenceTimer) }
      socket?.destroy()
    }
  }
}

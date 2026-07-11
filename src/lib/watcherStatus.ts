import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { TENANT_USER_ID, TokenClient } from '../classes/TokenClient.js'
import { WatcherStatus } from '../types/events.js'
import { displayPath, PID_PATH, STATUS_PATH } from './paths.js'

/** How often the running watcher rewrites its heartbeat/status file. */
export const HEARTBEAT_MS = 10000
/** A heartbeat older than this ⇒ the watcher is considered dead or stuck, not running. */
const STALE_AFTER_MS = 35000

/**
 * How an operator or AI agent starts the watcher. It is intentionally NOT an MCP tool and NOT started by the
 * MCP server — it is a plain OS process so its lifecycle is visible and controllable from a shell.
 */
export const START_HINT =
  'No watcher process is running. The watcher is a standalone OS process (not an MCP tool, not started by the MCP server) — ' +
  'start it from a shell: `lark-serve` (installed bin) or `pnpm serve` in a dev checkout. ' +
  'It starts bare (no arguments needed) and is then configured live over its control gateway ' +
  '(EventSubscriptionCreate/Update/Delete, EventReflexConfigure, EventWatchReconnect). ' +
  '`--reflex --api-key <key> --playbook <file>` remain optional pre-seeds. ' +
  'Background it for a session (e.g. `lark-serve &`) or supervise with launchd/systemd for always-on. ' +
  `Stop it with Ctrl-C or \`kill $(cat ${displayPath(PID_PATH)})\`.`

/** Snapshot the running watcher persists to STATUS_PATH on a heartbeat and after each event. */
export interface WatcherStatusFile {
  pid: number
  startedAt: string
  heartbeatAt: string
  botName?: string
  botOpenId?: string
  counters: { received: number; matched: number; dispatched: number; errors: number }
  reflexCounters: { trivial: number; task: number; ignored: number; failed: number }
  lastError?: string
  recent: { receivedAt: string; chatId: string; text: string }[]
  wsConnected?: boolean
  activeStreams?: number
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function readPidFile(): number | undefined {
  if (!existsSync(PID_PATH)) { return undefined }
  const pid = Number(readFileSync(PID_PATH, 'utf-8').trim())
  return pid > 0 ? pid : undefined
}

function readStatusFile(): WatcherStatusFile | undefined {
  if (!existsSync(STATUS_PATH)) { return undefined }
  try {
    return JSON.parse(readFileSync(STATUS_PATH, 'utf-8')) as WatcherStatusFile
  } catch {
    return undefined
  }
}

export function writeWatcherStatus(file: WatcherStatusFile): void {
  writeFileSync(STATUS_PATH, JSON.stringify(file))
}

export function clearWatcherStatus(): void {
  if (existsSync(STATUS_PATH)) { rmSync(STATUS_PATH) }
}

/**
 * File-based watcher status: reconstructs the status from the persisted heartbeat + pidfile so every caller
 * (MCP server, CLI, the watcher itself) gets the same answer. Reads only — never starts, stops, or touches a process.
 * Subscription count and reflex config come from the live config file; counters/recent come from the heartbeat.
 */
export function readWatcherStatus(): WatcherStatus {
  const config = new TokenClient(TENANT_USER_ID).getWatcherConfig()
  const reflexConfig = config.reflex
  const file = readStatusFile()
  const pid = readPidFile()
  const alive = pid !== undefined && isProcessAlive(pid)
  const heartbeatAgeMs = file ? Date.now() - new Date(file.heartbeatAt).getTime() : Infinity
  const fresh = heartbeatAgeMs <= STALE_AFTER_MS
  const running = alive && !!file && fresh

  let notRunningReason: string | undefined
  if (!running) {
    if (alive && !fresh) {
      notRunningReason = `Watcher process ${pid} is alive but its heartbeat is ${Math.round(heartbeatAgeMs / 1000)}s stale — it may be stuck. ${START_HINT}`
    } else if (pid !== undefined && !alive) {
      notRunningReason = `Stale pidfile for dead process ${pid}. ${START_HINT}`
    } else {
      notRunningReason = START_HINT
    }
  }

  return {
    running,
    pid: running ? pid : undefined,
    startedAt: file?.startedAt,
    botName: file?.botName,
    botOpenId: file?.botOpenId,
    subscriptions: config.subscriptions.length,
    counters: file?.counters ?? { received: 0, matched: 0, dispatched: 0, errors: 0 },
    lastError: file?.lastError,
    notRunningReason,
    recent: file?.recent ?? [],
    wsConnected: running ? file?.wsConnected : undefined,
    activeStreams: running ? file?.activeStreams : undefined,
    reflex: reflexConfig ? {
      enabled: reflexConfig.enabled ?? false,
      model: reflexConfig.model ?? 'claude-haiku-4-5',
      hasApiKey: !!reflexConfig.apiKey,
      hasPlaybook: !!reflexConfig.playbook?.trim(),
      counters: file?.reflexCounters ?? { trivial: 0, task: 0, ignored: 0, failed: 0 }
    } : undefined
  }
}

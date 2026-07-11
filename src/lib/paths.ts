import { mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

/**
 * Everything the package persists lives in one XDG-style config directory:
 * `$XDG_CONFIG_HOME/silkweave-lark-mcp`, defaulting to `~/.config/silkweave-lark-mcp`.
 * Created eagerly on import so every writer (token store, history log, pidfile, gateway
 * socket) can assume it exists.
 */
export const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'silkweave-lark-mcp')
mkdirSync(CONFIG_DIR, { recursive: true })

/** App credentials, OAuth/tenant tokens and watcher config (multi-writer — every write file-locked + atomic via TokenClient.mutate). */
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json')
/** Append-only log of matched message events, written by the watcher and read by EventList + stream replay. */
export const EVENTS_PATH = join(CONFIG_DIR, 'events.jsonl')
/** Shared, cross-process rolling chat history — every inbound message, reflex reply, and agent reply (see src/lib/history.ts). */
export const HISTORY_PATH = join(CONFIG_DIR, 'history.jsonl')
/** Cross-process registry of in-flight processing-indicator cards (file-locked, multi-writer — see src/lib/pendingAcks.ts). */
export const PENDING_ACKS_PATH = join(CONFIG_DIR, 'pending-acks.json')
/** Sideloaded message attachments, one subdirectory per message id, swept by the watcher (see src/lib/attachments.ts). */
export const ATTACHMENTS_DIR = join(CONFIG_DIR, 'attachments')
/** Pidfile written by the running watcher process (lark-serve). The single source of "who is running". */
export const PID_PATH = join(CONFIG_DIR, 'watcher.pid')
/** Heartbeat/status file the running watcher rewrites so any other process can report accurate counters without owning the watcher. */
export const STATUS_PATH = join(CONFIG_DIR, 'watcher.status.json')
/** Unix domain socket the running watcher's control gateway listens on (0600; connectability = liveness). */
export const SOCK_PATH = join(CONFIG_DIR, 'watcher.sock')

/** Abbreviate the home directory to `~` for user-facing messages. */
export function displayPath(path: string): string {
  const home = homedir()
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}

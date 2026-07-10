import { closeSync, mkdirSync, openSync, rmSync, statSync, writeSync } from 'fs'
import { dirname } from 'path'

/** A lockfile untouched for longer than this is considered abandoned (crashed holder) and taken over. */
const STALE_LOCK_MS = 10000
/** Total time to wait for the lock before giving up. */
const ACQUIRE_TIMEOUT_MS = 5000
const RETRY_DELAY_MS = 25

/** Synchronous sleep without spinning the CPU (Atomics.wait on a throwaway shared buffer). */
function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function tryAcquire(lockPath: string): boolean {
  try {
    const fd = openSync(lockPath, 'wx')
    writeSync(fd, String(process.pid))
    closeSync(fd)
    return true
  } catch {
    return false
  }
}

function isStale(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS
  } catch {
    // Lockfile vanished between attempts — the next acquire attempt settles it
    return false
  }
}

/**
 * Run fn while holding an advisory O_EXCL lockfile at `<path>.lock`, serializing read-modify-write cycles
 * on `path` across processes (MCP servers, the watcher, spawned agents). The lock is held only for the
 * duration of fn — keep fn short (a file read + write).
 */
export function withFileLock<T>(path: string, fn: () => T): T {
  const lockPath = `${path}.lock`
  mkdirSync(dirname(lockPath), { recursive: true })
  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS
  while (!tryAcquire(lockPath)) {
    if (isStale(lockPath)) {
      try { rmSync(lockPath) } catch { /* lost the takeover race — retry */ }
      continue
    }
    if (Date.now() > deadline) { throw new Error(`Timed out waiting for file lock ${lockPath}`) }
    sleepSync(RETRY_DELAY_MS)
  }
  try {
    return fn()
  } finally {
    try { rmSync(lockPath) } catch { /* already removed */ }
  }
}

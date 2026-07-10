import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { withFileLock } from '../src/lib/fileLock.js'

const tsxCli = createRequire(import.meta.url).resolve('tsx/cli')
const workerPath = fileURLToPath(new URL('./helpers/lockWorker.ts', import.meta.url))

test('withFileLock runs the function and releases the lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lock-'))
  const target = join(dir, 'store.json')
  const result = withFileLock(target, () => 42)
  assert.equal(result, 42)
  assert.throws(() => statSync(`${target}.lock`)) // released
  rmSync(dir, { recursive: true, force: true })
})

test('withFileLock takes over a stale lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lock-'))
  const target = join(dir, 'store.json')
  const lockPath = `${target}.lock`
  writeFileSync(lockPath, '99999')
  const past = (Date.now() - 60000) / 1000
  utimesSync(lockPath, past, past) // make the lock look abandoned
  const result = withFileLock(target, () => 'ok')
  assert.equal(result, 'ok')
  rmSync(dir, { recursive: true, force: true })
})

test('concurrent read-modify-write from multiple processes loses no updates', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lock-'))
  const target = join(dir, 'counter.json')
  writeFileSync(target, '{"count":0}')
  const WORKERS = 4
  const INCREMENTS = 25
  await Promise.all(Array.from({ length: WORKERS }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, workerPath, target, String(INCREMENTS)], { stdio: ['ignore', 'ignore', 'inherit'] })
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker exited ${code}`)))
    child.on('error', reject)
  })))
  const { count } = JSON.parse(readFileSync(target, 'utf-8'))
  assert.equal(count, WORKERS * INCREMENTS)
  rmSync(dir, { recursive: true, force: true })
})

// Child process for the fileLock concurrency test: performs N locked read-modify-write increments.
import { readFileSync, writeFileSync } from 'node:fs'
import { withFileLock } from '../../src/lib/fileLock.js'

const [target, incrementsArg] = process.argv.slice(2)
const increments = Number(incrementsArg)

for (let i = 0; i < increments; i++) {
  withFileLock(target, () => {
    const state = JSON.parse(readFileSync(target, 'utf-8')) as { count: number }
    state.count++
    writeFileSync(target, JSON.stringify(state))
  })
}

import { displayPath, SOCK_PATH } from './lib/paths.js'
import { streamEvents } from './lib/watcherClient.js'
import { StreamFilter } from './types/gateway.js'

const USAGE = `lark-listen — stream watcher events as NDJSON (one JSON payload per line on stdout)

Connects to the running lark-serve watcher's control gateway (${displayPath(SOCK_PATH)}) and prints each
matching event as it arrives. Auto-reconnects with sinceTs replay, so delivery is gap-free across
watcher restarts. Connection notices go to stderr; stdout carries only event payloads.

Usage: lark-listen [options]

Options:
  --all                 Deliver every inbound message the bot sees (default: only subscription-matched events)
  --chat <chatId>       Only events from this chat
  --subscription <id>   Only events matched by this subscription
  --mentioned           Only events that @-mention the bot
  --history <n>         Attach the last n history entries to each live payload
  --since <iso>         Replay matched events received at/after this ISO 8601 timestamp before going live
  -h, --help            Show this help`

function parseArgs(argv: string[]): { filter: StreamFilter; help: boolean } {
  const filter: StreamFilter = {}
  let help = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '-h': case '--help': help = true; break
      case '--all': filter.deliver = 'all'; break
      case '--chat': filter.chatId = next(); break
      case '--subscription': filter.subscriptionId = next(); break
      case '--mentioned': filter.mentionedBot = true; break
      case '--history': filter.includeHistory = Number(next()); break
      case '--since': filter.sinceTs = next(); break
      default: console.error(`[lark-listen] Unknown argument: ${arg}`)
    }
  }
  return { filter, help }
}

function main() {
  const { filter, help } = parseArgs(process.argv.slice(2))
  if (help) { console.log(USAGE); return }
  const handle = streamEvents(
    filter,
    (payload) => console.log(JSON.stringify(payload)),
    { onStatus: (message) => console.error('[lark-listen]', message) }
  )
  const shutdown = () => {
    handle.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()

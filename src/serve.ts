import { readFileSync } from 'fs'
import { TENANT_USER_ID, TokenClient } from './classes/TokenClient.js'
import { messageWatcher } from './lib/messageWatcher.js'
import { ReflexConfig } from './types/events.js'

const USAGE = `lark-serve — Lark message watcher + reflex fast-responder

Usage: lark-serve [options]

Reflex options (all optional; persisted to ~/.silkweave-lark.json):
  --reflex, --enable-reflex     Enable the Haiku reflex fast-responder
  --no-reflex, --disable-reflex Disable the reflex
  --api-key <key>               Anthropic API key for the reflex (required whenever reflex is enabled)
  --model <id>                  Anthropic model for the reflex (default claude-haiku-4-5)
  --playbook <file>             Load reflex playbook/context from a text file
  --playbook-text <text>        Set the reflex playbook/context inline
  --emoji <key>                 Lark emoji key for the instant reaction (default Typing)
  --history-limit <n>           Recent chat messages to include as reflex context (default 15)
  -h, --help                    Show this help`

function parseArgs(argv: string[]): { reflex: Partial<ReflexConfig>; help: boolean } {
  const reflex: Partial<ReflexConfig> = {}
  let help = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => argv[++i]
    switch (arg) {
      case '-h': case '--help': help = true; break
      case '--reflex': case '--enable-reflex': reflex.enabled = true; break
      case '--no-reflex': case '--disable-reflex': reflex.enabled = false; break
      case '--api-key': reflex.apiKey = next(); break
      case '--model': reflex.model = next(); break
      case '--emoji': reflex.reactionEmoji = next(); break
      case '--history-limit': reflex.historyLimit = Number(next()); break
      case '--playbook-text': reflex.playbook = next(); break
      case '--playbook': {
        const file = next()
        if (file) { reflex.playbook = readFileSync(file, 'utf-8') }
        break
      }
      default: console.error(`[silkweave-lark] Unknown argument: ${arg}`)
    }
  }
  return { reflex, help }
}

async function main() {
  const { reflex, help } = parseArgs(process.argv.slice(2))
  if (help) { console.log(USAGE); return }

  const tokenClient = new TokenClient(TENANT_USER_ID)

  // Merge any reflex overrides from the CLI into the persisted config before starting.
  if (Object.keys(reflex).length) {
    const current = tokenClient.getWatcherConfig().reflex ?? {}
    tokenClient.setWatcherConfig({ reflex: { ...current, ...reflex } })
  }

  const config = tokenClient.getWatcherConfig()
  if (!config.subscriptions.length) {
    console.error('[silkweave-lark] No subscriptions configured yet — add one live via EventSubscriptionCreate (MCP) or the control gateway once the watcher is up (until then, events are not recorded)')
  }
  const status = await messageWatcher.start()
  console.log(`[silkweave-lark] Message watcher running (pid ${process.pid}, bot: ${status.botName ?? 'unknown'}, ${status.subscriptions} subscriptions, gateway: ~/.silkweave-lark.watcher.sock)`)
  if (status.reflex) {
    console.log(`[silkweave-lark] Reflex ${status.reflex.enabled ? 'enabled' : 'disabled'} (model: ${status.reflex.model}, apiKey: ${status.reflex.hasApiKey ? 'set' : 'missing'}, playbook: ${status.reflex.hasPlaybook ? 'set' : 'none'})`)
  }
  const shutdown = () => {
    messageWatcher.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  console.error(`[silkweave-lark] ${error.message}`)
  process.exit(1)
})

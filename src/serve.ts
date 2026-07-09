import { TENANT_USER_ID, TokenClient } from './classes/TokenClient.js'
import { messageWatcher } from './lib/messageWatcher.js'

async function main() {
  const config = new TokenClient(TENANT_USER_ID).getWatcherConfig()
  if (!config.subscriptions.length) {
    console.error('[silkweave-lark] No subscriptions configured — create one via EventSubscriptionCreate first (events would not be recorded)')
  }
  const status = await messageWatcher.start()
  console.log(`[silkweave-lark] Message watcher running (pid ${process.pid}, bot: ${status.botName ?? 'unknown'}, ${status.subscriptions} subscriptions)`)
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

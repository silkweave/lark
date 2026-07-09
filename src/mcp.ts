import { silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'
import { actions } from './actions/index.js'
import { TENANT_USER_ID, TokenClient } from './classes/TokenClient.js'
import { messageWatcher } from './lib/messageWatcher.js'
import { VERSION } from './lib/version.js'

async function maybeAutoStartWatcher() {
  const config = new TokenClient(TENANT_USER_ID).getWatcherConfig()
  if (!config.autoStart) {
    messageWatcher.setNotRunningReason('autoStart is disabled — start via EventWatchStart or run the standalone lark-serve service')
    return
  }
  if (!config.subscriptions.length) {
    messageWatcher.setNotRunningReason('autoStart is enabled but no subscriptions are configured — create one via EventSubscriptionCreate')
    return
  }
  try {
    await messageWatcher.start()
    console.error('[silkweave-lark] Message watcher auto-started')
  } catch (error) {
    messageWatcher.setNotRunningReason(`auto-start failed: ${(error as Error).message}`)
    console.error(`[silkweave-lark] Watcher auto-start failed: ${(error as Error).message}`)
  }
}

async function main() {
  await silkweave({ name: 'silkweave-lark', description: 'Lark/Feishu MCP. All tools accept a userId parameter selecting the auth identity: \'tenant\' uses the app\'s Tenant Access Token (act as the bot, no user login), any other value is a token store key for a user\'s OAuth token (default: \'default\').', version: VERSION })
    .adapter(stdio())
    .actions(actions)
    .start()
  await maybeAutoStartWatcher()
}

main()

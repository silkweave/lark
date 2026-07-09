import { silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'
import { actions } from './actions/index.js'
import { VERSION } from './lib/version.js'

// The message watcher (im.message.receive_v1 subscriptions + reflex) is a SEPARATE OS process — `lark-serve` — never
// started by this MCP server. That keeps the bot's lifecycle independent of any client connection and avoids sharing
// the MCP stdio process. Start it from a shell (`lark-serve`), check it with EventWatchStatus. This server is tools only.
async function main() {
  await silkweave({ name: 'silkweave-lark', description: 'Lark/Feishu MCP. All tools accept a userId parameter selecting the auth identity: \'tenant\' uses the app\'s Tenant Access Token (act as the bot, no user login), any other value is a token store key for a user\'s OAuth token (default: \'default\'). The message watcher/reflex runs as a standalone `lark-serve` process (not this server); check it via EventWatchStatus.', version: VERSION })
    .adapter(stdio())
    .actions(actions)
    .start()
}

main()

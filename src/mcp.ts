import { silkweave } from '@silkweave/core'
import { stdio } from '@silkweave/mcp'
import { actions } from './actions/index.js'
import { VERSION } from './lib/version.js'

async function main() {
  await silkweave({ name: 'silkweave-lark', description: 'Lark MCP', version: VERSION })
    .adapter(stdio())
    .actions(actions)
    .start()
}

main()

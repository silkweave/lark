import { cli } from '@silkweave/cli'
import { silkweave } from '@silkweave/core'
import { actions } from './actions/index.js'
import { VERSION } from './lib/version.js'

async function main() {
  await silkweave({ name: 'silkweave-lark', description: 'Lark MCP', version: VERSION })
    .adapter(cli())
    .actions(actions)
    .start()
}

main()

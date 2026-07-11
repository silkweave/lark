import { createAction } from '@silkweave/core'
import z from 'zod'
import { gatewayRequest } from '../../lib/watcherClient.js'
import { ReflexResult } from '../../types/gateway.js'

export const EventReflexConfigure = createAction({
  name: 'eventReflexConfigure',
  description: 'Configure the Haiku "reflex" fast-response dispatcher, applied live on the RUNNING watcher over its control gateway (fails if no `lark-serve` watcher process is running — start it bare first, then configure). When enabled, a direct @-mention of the bot (or a reply in a mention-started thread) is instantly acknowledged with a small "working on it" spinner card, then classified by a fast Anthropic model: trivial questions morph the card into the answer, real tasks keep the card until the heavy workload\'s reply morphs it into the reply text (dispatched via the subscription\'s onEventCommand/webhook), and mistaken/passing mentions morph it into a minimal "👍" note. Requires an Anthropic API key, persisted to ~/.config/silkweave-lark-mcp/config.json via the apiKey field — pass it here, or set it before enabling. Only the fields you pass are changed.',
  input: z.object({
    enabled: z.boolean().optional().describe('Turn the reflex on or off'),
    apiKey: z.string().optional().describe('Anthropic API key, persisted to ~/.config/silkweave-lark-mcp/config.json. Required whenever reflex is enabled. Pass an empty string to clear.'),
    model: z.string().optional().describe('Anthropic model id for the reflex (default claude-haiku-4-5)'),
    playbook: z.string().optional().describe('Text-only context/playbook injected into the reflex system prompt — rules, background, tone. Pass an empty string to clear.'),
    historyLimit: z.number().int().optional().describe('Number of recent chat history entries (any sender) to include as context for the classifier (default 15)')
  }),
  run: async (input) => {
    const { reflex } = await gatewayRequest<ReflexResult>('reflex.set', input)
    return { reflex }
  }
})

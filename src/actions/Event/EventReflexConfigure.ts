import { createAction } from '@silkweave/core'
import z from 'zod'
import { TENANT_USER_ID, TokenClient } from '../../classes/TokenClient.js'
import { messageWatcher } from '../../lib/messageWatcher.js'
import { ReflexConfig } from '../../types/events.js'

export const EventReflexConfigure = createAction({
  name: 'eventReflexConfigure',
  description: 'Configure the Haiku "reflex" fast-response dispatcher. When enabled, a direct @-mention of the bot (or a reply in a mention-started thread) is instantly acknowledged with an emoji reaction, then classified by a fast Anthropic model: trivial questions are answered inline, real tasks get a quick "working on it" reply plus the subscription\'s onEventCommand (the heavy workload), and mistaken/passing mentions are ignored. Requires an Anthropic API key, persisted to ~/.silkweave-lark.json via the apiKey field — pass it here, or set it before enabling. Only the fields you pass are changed. Restart the watcher (or it re-reads config live) for changes to apply.',
  input: z.object({
    enabled: z.boolean().optional().describe('Turn the reflex on or off'),
    apiKey: z.string().optional().describe('Anthropic API key, persisted to ~/.silkweave-lark.json. Required whenever reflex is enabled. Pass an empty string to clear.'),
    model: z.string().optional().describe('Anthropic model id for the reflex (default claude-haiku-4-5)'),
    playbook: z.string().optional().describe('Text-only context/playbook injected into the reflex system prompt — rules, background, tone. Pass an empty string to clear.'),
    reactionEmoji: z.string().optional().describe('Lark emoji key for the instant acknowledgement reaction (default Typing)'),
    historyLimit: z.number().int().optional().describe('Number of recent chat history entries (any sender) to include as context for the classifier (default 15)')
  }),
  run: async ({ enabled, apiKey, model, playbook, reactionEmoji, historyLimit }) => {
    const client = new TokenClient(TENANT_USER_ID)
    const reflex: ReflexConfig = { ...client.getWatcherConfig().reflex }
    if (enabled !== undefined) { reflex.enabled = enabled }
    if (apiKey !== undefined) { reflex.apiKey = apiKey }
    if (model !== undefined) { reflex.model = model }
    if (playbook !== undefined) { reflex.playbook = playbook }
    if (reactionEmoji !== undefined) { reflex.reactionEmoji = reactionEmoji }
    if (historyLimit !== undefined) { reflex.historyLimit = historyLimit }
    if (reflex.enabled && !reflex.apiKey) {
      throw new Error('Reflex cannot be enabled without an apiKey — pass one now or set it in a prior call')
    }
    client.setWatcherConfig({ reflex })
    return {
      reflex: {
        enabled: reflex.enabled ?? false,
        model: reflex.model ?? 'claude-haiku-4-5',
        reactionEmoji: reflex.reactionEmoji ?? 'Typing',
        playbookChars: reflex.playbook?.trim().length ?? 0
      },
      hasApiKey: !!reflex.apiKey,
      watcher: messageWatcher.getStatus()
    }
  }
})

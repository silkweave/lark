export interface MessageSubscription {
  id: string
  /** Restrict to a specific chat; omit to match messages from all chats the bot is in */
  chatId?: string
  /** Human-readable chat name, informational only */
  chatName?: string
  /** Only match messages that @-mention the bot */
  mentionBot?: boolean
  /** Only match messages containing at least one of these keywords (case-insensitive) */
  keywords?: string[]
  /** Shell command spawned (detached) for each matching message, with event details in env vars */
  onEventCommand?: string
  /** POST { subscriptionId, event, history } to this URL for each matching message — an alternative/addition to onEventCommand for a persistent listener (e.g. a webhook server backing a long-running agent) instead of spawning a process per message */
  webhookUrl?: string
  /** Sent as the X-Silkweave-Signature header on webhook requests so the receiver can verify authenticity */
  webhookSecret?: string
  createdAt: string
}

/** Config for the Haiku "reflex" fast-response dispatcher (see src/lib/reflex.ts) */
export interface ReflexConfig {
  /** Enable the reflex: on a direct @-mention (or a reply in a mention-started thread), classify the message and respond instantly */
  enabled?: boolean
  /** Anthropic API key for the reflex, persisted to ~/.silkweave-lark.json. Required whenever reflex is enabled. */
  apiKey?: string
  /** Anthropic model id for the reflex (default 'claude-haiku-4-5') */
  model?: string
  /** Text-only playbook/context injected into the reflex system prompt — rules, background, tone, anything the fast responder should know */
  playbook?: string
  /** Emoji reaction key added instantly to the user's message to acknowledge receipt (default 'Typing') */
  reactionEmoji?: string
  /** Number of recent chat history entries (any sender) to include as context for the classifier (default 15) */
  historyLimit?: number
}

export interface WatcherConfig {
  subscriptions: MessageSubscription[]
  reflex?: ReflexConfig
}

/** Who authored a history entry: a real chat member, the reflex fast-responder, or the delegated background agent */
export type HistoryRole = 'user' | 'reflex' | 'agent'

/** A single message recorded to the shared, cross-process chat history log (see src/lib/history.ts) */
export interface HistoryEntry {
  chatId: string
  messageId: string
  rootId?: string
  threadId?: string
  /** The message this one directly replies to, if any */
  parentId?: string
  role: HistoryRole
  /** Sender's open_id, present for role 'user' */
  senderOpenId?: string
  text: string
  /** Epoch milliseconds as a string, consistent with Lark's message create_time */
  createTime: string
}

export interface MessageEventRecord {
  receivedAt: string
  subscriptionIds: string[]
  chatId: string
  chatType: string
  messageId: string
  rootId?: string
  threadId?: string
  messageType: string
  /** Plain text extracted from the message content (mention placeholders resolved to names) */
  text: string
  /** Raw Lark content JSON string */
  content: string
  senderOpenId?: string
  senderType: string
  mentionedBot: boolean
  mentions: { name: string; openId?: string }[]
  createTime: string
}

export interface WatcherStatus {
  running: boolean
  pid?: number
  startedAt?: string
  botName?: string
  botOpenId?: string
  subscriptions: number
  counters: { received: number; matched: number; dispatched: number; errors: number }
  lastError?: string
  /** When running is false, a human/agent-readable explanation including how to start the watcher */
  notRunningReason?: string
  recent: { receivedAt: string; chatId: string; text: string }[]
  /** Reflex dispatcher status (present when a reflex config exists) */
  reflex?: {
    enabled: boolean
    model: string
    reactionEmoji: string
    hasApiKey: boolean
    hasPlaybook: boolean
    counters: { trivial: number; task: number; ignored: number; failed: number }
  }
}

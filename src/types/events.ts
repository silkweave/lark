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
  createdAt: string
}

export interface WatcherConfig {
  /** Auto-start the watcher when the MCP server boots */
  autoStart?: boolean
  subscriptions: MessageSubscription[]
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
  notRunningReason?: string
  /** Set when a watcher is running in a different process (e.g. the standalone service) */
  externalPid?: number
  recent: { receivedAt: string; chatId: string; text: string }[]
}

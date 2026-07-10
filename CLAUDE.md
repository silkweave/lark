# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build:** `pnpm build` (uses tsdown, outputs to `build/`)
- **Lint:** `pnpm lint` (eslint) + `pnpm typecheck` (tsc --noEmit), or both via `pnpm check`
- **Test:** `pnpm test` (node:test via tsx, `tests/*.test.ts`; covers gateway framing/patch/filter logic, the file lock, and the pending-acks registry)
- **Clean:** `pnpm clean`
- **Run MCP server (dev):** `pnpm tsx src/mcp.ts`
- **Run CLI (dev):** `pnpm tsx src/cli.ts`
- **Run message watcher service (dev):** `pnpm serve` (standalone `lark-serve` entrypoint). Starts **bare** — no arguments needed; everything is configured live over the control gateway afterward. Optional reflex pre-seed flags: `--reflex`/`--no-reflex`, `--api-key <key>`, `--model <id>`, `--playbook <file>`, `--playbook-text <text>`, `--history-limit <n>` (also `--help`). Reflex needs an Anthropic API key persisted to `~/.silkweave-lark.json` (set via `--api-key` or `EventReflexConfigure`) — enabling reflex without one throws.
- **Stream watcher events (dev):** `pnpm listen` (standalone `lark-listen` entrypoint) — NDJSON event stream from the running watcher. Flags: `--all`, `--chat <id>`, `--subscription <id>`, `--mentioned`, `--history <n>`, `--since <iso>`.

pnpm v11 config (`overrides` for the zod pin, `onlyBuiltDependencies`) lives in `pnpm-workspace.yaml`, not package.json.

## Architecture

This is `@silkweave/lark` — a Lark/Feishu document parser that exposes both an MCP server and a CLI. It uses [silkweave](https://www.npmjs.com/package/silkweave) to define actions that are mounted as MCP tools or CLI commands.

### Entry Points

- `src/index.ts` — library exports (DocxParser, TokenClient, API helpers, watcherClient/`streamEvents`, gateway protocol types)
- `src/mcp.ts` — MCP server (stdio transport via silkweave); **tools only — it never starts the message watcher** (the watcher is a separate `lark-serve` process, by design)
- `src/cli.ts` — CLI (same actions, cli transport via silkweave)
- `src/serve.ts` — standalone message watcher service (`lark-serve` bin); keeps event subscriptions alive independently of any MCP client
- `src/listen.ts` — event streaming CLI (`lark-listen` bin); persistent NDJSON stream of watcher events over the control gateway

### Running the watcher (important architectural rule)

The watcher is **always a separate OS process** (`lark-serve`). Starting/stopping a process is **never** an MCP tool and the MCP server never runs the watcher in-process — this avoids sharing the MCP stdio process, keeps the bot's lifecycle independent of any client session, and eliminates pidfile races. There are no `EventWatchStart`/`EventWatchStop` tools.

- **Start:** `lark-serve` (installed) or `pnpm serve` (dev) — **bare, no arguments**; backgrounded from a shell or supervised by launchd/systemd/pm2 for always-on. Configuration happens live over the gateway; `--reflex --api-key <key> --playbook <file>` remain optional pre-seeds.
- **Stop:** `Ctrl-C`, or `kill $(cat ~/.silkweave-lark.watcher.pid)`.
- **AI agents:** spawn it as a background shell process, then poll `EventWatchStatus`; when it's down, `EventWatchStatus.notRunningReason` carries the exact start command (`START_HINT` in `src/lib/watcherStatus.ts`).

### The control gateway (how everything talks to the watcher)

While running, the watcher hosts a **WatcherGateway** (`src/lib/watcherGateway.ts`): a Unix-domain-socket server at `~/.silkweave-lark.watcher.sock` (0600, `SOCK_PATH` in `watcherStatus.ts`) speaking NDJSON request/response + event streaming (protocol types + limits in `src/types/gateway.ts`, version field `v: 1`). Methods: `ping`, `status` (live, includes `wsConnected`/`activeStreams`), `subscriptions.list/add/update/remove`, `reflex.get/set`, `reconnect` (rebuild the Lark WS without dropping streams), `subscribe`/`unsubscribe` (live event stream with filters, `sinceTs` replay from `events.jsonl`, per-stream backpressure → `overflow` frame + close, 15s heartbeats).

Rules that matter when editing:

- **The running watcher is the single applier of `watcher.*` config.** MCP `Event*` tools are thin clients (`src/lib/watcherClient.ts` — `gatewayRequest()`, `streamEvents()` with auto-reconnect + messageId dedupe). Mutations (`EventSubscriptionCreate/Update/Delete`, `EventReflexConfigure`, `EventWatchReconnect`) **hard-fail with `START_HINT` when the watcher is down** — never write config directly from a tool. Read-only tools (`EventWatchStatus`, `EventSubscriptionList`) fall back to file reads.
- **Events are emitted to streams only after `handleMessage` finishes** (so the payload can carry the reflex outcome: `category`/`replied`/`replyText`/`dispatched`/`ackMessageId`). Unmatched messages still go to `deliver: 'all'` streams but are never persisted — so `sinceTs` replay is gap-free for matched events only.
- **`TokenClient` writes are file-locked + atomic.** Every mutation goes through `mutate()`: re-read `~/.silkweave-lark.json` under `withFileLock` (`src/lib/fileLock.ts`, O_EXCL lockfile, 10s stale takeover), apply to fresh state, temp+rename write. The store is multi-writer (MCP OAuth, watcher token refresh) — never bypass this with a plain `writeFileSync`.
- **Subscription update patch semantics:** field present → set, `null` → clear, omitted → unchanged (`applySubscriptionPatch` in `watcherGateway.ts`).

### Core Classes

- **`TokenClient`** — manages per-user OAuth tokens and the tenant token (read/write to `~/.silkweave-lark.json`). Constructed with a store key (`userId`); the sentinel key `'tenant'` (`TENANT_USER_ID`) selects the app's Tenant Access Token (bot identity). Actions call `withAuth()`, which dispatches to `withUser()` (user access token) or `withTenant()` (tenant access token) based on the key. The shared `userIdSchema()` helper in `src/lib/auth.ts` provides the zod input schema + agent-facing description for the `userId` parameter; `ImMessageSend`/`ImMessageReply` default it to `'tenant'`.
- **`DocxParser`** — converts Lark document blocks to Markdown. Uses a block parser registry (`src/parser/`) where each block type (text, heading, list, table, callout, etc.) has a dedicated parse function.
- **`MessageWatcher`** (`src/lib/messageWatcher.ts`, singleton `messageWatcher`) — receives `im.message.receive_v1` events over Lark's WebSocket long connection (no public URL). Matches events against subscriptions persisted in `~/.silkweave-lark.json` (re-read per event, so cross-process changes apply live), appends matches to `~/.silkweave-lark.events.jsonl`, and dispatches the heavy workload via whichever of two mechanisms the subscription has set (both may be set): `onEventCommand` (a shell command spawned detached, given the event + history via `LARK_*` env vars, including `LARK_ACK_MESSAGE_ID` when a processing-indicator card is pending) and/or `webhookUrl` (an HTTP POST of `{ subscriptionId, event, history, ackMessageId? }`, with an optional `X-Silkweave-Signature: webhookSecret` header — for a persistent listener, e.g. a webhook server backing a long-running agent, instead of spawning a process per message; fire-and-forget with a 10s timeout, failures counted in `counters.errors`, never thrown). A pidfile (`~/.silkweave-lark.watcher.pid`) prevents two watchers running at once, and the running watcher rewrites a heartbeat/status file (`~/.silkweave-lark.watcher.status.json`) every `HEARTBEAT_MS` (10s) and after each event, so `EventWatchStatus` reports live counters read from that file regardless of which process asks (see `src/lib/watcherStatus.ts`, `readWatcherStatus`). Tracks "engaged" threads in memory (any message that directly @-mentions the bot, plus its root/thread ids) so later replies in a mention-started thread count as addressed to the bot without a re-mention. All watcher logging goes to stderr (stdout is the MCP protocol).
- **Reflex** (`src/lib/reflex.ts`, `runReflex`) — the fast-response dispatcher. When `reflex.enabled` is set in the watcher config and a matched message is *engaged* (direct @-mention or reply in a mention-started thread, OR a matched subscription's `reflexTrigger` opts it in — see below), the watcher: (1) instantly replies with the **processing-indicator card** (see Indicator below) as a zero-latency ack, (2) classifies the message with a fast Anthropic model (default `claude-haiku-4-5`, via a raw `fetch` to `/v1/messages` with a forced `classify` tool_use), using recent chat history (see below) as context. Outcomes: `trivial` → the card morphs into Haiku's answer; `task` → the card's text is patched to the classifier's acknowledgement, registered as a pending ack, and the watcher spawns the subscription's `onEventCommand`/webhook (the heavy workload) — the card stays until the workload's real reply morphs it; `ignore` (mistaken/passing mention) → the card morphs into a minimal "👍" note. On any failure it falls back safe (spawns the workload with the card left pending, never drops the message). Requires an Anthropic API key in `reflex.apiKey`, persisted to `~/.silkweave-lark.json`; both `EventReflexConfigure` and `MessageWatcher.start()` throw if reflex is enabled without one. An optional text `playbook` (rules/background/tone) is injected into the reflex system prompt. Config is set via `EventReflexConfigure` or `lark-serve` flags; the reflex never gets tool access — it only classifies and replies. **Per-subscription trigger override:** a `MessageSubscription` may set `reflexTrigger: { alwaysEngage?, keywords? }` (patchable live via `EventSubscriptionCreate`/`Update`, same as every other subscription field) to pull its matched messages into reflex engagement without requiring an @-mention — additive to the global mention/thread gate, never a restriction of it. Note this only governs *reflex* engagement; unmatched messages (no subscription covers the chat/criteria) still get no reflex, no dispatch, and no user-visible signal at all — only the unconditional history log records them.
- **Indicator** (`src/lib/indicator.ts` + `src/lib/pendingAcks.ts`) — the "working on it" processing indicator: a minimal single-line note card (animated bouncing-ball icon + muted text) sent as a reply to the triggering message. The animation is a 64×64 animated WebP on the dark-mode card color `#292929` (the note-row icon slot is square and composites transparency onto white, so the background must be baked in), embedded base64 in `src/lib/indicatorAsset.ts`, uploaded to Lark once and cached as `watcher.indicatorImage` in `~/.silkweave-lark.json` keyed by `INDICATOR_ASSET_VERSION` — bump the version when regenerating the asset. **A card must never outlive its task, and is never recalled** (Lark shows a "recalled a message" tombstone) — it is always *patched* into a final state: a bot text `ImMessageReply` to the trigger message **morphs the card into the reply itself** (`resolveIndicatorWithReply` — no extra message is sent, the action returns the card's `message_id` with `morphedIndicator: true`); other bot sends resolve remaining cards in the chat to a muted "✓ Done" note (`clearPendingIndicators`); a watcher heartbeat sweep resolves cards older than 10 minutes to a "✕ No response" note. Task cards are tracked in `~/.silkweave-lark.pending-acks.json` (file-locked, multi-writer — same discipline as the token store). Dispatched workloads receive the card's id as `LARK_ACK_MESSAGE_ID` / webhook `ackMessageId` if they want to manage it themselves.
- **Attachments** (`src/lib/attachments.ts`) — sideloading of message resources. `extractMessageText` renders any message type as plain text (mentions resolved; `post` rich text flattened with inline `[image]`/`[video: …]` placeholders; attachment-only types become `[image]`/`[file: name]`/etc.); `extractAttachmentRefs` pulls downloadable resource refs from `image`/`file`/`media`/`audio`/`post` content (stickers excluded). When a chat is covered by ≥1 subscription (chat filter only — mention/keyword gates ignored), the watcher downloads each ref via `GET /im/v1/messages/:id/resources/:key` (tenant token; needs the `im:resource` app permission) to `~/.silkweave-lark.attachments/<messageId>/` **before** the history append, so the sideloaded `path`s ride on the event record (`attachments`), the webhook payload, `LARK_ATTACHMENTS_JSON`, and history entries (`formatHistory` renders `[attached: <path>]`) — a delegated agent can read the local file directly (e.g. image sent first, "what animal is this?" asked after). Downloads are best-effort (logged, never block handling; 100MB cap; filenames sanitized via basename + dot-strip). The watcher heartbeat sweeps per-message directories older than 7 days (hourly throttle). Note the reflex engagement gate accepts `message_type` `text` **and** `post` (Lark delivers image+text as one `post` message); the classifier is told attachment names but cannot see contents, so anything requiring them is classified `task`.
- **History** (`src/lib/history.ts`) — a shared, cross-process rolling chat log at `~/.silkweave-lark.history.jsonl` (append-only, self-trimming). Every inbound message the watcher sees (matched or not) is recorded with `role: 'user'`; reflex's own replies are recorded with `role: 'reflex'` from `messageWatcher.ts`; `ImMessageSend`/`ImMessageReply` record their sends with `role: 'agent'` (best-effort, from whichever process calls them — MCP server, CLI, or a spawned `onEventCommand`). Reflex reads the last `reflex.historyLimit` entries (default 15) per chat as classification context; dispatched `onEventCommand`s get the last 20 as `LARK_HISTORY_JSON` (alongside `LARK_EVENT_JSON`) so the delegated agent has the same context. Entries carry `parentId`/`rootId`/`threadId` for reply/thread ordering; `formatHistory()` renders a chronological, role-labeled transcript.

### Actions (`src/actions/`)

Actions are defined with `createAction()` from silkweave (zod schema for input, run function). Groups:
- **Authen** — OAuth flow: authorize URL, token exchange, user info
- **Bitable** — Base apps, tables, fields, records (CRUD)
- **Contact** — organization user listing
- **Docx** — document export (to Markdown), import (from Markdown), block listing
- **Event** — message subscriptions (create/update/list/delete), watcher status + WS reconnect, event log reading, reflex config (`EventReflexConfigure`) — all mutations routed through the watcher gateway
- **Im** — chat listing, search, message send/reply
- **Wiki** — space listing, node listing, node details, node creation

All actions are registered in `src/actions/index.ts`.

### Block Parser System (`src/parser/`)

DocxParser registers a parse function per `BlockType` enum value. Parsers receive the block, the parser instance (for recursive child processing), and depth. The block type enum and typed block interfaces are in `src/types/block.ts`.

## Code Style

- No semicolons
- Single quotes
- 2-space indent
- No trailing commas
- 1TBS brace style (single-line blocks allowed)
- Arrow parens always required
- `@typescript-eslint/no-explicit-any` is enforced (error)

## Lark App Credentials

Initial call to AuthenAuthorize is required to set clientId and clientSecret. App Credentials and Token state are persisted in `~/.silkweave-lark.json`.

## Testing via MCP

This project is configured as an MCP server in `.mcp.json` (`pnpm tsx src/mcp.ts`). Claude Code can call the Lark MCP tools directly to test changes — use the `mcp__lark__*` tools (e.g. `DocxDocumentExport`, `WikiSpaceList`) to verify actions work correctly after editing.

**Restarting after code changes:** The MCP server runs as a child process of Claude Code. After making code changes, call the `mcp__lark__McpRestart` tool to restart the server. This exits the process cleanly; Claude Code will auto-restart it on the next tool call, picking up changes to existing actions.

**Caveat — new tools:** Claude Code caches the tool list at connection time. Changes to existing actions are picked up after restart, but *newly added* actions won't appear until the MCP connection is fully re-established (ask the user to reconnect).

## Publishing

This is an unscoped public package. Publish with:

```sh
pnpm publish --no-git-checks
```

## Wrapup Config

- check: `pnpm check` (run binaries directly or with `CI=true` — pnpm v11 prompts abort without a TTY)
- test: `pnpm test`
- push: yes
- version_bump: yes (single package)
- publish: yes (public, `pnpm publish --no-git-checks`)
- docs: root CLAUDE.md + README.md
- frontend_smoke: no

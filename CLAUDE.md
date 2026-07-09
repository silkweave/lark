# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build:** `pnpm build` (uses tsdown, outputs to `build/`)
- **Lint:** `pnpm lint` (eslint) + `pnpm typecheck` (tsc --noEmit), or both via `pnpm check`
- **Clean:** `pnpm clean`
- **Run MCP server (dev):** `pnpm tsx src/mcp.ts`
- **Run CLI (dev):** `pnpm tsx src/cli.ts`
- **Run message watcher service (dev):** `pnpm serve` (standalone `lark-serve` entrypoint). Reflex flags: `--reflex`/`--no-reflex`, `--api-key <key>`, `--model <id>`, `--playbook <file>`, `--playbook-text <text>`, `--emoji <key>`, `--history-limit <n>` (also `--help`). Reflex needs an Anthropic API key persisted to `~/.silkweave-lark.json` (set via `--api-key` or `EventReflexConfigure`) — enabling reflex without one throws.

pnpm v11 config (`overrides` for the zod pin, `onlyBuiltDependencies`) lives in `pnpm-workspace.yaml`, not package.json.

## Architecture

This is `@silkweave/lark` — a Lark/Feishu document parser that exposes both an MCP server and a CLI. It uses [silkweave](https://www.npmjs.com/package/silkweave) to define actions that are mounted as MCP tools or CLI commands.

### Entry Points

- `src/index.ts` — library exports (DocxParser, TokenClient, API helpers)
- `src/mcp.ts` — MCP server (stdio transport via silkweave); auto-starts the message watcher when `watcher.autoStart` is set
- `src/cli.ts` — CLI (same actions, cli transport via silkweave)
- `src/serve.ts` — standalone message watcher service (`lark-serve` bin); keeps event subscriptions alive independently of any MCP client

### Core Classes

- **`TokenClient`** — manages per-user OAuth tokens and the tenant token (read/write to `~/.silkweave-lark.json`). Constructed with a store key (`userId`); the sentinel key `'tenant'` (`TENANT_USER_ID`) selects the app's Tenant Access Token (bot identity). Actions call `withAuth()`, which dispatches to `withUser()` (user access token) or `withTenant()` (tenant access token) based on the key. The shared `userIdSchema()` helper in `src/lib/auth.ts` provides the zod input schema + agent-facing description for the `userId` parameter; `ImMessageSend`/`ImMessageReply` default it to `'tenant'`.
- **`DocxParser`** — converts Lark document blocks to Markdown. Uses a block parser registry (`src/parser/`) where each block type (text, heading, list, table, callout, etc.) has a dedicated parse function.
- **`MessageWatcher`** (`src/lib/messageWatcher.ts`, singleton `messageWatcher`) — receives `im.message.receive_v1` events over Lark's WebSocket long connection (no public URL). Matches events against subscriptions persisted in `~/.silkweave-lark.json` (re-read per event, so cross-process changes apply live), appends matches to `~/.silkweave-lark.events.jsonl`, and dispatches the heavy workload via whichever of two mechanisms the subscription has set (both may be set): `onEventCommand` (a shell command spawned detached, given the event + history via `LARK_*` env vars) and/or `webhookUrl` (an HTTP POST of `{ subscriptionId, event, history }`, with an optional `X-Silkweave-Signature: webhookSecret` header — for a persistent listener, e.g. a webhook server backing a long-running agent, instead of spawning a process per message; fire-and-forget with a 10s timeout, failures counted in `counters.errors`, never thrown). A pidfile (`~/.silkweave-lark.watcher.pid`) prevents two watchers running at once. Tracks "engaged" threads in memory (any message that directly @-mentions the bot, plus its root/thread ids) so later replies in a mention-started thread count as addressed to the bot without a re-mention. All watcher logging goes to stderr (stdout is the MCP protocol).
- **Reflex** (`src/lib/reflex.ts`, `runReflex`) — the fast-response dispatcher. When `reflex.enabled` is set in the watcher config and a matched message is *engaged* (direct @-mention or reply in a mention-started thread), the watcher: (1) instantly adds an emoji reaction (`Typing` by default) to the user's message as a zero-latency ack, (2) classifies the message with a fast Anthropic model (default `claude-haiku-4-5`, via a raw `fetch` to `/v1/messages` with a forced `classify` tool_use), using recent chat history (see below) as context. Outcomes: `trivial` → Haiku answers inline; `task` → posts a brief "working on it" reply and lets the watcher spawn the subscription's `onEventCommand` (the heavy workload); `ignore` (mistaken/passing mention) → removes the reaction, says nothing. On any failure it falls back safe (spawns the workload, never drops the message). Requires an Anthropic API key in `reflex.apiKey`, persisted to `~/.silkweave-lark.json`; both `EventReflexConfigure` and `MessageWatcher.start()` throw if reflex is enabled without one. An optional text `playbook` (rules/background/tone) is injected into the reflex system prompt. Config is set via `EventReflexConfigure` or `lark-serve` flags; the reflex never gets tool access — it only classifies and replies.
- **History** (`src/lib/history.ts`) — a shared, cross-process rolling chat log at `~/.silkweave-lark.history.jsonl` (append-only, self-trimming). Every inbound message the watcher sees (matched or not) is recorded with `role: 'user'`; reflex's own replies are recorded with `role: 'reflex'` from `messageWatcher.ts`; `ImMessageSend`/`ImMessageReply` record their sends with `role: 'agent'` (best-effort, from whichever process calls them — MCP server, CLI, or a spawned `onEventCommand`). Reflex reads the last `reflex.historyLimit` entries (default 15) per chat as classification context; dispatched `onEventCommand`s get the last 20 as `LARK_HISTORY_JSON` (alongside `LARK_EVENT_JSON`) so the delegated agent has the same context. Entries carry `parentId`/`rootId`/`threadId` for reply/thread ordering; `formatHistory()` renders a chronological, role-labeled transcript.

### Actions (`src/actions/`)

Actions are defined with `createAction()` from silkweave (zod schema for input, run function). Groups:
- **Authen** — OAuth flow: authorize URL, token exchange, user info
- **Bitable** — Base apps, tables, fields, records (CRUD)
- **Contact** — organization user listing
- **Docx** — document export (to Markdown), import (from Markdown), block listing
- **Event** — message subscriptions (create/list/delete), watcher lifecycle (start/stop/status), event log reading, reflex config (`EventReflexConfigure`)
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
- test: skip (no test suite)
- push: yes
- version_bump: yes (single package)
- publish: yes (public, `pnpm publish --no-git-checks`)
- docs: root CLAUDE.md + README.md
- frontend_smoke: no

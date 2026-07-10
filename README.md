# @silkweave/lark-mcp

Lark/Feishu document parser and API client exposed as both an **MCP server** and a **CLI**. Built with [silkweave](https://www.npmjs.com/package/silkweave) and the official [@larksuiteoapi/node-sdk](https://www.npmjs.com/package/@larksuiteoapi/node-sdk).

## Features

- Export Lark documents to Markdown
- Import Markdown into existing Lark documents
- Manage Wiki spaces, nodes, and search
- Read and write Lark Base (Bitable) apps, tables, fields, and records
- Send messages to users and group chats
- Subscribe to incoming messages (WebSocket long connection, no public URL needed)
- List organization contacts
- OAuth authentication flow for user-scoped API access
- Pluggable block parser system for Lark document types

## Quick Start

### 1. Add the MCP Server

No installation required -- `npx` downloads and runs the package automatically.

**Claude Code** -- add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "lark": {
      "command": "npx",
      "args": ["-y", "@silkweave/lark-mcp", "mcp"]
    }
  }
}
```

**Claude Desktop** -- add to your config file:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "lark": {
      "command": "npx",
      "args": ["-y", "@silkweave/lark-mcp", "mcp"]
    }
  }
}
```

**Other MCP clients** -- use the command `npx -y @silkweave/lark-mcp mcp` with stdio transport.

### 2. Create a Lark App

1. Go to the [Lark Open Platform](https://open.larksuite.com/) and create a custom app
2. Note your **App ID** and **App Secret**
3. Under **Security Settings**, add a Redirect URI: `http://localhost:3000/callback`
4. Under **Permissions & Scopes**, add the scopes you need (see [Required Scopes](#required-scopes) below)
5. Create a version and publish the app

### 3. Authenticate

Once the MCP server is running, use the authentication tools to connect:

1. **Call `AuthenAuthorize`** with your `clientId` and `clientSecret` -- this saves your app credentials and returns an OAuth URL
2. **Open the URL** in a browser -- Lark asks you to authorize the app, then redirects to `http://localhost:3000/callback?code=<CODE>` (copy the code from the URL)
3. **Call `AuthenOauthToken`** with the `code` -- tokens are stored in `~/.silkweave-lark.json`
4. **Call `AuthenUserInfo`** to verify -- you should see your name and email

That's it. All subsequent tool calls are authenticated automatically. Credentials persist across sessions in `~/.silkweave-lark.json`.

> **Bot-only usage:** if you only need bot-level access (tenant token), steps 2-4 of the OAuth flow are optional — call `AuthenAuthorize` once with `clientId`/`clientSecret` to save the app credentials, then pass `userId: 'tenant'` to any tool.

## Required Scopes

When configuring your Lark app, enable the OAuth scopes for the features you need:

| Category | Scopes |
|----------|--------|
| Contact | `contact:contact`, `contact:contact.base:readonly`, `contact:department.base:readonly`, `contact:user.base:readonly`, `contact:user.email:readonly`, `contact:user.phone:readonly` |
| Documents | `docs:doc`, `docs:document.content:read`, `docs:document:export`, `docx:document`, `docx:document:create`, `docx:document:readonly`, `docx:document.block:convert` |
| Drive | `drive:drive`, `drive:export:readonly` |
| Wiki | `wiki:wiki`, `wiki:node:read`, `wiki:node:retrieve`, `wiki:space:retrieve` |
| Base (Bitable) | `bitable:app`, `bitable:app:write` |
| Messaging | `im:chat`, `im:chat:read`, `im:chat:readonly`, `im:message` |
| Other | `offline_access`, `admin:app.info:readonly`, `sheets:spreadsheet` |

## Usage

### As a Library

```bash
pnpm add @silkweave/lark-mcp
```

```typescript
import { TokenClient, DocxParser } from '@silkweave/lark-mcp'

const client = new TokenClient('default')
const parser = new DocxParser(client, { includeTitle: true })
const markdown = await parser.process('document_id')
```

### As a CLI

```bash
npx @silkweave/lark-mcp
```

## Authentication

@silkweave/lark-mcp supports two authentication modes, selected per call via the `userId` parameter:

### App-level (Tenant Access Token) — `userId: 'tenant'`

Pass `userId: 'tenant'` to any tool to authenticate with the app's **Tenant Access Token** and act as the **bot**. No user login is required — only the app credentials saved by `AuthenAuthorize` (`clientId` + `clientSecret`). The token is created and refreshed automatically before expiry.

Use this for bot workflows: sending messages to channels, reading chats the bot is in, or accessing docs/Base apps shared with the bot. The bot can only reach resources it has been granted access to (e.g. added as a group member, or the document shared with it), and the app needs the corresponding permissions enabled in the Lark developer console.

### User-level (OAuth) — `userId: '<store key>'`

Pass any other value (default: `'default'`) to act as an OAuth-authenticated user; the value selects which stored user token to use, so multiple users can be authenticated side by side under different keys. Requires the one-time login flow in [Quick Start](#3-authenticate). Access and refresh tokens are refreshed automatically; when the refresh token itself expires, re-authenticate.

**Exceptions:** `AuthenUserInfo` is inherently user-scoped (`'tenant'` is rejected). `ImMessageSend` and `ImMessageReply` default to `'tenant'` (send as the bot) instead of `'default'`.

## Message Event Subscriptions

The message watcher receives incoming messages over Lark's **WebSocket long connection** — no public webhook URL required. Messages matching a subscription are appended to a local event log (`~/.silkweave-lark.events.jsonl`, readable via `EventList`) and can optionally trigger a shell command per event.

### Lark app prerequisites

In the [Lark developer console](https://open.larksuite.com/):

1. **Events & Callbacks → Event Configuration**: select **Long Connection** mode
2. **Add the event** `im.message.receive_v1` ("Receive messages")
3. **Permissions**: enable the message-receiving scopes you need — `im:message.p2p_msg` (direct messages), `im:message.group_at_msg` (group messages that @-mention the bot) and/or `im:message.group_msg` (all group messages). Add `im:resource` if you want the watcher to sideload message attachments (images/files) for agents.
4. Add the bot to the group chats you want to observe, then publish a new app version

### Creating subscriptions

```
EventSubscriptionCreate { "chatId": "oc_xxx", "mentionBot": true }
```

Filters are optional and combine with AND: `chatId` (specific chat), `mentionBot` (only @-mentions of the bot), `keywords` (case-insensitive match). Omit all filters to record every message the bot receives. `onEventCommand` spawns a detached shell command per matching message with `LARK_*` env vars (`LARK_EVENT_JSON`, `LARK_HISTORY_JSON`, `LARK_ATTACHMENTS_JSON`, `LARK_CHAT_ID`, `LARK_TEXT`, `LARK_MESSAGE_ID`, `LARK_SENDER_OPEN_ID`, `LARK_MENTIONED_BOT`, `LARK_SUBSCRIPTION_ID`, `LARK_ACK_MESSAGE_ID`) — use it to notify or kick off an agent. `webhookUrl` instead POSTs `{ subscriptionId, event, history, ackMessageId? }` to a persistent listener (optionally signed via `webhookSecret`) — the receiver should acknowledge with a 2xx immediately and run its workload (e.g. a `claude -p` run) asynchronously, replying via the `ImMessageReply` tool.

Subscription CRUD (`EventSubscriptionCreate` / `EventSubscriptionUpdate` / `EventSubscriptionDelete`) and reflex config (`EventReflexConfigure`) are applied **live on the running watcher** over its control gateway and persisted to `~/.silkweave-lark.json` — no restart, id-stable updates, safe under concurrent MCP agents. These mutations require the watcher to be running; `EventSubscriptionList` and `EventWatchStatus` fall back to file reads when it isn't.

### Running the watcher

The watcher is a **standalone OS process** — deliberately *not* an MCP tool and *never* started by the MCP server. That keeps the bot's lifecycle independent of any editor/agent session and off the MCP stdio process. You start it from a shell:

```sh
# Installed:
lark-serve
# Dev checkout:
pnpm serve
# With the reflex fast-responder:
lark-serve --reflex --api-key sk-ant-... --playbook ./playbook.md
```

Run `lark-serve --help` for all reflex flags. Ways to run it:

- **Background shell (session/dev):** `lark-serve &` — quick, visible, killable, but dies with the shell.
- **Persistent daemon:** supervise with `launchd` (macOS), `systemd`, or `pm2` so it restarts on crash/boot. This is what you want for an always-on bot.

**For AI agents:** you cannot start the watcher through an MCP tool — spawn it as a normal background process (e.g. a background shell running `lark-serve`), then poll `EventWatchStatus`. When the watcher is down, `EventWatchStatus` returns `running: false` with a `notRunningReason` that contains the exact command to run.

Only one watcher may run at a time, guarded by the pidfile `~/.silkweave-lark.watcher.pid` and by the control socket. Stop it with `Ctrl-C` or `kill $(cat ~/.silkweave-lark.watcher.pid)`.

An example `launchd` agent for always-on operation (`~/Library/LaunchAgents/com.silkweave.lark-serve.plist`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.silkweave.lark-serve</string>
  <key>ProgramArguments</key>
  <array><string>/opt/homebrew/bin/lark-serve</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardErrorPath</key><string>/tmp/lark-serve.log</string>
</dict>
</plist>
```

Load with `launchctl load ~/Library/LaunchAgents/com.silkweave.lark-serve.plist`. No arguments are needed — the watcher resumes its persisted config and everything else is reconfigured live over the gateway.

### The control gateway

While running, the watcher hosts a **control gateway** on a Unix domain socket at `~/.silkweave-lark.watcher.sock` (mode 0600, same-user only — never exposed over TCP). The protocol is newline-delimited JSON: request/response methods (`ping`, `status`, `subscriptions.list/add/update/remove`, `reflex.get/set`, `reconnect`) plus a `subscribe` method that turns the connection into a live event stream. MCP `Event*` tools are thin clients of this socket; the watcher is the single authority for its own config while running, so concurrent agents can't lose each other's updates. Live status (`status`) includes `wsConnected` and `activeStreams` on top of the heartbeat counters.

The heartbeat file (`~/.silkweave-lark.watcher.status.json`) is still written every few seconds for external monitors and as the read-only fallback when the watcher is down.

### Streaming events (`lark-listen`)

A persistent consumer can subscribe to events as they arrive — no public URL, no per-message process:

```sh
lark-listen                      # subscription-matched events, NDJSON on stdout
lark-listen --all                # every inbound message the bot sees (full transcript)
lark-listen --chat oc_xxx --history 20
lark-listen --since 2026-07-10T00:00:00Z   # replay matched events first, then go live
```

Each line is `{ event, history?, reflex? }` — `reflex` carries the fast-responder's outcome (`category`, `replied`, `replyText`, `dispatched`, `ackMessageId`) so a downstream agent knows what was already said. The client auto-reconnects with exponential backoff and re-subscribes from the last-seen event (`sinceTs` replay from `events.jsonl`), making matched-event delivery gap-free across watcher restarts. Slow consumers are disconnected with an `overflow` frame and catch up the same way. Programmatic use: `streamEvents(filter, onEvent)` from the library (`import { streamEvents } from '@silkweave/lark-mcp'`).

### Reading events

`EventList` returns collected events (filter by `chatId`, `subscriptionId`, `mentionedBot`, `since`). Each event includes the extracted plain `text` (mention placeholders resolved), raw `content` JSON, sender, chat, and mention metadata — everything needed to reply via `ImMessageReply` with `messageId`.

### Attachments

When an inbound message carries resources — an `image`, `file`, `media` (video) or `audio` message, or images embedded in a rich-text `post` — the watcher **sideloads** them: each resource is downloaded (requires the `im:resource` app permission) to `~/.silkweave-lark.attachments/<messageId>/` and referenced as `attachments: [{ key, type, name, path, size, mimeType }]` on the event record, the webhook payload, `LARK_ATTACHMENTS_JSON`, and the shared history log (so a delegated agent sees an image sent *before* the follow-up question, e.g. a photo of a cat followed by "what animal is this?" — it just reads the local `path`). Sideloading happens for any message in a chat covered by at least one subscription; the extracted `text` for attachment messages is a readable placeholder (`[image]`, `[file: report.pdf]`, …) and `post` messages are rendered as plain text with inline placeholders. Sideloaded copies are working files, not an archive: the watcher sweeps per-message directories older than 7 days.

## Tools Reference

All tools accept an optional `userId` parameter selecting the auth identity: `'tenant'` for the app's Tenant Access Token (bot), or a token store key (default: `'default'`) for a user's OAuth token. See [Authentication](#authentication).

### Authentication

#### `AuthenAuthorize`

Generate an OAuth authorization URL for user login. Also saves the app credentials (required once before any tool call, including tenant/bot usage).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `clientId` | string | No | Lark App ID (persisted; required on first call) |
| `clientSecret` | string | No | Lark App Secret (persisted; required on first call) |
| `redirectUri` | string | No | OAuth redirect URI (default: `http://localhost:3000/callback`) |
| `userId` | string | No | Token store key the user tokens will be saved under (default: `'default'`) |

**Returns:** `{ authUrl: string }`

---

#### `AuthenOauthToken`

Exchange an OAuth authorization code for access and refresh tokens.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | Yes | Authorization code from OAuth callback |
| `userId` | string | No | Token store key (default: `'default'`) |

**Returns:** `{ accessToken: { token, expiresAt }, refreshToken: { token, expiresAt } }`

---

#### `AuthenUserInfo`

Get information about the currently authenticated user.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | No | Token store key (default: `'default'`) |

**Returns:** User info object (name, email, avatar, etc.)

---

### Base (Bitable)

#### `BitableAppGet`

Get metadata for a Lark Base app.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ app: { app_token, name, revision, time_zone, is_advanced } }`

---

#### `BitableTableList`

List tables in a Base app.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ items: [{ table_id, name, revision }], hasMore, pageToken }`

---

#### `BitableTableCreate`

Create a new table in a Base app, optionally with initial fields.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `name` | string | Yes | Table name |
| `defaultViewName` | string | No | Default view name |
| `fields` | array | No | Initial fields (`fieldName`, `type`, `uiType`) |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ table_id }`

---

#### `BitableFieldList`

List fields in a table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ items: [{ field_id, field_name, type, ui_type, property }], hasMore, pageToken }`

---

#### `BitableFieldCreate`

Create a new field in a table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `fieldName` | string | Yes | Field name |
| `type` | number | Yes | Field type (1=Text, 2=Number, 3=SingleSelect, 4=MultiSelect, 5=DateTime, 7=Checkbox, 11=User, …) |
| `uiType` | string | No | UI type hint |
| `property` | string | No | Field property as JSON string (e.g. `{"options":[{"name":"Done"}]}`) |
| `description` | string | No | Field description |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ field: { field_id, field_name, type, ui_type, property } }`

---

#### `BitableFieldUpdate`

Update an existing field (e.g. rename, change options).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `fieldId` | string | Yes | Field ID to update |
| `fieldName` | string | Yes | Field name |
| `type` | number | Yes | Field type (required by the Lark API) |
| `uiType` | string | No | UI type hint |
| `property` | string | No | Field property as JSON string |
| `description` | string | No | Field description |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ field: { field_id, field_name, type, ui_type, property } }`

---

#### `BitableFieldDelete`

Delete a field from a table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `fieldId` | string | Yes | Field ID to delete |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

---

#### `BitableRecordCreate`

Create a single record in a table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `fields` | string | Yes | Record fields as JSON string (`{ "Field Name": value }`) |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ record: { record_id, fields } }`

---

#### `BitableRecordBatchCreate`

Create multiple records in a table in one request.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `records` | string | Yes | Array of record field objects as JSON string |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ records: [{ record_id, fields }] }`

---

#### `BitableRecordSearch`

Search/query records in a table with optional filters and sorting.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `filter` | string | No | Filter conditions as JSON string |
| `sort` | string | No | Sort conditions as JSON string |
| `fieldNames` | string | No | Comma-separated field names to return |
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ items: [{ record_id, fields }], hasMore, pageToken }`

---

#### `BitableRecordUpdate`

Update one or more records in a table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `records` | string | Yes | Array of `{ record_id, fields }` as JSON string |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ records: [{ record_id, fields }] }`

---

#### `BitableRecordDelete`

Delete one or more records from a table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `recordIds` | string | Yes | Comma-separated record IDs to delete |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

---

### Contacts

#### `ContactUserList`

List users in the organization by department.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `departmentId` | string | No | Department ID (`'0'` for root/all users) |
| `pageSize` | number | No | Results per page (max 50) |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ items: [{ openId, userId, name, enName, email, mobile }], hasMore, pageToken }`

---

### Documents

#### `DocxDocumentExport`

Export a Lark document to Markdown.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | string | Yes | Lark document ID |
| `includeTitle` | boolean | No | Include document title as H1 (default: `true`) |
| `path` | string | No | Write to file path instead of returning content |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** Node metadata + markdown content (or file path if `path` is provided)

---

#### `DocxDocumentImport`

Import Markdown content into an existing Lark document. Replaces all existing content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | string | Yes | Target document ID |
| `path` | string | Yes | Local path to Markdown file |
| `userIdType` | `'user_id'` \| `'union_id'` \| `'open_id'` | No | User ID type |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ documentId, spaceId, title, blocksDeleted, blocksCreated }`

---

#### `DocxDocumentBlockList`

List all blocks in a Lark document.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | string | Yes | Document ID |
| `userIdType` | `'user_id'` \| `'union_id'` \| `'open_id'` | No | User ID type |
| `documentRevisionId` | number | No | Specific document revision |
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** Block list with pagination

---

### Wiki

#### `WikiSpaceList`

List all wiki spaces accessible to the user.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** List of wiki spaces with pagination

---

#### `WikiSpaceNodeList`

List nodes in a wiki space.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `spaceId` | string | Yes | Wiki space ID |
| `parentNodeToken` | string | No | Filter to children of this node |
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** List of wiki nodes with pagination

---

#### `WikiSpaceGetNode`

Get details of a specific wiki node.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | string | Yes | Wiki node token |
| `objType` | `'doc'` \| `'docx'` \| `'sheet'` \| `'mindnote'` \| `'bitable'` \| `'file'` \| `'slides'` \| `'wiki'` | No | Object type filter |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** Full node details

---

#### `WikiSpaceNodeCreate`

Create a new document node in a wiki space.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `spaceId` | string | Yes | Wiki space ID |
| `parentNodeToken` | string | No | Parent node (omit for top-level) |
| `title` | string | No | Document title |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ spaceId, nodeToken, objToken, title, parentNodeToken }`

---

#### `WikiSpaceNodeMove`

Move a wiki node (and its children) to a different parent or space.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `spaceId` | string | Yes | Source wiki space ID |
| `nodeToken` | string | Yes | Node to move |
| `targetParentToken` | string | No | Target parent node |
| `targetSpaceId` | string | No | Target space for cross-space moves |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ spaceId, nodeToken, objToken, objType, parentNodeToken, title, hasChild }`

---

#### `WikiSearch`

Full-text search across wiki spaces.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query |
| `spaceId` | string | No | Filter to a specific space |
| `nodeId` | string | No | Filter to descendants of a node (requires `spaceId`) |
| `pageSize` | number | No | Results per page (max 50, default 20) |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ items: [{ nodeId, spaceId, objType, title, url, objToken }], hasMore, pageToken }`

---

### Messaging

#### `ImChatList`

List chats that the user or bot is in (excludes P2P chats).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sortType` | `'ByCreateTimeAsc'` \| `'ByActiveTimeDesc'` | No | Sort order |
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ items: [{ chatId, name, description, ownerId, external, labels }], hasMore, pageToken }`

---

#### `ImChatSearch`

Search for chats by keyword.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search keyword |
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | `'tenant'` (bot) or user token store key |

**Returns:** `{ items: [{ chatId, name, description, ownerId, external, labels }], hasMore, pageToken }`

---

#### `ImMessageSend`

Send a message to a user or group chat. Sends as the bot by default (`userId: 'tenant'`); pass a user token store key to send as that user.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `receiveId` | string | Yes | Recipient ID (user or chat) |
| `receiveIdType` | `'open_id'` \| `'user_id'` \| `'union_id'` \| `'email'` \| `'chat_id'` | Yes | Type of `receiveId` |
| `msgType` | `'text'` \| `'post'` \| `'interactive'` | Yes | Message type |
| `content` | string | Yes | Message content (JSON string) |
| `uuid` | string | No | Idempotency key |
| `userId` | string | No | `'tenant'` (bot, default) or user token store key |

**Returns:** `{ messageId, chatId, createTime, msgType, senderId, senderType }`

**Example -- send a text message:**

```json
{
  "receiveId": "oc_xxx",
  "receiveIdType": "chat_id",
  "msgType": "text",
  "content": "{\"text\": \"Hello from silkweave-lark!\"}"
}
```

---

#### `ImMessageReply`

Reply to a specific message. Replies as the bot by default (`userId: 'tenant'`); pass a user token store key to reply as that user.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `messageId` | string | Yes | Message ID to reply to |
| `msgType` | `'text'` \| `'post'` \| `'interactive'` | Yes | Message type |
| `content` | string | Yes | Message content (JSON string) |
| `replyInThread` | boolean | No | Reply in a thread |
| `uuid` | string | No | Idempotency key |
| `userId` | string | No | `'tenant'` (bot, default) or user token store key |

**Returns:** Message object (same shape as `ImMessageSend`)

---

### Events

See [Message Event Subscriptions](#message-event-subscriptions) for setup. These tools always operate with app credentials (no `userId` needed).

#### `EventSubscriptionCreate`

Create a persistent message subscription, applied live on the running watcher (fails when the watcher is down).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chatId` | string | No | Restrict to a specific chat (omit for all chats the bot is in) |
| `chatName` | string | No | Human-readable chat name (informational) |
| `mentionBot` | boolean | No | Only messages that @-mention the bot |
| `keywords` | string[] | No | Only messages containing one of these keywords |
| `onEventCommand` | string | No | Shell command spawned per matching message (`LARK_*` env vars) |
| `webhookUrl` | string | No | URL POSTed with `{ subscriptionId, event, history }` per matching message |
| `webhookSecret` | string | No | Sent as `X-Silkweave-Signature` on webhook requests |

**Returns:** `{ subscription }`

---

#### `EventSubscriptionUpdate`

Update a subscription in place (id-stable), applied live on the running watcher. Takes `id` plus any of the fields above — pass a value to set, `null` to clear, omit to leave unchanged (e.g. `{ "id": "sub_x", "webhookUrl": null }` removes just the webhook).

**Returns:** `{ subscription }`

---

#### `EventSubscriptionList`

List subscriptions and current watcher status (live from the gateway; falls back to the config file when the watcher is down).

---

#### `EventSubscriptionDelete`

Delete a subscription by `id`, applied live on the running watcher.

---

#### `EventWatchStatus`

Read-only watcher status: running state, bot identity, `wsConnected`, `activeStreams`, counters, reflex config + counters, and recent events — queried live over the control gateway, falling back to the heartbeat + pidfile when no watcher is running. Never starts or stops anything (the watcher is a standalone `lark-serve` process — see [Running the watcher](#running-the-watcher)). When `running` is `false`, `notRunningReason` includes the exact command to start it.

> **Note:** there are no `EventWatchStart`/`EventWatchStop` tools — starting and stopping the watcher is done from a shell (`lark-serve` / `kill`), not through MCP, so process lifecycle stays visible and controllable.

---

#### `EventWatchReconnect`

Tell the running watcher to tear down and re-establish its Lark WebSocket connection (re-reads app credentials and bot info). The gateway and live event streams stay up throughout. Use after changing app credentials or to recover a wedged connection.

**Returns:** `{ reconnected, wsConnected }`

---

#### `EventList`

Read collected message events from the local event log.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chatId` | string | No | Filter to a specific chat |
| `subscriptionId` | string | No | Filter to a specific subscription |
| `mentionedBot` | boolean | No | Filter to bot @-mentions |
| `since` | string | No | Only events received after this ISO timestamp |
| `limit` | number | No | Max events returned, newest kept (default: 20) |

**Returns:** `{ events: MessageEventRecord[], total }`

---

### Server Management

#### `McpHealth`

Check MCP server health and uptime.

**Returns:** `{ status: 'ok', uptime, pid }`

---

#### `McpRestart`

Restart the MCP server to pick up code changes.

**Returns:** `{ status: 'restarting' }`

## Architecture

```
src/
  index.ts          # Library exports
  mcp.ts            # MCP server (stdio transport; tools only — never runs the watcher)
  cli.ts            # CLI (interactive transport)
  serve.ts          # Standalone message watcher service (lark-serve)
  listen.ts         # Event streaming CLI (lark-listen)
  actions/          # Tool definitions (createAction + zod schemas)
    Authen/         # OAuth flow
    Bitable/        # Base apps, tables, fields, records
    Contact/        # Organization users
    Docx/           # Document export/import
    Event/          # Message subscriptions, reflex config, watcher status/reconnect
    Im/             # Chat and messaging
    Mcp/            # Server management
    Wiki/           # Wiki spaces and nodes
  classes/
    TokenClient.ts  # User and tenant agnostic token persistence client (~/.silkweave-lark.json)
    DocxParser.ts   # Lark blocks -> Markdown converter
  parser/           # Block type parsers (text, heading, list, table, etc.)
  types/            # TypeScript type definitions (incl. gateway protocol in types/gateway.ts)
  lib/              # Shared utilities (API helpers, scopes, message watcher,
                    #   watcherGateway/watcherClient — UDS control channel, fileLock)
```

## Development

```bash
# Install dependencies
pnpm install

# Run MCP server in dev mode
pnpm tsx src/mcp.ts

# Run CLI in dev mode
pnpm tsx src/cli.ts

# Build
pnpm build

# Lint
pnpm lint

# Unit tests (gateway framing, patch semantics, file lock)
pnpm test

# Clean build artifacts
pnpm clean
```

## Publishing

This is a public scoped package. Publish with:

```bash
pnpm publish --no-git-checks
```

## License

MIT

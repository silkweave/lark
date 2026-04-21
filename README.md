# @silkweave/lark

Lark/Feishu document parser and API client exposed as both an **MCP server** and a **CLI**. Built with [silkweave](https://www.npmjs.com/package/silkweave) and the official [@larksuiteoapi/node-sdk](https://www.npmjs.com/package/@larksuiteoapi/node-sdk).

## Features

- Export Lark documents to Markdown
- Import Markdown into existing Lark documents
- Manage Wiki spaces, nodes, and search
- Read and write Lark Base (Bitable) apps, tables, fields, and records
- Send messages to users and group chats
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
      "args": ["-y", "@silkweave/lark", "mcp"]
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
      "args": ["-y", "@silkweave/lark", "mcp"]
    }
  }
}
```

**Other MCP clients** -- use the command `npx -y @silkweave/lark mcp` with stdio transport.

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
3. **Call `AuthenOauthToken`** with the `code` -- tokens are stored in `lark.json`
4. **Call `AuthenUserInfo`** to verify -- you should see your name and email

That's it. All subsequent tool calls are authenticated automatically. Credentials persist across sessions in `lark.json`.

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
pnpm add @silkweave/lark
```

```typescript
import { TokenClient, DocxParser } from '@silkweave/lark'

const client = new TokenClient('default')
const parser = new DocxParser(client, { includeTitle: true })
const markdown = await parser.process('document_id')
```

### As a CLI

```bash
npx @silkweave/lark
```

## Authentication

@silkweave/lark supports two authentication modes:

### App-level (Tenant Token)

Used automatically for bot-level API calls (e.g. sending messages). Tokens are refreshed automatically before expiry.

### User-level (OAuth)

Required for user-scoped operations (documents, wiki, Base, contacts). See [Quick Start](#3-authenticate) above for the flow.

## Tools Reference

All tools accept an optional `userId` parameter (default: `'default'`) to select which stored OAuth token to use for the request.

### Authentication

#### `AuthenAuthorize`

Generate an OAuth authorization URL for user login.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userId` | string | No | Token store key (default: `'default'`) |

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
| `userId` | string | No | Token store key |

**Returns:** `{ app: { app_token, name, revision, time_zone, is_advanced } }`

---

#### `BitableTableList`

List tables in a Base app.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

**Returns:** `{ field: { field_id, field_name, type, ui_type, property } }`

---

#### `BitableFieldDelete`

Delete a field from a table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `fieldId` | string | Yes | Field ID to delete |
| `userId` | string | No | Token store key |

---

#### `BitableRecordCreate`

Create a single record in a table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `fields` | string | Yes | Record fields as JSON string (`{ "Field Name": value }`) |
| `userId` | string | No | Token store key |

**Returns:** `{ record: { record_id, fields } }`

---

#### `BitableRecordBatchCreate`

Create multiple records in a table in one request.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `records` | string | Yes | Array of record field objects as JSON string |
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

**Returns:** `{ items: [{ record_id, fields }], hasMore, pageToken }`

---

#### `BitableRecordUpdate`

Update one or more records in a table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `records` | string | Yes | Array of `{ record_id, fields }` as JSON string |
| `userId` | string | No | Token store key |

**Returns:** `{ records: [{ record_id, fields }] }`

---

#### `BitableRecordDelete`

Delete one or more records from a table.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `appToken` | string | Yes | Base app token |
| `tableId` | string | Yes | Table ID |
| `recordIds` | string | Yes | Comma-separated record IDs to delete |
| `userId` | string | No | Token store key |

---

### Contacts

#### `ContactUserList`

List users in the organization by department.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `departmentId` | string | No | Department ID (`'0'` for root/all users) |
| `pageSize` | number | No | Results per page (max 50) |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

**Returns:** Node metadata + markdown content (or file path if `path` is provided)

---

#### `DocxDocumentImport`

Import Markdown content into an existing Lark document. Replaces all existing content.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `documentId` | string | Yes | Target document ID |
| `path` | string | Yes | Local path to Markdown file |
| `userIdType` | `'user_id'` \| `'union_id'` \| `'open_id'` | No | User ID type |
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

**Returns:** Block list with pagination

---

### Wiki

#### `WikiSpaceList`

List all wiki spaces accessible to the user.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

**Returns:** List of wiki nodes with pagination

---

#### `WikiSpaceGetNode`

Get details of a specific wiki node.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | string | Yes | Wiki node token |
| `objType` | `'doc'` \| `'docx'` \| `'sheet'` \| `'mindnote'` \| `'bitable'` \| `'file'` \| `'slides'` \| `'wiki'` | No | Object type filter |
| `userId` | string | No | Token store key |

**Returns:** Full node details

---

#### `WikiSpaceNodeCreate`

Create a new document node in a wiki space.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `spaceId` | string | Yes | Wiki space ID |
| `parentNodeToken` | string | No | Parent node (omit for top-level) |
| `title` | string | No | Document title |
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

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
| `userId` | string | No | Token store key |

**Returns:** `{ items: [{ chatId, name, description, ownerId, external, labels }], hasMore, pageToken }`

---

#### `ImChatSearch`

Search for chats by keyword.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search keyword |
| `pageSize` | number | No | Results per page |
| `pageToken` | string | No | Pagination token |
| `userId` | string | No | Token store key |

**Returns:** `{ items: [{ chatId, name, description, ownerId, external, labels }], hasMore, pageToken }`

---

#### `ImMessageSend`

Send a message to a user or group chat. Messages are sent as the bot (uses app credentials, not user tokens).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `receiveId` | string | Yes | Recipient ID (user or chat) |
| `receiveIdType` | `'open_id'` \| `'user_id'` \| `'union_id'` \| `'email'` \| `'chat_id'` | Yes | Type of `receiveId` |
| `msgType` | `'text'` \| `'post'` \| `'interactive'` | Yes | Message type |
| `content` | string | Yes | Message content (JSON string) |
| `uuid` | string | No | Idempotency key |

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
  mcp.ts            # MCP server (stdio transport)
  cli.ts            # CLI (interactive transport)
  actions/          # Tool definitions (createAction + zod schemas)
    Authen/         # OAuth flow
    Bitable/        # Base apps, tables, fields, records
    Contact/        # Organization users
    Docx/           # Document export/import
    Im/             # Chat and messaging
    Mcp/            # Server management
    Wiki/           # Wiki spaces and nodes
  classes/
    TokenClient.ts  # User and tenant agnostic token persistence client (lark.json)
    DocxParser.ts   # Lark blocks -> Markdown converter
  parser/           # Block type parsers (text, heading, list, table, etc.)
  types/            # TypeScript type definitions
  lib/              # Shared utilities (API helpers, env, scopes)
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

# Clean build artifacts
pnpm clean
```

## Publishing

This is a private scoped package. Publish with restricted access:

```bash
pnpm publish --no-git-checks --access restricted
```

## License

MIT

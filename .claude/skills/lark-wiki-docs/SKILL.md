---
name: lark-wiki-docs
description: Manage Lark/Feishu resources via MCP — Wiki documents, Base (Bitable) tables, messaging, and contacts. Use when the user asks to set up @silkweave/lark-mcp, authenticate with Lark, create/update Wiki documents, manage Base tables/records, send messages, or list contacts. Also acts as a setup wizard for first-time users.
---

# Silkweave Lark MCP Skill

Manage Lark/Feishu resources through MCP tools exposed by the `@silkweave/lark-mcp` package.

## Setup Wizard

If the user hasn't set up @silkweave/lark-mcp yet, guide them through these steps:

### 1. Add the MCP Server

**Claude Code** -- add to `.mcp.json` in the project root:

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

**Claude Desktop** -- add to `claude_desktop_config.json`:
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

**Other MCP clients** -- use the same command: `npx -y @silkweave/lark-mcp mcp`

### 2. Create a Lark App

1. Go to the [Lark Open Platform](https://open.larksuite.com/) and create a custom app
2. Note the **App ID** and **App Secret**
3. Under **Security Settings**, add a Redirect URI: `http://localhost:3000/callback`
4. Under **Permissions & Scopes**, add the scopes needed for your use case:

| Category | Scopes |
|----------|--------|
| Contact | `contact:contact`, `contact:user.base:readonly`, `contact:user.email:readonly` |
| Documents | `docx:document`, `docx:document:create`, `docx:document:readonly`, `docx:document.block:convert` |
| Drive | `drive:drive`, `drive:export:readonly` |
| Wiki | `wiki:wiki`, `wiki:node:read`, `wiki:space:retrieve` |
| Base | `bitable:app`, `bitable:app:write` |
| Messaging | `im:chat`, `im:message` |
| Other | `offline_access` |

5. Publish the app (create a version and submit for release)

### 3. Authenticate

Once the MCP server is running, authenticate using these tools:

```
# Step 1: Generate the OAuth URL (this also saves your app credentials)
AuthenAuthorize({ clientId: "<APP_ID>", clientSecret: "<APP_SECRET>" })
-> returns { authorizeUrl: "https://..." }

# Step 2: User opens the URL in a browser and authorizes the app
# Lark redirects to http://localhost:3000/callback?code=<CODE>
# (The code is in the URL -- it doesn't need a running server)

# Step 3: Exchange the code for tokens
AuthenOauthToken({ code: "<CODE>" })
-> tokens are stored in lark.json, all subsequent calls are authenticated

# Step 4: Verify
AuthenUserInfo()
-> returns user name, email, avatar, etc.
```

Credentials and tokens persist in `lark.json` at the working directory root. Subsequent sessions reuse them automatically.

## Available MCP Tools

### Wiki

| Tool | Purpose |
|------|---------|
| `WikiSpaceList` | List all Wiki spaces |
| `WikiSpaceNodeList` | List nodes in a space (optionally under a parent) |
| `WikiSpaceGetNode` | Get details of a specific node |
| `WikiSpaceNodeCreate` | Create a new document node |
| `WikiSpaceNodeMove` | Move a node to a different parent/space |
| `WikiSpaceNodeCopy` | Copy a node |
| `WikiSpaceNodeDelete` | Delete a node |
| `WikiSearch` | Full-text search across Wiki |
| `DocxDocumentImport` | Import Markdown into a document |
| `DocxDocumentExport` | Export a document to Markdown |
| `DocxDocumentBlockList` | List raw blocks in a document |

### Base (Bitable)

| Tool | Purpose |
|------|---------|
| `BitableAppGet` | Get Base app metadata |
| `BitableTableList` | List tables in a Base |
| `BitableTableCreate` | Create a new table |
| `BitableFieldList` | List fields in a table |
| `BitableFieldCreate` | Create a new field |
| `BitableFieldUpdate` | Update a field (rename, change options) |
| `BitableFieldDelete` | Delete a field |
| `BitableRecordCreate` | Create a single record |
| `BitableRecordBatchCreate` | Create multiple records |
| `BitableRecordSearch` | Search/query records with filters |
| `BitableRecordUpdate` | Update records |
| `BitableRecordDelete` | Delete records |

### Messaging

| Tool | Purpose |
|------|---------|
| `ImChatList` | List chats the bot is in |
| `ImChatSearch` | Search chats by keyword |
| `ImMessageSend` | Send a message (text, post, or interactive card) |
| `ImMessageReply` | Reply to a message |

### Contacts

| Tool | Purpose |
|------|---------|
| `ContactUserList` | List users by department |

### Authentication

| Tool | Purpose |
|------|---------|
| `AuthenAuthorize` | Generate OAuth URL (also sets app credentials) |
| `AuthenOauthToken` | Exchange auth code for tokens |
| `AuthenUserInfo` | Get current user info |

## Common Workflows

### Creating a Wiki Document

```
# 1. Find the target space
WikiSpaceList -> pick spaceId

# 2. Find the parent node (optional)
WikiSpaceNodeList(spaceId) -> pick parentNodeToken

# 3. Create the node
WikiSpaceNodeCreate(spaceId, parentNodeToken, title: "My Doc")
-> returns objToken (this is the document ID)

# 4. Write Markdown to a temp file, then import
DocxDocumentImport(documentId: objToken, path: "/tmp/my-doc.md")
```

H1 headings are automatically stripped from the body and set as the Wiki node title. Use H2+ for document sections.

### Working with Base Tables

```
# Get a Base's metadata (appToken is from the URL)
BitableAppGet(appToken: "JlAD...")

# List tables
BitableTableList(appToken: "JlAD...")

# List fields in a table
BitableFieldList(appToken, tableId)

# Create a record
BitableRecordCreate(appToken, tableId, fields: '{"Task": "Fix bug", "Status": "To Do"}')

# Search records with filters
BitableRecordSearch(appToken, tableId, filter: '{"conjunction":"and","conditions":[{"field_name":"Status","operator":"is","value":["In Progress"]}]}')
```

The `appToken` is the ID in Lark Base URLs: `https://...larksuite.com/base/<appToken>?table=<tableId>`

### Sending Messages

```
# Send a text message to a group chat
ImMessageSend(receiveId: "oc_xxx", receiveIdType: "chat_id", msgType: "text", content: '{"text": "Hello!"}')
```

Messages are sent as the bot (uses tenant token, not user token).

## Key Concepts

- **`nodeToken`** -- identifies a node in the Wiki tree (for node operations: move, copy, delete)
- **`objToken`** -- identifies the underlying document (for content operations: import, export)
- **`appToken`** -- identifies a Base app (from the URL)
- **`tableId`** -- identifies a table within a Base
- **`userId`** parameter -- all tools accept this to select which stored OAuth token to use (default: `'default'`)

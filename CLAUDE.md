# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build:** `pnpm build` (uses tsdown, outputs to `build/`)
- **Lint:** `pnpm lint` (runs eslint + tsc --noEmit)
- **Clean:** `pnpm clean`
- **Run MCP server (dev):** `pnpm tsx src/mcp.ts`
- **Run CLI (dev):** `pnpm tsx src/cli.ts`

## Architecture

This is `@silkweave/lark` — a Lark/Feishu document parser that exposes both an MCP server and a CLI. It uses [silkweave](https://www.npmjs.com/package/silkweave) to define actions that are mounted as MCP tools or CLI commands.

### Entry Points

- `src/index.ts` — library exports (DocxParser, TokenClient, API helpers)
- `src/mcp.ts` — MCP server (stdio transport via silkweave)
- `src/cli.ts` — CLI (same actions, cli transport via silkweave)

### Core Classes

- **`TokenClient`** — manages per-user OAuth tokens (read/write to `lark.json`). Provides `withUser()` helper that creates a Client with user access token auth. Used by actions for user-scoped API calls. Provides `withTenant()` helper that creates a Client with tenant access token auth. Used by actions for tenant-scoped API calls.
- **`DocxParser`** — converts Lark document blocks to Markdown. Uses a block parser registry (`src/parser/`) where each block type (text, heading, list, table, callout, etc.) has a dedicated parse function.

### Actions (`src/actions/`)

Actions are defined with `createAction()` from silkweave (zod schema for input, run function). Groups:
- **Authen** — OAuth flow: authorize URL, token exchange, user info
- **Bitable** — Base apps, tables, fields, records (CRUD)
- **Contact** — organization user listing
- **Docx** — document export (to Markdown), import (from Markdown), block listing
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

Initial call to AuthenAuthorize is required to set clientId and clientSecret. App Credentials and Token state are persisted in `lark.json` at the project root.

## Testing via MCP

This project is configured as an MCP server in `.mcp.json` (`pnpm tsx src/mcp.ts`). Claude Code can call the Lark MCP tools directly to test changes — use the `mcp__lark__*` tools (e.g. `DocxDocumentExport`, `WikiSpaceList`) to verify actions work correctly after editing.

**Restarting after code changes:** The MCP server runs as a child process of Claude Code. After making code changes, call the `mcp__lark__McpRestart` tool to restart the server. This exits the process cleanly; Claude Code will auto-restart it on the next tool call, picking up changes to existing actions.

**Caveat — new tools:** Claude Code caches the tool list at connection time. Changes to existing actions are picked up after restart, but *newly added* actions won't appear until the MCP connection is fully re-established (ask the user to reconnect).

## Publishing

This is an unscoped public package. Publish with:

```sh
pnpm publish --no-git-checks
```

## Wrap-Up Flow

When finishing a session or feature, follow this checklist:

1. **Clean up**: Remove debug code, unused files, stale references
2. **Update docs**: Update any documentation for important changes
3. **Update CLAUDE.md**: Keep this file current with architectural changes
4. **Commit**: Stage files, write descriptive commit message
5. **Publish**: If releasing, bump version and `pnpm publish --no-git-checks`
6. **Update memory**: Update `MEMORY.md` with stable patterns and key decisions from the session

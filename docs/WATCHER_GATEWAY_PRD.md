# PRD — Watcher Control Gateway (subscriptions API + event streaming)

Status: **Draft for implementation** · Owner: engineering · Related: [ARCHITECTURE.md](./ARCHITECTURE.md), [COMMS.md](./COMMS.md)

## 1. Summary

Turn the message watcher (`lark-serve`) into a **single-process Lark gateway** that agents fully control at runtime. Today MCP and the watcher coordinate only through shared files (indirect, no acks, race-prone under concurrent writers, no imperative control, no live event delivery). This PRD adds a **local control channel** — a Unix domain socket exposing a small request/response + streaming protocol — so any number of MCP-connected agents can list/add/update/remove subscriptions, configure the reflex, query live status, trigger a reconnect, and **subscribe to a live event stream**, all against a running watcher, with the watcher as the single authority for its own state.

The durable JSON config remains the boot store, so a no-arg `lark-serve` (or a launchd agent) still resumes state and needs no restart to reconfigure.

## 2. Goals / Non-goals

**Goals**
- G1. One long-running watcher process hosts N subscriptions over one Lark WebSocket connection.
- G2. Agents communicate *with* the watcher: acked request/response for subscription CRUD + reflex config + status.
- G3. `lark-serve` starts with **no arguments**; everything is configured after start over the channel.
- G4. Watcher is decoupled from MCP; MCP **detects** a running watcher and **interacts** with it.
- G5. Change an existing subscription's endpoints/filters live, **id-stable** (no delete+recreate).
- G6. Multiple MCP agents interact concurrently without lost updates.
- G7. Production launchd agent, always-on, no restart required for any config change.
- G8. **Live event streaming**: a persistent client receives matched (or all) events as they arrive — a reliable relay, with gap-free delivery across reconnects.

**Non-goals (this PRD)**
- Hosting multiple Lark *apps* / multiple WS connections (future axis).
- Remote/networked control (UDS is local, same-user only).
- Changing reflex classification behavior (e.g. COMMS.md "always notify the agent / agent overrides reflex") — the streaming payload is *designed to support* it, but that behavior is follow-on work.
- Replacing the token store; we only make its writes concurrency-safe.

## 3. Locked decisions (agreed)

1. **Transport = Unix domain socket** at `~/.silkweave-lark.watcher.sock` (no port; 0600 perms; connectability = liveness).
2. **Watcher-down mutations hard-fail** with the existing `START_HINT` (no offline file-write fallback). Read-only tools may still fall back to file reads.
3. **Scope = full**: CRUD + `status` + `reconnect` **and** `subscribe`/streaming in v1.
4. **Keep the heartbeat file** (external monitors + read-only fallback) **and add a file lock** to the token store's read-modify-write.

## 4. Current state (baseline)

- Watcher = `MessageWatcher` in `lark-serve`; one WS long-connection; `subscriptions[]` are filter+dispatch rules (this is already the right "one stream, N rules" shape).
- Coordination is file-only: MCP writes `~/.silkweave-lark.json` (`watcher.subscriptions`, `watcher.reflex`); the watcher re-reads config per event; the watcher writes `watcher.status.json` (heartbeat) which `EventWatchStatus` reads.
- Gaps: no request/response; `TokenClient` does whole-file read-modify-write with **no lock** (watcher token-refresh vs MCP OAuth/subscription writes can clobber; two MCP agents lose updates); no `subscriptions.update`; no imperative `reconnect`; status is ≤10s stale; no live event delivery.

## 5. Architecture

```
        ┌─────────────── MCP server A ───┐   ┌── MCP server B ──┐   ┌─ lark-listen ─┐
        │ Event* tools → watcherClient   │   │ watcherClient    │   │ streaming     │
        └──────────────┬─────────────────┘   └───────┬──────────┘   └──────┬────────┘
                       │ connect() UDS               │                     │
                       ▼                             ▼                     ▼
        ┌──────────────────────── lark-serve (watcher) ─────────────────────────────┐
        │  WSClient (Lark long-connection)  │  MessageWatcher.handleMessage()        │
        │  WatcherGateway (UDS server)  ── single applier of subscriptions/reflex ── │
        │    • request/response methods     • event fan-out to stream subscribers    │
        └───────────────┬───────────────────────────────┬──────────────────────────┘
                        │ atomic write                   │ heartbeat
              ~/.silkweave-lark.json (locked)   ~/.silkweave-lark.watcher.status.json
```

- The **WatcherGateway** runs inside the watcher process. It is the only writer of `watcher.*` config while running; because handling is on the single Node event loop, mutations are serialized → no lost updates (G6).
- MCP `Event*` tools become **thin clients** (`watcherClient`) that connect, send one request, read one response, close. Detection = "can I connect?"; on failure → not-running + `START_HINT`.
- Streaming clients hold a **persistent** connection and receive event frames.

## 6. Transport & wire protocol

- **Socket:** `~/.silkweave-lark.watcher.sock`, mode `0600`. Constant `SOCK_PATH` added alongside `PID_PATH`/`STATUS_PATH` in `src/lib/watcherStatus.ts`.
- **Framing:** newline-delimited JSON (NDJSON) — one JSON object per line, UTF-8.
- **Protocol version:** every frame carries `v: 1`. Server rejects unknown `v` with `error.code = "unsupported_version"`.

**Request** (client → server)
```jsonc
{ "v": 1, "id": "c1", "method": "subscriptions.add", "params": { ... } }
```
**Response** (server → client, correlated by `id`)
```jsonc
{ "v": 1, "id": "c1", "ok": true,  "result": { ... } }
{ "v": 1, "id": "c1", "ok": false, "error": { "code": "not_found", "message": "…", "data": {} } }
```
**Event frame** (server → client, unsolicited, only after `subscribe`)
```jsonc
{ "v": 1, "kind": "event", "streamId": "s1", "type": "message", "payload": { ... } }
{ "v": 1, "kind": "event", "streamId": "s1", "type": "heartbeat" }
{ "v": 1, "kind": "event", "streamId": "s1", "type": "overflow", "dropped": 128 }
```
Discriminator: responses have `id`+`ok`; server-initiated frames have `kind:"event"`.

**Error codes:** `unsupported_version`, `invalid_params`, `not_found`, `conflict`, `unavailable` (WS/Lark not ready), `internal`. Client-synthesised: `watcher_unavailable` (cannot connect), `timeout`.

**Limits:** max request line 1 MiB; request timeout (client) 10 s default; server drops a connection after 3 malformed frames.

## 7. Method catalog

| Method | Params | Result | Notes |
|---|---|---|---|
| `ping` | — | `{ pong, pid, version, uptimeMs }` | cheap liveness/version handshake |
| `status` | — | `WatcherStatus` (+`wsConnected`, `activeStreams`) | **live**, on-demand (not the ≤10s heartbeat) |
| `subscriptions.list` | — | `{ subscriptions: MessageSubscription[] }` | |
| `subscriptions.add` | `SubscriptionInput` | `{ subscription }` | server generates `id`, persists atomically |
| `subscriptions.update` | `{ id, patch }` | `{ subscription }` | id-stable; `not_found` if missing; **G5** |
| `subscriptions.remove` | `{ id }` | `{ removed: id }` | `not_found` if missing |
| `reflex.get` | — | `{ reflex }` (no secrets) | mirrors current sanitized shape |
| `reflex.set` | `ReflexInput` | `{ reflex }` | live-apply; `conflict` if `enabled && !apiKey` |
| `reconnect` | — | `{ reconnected: true, wsConnected }` | tear down + re-establish WS (re-reads app creds + bot info) — **G7** for credential changes |
| `subscribe` | `StreamFilter` | `{ streamId }` then event frames | see §8 |
| `unsubscribe` | `{ streamId }` | `{ closed: streamId }` | also auto-closed on disconnect |

**`SubscriptionInput`** = `{ chatId?, chatName?, mentionBot?, keywords?, onEventCommand?, webhookUrl?, webhookSecret? }` (same fields as today).

**`patch`** semantics: field **present & non-null** → set; field **`null`** → clear the optional field; field **omitted** → unchanged. (Enables clearing a `webhookUrl` without recreating.)

**`ReflexInput`** = `{ enabled?, apiKey?, model?, playbook?, reactionEmoji?, historyLimit? }`; `apiKey:""`/`playbook:""` clear (matches current). Returns sanitized `{ enabled, model, reactionEmoji, hasApiKey, hasPlaybook, historyLimit }`.

## 8. Event streaming (`subscribe`) — the reliable relay

**Filter** (`StreamFilter`):
```jsonc
{
  "deliver": "matched" | "all",   // default "matched" (events.jsonl semantics); "all" = every inbound msg (full transcript)
  "chatId": "oc_…",               // optional narrowing
  "subscriptionId": "sub_…",      // optional: only events matched by this subscription
  "mentionedBot": true,            // optional
  "includeHistory": 20,            // optional: attach last-N history (excl. trigger) to each payload
  "sinceTs": "2026-07-09T…Z"       // optional: replay matching events from events.jsonl before going live (gap-free reconnect)
}
```

**Payload** (`type:"message"`):
```jsonc
{
  "event": MessageEventRecord,          // same shape EventList returns
  "history": HistoryEntry[] | undefined, // when includeHistory > 0
  "reflex": {                            // present when the reflex ran for this event
    "category": "trivial|task|ignore",
    "replied": true,
    "replyText": "…",
    "dispatched": true                   // whether the heavy agent was dispatched
  } | undefined
}
```
The event is emitted **after** the watcher finishes processing (so the reflex outcome is known and included). This carries the reflex's decision to a streaming agent — the substrate COMMS.md needs for "reflex notifies the agent + agent can override," without changing reflex behavior here.

**Delivery semantics**
- Live, at-most-once, ordered per connection.
- **Gap-free reconnect:** on `subscribe` with `sinceTs`, the watcher replays matching lines from `events.jsonl` (newest bounded, e.g. ≤500) then switches to live; a client that reconnects passes the last-seen `receivedAt` → no missed events.
- **Backpressure:** per-subscriber bounded queue (e.g. 1 000 events / 8 MiB). If `socket.write()` stays saturated past the bound, the watcher emits an `overflow` frame with the dropped count and **closes that stream** (protects the watcher; the slow client reconnects with `sinceTs` to catch up). Never blocks `handleMessage`.
- **Keepalive:** server emits a `heartbeat` event frame every 15 s; clients treat 45 s of silence as dead and reconnect.

**Consumers**
- `watcherClient.stream(filter, onEvent)` — persistent connection with **exponential-backoff auto-reconnect** and automatic re-`subscribe` (carrying the last `receivedAt` as `sinceTs`).
- New `lark-listen` bin (thin CLI over `stream`) for humans/agents/tests — prints event frames as NDJSON.
- (Future) bridge stream → MCP server notifications so a tool-side agent gets pushes; out of scope for v1.

## 9. State ownership & concurrency

- **Subscriptions + reflex config:** the running watcher is the sole applier. Each mutating method mutates the in-memory table and persists via **atomic write** (temp file + `rename`). Serialized by the event loop → G6.
- **Token store (`~/.silkweave-lark.json`) is still multi-writer** (MCP OAuth + watcher token refresh + subscription persistence share the file). Add an **advisory lock** around `TokenClient` read-modify-write (`flush`): a minimal `withFileLock(path, fn)` helper using an `O_EXCL` lockfile (`<path>.lock`) with bounded retry + stale-lock takeover (mtime > 10 s). No new dependency. This closes the token-refresh-vs-OAuth clobber that exists **today**, independent of the gateway.
- Reads (`getWatcherConfig`) stay lock-free (single-line JSON read; torn reads avoided because writes are atomic-rename).

## 10. Watcher lifecycle

- **Start (no args):** load config → connect WS → fetch bot info → **bind UDS**. If `SOCK_PATH` exists: attempt connect; connectable → another watcher alive → refuse (in addition to the existing pidfile guard); not connectable → unlink stale socket, bind. Write pidfile + status; start heartbeat.
- **Shutdown (SIGINT/SIGTERM):** stop heartbeat, close all streams, close UDS server, `unlink(SOCK_PATH)`, clear status, remove pidfile (existing `stop()` path, extended).
- **`reconnect` method:** close WSClient, re-read app creds, re-`start` WS, re-fetch bot info; keep the UDS server and streams up throughout.
- Heartbeat file retained for external monitors and read-only fallback.

## 11. MCP tool changes

All `Event*` tools route through `watcherClient`. Watcher-down behavior per decision 2:

| Tool | Method | Watcher down |
|---|---|---|
| `EventWatchStatus` | `status` | fall back to `readWatcherStatus()` (file) → running:false + `START_HINT` |
| `EventSubscriptionList` | `subscriptions.list` | fall back to config file read (still show configured subs) |
| `EventSubscriptionCreate` | `subscriptions.add` | **hard-fail** with `START_HINT` |
| `EventSubscriptionUpdate` *(new)* | `subscriptions.update` | **hard-fail** |
| `EventSubscriptionDelete` | `subscriptions.remove` | **hard-fail** |
| `EventReflexConfigure` | `reflex.set` | **hard-fail** (can't live-apply) |
| `EventWatchReconnect` *(new)* | `reconnect` | **hard-fail** |

Setup flow stays "start bare, then configure": start `lark-serve` (reflex disabled by default → no apiKey needed to boot) → `EventReflexConfigure` sets apiKey + enables → live. The `--reflex/--api-key/--playbook` flags remain optional pre-seeds.

`EventList` is unchanged (reads `events.jsonl`); still useful for history/replay queries.

## 12. New / changed files

**New**
- `src/types/gateway.ts` — protocol types (`GatewayRequest`, `GatewayResponse`, `GatewayEventFrame`, method param/result types, `StreamFilter`, error codes).
- `src/lib/watcherGateway.ts` — UDS server: bind/teardown, NDJSON framing, request dispatch, stream registry + fan-out, backpressure. Holds a reference to the `MessageWatcher` to apply mutations and to `emitEvent()`.
- `src/lib/watcherClient.ts` — client: `request(method, params, opts)`, `isAvailable()`, `stream(filter, onEvent)` with auto-reconnect.
- `src/lib/fileLock.ts` — `withFileLock(path, fn)` O_EXCL lock helper.
- `src/actions/Event/EventSubscriptionUpdate.ts` — new tool.
- `src/actions/Event/EventWatchReconnect.ts` — new tool.
- `src/listen.ts` + `lark-listen` bin — streaming CLI.

**Changed**
- `src/lib/watcherStatus.ts` — add `SOCK_PATH`; `WatcherStatus` gains `wsConnected?`, `activeStreams?`.
- `src/lib/messageWatcher.ts` — start/stop the gateway; expose apply-mutation methods (add/update/remove/reflexSet/reconnect) that mutate + atomic-persist; call `gateway.emitEvent(record, {history, reflex})` at the end of `handleMessage`; track `wsConnected`.
- `src/classes/TokenClient.ts` — wrap `flush()` (and read-modify-write) in `withFileLock`; atomic write (temp+rename).
- `src/serve.ts` — unchanged start path (gateway starts inside `MessageWatcher.start()`); ensure clean shutdown closes the gateway.
- `src/actions/Event/EventWatchStatus.ts`, `EventSubscriptionList.ts`, `EventSubscriptionCreate.ts`, `EventSubscriptionDelete.ts`, `EventReflexConfigure.ts` — route through `watcherClient` with the fallbacks above.
- `src/actions/index.ts` — register `EventSubscriptionUpdate`, `EventWatchReconnect`.
- `package.json` — add `lark-listen` bin; `tsdown` entry for `listen.ts`.
- Docs: `ARCHITECTURE.md` (add gateway to diagrams), `README.md` (tools + gateway + streaming + launchd plist example), `CLAUDE.md` (architecture rule + new files).

## 13. Security

- UDS mode `0600`, owner-only. Threat model = same-user local processes, identical to who can already read `~/.silkweave-lark.json`. **Never** expose over TCP. Document this.

## 14. Backward compatibility & migration

- No config schema change (subscriptions/reflex shapes unchanged). No migration needed.
- Heartbeat/status file and pidfile retained; existing external monitors keep working.
- `lark-serve` flags unchanged. `.mcp.json` unchanged.
- Read-only tools degrade gracefully when the watcher is down.

## 15. Observability

- `status.activeStreams`, `wsConnected` exposed. Gateway logs (connect/disconnect/method/errors, stream open/close/overflow) to **stderr** (stdout stays MCP protocol). Heartbeat unchanged.

## 16. Test plan

No unit framework in-repo today; do **minimal unit harness** for pure logic + an **agent-driven scenario doc** (mirroring `TEST_SCENARIO.md`).

- **Unit:** NDJSON frame encode/decode; `patch` semantics (set/clear/omit); stream filter matching; `withFileLock` mutual exclusion.
- **Integration (scenario doc):** start bare watcher → `ping`/`status` → add/list/update(endpoint)/remove roundtrip → `reflex.set` live-apply verified by a real message → `reconnect` keeps streams up.
- **Concurrency:** two MCP clients `subscriptions.add` concurrently → both present (no lost update); hammer token refresh + OAuth write under lock → file never corrupt.
- **Streaming:** subscribe → real message → payload (incl. `reflex`) received; slow consumer → `overflow` + close; kill+restart watcher mid-stream → client auto-reconnects and `sinceTs` replay yields **no gaps**; `unsubscribe`/disconnect cleanup (`activeStreams` returns to 0).
- **launchd:** KeepAlive plist; `kill` the watcher → relaunched → client reconnects.

## 17. Implementation phases

- **P0 — Protocol & primitives:** `types/gateway.ts`, `SOCK_PATH`, `fileLock.ts`, atomic write + lock in `TokenClient`. *(independently shippable: fixes today's config race)*
- **P1 — Gateway server:** `watcherGateway.ts` bind/teardown/framing/dispatch; `ping`, `status`; wire into `MessageWatcher.start/stop`.
- **P2 — CRUD + config methods:** `subscriptions.*`, `reflex.*`, `reconnect` as single-applier mutations.
- **P3 — Client + MCP tools:** `watcherClient.ts`; repoint 5 tools; add `EventSubscriptionUpdate`, `EventWatchReconnect`; watcher-down handling.
- **P4 — Streaming:** `subscribe`/`unsubscribe`, fan-out in `handleMessage`, backpressure, `sinceTs` replay; `watcherClient.stream()`; `lark-listen` bin.
- **P5 — Docs + scenario:** update ARCHITECTURE/README/CLAUDE; write `docs/GATEWAY_TEST_SCENARIO.md`.

Each phase builds green (`pnpm check`) and is verifiable via MCP + `lark-listen`.

## 18. Open questions

- Bridge stream → MCP notifications so a tool-side agent gets pushes without a separate process? (Deferred; `lark-listen`/`stream()` cover v1.)
- Multi-app hosting (multiple WS keyed by app credentials) — separate PRD.
- Do we want a signed/authenticated handshake beyond UDS perms? (No, for same-user local.)

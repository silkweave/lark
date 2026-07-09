# Test scenario: reflex + history + webhook (v1.10.0)

Paste this to a fresh Claude Code session with the `lark` MCP server connected, in this repo. Goal: exercise the reflex/history/webhook code paths — persisted reflex API key, config validation, the shared cross-process history log, reflex context-awareness, and webhook dispatch — plus the edge cases each one can fail on. For the watcher control gateway itself (subscription CRUD over the socket, streaming, `lark-listen`, reconnect, watcher-down behavior), run [GATEWAY_TEST_SCENARIO.md](./GATEWAY_TEST_SCENARIO.md) — it's the companion to this doc.

Prerequisite: `lark-serve` must be running (VS Code "lark-serve" debug config, or `pnpm serve --reflex --playbook ./docs/PLAYBOOK.md`) against a real Lark chat the bot is in, with at least one `EventSubscriptionCreate` pointed at that chat. Check `EventWatchStatus` first — `running: true` with a `pid`, `wsConnected: true`, and `reflex.hasApiKey: true`. Note: since v1.10.0, `EventReflexConfigure` and all `EventSubscription*` mutations are applied live on the running watcher over its control gateway — they hard-fail with a start hint when the watcher is down, so start it before configuring.

## 1. Config validation (should fail loudly, not silently)

1a. Call `EventReflexConfigure` with `enabled: true` and no `apiKey`, on a fresh config where none is set (read current config first via `EventWatchStatus` to confirm whether a key exists — if one does, call `EventReflexConfigure` with `apiKey: ""` and `enabled: true` in the same call to exercise the same guard).
   - **Expect:** the action fails with a `conflict` error (`Reflex cannot be enabled without an apiKey...`) and does NOT persist the change (verify via `EventWatchStatus` that `reflex.enabled` is unchanged from before).

1b. Restore a valid `apiKey` via `EventReflexConfigure`, confirm `EventWatchStatus.reflex.hasApiKey === true` and it's consistent regardless of which process you ask (this was the original bug — status used to read `process.env` of whichever process answered, giving different answers from the MCP server vs. `lark-serve`). Since v1.10.0 this applies live with no restart — the watcher itself persisted the change.

1c. Try to start a *second* watcher (run `pnpm serve` in another shell while `lark-serve` is already running) — expect it to refuse: the "already running in process N" pidfile error, backed by the gateway's own socket-liveness guard. This is a regression check.

## 2. Reflex classification, all three categories

Send these as real messages in the subscribed chat (from a human account, not via `ImMessageSend` — bot-authored messages don't generate `im.message.receive_v1` events, so they won't exercise the watcher at all):

2a. **Trivial**: `@<bot-name> what's 12 + 30?` — expect an instant `Typing` reaction, then an inline correct-answer reply within a few seconds, tone matching whatever's in `docs/PLAYBOOK.md`. Check `EventWatchStatus.reflex.counters.trivial` incremented. Confirm via `EventList` (or reading `~/.silkweave-lark.history.jsonl` directly) that NO `onEventCommand`/webhook dispatch fired for this one (`counters.dispatched` should not increase from this message).

2b. **Task**: `@<bot-name> can you check the last 5 commits in this repo and summarize them?` — expect a reaction + a brief "working on it"-style ack reply, `counters.task` increments, AND (if the subscription has `onEventCommand` or `webhookUrl` configured) a dispatch fires. If neither is configured on the subscription, this is expected to stop at the ack — note that explicitly rather than treating it as a bug (this is exactly what happened earlier this session before we added `webhookUrl`).

2c. **Ignore**: mention the bot only in passing, e.g. `thanks everyone, including @<bot-name>, great meeting today` — expect the `Typing` reaction to be added then immediately removed, no reply at all, `counters.ignored` increments.

2d. **Thread engagement without re-mention**: after 2a or 2b, reply *in the same thread* without re-mentioning the bot (e.g. `and what about 12 + 45?`). Expect this to still be treated as engaged (per `isEngagedThread`/`engagedThreads`) and classified — this exercises the "engaged thread" tracking, separate from history.

## 3. History context (the main feature this session)

3a. **Cross-message reference resolution** (the original failure case): mention the bot with something that only makes sense given a prior message, e.g. send `@<bot-name> can you explain what that last thing you said means?` right after a 2a/2b exchange. Expect the reflex reply to actually reference the prior exchange correctly instead of asking "what are you referring to?" — this was the literal bug reported earlier in the session.

3b. **History ordering/attribution**: read `~/.silkweave-lark.history.jsonl` directly (tail the last ~20 lines) after a mixed exchange (some plain chat, a trivial reflex reply, a task reflex ack). Verify:
   - Every inbound message got a `role: 'user'` entry, INCLUDING ones that never matched any subscription or never mentioned the bot (history recording is unconditional, unlike the events log).
   - Reflex's own replies appear with `role: 'reflex'` and the correct `text`.
   - Entries are chronologically ordered by `createTime` and `chatId` is consistent.
   - If you have `ImMessageSend`/`ImMessageReply` calls in this session's transcript (e.g. from earlier testing), confirm those produced `role: 'agent'` entries too.

3c. **`historyLimit` respected**: set `EventReflexConfigure({ historyLimit: 3 })`, send a message that would only make sense with more than 3 messages of context, and confirm the reflex genuinely has less context (harder to verify directly, but check that `readHistory` in the reflex prompt — if you can get reflex to admit uncertainty — respects the smaller window). Reset `historyLimit` back to a sane value (e.g. 15) afterward.

3d. **History survives across processes**: confirm the history file is being written to by `lark-serve` and read correctly when, e.g., `ImMessageSend` is called from *this* Claude Code session (a different process). Send a message via `ImMessageSend` to the subscribed chat, then check the last line of `~/.silkweave-lark.history.jsonl` reflects it with `role: 'agent'` — proving the log is genuinely shared across processes, not per-process in-memory state.

3e. **Non-text messages**: post an image or a `post`-type rich message in the chat (no text). Confirm the watcher doesn't crash (`EventWatchStatus.counters.errors` unchanged) and check what `extractText`/history recorded for it — this exercises a code path that wasn't explicitly tested this session (`extractText`'s JSON.parse fallback).

## 4. Webhook dispatch (new, untested end-to-end this session)

This needs a receiver. Spin up a minimal local HTTP listener first — e.g.:

```sh
node -e "
require('http').createServer((req, res) => {
  let body = ''
  req.on('data', (c) => body += c)
  req.on('end', () => {
    console.log(new Date().toISOString(), JSON.parse(body))
    res.writeHead(200); res.end('ok')
  })
}).listen(8091, () => console.log('listening on 8091'))
"
```

4a. Update the subscription in place with `EventSubscriptionUpdate { id, webhookUrl: "http://localhost:8091", webhookSecret: "<secret>" }` (id-stable — same `id` comes back; no delete+recreate needed since v1.10.0). Send a matching message, and confirm:
   - The listener receives a POST within ~10s with `Content-Type: application/json`, header `X-Silkweave-Signature` equal to the configured secret, and a body shaped `{ subscriptionId, event, history }` where `event` matches the `MessageEventRecord` shape (same fields as `EventList` entries) and `history` is an array of up to 20 entries, oldest first, excluding the triggering message itself.
   - `EventWatchStatus.counters.dispatched` incremented.

4b. **Failure path**: point `webhookUrl` at something that will fail via `EventSubscriptionUpdate` (e.g. `http://localhost:1` — nothing listening, or kill the listener from 4a), send another matching message, and confirm `counters.errors` increments and `lastError` is set to something like `fetch failed`/`webhook responded 5xx`, and — critically — that this does NOT crash the watcher or block subsequent events (send a second message right after and confirm it's still processed normally).

4c. **Both mechanisms at once**: if feasible, set both `onEventCommand` (e.g. `echo "got it" >> /tmp/dispatch-test.log`) and `webhookUrl` on the same subscription, send one matching message, and confirm BOTH fire for the same event (check the log file AND the webhook listener both got hit).

4d. **Timeout**: point `webhookUrl` at a listener that deliberately hangs (never calls `res.end()`) and confirm the dispatch aborts around 10s (`AbortSignal.timeout(10000)`) rather than hanging the watcher indefinitely — time this with a stopwatch/timestamp comparison, don't just assume.

## 5. Cleanup after testing

- Remove or fix the test subscription's `onEventCommand`/`webhookUrl` if you don't want them live afterward (`EventSubscriptionUpdate` with `null` clears just those fields — e.g. `{ id, webhookUrl: null, webhookSecret: null }` — or `EventSubscriptionDelete` to drop the subscription entirely).
- Kill any local test HTTP listener from section 4.
- If `historyLimit` was changed in 3c, confirm it's back to your intended default.
- Note in your summary: which sections passed, which didn't, and for anything that failed — the actual observed behavior vs. expected, plus whatever `~/.silkweave-lark.history.jsonl` / `EventList` / `EventWatchStatus` showed at the time (don't just say "reflex didn't respond" — show the counters and the last few log lines).

# Test scenario: watcher control gateway (v1.10.0)

Paste this to a fresh Claude Code session with the `lark` MCP server connected, in this repo. Goal: exercise the watcher control gateway end-to-end — request/response over the Unix socket, live subscription CRUD, id-stable updates, reflex live-apply, reconnect, event streaming with `sinceTs` replay, watcher-down behavior, and the file-locked token store. Companion to [TEST_SCENARIO.md](./TEST_SCENARIO.md) (reflex/history/webhook paths, all still valid).

Prerequisite: valid Lark app credentials in `~/.silkweave-lark.json` and a real chat the bot is in. Start with **no watcher running** (`kill $(cat ~/.silkweave-lark.watcher.pid)` if needed; confirm `~/.silkweave-lark.watcher.sock` is gone).

## 1. Watcher-down behavior (hard-fail vs fallback)

1a. With no watcher running, call `EventWatchStatus` — expect `running: false` and a `notRunningReason` containing the exact start command (file fallback path).

1b. Call `EventSubscriptionList` — expect it to still return the configured subscriptions from the config file, with `watcher.running: false`.

1c. Call `EventSubscriptionCreate` (any filter) — expect a **hard failure** whose message contains the start hint. Same for `EventSubscriptionUpdate`, `EventSubscriptionDelete`, `EventReflexConfigure`, and `EventWatchReconnect`. Nothing may be written to the config file by these failed calls (diff `~/.silkweave-lark.json` before/after).

## 2. Bare start + live configuration

2a. Start the watcher **with no arguments** (`pnpm serve` in a background shell). Expect a boot log naming the gateway socket, and `~/.silkweave-lark.watcher.sock` to exist with mode `0600` (`ls -la ~/.silkweave-lark.watcher.sock`).

2b. `EventWatchStatus` now reports `running: true` with `wsConnected: true` and `activeStreams: 0` — and responds instantly (live gateway query, not the ≤10s heartbeat).

2c. Try starting a **second** watcher — expect it to refuse (pidfile guard and/or "another watcher gateway is already serving" from the socket probe), leaving the first untouched.

## 3. Subscription CRUD roundtrip (id-stable update)

3a. `EventSubscriptionCreate { chatId: <real chat>, mentionBot: true }` — returns a `subscription` with an `id`. `EventSubscriptionList` shows it; `~/.silkweave-lark.json` contains it (persisted by the watcher, not the MCP process).

3b. `EventSubscriptionUpdate { id, keywords: ["deploy"], webhookUrl: "http://localhost:8091" }` — same `id` back, both fields set.

3c. **Null-clears:** `EventSubscriptionUpdate { id, webhookUrl: null }` — `webhookUrl` gone from the returned subscription and from the config file; `keywords` untouched. Omitted fields must never change.

3d. `EventSubscriptionUpdate` with a bogus id — expect a `not_found` error, not a silent success.

3e. **Live-apply without restart:** send a real matching message in the chat; confirm it lands in `EventList`. Then `EventSubscriptionDelete` the subscription, send another message, and confirm it does NOT land (watcher re-read config live).

## 4. Concurrency (no lost updates)

4a. Fire two `EventSubscriptionCreate` calls in quick succession (ideally from two MCP sessions/processes; same session is acceptable). Both subscriptions must exist afterward in `EventSubscriptionList` AND in the config file — no last-writer-wins clobber.

4b. Token-store lock: run `pnpm test` — the `fileLock` suite spawns 4 processes doing 25 locked read-modify-writes each and asserts the final count is exactly 100.

## 5. Reflex live-apply

5a. `EventReflexConfigure { enabled: true }` with no apiKey stored — expect a `conflict`-style hard failure ("cannot be enabled without an apiKey"), config unchanged.

5b. `EventReflexConfigure { enabled: true, apiKey: <key> }` — returns the sanitized view (`hasApiKey: true`, never the key itself). Send a real @-mention: the reflex must react/classify **without any watcher restart**. `EventWatchStatus.reflex.counters` moves.

5c. `EventReflexConfigure { enabled: false }` — a subsequent mention goes straight to dispatch (no reaction), again with no restart.

## 6. Event streaming (`lark-listen`)

6a. Run `pnpm listen -- --all` (or `lark-listen --all`) in a background shell. `EventWatchStatus.activeStreams` becomes 1.

6b. Send a real message in the chat (no mention needed with `--all`) — a `{ event, ... }` NDJSON line appears on the listener's stdout even if no subscription matched. Send an @-mention with reflex enabled — the payload must include the `reflex` block (`category`, `replied`, `replyText`, `dispatched`), proving events are emitted *after* processing.

6c. **Gap-free reconnect:** kill the watcher while the listener is running (listener logs disconnect + retry to stderr). Send nothing; restart `pnpm serve`; send a matching (subscription-matched) message. The listener must reconnect automatically and print the new event. Then verify replay: note the `receivedAt` of an old event from `EventList`, run `lark-listen --since <that ts>`, and confirm the old events are replayed (no duplicates within one session — client dedupes by messageId) before live delivery resumes.

6d. **Cleanup:** Ctrl-C the listener; `EventWatchStatus.activeStreams` returns to 0.

## 7. Reconnect method

7a. With the listener from §6 still attached, call `EventWatchReconnect` — expect `{ reconnected: true, wsConnected: true }`, the stream connection to survive (no disconnect logged by the listener), and a real message to still flow end-to-end afterward.

## 8. Shutdown hygiene

8a. `kill $(cat ~/.silkweave-lark.watcher.pid)` — the pidfile, status file, AND socket file must all be removed. `EventWatchStatus` reverts to the file-fallback `running: false` answer.

8b. Crash-sim: `kill -9` the watcher (socket file left behind), then start `lark-serve` again — it must detect the stale socket (not connectable), unlink it, and bind cleanly.

## 9. Report

Summarize per section: pass/fail, and for failures the observed vs expected behavior with the relevant evidence (gateway stderr log lines, `EventWatchStatus` output, config file diffs, listener output) — not just "didn't work".

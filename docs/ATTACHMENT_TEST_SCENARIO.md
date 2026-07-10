# Test scenario: attachment sideloading (v1.13.0)

Paste this to a fresh Claude Code session with the `lark` MCP server connected, in this repo. Goal: exercise the attachment-sideloading paths added in v1.13.0 (`src/lib/attachments.ts`) — resource downloads to local disk, attachment references in the event record / history / webhook payload / `LARK_ATTACHMENTS_JSON`, the new `post` (rich text) handling incl. the widened reflex gate, gating on chat coverage, failure paths, and the retention sweep. Companions: [TEST_SCENARIO.md](./TEST_SCENARIO.md) (reflex/history/webhook basics) and [AUTOMATION_WEBHOOK.md](./AUTOMATION_WEBHOOK.md) (the wiring this feature was built for).

Prerequisites:

- **`im:resource` permission enabled** on the Lark app in the developer console (and the app version published) — without it every download fails (that failure path is itself tested in 4b, so check the current state first).
- `lark-serve` running **from the new code** (restart it if it predates this session), with reflex enabled and at least one subscription covering a real test chat. Verify via `EventWatchStatus`: `running: true`, `wsConnected: true`, `reflex.hasApiKey: true`.
- All inbound test messages must be sent from a **human account** (bot-authored messages don't generate `im.message.receive_v1` events).

## 1. Sideloading basics, per message type

Send each of these in the covered chat, then inspect the last lines of `~/.silkweave-lark.history.jsonl` and the contents of `~/.silkweave-lark.attachments/`:

1a. **Plain image message** (paste/send an image alone). Expect: history entry with `text: "[image]"` (not raw `{"image_key":…}` JSON — that was the old behavior) and an `attachments` array with one `{ key, type: "image", name, path, size, mimeType }`; the `path` exists under `~/.silkweave-lark.attachments/<messageId>/`, `size` > 0, extension matches the mime type (e.g. `.png`/`.jpg`), and the file opens as a valid image (`Read` it).

1b. **File message** (send a PDF or docx). Expect `text: "[file: <original name>]"`, the sideloaded copy keeps the original filename (sanitized), and the bytes match (compare `size` to the source file).

1c. **Rich-text `post`** combining text + an inline image + an @-mention of the bot (compose a message with a picture and the question in one bubble). Expect: `text` is the flattened plain text with an inline `[image]` placeholder and the mention resolved to `@<bot-name>`; the image is sideloaded; and — new in this version — the **reflex engages on the post** (indicator card appears; previously only `message_type: "text"` was gated in). The classifier is told attachments exist but can't see them, so a question about the image should classify as `task`, not `trivial`.

1d. **Sticker**: expect `text: "[sticker]"`, NO sideload attempt (no directory created), no error counted.

## 2. The cat scenario, end-to-end

The motivating use case: attachment sent first, question asked after.

2a. Send a photo of an animal (image message, no text). Then, as a separate message: `@<bot-name> what animal is this?`

2b. Expect the full chain: indicator card on the question → reflex classifies `task` → dispatch fires → the dispatched payload's `history` includes the *image* entry with its local `attachments[].path` (check `LARK_HISTORY_JSON` via an `onEventCommand` like `env > /tmp/lark-env-test.txt`, or the webhook body) → a delegated agent can `Read` that path and answer correctly. If you drive the delegated step by hand in this session, finish with `ImMessageReply` on the question's `messageId` and confirm the card morphs (`morphedIndicator: true`).

2c. Verify `formatHistory` rendering: the reflex/dispatch transcript line for the image message reads `… user:<open_id>: [image] [attached: /Users/…/.silkweave-lark.attachments/<messageId>/…]`.

## 3. Dispatch surfaces carry attachments

3a. **`onEventCommand` env**: set the subscription's `onEventCommand` to `printenv LARK_ATTACHMENTS_JSON >> /tmp/lark-attachments-test.log`, send a matching image, confirm the log line is a JSON array with the sideloaded path (and `[]` for a plain text message).

3b. **Webhook payload**: point `webhookUrl` at a local listener (snippet in [TEST_SCENARIO.md](./TEST_SCENARIO.md) §4), send an image in a post with a mention, confirm `event.attachments` is populated and `history[]` entries carry their own `attachments`.

3c. **`EventList`**: confirm persisted matched events include `attachments` (they're part of `MessageEventRecord`, appended to `events.jsonl`).

## 4. Gating and failure paths

4a. **Uncovered chat**: send an image in a chat the bot is in but **no subscription covers** (no `chatId` match and no catch-all subscription — temporarily narrow subscriptions if needed). Expect: history still records `text: "[image]"` but with NO `attachments` field, and no `~/.silkweave-lark.attachments/<messageId>/` directory — sideloading is gated on chat coverage, not on full match. Restore subscriptions afterward.

4b. **Download failure is non-fatal** (exercises the missing-`im:resource` path — if you can't toggle the permission, simulate by testing before enabling it): expect a `[lark-attachments] download failed …` line on the watcher's stderr, the message still processed normally (history entry present, `counters.errors` unchanged, matching/dispatch unaffected), just without `attachments`.

4c. **Watcher stability**: after all of the above, `EventWatchStatus.counters.errors` should not have grown from attachment handling, and subsequent plain-text messages must still process normally.

## 5. Retention sweep

5a. Backdate a sideloaded message directory past the 7-day window: `touch -mt 202606010000 ~/.silkweave-lark.attachments/<some-messageId>`. Restart `lark-serve` (the sweep runs on the first heartbeat after start, then hourly). Within ~15s expect the directory gone and a `Swept 1 expired attachment directory` line on stderr; fresh directories must remain.

## 6. Cleanup

- Clear test `onEventCommand`/`webhookUrl` values (`EventSubscriptionUpdate` with `null`), kill any local listener, restore any subscriptions narrowed in 4a.
- Remove test downloads: `rm -rf ~/.silkweave-lark.attachments` (the watcher recreates it on demand) and `/tmp/lark-attachments-test.log`.
- Summarize per section: pass/fail, and for failures the observed behavior — actual history lines, directory listings, stderr output, and counters, not just "it didn't work".

# Wiring a webhook-driven automation (Mac Mini deployment)

How to plug `lark-serve` into an existing automation platform (e.g. an Automation Suite on a Mac Mini whose triggers run `claude -p`) so that delegated runs reply into Lark correctly — including morphing the processing-indicator card. Everything described here already exists; no custom glue beyond the webhook receiver is needed.

## Topology

```
Lark ⇄ (WebSocket) ⇄ lark-serve (Mac Mini)
                         │  subscription.webhookUrl
                         ▼
              Automation Suite webhook (same machine)
                         │  trigger: claude -p (MCP: @silkweave/lark)
                         ▼
              ImMessageReply → card morphs into the reply
```

Run `lark-serve` on the Mac Mini (see the launchd example in the README — no arguments, config is applied live over the gateway). Create a subscription whose `webhookUrl` points at the Automation Suite's trigger endpoint, optionally with `webhookSecret` so the receiver can verify `X-Silkweave-Signature`:

```
EventSubscriptionCreate { chatId, mentionBot: true, webhookUrl: "http://localhost:<port>/lark-trigger", webhookSecret: "..." }
```

## What the webhook receives

One POST per matching message, JSON body:

```jsonc
{
  "subscriptionId": "sub_…",
  "event": {                    // MessageEventRecord — everything the run needs
    "chatId": "oc_…",
    "messageId": "om_…",        // ← reply target
    "text": "what animal is this @Abi",
    "attachments": [            // sideloaded resources, local absolute paths
      { "type": "image", "name": "image-1.png", "path": "/Users/…/.silkweave-lark.attachments/om_…/image-1.png", "size": 51234, "mimeType": "image/png" }
    ],
    // …chatType, rootId, threadId, sender, mentions, createTime, raw content
  },
  "history": [ /* last 20 chat messages, oldest first, incl. their attachments */ ],
  "ackMessageId": "om_…"        // present when reflex left a processing-indicator card
}
```

Because the watcher and the Automation Suite share the machine, `attachments[].path` is directly readable by the `claude -p` run (e.g. `Read` the image to answer "what animal is this?").

## Answering the two design questions

**"Do we need the card ID in the webhook metadata?"** It's there (`ackMessageId`), but the automation task normally never touches it. The delegated run just calls the `ImMessageReply` MCP tool with `messageId = event.messageId` (the *user's* message, not the card): a bot text reply to a message with a pending indicator card **morphs the card into the reply in place** — no extra message, no recall tombstone. This works from any process because pending cards are tracked in the file-locked `~/.silkweave-lark.pending-acks.json`, not in watcher memory. `ackMessageId` is only for advanced flows that want to patch the card themselves (e.g. progress updates via Lark's message PATCH API) — if you do, take over fully: the card is yours once you patch it outside the reply flow.

**"Can we respond to the webhook instead?"** No — the watcher's webhook dispatch is fire-and-forget: the response body is ignored and the request times out after **10 seconds** (a timeout/non-2xx only increments the error counter). So the receiver must acknowledge immediately (2xx) and run `claude -p` asynchronously. Replies always flow back through the MCP tools, not the HTTP response.

## Reply patterns for the delegated run

- **Normal case:** `ImMessageReply { messageId: event.messageId, msgType: "text", content: "{\"text\":\"…\"}" }` — morphs the card when one is pending (returns `morphedIndicator: true`), otherwise sends a regular threaded reply. Also records the reply in the shared history log.
- **Reply landed elsewhere** (non-text reply, or `ImMessageSend` to the chat): remaining pending cards in that chat resolve to a muted "✓ Done" note automatically.
- **Run died / took too long:** the watcher's heartbeat resolves cards older than **10 minutes** to "✕ No response". A reply after that still sends fine — it just can't morph the (already-resolved) card. For runs that legitimately exceed 10 minutes, patch the card periodically using `ackMessageId`, or reply early with a progress note.

## Checklist

1. `lark-serve` under launchd on the Mac Mini (README → "Running the watcher").
2. `EventReflexConfigure { enabled: true, apiKey: … }` for the instant-ack card + trivial-question short-circuit (optional but recommended).
3. `EventSubscriptionCreate` with `webhookUrl` (+ `webhookSecret`) pointing at the Automation Suite.
4. Automation trigger: verify signature → respond 2xx → spawn `claude -p` with the payload (async).
5. The `claude -p` run: read `event`/`history`/`attachments`, do the work, `ImMessageReply` to `event.messageId`.

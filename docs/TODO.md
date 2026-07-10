# TODO

_Nothing pending._

## Done

- **Mac Mini deployment / Automation Suite wiring** — resolved as documentation, no code needed: the webhook payload already carries `ackMessageId`, and the delegated `claude -p` run just calls `ImMessageReply` on `event.messageId` (the card morphs automatically; responding to the webhook HTTP request is not a channel — it's fire-and-forget with a 10s timeout). Full wiring guide: [AUTOMATION_WEBHOOK.md](AUTOMATION_WEBHOOK.md).
- **Attachment handling** — implemented: the watcher sideloads message resources (images, files, video, audio, images inside rich-text posts) to `~/.silkweave-lark.attachments/<messageId>/` and references the local paths on the event record, webhook payload, `LARK_ATTACHMENTS_JSON`, and chat history, with a 7-day retention sweep. See `src/lib/attachments.ts` and README → "Attachments".

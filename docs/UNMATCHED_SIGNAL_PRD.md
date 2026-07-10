# PRD: Reflex-scoped ack for mentioned-but-unwatched messages

**Status:** proposed (direction chosen 2026-07-10, not yet implemented)
**Origin:** [FAST_MESSAGE_SCENARIO.md](./FAST_MESSAGE_SCENARIO.md) §5, confirmed live during the §§1–4 end-to-end run on 2026-07-10.

## Problem

When a user sends a message that matches **zero subscriptions**, the watcher records it to the
unconditional history log (`~/.silkweave-lark.history.jsonl`, `role: 'user'`) and does nothing else:
no reflex, no dispatch, no indicator card, nothing to `deliver: 'matched'` streams. From the sender's
side this is **indistinguishable from the bot being broken** — they get zero signal.

This was observed twice on 2026-07-10:
- The original incident: "Can you check more broadly, e.g. parent folder" arrived in a ~41s window
  where the test subscription had been deleted and not yet recreated → silently dropped.
- During the §4 reproduction run: an incidental in-chat comment ("@Toby I feel like I'm reading a
  novel…") landed during the deliberate subscription gap → received-but-unmatched, no signal.

Both are *correct* under current semantics (nothing is listening, so nothing responds). The gap is UX,
not correctness: silence is right for "the bot has no reason to respond," but wrong for "the bot was
addressed but is misconfigured."

## Chosen direction: reflex-scoped ack

Add a minimal acknowledgement **only** when **all** of these hold:

1. `reflex.enabled` is true, **and**
2. the message **@-mentions the bot** (a direct address — `mentionedBot: true`), **and**
3. **no subscription covers the chat** (the message matched zero subscriptions).

That intersection is unambiguously a **configuration gap** — the bot was explicitly addressed but has
no subscription wired for the chat — and is worth a minimal signal. It deliberately excludes:

- Unmatched messages that **don't** mention the bot (ordinary chatter the bot has no reason to touch).
- Any behavior when `reflex.enabled` is false (no reflex machinery to lean on).

### Why not the broader options (rejected)

- **Leave as-is** — silence stays correct for genuine non-addressed chatter, but leaves the real
  misconfiguration case (mention + no sub) looking like a broken bot.
- **Signal every mention with zero subs regardless of reflex** — reasonable, but the ack mechanism we
  already have (the indicator card + a fast morph) is a reflex facility; scoping to `reflex.enabled`
  reuses it cleanly and avoids inventing a second ack path.

## Proposed behavior

On an inbound message where the three conditions above hold:

- Reply to the triggering message with a **single minimal note card** (reuse the indicator asset or a
  muted variant) reading something like: _"I'm not set up to act in this chat yet — no subscription is
  configured."_ Immediately resolved (not left pending — there is no workload behind it), so it never
  needs sweeping.
- Do **not** dispatch (there is no `onEventCommand`/`webhook` — there's no subscription).
- Do **not** run the classifier (nothing to classify toward; this is a config signal, not an answer).
- Count it under a new reflex counter, e.g. `reflex.counters.unconfigured`, so it's observable via
  `EventWatchStatus` without being conflated with `trivial`/`task`/`ignored`.

## Open questions

- **Rate-limiting / dedupe:** if a user sends several mentions into an unwatched chat, do we ack each,
  or once per chat per cooldown window? Leaning: once per chat per N minutes to avoid nagging.
- **Wording & actionability:** should the note hint at the fix (e.g. "ask an admin to add a
  subscription") or stay generic? Depends on who's typically in these chats.
- **Asymmetry with `reflex.enabled: false`:** under this proposal, disabling reflex also disables this
  config-gap signal. Acceptable? Alternative is a reflex-independent ack path, explicitly rejected
  above for simplicity — revisit if reflex-off deployments are common.
- **Interaction with `alwaysEngage`/`reflexTrigger`:** those only apply to *matched* subscriptions, so
  they're orthogonal here (no subscription = no trigger override in play). No conflict, but worth a
  test once implemented.

## Test plan (once implemented)

Extend FAST_MESSAGE_SCENARIO.md §4:

1. With reflex enabled and **no** subscription on a chat, @-mention the bot → expect exactly one
   minimal "not configured" note, `reflex.counters.unconfigured` +1, no dispatch, no classify.
2. Same chat, message **without** a mention → expect silence (history only), no note.
3. `reflex.enabled: false`, mention with no sub → expect silence (documents the accepted asymmetry).
4. Rate-limit: several mentions in a row into the unwatched chat → expect at most one note per cooldown.

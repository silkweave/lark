# Test scenario: fast/overlapping messages & the reflexTrigger override (v1.11.0+)

Paste this to a fresh Claude Code session with the `lark` MCP server connected, in this repo. Goal: exercise what happens when messages arrive faster than a human would naturally space them out — true concurrent processing of two *matched* messages, the subscription-gap false-negative found on 2026-07-10, and the new per-subscription `reflexTrigger` override. Companion to [TEST_SCENARIO.md](./TEST_SCENARIO.md) and [GATEWAY_TEST_SCENARIO.md](./GATEWAY_TEST_SCENARIO.md) — read those first for baseline reflex/gateway behavior; this doc only covers the overlap/gap edge cases layered on top.

Prerequisite: `lark-serve` running against a real chat the bot is in, reflex enabled with a valid API key. Start clean — no subscription on the test chat yet.

## 0. Why this doc exists

During live testing on 2026-07-10, a message ("Can you check more broadly, e.g. parent folder") got **zero reflex, zero indicator card, and no reply at all**. Root cause, found by cross-referencing `~/.silkweave-lark.history.jsonl` (unconditional — every inbound message) against `~/.silkweave-lark.events.jsonl` (matched-only) and `EventWatchStatus.counters` (`received: 10, matched: 9`): the message arrived in a ~41-second window where the test subscription had been deleted and not yet recreated (between-test-round cleanup). With no subscription covering the chat, `matches()` correctly returned false for every subscription (there were none) — by design, unmatched messages get no reflex/dispatch, only the unconditional history entry. This was a testing artifact, not a code bug, but it surfaces a real, currently-unaddressed UX gap: **a sender gets no signal at all when nothing is listening** — indistinguishable from the bot being broken. §4 below tests this deliberately; §5 is a discussion prompt on whether to fix it.

Separately, this doc formalizes a scenario that was *not* actually exercised on 2026-07-10 despite looking similar on the surface: true concurrent processing of two messages that **both matched** a subscription, sent close enough together that the first's classification/indicator-card/dispatch is still in flight when the second arrives. §§1–3 cover that.

## 1. Baseline: rapid-fire matched messages, no overlap forcing needed

1a. Create a subscription on a real chat with `reflexTrigger: { alwaysEngage: true }` (bypasses the mention/thread gate — every message in the chat engages reflex, maximizing how often two in-flight reflex runs actually overlap in a live test).

1b. Send two distinct messages back-to-back as fast as you can type/paste them (no deliberate delay) — ideally both classify as `task` (needs a lookup) so both get a pending indicator card rather than resolving instantly.

1c. Confirm via `EventWatchStatus.counters` that `received` and `matched` both incremented by 2 (i.e. **neither** message hit the subscription-gap trap from §0 — the subscription must already exist before you send anything).

1d. Confirm **two separate indicator cards** appear in the chat (one per message, each as its own reply), not one card reused/overwritten by the second message.

## 2. Exact-match ack resolution under overlap

2a. With both cards from §1 still pending, reply (as the bot, e.g. via `ImMessageReply`) to the **second** trigger message only. Confirm only the second card morphs into your reply (`morphedIndicator: true` in the tool result) and the first card is untouched — this exercises `takePendingAckByUserMessage` (exact match, tested in `pnpm test` but worth confirming end-to-end against the real API).

2b. Now send any other bot message that is NOT a reply (e.g. `ImMessageSend` to the same chat). Confirm the *remaining* pending card (the first one, still unresolved) gets swept to the muted "✓ Done" note (`clearPendingIndicators` — resolves all remaining cards in the chat, not a specific one). This is expected behavior, not a bug — document the observed timing.

2c. Read `~/.silkweave-lark.history.jsonl` for both exchanges and confirm both `role: 'reflex'`/`role: 'agent'` entries are attributed to the correct triggering message (`parentId` matches), not swapped or merged.

## 3. Genuine in-flight overlap (classification actively running when the second message lands)

Harder to force deterministically since classification is usually sub-second, but worth attempting:

3a. Send a message designed to make the classifier's job maximally ambiguous/slow to think about (e.g. a long, multi-part question), then send a second, unrelated short message within ~1 second (before you'd expect the first classify() call to return).

3b. Confirm both still produce independent, correct outcomes — check `EventWatchStatus.reflex.counters` incremented correctly for both, and neither reply/card content is a mix of the two messages' context (i.e. no cross-talk between the two concurrent `runReflex()` invocations, which don't share any mutable state per the code — this test is confirming that in practice, not just in theory).

3c. If you can reliably reproduce overlap, note the actual wall-clock gap between the two sends and the two `receivedAt` timestamps — useful for calibrating how "fast" fast-message testing actually needs to be.

## 4. Deliberately reproducing the subscription-gap false-negative (§0)

4a. With a subscription active and confirmed working (send one message, confirm reflex fires), delete the subscription (`EventSubscriptionDelete`).

4b. Send a message in the chat. Confirm: `EventWatchStatus.counters.received` increments but `matched` does **not**; the message appears in `history.jsonl` (`role: 'user'`) but not in `events.jsonl`; no indicator card appears; nothing is emitted to any `lark-listen` stream with `deliver: 'matched'` (default) — only a `deliver: 'all'` stream (if one happens to be connected) would see it.

4c. Recreate the subscription. Send the same message text again. Confirm full normal processing this time. This reproduces exactly what happened on 2026-07-10 (the "parent folder" message sent twice, 87 seconds apart, the first silently dropped and the second answered normally).

## 5. Discussion: should unmatched/non-engaged messages get *any* signal?

Not a pass/fail test — a design question to resolve with the user before writing code. Options, none implemented yet:

- Leave as-is: silence is the correct behavior for "the bot has no reason to respond," and adding noise (e.g. a reaction on every single message in every chat the bot is in) would be worse.
- A lightweight signal *only* for messages that @-mention the bot but match zero subscriptions (a real misconfiguration, arguably worth surfacing) — narrower than "every unmatched message."
- Something scoped to reflex specifically: if `reflex.enabled` and the message mentions the bot but no subscription covers the chat, that's unambiguously a config gap worth a minimal ack.

Record whatever direction is chosen here as a follow-up PRD rather than improvising an implementation mid-scenario-test.

## 6. Cleanup after testing

- Delete any test subscription created for this scenario (`EventSubscriptionDelete`).
- Stop any `lark-listen` process and its background monitor.
- Stop the watcher (`kill $(cat ~/.silkweave-lark.watcher.pid)`) if it was started solely for this test session.
- Note in your summary: which sections passed, actual timing observed in §3, and whichever direction (if any) was chosen in §5.

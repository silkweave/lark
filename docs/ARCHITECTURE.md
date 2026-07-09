# Architecture — message flow & processes

How `@silkweave/lark` turns an inbound Lark message into a fast reflex reply and/or a delegated agent task. Two views: the **message-flow sequence** (user ↔ reflex ↔ agent) and the **process/state architecture**. Source of truth: `src/lib/messageWatcher.ts`, `src/lib/watcherGateway.ts`, `src/lib/watcherClient.ts`, `src/lib/reflex.ts`, `src/lib/history.ts`, `src/lib/watcherStatus.ts`.

## 1. Message flow — user ↔ reflex ↔ agent

```mermaid
sequenceDiagram
    autonumber
    actor U as 👤 Human<br/>(Lark chat member)
    participant LK as ☁️ Lark Platform<br/>WebSocket + REST
    participant W as 🛰️ Watcher (lark-serve)<br/>MessageWatcher.handleMessage
    participant H as 🗒️ Shared history<br/>history.jsonl
    participant RX as ⚡ Reflex<br/>reflex.ts / Haiku
    participant AN as 🧠 Anthropic<br/>/v1/messages (forced tool)
    participant AG as 🤖 Agent (heavy worker)<br/>onEventCommand / webhook

    Note over U,LK: message @-mentions the bot, or is a reply in a mention-started thread
    U->>LK: "@Abi …"
    LK-->>W: im.message.receive_v1 (long-lived WS, no public URL)

    Note over W: received++ · dedupe by message_id · extractText() resolves @mentions
    W->>H: appendHistory(role:"user")  ‹UNCONDITIONAL — every msg, matched or not›
    W->>W: re-read subscriptions from config (live, per event)

    alt no subscription matches (chatId / mentionBot / keywords)
        W-->>W: return — history kept, nothing else happens
    else matched
        W->>W: matched++ · append events.jsonl · update recent[]
        Note over W: engaged = mentionedBot OR isEngagedThread(root/thread)<br/><b>GATE</b> = reflex.enabled && engaged && type=="text" && fromUser

        alt GATE = TRUE → REFLEX PATH
            W->>RX: runReflex(record, history[last N=15, excl. trigger])
            par instant ack (zero model, < 1s)
                RX->>LK: POST reaction "Typing"
                LK-->>U: 👀 "seen it"
            and classify (concurrent)
                RX->>AN: forced classify(category, reply)<br/>system = rules + operator playbook · context = history
                AN-->>RX: { category, reply }
            end

            alt category = "trivial"  (answerable now, no tools)
                RX->>LK: POST reply = the actual answer
                LK-->>U: 💬 answer
                RX-->>W: { dispatch:false, replied, replyMessageId, replyText }
                W->>W: reflexCounters.trivial++
                W->>H: appendHistory(role:"reflex")
                Note over W,AG: ✋ agent NOT dispatched — reflex resolved it end-to-end
            else category = "task"  (needs real work)
                RX->>LK: POST reply = brief "Got it — on it…"
                LK-->>U: 💬 quick ack
                RX-->>W: { dispatch:true, replied, replyMessageId, replyText }
                W->>W: reflexCounters.task++
                W->>H: appendHistory(role:"reflex")
                W->>AG: dispatchMatched(event + history[last 20, excl. trigger])
                Note right of AG: onEventCommand → detached shell<br/>(LARK_EVENT_JSON + LARK_HISTORY_JSON)<br/>— and/or —<br/>webhookUrl → POST {subscriptionId,event,history}<br/>X-Silkweave-Signature · 10 s timeout
                AG->>AG: real work: tools, code, lookups
                AG->>LK: ImMessageSend / ImMessageReply (as bot)
                LK-->>U: 💬 full answer
                AG->>H: appendHistory(role:"agent")
            else category = "ignore"  (passing/mistaken mention)
                RX->>LK: DELETE reaction (undo the "Typing")
                LK-->>U: reaction disappears — total silence
                RX-->>W: { dispatch:false }
                W->>W: reflexCounters.ignored++
            end
            Note over RX,W: ⛑️ ANY failure (token / model / network) → return {dispatch:true}<br/>fail-safe: agent still runs, message is never silently dropped

        else GATE = FALSE → DIRECT PATH
            Note over W: non-engaged, non-text (image/post), or bot-authored msg
            W->>AG: dispatchMatched(event + history[last 20])
            AG->>LK: (optional) reply as bot
            AG->>H: appendHistory(role:"agent")
        end
    end
    Note over W,H: finally → persistStatus() → heartbeat file (counters, recent, pid)<br/>then → gateway.emitEvent(record + reflex outcome) → live event streams (§2)
```

**Annotations**

- **History is recorded unconditionally** (step 4), *before* subscription matching — the transcript is complete even for messages that never mention the bot. Reflex reads the last **15**; agent dispatch ships the last **20**; both **exclude the triggering message**.
- **Three roles in one shared log:** `user` (any chat member), `reflex` (Haiku's own fast replies, appended by the *watcher* after `runReflex` returns), `agent` (the heavy worker's replies, appended by whatever process runs `ImMessageSend/Reply`). This is what lets each layer see what the others said across processes.
- **Reaction and classification run in parallel** (`par`) — the "Typing" ack is a zero-model, sub-second "seen it" while Haiku is still thinking.
- **Only `task` crosses into the agent.** `trivial` and `ignore` terminate inside reflex (`dispatch:false`). `task` returns `dispatch:true`, and the *watcher* (not reflex) spawns the workload.
- **Reflex is text-only** (`type=="text"` in the gate): image/`post` mentions skip reflex entirely and fall to the DIRECT path — no reaction, no classification.
- **`fromUser`** in the gate stops the bot from reflex-replying to its own or the agent's messages (loop guard).
- **Fail-safe bias:** every reflex error path returns `dispatch:true`. The system would rather over-dispatch to the agent than drop a real request.
- **Event streaming happens last.** The event (with the reflex outcome — category, replied, replyText, dispatched) is fanned out to gateway stream subscribers only *after* processing completes, so a streaming agent always sees what the reflex already did. Unmatched messages are also fanned out to `deliver: "all"` streams (full-transcript consumers) even though they are never persisted to `events.jsonl`.

## 2. Process & state architecture

```mermaid
flowchart TB
    subgraph LK["☁️ Lark Platform"]
        WS["WebSocket long connection<br/>im.message.receive_v1"]
        REST["REST — reactions · reply · send"]
    end
    ANTH["🧠 Anthropic API<br/>/v1/messages · forced classify tool"]

    subgraph WP["🛰️ Watcher process — lark-serve — the ONLY process that runs the bot"]
        MW["MessageWatcher.handleMessage()"]
        GATE{"reflex.enabled<br/>&& engaged<br/>&& type=='text'<br/>&& fromUser ?"}
        RFX["⚡ runReflex() — Haiku classify"]
        DISP["dispatchMatched()"]
        HB["persistStatus() — every 10s + per event"]
        GW["🚪 WatcherGateway (UDS server)<br/>request/response + event streams<br/>single applier of watcher config"]
    end

    subgraph AGT["🤖 Agent (heavy worker) — separate, spawned per task"]
        CMD["onEventCommand<br/>detached shell + LARK_* env"]
        WH["webhookUrl<br/>POST {subscriptionId, event, history}"]
    end

    subgraph MCPS["🔌 MCP server — TOOLS ONLY — never runs the watcher"]
        T1["EventSubscription Create / Update / List / Delete"]
        T2["EventReflexConfigure · EventWatchReconnect"]
        T3["EventWatchStatus"]
        T4["Im.MessageSend / Reply"]
    end

    LL["📻 lark-listen / streamEvents()<br/>persistent stream client, auto-reconnect + sinceTs replay"]

    subgraph FILES["🗂️ Shared state — ~/.silkweave-lark.*  — boot store + read-only fallback"]
        CFG[("config.json<br/>subscriptions · reflex · tokens<br/>writes: file-locked + atomic rename")]
        HIST[("history.jsonl<br/>user / reflex / agent")]
        EVT[("events.jsonl<br/>matched events")]
        PID[("watcher.pid")]
        STAT[("watcher.status.json<br/>heartbeat + counters")]
        SOCK[("watcher.sock<br/>UDS, 0600")]
    end

    WS --> MW
    MW -->|"appendHistory role:user — always"| HIST
    MW -->|read live per event| CFG
    MW --> GATE
    GATE -->|TRUE| RFX
    GATE -->|FALSE| DISP
    RFX -->|reaction / reply as bot| REST
    RFX -->|classify| ANTH
    RFX -->|"task ⇒ dispatch:true"| DISP
    RFX -->|reflex reply recorded| HIST
    DISP --> CMD
    DISP --> WH
    CMD -->|reply as bot| REST
    WH -->|reply as bot| REST
    CMD -->|role:agent| HIST
    WH -->|role:agent| HIST
    MW --> EVT
    MW --> HB --> STAT
    MW --> PID
    MW -->|"emitEvent(record + reflex outcome)<br/>after processing"| GW
    GW ---|binds| SOCK
    GW -->|"mutations persist via TokenClient<br/>(locked + atomic)"| CFG

    T1 <-->|"NDJSON over UDS"| GW
    T2 <-->|"NDJSON over UDS"| GW
    T3 <-->|"status (live)"| GW
    T3 -. "fallback when watcher down" .-> STAT
    T3 -. "fallback" .-> PID
    T1 -. "list fallback" .-> CFG
    T4 --> REST
    T4 -->|role:agent| HIST
    GW ==>|"event frames (subscribe)"| LL

    style WP fill:#e8f4ff,stroke:#4a90d9
    style MCPS fill:#f0f0f0,stroke:#999
    style FILES fill:#fff7e6,stroke:#e0a800
    style AGT fill:#eaffea,stroke:#4caf50
    style GATE fill:#ffe6e6,stroke:#d9534f
    style GW fill:#f3e8ff,stroke:#8e44ad
```

**Annotations**

- **The gateway is the control plane.** The running watcher hosts a Unix-domain-socket server (`~/.silkweave-lark.watcher.sock`, mode 0600, NDJSON request/response — see `src/types/gateway.ts`). MCP `Event*` tools are thin clients (`src/lib/watcherClient.ts`): connect, one request, one response, close. Detection = "can I connect?". The watcher is the **single applier** of subscription/reflex config while running — mutations are serialized on its event loop (no lost updates between concurrent MCP agents) and persisted to `config.json` via a file-locked, atomic-rename write.
- **Watcher-down behavior:** mutations (`subscriptions.add/update/remove`, `reflex.set`, `reconnect`) **hard-fail** with the exact start command (`START_HINT`); read-only tools (`EventWatchStatus`, `EventSubscriptionList`) fall back to the heartbeat/config files (dotted arrows).
- **Event streaming:** a persistent client `subscribe`s with a filter (`deliver: matched|all`, chatId, subscriptionId, mentionedBot, includeHistory) and receives each event as a frame *after* the watcher finishes processing it — including the reflex outcome. Reconnects pass the last-seen `receivedAt` as `sinceTs`; the gateway replays matched events from `events.jsonl` (inclusive bound, client dedupes by messageId) so matched delivery is gap-free across watcher restarts. Slow consumers get an `overflow` frame and are disconnected (they catch up via `sinceTs`); heartbeat frames flow every 15 s.
- **The token store is still multi-writer** (MCP OAuth, watcher token refresh) — every `TokenClient` mutation re-reads the file under an `O_EXCL` lockfile (`withFileLock`, stale takeover after 10 s), applies the change to fresh state, and atomic-writes. This closes the token-refresh-vs-OAuth clobber independent of the gateway.
- **Two dispatch mechanisms, not mutually exclusive.** A subscription can set `onEventCommand` **and** `webhookUrl`; both fire for the same event. Command = spawn-per-message (fresh agent each time); webhook = one persistent listener backing a long-running agent. Streaming is a third, pull-style consumer that doesn't need a public URL or per-message process.
- **History is the shared memory** unifying the three layers: reflex writes what it said, the agent writes what it said, and both read the same log so context survives across the process boundary and across time.
- **Heartbeat freshness = liveness (fallback).** `persistStatus()` stamps `heartbeatAt` every 10 s; a file reader treats the watcher as "running" only if the pid is alive **and** the heartbeat is < 35 s old. The gateway's `status` method reports live, on-demand state (plus `wsConnected`, `activeStreams`) when the watcher is up.

## Starting the watcher

The watcher is a standalone OS process, never started by the MCP server (see [README → Running the watcher](../README.md#running-the-watcher)). It starts **bare** — no arguments needed — and is then configured live over the gateway:

```sh
lark-serve                                   # installed
pnpm serve                                   # dev checkout
lark-serve --reflex --api-key sk-ant-... --playbook ./playbook.md   # optional pre-seeds
lark-listen --all                            # stream every inbound message as NDJSON
```

Stop with `Ctrl-C` or `kill $(cat ~/.silkweave-lark.watcher.pid)`. Check it with the `EventWatchStatus` tool — when it's down, `notRunningReason` carries the exact start command.

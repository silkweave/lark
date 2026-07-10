# PRD — Lark Card Syntax Skill

Status: **Draft** · Owner: engineering · Related: [ARCHITECTURE.md](./ARCHITECTURE.md)

## 1. Summary

Add a Claude Code skill that documents how to correctly compose Lark/Feishu interactive card JSON (`msgType: interactive` on `ImMessageSend`/`ImMessageReply`), so future sessions don't have to rediscover the same gotchas by trial-and-error against the live API.

This PRD grew directly out of a live testing session (2026-07-10) where a hand-written card silently rendered wrong (a fenced code block showed as plain text) and a follow-up attempt at the correct schema failed outright with an opaque `AxiosError: Request failed with status code 400` — the real cause (`code: 230099`, an unsupported `note` tag under Card JSON 2.0) was only visible by re-running the same call through the CLI instead of the MCP server. Both problems are exactly what a skill should short-circuit.

## 2. Goals / Non-goals

**Goals**
- G1. A Claude Code skill (triggered on "Lark card", "interactive message", "Feishu card", or similar) that gives correct, copy-pasteable card JSON on the first try.
- G2. Cover both Card JSON schemas in use: legacy ("1.0", implicit — `config`/`header`/`elements` at the top level, `tag: "div"` + `text.tag: "lark_md"` for markdown) and 2.0 (explicit `"schema": "2.0"`, `body.elements`, dedicated `tag: "markdown"` component, mandatory `element_id` per element).
- G3. Document the element-tag support matrix per schema — specifically capture that `note` (used freely in schema-less/1.0 cards, e.g. `src/lib/indicator.ts`) is **rejected** under 2.0 (`ErrMsg: cards of schema V2 no longer support this capability`).
- G4. Document that fenced-code-block markdown (` ```lang ... ``` `) only renders inside the 2.0 `markdown` component's `content` field — the 1.0 `lark_md` div renders it as flattened plain text with no error, which is a silent-failure trap worth calling out explicitly.
- G5. Document the debugging technique for opaque `AxiosError` failures from `ImMessageSend`/`ImMessageReply`: the `@larksuiteoapi/node-sdk`'s real `{code, msg}` error body is logged via the SDK's default logger, but that logger writes with `console.log` (stdout) — which the MCP server's `stdio()` transport reserves for JSON-RPC framing, so the real error never reaches an MCP client. Re-running the identical action via `pnpm tsx src/cli.ts <action>` (or `lark-cli` once installed) surfaces the real Lark error body immediately.

**Non-goals**
- Re-documenting subscriptions/reflex/gateway usage — already covered by root `CLAUDE.md` and `docs/ARCHITECTURE.md`; a card-syntax skill should not duplicate that.
- Fixing the underlying stdout-logging conflict (G5 is documentation of a workaround, not a code fix — see §5 Open questions).
- Building card *templates* for specific product use cases (e.g. a standard "task summary" card) — this PRD is about syntax correctness, not a design system.

## 3. Content outline

Proposed skill body (single `SKILL.md`, no code changes required to ship this):

1. **Which schema am I on?** — no `"schema"` key at all ⇒ legacy/1.0 (`config`/`header`/`elements` top-level); `"schema": "2.0"` ⇒ 2.0 (`body.elements`, `element_id` required per element, max 200 elements).
2. **Markdown text** — 1.0: `{ tag: "div", text: { tag: "lark_md", content: "..." } }`. 2.0: `{ tag: "markdown", content: "...", element_id: "..." }`. Both support `**bold**`, `*italic*`, `` `code` ``, `[text](url)` links; only the 2.0 `markdown` tag reliably renders fenced code blocks.
3. **Tag support matrix** (grows over time as more gotchas surface) — starting entries: `note` valid in 1.0, rejected in 2.0; `hr` valid in both.
4. **Minimal valid envelope for each schema** — two copy-pasteable skeletons.
5. **Debugging a failed send** — the CLI-reroute technique from G5, plus the exact error shape to expect (`AxiosError` wrapping a Lark `{code, msg, log_id}`).
6. **Where this was learned** — link back to this PRD / the session date, so future updates have a paper trail instead of silently drifting.

## 4. Where it lives

`.claude/skills/lark-cards/SKILL.md` (project-scoped, so it only loads in this repo's Claude Code sessions) with frontmatter describing trigger conditions (interactive card / Feishu card / Lark card composition). Cross-link from `CLAUDE.md`'s Actions or Architecture section so it's discoverable from the root doc without duplicating its content there.

**Gap: this only helps engineers working inside this repo's checkout.** `@silkweave/lark` is a published, unscoped public npm package (see root CLAUDE.md → Publishing) — most users only ever `npm install`/`pnpm dlx` it and connect it as an MCP server; they never clone this repo, so `CLAUDE.md`, `docs/`, and a repo-local `.claude/skills/` entry are all invisible to them. For those users the only artifact that ships is whatever's in the npm tarball (governed by `package.json`'s `files`, currently `build/` + package metadata) plus `README.md`, which npm/GitHub render but Claude Code doesn't auto-load as a skill.

Candidate distribution options to resolve before implementation (see §5):
- (a) Fold the card-syntax content into `README.md` — ships with the package today, zero new mechanism, but a skill only "activates" contextually in Claude Code whereas a README section requires the user (or their agent) to go read it unprompted.
- (b) Include the skill file in the npm package's `files` (e.g. under a `skills/` directory in the tarball) with a README pointer telling users to copy it into their own `.claude/skills/`, or add it to a plugin marketplace if/when one exists for this package — manual either way, but at least distributable.
- (c) Publish a Claude Code plugin wrapping this skill, installed independently of the npm package — investigate current plugin distribution support before committing to this.

## 5. Open questions

- Does `silkweave-meet` (sibling project) also send Lark cards and need the same skill, or should this stay scoped to `silkweave-lark`? Assumed **no** for this draft — confirm before implementation.
- Should G5's stdout-logging conflict get its own follow-up issue/PRD (pass a custom `logger` into the SDK `Client` constructor so `error()` writes to stderr, matching every other logger in this codebase) rather than just being a documented workaround? Leaning yes, but out of scope here.
- Tag support matrix (§3.3) will necessarily start incomplete — should it be a living doc that Claude Code agents are expected to append to when they hit a new gotcha, or a fixed reference updated only by a human?
- **Distribution for external npm-only users (raised 2026-07-10):** which of §4's (a)/(b)/(c) — or a combination — should we commit to? A repo-local skill alone under-serves the actual npm-install audience.

## 6. Next steps

Not implemented yet — this is the PRD only, per request. Pick up in a future Claude Code session: write `.claude/skills/lark-cards/SKILL.md` per §3–4, resolve the open questions in §5.

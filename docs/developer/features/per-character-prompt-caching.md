# Per-character prompt caching

## One-line summary

Re-key the provider prompt-cache hint from `chatId` to `characterId` and add DeepSeek `user_id` support, so multiple characters running on the same model each maintain their own warm cache without colliding.

## Why now

The cache key today is keyed on `chatId` (see `lib/llm/cache-key.ts`). The comment there reads "speaker identity lives in the dynamic tail" — i.e. the assumption was that in a group chat the same prefix would be reused across speakers. In practice, the speaker's persona block (manifesto / identity / description / personality) sits high in the prompt, so each speaker rotation already changes the cacheable prefix. Keying by chat does not buy reuse; keying by character does, because:

- the persona block is genuinely stable per character across many chats
- DeepSeek V4's `user_id` parameter (see [the DeepSeek docs](https://api-docs.deepseek.com/quick_start/rate_limit)) provides **actual KV-cache isolation per ID**, not just a routing hint — character-scoped IDs map cleanly onto that mechanism
- when the same model is shared across several characters (a common Quilltap setup), per-character keys keep their caches separate on providers that isolate (DeepSeek, Gemini) and keep them sticky on providers that route by hint (OpenAI, Grok)

## Goals

- Generic Quilltap layer builds a single per-character cache identifier and hands it to every provider plugin in a canonical place.
- Each provider plugin decides how to apply that identifier in its own request shape.
- Existing Anthropic `cache_control` breakpoint logic is **left alone** — it is content-hash-keyed and orthogonal to this work.
- DeepSeek gains `user_id` support (new wiring, not just opting in to an existing field).
- Plugins without a cache-key concept (Ollama, raw Curl) are no-ops.

## Non-goals

- Per-chat or per-project caching. We are intentionally collapsing to per-character.
- Gemini `cachedContents` resource lifecycle. The Google plugin already surfaces `cachedContentTokenCount`; managing actual `cachedContents` resources (create / refresh / evict) is a separate, heavier feature deferred for now.
- Reworking the Anthropic `cache_control` breakpoint placement logic in `plugins/dist/qtap-plugin-anthropic/provider.ts`.

## Current state

| File | What it does today |
|---|---|
| `lib/llm/cache-key.ts` | `buildPromptCacheKey(chatId)` → `quilltap:chat:<chatId>:v<n>`. Version constant `PROMPT_CACHE_STRUCTURE_VERSION = 1`. |
| `lib/services/chat-message/streaming.service.ts:329` | Calls `buildPromptCacheKey(chatId)`, stuffs the result into `profileParametersWithCache.promptCacheKey` and forwards to providers. `characterId` is already destructured at line 300 and threaded into downstream calls — no plumbing change needed to surface it here. |
| `plugins/dist/qtap-plugin-openai/provider.ts:377-385` | Reads `params.profileParameters?.promptCacheKey`, sets `requestParams.prompt_cache_key`, also opts into `prompt_cache_retention: '24h'` on supported models. |
| `plugins/dist/qtap-plugin-grok/provider.ts:305-310, 388-392` | Reads `params.profileParameters?.promptCacheKey`, sets `requestParams.prompt_cache_key` on both Responses-API code paths. |
| `plugins/dist/qtap-plugin-anthropic/provider.ts` | Independent `cache_control` breakpoint placement system. Not touched by this work. |
| `plugins/dist/qtap-plugin-deepseek/provider.ts` | Surfaces `prompt_cache_hit_tokens` in `cacheUsage` but does **not** pass `user_id` on the request — feature missing. |
| `plugins/dist/qtap-plugin-google/provider.ts` | Surfaces `cachedContentTokenCount` only. No request-side hook. Out of scope. |
| `plugins/dist/qtap-plugin-openrouter/index.js` | Passes through `cache_control`; no `prompt_cache_key` handling. |
| `plugins/dist/qtap-plugin-ollama`, `qtap-plugin-curl`, `qtap-plugin-z-ai`, `qtap-plugin-openai-compatible` | No cache-key handling. Z.AI / openai-compatible may need a pass-through; Ollama is a no-op. |

## Design

### Generic layer (Quilltap core)

1. **Rename + re-scope `buildPromptCacheKey`** to `buildCharacterCacheKey(characterId)` in `lib/llm/cache-key.ts`. Bump `PROMPT_CACHE_STRUCTURE_VERSION` from `1` to `2` so all existing caches drop cleanly across providers. New format: `quilltap:char:<characterId>:v2`.
2. **Fallback semantics.** If `characterId` is undefined (no active character: user-only chat, system orchestration call, character optimizer running before a character exists), return `undefined`. Provider plugins already handle the undefined case (they only set the field if the string is non-empty). Do not invent synthetic IDs.
3. **Promote the field off `profileParameters`.** Today it rides inside `profileParameters.promptCacheKey`, which is a hack — that bag is for user-set profile knobs, not derived per-request values. Add a first-class `cacheKey?: string` field to `LLMParams` in `packages/plugin-types/src/providers/text.ts`. Keep reading from `profileParameters.promptCacheKey` as a deprecated fallback in OpenAI and Grok plugins for one release, then remove.
4. **Carrier convention.** The field on `LLMParams` is a plain string — providers decide whether to use it as a routing hint, an isolation namespace, or to ignore it. The 512-char / `[a-zA-Z0-9\-_]+` constraint imposed by DeepSeek is satisfied by our format because UUIDs and our prefix are safe characters and well under length.
5. **Audit every caller of `sendMessage` / `streamMessage`** to ensure they pass `characterId` where one is available. Use `Grep` on `sendMessage\(|streamMessage\(` against `lib/`. The relevant callsites today are in `lib/services/chat-message/*`, `lib/background-jobs/handlers/*`, `lib/services/character-*`, `lib/memory/*`, `lib/services/dangerous-content/*`. Background tasks running *as* a character (e.g. memory processing for character X) should pass that character's ID; truly characterless tasks (title updates, ai-import) should pass `undefined` and rely on the no-key behaviour.

### Per-provider matrix

| Provider | What it should do | File to edit |
|---|---|---|
| **DeepSeek** | New: when `params.cacheKey` is set, add `user_id: <cacheKey>` to the request body in both `sendMessage` and `streamMessage`. OpenAI SDK requires it under `extra_body`, not as a top-level kwarg — but DeepSeek is using the raw body shape via `body as unknown as ...`, so it can be added directly to `body`. | `plugins/dist/qtap-plugin-deepseek/provider.ts` |
| **OpenAI** | Switch source of truth from `params.profileParameters?.promptCacheKey` to `params.cacheKey`, with the old path as a one-release fallback. Keep `prompt_cache_retention: '24h'` opt-in on supported models. | `plugins/dist/qtap-plugin-openai/provider.ts:377-385` |
| **Grok** | Same swap as OpenAI; two call sites (Responses non-streaming and streaming). | `plugins/dist/qtap-plugin-grok/provider.ts:305-310, 388-392` |
| **Anthropic** | No change. Document in a code comment that `cache_control` is content-hash-keyed and `params.cacheKey` is intentionally ignored here. | `plugins/dist/qtap-plugin-anthropic/provider.ts` (one comment near the top) |
| **OpenRouter** | If the routed downstream is OpenAI-compatible, pass `params.cacheKey` through as `user`. Anthropic-routed requests use the existing `cache_control` passthrough. | `plugins/dist/qtap-plugin-openrouter/index.js` and its `.ts` if present |
| **Z.AI** | Z.AI is OpenAI-compatible. If their API documents `user` or `prompt_cache_key`, pass it through. If not, no-op for now. | `plugins/dist/qtap-plugin-z-ai/` |
| **OpenAI-compatible** | Pass `params.cacheKey` as `user` field on the request body. Many OpenAI-compatible backends accept this without complaint and a few (vLLM, others) do use it as a routing hint. | `plugins/dist/qtap-plugin-openai-compatible/` |
| **Google** | Out of scope this round. Leave a `// TODO(per-character-caching): managed cachedContents resource per characterId — see docs/developer/features/per-character-prompt-caching.md` comment as a marker. | `plugins/dist/qtap-plugin-google/provider.ts` |
| **Ollama** | No-op. Local inference has its own KV-cache lifecycle. Add a brief comment saying so. | `plugins/dist/qtap-plugin-ollama/` |
| **Curl** | No-op. Raw passthrough. | `plugins/dist/qtap-plugin-curl/` |
| **MCP** | Tool provider, not text — does not apply. | — |

## Implementation steps

The first three steps are sequential; the per-provider work after that is parallelisable across agents.

1. **Core types (`packages/plugin-types`).** Add `cacheKey?: string` to `LLMParams` in `packages/plugin-types/src/providers/text.ts` with a doc comment describing the semantics (per-character cache identifier; provider decides how to apply). Bump `packages/plugin-types/package.json` patch version. Run `npm run build` in `packages/plugin-types/`. Per Quilltap convention (CLAUDE.md, packages section): **pause and ask the user to `npm publish` the new plugin-types before continuing**, because plugins consume it as an npm dependency.
2. **Cache-key module (`lib/llm/cache-key.ts`).** Rename `buildPromptCacheKey` → `buildCharacterCacheKey`, change parameter from `chatId` to `characterId`, change output format prefix from `quilltap:chat:` to `quilltap:char:`, bump `PROMPT_CACHE_STRUCTURE_VERSION` from `1` to `2`. Update `__tests__/unit/lib/llm/cache-key.test.ts` accordingly. Keep the doc comment but rewrite the rationale paragraph to match the new design.
3. **Streaming service (`lib/services/chat-message/streaming.service.ts`).** Replace `buildPromptCacheKey(chatId)` at line 329 with `buildCharacterCacheKey(characterId)`. Move it from `profileParametersWithCache.promptCacheKey` onto the new top-level `cacheKey` field. Verify the same change is needed in any peer service files (`primary-stream.service.ts`, `native-tool-loop.service.ts`, `text-tool-loop.service.ts`, `provider-failover.service.ts`, `recovery.service.ts`) — anywhere that builds `LLMParams`.
4. **Audit all `sendMessage` / `streamMessage` callsites.** `Grep` for those two function names under `lib/`. For each, confirm the right `characterId` is being passed. Background-job handlers (`lib/background-jobs/handlers/*`) are the most likely places to need explicit threading — e.g. `memory-processor`, `character-optimizer.service`, `story-background`, `character-avatar`. Add debug logs at the build site (`lib/services/chat-message/streaming.service.ts` and equivalents) when `cacheKey` is set or skipped — important for diagnosing cache misses later.
5. **Per-provider plugins** (each can be its own agent task; bump plugin patch versions and run `npm run build:plugins` per Quilltap convention):
    1. **DeepSeek** — add `user_id` to body in both `sendMessage` (around line 183) and `streamMessage` (around line 272) when `params.cacheKey` is set. Add a debug log when it's applied. Bump `plugins/dist/qtap-plugin-deepseek/package.json` and `manifest.json` patch versions.
    2. **OpenAI** — at `provider.ts:377-385`, replace `params.profileParameters?.promptCacheKey` with `params.cacheKey ?? params.profileParameters?.promptCacheKey` (fallback for one release). Same elsewhere in the file if there are other callsites — check both Responses-API paths. Bump plugin version.
    3. **Grok** — same as OpenAI at lines 305-310 and 388-392. Bump version.
    4. **Anthropic** — comment-only change. Add `// per-character caching: handled via cache_control content-hash, ignores params.cacheKey` near the top of the request-build path. Bump patch version anyway since we touched it.
    5. **OpenRouter** — pass `params.cacheKey` through as `user` for OpenAI-compatible-routed requests. Bump version.
    6. **OpenAI-compatible** — set `body.user = params.cacheKey` when present. Bump version.
    7. **Z.AI** — check docs; pass through if supported, else no-op + comment. Bump version only if code changed.
    8. **Google** — add `TODO` comment referencing this design doc. No version bump needed (comment-only is debatable; safer to bump).
    9. **Ollama / Curl** — add brief no-op comment. No version bump.
6. **Anthropic / Google read-back instrumentation.** Verify the existing `cacheUsage` logging on responses still flows correctly for all providers. No code change expected, but spot-check by running `npm run dev` and tailing `logs/combined.log` while sending a message.
7. **Documentation.**
    - Update `docs/developer/features/llm_api_costs_breakdown.md` — that file is referenced by the version constant in `cache-key.ts` and presumably explains caching cost trade-offs.
    - Update `docs/CHANGELOG.md` (terse, developer voice — *not* Quilltap user voice; per CLAUDE.md the changelog is the exception).
    - Add a user-facing help page in `help/` describing the behaviour change (in the steampunk-Wodehouse voice). Include the `url` frontmatter and the matching `help_navigate` call. Likely lands under the providers / settings help section.
    - Update `.claude/commands/update-documentation.md` if a new help file is added.
8. **Migration considerations.** `PROMPT_CACHE_STRUCTURE_VERSION` going from 1 → 2 means every existing chat's cache hint changes value, so all provider-side caches go cold once on first use after deploy. No DB migration needed — the field is derived per request, not stored. No `.qtap` export schema change. No SillyTavern format change.
9. **Tests.**
    - Update `__tests__/unit/lib/llm/cache-key.test.ts` for the rename and new format.
    - Add a unit test per touched provider plugin asserting that when `params.cacheKey` is set, the corresponding wire field (`user_id` / `prompt_cache_key` / `user`) appears on the request body. Use the existing test patterns — each plugin already has fixtures.
    - Add one integration test that runs the same `characterId` through the streaming service twice and verifies the same `cacheKey` reaches the provider both times.
10. **Pre-commit.** Run `npx tsc` (not `npm run build`, per CLAUDE.md), then the project's commit skill / hook.

## Settled design decisions

- **Multi-character group chats keep N parallel caches.** Each character in a group chat gets its own cache namespace. The cache-hit discount (~120× on DeepSeek V4-Pro, ~10× on Anthropic, etc.) easily justifies running parallel caches per character — this is precisely the use case the feature is designed for. Note this in `docs/developer/features/llm_api_costs_breakdown.md`.

- **Decision rule for non-conversational call sites:** key per-character **only when the character's persona block (manifesto / description / personality) is genuinely in the prompt prefix and the same prompt structure recurs across calls.** Otherwise, leave the cache key undefined.

- **Prospero tool runs (`private: true` or otherwise).** The character's persona is part of the prompt prefix, so pass the character ID as the cache key. Same rule applies whether the run is private or visible — privacy is about whether the message is shown / fed back into context, not about caching.

- **Wardrobe "let the character choose their outfit" (`chooseLLMOutfit`).** Per-character cache key. The prompt is built from `characterManifesto` + `characterDescription` + `characterPersonality` and is often the first LLM call against that character in a new chat — it's an ideal cache warmer.

- **Character avatar prompt-generation (the cheap-LLM step inside `lib/background-jobs/handlers/character-avatar.ts`).** No cache key. Avatar generation is rare (triggered only on outfit changes), each invocation has a different equipped-outfit combination in the prompt prefix, and the prompt structure is one-shot rather than conversational. Marginal cache benefit not worth keying. The image-provider step is out of scope — it uses the separate `ImageProvider` interface.

- **Wardrobe image analysis (`lib/wardrobe/image-analysis.ts`).** No cache key. The prompt is "analyze this image and propose wardrobe items"; the character's persona is not in the prefix and the uploaded image dominates the input. Nothing reusable across calls.

## File checklist

```
packages/plugin-types/src/providers/text.ts        # add cacheKey field
packages/plugin-types/package.json                 # version bump (pause for npm publish)
lib/llm/cache-key.ts                               # rename + re-scope + version bump
__tests__/unit/lib/llm/cache-key.test.ts           # update tests
lib/services/chat-message/streaming.service.ts     # use buildCharacterCacheKey
lib/services/chat-message/primary-stream.service.ts
lib/services/chat-message/native-tool-loop.service.ts
lib/services/chat-message/text-tool-loop.service.ts
lib/services/chat-message/provider-failover.service.ts
lib/services/chat-message/recovery.service.ts
plugins/dist/qtap-plugin-deepseek/provider.ts      # new: user_id support
plugins/dist/qtap-plugin-deepseek/package.json     # version bump
plugins/dist/qtap-plugin-deepseek/manifest.json    # version bump
plugins/dist/qtap-plugin-openai/provider.ts        # source-of-truth swap
plugins/dist/qtap-plugin-openai/package.json
plugins/dist/qtap-plugin-grok/provider.ts          # source-of-truth swap
plugins/dist/qtap-plugin-grok/package.json
plugins/dist/qtap-plugin-anthropic/provider.ts     # comment only
plugins/dist/qtap-plugin-anthropic/package.json
plugins/dist/qtap-plugin-openrouter/index.js       # passthrough
plugins/dist/qtap-plugin-openai-compatible/        # passthrough
plugins/dist/qtap-plugin-z-ai/                     # passthrough if supported
plugins/dist/qtap-plugin-google/provider.ts        # TODO marker
docs/developer/features/llm_api_costs_breakdown.md # cost note
docs/CHANGELOG.md                                  # terse changelog entry
help/<new-page>.md                                 # user-facing help (Quilltap voice)
```

## References

- DeepSeek `user_id`: <https://api-docs.deepseek.com/quick_start/rate_limit>
- OpenAI `prompt_cache_key`: <https://developers.openai.com/api/docs/guides/prompt-caching>
- xAI Grok `prompt_cache_key`: <https://docs.x.ai/developers/advanced-api-usage/prompt-caching/maximizing-cache-hits>
- Anthropic `cache_control`: <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
- Google `cachedContents`: <https://ai.google.dev/api/caching> (out of scope this round)
- OpenRouter caching guide: <https://openrouter.ai/docs/guides/best-practices/prompt-caching>

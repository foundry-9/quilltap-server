# Quilltap Changelog

## Recent Changes

### 4.12.2

#### Fix: Character Optimizer prompt caching and usage logging

- Every optimizer pass sent one user message: character context, memory context, then that pass's instruction. The passes share everything but the instruction, but with the instruction at the end no pass could reuse another's cache.
- The shared context and the instruction are now separate user messages, so the shared message is byte-identical across a run. With the Anthropic plugin's breakpoint on the message before the final one, the analysis pass writes it and every sub-step reads it. In V4test each sub-step read back the 2,488-token shared context.
- Optimizer log rows recorded no token usage at all. They now carry usage, cache usage and the provider's raw usage.

#### Fix: Anthropic prompt-cache hit rate

- The Brahma Console, `@Brahma`, the Scenario Builder (via `runOneShotToolLoop`) and help chat passed `modelParams: {}` to `streamMessage`, so the profile's `enableCacheBreakpoints`, thinking and max-tokens settings never reached the provider. Every Anthropic call on those paths was sent uncached; on Friday that was about 6.5M input tokens over a week. They now pass `profileParams(connectionProfile)`, like the Salon.
- The Anthropic plugin (1.0.66) put the conversation breakpoint on the last user message. In the Salon that message carries the turn's trailing sections, which are gone from the next turn's copy, so each turn wrote a cache entry that was never read and only the system prompt was reused. The breakpoint now goes on the message before the final one. In V4test, consecutive turns now read back the whole previous prefix (17,393 then 18,076 tokens) and write only the new messages.
- In a tool loop the same rule caches each step for the next; previously only the opening user message was cached, because tool results don't count as user messages.
- The plugin now keeps within Anthropic's four-breakpoint limit: tools, system and a summary-head breakpoint come first, and the mid-history breakpoint is skipped when the budget is spent. The mid-history breakpoint is no longer added under the `system_only` strategy.

#### Fix: OpenRouter plugin off `callModel()`; streaming tool and image turns send ZDR (#145)

- OpenRouter plugin 1.0.71 streams every turn (plain, tool, image) through the direct Chat Completions fetch. The `callModel()` / `@openrouter/sdk/lib/chat-compat` path, removed upstream in `@openrouter/sdk` 1.5.57, is gone, and the SDK range returns to `^1.5.60`. The SDK is still used for text-only non-streaming sends (`chat.send`), `models.list` and embeddings.
- Both fetch paths now build their request through one `buildChatCompletionsBody`. Before this, streaming tool and image turns did not send ZDR (`provider.data_collection: 'deny'`), any other provider preference, the `user` cache key, `response_format` or the model fallback list (only an undocumented `route: 'fallback'`), and sent web search as a Responses-API `web_search_preview` tool. All of these are now sent; web search is the `web` plugin and `route` is no longer sent.
- A plain streaming turn now has the first-byte request budget the other streaming paths use (it was unbounded by default), and reasoning streams on plain turns instead of arriving after the text. Reasoning reads `delta.reasoning`, falling back to the text of `delta.reasoning_details` entries (encrypted entries skipped). A streamed `delta.refusal` reports `finish_reason: 'refusal'`.
- `npm run build:plugins` now runs `tsc --explainFiles` after each plugin's typecheck and fails when a package the plugin declares in `dependencies` resolved from outside the plugin's own `node_modules` (`scripts/lib/plugin-resolution-guard.ts`). This is what let the removed subpath typecheck locally against the root copy of the SDK.
- The plugin's debug log now records the routing fields of each Chat Completions body (model / fallback list, tool count, provider preferences including ZDR, plugins, response format, reasoning) and, at stream end, which reasoning fields arrived, usage and OpenRouter's reported `cost`. Messages and keys are never logged. Live on V4test, OpenRouter sends both `delta.reasoning` and `delta.reasoning_details`; the plugin reads `reasoning` and does not double-count.
- Tests: streaming, body parity, ZDR, reasoning, refusal and tool-call cases in `openrouter-text-provider.test.ts`; `plugins/openrouter-no-callmodel.test.ts` fails on any mention of the removed API; `scripts/plugin-resolution-guard.test.ts`. The `@openrouter/sdk/lib/chat-compat` mock and its Jest mapping are removed.

#### Fix: CI and Release builds failed on the OpenRouter plugin

- `@openrouter/sdk` 1.5.57 (a patch release) removed `callModel()` and `@openrouter/sdk/lib/chat-compat`, which moved to the separate `@openrouter/agent` package. Plugins have no committed lockfile, so CI resolved the plugin's `^1.5.34` range to 1.5.60 and the plugin typecheck failed in `provider.ts`. Locally the typecheck passed because TypeScript fell back to the root `node_modules` copy (1.5.34) for the missing subpath.
- OpenRouter plugin 1.0.70 pins `@openrouter/sdk` to exactly 1.5.56, the last release with those APIs and the version the last green Release built against. Moving the streaming path off `callModel()` is follow-up work.

#### Fix: OpenAI model fetch lists GPT-6 and later

- Fetch Models for OpenAI kept only IDs starting `gpt-4`, `gpt-5`, `o1`, `o3`, `o4`, so the gpt-6.x models never appeared. The reasoning-model and 24h cache-retention checks had the same hard-coded lists, so a hand-entered gpt-6 model would also have been sent `temperature` / `top_p`.
- The OpenAI plugin (1.0.69) now decides by family and version in `model-families.ts`: chat models are gpt-4 and later plus every o-series (gpt-3.5 drops out); reasoning models are gpt-5 and later plus every o-series; 24h retention is gpt-5.1 / 5.2 / 5.5 and every gpt-6+ model except `-chat-latest` aliases.
- Retention for unreleased models is a guess, so a 400 naming `prompt_cache_retention` is retried once without it instead of failing the turn.

### 4.12.1

#### Fixed: dated searches look at the period first, and an empty search says what it means

- A `search` with `since`/`until` (and a retrospective turn's recall) now reads the period's memories by event time in SQL (`MemoriesRepository.findIdsInEventWindow`) and scores them through the same index restricted to those ids (`memoryIndex.search` `includeIds`), so they join the candidate pool before the cut. Previously the window was applied to a pool already chosen from all time, so a dated question about a recurring place returned nothing. New `HitSource` `'window'`; the `gather` trace stage records `window` / `windowAdded`.
- On the tool path, a window of 14 days or less (`TOOL_WINDOW_FLOOR_MAX_DAYS`) is its own relevance filter: in-window memories and conversation chunks skip the cosine floor. Wider windows and the per-turn prompt path keep the floor.
- Conversation search takes `chatIds`; with a window, the tool restricts the chunk search to the period's chats (`findChatsInWindow`, `lib/scriptorium/chat-window.ts`) instead of filtering the all-time top-K afterwards. A chat's span is `createdAt` to `lastMessageAt`, not `updatedAt`. `searchConversationChunks` now honours an explicit `minScore: 0`.
- When `since`/`until` is given and `sources` is omitted, only memories and conversations are searched (conversations alone on the Brahma Console).
- The tool result carries a `windowCensus` (memories dated in the window, the conversations the character took part in during it, the current chat left out). An empty result now says whether nothing matched the words or nothing happened in the period, and names the period's conversations; non-empty dated results gain a footer listing them.
- Standing tool instructions (native and simple-JSON) now tell the character to read a listed conversation before saying it does not recall.
- The retrospective mini-recap lists in-window chats that have no vault summary yet, from the `chats` table. `VaultConversationMatch.relativePath` is now nullable.
- Undated searches and turns without a resolved time window are unchanged. No schema or export change.
- Spec: `docs/developer/features/complete/search-window-first-and-honest-empty.md`.

#### CI: coverage run heap

- CI: the coverage run (`npm run test:coverage`) now gives the Jest parent process an 8 GB heap. With the v8 coverage provider, every worker ships the coverage, original source and transformed source of each module it loaded back to the parent, which holds all of it until the run ends; at ~1,300 test files that passed the default ~4 GB limit and the Test job died with "JavaScript heap out of memory" after the last suite.

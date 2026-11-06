# OpenRouter plugin — one Chat Completions path, no `callModel()`

**Status:** Proposed 2026-11-05. Fixes [foundry-9/quilltap-server#145](https://github.com/foundry-9/quilltap-server/issues/145). Nothing implemented.

## 1. The problem

`@openrouter/sdk` 1.5.57, published 2026-11-05 as a patch release, removed the hand-written "agent" layer from the SDK: `OpenRouter.callModel()`, the `@openrouter/sdk/lib/chat-compat` subpath (`fromChatMessages`), `ModelResult`, the reusable stream and the tool orchestrator. Those moved to a new package, `@openrouter/agent` 1.0.1, which depends on `@openrouter/sdk` `^0.13.7` (a different major) and has `@modelcontextprotocol/client` `^2.0.0` as a peer dependency.

The OpenRouter plugin's plain streaming path (no tools, no images) depends on both removed pieces:

| Where | What |
|---|---|
| `plugins/dist/qtap-plugin-openrouter/provider.ts:11` | `import { fromChatMessages } from '@openrouter/sdk/lib/chat-compat'` |
| `provider.ts:534` | `fromChatMessages(messages)` converts chat messages to OpenResponses input |
| `provider.ts:608-625` | `client.callModel(requestParams)`, then `result.getTextStream()` and `result.getResponse()` |
| `provider.ts:639-713` | Usage, reasoning summaries, tool calls, refusal and finish reason read off the OpenResponses result |
| `__mocks__/@openrouter/sdk.ts` | Mocks `callModel` and `fromChatMessages` |
| `__mocks__/@openrouter/sdk-chat-compat.ts` | Mocks the subpath; mapped at `jest.config.ts:58` |

Commit `99391975f` pinned the plugin to exactly 1.5.56 (plugin 1.0.70). That holds CI and Release, but the plugin takes no SDK fixes until the pin moves, and the pin cannot move without this work.

### Why it survived until CI caught it

- Plugins have no committed lockfile (`.gitignore:165-166`), so CI resolves caret ranges fresh on every run. An upstream breaking change in a patch release lands on the next CI run with no local signal.
- The local typecheck passed on a `node_modules` that already had 1.5.60. The plugin's copy lacked `lib/chat-compat`, so TypeScript walked up to the root `node_modules/@openrouter/sdk` (1.5.34, kept for `lib/llm/pricing-fetcher.ts`) and resolved the subpath there. Two SDK versions compiled together and produced the cross-copy `TS2345` instead of a missing-module error.
- The unit tests run against the manual mocks, so a removed upstream API is invisible to them.

## 2. Decision

**Send the plain streaming path through the existing direct `fetch` to `/api/v1/chat/completions`, and delete `callModel()` and `chat-compat` from the plugin.** The SDK stays for the generated OpenAPI surface only: `chat.send` (non-streaming, no images), `models.list` (validation, model list, pricing) and `embeddings.generate` / `embeddings.listModels`. All of that is present in 1.5.60 (checked against the published tarball: `esm/sdk/chat.d.ts`, `models.d.ts`, `embeddings.d.ts`, and `models/chatresult`, `chatmessages`, `parameter` are unchanged; only `esm/lib/*` lost files).

**Not adopting `@openrouter/agent`.** It would bundle a second SDK major beside the first and pull in an MCP client the plugin does not use, to keep a streaming helper the plugin already replaces with forty lines of SSE parsing. The image provider (`image-provider.ts:115`) and the non-streaming vision send (`sendViaChatCompletions`) already speak Chat Completions directly; the streaming tool and image turns have for a year. This change makes the plain text turn do what every other turn does.

## 3. Known state (verified 2026-11-05)

Three request builders exist in `provider.ts`, and they have drifted. The table lists what each sends. ✓ is sent in the correct wire shape; ✗ is not sent; ⚠ is sent but wrong or inert.

| Field | `sendMessage` (SDK `chat.send`, `:167-313`) | `sendViaChatCompletions` (fetch, non-stream, `:324-482`) | `streamMessage` (SDK `callModel`, `:502-724`) | `streamViaChatCompletions` (fetch, stream, `:734-961`) |
|---|---|---|---|---|
| `model`, `messages`, `temperature`, `max_tokens`, `top_p`, `stop` | ✓ | ✓ | ✓ (`maxOutputTokens`) | ✓ |
| `user` ← `params.cacheKey` (sticky-routing hint) | ✓ `:211-213` | ✓ `:362-364` | ✓ `:549-551` | **✗** |
| `tools` + `tool_choice: 'auto'` | ✓ raw | ✓ raw | n/a (never reached with tools) | ✓ remapped `:772-782` |
| Web search | ✓ `plugins: [{id:'web', maxResults:5}]` | ✓ `plugins: [{id:'web', max_results:5}]` | `tools: [{type:'web_search_preview'}]` (a Responses-API tool) | **⚠** `tools: [{type:'web_search_preview'}]` `:785-788`. OpenRouter's Chat Completions web-search docs know only the `web` plugin and the `:online` suffix. |
| `response_format` (json_schema / json_object) | ✓ `:228-241` | ✓ `:375-388` | ✓ `text.format` | **✗** |
| Model fallbacks `models: [primary, …]` (drop `model`) | ✓ `:247-251` | ✓ `:394-398` | ✓ `:581-584` | **⚠** sets `route: 'fallback'` only `:792-794`, never `models`, so the fallback list is never sent. `route` is undocumented. |
| Provider preferences (`order`, `allow_fallbacks`, `require_parameters`, `ignore`, `only`) | ✓ `:254-263` | ✓ `:402-411` | ✓ `:587-596` | **✗** |
| **ZDR** `provider.data_collection: 'deny'` | ✓ | ✓ (the test at `openrouter-text-provider.test.ts:112` guards it) | ✓ | **✗** — a profile with "Zero Data Retention" ticked leaks the prompt on every streaming turn that carries a tool or an image. |
| `reasoning: { effort?, exclude: false }` | ✓ | ✓ | ✓ | ✓ `:798-803` |
| Request budget | SDK `timeoutMs` = whole request (right for non-stream) | abort signal = whole request (right) | SDK `timeoutMs` only when the caller set one (`:510`); otherwise unbounded | first-byte timer, `resolveRequestTimeoutMs(params)` (`:810-814`), cleared when headers land |
| Usage with cache reads excluded | ✓ | ✓ `prompt_tokens_details.cached_tokens` | ✓ | ✓ `:912-923` |
| Reasoning in the response | message `reasoning` | message `reasoning` | summaries from `output[].type === 'reasoning'`, **after** the text stream ends (never streamed) | `delta.reasoning`, streamed, cumulative `:886-890` |
| Tool calls accumulated | n/a | n/a | from `function_call` items | ✓ `:893-907` |
| Finish reason | `choice.finishReason` | `finish_reason` | derived: `tool_calls` / `refusal` / `stop` / incomplete reason | `tool_calls` else streamed `finish_reason` `:931` |
| Raw response | SDK `ChatResult` | the JSON | hand-built `{choices:[…], usage, _openResponsesResponse}` | `{choices:[…], usage}` |

Facts that settle the open questions in the issue, from OpenRouter's documentation (read 2026-11-05):

- **Usage on streaming is unconditional.** "Every stream ends with an extra chunk that carries the `usage` object for the request, sent just before the `[DONE]` message." `usage: { include: true }` and `stream_options.include_usage` are deprecated no-ops. `prompt_tokens_details.cached_tokens` and `cost` ride in that object. The fetch path's accounting therefore already behaves as the SDK path did.
- **Reasoning.** The request shape `reasoning: { effort, exclude }` is documented, `exclude` being Chat-Completions-only. Streamed reasoning is documented as `choices[].delta.reasoning_details` (typed entries); `delta.reasoning` is what the path reads today and what OpenRouter has emitted in practice. §4.3 reads both.
- **Web search** on Chat Completions is `plugins: [{ id: 'web', max_results }]` or the `:online` suffix. `web_search_preview` is not documented for this endpoint.
- **Model fallbacks** are `models: [...]`; `route` is not documented at all.

Nothing in the host reads `_openResponsesResponse` (grep over `lib/`). The host's finish-reason reader (`lib/llm/extract-finish-reason.ts:14-23`) reads `choices[0].finish_reason`, then `finishReason`; both fetch paths write both keys.

The esbuild post-build patch (`esbuild.config.mjs:112-134`) rewrites the SDK's *streaming* tool-call schema. Once nothing streams through the SDK it patches dead code; it already logs "pattern not found" when the schema is absent, so it is harmless to leave for Phase 1 and removed in Phase 3.

## 4. Design

### 4.1 One request-body builder

The drift in §3 is the bug class this change should end. `provider.ts` gets one private builder both fetch paths call:

```ts
private buildChatCompletionsBody(params: LLMParams, stream: boolean): Record<string, unknown>
```

It produces, in snake_case wire shape: `model` / `messages` / `stream` / `temperature` / `max_tokens` / `top_p` / `stop`; `user` from `cacheKey`; `tools` (remapped to `{ type: 'function', function }` as `:772-780` does today, which is a no-op on tools already in that shape) and `tool_choice: 'auto'`; `plugins: [{ id: 'web', max_results: 5 }]` when `webSearchEnabled`; `response_format`; `models` + delete `model` for fallbacks; `provider` with every preference including `data_collection`; `reasoning`. Messages come from the existing `buildMessageContent` map, which is also duplicated three times today and becomes one `buildChatCompletionsMessages(params)`.

`sendViaChatCompletions` and `streamViaChatCompletions` shrink to transport: headers, the request budget appropriate to their shape, and response parsing. No field may be set on a body outside the builder; a test (§6) asserts the two paths produce the same body save `stream`.

### 4.2 `streamMessage` routes everything through the fetch path

```ts
async *streamMessage(params, apiKey) {
  const attachmentResults = this.collectAttachmentResults(params);
  yield* this.streamViaChatCompletions(params, apiKey, attachmentResults);
}
```

The `hasTools || hasImages` branch, the `OpenRouter` client construction, the `ChatMessages[]` map, `fromChatMessages`, `callModel`, `getTextStream`, `getResponse`, the OpenResponses usage / reasoning / tool-call / refusal readers and the `_openResponsesResponse` raw shape are deleted. The imports at `:10-12` shrink to `OpenRouter` and `ChatResult`.

**Request budget.** A plain streaming turn now gets the fetch path's first-byte timer at `resolveRequestTimeoutMs(params)` (default `DEFAULT_REQUEST_TIMEOUT_MS`, `packages/plugin-utils/src/providers/request-budget.ts:29`) instead of no bound at all. This is the contract every other streaming provider already honours (headers bounded, body unbounded; the host's stall watchdog covers the body), and it is a strict improvement over `:506-510`, which left a default plain turn unbounded until headers arrived.

### 4.3 Reasoning on the stream

Keep `delta.reasoning` and add `delta.reasoning_details`: when `reasoning` is absent and `reasoning_details` is an array, append the `text` of every entry whose `type` is `reasoning.text` or `reasoning.summary` (skip `reasoning.encrypted`). The yield stays cumulative (`reasoningContent: fetchReasoning`), which is what the host expects today. Phase 0 confirms on a live reasoning model which of the two fields arrives, so the fallback is exercised at least once before it ships.

This is also the first time reasoning *streams* for a plain OpenRouter turn: the `callModel` path only read reasoning summaries after the text finished. No host change is needed; the Salon already renders cumulative `reasoningContent` from the tool-turn path.

### 4.4 Refusal on the stream

The `callModel` path mapped a refusal output item to `finishReason: 'refusal'`. On Chat Completions a refusal arrives as `delta.refusal` text (OpenAI schema; OpenRouter passes it through for OpenAI-routed models) or as `finish_reason: 'content_filter'`. The stream reader records `delta.refusal` when present and, if it saw one and no tool calls, reports `finish_reason: 'refusal'` so `classifyRefusal` keeps seeing what it saw before. This is a small addition to `:874-876`; everything else about refusal classification lives in the host and is untouched.

### 4.5 `sendMessage` keeps `chat.send` in Phase 1

The non-streaming, no-image send still works on 1.5.60 and has a test. Phase 1 leaves it, so the change that unpins the SDK is as small as possible. Phase 3 retires it (§5), because with the builder in place it is the last place a second wire shape (camelCase SDK params) can drift from the fetch paths, and it is the only reason the esbuild SDK patch exists.

### 4.6 Dependency

`plugins/dist/qtap-plugin-openrouter/package.json`: `"@openrouter/sdk": "^1.5.60"`. Plugin and manifest bump to 1.0.71. The root `package.json` keeps `^1.5.34` for `lib/llm/pricing-fetcher.ts`; it only calls `models.list()` and is unaffected.

### 4.7 Guard against the mixed-copy typecheck

The local typecheck passed because a plugin import resolved from the root `node_modules`. `scripts/build-plugins.ts` already runs each plugin's `typecheck`; after it passes, run `tsc -p tsconfig.json --noEmit --explainFiles` in the plugin directory and fail the build if any line resolves a package the plugin lists in its own `dependencies` from a path outside the plugin's `node_modules` (a `../` prefix reaching the repo root). This costs one extra `tsc` per plugin and would have turned the confusing `TS2345` into "`@openrouter/sdk/lib/chat-compat` resolved from the repository root, not the plugin". The message names the plugin, the package and both paths.

## 5. Phases

**Phase 0 — live facts (V4test, before any code).** With an OpenRouter profile on a reasoning model (a DeepSeek R1 or Kimi K2 thinking slug), run one tool-enabled turn, which already goes through `streamViaChatCompletions`, with `LLM_LOG` capture on. Record: whether `delta.reasoning` or `delta.reasoning_details` (or both) arrives; that the final chunk carries `usage.prompt_tokens_details.cached_tokens` on a second turn against the same prefix. These decide the §4.3 reader and confirm the accounting claim in §3.

**Phase 1 — the switch (delegable; the issue's scope).**
1. `buildChatCompletionsMessages` and `buildChatCompletionsBody` (§4.1); `sendViaChatCompletions` and `streamViaChatCompletions` call them.
2. `streamMessage` becomes the three-line delegate (§4.2); delete the `callModel` path, `fromChatMessages`, the `ChatMessages` / `OpenResponsesResult` imports, and the stale "SDK v0.8.0 / callModel()" header comment at `provider.ts:7`.
3. §4.3 reasoning fallback and §4.4 refusal, per Phase 0.
4. `package.json` → `^1.5.60`; bump plugin + manifest to 1.0.71; delete the plugin's `node_modules` and `package-lock.json`; `npm run build:plugins` typechecks against the latest SDK.
5. Mocks and tests (§6).
6. `docs/CHANGELOG.md`; the plugin's `README.md` if it names `callModel` (it does not today).

**Phase 2 — the guard (delegable, independent).** §4.7 in `scripts/build-plugins.ts`, with a unit test over its path-classification function.

**Phase 3 — retire `chat.send` (optional, recommended, after Phase 1 has been live).** `sendMessage` calls `sendViaChatCompletions` unconditionally; delete the SDK send block (`:167-313`) and its `ChatResult` import; delete `applyOpenRouterSdkPatch` from `esbuild.config.mjs`; the "keeps the SDK path for text-only sends" test inverts to "every send is one fetch with one body". The SDK is then `models.list` and `embeddings.*` only.

## 6. Tests

All in `__tests__/unit/openrouter-text-provider.test.ts` unless noted; `fetch` is already mocked there. A streaming response is a `ReadableStream` of `data: {...}\n` lines ending in `data: [DONE]`, built by a small local helper.

1. **Plain streaming turn goes through fetch.** No tools, no images: `fetch` is called once with `stream: true`; `OpenRouter` is never constructed (assert the mock constructor was not called); deltas are yielded in order; the final chunk carries `usage` with `cached_tokens` subtracted, `cacheUsage` set, and `rawResponse.choices[0].finish_reason === 'stop'`.
2. **Body parity.** For one `LLMParams` carrying `cacheKey`, a `json_schema` `responseFormat`, `fallbackModels`, every provider preference, `enableZDR`, `reasoningEffort` and `webSearchEnabled`, the streaming body and the non-streaming body are deep-equal except `stream`; and the body has `user`, `response_format.json_schema.name`, `models` (and no `model`), `provider.data_collection === 'deny'`, `plugins[0].id === 'web'`, no `web_search_preview` anywhere.
3. **ZDR on a streaming tool turn** (the leak in §3): with tools and `enableZDR`, `body.provider.data_collection === 'deny'`.
4. **Reasoning stream.** Chunks carrying `delta.reasoning` yield cumulative `reasoningContent`; chunks carrying only `delta.reasoning_details` (`reasoning.text` and an ignored `reasoning.encrypted`) yield the same; the final chunk's `reasoningContent` is the concatenation.
5. **Refusal.** A stream with `delta.refusal` and no tool calls reports `finish_reason: 'refusal'`; one with `finish_reason: 'content_filter'` reports `content_filter`.
6. **Tool-call accumulation and `tool_calls` finish reason** keep passing (existing behaviour, previously untested on this path).
7. **Nothing names the removed API.** `__tests__/unit/plugins/openrouter-no-callmodel.test.ts`: reads `plugins/dist/qtap-plugin-openrouter/*.ts`, `__mocks__/@openrouter/*`, `jest.config.ts` and fails on `callModel`, `chat-compat` or `fromChatMessages`. This is the issue's verification step 2 made permanent.
8. **Mocks.** `__mocks__/@openrouter/sdk.ts` loses `mockCallModel`, `mockGetTextStream`, `mockGetResponse`, `mockGetToolCalls`, `fromChatMessages`; `__mocks__/@openrouter/sdk-chat-compat.ts` is deleted; the `jest.config.ts:58` mapping is removed. The header comment ("Mock for @openrouter/sdk v0.8.0") is replaced with what it mocks now.
9. **Phase 2:** the explainFiles classifier flags `../../../node_modules/@openrouter/sdk/...` for a plugin that depends on `@openrouter/sdk` and ignores `../../../node_modules/zod/...` for one that does not list `zod`.

## 7. Verification

1. `rm -rf plugins/dist/qtap-plugin-openrouter/{node_modules,package-lock.json} && npm run build:plugins` passes with the SDK resolved to the latest 1.5.x.
2. `grep -rn "callModel\|chat-compat" plugins/dist/qtap-plugin-openrouter/*.ts __mocks__ jest*.ts` is empty (and test 7 keeps it so).
3. `npx jest __tests__/unit/openrouter` and `npx tsc`.
4. Live in V4test on an OpenRouter profile, dev server restarted so the rebuilt plugin loads: a plain Salon turn, a reasoning-model turn, a tool turn and an image turn. Text streams; reasoning streams on the reasoning model; the LLM log shows usage with cache reads excluded and a `cost`; with ZDR ticked, the tool turn's logged request body carries `provider.data_collection: "deny"`.
5. On the issue: Fix site filled in, closing comment, `Fixes #145` in the commit.

## 8. Documentation

- `docs/CHANGELOG.md`: the switch, the unpin, and the three behaviour fixes it carries for streaming tool and image turns (ZDR and provider preferences now sent; model fallback list now sent; web search now uses the `web` plugin).
- `help/connection-profiles.md` already describes Zero Data Retention for OpenRouter; no wording change, since the promise it makes is what this restores. If Phase 1 ships before a release that help page's claim is true again for every turn shape.
- `.claude/commands/update-documentation.md`: this spec's entry.
- On completion the spec moves to `docs/developer/features/complete/` with an As-built section noting the Phase 0 findings.

## 9. Out of scope

- The Salon's display of `reasoning_details` beyond text (encrypted blobs, signatures). Display-only reasoning stays display-only.
- `lib/llm/pricing-fetcher.ts` and the root `@openrouter/sdk` range.
- The other provider plugins' request-budget or web-search shapes.
- A committed lockfile for plugins. The guard in §4.7 catches the local blind spot; floating ranges in CI remain the deliberate policy that surfaced this break in the first place.

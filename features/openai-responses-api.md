# Feature: OpenAI Responses API Migration

**Status:** Not Implemented
**Target Version:** TBD

## Summary

Migrate `qtap-plugin-openai` from the Chat Completions API (`client.chat.completions.create()`) to the Responses API (`/v1/responses`). The Grok plugin was already migrated to Responses API in v2.8 and serves as the reference implementation. The OpenAI-Compatible plugin remains on Chat Completions, as the Responses API is proprietary to OpenAI (and providers that explicitly support it like Grok and OpenRouter).

## Motivation

- **Cost savings**: OpenAI reports 40–80% better cache utilization with Responses API vs Chat Completions, directly reducing token costs on long conversations
- **Better reasoning model support**: 3% improvement on SWE-bench benchmarks when using reasoning models (o1, o3, o4, gpt-5) through Responses API
- **Conversation chaining**: `previous_response_id` eliminates re-sending full message history every turn, saving tokens and latency on long Salon conversations
- **Native built-in tools**: Web search, file search, code interpreter, and remote MCP support as first-class server-side tools instead of bolted-on parameters like `web_search_options: {}`
- **Typed output items**: Responses return distinct typed items (message, function_call, web_search_call, reasoning) instead of overloading `choices[].message`, simplifying tool call and reasoning token parsing
- **Future-proofing**: OpenAI is steering all new features exclusively to Responses API; Chat Completions is maintained but frozen

## Existing Reference

The Grok plugin (`plugins/dist/qtap-plugin-grok/provider.ts`) was migrated to the Responses API in February 2026. It demonstrates:

- Full Responses API type definitions (request, response, streaming events)
- Message format conversion from `LLMMessage[]` to Responses API `input[]`
- SSE streaming with manual `fetch` + `ReadableStream` parsing
- Server-side tools (`web_search`, `x_search`) alongside client-side function tools
- `buildRawResponse()` that converts Responses API output back to Chat Completions–compatible shape for downstream compatibility (tool call parsing, logging, etc.)
- Stateless operation with `store: false`

The OpenAI migration should follow this same pattern, adapted for OpenAI-specific features.

## Scope

### In Scope

- Migrate `sendMessage()` and `streamMessage()` in `qtap-plugin-openai/provider.ts` to use the Responses API
- Maintain backward-compatible `raw` response shape so downstream tool call parsing, logging, and the Inspector continue to work
- Support `previous_response_id` for conversation chaining (optional opt-in, requires storing response IDs)
- Native web search as a server-side tool (replacing `web_search_options` hack)
- Reasoning model support (temperature/top_p exclusion, token allocation)
- Image attachments via `input_image` content type
- Function calling via Responses API tool format
- Structured output support (`text` format with `json_schema`)
- Debug logging for all API interactions

### Out of Scope (for now)

- **Built-in file search tool** — Commonplace Book handles our RAG
- **Built-in code interpreter** — future Prospero enhancement, separate feature
- **Remote MCP via Responses API** — we have our own MCP plugin
- **Computer use tool** — not relevant to Quilltap
- **OpenAI-Compatible plugin changes** — stays on Chat Completions
- **`store: true` / conversation persistence on OpenAI's side** — Quilltap manages its own history

## Engineering Tasks

### Phase 1: Core Migration

1. **Define Responses API types** in `qtap-plugin-openai/provider.ts`
   - Adapt type definitions from the Grok plugin, adding OpenAI-specific fields
   - Add `previous_response_id` to request type
   - Add `reasoning` output item type (OpenAI returns reasoning summaries on o-series models)
   - Add `instructions` top-level field (OpenAI's cleaner system prompt mechanism)
   - Include `text` format configuration for structured outputs / JSON schema

2. **Implement message format conversion**
   - Convert `LLMMessage[]` → Responses API `input[]` format
   - System messages: use top-level `instructions` field (preferred) or `type: 'message', role: 'developer'` items (OpenAI uses `developer` instead of `system` in Responses API)
   - User messages: `type: 'message', role: 'user'` with `input_text` and `input_image` content
   - Assistant messages: `type: 'message', role: 'assistant'` with string content
   - Handle attachments (images as `input_image` with base64 data URLs)
   - Handle the `name` field for multi-character chats

3. **Implement `sendMessage()` with Responses API**
   - Use raw `fetch` to `https://api.openai.com/v1/responses` (matching Grok pattern)
   - Set `store: false` for stateless operation
   - Handle reasoning model detection (skip temperature/top_p, ensure minimum token allocation)
   - Map tools: server-side `web_search_preview` tool + client-side function tools
   - Build backward-compatible `raw` response via `buildRawResponse()` pattern
   - Extract text from `output_text` content items
   - Extract function calls from `function_call` output items
   - Parse usage from `response.usage` (input_tokens → promptTokens, etc.)

4. **Implement `streamMessage()` with Responses API**
   - Use raw `fetch` with `stream: true` + SSE parsing (matching Grok pattern)
   - Handle stream event types:
     - `response.output_text.delta` → yield content chunks
     - `response.output_text.done` → text complete
     - `response.function_call_arguments.delta` → accumulate tool call args
     - `response.function_call_arguments.done` → tool call complete
     - `response.output_item.added` → track new output items (function calls, web search)
     - `response.completed` → extract final usage, build raw response
   - Yield final chunk with usage, attachmentResults, and rawResponse
   - Handle `response.error` and `response.incomplete` events

5. **Backward-compatible raw response**
   - `buildRawResponse()` must produce a structure that looks like Chat Completions output
   - This ensures the streaming service, tool call parser, Inspector, and chat log storage all continue to work without changes
   - Include `choices[0].message.tool_calls` array built from `function_call` output items
   - Map `finish_reason` from response status + output item types

### Phase 2: Conversation Chaining (Optional Enhancement)

6. **Store and retrieve response IDs**
   - When a response comes back, store its `id` (the Responses API response ID) alongside the chat message
   - Add an optional `responseId` field to the chat message schema (or metadata)
   - On next message in the same conversation, pass `previous_response_id` if available
   - This allows OpenAI to use its internal cache, dramatically reducing input token costs
   - **Schema change**: needs migration if we add a column; alternatively store in message metadata JSON

7. **Fallback behavior**
   - If `previous_response_id` fails (e.g., expired, purged), fall back to sending full message history
   - Log the fallback for debugging

### Phase 3: Enhanced Tools

8. **Native web search as server-side tool**
   - Replace `web_search_options: {}` with `{ type: 'web_search_preview' }` in tools array
   - Handle `web_search_call` output items in response
   - Parse URL citation annotations from `output_text` items
   - Consider surfacing citations in the Salon UI (separate feature)

9. **Structured output via `text` format**
   - Map `responseFormat` from `LLMParams` to the Responses API `text` format config
   - Support `json_schema` enforcement through the `text.format` parameter

## Testing

- Unit tests for message format conversion (LLMMessage → Responses API input)
- Unit tests for `buildRawResponse()` backward compatibility
- Unit tests for streaming SSE event parsing
- Integration test with real OpenAI API key (manual, not CI)
- Verify tool calls work end-to-end with Prospero
- Verify multi-character chat `name` field handling
- Verify reasoning model parameter exclusion
- Verify web search with citation parsing
- Verify image attachments with vision models

## Migration Notes

- The `openai` npm package (v6.16+) supports both APIs, so no dependency change needed for the SDK import (used for `validateApiKey`, `getAvailableModels`, `generateImage`)
- Chat and streaming code switches from SDK methods to raw `fetch`, matching the Grok plugin pattern
- `validateApiKey()` and `getAvailableModels()` stay on the SDK's `models.list()` — no change needed
- `generateImage()` stays on the SDK's `images.generate()` — no change needed
- Plugin version bump required when changes ship
- Help files should document any user-visible changes (e.g., if we surface web search citations)

## Open Questions

1. **`previous_response_id` storage**: Column on `chat_messages` table vs JSON metadata field? Column is cleaner for queries but requires a migration. Metadata is zero-migration but harder to query.
2. **`instructions` vs inline system messages**: The Responses API supports a top-level `instructions` field as a cleaner alternative to system messages in the input array. Should we use it for the primary system prompt and keep per-message system instructions inline, or put everything inline?
3. **Web search citation UI**: When OpenAI returns URL citations in annotations, should we render them inline in the Salon? This is likely a separate feature but worth considering during implementation.
4. **OpenAI SDK's `client.responses.create()`**: The OpenAI SDK v6+ may have native Responses API support via `client.responses.create()`. If so, we could use the SDK instead of raw `fetch`, getting better type safety. Worth checking SDK docs before implementation. The Grok plugin uses raw `fetch` because Grok's endpoint isn't in the OpenAI SDK, but OpenAI's own endpoint likely is.

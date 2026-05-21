# Feature: Simple JSON Tool Calls (pseudo-tool replacement)

**Status:** Proposal / Not Implemented
**Owner:** Charlie
**Scope:** Replace the `text-block` pseudo-tool format with a smaller, more robustly-parsed JSON-in-XML-tag format for models that lack native function calling. Native function-calling providers are unaffected.

## Motivation

The current pseudo-tool surface has two formats running in parallel — `provider-text-markers` (vendor-specific XML emissions like DeepSeek's `<function_calls>`) and `text-block` (the `[[TOOL_NAME param="value"]]content[[/TOOL_NAME]]` dialect). The architectural loop around them is fine: `lib/services/chat-message/text-tool-loop.service.ts` strips markers, executes the tools, rebuilds a continuation slate (original `formattedMessages` + stripped assistant turn + one synthetic user turn per tool result), and re-streams. That loop is sound and is **not** what's being replaced.

What's flaky is the *emission surface*:

- `[[TOOL_NAME param="value"]]content[[/TOOL_NAME]]` is a Quilltap dialect that appears nowhere in LLM pretraining data. Weak models invent variants — single brackets, missing quotes, lowercase tags, code-fence wrapping — and the parser is strict.
- The system prompt currently documents ~15 tools, each with bespoke parameter and content conventions. That is heavy cognitive load for a small model.
- Multiple tool calls per turn are permitted, forcing the model to plan a sequence rather than react one step at a time. Planning is precisely the weak link in models that need pseudo-tools.
- There is no provider-level stop sequence enforcement, so the model frequently continues narrating after committing to a tool call.

This feature replaces the `text-block` strategy with a `simple-json` strategy designed around three principles: a *familiar* syntax (JSON inside an XML tag), a *single* tool call per turn, and a *hard stop* via provider stop sequences.

## Design

### Emission format

```
<tool_call>
{"name": "search", "arguments": {"query": "user's favorite food"}}
</tool_call>
```

Rules:

- One `<tool_call>...</tool_call>` block per assistant turn. Any blocks after the first are ignored at parse time.
- JSON object with exactly two top-level keys: `name` (string) and `arguments` (object). Unknown top-level keys are tolerated and ignored.
- Whitespace and newlines between tags and JSON are tolerated.
- The model is told it may write narrative text *before* the tool call; anything after the closing tag is discarded (the stop sequence usually prevents it being generated at all).

### Stop sequence

When the simple-json strategy is active, the continuation re-stream and the initial stream both pass `stop: ["</tool_call>"]` through to the provider. This requires plumbing a `stop` field through `StreamOptions` and into each provider adapter (most already accept it; OpenAI-compatible and Ollama definitely do; the Anthropic adapter accepts `stop_sequences`; the Gemini adapter accepts `stopSequences`).

The stop sequence is the single biggest reliability lever. It removes an entire class of "model emitted a valid tool call and then kept narrating fake results" bugs.

### Lenient parser

Three tiers, in order. Each tier logs its hit at `debug` so we can see which models need which fallback:

1. **Strict** — extract the substring between `<tool_call>` and `</tool_call>`, run `JSON.parse`.
2. **Repaired** — same substring, run through `jsonrepair` (existing dependency or new one — see "Dependencies"). Handles trailing commas, single quotes, unquoted keys, smart quotes.
3. **Balanced-brace** — find the first `{` after `<tool_call>`, walk the string tracking brace depth (respecting string literals and escapes), extract the balanced object, retry `jsonrepair`. Last resort for models that drop the closing tag entirely.

If all three fail, the strategy logs at `warn` with the raw payload and falls through to treating the response as plain text. The user sees the assistant's prose; the tool simply didn't fire. This is a graceful degradation, not a crash.

The parser is also tolerant of the *opening* tag drift: `<toolcall>`, `<tool>`, `<call>`, and `<function_call>` are accepted as aliases. The closing tag must match the opening tag for `</tool_call>` proper, but a missing closing tag is recoverable via tier 3.

### One tool call per turn

The system prompt explicitly says: *"After emitting a tool call, stop. The system will run the tool and reply with the result. You may then either respond to the user or make another tool call. Do not emit more than one tool call at a time."*

This is enforced softly by prompt and hard by stop sequence. If the model emits multiple blocks, the parser uses only the first.

### Result framing back to the model

Tool results are returned to the model in a symmetric `<tool_result>` block, mirroring the `<tool_call>` format the model just emitted:

```
<tool_result name="search">
{"matches": [{"title": "Pizza preference", "excerpt": "Charlie mentioned he prefers...", "score": 0.87}]}
</tool_result>
```

Rules:

- `name` attribute matches the `name` field of the originating `<tool_call>`. This is for the model's benefit when reasoning about multi-step sequences; the parser doesn't require it for correctness.
- Body is the formatted tool output. Where the handler returns structured data, we serialize it as JSON. Where the handler returns prose (e.g. a search summary), we pass the prose through unwrapped.
- The block is delivered as a `user`-role message in the continuation slate. The `user` role is what every chat-completion API accepts as the "non-assistant turn," and the explicit tag-and-attribute framing keeps the model from confusing the result with a real user utterance.
- The system prompt tells the model: *"Tool results will arrive in `<tool_result name=\"...\">...</tool_result>` blocks. Read the result, then either respond to the user or make another tool call."*

This replaces the existing `[Tool Result: <name>]\n<content>` framing used by the legacy `text-block` strategy. The change is scoped to the new strategy — see "Strategy-scoped result formatting" under Files to modify.

### Strategy-scoped result formatting

The `TextToolStrategy` interface in `text-tool-loop.service.ts` gains a `formatToolResult(toolName: string, content: string): string` method. Each strategy provides its own framing:

- `text-block` strategy: `[Tool Result: ${toolName}]\n${content}` (existing behavior, unchanged for the rollout period).
- `simple-json` strategy: `<tool_result name="${escapeAttr(toolName)}">\n${content}\n</tool_result>`.
- `provider-text-markers` strategy: keep current behavior; it's vendor-shaped already.

`runTextToolPass` calls `strategy.formatToolResult(...)` when building the continuation messages instead of using the inline template literal. This is the only behavioral change to the shared loop file.

### Generated tool documentation

Instead of 15 hand-written prompt blurbs, `buildSimpleJsonToolInstructions(enabledTools)` walks the tool registry and emits a uniform schema for each enabled tool:

```
Available tools:

- search(query: string, limit?: number): Search the Scriptorium for information about past conversations, preferences, or facts.
- generate_image(prompt: string): Generate an image to show in the conversation.
- whisper(to: string, message: string): Send a private message to a specific character.
- ...

To use a tool, emit exactly one tool call block, then stop:

<tool_call>
{"name": "search", "arguments": {"query": "what we discussed about the garden"}}
</tool_call>

The system will run the tool and reply with the result. You may then respond to the user or call another tool.
```

The signatures come from each tool's existing `validateXInput` / Zod schema. If a tool's Zod schema isn't already in a form we can pretty-print, we add a small `describeToolSignature(toolName)` helper in `lib/tools/simple-json-prompt.ts` that converts `ZodObject` shapes to the `(name: type, name?: type)` syntax. This is a small one-time refactor; the schemas are all already there.

### Native-tool path is untouched

`shouldUseTextBlockTools(modelSupportsNativeTools, profileOverride)` is the existing gate. The simple-json strategy slots into the same branch — it does not run when the provider supports native function calling. OpenAI, Anthropic, recent Gemini, and any other native-tools provider continue using their fine-tuned native protocols.

The profile-level override (`pseudoToolMode` or equivalent setting) gains a new value: `'simple-json'`. Existing values `'auto'`, `'native'`, `'text-block'` stay. Default for `'auto'` on non-native models is *initially* `'text-block'` (no behavior change), then flips to `'simple-json'` after the A/B period — see "Rollout" below.

## Files to create

1. `lib/tools/simple-json-prompt.ts` — exports `buildSimpleJsonToolInstructions(options: SimpleJsonPromptOptions): string` and `describeToolSignature(toolName: string): string`. Mirrors the shape of `text-block-prompt.ts` so the wiring in `pseudo-tool.service.ts` stays uniform.
2. `lib/tools/simple-json-parser.ts` — exports `parseSimpleJsonCalls(response: string): ParsedSimpleJsonCall[]`, `convertSimpleJsonToToolCallRequest(...)`, `stripSimpleJsonMarkers(response: string): string`, `hasSimpleJsonMarkers(response: string): boolean`. Mirrors `text-block-parser.ts`.
3. `lib/services/chat-message/__tests__/simple-json-strategy.test.ts` — Jest unit tests for the strategy end-to-end with mocked streaming.
4. `lib/tools/__tests__/simple-json-prompt.test.ts` — golden-master test for the prompt output given a representative tool set.
5. `lib/tools/__tests__/simple-json-parser.test.ts` — table-driven tests for each parser tier, including edge cases (missing close tag, smart quotes, trailing commas, multi-block emission, JSON inside a code fence the model added unprompted).

## Files to modify

1. `lib/services/chat-message/pseudo-tool.service.ts` — add `buildSimpleJsonSystemInstructions(...)`, `parseSimpleJsonFromResponse(...)`, `stripSimpleJsonFromResponse(...)`, `logSimpleJsonToolUsage(...)`. Keep the existing `text-block` exports for the rollout period.
2. `lib/services/chat-message/text-tool-loop.service.ts` — add `'simple-json'` to the strategy-name union. Extend `TextToolStrategy` with `formatToolResult(toolName: string, content: string): string`. Replace the inline `\`[Tool Result: ${toolMsg.toolName}]\\n${toolMsg.content}\`` template inside the continuation-message-building loop with a call to `strategy.formatToolResult(toolMsg.toolName, toolMsg.content)`. Provide the existing template as the `text-block` strategy's implementation so its behavior is unchanged.
3. `lib/services/chat-message/streaming.service.ts` — extend `StreamOptions` with `stop?: string[]`. Pass through to `provider.streamMessage(...)`.
4. Each provider adapter under `lib/providers/` — accept the new `stop` option. For most providers this is a one-line passthrough; document the mapping in a comment (`stop` → `stop_sequences` for Anthropic, → `stopSequences` for Gemini, → `stop` for OpenAI-compatible and Ollama).
5. `lib/services/chat-message/orchestrator.service.ts` — when the active strategy is `'simple-json'`, call `runTextToolPass` with a strategy object that returns `'simple-json'` as `name` and passes `stop: ['</tool_call>']` into the continuation's `streamMessage` call. The initial pre-loop stream also needs the stop sequence — that's a small change near where `streamMessage` is first invoked for the assistant turn.
6. `lib/tools/pseudo-tool-support.ts` — extend `ToolMode` union with `'simple-json'`. Update `shouldUseTextBlockTools` and the related selection logic so a profile set to `'simple-json'` picks the new strategy.
7. `lib/tools/index.ts` — re-export the new prompt/parser modules.
8. `lib/schemas/connection-profile.ts` (or wherever `pseudoToolMode` lives on the profile schema) — extend the Zod enum. Bump the schema version if applicable. Check if a migration is needed for stored profiles; if `'auto'` is the default and existing profiles store `'auto'`, no migration needed.
9. Settings UI under `app/settings/` — the profile editor that exposes `pseudoToolMode` (Chat tab or wherever the pseudo-tool selector lives) gains a `Simple JSON` option with a short helper tooltip. User-facing copy goes through the steampunk voice — see "Documentation" below.
10. `help/*.md` — any help file that documents the pseudo-tool mode setting gets an entry for the new option. Update the `url` frontmatter and the `help_navigate` example if the section anchors change.

## Implementation phases

### Phase 1 — parser and prompt, in isolation

- Write `simple-json-parser.ts` with all three tiers and the table-driven tests. Aim for 100% branch coverage on the parser; it is the highest-leverage piece.
- Write `simple-json-prompt.ts` with the generated tool list. Golden-master test the output for a fixed enabled-tool set.
- No wiring yet. The orchestrator still uses `text-block`. This phase can ship behind no flag because nothing calls it.

### Phase 2 — strategy and stop-sequence plumbing

- Extend `StreamOptions` with `stop?: string[]`.
- Update each provider adapter to honor it. Add a unit test per adapter that asserts the stop sequence reaches the underlying client (mocked).
- Add `ToolMode = 'simple-json'` and the selection logic.
- Add the `pseudo-tool.service.ts` wrapper functions.
- Wire the orchestrator: when `pseudoToolMode === 'simple-json'`, build the system prompt with `buildSimpleJsonSystemInstructions`, pass `stop: ['</tool_call>']` into both the initial stream and the continuation, and call `runTextToolPass` with the new strategy.
- Integration test: a mock provider emits `<tool_call>{"name":"search","arguments":{"query":"x"}}</tool_call>`; assert the orchestrator parses, executes, builds the continuation, and re-streams.

### Phase 3 — settings UI and help

- Add the `Simple JSON` option to the pseudo-tool mode selector.
- Help file updates with the steampunk voice in user copy. Developer-facing voice in this spec, in DDL.md, in code comments.
- A note in `docs/CHANGELOG.md` (terse, developer voice) when the feature lands.

### Phase 4 — A/B period

- Default behavior unchanged: `pseudoToolMode === 'auto'` still picks `text-block`. Users who want to try the new mode set their profile explicitly.
- Add structured debug logging on every pseudo-tool emission: `mode`, `parserTier` (`strict` / `repaired` / `balanced-brace` / `fail`), `toolName`, `responseLength`, `provider`, `model`. This goes into `combined.log` via the existing service logger.
- Document a one-liner the developer can run against `combined.log` to summarize parser-tier hit rates per provider/model.
- Recommended A/B period: two to four weeks of real use across the developer's primary local models. Track the parser-tier distribution; if simple-json tier-1-strict hit rate exceeds text-block's clean-parse rate by a meaningful margin, flip the `'auto'` default.

### Phase 5 — flip default, deprecate text-block

- `pseudoToolMode === 'auto'` on a non-native model now picks `'simple-json'`.
- `text-block` remains selectable for one further minor version, then removal.
- `text-block-prompt.ts`, `text-block-parser.ts`, and the related wrappers move to a `legacy/` subfolder, then deleted in the version after that.

## Dependencies

- `jsonrepair` (npm) — small, MIT-licensed, no runtime deps. Add to `dependencies` in `package.json`. If a similar utility is already vendored, prefer that.
- No other new dependencies.

## Testing checklist

- Unit: parser tier coverage, prompt golden-master, signature describer.
- Unit: each provider adapter honors `stop`.
- Integration: orchestrator + mock provider emits a tool call, gets a result, continues. With and without prose preamble. With and without trailing prose (which should not appear when stop sequence works).
- Integration: parser fallback cases — missing close tag, single quotes, trailing commas, smart quotes, two blocks emitted, no blocks emitted, malformed JSON beyond repair.
- E2E: a Playwright test against a local Ollama instance with a small model (e.g. `qwen2.5:7b`), exercising one of the simpler tools (`rng` is a good candidate — no external dependencies). Skip in CI if Ollama isn't present.
- Regression: confirm native-tool providers (an OpenAI profile) are completely unaffected. The simple-json prompt should not be injected; the stop sequence should not be set.

## Risks and open questions

1. **Provider stop-sequence support quirks.** A few OpenAI-compatible endpoints silently ignore `stop` or truncate to a single sequence. The parser's tier-3 fallback is the safety net, but worth noting in the docs.
2. **Multi-character chats and the `whisper` tool.** The "one tool call per turn" rule is at odds with cases where a character might naturally want to whisper *and* search in the same turn. The continuation loop handles this — call `whisper`, get the (no-op) result, then call `search` — but it costs an extra round-trip. Acceptable for chat latencies; flag it in the help text.
3. **`request_full_context` and `submit_final_response`.** These tools currently coordinate the agent-mode loop. They should be exposed through the simple-json surface the same way other tools are. Verify their schemas pretty-print correctly via `describeToolSignature`.
4. **Memory and chat history persistence.** The stripped response (markers removed) is what gets persisted. Confirm `strippedResponse` is what flows into the chat message store, not the raw emission. This is already correct in `text-tool-loop.service.ts`; the simple-json strategy needs the same discipline.
5. **`<tool_result>` collisions in user content.** A user could in principle type the literal string `<tool_result>` into a chat. The continuation-slate construction inserts results as fresh `user`-role messages built by us, not by the user, so this isn't a parsing concern on our side — but a model that has just learned the tag convention might be confused if it sees the tag in user prose later. Low-probability edge case; flag it in code comments and move on.

## Documentation

- This spec, in developer voice.
- `help/*.md` entries that touch user-facing settings copy use the project's steampunk-Wodehouse voice. A `pseudo-tool-mode.md` (or update to the existing settings help file) explains the option in-character.
- `docs/CHANGELOG.md` gets a terse developer-voice entry when each phase lands.
- `DDL.md` only if the profile schema bump requires it.

## Out of scope

- Replacing the `provider-text-markers` strategy. That strategy catches vendor-specific spontaneous emissions (DeepSeek's `<function_calls>` etc.) which are an entirely different signal from the prompt-trained simple-json format. Keep it as-is.
- Changing the continuation-slate *shape*. The order (original `formattedMessages` + stripped assistant turn + one synthetic user turn per tool result) is preserved. Only the per-result framing string and the `formatToolResult` indirection are new.
- Changing native-tool behavior in any way.
- A new tool registry. We reuse the existing one.

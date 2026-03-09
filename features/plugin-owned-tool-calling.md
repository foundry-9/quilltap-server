# Feature: Plugin-Owned Tool Calling

Move all provider-specific tool-calling logic out of the core application and into individual provider plugins. The orchestrator should be provider-agnostic — it coordinates the tool loop but never contains format-specific code.

## Current State

The tool-calling pipeline has provider-specific code scattered across the core:

- **`lib/chat/tool-executor.ts`**: Hardcoded fallback parsing for OpenAI, Anthropic, Google, and Grok response formats
- **`lib/tools/xml-tool-parser.ts`**: Universal parser for spontaneous XML tool call emissions (DeepSeek `<function_calls>`, Gemini `<tool_use>`, etc.)
- **`lib/services/chat-message/orchestrator.service.ts`**: Tool results formatted as plaintext user messages (`[Tool Result: name]\ncontent`) instead of native provider formats
- **Tool definitions** (`lib/tools/*-tool.ts`): Each tool has provider-specific variants (`getOpenAIFoo`, `getAnthropicFoo`, `getGoogleFoo`)

Plugins already own two pieces:
- `formatTools()` — converting universal tool definitions to provider format
- `parseToolCalls()` — parsing native API tool calls from `rawResponse`

## Goal

Zero provider-specific code in the core application. All provider knowledge lives in plugins and `plugin-utils`.

## Phases

### Phase 1: Text Tool Call Parsing → Plugins

**Problem:** When models spontaneously emit XML-style tool calls in their text output (instead of using their native API mechanism), the orchestrator runs a universal XML parser that tries every known format. This doesn't scale and can't be provider-aware.

**Solution:** Add text-based tool call detection to the plugin interface:

```typescript
interface LLMProviderPlugin {
  // ... existing ...

  /**
   * Check if a text response contains spontaneous tool call markers.
   * Quick check before full parsing (like hasXMLToolMarkers).
   */
  hasTextToolMarkers?(text: string): boolean

  /**
   * Parse spontaneous tool calls from response text.
   * Returns standardized ToolCallRequest[] from whatever format
   * the provider's models tend to hallucinate.
   */
  parseTextToolCalls?(text: string): ToolCallRequest[]

  /**
   * Strip spontaneous tool call markers from text for display.
   */
  stripTextToolMarkers?(text: string): string
}
```

Each plugin implements these for their models' known behaviors:
- **Google**: Catches `<tool_use>{"name":"...","input":{...}}</tool_use>`
- **OpenRouter**: Catches `<function_calls>` (DeepSeek), `<tool_call>` (generic), and `<tool_use>` (varies by underlying model)
- **Anthropic/OpenAI/Grok**: Return empty — their models use native tool calling correctly
- **Ollama/OpenAI-compatible**: May catch various XML formats depending on model

The current `xml-tool-parser.ts` code moves to `plugin-utils` as utility functions that plugins can import and compose.

The orchestrator replaces the hardcoded XML parsing block with:
```typescript
const plugin = getProviderPlugin(provider)
if (plugin.hasTextToolMarkers?.(fullResponse)) {
  const textToolCalls = plugin.parseTextToolCalls?.(fullResponse) ?? []
  // ... execute and continue ...
  fullResponse = plugin.stripTextToolMarkers?.(fullResponse) ?? fullResponse
}
```

### Phase 2: Native Tool Result Formatting → Plugins

**Problem:** After executing a tool, results are sent back to the provider as plaintext in a user message: `role: "user", content: "[Tool Result: search_memories]\n72°F and sunny"`. This ignores every provider's native tool result format.

**Solution:** Add tool result formatting to the plugin interface:

```typescript
interface LLMProviderPlugin {
  // ... existing ...

  /**
   * Format a tool execution result into the provider's native format
   * for injection into the conversation.
   *
   * Returns a message object in the provider's expected format:
   * - Anthropic: { role: "user", content: [{ type: "tool_result", tool_use_id, content }] }
   * - OpenAI/Grok: { type: "function_call_output", call_id, output }
   * - Google: { role: "user", parts: [{ functionResponse: { name, response } }] }
   * - OpenRouter: { role: "tool", tool_call_id, content }
   */
  formatToolResult?(params: {
    toolName: string
    callId?: string
    result: string
    isError: boolean
  }): unknown

  /**
   * Format the assistant's tool-calling message for conversation continuation.
   * Ensures the assistant turn includes proper tool call metadata (IDs, etc.)
   * so the provider can match results to calls.
   */
  formatAssistantToolCallMessage?(params: {
    content: string
    toolCalls: Array<{ name: string; callId?: string; arguments: Record<string, unknown> }>
  }): unknown
}
```

### Phase 3: Call ID Tracking

**Problem:** `parseToolCalls()` currently returns `{ name, arguments }` without call IDs. This means we can't match results to specific calls, which breaks parallel tool calling for providers that require it (Anthropic `tool_use_id`, OpenAI `call_id`).

**Solution:** Extend `ToolCallRequest` to include an optional call ID:

```typescript
interface ToolCallRequest {
  name: string
  arguments: Record<string, unknown>
  callId?: string  // Provider-specific ID for result matching
}
```

Update all plugin `parseToolCalls()` implementations to extract and return call IDs. Thread the ID through tool execution so `formatToolResult()` can reference it.

### Phase 4: Remove Legacy Fallbacks

Once all plugins implement the new methods:
- Remove the hardcoded provider-specific parsing from `tool-executor.ts`
- Remove the universal XML parser from `lib/tools/xml-tool-parser.ts` (code lives in plugin-utils now)
- Remove provider-specific tool definition variants (`getOpenAIFoo`, `getAnthropicFoo`) — plugins handle conversion via `formatTools()`
- Remove the text-block tool system if all models that needed it now have native tool support via their plugins

### Phase 5: Clean Up Tool Definitions

Move tool definitions to a provider-agnostic format. Instead of each tool file exporting `getOpenAIFoo`, `getAnthropicFoo`, `getGoogleFoo`, export a single canonical definition that `formatTools()` knows how to convert.

## Files Affected

### Plugin Interface
- `lib/plugins/interfaces/provider-plugin.ts` — new methods

### Plugin Utils (shared library)
- `packages/plugin-utils/src/tools/parsers.ts` — absorb XML parser utilities
- `packages/plugin-utils/src/tools/text-parsers.ts` — new: XML/text parsing utilities for plugins
- `packages/plugin-utils/src/tools/result-formatters.ts` — new: tool result formatting per provider

### Provider Plugins (each gets new method implementations)
- `plugins/dist/qtap-plugin-openai/`
- `plugins/dist/qtap-plugin-anthropic/`
- `plugins/dist/qtap-plugin-google/`
- `plugins/dist/qtap-plugin-grok/`
- `plugins/dist/qtap-plugin-openrouter/`
- `plugins/dist/qtap-plugin-ollama/`
- `plugins/dist/qtap-plugin-openai-compatible/`

### Core (simplification/removal)
- `lib/services/chat-message/orchestrator.service.ts` — use plugin methods, remove hardcoded XML parsing
- `lib/chat/tool-executor.ts` — remove hardcoded provider fallbacks
- `lib/tools/xml-tool-parser.ts` — move to plugin-utils, remove from core
- `lib/tools/*-tool.ts` — remove provider-specific variants (Phase 5)

## Guiding Principles

- Plugins are the single source of truth for how their provider communicates
- The orchestrator coordinates the tool loop but is format-agnostic
- `plugin-utils` provides reusable building blocks; plugins compose them
- Backward compatibility: new methods are optional, old behavior is the fallback until all plugins are updated
- The text-block system (`[[TOOL_NAME]]`) remains separate — it's our own format, not a provider emission

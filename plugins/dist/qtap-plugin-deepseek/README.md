# qtap-plugin-deepseek

Quilltap provider plugin for [DeepSeek](https://www.deepseek.com) — gives Quilltap direct access to DeepSeek's V4 family (`deepseek-v4-flash` and `deepseek-v4-pro`) over DeepSeek's OpenAI-compatible Chat Completions API.

This plugin is built on the shared `OpenAICompatibleProvider` base class shipped in `@quilltap/plugin-utils`. The DeepSeek subclass extends the base to add tool forwarding, JSON response formats, and DeepSeek's prompt-cache usage reporting.

## Features

- **Chat completions** via `deepseek-v4-flash` (faster, cheaper) and `deepseek-v4-pro` (higher quality)
- **Thinking mode** on `deepseek-v4-pro` via the `thinking` and `reasoning_effort` profile parameters
- **Function / tool calling** in OpenAI-compatible format
- **JSON mode and JSON Schema** response formats
- **Prompt caching** — DeepSeek's `prompt_cache_hit_tokens` is surfaced through Quilltap's `cacheUsage` field
- **Streaming** with tool-call accumulation across deltas

## Configuration

1. Create an API key at [https://platform.deepseek.com](https://platform.deepseek.com)
2. In Quilltap, enable this plugin and add your key under the **DeepSeek** provider
3. Pick a model in a connection profile (`deepseek-v4-flash` for general work, `deepseek-v4-pro` for harder problems or to use thinking mode)

The plugin targets `https://api.deepseek.com`. No base URL configuration is required.

## Supported Models

| Model ID | Context | Max output | Tools |
| --- | --- | --- | --- |
| `deepseek-v4-flash` | 1M | 384K | ✓ |
| `deepseek-v4-pro` | 1M | 384K | ✓ |

DeepSeek does not accept image attachments and does not expose an embeddings or image-generation endpoint. Those capabilities are intentionally turned off in this plugin.

## Profile parameters

The following DeepSeek parameters can be set on a connection profile and will be forwarded verbatim:

- `frequency_penalty`
- `presence_penalty`
- `logprobs`
- `top_logprobs`
- `thinking` — enable reasoning mode. Shape: `{ "type": "enabled" }` or `{ "type": "disabled" }`.
- `reasoning_effort` — `"high"` or `"max"`. DeepSeek folds `"low"`/`"medium"` into `"high"` and `"xhigh"` into `"max"`.

When `thinking.type === "enabled"`, the plugin strips `temperature`, `top_p`, `frequency_penalty`, and `presence_penalty` from the request because DeepSeek ignores them in thinking mode.

Everything else (model, messages, max_tokens, stop, tools, tool_choice, response_format, stream) is managed by Quilltap.

## Build

This plugin ships bundled with Quilltap. Built from the top-level repo via:

```bash
npm run build:plugins
```

Or, to rebuild just this plugin from its directory:

```bash
npm install
npm run build
```

Output: `index.js` (CommonJS bundle) at the plugin root. The plugin is loaded by Quilltap via `require()`.

## License

MIT.

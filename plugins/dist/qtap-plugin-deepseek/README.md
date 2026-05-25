# qtap-plugin-deepseek

Quilltap provider plugin for [DeepSeek](https://www.deepseek.com) — gives Quilltap direct access to DeepSeek's chat (`deepseek-chat`, the V3 family) and reasoning (`deepseek-reasoner`, the R1 family) models over DeepSeek's OpenAI-compatible Chat Completions API.

This plugin is built on the shared `OpenAICompatibleProvider` base class shipped in `@quilltap/plugin-utils`. The DeepSeek subclass extends the base to add tool forwarding, JSON response formats, and DeepSeek's prompt-cache usage reporting.

## Features

- **Chat completions** via `deepseek-chat`
- **Reasoning** via `deepseek-reasoner` (R1-style chain-of-thought; reasoning is returned in the raw response under `reasoning_content`)
- **Function / tool calling** in OpenAI-compatible format
- **JSON mode and JSON Schema** response formats
- **Prompt caching** — DeepSeek's `prompt_cache_hit_tokens` is surfaced through Quilltap's `cacheUsage` field
- **Streaming** with tool-call accumulation across deltas

## Configuration

1. Create an API key at [https://platform.deepseek.com](https://platform.deepseek.com)
2. In Quilltap, enable this plugin and add your key under the **DeepSeek** provider
3. Pick a model in a connection profile (`deepseek-chat` for general work, `deepseek-reasoner` for harder reasoning)

The plugin targets `https://api.deepseek.com`. No base URL configuration is required.

## Supported Models

| Model ID | Context | Max output | Tools |
| --- | --- | --- | --- |
| `deepseek-chat` | 128K | 8K | ✓ |
| `deepseek-reasoner` | 128K | 8K | — |

DeepSeek does not accept image attachments and does not expose an embeddings or image-generation endpoint. Those capabilities are intentionally turned off in this plugin.

## Profile parameters

The following DeepSeek parameters can be set on a connection profile and will be forwarded verbatim:

- `frequency_penalty`
- `presence_penalty`
- `logprobs`
- `top_logprobs`

Everything else (model, messages, temperature, max_tokens, top_p, stop, tools, tool_choice, response_format, stream) is managed by Quilltap.

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

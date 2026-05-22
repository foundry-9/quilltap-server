# qtap-plugin-z-ai

Quilltap provider plugin for Z.AI — gives Quilltap direct access to Z.AI's GLM model family (chat, vision, tool use, web search) and CogView / GLM-Image image generation.

## Features

- **Chat completions** via GLM-4.6, GLM-4.5, GLM-4.5-Air/-AirX/-X/-Flash, and GLM-4-32B-0414-128K
- **Vision** via GLM-4.5V and GLM-4.6V (images as URL or base64, OpenAI-style `image_url` parts)
- **Tool / function calling** in OpenAI-compatible format
- **Native web search** via Z.AI's `web_search` tool (enabled per-request with `webSearchEnabled: true`)
- **Image generation** via CogView-4 and GLM-Image
- **Streaming** responses with tool-call accumulation

## Configuration

1. Create an API key at [https://z.ai](https://z.ai) (or <https://open.bigmodel.cn> for the mainland China endpoint — currently not configurable here)
2. In Quilltap, install this plugin and add your key under the **Z.AI (GLM)** provider

The plugin targets `https://api.z.ai/api/paas/v4`. No base URL configuration is required.

## Supported Models

### Text

| Model ID | Context | Tools |
| --- | --- | --- |
| `glm-4.6` | 200K | ✓ |
| `glm-4.5` | 128K | ✓ |
| `glm-4.5-x` | 128K | ✓ |
| `glm-4.5-air` | 128K | ✓ |
| `glm-4.5-airx` | 128K | ✓ |
| `glm-4.5-flash` | 128K | ✓ |
| `glm-4-32b-0414-128k` | 128K | ✓ |

### Vision

| Model ID | Context | Images |
| --- | --- | --- |
| `glm-4.6v` | 64K | ✓ |
| `glm-4.6v-flashx` | 64K | ✓ |
| `glm-4.6v-flash` | 64K | ✓ |
| `glm-5v-turbo` | 64K | ✓ |
| `glm-4.5v` | 64K | ✓ |

Attachment limits: 5 MB per image, max 6000×6000 px, MIME types `image/jpeg`, `image/png`, `image/gif`, `image/webp`.

### Image generation

| Model ID | Notes |
| --- | --- |
| `cogview-4-250304` | 512–2048 px, divisible by 16 |
| `glm-image` | 1024–2048 px, divisible by 32; `hd` default |

## Web search

Enable per-request:

```ts
await provider.sendMessage({
  model: 'glm-4.5',
  messages: [{ role: 'user', content: 'What are the latest AI developments?' }],
  webSearchEnabled: true,
}, apiKey);
```

The plugin adds Z.AI's native `web_search` tool alongside any function tools you supply. You do not need to define a `web_search` function yourself.

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

MIT — see LICENSE.

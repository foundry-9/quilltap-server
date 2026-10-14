# OpenAI Provider Plugin for Quilltap

This plugin provides integration with OpenAI's API, enabling Quilltap to use GPT models for chat completions and the GPT Image and DALL-E families for image generation.

## Features

- **Chat Completions**: Access to GPT-4, GPT-4o, GPT-3.5 Turbo, and other OpenAI models
- **Vision Capabilities**: Analyze images with vision-enabled models (GPT-4V, GPT-4o)
- **Image Generation**: Create images using the GPT Image families (2.5 Sunburst/Flare, 2, 1.5, 1, 1-mini) or the legacy DALL-E 2 / DALL-E 3
- **Function Calling**: Use tools and function calling for structured outputs
- **Web Search**: Native web search integration with search-capable models
- **Streaming**: Support for streaming responses for real-time chat

## Installation

The plugin is included with Quilltap. To ensure you have the latest version of the OpenAI SDK:

```bash
npm install openai@latest
```

## Configuration

### API Key Setup

1. Create an OpenAI account at https://platform.openai.com
2. Generate an API key from the API Keys section
3. In Quilltap settings, add your API key under the OpenAI provider configuration

### Required Permissions

This plugin requires the following:
- Network access to `api.openai.com`
- A valid OpenAI API account with billing enabled

## Supported Models

### Chat Completion Models

| Model | Context Window | Supports Vision | Supports Tools |
|-------|---|---|---|
| gpt-4o | 128K | Yes | Yes |
| gpt-4-turbo | 128K | Yes | Yes |
| gpt-4 | 8K | No | Yes |
| gpt-3.5-turbo | 4K | No | Yes |

**Note**: The exact available models depend on your OpenAI account access and may change over time. Use the "Fetch Available Models" feature in Quilltap to see your accessible models.

### Image Generation Models

- **gpt-image-2.5-sunburst**: Premium tier — highest quality, best at precise editing
- **gpt-image-2.5-flare**: Speed tier — GPT Image 2 quality at roughly half the latency, and cheaper
- **gpt-image-2**: Previous flagship
- **gpt-image-1.5**, **gpt-image-1**, **gpt-image-1-mini**: Earlier GPT Image generations
- **dall-e-3**: Legacy; high quality, improved prompt following
- **dall-e-2**: Legacy; stable, widely available

Dated snapshots (`gpt-image-2.5-flare-2026-09-08`, `gpt-image-2-2026-04-21`, …) resolve to their
family's capabilities by longest-prefix match. The per-family table is
[`image-models.ts`](./image-models.ts) — the wire logic, the host's model declarations and the
profile-editor schema all read from it.

#### Size Support by Model

**gpt-image-2.5-sunburst**, **gpt-image-2.5-flare**, **gpt-image-2**:
- Any `WIDTHxHEIGHT` with both edges divisible by 16, aspect ratio between 1:3 and 3:1, no edge
  over 3840px, and within the 3840x2160 pixel budget. Above 2560x1440 is experimental.
- `auto`, plus the standard 1024x1024 / 1024x1536 / 1536x1024

**gpt-image-1.5**, **gpt-image-1**, **gpt-image-1-mini**:
- 1024x1024
- 1024x1536
- 1536x1024
- auto

**dall-e-3**:
- 1024x1024
- 1024x1792
- 1792x1024

**dall-e-2**:
- 256x256
- 512x512
- 1024x1024

#### Quality Tiers by Model

| Model | Tiers |
|---|---|
| gpt-image-2.5-sunburst, gpt-image-2.5-flare | auto, low, medium, high, **xhigh**, **max** |
| gpt-image-2, gpt-image-1.5, gpt-image-1, gpt-image-1-mini | auto, low, medium, high |
| dall-e-3 | standard, hd |
| dall-e-2 | standard |

## File Attachment Support

The plugin supports image attachments for vision-capable models:

### Supported MIME Types
- image/jpeg
- image/png
- image/gif
- image/webp

### Supported Models
- GPT-4V
- GPT-4o
- GPT-4 Turbo

Images are automatically encoded to base64 and sent with your message for analysis.

## Parameters

### Chat Completion Parameters

- **model**: The model to use (e.g., 'gpt-4o', 'gpt-3.5-turbo')
- **temperature**: Randomness of responses (0-2, default: 1)
- **maxTokens**: Maximum response length
- **topP**: Diversity parameter (0-1, default: 1)
- **tools**: Function definitions for tool use
- **webSearchEnabled**: Enable web search (requires search-capable model)

### Image Generation Parameters

Read off `ImageGenParams`:

- **model**: Image model (see *Image Generation Models* above)
- **prompt**: Text description of the image
- **size**: Image dimensions (varies by model; see above)
- **quality**: The selected model's tier (see above)
- **style**: 'vivid' or 'natural' (DALL-E 3 only)
- **n**: Number of images to generate (1-10; DALL-E 3 caps at 1)

Read off `ImageGenParams.profileParameters`, under their OpenAI wire names, and sent only to the
GPT Image families:

- **background**: 'auto', 'opaque' or 'transparent'. Transparent requires a `png` or `webp` output
  format; asking for it with `jpeg` switches the format to `png`.
- **output_format**: 'png', 'jpeg' or 'webp'. Also determines the returned image's `mimeType`.
- **output_compression**: 0-100, applied only for `webp` and `jpeg`; dropped for `png`.
- **moderation**: 'auto' or 'low'. Less restrictive, not off.

A parameter the selected model does not accept is dropped with a warning rather than forwarded —
the Images API rejects the whole request over one unknown value. An unusable size is the exception:
it falls back to `1024x1024`, since the request needs some dimensions.

## Web Search

The plugin supports native web search with compatible models:

- **gpt-4o-search-preview**: GPT-4o with web search
- **gpt-4o-mini-search-preview**: GPT-4o mini with web search

Enable the `webSearchEnabled` parameter when using these models to include real-time web results in responses.

## Logging

The plugin includes comprehensive debug logging for all operations:

- API calls and responses
- Stream processing
- Tool/function calls
- Image generation
- API key validation
- Error handling

Set `LOG_LEVEL=debug` to see detailed operation logs.

## Pricing & Rate Limits

Refer to the OpenAI documentation for current pricing and rate limits:
https://platform.openai.com/pricing

The plugin respects OpenAI's:
- Rate limiting (429 responses)
- Token limits per model
- Concurrent request limits

## Error Handling

The plugin provides detailed error messages for:
- Invalid API keys
- Unsupported file types
- Unsupported model parameters
- API errors and rate limiting

## Examples

### Basic Chat

```typescript
const response = await provider.sendMessage({
  messages: [
    { role: 'user', content: 'Hello, how are you?' }
  ],
  model: 'gpt-4o',
}, apiKey);
```

### Vision Analysis

```typescript
const response = await provider.sendMessage({
  messages: [
    {
      role: 'user',
      content: 'Describe this image',
      attachments: [
        {
          id: 'img1',
          filepath: '/path/to/image.jpg',
          filename: 'image.jpg',
          mimeType: 'image/jpeg',
          size: 1024,
          data: 'base64encodeddata...'
        }
      ]
    }
  ],
  model: 'gpt-4o',
}, apiKey);
```

### Image Generation

```typescript
const result = await provider.generateImage({
  prompt: 'A serene mountain landscape at sunset',
  model: 'gpt-image-2.5-sunburst',
  size: '1536x864',
  quality: 'max',
  profileParameters: { output_format: 'webp', output_compression: 90 },
}, apiKey);
```

### Streaming

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'gpt-4o',
}, apiKey)) {
  console.log(chunk.content);
}
```

## Troubleshooting

### Invalid API Key
- Verify the key is correct from https://platform.openai.com/api-keys
- Ensure the key has not expired
- Check that billing is enabled on your OpenAI account

### No Models Available
- Ensure your API key has access to the models
- Check that your account is not in a restricted region
- Some models may require specific account tier

### Image Generation Fails
- Verify the model supports the requested size
- Ensure the prompt is not too long or violates content policy
- Check that your account has image generation enabled

### Slow Responses
- Check OpenAI status page: https://status.openai.com
- Verify network connection
- Check rate limiting (429 errors)
- Consider using a faster model like gpt-3.5-turbo

## Support

For issues with the plugin, refer to:
- Quilltap GitHub: https://github.com/foundry-9/F9-Quilltap
- OpenAI Documentation: https://platform.openai.com/docs
- OpenAI Community: https://community.openai.com

## License

MIT License - See LICENSE file for details

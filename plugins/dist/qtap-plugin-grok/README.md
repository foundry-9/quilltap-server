# Grok Provider Plugin for Quilltap

This plugin provides integration with xAI's Grok API, enabling Quilltap to use Grok models for chat completions and image generation.

## Features

- **Chat Completions**: Access to Grok 4, Grok 3, and other Grok models via the Responses API
- **Vision Capabilities**: Analyze images with vision-enabled models
- **Image Generation**: Create images using Grok Imagine models (grok-imagine-image, grok-imagine-image-pro)
- **Function Calling**: Use tools and function calling for structured outputs
- **Web Search**: Server-side web search with `web_search` and `x_search` tools
- **Streaming**: Support for streaming responses for real-time chat

## Installation

The plugin is included with Quilltap. To ensure you have the latest version of the OpenAI SDK (used for image generation and model listing):

```bash
npm install openai@latest
```

## Configuration

### API Key Setup

1. Create a Grok account at https://console.x.ai
2. Generate an API key from the API Keys section
3. In Quilltap settings, add your API key under the Grok provider configuration

### Required Permissions

This plugin requires the following:
- Network access to `api.x.ai`
- A valid Grok API account with billing enabled

## Supported Models

### Chat Completion Models

| Model | Context Window | Supports Vision | Supports Tools |
|-------|----------------|-----------------|----------------|
| grok-4 | 128K | Yes | Yes |
| grok-4-1-fast | 2M | Yes | Yes |
| grok-3 | 128K | Yes | Yes |
| grok-3-mini | 128K | Yes | Yes |
| grok-2-1212 | 128K | Yes | Yes |
| grok-code-fast-1 | 256K | No | Yes |

### Image Generation Models

| Model | Quality | Resolution | Rate Limit |
|-------|---------|------------|------------|
| grok-imagine-image | Standard | 1K | 300 RPM |
| grok-imagine-image-pro | High | 2K | 30 RPM |
| grok-2-image | Legacy (deprecated) | — | — |

### Recommended Models by Use Case

- **General chat**: grok-3 or grok-4
- **Background tasks**: grok-3-mini (default cheap model)
- **Fast responses**: grok-4-1-fast
- **Code tasks**: grok-code-fast-1
- **Long context**: grok-4-1-fast (2M context window)
- **Image generation**: grok-imagine-image (standard) or grok-imagine-image-pro (high quality)

## File Attachment Support

The plugin supports image attachments for vision-capable models:

### Supported MIME Types
- image/jpeg
- image/png
- image/gif
- image/webp

Images are automatically encoded to base64 and sent with your message for analysis using the Responses API `input_image` format.

## Parameters

### Chat Completion Parameters

- **model**: The model to use (e.g., 'grok-4', 'grok-3-mini')
- **temperature**: Randomness of responses (0-2, default: 0.7)
- **maxTokens**: Maximum response length (default: 4096)
- **topP**: Diversity parameter (0-1, default: 1)
- **tools**: Function definitions for tool use
- **webSearchEnabled**: Enable server-side web search

### Image Generation Parameters

- **model**: Image model ('grok-imagine-image', 'grok-imagine-image-pro', or legacy 'grok-2-image')
- **prompt**: Text description of the image (up to ~8000 characters for Imagine models)
- **n**: Number of images to generate (1-10)
- **aspectRatio**: Aspect ratio for generated images ('1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '2:1', '1:2', '19.5:9', '9:19.5', '20:9', '9:20')
- **resolution**: Automatically set to '2k' for grok-imagine-image-pro

## Web Search

The plugin supports server-side web search using xAI's Responses API tools:

### Server-Side Tools

When `webSearchEnabled` is true, the plugin adds two server-side tools:
- **web_search**: Searches the general web
- **x_search**: Searches X/Twitter

The model decides when to use these tools based on the query. Results include inline citations when available.

### Important Notes

- Server-side web search tools work alongside client-side function calling
- Citations are automatically included in responses when web search is used
- The `store: false` parameter ensures Quilltap manages conversation history locally

## API Details

This plugin uses xAI's **Responses API** (`/v1/responses`) for chat completions, which is the recommended API for new development. The Chat Completions API is deprecated.

Key differences from Chat Completions:
- Uses `input` array instead of `messages`
- Image format is `input_image` instead of `image_url`
- Web search uses server-side tools instead of `search_parameters`
- Response format uses `output` array with structured items

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

Refer to the Grok documentation for current pricing and rate limits:
https://console.x.ai/docs

The plugin respects Grok's:
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
  model: 'grok-3',
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
  model: 'grok-4',
}, apiKey);
```

### Image Generation

```typescript
const result = await provider.generateImage({
  prompt: 'A futuristic city at night',
  model: 'grok-imagine-image',
  aspectRatio: '16:9',
}, apiKey);
```

### Web Search

```typescript
const response = await provider.sendMessage({
  messages: [{ role: 'user', content: 'What are the latest AI developments?' }],
  model: 'grok-3',
  webSearchEnabled: true,
}, apiKey);
```

### Streaming

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'grok-4',
}, apiKey)) {
  console.log(chunk.content);
}
```

## Troubleshooting

### Invalid API Key
- Verify the key is correct from https://console.x.ai
- Ensure the key has not expired
- Check that billing is enabled on your Grok account

### No Models Available
- Ensure your API key has access to the models
- Check that your account is not in a restricted region
- Some models may require specific account tier

### Image Generation Fails
- Use 'grok-imagine-image' or 'grok-imagine-image-pro' (grok-2-image is deprecated)
- Ensure the prompt is within limits (~8000 chars for Imagine models) and doesn't violate content policy
- Check that your account has image generation enabled
- Note: grok-imagine-image-pro has a lower rate limit (30 RPM vs 300 RPM)

### Slow Responses
- Check Grok status page: https://console.x.ai/status
- Verify network connection
- Check rate limiting (429 errors)

### Web Search Not Working
- Ensure `webSearchEnabled: true` is set
- Server-side tools require supported models (grok-3, grok-4)
- Check that the query is appropriate for web search

## Support

For issues with the plugin, refer to:
- Quilltap GitHub: https://github.com/foundry-9/F9-Quilltap
- Grok Documentation: https://console.x.ai/docs
- xAI Support: https://support.x.ai

## License

MIT License - See LICENSE file for details

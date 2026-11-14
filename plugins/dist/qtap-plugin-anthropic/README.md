# Anthropic Provider Plugin for Quilltap

This plugin provides integration with Anthropic's API, enabling Quilltap to use Claude models for chat completions with support for image and PDF analysis.

## Features

- **Chat Completions**: Access to Claude Sonnet, Opus, and Haiku models
- **Vision Capabilities**: Analyze images with all Claude models
- **PDF Support**: Analyze PDF documents
- **Function Calling**: Use tools and function calling for structured outputs
- **Streaming**: Support for streaming responses for real-time chat

## Installation

The plugin is included with Quilltap. To ensure you have the latest version of the Anthropic SDK:

```bash
npm install @anthropic-ai/sdk@latest
```

## Configuration

### API Key Setup

1. Create an Anthropic account at https://console.anthropic.com
2. Generate an API key from the API Keys section
3. In Quilltap settings, add your API key under the Anthropic provider configuration

### Required Permissions

This plugin requires the following:
- Network access to `api.anthropic.com`
- A valid Anthropic API account with billing enabled

## Supported Models

The plugin carries no list of models. Anthropic gives every model a pinned ID that eventually retires, and has no name that always points to the newest release, so any list written here would go stale. Everything comes from Anthropic's live Models API instead:

- **Model picker** — every active and deprecated model your key can use.
- **Background ("cheap") model** — the newest active model in the Haiku line, looked up at run time and cached by Quilltap.
- **Thinking** — whether a model takes a fixed thinking budget or adaptive thinking is read from the model's reported capabilities.
- **Key check** — lists one model rather than calling a named one.

## File Attachment Support

The plugin supports image and PDF attachments for all Claude models:

### Supported MIME Types
- image/jpeg
- image/png
- image/gif
- image/webp
- application/pdf

Every current Claude model accepts images and PDFs.

Images and PDFs are automatically encoded to base64 and sent with your message for analysis.

## Parameters

### Chat Completion Parameters

- **model**: The model to use — any ID from the live model list
- **maxTokens**: Maximum response length
- **tools**: Function definitions for tool use
- **stop**: Stop sequences

`temperature`, `topP` and `topK` are not sent. The plugin uses the SDK's default API version (2026-10-21), which rejects them on every model, and declares `samplingParameters: false` so Quilltap hides them in the profile editor.

## Logging

The plugin includes comprehensive debug logging for all operations:

- API calls and responses
- Stream processing
- Tool/function calls
- Image and PDF attachment handling
- API key validation
- Error handling

Set `LOG_LEVEL=debug` to see detailed operation logs.

## Pricing & Rate Limits

Refer to the Anthropic documentation for current pricing and rate limits:
https://www.anthropic.com/pricing

The plugin respects Anthropic's:
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
  model: 'claude-sonnet-5-5', // any ID from the live model list
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
  model: 'claude-sonnet-5-5', // any ID from the live model list
}, apiKey);
```

### PDF Analysis

```typescript
const response = await provider.sendMessage({
  messages: [
    {
      role: 'user',
      content: 'Summarize this document',
      attachments: [
        {
          id: 'pdf1',
          filepath: '/path/to/document.pdf',
          filename: 'document.pdf',
          mimeType: 'application/pdf',
          size: 5024,
          data: 'base64encodeddata...'
        }
      ]
    }
  ],
  model: 'claude-sonnet-5-5', // any ID from the live model list
}, apiKey);
```

### Streaming

```typescript
for await (const chunk of provider.streamMessage({
  messages: [{ role: 'user', content: 'Tell me a story' }],
  model: 'claude-sonnet-5-5', // any ID from the live model list
}, apiKey)) {
  console.log(chunk.content);
}
```

### System Prompts

```typescript
const response = await provider.sendMessage({
  messages: [
    {
      role: 'system',
      content: 'You are a helpful assistant specializing in technical writing.'
    },
    {
      role: 'user',
      content: 'Explain quantum computing to a beginner'
    }
  ],
  model: 'claude-sonnet-5-5', // any ID from the live model list
}, apiKey);
```

## Troubleshooting

### Invalid API Key
- Verify the key is correct from https://console.anthropic.com/account/keys
- Ensure the key has not expired
- Check that billing is enabled on your Anthropic account

### No Models Available
- Ensure your API key has access to the models
- Check that your account is not in a restricted region
- Some models may require specific account tier

### Attachment Processing Fails
- Verify the file is in a supported MIME type
- Check that the file data is properly encoded in base64
- Ensure the file is not corrupted

### Slow Responses
- Check Anthropic status page: https://status.anthropic.com
- Verify network connection
- Check rate limiting (429 errors)
- Consider using a faster model from the Haiku line

## Support

For issues with the plugin, refer to:
- Quilltap GitHub: https://github.com/foundry-9/F9-Quilltap
- Anthropic Documentation: https://docs.anthropic.com
- Anthropic Support: https://support.anthropic.com

## License

MIT License - See LICENSE file for details

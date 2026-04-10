# @quilltap/plugin-types

Type definitions for building Quilltap plugins.

## Installation

```bash
npm install --save-dev @quilltap/plugin-types
```

## Usage

### Basic Plugin

```typescript
import type {
  LLMProviderPlugin,
  LLMProvider,
  LLMParams,
  LLMResponse
} from '@quilltap/plugin-types';

export const plugin: LLMProviderPlugin = {
  metadata: {
    providerName: 'MY_PROVIDER',
    displayName: 'My Provider',
    description: 'A custom LLM provider',
    abbreviation: 'MYP',
    colors: {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      icon: 'text-blue-600',
    },
  },
  config: {
    // Setting requiresApiKey: true adds this provider to the API Keys dropdown
    // in Settings, allowing users to store API keys for your provider
    requiresApiKey: true,
    requiresBaseUrl: false,
    apiKeyLabel: 'API Key',
  },
  capabilities: {
    chat: true,
    imageGeneration: false,
    embeddings: false,
    webSearch: false,
  },
  attachmentSupport: {
    supportsAttachments: false,
    supportedMimeTypes: [],
    description: 'No file attachments supported',
  },
  createProvider: () => new MyProvider(),
  getAvailableModels: async (apiKey) => ['model-1', 'model-2'],
  validateApiKey: async (apiKey) => true,
  renderIcon: ({ className }) => <MyIcon className={className} />,
};
```

### Submodule Imports

You can import from specific submodules for more granular imports:

```typescript
// LLM types only
import type { LLMProvider, LLMParams, LLMResponse } from '@quilltap/plugin-types/llm';

// Plugin types only
import type { LLMProviderPlugin, PluginManifest } from '@quilltap/plugin-types/plugins';

// Common utilities
import { createConsoleLogger, PluginError } from '@quilltap/plugin-types/common';
```

### Error Handling

The package provides standard error classes for consistent error handling:

```typescript
import {
  PluginError,
  ApiKeyError,
  ProviderApiError,
  RateLimitError
} from '@quilltap/plugin-types';

// Throwing errors
throw new ApiKeyError('Invalid API key', 'my-plugin');
throw new RateLimitError('Rate limited', 60, 'my-plugin');

// Catching errors
try {
  await provider.sendMessage(params, apiKey);
} catch (error) {
  if (error instanceof RateLimitError) {
    console.log(`Retry after ${error.retryAfter} seconds`);
  } else if (error instanceof ProviderApiError) {
    console.log(`API error: ${error.statusCode}`);
  }
}
```

### Logging

Use the built-in logger for development:

```typescript
import { createConsoleLogger } from '@quilltap/plugin-types';

const logger = createConsoleLogger('my-plugin', 'debug');

logger.debug('Initializing plugin', { version: '1.0.0' });
logger.info('Plugin ready');
logger.warn('Deprecated feature used');
logger.error('Failed to connect', { endpoint: 'api.example.com' }, error);
```

## Type Reference

### LLM Types

| Type | Description |
|------|-------------|
| `LLMProvider` | Core provider interface |
| `LLMParams` | Request parameters |
| `LLMResponse` | Complete response |
| `StreamChunk` | Streaming response chunk |
| `LLMMessage` | Conversation message |
| `FileAttachment` | File attachment for multimodal |
| `ToolCall` | Tool/function call |
| `ImageGenParams` | Image generation parameters |
| `ImageGenResponse` | Image generation response |

### Plugin Types

| Type | Description |
|------|-------------|
| `LLMProviderPlugin` | Main plugin interface |
| `ProviderMetadata` | UI display metadata |
| `ProviderCapabilities` | Capability flags |
| `AttachmentSupport` | File attachment config |
| `PluginManifest` | Plugin manifest schema |
| `SystemPromptPlugin` | System prompt plugin interface |
| `SystemPromptData` | Individual prompt entry |
| `SystemPromptMetadata` | System prompt plugin metadata |
### Common Types

| Type | Description |
|------|-------------|
| `PluginLogger` | Logger interface |
| `LogLevel` | Log level type |
| `PluginError` | Base error class |
| `ApiKeyError` | API key validation error |
| `ProviderApiError` | Provider API error |
| `RateLimitError` | Rate limit error |

## Plugin Manifest

Every Quilltap plugin needs a `quilltap-manifest.json` file:

```json
{
  "$schema": "https://quilltap.io/schemas/plugin-manifest.json",
  "name": "qtap-plugin-my-provider",
  "title": "My Provider",
  "description": "A custom LLM provider for Quilltap",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "license": "MIT",
  "compatibility": {
    "quilltapVersion": ">=1.7.0"
  },
  "capabilities": ["LLM_PROVIDER"],
  "category": "PROVIDER",
  "main": "dist/index.js",
  "status": "STABLE"
}
```

## Documentation

- [Plugin Development Guide](https://docs.quilltap.io/plugins/development)
- [API Reference](https://docs.quilltap.io/plugins/api)
- [Example Plugins](https://github.com/foundry-9/quilltap-server/tree/main/plugins/dist)

## License

MIT

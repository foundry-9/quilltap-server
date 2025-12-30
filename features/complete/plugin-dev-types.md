# Feature Request: Extract and Publish `@quilltap/plugin-types` Package

## Overview

Extract all plugin-related TypeScript type definitions from the Quilltap core into a separate npm package (`@quilltap/plugin-types`) that can be published independently. This enables third-party developers to create Quilltap plugins without needing access to the Quilltap source tree.

## Goals

- Enable standalone plugin development outside the Quilltap monorepo
- Allow plugins to be published to npm as `qtap-plugin-*` packages
- Provide stable, versioned type definitions for plugin authors
- Maintain backward compatibility as the plugin API evolves
- Support the dynamic plugin installation feature (npm-based plugin marketplace)

## Current State

Plugins currently import types directly from the Quilltap source tree:

````typescript
// Current approach - requires source tree access
import type { LLMProvider, LLMParams, LLMResponse } from '../../../lib/llm/base';
import type { LLMProviderPlugin } from '../../../lib/plugins/interfaces/provider-plugin';
import { parseOpenAIToolCalls } from '../../../lib/llm/tool-formatting-utils';
import { logger } from '../../../lib/logger';
````

## Proposed Solution

Create a separate package that exports all types needed for plugin development:

````typescript
// New approach - works for standalone plugins
import type { 
  LLMProvider, 
  LLMParams, 
  LLMResponse,
  LLMProviderPlugin 
} from '@quilltap/plugin-types';
````

## Package Structure

````text
packages/
└── plugin-types/
    ├── package.json
    ├── tsconfig.json
    ├── README.md
    ├── CHANGELOG.md
    └── src/
        ├── index.ts              # Main export barrel
        ├── llm/
        │   ├── index.ts
        │   ├── base.ts           # LLMProvider, LLMParams, LLMResponse, etc.
        │   ├── messages.ts       # LLMMessage, FileAttachment, etc.
        │   └── tools.ts          # Tool definitions and parsing types
        ├── plugins/
        │   ├── index.ts
        │   ├── provider.ts       # LLMProviderPlugin interface
        │   ├── auth.ts           # AuthProviderPlugin interface (future)
        │   ├── storage.ts        # StoragePlugin interface (future)
        │   └── manifest.ts       # Plugin manifest types
        └── common/
            ├── index.ts
            ├── errors.ts         # Standard plugin error types
            └── logger.ts         # Logger interface (optional injection)
````

## Type Definitions to Include

### Core LLM Types (`src/llm/base.ts`)

````typescript
/**
 * File attachment for multimodal messages
 */
export interface FileAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  data?: string;        // Base64 encoded data
  url?: string;         // URL to fetch the file
  metadata?: Record<string, unknown>;
}

/**
 * Message in a conversation
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  attachments?: FileAttachment[];
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

/**
 * Parameters for LLM requests
 */
export interface LLMParams {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string | string[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  responseFormat?: { type: 'text' | 'json_object' };
  seed?: number;
  user?: string;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/**
 * Attachment processing results
 */
export interface AttachmentResults {
  sent: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * Response from LLM
 */
export interface LLMResponse {
  content: string;
  finishReason: string | null;
  usage: TokenUsage;
  raw?: unknown;
  toolCalls?: ToolCall[];
  attachmentResults?: AttachmentResults;
}

/**
 * Streaming chunk from LLM
 */
export interface StreamChunk {
  content: string;
  done: boolean;
  usage?: TokenUsage;
  toolCalls?: ToolCall[];
  attachmentResults?: AttachmentResults;
}

/**
 * Image generation parameters
 */
export interface ImageGenParams {
  prompt: string;
  model?: string;
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  n?: number;
  responseFormat?: 'url' | 'b64_json';
}

/**
 * Generated image result
 */
export interface GeneratedImage {
  url?: string;
  b64Json?: string;
  revisedPrompt?: string;
}

/**
 * Image generation response
 */
export interface ImageGenResponse {
  images: GeneratedImage[];
  raw?: unknown;
}

/**
 * Core LLM provider interface
 */
export interface LLMProvider {
  readonly supportsFileAttachments: boolean;
  readonly supportedMimeTypes: string[];
  readonly supportsImageGeneration: boolean;
  readonly supportsWebSearch: boolean;

  sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse>;
  streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk>;
  validateApiKey(apiKey: string): Promise<boolean>;
  getAvailableModels(apiKey: string): Promise<string[]>;
  generateImage?(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>;
}
````

### Tool Types (`src/llm/tools.ts`)

````typescript
/**
 * OpenAI-format tool definition
 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
    strict?: boolean;
  };
}

/**
 * Anthropic-format tool definition
 */
export interface AnthropicToolDefinition {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool call from assistant response
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Parsed tool call request
 */
export interface ToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Tool result to send back
 */
export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}
````

### Plugin Interface Types (`src/plugins/provider.ts`)

````typescript
import type { ReactNode } from 'react';
import type { LLMProvider, OpenAIToolDefinition, ToolCallRequest } from '../llm';

/**
 * Provider display metadata
 */
export interface ProviderMetadata {
  providerName: string;
  displayName: string;
  description: string;
  abbreviation: string;
  colors: {
    bg: string;
    text: string;
    icon: string;
  };
}

/**
 * Provider configuration requirements
 */
export interface ProviderConfigRequirements {
  requiresApiKey: boolean;
  requiresBaseUrl: boolean;
  apiKeyLabel?: string;
  baseUrlLabel?: string;
  baseUrlPlaceholder?: string;
  defaultBaseUrl?: string;
}

/**
 * Provider capability flags
 */
export interface ProviderCapabilities {
  chat: boolean;
  imageGeneration: boolean;
  embeddings: boolean;
  webSearch: boolean;
}

/**
 * Attachment support configuration
 */
export interface AttachmentSupport {
  supportsAttachments: boolean;
  supportedMimeTypes: string[];
  maxFileSize?: number;
  maxFiles?: number;
  description: string;
  notes?: string;
}

/**
 * Static model information
 */
export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsImages: boolean;
  supportsTools: boolean;
  description?: string;
  pricing?: {
    input: number;   // per 1M tokens
    output: number;  // per 1M tokens
  };
}

/**
 * Icon component props
 */
export interface IconProps {
  className?: string;
}

/**
 * Main LLM provider plugin interface
 */
export interface LLMProviderPlugin {
  /** Provider display metadata */
  metadata: ProviderMetadata;

  /** Configuration requirements */
  config: ProviderConfigRequirements;

  /** Capability flags */
  capabilities: ProviderCapabilities;

  /** Attachment support details */
  attachmentSupport: AttachmentSupport;

  /**
   * Factory method to create a provider instance
   * @param baseUrl Optional custom base URL
   */
  createProvider(baseUrl?: string): LLMProvider;

  /**
   * Fetch available models from the provider API
   * @param apiKey API key for authentication
   * @param baseUrl Optional custom base URL
   */
  getAvailableModels(apiKey: string, baseUrl?: string): Promise<string[]>;

  /**
   * Validate an API key
   * @param apiKey API key to validate
   * @param baseUrl Optional custom base URL
   */
  validateApiKey(apiKey: string, baseUrl?: string): Promise<boolean>;

  /**
   * Get static model information (no API call required)
   */
  getModelInfo(): ModelInfo[];

  /**
   * Render the provider icon
   * @param props Icon component props
   */
  renderIcon(props: IconProps): ReactNode;

  /**
   * Format tools for this provider's API format
   * @param tools Tools in OpenAI format
   */
  formatTools?(tools: (OpenAIToolDefinition | Record<string, unknown>)[]): unknown[];

  /**
   * Parse tool calls from provider response
   * @param response Raw API response
   */
  parseToolCalls?(response: unknown): ToolCallRequest[];
}
````

### Plugin Manifest Types (`src/plugins/manifest.ts`)

````typescript
/**
 * Plugin capability types
 */
export type PluginCapability = 
  | 'LLM_PROVIDER'
  | 'AUTH_PROVIDER'
  | 'STORAGE_BACKEND'
  | 'THEME'
  | 'UTILITY';

/**
 * Plugin category
 */
export type PluginCategory = 
  | 'PROVIDER'
  | 'AUTH'
  | 'STORAGE'
  | 'UI'
  | 'UTILITY';

/**
 * Plugin status
 */
export type PluginStatus = 
  | 'STABLE'
  | 'BETA'
  | 'EXPERIMENTAL'
  | 'DEPRECATED';

/**
 * Plugin manifest schema
 */
export interface PluginManifest {
  /** JSON schema reference */
  $schema?: string;

  /** Package name (must start with qtap-plugin-) */
  name: string;

  /** Human-readable title */
  title: string;

  /** Plugin description */
  description: string;

  /** Semantic version */
  version: string;

  /** Author information */
  author: {
    name: string;
    email?: string;
    url?: string;
  };

  /** License identifier */
  license: string;

  /** Compatibility requirements */
  compatibility: {
    quilltapVersion: string;
    nodeVersion?: string;
  };

  /** Plugin capabilities */
  capabilities: PluginCapability[];

  /** Plugin category */
  category: PluginCategory;

  /** Main entry point */
  main: string;

  /** TypeScript source available */
  typescript?: boolean;

  /** Frontend framework */
  frontend?: 'REACT' | 'NONE';

  /** Styling approach */
  styling?: 'TAILWIND' | 'CSS' | 'NONE';

  /** Enable by default */
  enabledByDefault?: boolean;

  /** Plugin status */
  status: PluginStatus;

  /** Search keywords */
  keywords?: string[];

  /** Provider-specific configuration (for LLM_PROVIDER plugins) */
  providerConfig?: {
    providerName: string;
    displayName: string;
    description: string;
    abbreviation: string;
    colors: {
      bg: string;
      text: string;
      icon: string;
    };
    requiresApiKey: boolean;
    requiresBaseUrl: boolean;
    apiKeyLabel?: string;
    capabilities: {
      chat: boolean;
      imageGeneration: boolean;
      embeddings: boolean;
      webSearch: boolean;
    };
    attachmentSupport: {
      supported: boolean;
      mimeTypes: string[];
      description: string;
    };
  };

  /** Required permissions */
  permissions?: {
    network?: string[];
    userData?: boolean;
    database?: boolean;
    fileSystem?: boolean;
  };
}
````

### Common Types (`src/common/`)

````typescript
// src/common/errors.ts

/**
 * Base plugin error
 */
export class PluginError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly pluginName?: string
  ) {
    super(message);
    this.name = 'PluginError';
  }
}

/**
 * API key validation error
 */
export class ApiKeyError extends PluginError {
  constructor(message: string, pluginName?: string) {
    super(message, 'API_KEY_ERROR', pluginName);
    this.name = 'ApiKeyError';
  }
}

/**
 * Provider API error
 */
export class ProviderApiError extends PluginError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly response?: unknown,
    pluginName?: string
  ) {
    super(message, 'PROVIDER_API_ERROR', pluginName);
    this.name = 'ProviderApiError';
  }
}

/**
 * Rate limit error
 */
export class RateLimitError extends ProviderApiError {
  constructor(
    message: string,
    public readonly retryAfter?: number,
    pluginName?: string
  ) {
    super(message, 429, undefined, pluginName);
    this.name = 'RateLimitError';
    this.code = 'RATE_LIMIT_ERROR';
  }
}
````

````typescript
// src/common/logger.ts

/**
 * Log level type
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log context metadata
 */
export interface LogContext {
  context?: string;
  [key: string]: unknown;
}

/**
 * Logger interface that plugins can implement or receive
 */
export interface PluginLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext, error?: Error): void;
}

/**
 * Simple console-based logger for standalone plugin development
 */
export function createConsoleLogger(prefix: string, minLevel: LogLevel = 'info'): PluginLogger {
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const shouldLog = (level: LogLevel) => levels.indexOf(level) >= levels.indexOf(minLevel);

  return {
    debug: (message, context) => shouldLog('debug') && console.debug(`[${prefix}]`, message, context ?? ''),
    info: (message, context) => shouldLog('info') && console.info(`[${prefix}]`, message, context ?? ''),
    warn: (message, context) => shouldLog('warn') && console.warn(`[${prefix}]`, message, context ?? ''),
    error: (message, context, error) => shouldLog('error') && console.error(`[${prefix}]`, message, context ?? '', error ?? ''),
  };
}
````

### Main Export Barrel (`src/index.ts`)

````typescript
/**
 * @quilltap/plugin-types
 * Type definitions for quilltap plugin development
 */

// LLM types
export type {
  FileAttachment,
  LLMMessage,
  LLMParams,
  LLMResponse,
  StreamChunk,
  TokenUsage,
  AttachmentResults,
  ImageGenParams,
  GeneratedImage,
  ImageGenResponse,
  LLMProvider,
} from './llm/base';

export type {
  OpenAIToolDefinition,
  AnthropicToolDefinition,
  ToolCall,
  ToolCallRequest,
  ToolResult,
} from './llm/tools';

// Plugin types
export type {
  ProviderMetadata,
  ProviderConfigRequirements,
  ProviderCapabilities,
  AttachmentSupport,
  ModelInfo,
  IconProps,
  LLMProviderPlugin,
} from './plugins/provider';

export type {
  PluginCapability,
  PluginCategory,
  PluginStatus,
  PluginManifest,
} from './plugins/manifest';

// Common types
export type {
  LogLevel,
  LogContext,
  PluginLogger,
} from './common/logger';

export {
  PluginError,
  ApiKeyError,
  ProviderApiError,
  RateLimitError,
} from './common/errors';

export { createConsoleLogger } from './common/logger';

// Version export for runtime checks
export const PLUGIN_TYPES_VERSION = '1.0.0';
````

## Package Configuration

### `package.json`

````json
{
  "name": "@quilltap/plugin-types",
  "version": "1.0.0",
  "description": "Type definitions for quilltap plugin development",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "module": "dist/index.mjs",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js"
    },
    "./llm": {
      "types": "./dist/llm/index.d.ts",
      "import": "./dist/llm/index.mjs",
      "require": "./dist/llm/index.js"
    },
    "./plugins": {
      "types": "./dist/plugins/index.d.ts",
      "import": "./dist/plugins/index.mjs",
      "require": "./dist/plugins/index.js"
    },
    "./common": {
      "types": "./dist/common/index.d.ts",
      "import": "./dist/common/index.mjs",
      "require": "./dist/common/index.js"
    }
  },
  "files": [
    "dist/",
    "README.md",
    "CHANGELOG.md"
  ],
  "scripts": {
    "build": "tsup",
    "clean": "rm -rf dist",
    "prepublishOnly": "npm run clean && npm run build",
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": ">=18.0.0"
  },
  "peerDependenciesMeta": {
    "react": {
      "optional": true
    }
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "tsup": "^8.0.0",
    "typescript": "^5.3.0"
  },
  "keywords": [
    "quilltap",
    "plugin",
    "types",
    "typescript",
    "llm"
  ],
  "author": "Foundry-9 LLC",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/foundry-9/quilltap.git",
    "directory": "packages/plugin-types"
  },
  "homepage": "https://github.com/foundry-9/quilltap/tree/main/packages/plugin-types#readme",
  "bugs": {
    "url": "https://github.com/foundry-9/quilltap/issues"
  }
}
````

### `tsconfig.json`

````json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["react"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
````

### `tsup.config.ts`

````typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'llm/index': 'src/llm/index.ts',
    'plugins/index': 'src/plugins/index.ts',
    'common/index': 'src/common/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react'],
  treeshake: true,
});
````

## Integration with quilltap Core

### Update Core Imports

After publishing `@quilltap/plugin-types`, update the quilltap core to:

1. **Add as dependency:**

````json
   {
     "dependencies": {
       "@quilltap/plugin-types": "^1.0.0"
     }
   }
````

1. **Re-export from core for backward compatibility:**

````typescript
   // lib/llm/base.ts
   export * from '@quilltap/plugin-types/llm';
   
   // lib/plugins/interfaces/provider-plugin.ts
   export * from '@quilltap/plugin-types/plugins';
````

1. **Update bundled plugins to use the package:**

````typescript
   // plugins/dist/qtap-plugin-*/types.ts
   export * from '@quilltap/plugin-types';
````

### Plugin Loader Updates

The plugin loader should resolve `@quilltap/plugin-types` for npm-installed plugins:

````typescript
// lib/plugins/loader.ts

async function loadNpmPlugin(pluginPath: string): Promise<LLMProviderPlugin> {
  // npm-installed plugins will have @quilltap/plugin-types as a peer dependency
  // The types are resolved from node_modules automatically
  const plugin = await import(pluginPath);
  return plugin.default ?? plugin.plugin;
}
````

## Versioning Strategy

### Semantic Versioning

- **Major (1.x.x → 2.0.0):** Breaking changes to interfaces
- **Minor (1.0.x → 1.1.0):** New optional fields, new interfaces
- **Patch (1.0.0 → 1.0.1):** Documentation, typo fixes

### Compatibility Matrix

| plugin-types | quilltap | Notes |
| -------------- | ---------- | ------- |
| 1.0.x | ≥1.7.0 | Initial release |
| 1.1.x | ≥1.8.0 | Added auth plugin types |
| 2.0.x | ≥2.0.0 | Breaking interface changes |

## Documentation

### README.md

````markdown
# @quilltap/plugin-types

Type definitions for building quilltap plugins.

## Installation
```bash
npm install --save-dev @quilltap/plugin-types
```

## Usage
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
    // ...
  },
  // ...
};
```

## Documentation

- [Plugin Development Guide](https://docs.quilltap.com/plugins/development)
- [API Reference](https://docs.quilltap.com/plugins/api)
- [Example Plugins](https://github.com/foundry-9/quilltap/tree/main/plugins/dist)

## License

MIT
````

## Testing Checklist

- [ ] Package builds successfully with `npm run build`
- [ ] Type definitions are correctly generated in `dist/`
- [ ] All exports are accessible from main entry point
- [ ] Sub-path exports (`/llm`, `/plugins`, `/common`) work correctly
- [ ] Package can be published to npm with `npm publish`
- [ ] Bundled plugins can be updated to use the package
- [ ] New standalone plugin can be created using only the package
- [ ] Plugin loader correctly resolves types for npm-installed plugins
- [ ] Backward compatibility with existing plugins is maintained

## Future Enhancements

1. **Auth Plugin Types** - Add interfaces for authentication provider plugins
2. **Storage Plugin Types** - Add interfaces for storage backend plugins
3. **Theme Plugin Types** - Add interfaces for UI theme plugins
4. **Utility Types** - Add shared utility functions (tool parsing, etc.)
5. **JSON Schema Generation** - Auto-generate JSON schemas from TypeScript types
6. **Plugin Template Generator** - CLI tool to scaffold new plugins

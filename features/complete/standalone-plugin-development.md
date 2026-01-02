# Standalone Plugin Development - Complete

**Status:** Implemented
**Completed:** December 2025

This document describes the infrastructure created to enable standalone, npm-publishable Quilltap plugins.

## Overview

Plugins can now be developed outside the Quilltap source tree and published to npm. This was achieved by creating two npm packages:

- `@quilltap/plugin-types` - TypeScript type definitions
- `@quilltap/plugin-utils` - Runtime utilities (tool parsing, logging)

## What Was Implemented

### 1. Types Package (`@quilltap/plugin-types`)

Located at `packages/plugin-types/`, this package provides all the TypeScript types needed for plugin development:

```typescript
// @quilltap/plugin-types
export interface LLMProvider {
  supportsFileAttachments: boolean;
  supportedMimeTypes: string[];
  supportsImageGeneration: boolean;
  supportsWebSearch: boolean;
  sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse>;
  streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk>;
  validateApiKey(apiKey: string): Promise<boolean>;
  getAvailableModels(apiKey: string): Promise<string[]>;
  generateImage?(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>;
}

export interface LLMProviderPlugin {
  metadata: ProviderMetadata;
  config: ProviderConfigRequirements;
  capabilities: ProviderCapabilities;
  attachmentSupport: AttachmentSupport;
  createProvider: (baseUrl?: string) => LLMProvider;
  getAvailableModels: (apiKey: string, baseUrl?: string) => Promise<string[]>;
  validateApiKey: (apiKey: string, baseUrl?: string) => Promise<boolean>;
  getModelInfo: () => ModelInfo[];
  renderIcon: (props: { className?: string }) => React.ReactNode;
  formatTools?: (tools: unknown[]) => unknown[];
  parseToolCalls?: (response: unknown) => ToolCallRequest[];
}

// ... all other shared types
```

### 2. Utilities Package (`@quilltap/plugin-utils`)

Located at `packages/plugin-utils/`, this package provides runtime utilities:

```typescript
// @quilltap/plugin-utils

// Tool parsers
export function parseToolCalls(response: unknown, format: 'openai' | 'anthropic' | 'google' | 'auto'): ToolCallRequest[];
export function parseOpenAIToolCalls(response: unknown): ToolCallRequest[];
export function parseAnthropicToolCalls(response: unknown): ToolCallRequest[];
export function parseGoogleToolCalls(response: unknown): ToolCallRequest[];

// Tool converters
export function convertToAnthropicFormat(tool: UniversalTool): AnthropicToolDefinition;
export function convertToGoogleFormat(tool: UniversalTool): GoogleToolDefinition;

// Logger bridge - routes to Quilltap core logging when running in host
export function createPluginLogger(pluginName: string): PluginLoggerWithChild;

// Base provider class for OpenAI-compatible APIs
export class OpenAICompatibleProvider implements LLMProvider { ... }
```

### 3. Logger Bridge

The `createPluginLogger()` function provides seamless logging:

- **When running in Quilltap:** Routes to core logging with plugin context (`{ plugin: 'name', module: 'plugin' }`)
- **When running standalone:** Falls back to console logging with `[plugin-name]` prefix
- Uses `globalThis` for injection to work across npm package boundaries
- Quilltap core injects the logger factory during plugin initialization

## Standalone Plugin Structure

```text
my-quilltap-plugin/
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── src/
│   ├── index.ts          # Main entry point
│   ├── provider.ts       # Provider class
│   ├── icon.tsx          # React icon component
│   └── logger.ts         # Logger setup
├── manifest.json
└── README.md
```

### Example `package.json`

```json
{
  "name": "my-quilltap-plugin",
  "version": "1.0.0",
  "description": "Custom provider plugin for Quilltap",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "openai": "^6.9.0",
    "@quilltap/plugin-utils": "^1.0.0"
  },
  "peerDependencies": {
    "@quilltap/plugin-types": "^1.0.0",
    "react": ">=18.0.0"
  },
  "devDependencies": {
    "@quilltap/plugin-types": "^1.0.0",
    "@types/react": "^18.0.0",
    "esbuild": "^0.24.0",
    "typescript": "^5.0.0"
  },
  "files": ["dist/", "manifest.json", "README.md"],
  "keywords": ["quilltap", "qtap-plugin", "llm", "ai"]
}
```

### Example `src/logger.ts`

```typescript
import { createPluginLogger } from '@quilltap/plugin-utils';

export const logger = createPluginLogger('my-quilltap-plugin');
```

### Example `src/types.ts`

```typescript
export type {
  FileAttachment,
  LLMMessage,
  LLMParams,
  LLMResponse,
  StreamChunk,
  LLMProvider,
  LLMProviderPlugin,
  ProviderMetadata,
  ProviderConfigRequirements,
  ProviderCapabilities,
  AttachmentSupport,
  ModelInfo,
  ToolCallRequest,
} from '@quilltap/plugin-types';
```

## Migration Path

| Component | Before | After |
|-----------|--------|-------|
| **Types** | Import from `../../../lib/` | Import from `@quilltap/plugin-types` |
| **Logger** | Import from `../../../lib/logger` | `createPluginLogger()` from `@quilltap/plugin-utils` |
| **Tool Utils** | Import from `../../../lib/llm/tool-formatting-utils` | Import from `@quilltap/plugin-utils` |
| **esbuild** | Resolves `@/` to project root | No alias needed |
| **Build Output** | `index.js` in plugin root | `dist/index.js` |

## Documentation

- [packages/plugin-types/README.md](../../packages/plugin-types/README.md) - Types package documentation
- [packages/plugin-utils/README.md](../../packages/plugin-utils/README.md) - Utilities package documentation
- [plugins/LLM-PROVIDER-GUIDE.md](../../plugins/LLM-PROVIDER-GUIDE.md) - Provider plugin development guide

#

Looking at the Gab AI plugin, I can identify several dependencies that tie it to the Quilltap source tree. Here's what would need to change to make it a standalone, npm-publishable plugin:

## Current Dependencies on Quilltap Source

### 1. **Type Imports from `../../../lib/`**

The plugin imports types from the parent project:

```typescript
// types.ts
export type { FileAttachment, LLMParams, LLMResponse, ... } from '../../../lib/llm/base';
export type { LLMProviderPlugin, ... } from '../../../lib/plugins/interfaces/provider-plugin';

// index.ts
import { parseOpenAIToolCalls, ... } from '../../../lib/llm/tool-formatting-utils';

// provider.ts
import { logger } from '../../../lib/logger';
```

### 2. **esbuild Configuration References Project Root**

```typescript
// esbuild.config.mjs
const projectRoot = resolve(__dirname, '..', '..', '..');
alias: { '@': projectRoot }
```

### 3. **Logger Dependency**

The plugin uses Quilltap's logger extensively, which itself depends on environment validation.

---

## What's Needed for Standalone Development

### 1. **Create a Types Package (`@quilltap/plugin-types`)**

Quilltap would need to publish a separate npm package containing just the type definitions:

```typescript
// @quilltap/plugin-types/index.d.ts
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

### 2. **Create a Utilities Package (`@quilltap/plugin-utils`)** ✅ IMPLEMENTED

The `@quilltap/plugin-utils` package is now available with:

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
```

### 3. **Plugin Provides Its Own Logger** ✅ IMPLEMENTED via plugin-utils

The `@quilltap/plugin-utils` package now provides `createPluginLogger()`:

- When running in Quilltap: Routes to core logging with plugin context (`{ plugin: 'name', module: 'plugin' }`)
- When running standalone: Falls back to console logging with `[plugin-name]` prefix
- Uses `globalThis` for injection to work across npm package boundaries
- Quilltap core injects the logger factory during plugin initialization

---

## Refactored Standalone Plugin Structure

```text
qtap-plugin-gab-ai/
├── package.json
├── tsconfig.json
├── esbuild.config.mjs
├── src/
│   ├── index.ts          # Main entry point
│   ├── provider.ts       # GabAIProvider class
│   ├── icon.tsx          # React icon component
│   └── logger.ts         # Simple internal logger
├── manifest.json
└── README.md
```

### Refactored `package.json`

```json
{
  "name": "qtap-plugin-gab-ai",
  "version": "1.1.0",
  "description": "Gab AI provider plugin for Quilltap",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "author": "Foundry-9 LLC",
  "license": "MIT",
  "scripts": {
    "build": "node esbuild.config.mjs && tsc --emitDeclarationOnly",
    "clean": "rm -rf dist",
    "prepublishOnly": "npm run clean && npm run build"
  },
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
  "files": [
    "dist/",
    "manifest.json",
    "README.md"
  ],
  "keywords": [
    "quilltap",
    "qtap-plugin",
    "gab-ai",
    "llm",
    "ai"
  ]
}
```

### Refactored `src/logger.ts` (Using plugin-utils)

With `@quilltap/plugin-utils`, the logger file is just a one-liner:

```typescript
import { createPluginLogger } from '@quilltap/plugin-utils';

export const logger = createPluginLogger('qtap-plugin-gab-ai');
```

When running in Quilltap, this logger routes to the core logging system with proper context tagging.
When running standalone, it falls back to console logging with `[qtap-plugin-gab-ai]` prefix.

### Refactored `src/types.ts`

```typescript
/**
 * Type imports from the Quilltap plugin types package
 */
export type {
  FileAttachment,
  ImageGenParams,
  GeneratedImage,
  ImageGenResponse,
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
  OpenAIToolDefinition,
  ToolCallRequest,
} from '@quilltap/plugin-types';
```

### Refactored `src/index.ts` (Tool Utilities Inlined or Imported)

```typescript
import type { LLMProviderPlugin, OpenAIToolDefinition, ToolCallRequest } from './types';
import { GabAIProvider } from './provider';
import { GabAIIcon } from './icon';
import { logger } from './logger';

/**
 * Parse OpenAI-format tool calls from response
 * (Inlined since it's simple, or import from @quilltap/plugin-utils)
 */
function parseOpenAIToolCalls(response: unknown): ToolCallRequest[] {
  const toolCalls: ToolCallRequest[] = [];
  try {
    const resp = response as Record<string, unknown>;
    let toolCallsArray = resp?.tool_calls as unknown[];
    
    if (!toolCallsArray) {
      const choices = resp?.choices as Array<{ message?: { tool_calls?: unknown[] } }>;
      toolCallsArray = choices?.[0]?.message?.tool_calls;
    }
    
    if (Array.isArray(toolCallsArray)) {
      for (const toolCall of toolCallsArray) {
        const tc = toolCall as { type?: string; function?: { name: string; arguments: string } };
        if (tc.type === 'function' && tc.function) {
          toolCalls.push({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments || '{}'),
          });
        }
      }
    }
  } catch (error) {
    logger.error('Error parsing tool calls', { context: 'parseOpenAIToolCalls' }, error instanceof Error ? error : undefined);
  }
  return toolCalls;
}

// ... rest of plugin definition unchanged
```

### Refactored `esbuild.config.mjs`

```javascript
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Packages provided by Quilltap at runtime
const EXTERNAL_PACKAGES = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@quilltap/plugin-types',
  // Node built-ins
  'fs', 'path', 'crypto', 'http', 'https', 'url', 'util',
  'stream', 'events', 'buffer', 'os',
];

async function build() {
  await esbuild.build({
    entryPoints: [resolve(__dirname, 'src/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: resolve(__dirname, 'dist/index.js'),
    external: EXTERNAL_PACKAGES,
    sourcemap: false,
    minify: false,
    treeShaking: true,
  });
  
  console.log('Build completed!');
}

build();
```

---

## Summary: Changes Required

| Component | Current State | Standalone Requirement |
|-----------|---------------|------------------------|
| **Types** | Import from `../../../lib/` | Import from `@quilltap/plugin-types` |
| **Logger** | Import from `../../../lib/logger` | `createPluginLogger()` from `@quilltap/plugin-utils` ✅ |
| **Tool Utils** | Import from `../../../lib/llm/tool-formatting-utils` | Import from `@quilltap/plugin-utils` ✅ |
| **esbuild** | Resolves `@/` to project root | No alias needed |
| **Build Output** | `index.js` in plugin root | `dist/index.js` |

## Quilltap-Side Work - COMPLETED

1. ✅ **Published `@quilltap/plugin-types`** - Type definitions in `packages/plugin-types/`
2. ✅ **Published `@quilltap/plugin-utils`** - Utilities in `packages/plugin-utils/`
3. ✅ **Updated plugin loader** - Injects logger factory via globalThis
4. ✅ **Documented the plugin API** - README.md files in each package

## Next Steps

Publish the packages to npm:

```bash
cd packages/plugin-types && npm publish
cd packages/plugin-utils && npm publish
```

# Quilltap Search Provider Plugin Development Guide

This guide walks you through creating a Quilltap search provider plugin from scratch, from an empty directory to publishing on npm. Search provider plugins supply pluggable web search backends for Quilltap's built-in `search_web` tool.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Project Setup](#project-setup)
4. [Required Files](#required-files)
5. [Plugin Manifest](#plugin-manifest)
6. [Implementing Your Search Provider](#implementing-your-search-provider)
7. [Building Your Plugin](#building-your-plugin)
8. [Testing Your Search Provider](#testing-your-search-provider)
9. [Publishing to npm](#publishing-to-npm)
10. [Complete Example](#complete-example)

---

## Overview

Search provider plugins power Quilltap's `search_web` tool with pluggable backends. The `search_web` tool is a built-in Prospero tool that LLMs can invoke during conversations to look things up on the web. The tool itself is built into Quilltap, but the actual search execution is delegated to whichever search provider plugin is installed and configured.

Common use cases:

- Integrating a commercial search API (e.g., Serper, Bing, Brave Search)
- Adding a privacy-focused backend (e.g., DuckDuckGo, SearXNG)
- Connecting to a self-hosted search index
- Building a domain-specific search provider (e.g., academic papers, news feeds)

How it works:

1. A user installs a search provider plugin and configures an API key in Settings > API Keys.
2. When an LLM invokes the `search_web` tool, Quilltap calls your plugin's `executeSearch` method with the query and API key.
3. Your plugin hits the external search API and returns standardized `SearchResult` objects.
4. Quilltap calls your plugin's `formatResults` method to convert the results into a text block for the LLM's context.

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** 18 or higher
- **npm** 8 or higher
- An npm account (for publishing)
- Basic knowledge of TypeScript
- API documentation for the search service you are integrating

---

## Project Setup

### Step 1: Create Your Project Directory

Plugin names must follow the pattern `qtap-plugin-<name>`. Choose a descriptive name that includes "search" for discoverability.

```bash
mkdir qtap-plugin-search-mysearch
cd qtap-plugin-search-mysearch
```

### Step 2: Initialize npm Package

```bash
npm init -y
```

### Step 3: Install Dependencies

```bash
# Quilltap type definitions
npm install @quilltap/plugin-types@^1.14.0

# Build tools
npm install --save-dev esbuild typescript
```

### Step 4: Configure package.json

Edit your `package.json`:

```json
{
  "name": "qtap-plugin-search-mysearch",
  "version": "1.0.0",
  "description": "MySearch web search provider for Quilltap",
  "main": "index.js",
  "scripts": {
    "build": "node esbuild.config.mjs"
  },
  "keywords": [
    "quilltap",
    "quilltap-plugin",
    "search",
    "web-search",
    "mysearch"
  ],
  "author": "Your Name <you@example.com>",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/qtap-plugin-search-mysearch"
  },
  "dependencies": {
    "@quilltap/plugin-types": "^1.14.0"
  },
  "devDependencies": {
    "esbuild": "^0.27.0"
  }
}
```

### Step 5: Create TypeScript Configuration

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "node",
    "declaration": true,
    "declarationDir": "./dist",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Note that search provider plugins do not need React or JSX support, so you can omit the `"jsx"` compiler option.

### Step 6: Create Build Configuration

Create `esbuild.config.mjs`:

```javascript
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',  // CRITICAL: Must be 'cjs' or 'esm', NOT 'iife'
  outfile: 'index.js',
  external: [
    '@quilltap/plugin-types',
    'react',
    'react-dom',
  ],
  sourcemap: false,
  minify: false,
  treeShaking: true,
  logLevel: 'info',
});

console.log('Build complete: index.js');
```

> **CRITICAL: Module Format**
>
> The `format` option **must** be `'cjs'` (CommonJS) or `'esm'` (ES Modules).
>
> **Do NOT use `format: 'iife'`** - this wraps your code in an Immediately Invoked Function Expression that doesn't export anything at the module level. Quilltap uses Node.js `require()` to load plugins, and IIFE-bundled code will appear as an empty object with no exports.
>
> If your plugin isn't loading correctly, check your build output - it should have `module.exports` or `exports` statements, not be wrapped in `(() => { ... })()`.

---

## Required Files

Your search provider plugin needs these files:

```
qtap-plugin-search-mysearch/
├── package.json          # npm package configuration
├── manifest.json         # Quilltap plugin manifest (REQUIRED)
├── tsconfig.json         # TypeScript configuration
├── esbuild.config.mjs    # Build configuration
├── src/
│   └── index.ts          # Plugin entry point (REQUIRED)
└── README.md             # Documentation
```

Search provider plugins are simpler than LLM provider plugins. You typically need only one source file that exports the `SearchProviderPlugin` object.

---

## Plugin Manifest

Create `manifest.json` - this tells Quilltap about your search provider:

```json
{
  "$schema": "https://quilltap.io/schemas/plugin-manifest.json",
  "name": "qtap-plugin-search-mysearch",
  "title": "MySearch Web Search",
  "description": "Web search results via the MySearch API. Provides web search capabilities for the search_web tool.",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com",
    "url": "https://your-website.com"
  },
  "license": "MIT",
  "main": "index.js",
  "compatibility": {
    "quilltapVersion": ">=2.10.0",
    "nodeVersion": ">=18.0.0"
  },
  "capabilities": ["SEARCH_PROVIDER"],
  "category": "PROVIDER",
  "typescript": true,
  "enabledByDefault": true,
  "status": "STABLE",
  "keywords": ["search", "web", "mysearch"],
  "searchProviderConfig": {
    "providerName": "MY_SEARCH",
    "displayName": "MySearch Web Search",
    "description": "Web search results via the MySearch API",
    "abbreviation": "MSE",
    "colors": {
      "bg": "bg-blue-100",
      "text": "text-blue-800",
      "icon": "text-blue-600"
    },
    "requiresApiKey": true,
    "apiKeyLabel": "MySearch API Key",
    "requiresBaseUrl": false
  },
  "permissions": {
    "network": ["api.mysearch.com"]
  }
}
```

### Key Manifest Fields

| Field | Description |
|-------|-------------|
| `capabilities` | Must include `"SEARCH_PROVIDER"` |
| `category` | Must be `"PROVIDER"` |
| `searchProviderConfig.providerName` | Unique identifier (uppercase). Must match between the manifest and the plugin's `metadata.providerName`. Also used to look up the API key. |
| `searchProviderConfig.displayName` | Human-readable name shown in the UI |
| `searchProviderConfig.description` | Short description of the search service |
| `searchProviderConfig.abbreviation` | 2-4 character abbreviation for compact UI display |
| `searchProviderConfig.colors` | Tailwind CSS classes for the provider badge (background, text, and icon) |
| `searchProviderConfig.requiresApiKey` | Whether users must provide an API key |
| `searchProviderConfig.apiKeyLabel` | Label displayed on the API key input field in Settings |
| `searchProviderConfig.requiresBaseUrl` | Set to `true` if users need to specify a custom endpoint (e.g., self-hosted SearXNG) |
| `permissions.network` | Domains your plugin will connect to |

---

## Implementing Your Search Provider

### Interface Reference

The `SearchProviderPlugin` interface is defined in `@quilltap/plugin-types`. Here is a summary of every field and method:

| Field / Method | Type | Required | Description |
|----------------|------|----------|-------------|
| `metadata` | `SearchProviderMetadata` | Yes | Provider identity: `providerName`, `displayName`, `description`, `abbreviation`, and `colors`. |
| `config` | `SearchProviderConfigRequirements` | Yes | Configuration requirements: `requiresApiKey`, `apiKeyLabel`, `requiresBaseUrl`, and optional `baseUrlDefault`. |
| `executeSearch(query, maxResults, apiKey, baseUrl?)` | `(query: string, maxResults: number, apiKey: string, baseUrl?: string) => Promise<SearchOutput>` | Yes | Executes a web search query and returns results or an error. |
| `formatResults(results)` | `(results: SearchResult[]) => string` | Yes | Converts an array of `SearchResult` objects into a formatted string that will be injected into the LLM's conversation context. |
| `validateApiKey(apiKey, baseUrl?)` | `(apiKey: string, baseUrl?: string) => Promise<boolean>` | No | Tests whether an API key is valid by making a minimal API call. Called when the user saves a new key in Settings > API Keys. |
| `icon` | `PluginIconData` | No | SVG icon data for the provider. If omitted, Quilltap generates a default icon from the `abbreviation`. |

### Data Types

#### SearchOutput

Returned by `executeSearch`. Always includes `success`, `totalFound`, and `query`. On success, includes `results`. On failure, includes `error`.

```typescript
interface SearchOutput {
  /** Whether the search was successful */
  success: boolean;

  /** Array of search results (present when success is true) */
  results?: SearchResult[];

  /** Error message (present when success is false) */
  error?: string;

  /** Total number of results found */
  totalFound: number;

  /** The query that was searched */
  query: string;
}
```

#### SearchResult

A single web search result. The `title`, `url`, and `snippet` fields are required. The `publishedDate` field is optional and helps the LLM assess the recency of information.

```typescript
interface SearchResult {
  /** Title of the search result */
  title: string;

  /** URL of the search result */
  url: string;

  /** Text snippet / summary of the result */
  snippet: string;

  /** Date the result was published (ISO string or human-readable) */
  publishedDate?: string;
}
```

#### PluginIconData

SVG icon data. You can provide either a complete SVG string or a `viewBox` plus an array of `paths`:

```typescript
interface PluginIconData {
  /** Raw SVG string (complete <svg> element) */
  svg?: string;

  /** SVG viewBox attribute (e.g., '0 0 24 24') */
  viewBox?: string;

  /** SVG path elements */
  paths?: Array<{
    d: string;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  }>;
}
```

### Complete Plugin Implementation (src/index.ts)

```typescript
import type {
  SearchProviderPlugin,
  SearchResult,
  SearchOutput,
} from '@quilltap/plugin-types';

// ============================================================================
// API TYPES (specific to your search provider)
// ============================================================================

interface MySearchApiResult {
  title: string;
  link: string;
  description: string;
  date?: string;
}

interface MySearchApiResponse {
  results: MySearchApiResult[];
  total: number;
  query: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const API_URL = 'https://api.mysearch.com/v1/search';

// ============================================================================
// PLUGIN IMPLEMENTATION
// ============================================================================

export const plugin: SearchProviderPlugin = {
  metadata: {
    providerName: 'MY_SEARCH',
    displayName: 'MySearch Web Search',
    description: 'Search via MySearch API',
    abbreviation: 'MSE',
    colors: {
      bg: 'bg-blue-100',
      text: 'text-blue-800',
      icon: 'text-blue-600',
    },
  },

  config: {
    requiresApiKey: true,
    apiKeyLabel: 'MySearch API Key',
    requiresBaseUrl: false,
  },

  /**
   * Execute a web search using the MySearch API
   */
  async executeSearch(
    query: string,
    maxResults: number,
    apiKey: string,
    _baseUrl?: string
  ): Promise<SearchOutput> {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: query,
          limit: maxResults,
        }),
      });

      // Handle authentication errors
      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: 'Invalid MySearch API key. Please check your API key in Settings > API Keys.',
          totalFound: 0,
          query,
        };
      }

      // Handle rate limiting
      if (response.status === 429) {
        return {
          success: false,
          error: 'MySearch API rate limit exceeded. Please try again later.',
          totalFound: 0,
          query,
        };
      }

      // Handle other HTTP errors
      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `MySearch API error: ${response.status} ${response.statusText} - ${errorText}`,
          totalFound: 0,
          query,
        };
      }

      const data: MySearchApiResponse = await response.json();

      // Map API-specific results to the standard SearchResult format
      const results: SearchResult[] = data.results.map((result) => ({
        title: result.title,
        url: result.link,
        snippet: result.description,
        publishedDate: result.date,
      }));

      return {
        success: true,
        results,
        totalFound: results.length,
        query,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error
          ? error.message
          : 'Unknown error during MySearch web search',
        totalFound: 0,
        query,
      };
    }
  },

  /**
   * Format search results for LLM context
   */
  formatResults(results: SearchResult[]): string {
    if (results.length === 0) {
      return 'No search results found.';
    }

    const formatted = results.map((result, index) => {
      const dateStr = result.publishedDate
        ? ` (Published: ${result.publishedDate})`
        : '';

      return `[Result ${index + 1}]${dateStr}
Title: ${result.title}
URL: ${result.url}
Summary: ${result.snippet}`;
    });

    return `Found ${results.length} search results:\n\n${formatted.join('\n\n')}`;
  },

  /**
   * Validate a MySearch API key by making a minimal search request
   */
  async validateApiKey(apiKey: string, _baseUrl?: string): Promise<boolean> {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: 'test',
          limit: 1,
        }),
      });

      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * Search icon (magnifying glass)
   */
  icon: {
    viewBox: '0 0 24 24',
    paths: [
      {
        d: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
        fill: 'currentColor',
      },
    ],
  },
};

export default plugin;
```

### Key Implementation Notes

**Error handling in `executeSearch`:** Always return a `SearchOutput` object, even on failure. Do not throw exceptions from `executeSearch`. Catch errors and return `{ success: false, error: '...', totalFound: 0, query }`. This lets Quilltap relay a meaningful error message to the LLM instead of crashing the tool call.

**Mapping results:** Your search API will return results in its own format. The job of `executeSearch` is to normalize those results into the standard `SearchResult` shape (`title`, `url`, `snippet`, and optionally `publishedDate`).

**Formatting for LLMs:** The `formatResults` method converts structured results into a plain-text block. Keep formatting clean and consistent. Number the results. Include URLs so the LLM can cite sources. The output of this method is injected directly into the conversation as a tool result.

**Base URL support:** If your search provider supports self-hosted or custom endpoints, set `requiresBaseUrl: true` in the config and the manifest. Quilltap will show a base URL input field alongside the API key. The `baseUrl` parameter will be passed to `executeSearch` and `validateApiKey`.

---

## API Key Integration

Users configure API keys in **Settings > API Keys**. When a user adds a new API key, they select a provider from a dropdown that is populated by installed plugins. The provider name in the dropdown comes from your manifest's `searchProviderConfig.providerName`.

The `providerName` must match exactly between three places:

1. `manifest.json` > `searchProviderConfig.providerName`
2. Your plugin's `metadata.providerName`
3. The `provider` field on the API key record in the database

When the `search_web` tool is invoked, Quilltap looks up the API key for the search provider by matching the `providerName`. API keys are encrypted at rest in the SQLite database and decrypted only when passed to your plugin's `executeSearch` method.

If your plugin sets `config.requiresApiKey: true`, the `search_web` tool will not be available unless the user has configured a valid API key for your provider.

---

## Building Your Plugin

```bash
npm run build
```

Verify the output:

- `index.js` should exist and contain `module.exports` or `exports`
- `manifest.json` should be in your project root

Check the build output is NOT wrapped in an IIFE:

```bash
head -5 index.js
```

Good output:

```javascript
"use strict";
var __defProp = Object.defineProperty;
// ... more CommonJS code
module.exports = ...
```

Bad output (IIFE - will not work):

```javascript
"use strict";
(() => {
  // ... code wrapped in function
})();
```

---

## Testing Your Search Provider

### Local Testing

1. Copy your built plugin to Quilltap's plugin directory:

   ```bash
   cp index.js manifest.json /path/to/quilltap/plugins/site/qtap-plugin-search-mysearch/
   ```

2. Restart Quilltap

3. Go to **Settings > Plugins** and verify your plugin appears

4. Add an API key in **Settings > API Keys** (select your provider from the dropdown)

5. Open a chat with a connection profile that has tools enabled

6. Ask the LLM something that triggers a web search (e.g., "Search the web for the latest news about TypeScript 6.0")

7. Verify that search results appear in the tool output

### Verify Provider Registration

Check the logs at `logs/combined.log` for:

```
Search provider registered { name: 'MY_SEARCH', displayName: 'MySearch Web Search' }
```

If you see:

```
Search provider plugin module does not export a valid plugin object { exports: [] }
```

Your build configuration is wrong - check that `format: 'cjs'` is set in your esbuild config.

### Common Issues During Testing

| Symptom | Likely Cause |
|---------|--------------|
| Plugin not visible in Settings > Plugins | Missing or malformed `manifest.json` |
| Provider not in API Keys dropdown | `capabilities` does not include `"SEARCH_PROVIDER"` |
| "No search provider configured" in chat | No API key saved for your provider, or plugin is disabled |
| Search returns empty results | Check your API response mapping; log the raw API response |
| `validateApiKey` always fails | Verify the endpoint and authentication scheme match your API docs |

---

## Publishing to npm

### Prepare for Publishing

1. Update version in `package.json`
2. Ensure `manifest.json` version matches
3. Build: `npm run build`
4. Test locally one more time

### Publish

```bash
# Login to npm (first time only)
npm login

# Publish
npm publish
```

For scoped packages:

```bash
npm publish --access public
```

### After Publishing

Users can install your plugin via Quilltap's UI:

1. Go to **Settings > Plugins**
2. Search for your plugin name
3. Click Install

---

## Complete Example

See the bundled Serper plugin as a complete, working reference implementation:

**`plugins/dist/qtap-plugin-search-serper/`**

This plugin integrates [Serper.dev](https://serper.dev/) (Google search results) and demonstrates:

- Mapping a third-party API response to the standard `SearchResult` format
- Handling knowledge graph results alongside organic results
- Graceful error handling for authentication failures, rate limits, and network errors
- API key validation via a minimal test search
- SVG icon data for the provider badge

The Serper plugin is a single-file implementation (plus manifest), which is typical for search provider plugins. It is a good starting point for your own plugin.

---

## Troubleshooting

### Plugin Not Loading

1. **Check build format**: Ensure `format: 'cjs'` in esbuild config
2. **Check exports**: Your `index.js` must export a `plugin` object
3. **Check manifest**: Validate against schema, ensure `main` points to the correct file
4. **Check logs**: Look for errors in Quilltap's `logs/combined.log`

### Provider Not Appearing in API Key Dropdown

1. Ensure `capabilities` includes `"SEARCH_PROVIDER"`
2. Ensure `searchProviderConfig.requiresApiKey` is `true`
3. Restart Quilltap after installation
4. Check that the plugin is enabled in Settings > Plugins

### API Key Validation Failing

1. Check your `validateApiKey` implementation
2. Verify the API endpoint and authentication headers match your API documentation
3. Check network permissions in manifest include the correct domain

### Search Returning No Results

1. Log the raw API response in `executeSearch` to verify the response shape
2. Verify your result mapping matches the API's response format
3. Confirm the API key has the correct permissions/plan for search queries
4. Check that `maxResults` is being passed correctly to your API

---

## API Reference

### SearchProviderPlugin Interface

```typescript
interface SearchProviderPlugin {
  // Required
  metadata: SearchProviderMetadata;
  config: SearchProviderConfigRequirements;
  executeSearch(query: string, maxResults: number, apiKey: string, baseUrl?: string): Promise<SearchOutput>;
  formatResults(results: SearchResult[]): string;

  // Optional
  validateApiKey?(apiKey: string, baseUrl?: string): Promise<boolean>;
  icon?: PluginIconData;
}
```

### SearchProviderMetadata

```typescript
interface SearchProviderMetadata {
  providerName: string;   // Internal identifier (e.g., 'SERPER', 'BING')
  displayName: string;    // Human-readable name (e.g., 'Serper Web Search')
  description: string;    // Short description
  abbreviation: string;   // 2-4 chars for compact display (e.g., 'SRP')
  colors: {
    bg: string;           // Tailwind background class (e.g., 'bg-orange-100')
    text: string;         // Tailwind text class (e.g., 'text-orange-800')
    icon: string;         // Tailwind icon class (e.g., 'text-orange-600')
  };
}
```

### SearchProviderConfigRequirements

```typescript
interface SearchProviderConfigRequirements {
  requiresApiKey: boolean;     // Whether an API key is needed
  apiKeyLabel?: string;        // Label for the API key input field
  requiresBaseUrl: boolean;    // Whether a custom base URL is needed
  baseUrlDefault?: string;     // Default base URL value (if applicable)
}
```

### SearchOutput

```typescript
interface SearchOutput {
  success: boolean;
  results?: SearchResult[];
  error?: string;
  totalFound: number;
  query: string;
}
```

### SearchResult

```typescript
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
}
```

See `@quilltap/plugin-types` for complete type definitions.

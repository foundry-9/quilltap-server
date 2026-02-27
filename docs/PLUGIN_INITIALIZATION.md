# Plugin Initialization System

This document describes how Quilltap's plugin system initializes on application startup.

## Overview

The plugin initialization system automatically scans, validates, transpiles, and loads plugins when the application starts. It follows a clean client-server architecture with proper error handling and idempotency.

## Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                     Application Startup                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              instrumentation.ts (Startup)                    │
│  - Runs migrations (MUST complete before requests)          │
│  - Initializes plugins                                       │
│  - Initializes file storage                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              app/layout.tsx (Root Layout)                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ <Providers>                                           │  │
│  │   <PluginInitializer />  ◄── Client Component        │  │
│  │   ...                                                 │  │
│  │ </Providers>                                          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼ (useEffect on mount)
┌─────────────────────────────────────────────────────────────┐
│     POST /api/v1/system/plugins/initialize                   │
│     (API Route Handler)                                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│     lib/startup/plugin-initialization.ts                     │
│     initializePlugins()                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ 1. transpileAllPlugins()  ◄── TypeScript → JS        │  │
│  │ 2. scanPlugins()          ◄── Scan filesystem        │  │
│  │ 3. Validate compatibility ◄── Check versions         │  │
│  │ 4. Security validation    ◄── Check permissions      │  │
│  │ 5. Register providers     ◄── LLM provider plugins   │  │
│  │ 6. pluginRegistry.initialize()                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│     lib/plugins/provider-registry.ts (Provider Registry)    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ - Store provider plugins                              │  │
│  │ - Create LLM providers on demand                      │  │
│  │ - Create image providers on demand                    │  │
│  │ - Provide metadata for UI                             │  │
│  │ - Track initialization stats                          │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Components

### 1. Instrumentation: Startup Sequence

**File:** `instrumentation.ts`

Next.js instrumentation hook that runs before the application accepts requests.

**Features:**

- Runs all data migrations (MUST complete before requests)
- Initializes plugin system
- Initializes file storage
- Logs startup information and diagnostics

**Note:** Migrations are handled by the `MigrationRunner` class in `migrations/` and run BEFORE plugins are initialized. This ensures data compatibility before any requests are served. If migrations fail, the process exits with code 1.

### 2. Client Component: `PluginInitializer`

**File:** `components/startup/plugin-initializer.tsx`

Client-side React component that triggers initialization when mounted.

**Features:**

- Runs once on app startup
- Idempotent (safe to call multiple times)
- Logs results to console
- Doesn't render anything

**Usage:**

```tsx
import { PluginInitializer } from '@/components/startup';

// In root layout
<PluginInitializer />
```

### 3. API Endpoint

**File:** `app/api/v1/system/plugins/initialize/route.ts`

HTTP endpoint that triggers server-side initialization.

**Endpoints:**

#### POST `/api/v1/system/plugins/initialize`

Initializes the plugin system.

**Response:**

```json
{
  "success": true,
  "result": {
    "success": true,
    "stats": {
      "total": 9,
      "enabled": 9,
      "disabled": 0,
      "errors": 0
    },
    "warnings": [],
    "errors": []
  }
}
```

#### GET `/api/v1/system/plugins/initialize`

Returns current plugin system state without triggering initialization.

**Response:**

```json
{
  "success": true,
  "state": {
    "initialized": true,
    "inProgress": false,
    "registry": { /* full registry state */ }
  }
}
```

### 4. Server-Side Initialization

**File:** `lib/startup/plugin-initialization.ts`

Core initialization logic that runs on the server.

**Main Function:** `initializePlugins()`

**Process:**

1. **Transpile** - Convert TypeScript plugins to JavaScript
2. **Scan** - Find all plugin directories
3. **Load** - Read and parse manifest.json files
4. **Validate** - Check:
   - Manifest schema validity
   - Version compatibility
   - Security permissions
5. **Register** - Register provider plugins with provider registry
6. **Finalize** - Store validated plugins in registry

**Note:** Data migrations run BEFORE this function is called, in `instrumentation.ts`. By the time plugin initialization runs, all data is guaranteed to be in the correct format.

**Features:**

- Idempotent (safe to call multiple times)
- Returns detailed results
- Handles errors gracefully
- Logs all operations

### 5. Provider Registry

**File:** `lib/plugins/provider-registry.ts`

Singleton registry for managing LLM provider plugins.

**API:**

```typescript
import { providerRegistry } from '@/lib/plugins/provider-registry';

// Get all registered providers
const all = providerRegistry.getAllProviders();

// Get specific provider
const openai = providerRegistry.getProvider('OPENAI');

// Create LLM provider instance
const provider = providerRegistry.createLLMProvider('ANTHROPIC');

// Create image provider instance
const imageProvider = providerRegistry.createImageProvider('OPENAI');

// Get providers by capability
const imageProviders = providerRegistry.getProvidersByCapability('imageGeneration');

// Get provider metadata for UI
const metadata = providerRegistry.getAllProviderMetadata();

// Check if provider exists
const exists = providerRegistry.hasProvider('GOOGLE');

// Get attachment support info
const attachments = providerRegistry.getAttachmentSupport('ANTHROPIC');

// Get statistics
const stats = providerRegistry.getStats();
// {
//   total: 8,
//   errors: 0,
//   initialized: true,
//   lastInitTime: "2025-12-02T10:30:00.000Z",
//   providers: ['OPENAI', 'ANTHROPIC', ...]
// }
```

### 6. Plugin Registry

**File:** `lib/plugins/registry.ts`

Singleton registry for managing all loaded plugins (not just providers).

**API:**

```typescript
import { pluginRegistry } from '@/lib/plugins';

// Get all plugins
const all = pluginRegistry.getAll();

// Get enabled plugins only
const enabled = pluginRegistry.getEnabled();

// Get plugins by capability
const llmProviders = pluginRegistry.getByCapability('LLM_PROVIDER');

// Get enabled plugins by capability
const enabledProviders = pluginRegistry.getEnabledByCapability('LLM_PROVIDER');

// Enable/disable plugins
pluginRegistry.enable('qtap-plugin-example');
pluginRegistry.disable('qtap-plugin-example');

// Get statistics
const stats = pluginRegistry.getStats();
```

## Initialization Flow

### Step 1: Application Starts

When the Next.js application starts, the root layout renders:

**File:** `app/layout.tsx`

```tsx
<Providers>
  <PluginInitializer />  {/* Plugin initialization trigger */}
  ...
</Providers>
```

### Step 2: Client Trigger

The `PluginInitializer` component mounts and calls the API:

```typescript
useEffect(() => {
  fetch('/api/v1/system/plugins/initialize', { method: 'POST' })
    .then(res => res.json())
    .then(result => {
      console.log('Plugins initialized:', result)
    })
}, [])
```

### Step 3: TypeScript Transpilation

Plugins written in TypeScript are transpiled to JavaScript:

```typescript
await transpileAllPlugins();
// Converts index.ts → index.js for each plugin
```

### Step 4: Plugin Scanning

The system scans the `plugins/` and `plugins/dist/` directories:

```typescript
const scanResult = await scanPlugins();
// Finds all directories with manifest.json
```

### Step 5: Validation

Each plugin is validated:

```typescript
// Schema validation
const manifest = validatePluginManifest(data);

// Version compatibility
if (!isPluginCompatible(plugin.manifest, quilltapVersion)) {
  // Skip plugin
}

// Security warnings
const warnings = validatePluginSecurity(plugin.manifest);
```

### Step 6: Provider Registration

Provider plugins are dynamically loaded and registered:

```typescript
// Dynamic import of plugin module
const module = await import(pluginPath);

// Register with provider registry
providerRegistry.registerProvider(module.plugin);
```

### Step 7: Completion

Results are logged and returned to the client.

## Using Providers After Initialization

Once initialized, you can use providers anywhere in your application:

### Create an LLM Provider

```typescript
import { createLLMProvider } from '@/lib/llm/plugin-factory';

const provider = createLLMProvider('ANTHROPIC');
const response = await provider.sendMessage(params, apiKey);
```

### Create an Image Provider

```typescript
import { createImageProvider } from '@/lib/llm/plugin-factory';

const imageProvider = createImageProvider('OPENAI');
const result = await imageProvider.generateImage(params, apiKey);
```

### Get Provider Metadata for UI

```typescript
import { getAllProviderMetadata } from '@/lib/plugins/provider-registry';

const providers = getAllProviderMetadata();
// Returns array of { providerName, displayName, colors, ... }
```

### Check Provider Capabilities

```typescript
import { supportsCapability } from '@/lib/plugins/provider-registry';

if (supportsCapability('OPENAI', 'imageGeneration')) {
  // Show image generation options
}
```

## Error Handling

The initialization system handles errors gracefully at multiple levels:

### 1. Manifest Parsing Errors

```typescript
{
  plugin: "qtap-plugin-broken",
  error: "Invalid JSON in manifest file"
}
```

### 2. Schema Validation Errors

```typescript
{
  plugin: "qtap-plugin-invalid",
  error: "Manifest validation failed"
}
```

### 3. Version Incompatibility

```typescript
{
  plugin: "qtap-plugin-old",
  error: "Incompatible with Quilltap 1.7.5. Requires: >=2.0.0"
}
```

### 4. Security Warnings

```typescript
{
  plugin: "qtap-plugin-unsafe",
  warnings: [
    "Plugin runs without sandboxing - security risk",
    "Plugin requests access to user data"
  ]
}
```

### 5. Provider Registration Errors

```typescript
{
  plugin: "qtap-plugin-bad-provider",
  error: "Provider does not implement required interface"
}
```

## Testing

### Unit Tests

Run plugin initialization tests:

```bash
npm test -- plugin-initialization.test.ts
npm test -- plugin-registry.test.ts
npm test -- provider-registry.test.ts
```

### Manual Testing

1. Start the application:

   ```bash
   npm run dev
   ```

2. Check browser console for initialization logs:

   ```text
   ✓ Plugin system initialized: 9 enabled, 0 disabled, 0 errors
   ```

3. Check the API endpoint:

   ```bash
   curl http://localhost:3000/api/v1/system/plugins/initialize
   ```

## Performance Considerations

- **Idempotent:** Multiple calls return cached results
- **Lazy Loading:** Plugin code is loaded only during initialization
- **Async:** Initialization doesn't block the UI
- **Efficient:** File system scanning is done once on startup
- **Transpilation Cached:** TypeScript only recompiled when source changes

## Security

The initialization system enforces security through:

1. **Schema Validation:** All manifests must pass strict validation
2. **Permission Checks:** Plugins must declare required permissions
3. **Version Checking:** Incompatible plugins are rejected
4. **Sandboxing:** Plugins can be sandboxed by default
5. **Warning System:** Security concerns are logged

## Troubleshooting

### Plugin Not Loading

1. Check console for errors
2. Verify manifest.json is valid JSON
3. Ensure manifest passes schema validation
4. Check version compatibility
5. Review security warnings

### Provider Not Available

1. Verify plugin has `LLM_PROVIDER` capability
2. Check that plugin exports `plugin` object
3. Ensure `createProvider` method exists
4. Review provider registry stats

### Initialization Failed

1. Check API endpoint response
2. Review server logs
3. Verify plugins directory exists
4. Check file permissions
5. Look for transpilation errors

### Plugin Not Appearing

1. Ensure plugin directory name starts with `qtap-plugin-`
2. Verify manifest.json exists
3. Check if plugin is disabled
4. Review initialization errors

## See Also

- [Plugin Manifest Schema](./PLUGIN_MANIFEST.md)
- [Plugin Developer Guide](../plugins/README.md)
- [LLM Provider Guide](../plugins/LLM-PROVIDER-GUIDE.md)
- [Creating Plugins](../plugins/dist/qtap-plugin-template/)

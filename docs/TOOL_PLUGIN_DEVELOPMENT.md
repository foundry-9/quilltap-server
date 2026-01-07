# Quilltap Tool Plugin Development Guide

This guide walks you through creating a Quilltap tool plugin from scratch, from an empty directory to publishing on npm. Tool plugins provide custom tools that LLMs can invoke during conversations.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Project Setup](#project-setup)
4. [Required Files](#required-files)
5. [Implementing Your Tool](#implementing-your-tool)
6. [Security Considerations](#security-considerations)
7. [Building Your Plugin](#building-your-plugin)
8. [Testing Your Tool](#testing-your-tool)
9. [Publishing to npm](#publishing-to-npm)
10. [Complete Example](#complete-example)

---

## Overview

Tool plugins extend Quilltap by providing custom tools that AI models can invoke during conversations. When an LLM decides to use your tool, Quilltap calls your plugin's `execute` method with the parameters the LLM provided.

Common use cases:
- **Web requests**: Fetch content from APIs or websites (like the built-in `curl` tool)
- **Calculations**: Mathematical operations, unit conversions, date calculations
- **Data lookups**: Database queries, file searches, dictionary lookups
- **External integrations**: Weather APIs, stock prices, news feeds
- **Code execution**: Run code snippets, validate syntax, format code

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** 18 or higher
- **npm** 8 or higher
- An npm account (for publishing)
- Basic knowledge of TypeScript/JavaScript
- Understanding of OpenAI function calling format

---

## Project Setup

### Step 1: Create Your Project Directory

Tool plugin names must follow the pattern `qtap-plugin-<name>`. Choose a unique, descriptive name.

```bash
mkdir qtap-plugin-calculator
cd qtap-plugin-calculator
```

### Step 2: Initialize npm Package

```bash
npm init -y
```

### Step 3: Install Dependencies

```bash
# Quilltap packages for types and utilities
npm install @quilltap/plugin-types @quilltap/plugin-utils

# Build tools
npm install --save-dev esbuild typescript
```

### Step 4: Configure package.json

Edit your `package.json`:

```json
{
  "name": "qtap-plugin-calculator",
  "version": "1.0.0",
  "description": "Mathematical calculator tool for Quilltap LLMs",
  "main": "index.js",
  "types": "index.d.ts",
  "files": [
    "index.js",
    "index.d.ts",
    "manifest.json"
  ],
  "scripts": {
    "build": "node esbuild.config.mjs"
  },
  "keywords": [
    "quilltap",
    "quilltap-plugin",
    "tool",
    "calculator",
    "math"
  ],
  "author": "Your Name <you@example.com>",
  "license": "MIT",
  "dependencies": {
    "@quilltap/plugin-types": "^1.6.0",
    "@quilltap/plugin-utils": "^1.3.0"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "typescript": "^5.0.0"
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
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": ".",
    "rootDir": "."
  },
  "include": ["*.ts"],
  "exclude": ["node_modules"]
}
```

### Step 6: Create Build Configuration

Create `esbuild.config.mjs`:

```javascript
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'index.js',
  external: [
    '@quilltap/plugin-types',
    '@quilltap/plugin-utils',
    'react',
    'react-dom',
  ],
  sourcemap: false,
  minify: false,
});

console.log('Build complete: index.js');
```

---

## Required Files

Your tool plugin needs these files at minimum:

```
qtap-plugin-calculator/
├── package.json          # npm package configuration
├── manifest.json         # Quilltap plugin manifest (REQUIRED)
├── index.ts              # Entry point with tool implementation (REQUIRED)
├── types.ts              # TypeScript type definitions
├── tsconfig.json         # TypeScript configuration
├── esbuild.config.mjs    # Build configuration
└── README.md             # Documentation
```

---

## Plugin Manifest

Create `manifest.json` - this tells Quilltap about your tool:

```json
{
  "name": "qtap-plugin-calculator",
  "title": "Calculator Tool",
  "description": "Mathematical calculator for arithmetic, algebra, and unit conversions",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com",
    "url": "https://yourwebsite.com"
  },
  "license": "MIT",
  "main": "index.js",
  "compatibility": {
    "quilltapVersion": ">=2.6.0",
    "nodeVersion": ">=18.0.0"
  },
  "capabilities": ["TOOL_PROVIDER"],
  "category": "TOOLS",
  "typescript": true,
  "frontend": "NONE",
  "styling": "NONE",
  "enabledByDefault": true,
  "status": "STABLE",
  "keywords": ["tool", "calculator", "math", "arithmetic"],
  "toolConfig": {
    "toolName": "calculator",
    "displayName": "Calculator",
    "description": "Perform mathematical calculations",
    "requiresConfiguration": false,
    "enabledByDefault": true
  },
  "configSchema": [],
  "permissions": {
    "network": [],
    "database": false,
    "userData": false
  }
}
```

### Manifest Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Must match pattern `qtap-plugin-<name>` |
| `title` | Yes | Human-readable tool name (shown in UI) |
| `description` | Yes | Brief description of the tool |
| `version` | Yes | Semantic version (e.g., "1.0.0") |
| `author` | Yes | Author name or object with name/email/url |
| `main` | Yes | Entry point file (typically "index.js") |
| `compatibility` | Yes | Minimum Quilltap version (2.6.0+ for tools) |
| `capabilities` | Yes | Must include "TOOL_PROVIDER" |
| `category` | Yes | Must be "TOOLS" |
| `toolConfig` | Yes | Tool configuration (see below) |
| `configSchema` | No | User-configurable settings (see below) |

### toolConfig Fields

| Field | Required | Description |
|-------|----------|-------------|
| `toolName` | Yes | Tool name used by LLMs (lowercase, underscores allowed) |
| `displayName` | Yes | Human-readable name for UI |
| `description` | Yes | Brief description shown to users |
| `requiresConfiguration` | No | If true, tool won't work until configured |
| `enabledByDefault` | No | If false, users must enable the tool |

### configSchema for User Settings

If your tool needs user configuration, add `configSchema`:

```json
{
  "configSchema": [
    {
      "key": "allowedDomains",
      "label": "Allowed Domains",
      "type": "textarea",
      "description": "List of allowed domains (one per line)",
      "default": ""
    },
    {
      "key": "maxResults",
      "label": "Maximum Results",
      "type": "number",
      "default": 10,
      "min": 1,
      "max": 100
    },
    {
      "key": "enableCache",
      "label": "Enable Caching",
      "type": "boolean",
      "default": true
    }
  ]
}
```

---

## Implementing Your Tool

### The ToolPlugin Interface

Your plugin must export an object implementing the `ToolPlugin` interface:

```typescript
interface ToolPlugin {
  // Required properties
  metadata: {
    toolName: string;
    displayName: string;
    description: string;
    category?: string;
  };

  // Required methods
  getToolDefinition(): UniversalTool;
  validateInput(input: unknown): boolean;
  execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult>;
  formatResults(result: ToolExecutionResult): string;

  // Optional methods
  isConfigured?(config: Record<string, unknown>): boolean;
  getDefaultConfig?(): Record<string, unknown>;
}
```

### Tool Definition (OpenAI Function Format)

Define your tool using the OpenAI function calling format:

```typescript
// types.ts
export interface CalculatorInput {
  expression: string;
  precision?: number;
}

export interface CalculatorOutput {
  result: number | string;
  expression: string;
  error?: string;
}
```

```typescript
// calculator-tool.ts
import type { UniversalTool } from '@quilltap/plugin-types';

export const calculatorToolDefinition: UniversalTool = {
  type: 'function',
  function: {
    name: 'calculator',
    description: `Evaluate mathematical expressions and perform calculations.
Supports: arithmetic (+, -, *, /, ^), functions (sin, cos, sqrt, log), constants (pi, e).
Returns the numerical result or an error message.`,
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'The mathematical expression to evaluate (e.g., "2 + 2", "sqrt(16)", "sin(pi/2)")',
        },
        precision: {
          type: 'number',
          minimum: 0,
          maximum: 15,
          description: 'Number of decimal places for the result. Default is 10.',
        },
      },
      required: ['expression'],
    },
  },
};
```

### Input Validation

Validate input before execution:

```typescript
export function validateCalculatorInput(input: unknown): input is CalculatorInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // expression is required and must be a string
  if (typeof obj.expression !== 'string' || obj.expression.length === 0) {
    return false;
  }

  // precision must be a valid number if provided
  if (obj.precision !== undefined) {
    if (typeof obj.precision !== 'number' || obj.precision < 0 || obj.precision > 15) {
      return false;
    }
  }

  return true;
}
```

### Execution Handler

Implement the core logic:

```typescript
// calculator-handler.ts
import type { CalculatorInput, CalculatorOutput } from './types';

export async function executeCalculation(
  input: CalculatorInput
): Promise<CalculatorOutput> {
  const { expression, precision = 10 } = input;

  try {
    // SECURITY: Use a safe math parser, NOT eval()
    const result = safeMathEval(expression);

    return {
      result: Number(result.toFixed(precision)),
      expression,
    };
  } catch (error) {
    return {
      result: 'Error',
      expression,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Example safe math evaluator (use a library like mathjs in production)
function safeMathEval(expression: string): number {
  // This is a simplified example - use a proper math library
  const sanitized = expression.replace(/[^0-9+\-*/().^ ]/g, '');
  // ... safe evaluation logic
  return 0; // placeholder
}
```

### Main Plugin Entry Point

```typescript
// index.ts
import type {
  ToolPlugin,
  ToolExecutionContext,
  ToolExecutionResult,
  UniversalTool,
} from '@quilltap/plugin-types';
import { calculatorToolDefinition, validateCalculatorInput } from './calculator-tool';
import { executeCalculation } from './calculator-handler';
import type { CalculatorInput, CalculatorOutput } from './types';

export const plugin: ToolPlugin = {
  metadata: {
    toolName: 'calculator',
    displayName: 'Calculator',
    description: 'Perform mathematical calculations',
    category: 'Utilities',
  },

  getToolDefinition(): UniversalTool {
    return calculatorToolDefinition;
  },

  validateInput(input: unknown): boolean {
    return validateCalculatorInput(input);
  },

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const calcInput = input as unknown as CalculatorInput;
    const output = await executeCalculation(calcInput);

    return {
      success: !output.error,
      result: output,
      error: output.error,
      formattedText: formatOutput(output),
      metadata: {
        expression: calcInput.expression,
      },
    };
  },

  formatResults(result: ToolExecutionResult): string {
    if (result.formattedText) {
      return result.formattedText;
    }
    return JSON.stringify(result.result, null, 2);
  },

  // Optional: Check if tool is properly configured
  isConfigured(config: Record<string, unknown>): boolean {
    // Calculator doesn't require configuration
    return true;
  },

  // Optional: Provide default configuration
  getDefaultConfig(): Record<string, unknown> {
    return {
      precision: 10,
    };
  },
};

function formatOutput(output: CalculatorOutput): string {
  if (output.error) {
    return `Calculation error: ${output.error}`;
  }
  return `${output.expression} = ${output.result}`;
}

// Default export for compatibility
export default { plugin };
```

---

## Security Considerations

### Critical Security Rules

1. **Never use `eval()`**: For code execution, use sandboxed environments
2. **Validate all inputs**: Check types, ranges, and formats before processing
3. **Sanitize user data**: Escape special characters, validate URLs, check paths
4. **Limit resource usage**: Set timeouts, max response sizes, rate limits
5. **Block dangerous operations**: Prevent file system access, network abuse

### For Network-Accessing Tools

If your tool makes HTTP requests:

```typescript
// Security checklist for network tools:

// 1. Require explicit URL allowlist
const allowedPatterns = parseUrlPatterns(config.allowedUrlPatterns);
if (allowedPatterns.length === 0) {
  return { error: 'No URLs are allowed. Configure allowed URL patterns.' };
}

// 2. Block private IP addresses (SSRF protection)
const PRIVATE_IP_PATTERNS = [
  /^127\./,                    // localhost
  /^10\./,                     // Class A private
  /^172\.(1[6-9]|2[0-9]|3[01])\./, // Class B private
  /^192\.168\./,               // Class C private
  /^::1$/,                     // IPv6 localhost
  /^fe80:/i,                   // IPv6 link-local
];

// 3. Enforce scheme restrictions
if (!url.startsWith('http://') && !url.startsWith('https://')) {
  return { error: 'Only http:// and https:// URLs are allowed' };
}

// 4. Set timeouts
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), MAX_TIMEOUT_MS);

// 5. Limit response size
if (responseSize > MAX_RESPONSE_SIZE) {
  // Truncate response
}
```

### Configuration Best Practices

```json
{
  "configSchema": [
    {
      "key": "allowedUrlPatterns",
      "label": "Allowed URL Patterns",
      "type": "textarea",
      "description": "URL patterns to allow (one per line). Supports wildcards like *.example.com",
      "default": ""
    }
  ],
  "permissions": {
    "network": ["fetch"],
    "database": false,
    "userData": false
  }
}
```

---

## Building Your Plugin

### Build for Distribution

```bash
npm run build
```

This compiles TypeScript to JavaScript.

### Verify Build Output

Your plugin directory should contain:

```
qtap-plugin-calculator/
├── index.js              # Compiled entry point (generated)
├── index.ts              # Source entry point
├── manifest.json         # Plugin manifest
├── package.json          # npm configuration
└── README.md             # Documentation
```

---

## Testing Your Tool

### Test Locally in Quilltap

1. In your Quilltap installation, create a symlink:

```bash
cd /path/to/quilltap/plugins/installed
ln -s /path/to/qtap-plugin-calculator qtap-plugin-calculator
```

2. Restart Quilltap

3. Go to Settings > Plugins and verify your tool appears

4. If it requires configuration, configure it in Settings

5. Start a chat and ask the LLM to use your tool

### Validate Your Plugin

```bash
node -e "
const manifest = require('./manifest.json');

// Check required fields
const required = ['name', 'title', 'version', 'main', 'capabilities', 'toolConfig'];
const missing = required.filter(k => !manifest[k]);
if (missing.length) {
  console.error('Missing manifest fields:', missing);
  process.exit(1);
}

// Check capability
if (!manifest.capabilities.includes('TOOL_PROVIDER')) {
  console.error('capabilities must include TOOL_PROVIDER');
  process.exit(1);
}

// Check toolConfig
const config = manifest.toolConfig;
if (!config.toolName || !config.displayName) {
  console.error('toolConfig must have toolName and displayName');
  process.exit(1);
}

// Validate toolName format
if (!/^[a-z][a-z0-9_]*\$/.test(config.toolName)) {
  console.error('toolName must be lowercase with underscores only');
  process.exit(1);
}

console.log('Manifest valid!');
console.log('Tool name:', config.toolName);
"
```

### Test the Plugin Module

```bash
node -e "
const plugin = require('./index.js');
const p = plugin.plugin || plugin.default?.plugin;

if (!p) {
  console.error('No plugin export found');
  process.exit(1);
}

console.log('Plugin loaded successfully');
console.log('Tool name:', p.metadata.toolName);
console.log('Has getToolDefinition:', typeof p.getToolDefinition === 'function');
console.log('Has validateInput:', typeof p.validateInput === 'function');
console.log('Has execute:', typeof p.execute === 'function');
console.log('Has formatResults:', typeof p.formatResults === 'function');

// Test tool definition
const def = p.getToolDefinition();
console.log('Tool definition name:', def.function.name);
console.log('Parameters:', Object.keys(def.function.parameters.properties || {}));
"
```

---

## Publishing to npm

### Step 1: Prepare for Publishing

1. Update `README.md` with:
   - Tool description and capabilities
   - Installation instructions
   - Configuration options
   - Example usage and output
   - License information

2. Verify `package.json` has correct metadata:
   - `name` matches manifest name
   - `version` matches manifest version
   - `files` array includes all necessary files
   - `keywords` includes "quilltap", "quilltap-plugin", "tool"

### Step 2: Test Package Contents

```bash
# Preview what will be published
npm pack --dry-run

# Create a tarball to inspect
npm pack
tar -tzf qtap-plugin-calculator-1.0.0.tgz
```

### Step 3: Login to npm

```bash
npm login
```

### Step 4: Publish

```bash
# For first publish
npm publish --access public

# For updates
npm version patch  # or minor, major
npm publish
```

### Step 5: Verify Publication

```bash
npm info qtap-plugin-calculator
```

Users can now install your tool:

```bash
# In Quilltap Settings > Plugins, search for your tool
# Or via CLI:
npm install qtap-plugin-calculator
```

---

## Complete Example

Here's the complete `curl` tool plugin that ships with Quilltap as a reference:

### Directory Structure

```
qtap-plugin-curl/
├── package.json
├── manifest.json
├── index.ts           # Main plugin export
├── types.ts           # TypeScript interfaces
├── curl-tool.ts       # Tool definition
├── curl-handler.ts    # HTTP execution logic
├── url-validator.ts   # URL security validation
├── esbuild.config.mjs
├── tsconfig.json
└── README.md
```

### Key Implementation Patterns

**manifest.json** with configuration:
```json
{
  "capabilities": ["TOOL_PROVIDER"],
  "category": "TOOLS",
  "toolConfig": {
    "toolName": "curl",
    "displayName": "curl",
    "description": "Make HTTP requests",
    "requiresConfiguration": true
  },
  "configSchema": [
    {
      "key": "allowedUrlPatterns",
      "label": "Allowed URL Patterns",
      "type": "textarea",
      "default": ""
    },
    {
      "key": "maxResponseSize",
      "label": "Max Response Size",
      "type": "number",
      "default": 102400
    }
  ]
}
```

**isConfigured check:**
```typescript
isConfigured(config: Record<string, unknown>): boolean {
  const patterns = config.allowedUrlPatterns;
  if (typeof patterns !== 'string') return false;

  const lines = patterns
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));

  return lines.length > 0;
}
```

**Formatted output:**
```typescript
function formatCurlOutput(output: CurlToolOutput): string {
  if (!output.success) {
    return `curl request failed: ${output.error}`;
  }

  const lines: string[] = [];
  lines.push(`HTTP ${output.statusCode} ${output.statusText}`);
  lines.push('');

  if (output.headers) {
    lines.push('Response Headers:');
    for (const [key, value] of Object.entries(output.headers)) {
      lines.push(`  ${key}: ${value}`);
    }
  }

  if (output.body) {
    lines.push('');
    lines.push('Response Body:');
    lines.push(output.body);
  }

  return lines.join('\n');
}
```

---

## Troubleshooting

### Tool Not Appearing

1. Check manifest.json has `"capabilities": ["TOOL_PROVIDER"]`
2. Verify `main` field points to `index.js`
3. Ensure the plugin exports a valid `plugin` object
4. Check Quilltap logs for loading errors

### Tool Not Being Called by LLM

1. Verify tool definition is well-formed
2. Make the description clear about when to use the tool
3. Check if the tool requires configuration (and is configured)
4. Ensure parameters are described helpfully for the LLM

### Execution Errors

1. Check your `validateInput` function
2. Verify error handling in `execute` method
3. Look at Quilltap server logs for stack traces
4. Test the execution logic independently

### Build Errors

1. Ensure `@quilltap/plugin-types` is at version 1.6.0+
2. Check that esbuild.config.mjs marks dependencies as external
3. Verify TypeScript configuration is correct

---

## Resources

- [Quilltap Plugin Manifest Reference](./PLUGIN_MANIFEST.md)
- [@quilltap/plugin-types Package](../packages/plugin-types/README.md)
- [@quilltap/plugin-utils Package](../packages/plugin-utils/README.md)
- [curl Plugin Reference](../plugins/dist/qtap-plugin-curl/) - Built-in implementation

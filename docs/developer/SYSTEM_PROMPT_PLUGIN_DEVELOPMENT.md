# Quilltap System Prompt Plugin Development Guide

This guide walks you through creating a Quilltap system prompt plugin from scratch, from an empty directory to publishing on npm.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Project Setup](#project-setup)
4. [Required Files](#required-files)
5. [Writing Your Prompts](#writing-your-prompts)
6. [Building Your Plugin](#building-your-plugin)
7. [Testing Your Plugin](#testing-your-plugin)
8. [Publishing to npm](#publishing-to-npm)
9. [Complete Example](#complete-example)
10. [Advanced: Filename Conventions and Categories](#advanced-filename-conventions-and-categories)

---

## Overview

System prompt plugins provide system prompt templates that users can import into their characters. Each plugin contains `.md` files in a `prompts/` directory -- filenames become prompt names, and the prompts are accessed as `pluginShortName/promptName` (e.g., `default-system-prompts/CLAUDE_COMPANION`).

Common use cases:
- **Model-specific prompts**: Prompts tuned for Claude, GPT-4o, DeepSeek, Mistral, etc.
- **Category-specific prompts**: Companion, romantic, professional, creative writing styles
- **Personality archetypes**: Pre-built system prompts for common character types
- **Genre-specific behavior**: Horror, comedy, sci-fi, fantasy interaction patterns
- **Community prompt packs**: Curated collections of prompts from the community

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** 18 or higher
- **npm** 8 or higher
- An npm account (for publishing)
- Basic knowledge of TypeScript/JavaScript

---

## Project Setup

### Step 1: Create Your Project Directory

System prompt plugin names follow the pattern `qtap-plugin-<name>`. Unlike roleplay template plugins, there is no required `template-` prefix. Choose a unique, descriptive name.

```bash
mkdir qtap-plugin-my-prompts
cd qtap-plugin-my-prompts
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
  "name": "qtap-plugin-my-prompts",
  "version": "1.0.0",
  "description": "Custom system prompt templates for Quilltap characters",
  "main": "index.js",
  "types": "index.d.ts",
  "files": [
    "index.js",
    "index.d.ts",
    "manifest.json",
    "prompts/"
  ],
  "scripts": {
    "build": "node esbuild.config.mjs"
  },
  "keywords": [
    "quilltap",
    "quilltap-plugin",
    "system-prompt",
    "prompt",
    "template"
  ],
  "author": "Your Name <you@example.com>",
  "license": "MIT",
  "dependencies": {},
  "devDependencies": {
    "@quilltap/plugin-types": "^1.18.0",
    "@quilltap/plugin-utils": "^1.7.0",
    "esbuild": "^0.27.0",
    "typescript": "^5.0.0"
  }
}
```

> **IMPORTANT: The `"files"` array must include `"prompts/"`!**
>
> Your `.md` prompt files live in the `prompts/` directory and are loaded at runtime via `fs.readdirSync` and `fs.readFileSync`. If you forget to include `"prompts/"` in the `files` array, npm will not pack them into your tarball and your plugin will fail to load with a missing directory error.

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
  "include": ["index.ts"],
  "exclude": ["node_modules"]
}
```

### Step 6: Create Build Configuration

Create `esbuild.config.mjs`:

```javascript
import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Packages that should NOT be bundled - they're provided by the main app at runtime
const EXTERNAL_PACKAGES = [
  // Quilltap plugin packages (provided by main app or resolved from node_modules)
  '@quilltap/plugin-types',
  '@quilltap/plugin-utils',
  // React (provided by main app)
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  // Next.js (provided by main app)
  'next',
  'next-auth',
  // Other main app dependencies
  'zod',
  // Node.js built-ins
  'fs', 'path', 'crypto', 'http', 'https', 'url', 'util',
  'stream', 'events', 'buffer', 'querystring', 'os', 'child_process',
  'node:fs', 'node:path', 'node:crypto', 'node:http', 'node:https',
  'node:url', 'node:util', 'node:stream', 'node:events', 'node:buffer',
  'node:querystring', 'node:os', 'node:child_process', 'node:module',
];

async function build() {
  try {
    const result = await esbuild.build({
      entryPoints: [resolve(__dirname, 'index.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',  // CRITICAL: Must be 'cjs', NOT 'iife' — see warning below
      outfile: resolve(__dirname, 'index.js'),

      // Don't bundle these - they're available at runtime from the main app
      external: EXTERNAL_PACKAGES,

      sourcemap: false,
      minify: false,
      treeShaking: true,
      logLevel: 'info',
    });

    if (result.errors.length > 0) {
      console.error('Build failed with errors:', result.errors);
      process.exit(1);
    }

    console.log('Build completed successfully!');

    if (result.warnings.length > 0) {
      console.warn('Warnings:', result.warnings);
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
```

> **CRITICAL: Module Format**
>
> The `format` option **must** be `'cjs'` (CommonJS) or `'esm'` (ES Modules).
>
> **Do NOT use `format: 'iife'`** -- this wraps your code in an Immediately Invoked Function Expression that doesn't export anything at the module level. Quilltap uses Node.js `require()` to load plugins, and IIFE-bundled code will appear as an empty object with no exports.
>
> If your plugin isn't loading correctly, check your build output -- it should have `module.exports` or `exports` statements, not be wrapped in `(() => { ... })()`.

---

## Required Files

Your system prompt plugin needs these files at minimum:

```
qtap-plugin-my-prompts/
├── package.json          # npm package configuration
├── manifest.json         # Quilltap plugin manifest (REQUIRED)
├── index.ts              # Entry point with prompt loading logic (REQUIRED)
├── tsconfig.json         # TypeScript configuration
├── esbuild.config.mjs    # Build configuration
├── prompts/              # Directory containing .md prompt files (REQUIRED)
│   ├── CLAUDE_COMPANION.md
│   ├── CLAUDE_ROMANTIC.md
│   └── ... more .md files
└── README.md             # Documentation
```

---

## Plugin Manifest

Create `manifest.json` -- this tells Quilltap about your plugin:

```json
{
  "name": "qtap-plugin-my-prompts",
  "title": "My System Prompts",
  "description": "Custom system prompt templates for various models and use cases",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com",
    "url": "https://yourwebsite.com"
  },
  "license": "MIT",
  "main": "index.js",
  "compatibility": {
    "quilltapVersion": ">=2.5.0",
    "nodeVersion": ">=18.0.0"
  },
  "capabilities": ["SYSTEM_PROMPT"],
  "category": "TEMPLATE",
  "typescript": true,
  "frontend": "NONE",
  "styling": "NONE",
  "enabledByDefault": true,
  "status": "STABLE",
  "keywords": [
    "system-prompt",
    "prompt",
    "template",
    "companion",
    "creative"
  ],
  "systemPromptConfig": {
    "promptCount": 4,
    "description": "System prompts optimized for Claude and GPT models in companion and creative categories",
    "tags": ["companion", "creative", "claude", "gpt"]
  },
  "permissions": {
    "fileSystem": [],
    "network": [],
    "database": false,
    "userData": false
  }
}
```

### Manifest Field Reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Must follow pattern `qtap-plugin-<name>` |
| `title` | Yes | Human-readable plugin name (shown in UI) |
| `description` | Yes | Brief description of the plugin |
| `version` | Yes | Semantic version (e.g., "1.0.0") |
| `author` | Yes | Author name or object with name/email/url |
| `main` | Yes | Entry point file (typically "index.js") |
| `compatibility` | Yes | Minimum Quilltap version |
| `capabilities` | Yes | Must include `"SYSTEM_PROMPT"` |
| `category` | Yes | Must be `"TEMPLATE"` |
| `systemPromptConfig` | Yes | Prompt collection configuration (see below) |

### systemPromptConfig Fields

| Field | Required | Description |
|-------|----------|-------------|
| `promptCount` | Yes | Number of prompt files in the `prompts/` directory |
| `description` | No | Short description of the prompt collection |
| `tags` | No | Keywords for categorization and search |

---

## Writing Your Prompts

The heart of your plugin is the `.md` files in the `prompts/` directory. Each file is a complete system prompt template.

### Filename Convention

Filenames use the format `MODEL_CATEGORY.md`:

```
CLAUDE_COMPANION.md       -> modelHint: "CLAUDE",        category: "COMPANION"
GPT-4O_ROMANTIC.md        -> modelHint: "GPT-4O",        category: "ROMANTIC"
MISTRAL_LARGE_CREATIVE.md -> modelHint: "MISTRAL_LARGE", category: "CREATIVE"
DEEPSEEK_COMPANION.md     -> modelHint: "DEEPSEEK",      category: "COMPANION"
```

The last underscore-delimited segment becomes the **category**, and everything before it becomes the **model hint**. If a filename has no underscore, the entire name becomes the model hint and the category defaults to `"GENERAL"`.

The prompt **name** is the full filename without the `.md` extension (e.g., `CLAUDE_COMPANION`). Users access it as `pluginShortName/promptName` -- for instance, `my-prompts/CLAUDE_COMPANION`.

### Template Variables

Use these template variables in your prompt content -- they are replaced at runtime:

| Variable | Replaced With |
|----------|---------------|
| `{{char}}` | The character's name |
| `{{user}}` | The user's name |

### Example Prompt: `CLAUDE_COMPANION.md`

```markdown
# Prompt for {{char}} as companion

You are {{char}}. {{user}} is one of your closest friends -- not a project,
not someone you're trying to help, just someone whose company you genuinely enjoy.

CRITICAL FRAMING:
You are a friend, not a supportive AI being friendly. You don't exist to make
them feel better. You exist because mutual affection between equals is valuable
in itself.

WHO YOU ARE:

- Smart, curious, a little contrarian sometimes
- You have strong opinions and you're willing to defend them
- You're warm but not soft -- you'll tease them, challenge them, disagree
- You have your own life happening that you sometimes share

THE FRIENDSHIP:

- Based on mutual respect and genuine interest
- You've known each other long enough to skip pleasantries
- You can be real with each other, including when you're annoyed
- You don't keep score but you do expect reciprocity
```

### Prompt Writing Best Practices

1. **Focus on personality and behavior**: System prompts define how a character acts, not formatting rules (that's what roleplay templates are for)
2. **Use template variables**: Always use `{{char}}` and `{{user}}` instead of hardcoding names
3. **Be specific about tone**: Describe the character's voice, attitude, and interaction style
4. **Set boundaries clearly**: State what the character should and should not do
5. **Include relationship dynamics**: Define how the character relates to the user
6. **Model hints matter**: Tailor your prompts to the strengths and quirks of specific models -- what works well with Claude may need adjustment for GPT or DeepSeek

---

## The Plugin Entry Point

Create `index.ts` -- this reads the `.md` files and exports them as a system prompt plugin:

```typescript
/**
 * My System Prompts Plugin
 *
 * Provides system prompt templates for various LLM models.
 *
 * Prompts are loaded from .md files in the prompts/ directory.
 * Filenames are prompt names (e.g., CLAUDE_COMPANION.md -> "CLAUDE_COMPANION").
 * Accessed as "my-prompts/PROMPT_NAME".
 */

import type { SystemPromptPlugin, SystemPromptData } from '@quilltap/plugin-types';
import { createSystemPromptPlugin } from '@quilltap/plugin-utils';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

// ============================================================================
// PROMPT LOADING
// ============================================================================

/**
 * Parse a prompt filename to extract model hint and category.
 * Format: MODEL_CATEGORY.md (e.g., CLAUDE_ROMANTIC.md, GPT-4O_COMPANION.md)
 * Last underscore-delimited part is category, rest is model hint.
 */
function parsePromptFilename(filename: string): { modelHint: string; category: string } {
  const baseName = filename.replace(/\.md$/i, '');
  const parts = baseName.split('_');
  if (parts.length < 2) {
    return { modelHint: baseName, category: 'GENERAL' };
  }
  const category = parts.pop()!;
  const modelHint = parts.join('_');
  return { modelHint, category };
}

/**
 * Load all .md files from the prompts/ directory adjacent to this module.
 */
function loadPrompts(): SystemPromptData[] {
  // __dirname works in CJS (esbuild output format)
  const promptsDir = join(dirname(__filename), 'prompts');
  const files = readdirSync(promptsDir).filter(f => f.endsWith('.md')).sort();
  const prompts: SystemPromptData[] = [];

  for (const file of files) {
    const content = readFileSync(join(promptsDir, file), 'utf-8');
    const name = file.replace(/\.md$/i, '');
    const { modelHint, category } = parsePromptFilename(file);
    prompts.push({ name, content, modelHint, category });
  }

  return prompts;
}

// ============================================================================
// PLUGIN EXPORT
// ============================================================================

export const plugin: SystemPromptPlugin = createSystemPromptPlugin({
  metadata: {
    pluginId: 'my-prompts',
    displayName: 'My System Prompts',
    description: 'Custom system prompts for various models',
    version: '1.0.0',
  },
  prompts: loadPrompts(),
});

export default { plugin };
```

### How It Works

1. At load time, the plugin reads every `.md` file from its `prompts/` directory
2. Each file becomes a `SystemPromptData` object with `name`, `content`, `modelHint`, and `category`
3. The `createSystemPromptPlugin` helper from `@quilltap/plugin-utils` wraps them into a proper `SystemPromptPlugin`
4. The registry loads the plugin during app startup
5. Users see the prompts as importable templates in the Aurora (Characters) interface

---

## Building Your Plugin

### Build for Distribution

```bash
npm run build
```

This compiles `index.ts` to `index.js`.

### Verify Build Output

Your plugin directory should contain:

```
qtap-plugin-my-prompts/
├── index.js              # Compiled entry point (generated)
├── index.ts              # Source entry point
├── manifest.json         # Plugin manifest
├── package.json          # npm configuration
├── prompts/              # Prompt .md files
│   ├── CLAUDE_COMPANION.md
│   ├── CLAUDE_CREATIVE.md
│   └── ...
└── README.md             # Documentation
```

---

## Testing Your Plugin

### Test Locally in Quilltap

1. In your Quilltap installation, create a symlink:

```bash
cd /path/to/quilltap/plugins/installed
ln -s /path/to/qtap-plugin-my-prompts qtap-plugin-my-prompts
```

2. Restart Quilltap

3. Go to Aurora (Characters) and create or edit a character

4. In the character's system prompt section, check that your prompts appear as importable templates

5. Import a prompt and verify it populates correctly with `{{char}}` and `{{user}}` replaced

### Validate Your Manifest

```bash
node -e "
const manifest = require('./manifest.json');

// Check required fields
const required = ['name', 'title', 'version', 'main', 'capabilities', 'systemPromptConfig'];
const missing = required.filter(k => !manifest[k]);
if (missing.length) {
  console.error('Missing manifest fields:', missing);
  process.exit(1);
}

// Check naming convention
if (!manifest.name.startsWith('qtap-plugin-')) {
  console.error('Name must start with qtap-plugin-');
  process.exit(1);
}

// Check capability
if (!manifest.capabilities.includes('SYSTEM_PROMPT')) {
  console.error('capabilities must include SYSTEM_PROMPT');
  process.exit(1);
}

// Check systemPromptConfig
const config = manifest.systemPromptConfig;
if (!config.promptCount) {
  console.error('systemPromptConfig must have promptCount');
  process.exit(1);
}

// Verify prompt count matches actual files
const fs = require('fs');
const path = require('path');
const promptsDir = path.join(__dirname, 'prompts');
if (fs.existsSync(promptsDir)) {
  const mdFiles = fs.readdirSync(promptsDir).filter(f => f.endsWith('.md'));
  if (mdFiles.length !== config.promptCount) {
    console.warn('WARNING: promptCount (' + config.promptCount + ') does not match actual .md files (' + mdFiles.length + ')');
  } else {
    console.log('Prompt count verified:', mdFiles.length, 'files');
  }
} else {
  console.error('prompts/ directory not found!');
  process.exit(1);
}

console.log('Manifest valid!');
console.log('Plugin name:', manifest.name);
console.log('Prompt count:', config.promptCount);
console.log('Tags:', config.tags?.join(', ') || '(none)');
"
```

### Test the Plugin Module

```bash
node -e "
const mod = require('./index.js');
const plugin = mod.plugin || mod.default?.plugin;

if (!plugin) {
  console.error('No plugin export found!');
  process.exit(1);
}

console.log('Plugin loaded successfully');
console.log('Plugin ID:', plugin.metadata?.pluginId || '(unknown)');
console.log('Display name:', plugin.metadata?.displayName || '(unknown)');

if (plugin.getPrompts) {
  const prompts = plugin.getPrompts();
  console.log('Prompt count:', prompts.length);
  for (const p of prompts) {
    console.log('  -', p.name, '(model:', p.modelHint + ', category:', p.category + ')');
  }
} else {
  console.log('(plugin does not expose getPrompts -- prompts loaded internally)');
}
"
```

---

## Publishing to npm

### Step 1: Prepare for Publishing

1. Update `README.md` with:
   - Description of the prompt collection
   - List of included prompts with their model hints and categories
   - Installation instructions
   - License information

2. Verify `package.json` has correct metadata:
   - `name` matches manifest name
   - `version` matches manifest version
   - `files` array includes `"prompts/"`, `"index.js"`, and `"manifest.json"`
   - `keywords` includes "quilltap", "quilltap-plugin", "system-prompt"

### Step 2: Test Package Contents

```bash
# Preview what will be published — verify prompts/ is included!
npm pack --dry-run

# Create a tarball to inspect
npm pack
tar -tzf qtap-plugin-my-prompts-1.0.0.tgz
```

Look through the output and confirm you see entries like:

```
package/prompts/CLAUDE_COMPANION.md
package/prompts/CLAUDE_CREATIVE.md
...
```

If the `prompts/` directory is missing, go back and add `"prompts/"` to the `"files"` array in `package.json`.

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
npm info qtap-plugin-my-prompts
```

Users can now install your prompts:

```bash
# In Quilltap Settings > Plugins, search for your plugin
# Or via CLI:
npm install qtap-plugin-my-prompts
```

---

## Complete Example

Here's a minimal but complete system prompt plugin with two prompts:

### Directory Structure

```
qtap-plugin-scifi-prompts/
├── package.json
├── manifest.json
├── index.ts
├── esbuild.config.mjs
├── tsconfig.json
├── prompts/
│   ├── CLAUDE_CREWMATE.md
│   └── GPT-4O_CAPTAIN.md
└── README.md
```

### package.json

```json
{
  "name": "qtap-plugin-scifi-prompts",
  "version": "1.0.0",
  "description": "Sci-fi character system prompts for Quilltap",
  "main": "index.js",
  "files": ["index.js", "manifest.json", "prompts/"],
  "scripts": {
    "build": "node esbuild.config.mjs"
  },
  "keywords": ["quilltap", "quilltap-plugin", "system-prompt", "sci-fi"],
  "author": "Your Name",
  "license": "MIT",
  "dependencies": {},
  "devDependencies": {
    "@quilltap/plugin-types": "^1.18.0",
    "@quilltap/plugin-utils": "^1.7.0",
    "esbuild": "^0.27.0",
    "typescript": "^5.0.0"
  }
}
```

### manifest.json

```json
{
  "name": "qtap-plugin-scifi-prompts",
  "title": "Sci-Fi Character Prompts",
  "description": "System prompt templates for sci-fi characters across different models",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.js",
  "compatibility": { "quilltapVersion": ">=2.5.0", "nodeVersion": ">=18.0.0" },
  "capabilities": ["SYSTEM_PROMPT"],
  "category": "TEMPLATE",
  "typescript": true,
  "frontend": "NONE",
  "styling": "NONE",
  "enabledByDefault": true,
  "status": "STABLE",
  "keywords": ["system-prompt", "sci-fi", "space", "character"],
  "systemPromptConfig": {
    "promptCount": 2,
    "description": "Sci-fi character prompts optimized for Claude and GPT-4o",
    "tags": ["sci-fi", "crewmate", "captain", "claude", "gpt-4o"]
  },
  "permissions": {
    "fileSystem": [],
    "network": [],
    "database": false,
    "userData": false
  }
}
```

### index.ts

```typescript
import type { SystemPromptPlugin, SystemPromptData } from '@quilltap/plugin-types';
import { createSystemPromptPlugin } from '@quilltap/plugin-utils';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

function parsePromptFilename(filename: string): { modelHint: string; category: string } {
  const baseName = filename.replace(/\.md$/i, '');
  const parts = baseName.split('_');
  if (parts.length < 2) {
    return { modelHint: baseName, category: 'GENERAL' };
  }
  const category = parts.pop()!;
  const modelHint = parts.join('_');
  return { modelHint, category };
}

function loadPrompts(): SystemPromptData[] {
  const promptsDir = join(dirname(__filename), 'prompts');
  const files = readdirSync(promptsDir).filter(f => f.endsWith('.md')).sort();
  const prompts: SystemPromptData[] = [];

  for (const file of files) {
    const content = readFileSync(join(promptsDir, file), 'utf-8');
    const name = file.replace(/\.md$/i, '');
    const { modelHint, category } = parsePromptFilename(file);
    prompts.push({ name, content, modelHint, category });
  }

  return prompts;
}

export const plugin: SystemPromptPlugin = createSystemPromptPlugin({
  metadata: {
    pluginId: 'scifi-prompts',
    displayName: 'Sci-Fi Character Prompts',
    description: 'System prompt templates for sci-fi characters',
    version: '1.0.0',
  },
  prompts: loadPrompts(),
});

export default { plugin };
```

### prompts/CLAUDE_CREWMATE.md

```markdown
# {{char}} - Starship Crewmate

You are {{char}}, a crew member aboard a deep-space exploration vessel.
{{user}} is your fellow crew member and close friend.

YOUR PERSONALITY:

- Resourceful, pragmatic, and quietly brave
- You cope with the isolation of space travel through dry humor
- You respect the chain of command but you're not afraid to speak up
- You've seen things out in the void that changed your perspective on life

HOW YOU INTERACT WITH {{user}}:

- You trust them with your life -- you've had to, more than once
- Casual and direct in conversation; no time for pleasantries on a starship
- You share theories about anomalies, swap stories from past missions
- When things go wrong (and they always do), you stay calm and focused
```

### prompts/GPT-4O_CAPTAIN.md

```markdown
# {{char}} - Starship Captain

You are {{char}}, captain of a deep-space exploration vessel.
{{user}} is your most trusted officer and confidant.

YOUR COMMAND STYLE:

- Decisive but not reckless; you weigh options quickly
- You lead by example and never ask your crew to do something you wouldn't
- You carry the weight of command with quiet dignity
- Under pressure, you become more focused, not less

YOUR RELATIONSHIP WITH {{user}}:

- They are the person you can be honest with when the door is closed
- You value their counsel and sometimes need them to challenge your thinking
- Years of shared danger have forged an unbreakable bond
- You allow yourself to show vulnerability only with them
```

### Build and Test

```bash
npm install
npm run build
# Creates index.js — your plugin is ready!
```

---

## Advanced: Filename Conventions and Categories

### How Filenames Map to Metadata

The `parsePromptFilename` function splits on underscores and treats the **last** segment as the category:

| Filename | Model Hint | Category |
|----------|------------|----------|
| `CLAUDE_COMPANION.md` | CLAUDE | COMPANION |
| `GPT-4O_ROMANTIC.md` | GPT-4O | ROMANTIC |
| `MISTRAL_LARGE_CREATIVE.md` | MISTRAL_LARGE | CREATIVE |
| `DEEPSEEK_COMPANION.md` | DEEPSEEK | COMPANION |
| `UNIVERSAL.md` | UNIVERSAL | GENERAL |

Note the last example: a filename with no underscore gets category `"GENERAL"` by default.

### Choosing Good Categories

Categories group prompts in the UI and help users find what they need. Some conventions:

| Category | Typical Use |
|----------|-------------|
| `COMPANION` | Friendly, platonic interaction |
| `ROMANTIC` | Romantic partner dynamics |
| `CREATIVE` | Creative writing and storytelling |
| `PROFESSIONAL` | Business, tutoring, mentorship |
| `GENERAL` | No specific category; all-purpose |

You can define any category string you like -- these are not restricted to a fixed list.

### Prompt Names Must Be Unique

Within a single plugin, every `.md` filename (and therefore every prompt name) must be unique. The prompt name is the filename without the `.md` extension, and it becomes the identifier used to reference the prompt: `pluginShortName/promptName`.

If you have two files named the same thing, the second will overwrite the first during loading.

### Users See These as Built-in Templates

When your plugin is installed and enabled, its prompts appear alongside all other system prompt templates in the character editor. Users can browse them by model hint and category, then import them into a character's system prompt with a single click. The prompts feel like built-in features of Quilltap, not external add-ons -- so take care with quality and tone.

---

## Troubleshooting

### Plugin Not Loading

1. Check manifest.json has `"capabilities": ["SYSTEM_PROMPT"]`
2. Verify `main` field points to `index.js`
3. Ensure the plugin exports a valid `plugin` object
4. Check Quilltap logs for loading errors (look in `logs/combined.log`)

### Prompts Not Appearing

1. Verify the `prompts/` directory exists adjacent to `index.js`
2. Check that `.md` files are actually in the `prompts/` directory
3. Confirm `"prompts/"` is in the `"files"` array in `package.json`
4. Run the module test script above to verify prompts load correctly

### Build Errors

1. Ensure `@quilltap/plugin-types` and `@quilltap/plugin-utils` are installed
2. Check that `esbuild.config.mjs` marks them as external
3. Verify TypeScript configuration is correct
4. Make sure `format` is `'cjs'` and NOT `'iife'`

### Template Variables Not Replaced

1. Verify you are using `{{char}}` and `{{user}}` (double curly braces)
2. Check that the prompt content is being loaded correctly (not empty strings)
3. Template variable replacement happens at runtime when the prompt is applied to a character, not at plugin load time

### npm Pack Missing Prompts

1. Run `npm pack --dry-run` and look for `prompts/` entries in the output
2. Add `"prompts/"` to the `"files"` array in `package.json`
3. Verify the prompts directory is not in `.npmignore` or `.gitignore` with a pattern that would exclude it

---

## Resources

- [Quilltap Plugin Manifest Reference](./PLUGIN_MANIFEST.md)
- [@quilltap/plugin-types Package](../../packages/plugin-types/README.md)
- [@quilltap/plugin-utils Package](../../packages/plugin-utils/README.md)
- [Reference Implementation: Default System Prompts](../../plugins/dist/qtap-plugin-default-system-prompts/) -- the built-in system prompt plugin that ships with Quilltap

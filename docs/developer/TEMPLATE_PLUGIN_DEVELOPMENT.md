# Quilltap Roleplay Template Plugin Development Guide

> **DEPRECATED (v4.2.0):** The `ROLEPLAY_TEMPLATE` plugin capability has been removed. Roleplay templates are now native first-class entities managed through the Settings UI. Users can create, edit, and delete custom templates with configurable delimiters, rendering patterns, and CSS styles directly in the application. The built-in "Standard" and "Quilltap RP" templates ship natively. This guide is preserved for historical reference only.

This guide walks you through creating a Quilltap roleplay template plugin from scratch, from an empty directory to publishing on npm.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Project Setup](#project-setup)
4. [Required Files](#required-files)
5. [Writing Your Template](#writing-your-template)
6. [Building Your Plugin](#building-your-plugin)
7. [Testing Your Template](#testing-your-template)
8. [Publishing to npm](#publishing-to-npm)
9. [Complete Example](#complete-example)
10. [Advanced: Multiple Templates](#advanced-multiple-templates)

---

## Overview

Roleplay template plugins provide formatting instructions that guide how AI characters structure their responses. When a user selects a roleplay template, its system prompt is prepended to character instructions, ensuring consistent formatting across all responses.

Common use cases:
- **Dialogue formatting**: Quotation marks vs. bare text vs. screenplay format
- **Action notation**: Asterisks, brackets, italics, or prose
- **Thought representation**: Angle brackets, curly braces, or internal monologue style
- **OOC (Out of Character)**: How meta-commentary should be marked
- **Genre-specific styles**: Novel prose, screenplay, chat RP, forum RP

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

Template plugin names must follow the pattern `qtap-plugin-template-<name>`. Choose a unique, descriptive name.

```bash
mkdir qtap-plugin-template-screenplay
cd qtap-plugin-template-screenplay
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
  "name": "qtap-plugin-template-screenplay",
  "version": "1.0.0",
  "description": "Screenplay-style roleplay formatting for Quilltap",
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
    "roleplay",
    "template",
    "screenplay",
    "formatting"
  ],
  "author": "Your Name <you@example.com>",
  "license": "MIT",
  "dependencies": {},
  "devDependencies": {
    "@quilltap/plugin-types": "^1.2.0",
    "@quilltap/plugin-utils": "^1.2.0",
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
  "include": ["index.ts"],
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
  format: 'cjs',  // CRITICAL: Must be 'cjs' or 'esm', NOT 'iife'
  outfile: 'index.js',
  external: ['@quilltap/plugin-types', '@quilltap/plugin-utils'],
  sourcemap: false,
  minify: false,
});

console.log('Build complete: index.js');
```

> **⚠️ CRITICAL: Module Format**
>
> The `format` option **must** be `'cjs'` (CommonJS) or `'esm'` (ES Modules).
>
> **Do NOT use `format: 'iife'`** - this wraps your code in an Immediately Invoked Function Expression that doesn't export anything at the module level. Quilltap uses Node.js `require()` to load plugins, and IIFE-bundled code will appear as an empty object with no exports.
>
> If your plugin isn't loading correctly, check your build output - it should have `module.exports` or `exports` statements, not be wrapped in `(() => { ... })()`.

---

## Required Files

Your template plugin needs these files at minimum:

```
qtap-plugin-template-screenplay/
├── package.json          # npm package configuration
├── manifest.json         # Quilltap plugin manifest (REQUIRED)
├── index.ts              # Entry point with template definition (REQUIRED)
├── tsconfig.json         # TypeScript configuration
├── esbuild.config.mjs    # Build configuration
└── README.md             # Documentation
```

---

## Plugin Manifest

Create `manifest.json` - this tells Quilltap about your template:

```json
{
  "name": "qtap-plugin-template-screenplay",
  "title": "Screenplay Format",
  "description": "Hollywood screenplay-style formatting with scene headings, action lines, and dialogue",
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
  "capabilities": ["ROLEPLAY_TEMPLATE"],
  "category": "TEMPLATE",
  "typescript": true,
  "frontend": "NONE",
  "styling": "NONE",
  "enabledByDefault": true,
  "status": "STABLE",
  "keywords": ["roleplay", "template", "screenplay", "formatting", "hollywood"],
  "roleplayTemplateConfig": {
    "name": "Screenplay Format",
    "description": "Hollywood screenplay-style formatting with scene headings and character cues",
    "systemPrompt": "Your formatting instructions go here...",
    "tags": ["screenplay", "hollywood", "professional"]
  },
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
| `name` | Yes | Must match pattern `qtap-plugin-template-<name>` |
| `title` | Yes | Human-readable template name (shown in UI) |
| `description` | Yes | Brief description of the template |
| `version` | Yes | Semantic version (e.g., "1.0.0") |
| `author` | Yes | Author name or object with name/email/url |
| `main` | Yes | Entry point file (typically "index.js") |
| `compatibility` | Yes | Minimum Quilltap version |
| `capabilities` | Yes | Must include "ROLEPLAY_TEMPLATE" |
| `category` | Yes | Must be "TEMPLATE" |
| `roleplayTemplateConfig` | Yes | Template configuration (see below) |

### roleplayTemplateConfig Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name for the template |
| `description` | No | Short description of the formatting style |
| `systemPrompt` | Yes | The formatting instructions (see next section) |
| `tags` | No | Keywords for categorization and search |

---

## Writing Your Template

The heart of your plugin is the **system prompt** - the instructions that tell the AI how to format its responses.

### Entry Point with createSingleTemplatePlugin

Create `index.ts` using the `createSingleTemplatePlugin` helper:

```typescript
import type { RoleplayTemplatePlugin } from '@quilltap/plugin-types';
import { createSingleTemplatePlugin } from '@quilltap/plugin-utils';

/**
 * The system prompt that defines formatting rules.
 * This is prepended to character system prompts when the template is active.
 */
const SCREENPLAY_SYSTEM_PROMPT = `[FORMATTING PROTOCOL: SCREENPLAY STYLE]

You must format all responses using standard Hollywood screenplay conventions:

1. SCENE HEADINGS (Sluglines)
   - Use for location/time changes
   - Format: INT. or EXT. followed by LOCATION - TIME
   - Example: INT. COFFEE SHOP - DAY

2. ACTION LINES
   - Write in present tense
   - Describe what is seen and heard
   - Keep paragraphs short (3-4 lines max)
   - Example:
     Sarah enters the crowded cafe, scanning the room. She spots
     Marcus at a corner table and makes her way over.

3. CHARACTER CUES
   - Character name in CAPS, centered
   - Parentheticals in (lowercase) for tone/action
   - Dialogue below, not in quotes
   - Example:
                         SARAH
               (nervous)
     I wasn't sure you'd come.

4. TRANSITIONS
   - Use sparingly: CUT TO:, FADE TO:, DISSOLVE TO:
   - Right-aligned

5. IMPORTANT RULES
   - Never use quotation marks for dialogue
   - Never use asterisks for actions
   - Keep action descriptions visual and cinematic
   - Write what the camera sees, not internal thoughts`;

/**
 * The Screenplay roleplay template plugin.
 */
export const plugin: RoleplayTemplatePlugin = createSingleTemplatePlugin({
  templateId: 'screenplay',
  displayName: 'Screenplay Format',
  description: 'Hollywood screenplay-style formatting with scene headings, action lines, and dialogue',
  systemPrompt: SCREENPLAY_SYSTEM_PROMPT,
  author: {
    name: 'Your Name',
    email: 'you@example.com',
  },
  tags: ['screenplay', 'hollywood', 'professional', 'cinematic'],
  version: '1.0.0',
  enableLogging: true,
});

/**
 * Plugin initialization - called when the plugin is loaded.
 */
export function initialize(): void | Promise<void> {
  return plugin.initialize?.();
}

/**
 * Plugin metadata export (for backward compatibility)
 */
export const metadata = {
  name: 'qtap-plugin-template-screenplay',
  version: '1.0.0',
  type: 'ROLEPLAY_TEMPLATE',
} as const;

export default { plugin, initialize, metadata };
```

### System Prompt Best Practices

1. **Be Explicit**: Clearly state what format to use for each type of content
2. **Provide Examples**: Show exactly what correct output looks like
3. **State Prohibitions**: Explicitly say what NOT to do
4. **Keep it Focused**: Only include formatting rules, not character behavior
5. **Use Headers**: Organize rules into clear sections
6. **Number Rules**: Makes it easier for the AI to follow

### Common Formatting Elements

Here are formatting patterns commonly addressed in roleplay templates:

| Element | Common Approaches |
|---------|-------------------|
| Dialogue | Quotation marks, bare text, character cues |
| Actions | *asterisks*, [brackets], prose paragraphs |
| Thoughts | {braces}, <angle brackets>, *italics*, internal monologue |
| OOC/Meta | // prefix, ((parentheses)), [OOC: text] |
| Emphasis | **bold**, *italics*, CAPS |
| Scene breaks | ---, ***, blank lines |

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
qtap-plugin-template-screenplay/
├── index.js              # Compiled entry point (generated)
├── index.ts              # Source entry point
├── manifest.json         # Plugin manifest
├── package.json          # npm configuration
└── README.md             # Documentation
```

---

## Testing Your Template

### Test Locally in Quilltap

1. In your Quilltap installation, create a symlink:

```bash
cd /path/to/quilltap/plugins/installed
ln -s /path/to/qtap-plugin-template-screenplay qtap-plugin-template-screenplay
```

2. Restart Quilltap

3. Go to Settings > Roleplay Templates and verify your template appears

4. Create or edit a chat and select your template

5. Send messages and verify the AI follows your formatting rules

### Validate Your Plugin

```bash
node -e "
const manifest = require('./manifest.json');

// Check required fields
const required = ['name', 'title', 'version', 'main', 'capabilities', 'roleplayTemplateConfig'];
const missing = required.filter(k => !manifest[k]);
if (missing.length) {
  console.error('Missing manifest fields:', missing);
  process.exit(1);
}

// Check naming convention
if (!manifest.name.startsWith('qtap-plugin-template-')) {
  console.error('Name must start with qtap-plugin-template-');
  process.exit(1);
}

// Check capability
if (!manifest.capabilities.includes('ROLEPLAY_TEMPLATE')) {
  console.error('capabilities must include ROLEPLAY_TEMPLATE');
  process.exit(1);
}

// Check roleplayTemplateConfig
const config = manifest.roleplayTemplateConfig;
if (!config.name || !config.systemPrompt) {
  console.error('roleplayTemplateConfig must have name and systemPrompt');
  process.exit(1);
}

console.log('Manifest valid!');
console.log('Template name:', config.name);
console.log('System prompt length:', config.systemPrompt.length, 'characters');
"
```

### Test the Plugin Module

```bash
node -e "
const plugin = require('./index.js');
console.log('Plugin loaded successfully');
console.log('Metadata:', plugin.metadata || plugin.default?.metadata);
console.log('Has initialize:', typeof (plugin.initialize || plugin.default?.initialize) === 'function');
console.log('Has plugin export:', !!(plugin.plugin || plugin.default?.plugin));
"
```

---

## Publishing to npm

### Step 1: Prepare for Publishing

1. Update `README.md` with:
   - Template description and formatting examples
   - Installation instructions
   - Example output showing the format
   - License information

2. Verify `package.json` has correct metadata:
   - `name` matches manifest name
   - `version` matches manifest version
   - `files` array includes all necessary files
   - `keywords` includes "quilltap", "quilltap-plugin", "roleplay", "template"

### Step 2: Test Package Contents

```bash
# Preview what will be published
npm pack --dry-run

# Create a tarball to inspect
npm pack
tar -tzf qtap-plugin-template-screenplay-1.0.0.tgz
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
npm info qtap-plugin-template-screenplay
```

Users can now install your template:

```bash
# In Quilltap Settings > Plugins, search for your template
# Or via CLI:
npm install qtap-plugin-template-screenplay
```

---

## Complete Example

Here's a minimal but complete template plugin:

### Directory Structure

```
qtap-plugin-template-novel/
├── package.json
├── manifest.json
├── index.ts
├── esbuild.config.mjs
├── tsconfig.json
└── README.md
```

### package.json

```json
{
  "name": "qtap-plugin-template-novel",
  "version": "1.0.0",
  "description": "Novel prose-style roleplay formatting for Quilltap",
  "main": "index.js",
  "files": ["index.js", "manifest.json"],
  "scripts": {
    "build": "node esbuild.config.mjs"
  },
  "keywords": ["quilltap", "quilltap-plugin", "roleplay", "template", "novel"],
  "author": "Your Name",
  "license": "MIT",
  "dependencies": {},
  "devDependencies": {
    "@quilltap/plugin-types": "^1.2.0",
    "@quilltap/plugin-utils": "^1.2.0",
    "esbuild": "^0.20.0",
    "typescript": "^5.0.0"
  }
}
```

### manifest.json

```json
{
  "name": "qtap-plugin-template-novel",
  "title": "Novel Prose",
  "description": "Traditional novel prose style with flowing narrative",
  "version": "1.0.0",
  "author": "Your Name",
  "license": "MIT",
  "main": "index.js",
  "compatibility": { "quilltapVersion": ">=2.5.0" },
  "capabilities": ["ROLEPLAY_TEMPLATE"],
  "category": "TEMPLATE",
  "roleplayTemplateConfig": {
    "name": "Novel Prose",
    "description": "Traditional novel prose style with flowing narrative and dialogue in quotes",
    "systemPrompt": "[FORMATTING: NOVEL PROSE STYLE]\n\n1. NARRATIVE: Write in flowing prose paragraphs, third person past tense.\n\n2. DIALOGUE: Use quotation marks. Attribution after dialogue.\n   Example: \"I never expected to see you here,\" she said softly.\n\n3. ACTIONS: Integrate actions naturally into prose paragraphs.\n   Example: He set down his coffee cup and leaned forward.\n\n4. THOUGHTS: Use italics for internal thoughts.\n   Example: *This can't be happening*, she thought.\n\n5. SCENE BREAKS: Use a blank line between scenes.\n\n6. DO NOT use asterisks for actions, brackets, or roleplay notation.",
    "tags": ["novel", "prose", "narrative", "literary"]
  }
}
```

### index.ts

```typescript
import type { RoleplayTemplatePlugin } from '@quilltap/plugin-types';
import { createSingleTemplatePlugin } from '@quilltap/plugin-utils';

const NOVEL_SYSTEM_PROMPT = `[FORMATTING: NOVEL PROSE STYLE]

1. NARRATIVE: Write in flowing prose paragraphs, third person past tense.

2. DIALOGUE: Use quotation marks. Attribution after dialogue.
   Example: "I never expected to see you here," she said softly.

3. ACTIONS: Integrate actions naturally into prose paragraphs.
   Example: He set down his coffee cup and leaned forward.

4. THOUGHTS: Use italics for internal thoughts.
   Example: *This can't be happening*, she thought.

5. SCENE BREAKS: Use a blank line between scenes.

6. DO NOT use asterisks for actions, brackets, or roleplay notation.`;

export const plugin: RoleplayTemplatePlugin = createSingleTemplatePlugin({
  templateId: 'novel',
  displayName: 'Novel Prose',
  description: 'Traditional novel prose style with flowing narrative and dialogue in quotes',
  systemPrompt: NOVEL_SYSTEM_PROMPT,
  tags: ['novel', 'prose', 'narrative', 'literary'],
  version: '1.0.0',
  enableLogging: true,
});

export function initialize(): void | Promise<void> {
  return plugin.initialize?.();
}

export const metadata = {
  name: 'qtap-plugin-template-novel',
  version: '1.0.0',
  type: 'ROLEPLAY_TEMPLATE',
} as const;

export default { plugin, initialize, metadata };
```

### Build and Test

```bash
npm install
npm run build
# Creates index.js - your template is ready!
```

---

## Advanced: Multiple Templates

A single plugin can provide multiple templates using `createRoleplayTemplatePlugin`:

### index.ts with Multiple Templates

```typescript
import type { RoleplayTemplatePlugin } from '@quilltap/plugin-types';
import { createRoleplayTemplatePlugin } from '@quilltap/plugin-utils';

export const plugin: RoleplayTemplatePlugin = createRoleplayTemplatePlugin({
  metadata: {
    templateId: 'format-pack',
    displayName: 'RP Format Pack',
    description: 'A collection of popular roleplay formatting styles',
    author: 'Your Name',
    tags: ['roleplay', 'formatting', 'collection'],
    version: '1.0.0',
  },
  templates: [
    {
      name: 'Classic RP',
      description: 'Traditional asterisk actions and quoted dialogue',
      systemPrompt: `[CLASSIC RP FORMAT]
1. DIALOGUE: Use quotation marks. "Hello there."
2. ACTIONS: Use asterisks. *waves hello*
3. THOUGHTS: Use italics or angle brackets. <I wonder...>
4. OOC: Use double parentheses. ((brb))`,
      tags: ['classic', 'traditional'],
    },
    {
      name: 'Literate RP',
      description: 'Paragraph-based prose with no special notation',
      systemPrompt: `[LITERATE RP FORMAT]
Write in flowing prose paragraphs. Integrate dialogue, action, and
description naturally. Use quotation marks for dialogue only.
No asterisks, brackets, or special notation.`,
      tags: ['literate', 'prose', 'advanced'],
    },
    {
      name: 'Script RP',
      description: 'Script/screenplay style with character names',
      systemPrompt: `[SCRIPT RP FORMAT]
Character Name: Dialogue goes here
*Action descriptions in asterisks*
Scene directions in plain text`,
      tags: ['script', 'simple'],
    },
  ],
  enableLogging: true,
});

export function initialize(): void | Promise<void> {
  return plugin.initialize?.();
}

export const metadata = {
  name: 'qtap-plugin-template-format-pack',
  version: '1.0.0',
  type: 'ROLEPLAY_TEMPLATE',
} as const;

export default { plugin, initialize, metadata };
```

### Manifest for Multiple Templates

When providing multiple templates, the `roleplayTemplateConfig` in manifest.json should describe the collection:

```json
{
  "roleplayTemplateConfig": {
    "name": "RP Format Pack",
    "description": "A collection of popular roleplay formatting styles including Classic, Literate, and Script formats",
    "systemPrompt": "See individual templates",
    "tags": ["collection", "roleplay", "formatting"]
  }
}
```

---

## Troubleshooting

### Template Not Appearing

1. Check manifest.json has `"capabilities": ["ROLEPLAY_TEMPLATE"]`
2. Verify `main` field points to `index.js`
3. Ensure the plugin exports a valid `plugin` object
4. Check Quilltap logs for loading errors

### Template Not Working

1. Verify your system prompt is clear and unambiguous
2. Test with different AI models - some follow instructions better
3. Make the formatting rules more explicit with examples
4. Add "IMPORTANT" or "CRITICAL" markers for key rules

### Build Errors

1. Ensure `@quilltap/plugin-types` and `@quilltap/plugin-utils` are installed
2. Check that esbuild.config.mjs marks them as external
3. Verify TypeScript configuration is correct

---

## Resources

- [Quilltap Plugin Manifest Reference](./PLUGIN_MANIFEST.md)
- [@quilltap/plugin-types Package](../packages/plugin-types/README.md)
- [@quilltap/plugin-utils Package](../packages/plugin-utils/README.md)
- [Existing Templates](../plugins/dist/qtap-plugin-template-quilltap-rp/) - Reference implementation

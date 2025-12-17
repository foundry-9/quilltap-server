/**
 * esbuild configuration for qtap-plugin-anthropic
 *
 * Bundles the plugin with its SDK dependency into a single CommonJS file.
 * External packages (react, zod, etc.) are provided by the main app at runtime.
 */

import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Find the project root (3 levels up from plugin directory)
const projectRoot = resolve(__dirname, '..', '..', '..');

// Packages that should NOT be bundled - they're provided by the main app at runtime
const EXTERNAL_PACKAGES = [
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
  'fs',
  'path',
  'crypto',
  'http',
  'https',
  'url',
  'util',
  'stream',
  'events',
  'buffer',
  'querystring',
  'os',
  'child_process',
  'node:fs',
  'node:path',
  'node:crypto',
  'node:http',
  'node:https',
  'node:url',
  'node:util',
  'node:stream',
  'node:events',
  'node:buffer',
  'node:querystring',
  'node:os',
  'node:child_process',
  'node:module',
];

async function build() {
  try {
    const result = await esbuild.build({
      entryPoints: [resolve(__dirname, 'index.ts')],
      bundle: true,
      platform: 'node',
      target: 'node18',
      format: 'cjs',
      outfile: resolve(__dirname, 'index.js'),

      // Resolve @/ imports to project root
      alias: {
        '@': projectRoot,
      },

      // Don't bundle these - they're available at runtime from the main app
      external: EXTERNAL_PACKAGES,

      // Source maps for debugging (optional, can remove for smaller builds)
      sourcemap: false,

      // Minification (optional, disable for debugging)
      minify: false,

      // Tree shaking
      treeShaking: true,

      // Log level
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

    // Post-build patch: Fix @openrouter/sdk bug where tool_calls[].id doesn't accept null
    // The SDK schema has `id: z.string().optional()` but some models return null for id
    // This patch changes it to `id: z.nullable(z.string()).optional()`
    // See: https://github.com/openrouter/sdk issue (upstream bug)
    applyOpenRouterSdkPatch(resolve(__dirname, 'index.js'));

  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

/**
 * Patches the bundled index.js to fix @openrouter/sdk streaming schema bug.
 * The SDK doesn't accept null for tool_calls[].id but some models return null.
 */
function applyOpenRouterSdkPatch(filePath) {
  try {
    let content = readFileSync(filePath, 'utf-8');

    // Pattern: ChatStreamingMessageToolCall schema with non-nullable id
    const oldPattern = /var ChatStreamingMessageToolCall\$inboundSchema = (z\d+)\.object\(\{\s*index: \1\.number\(\),\s*id: \1\.string\(\)\.optional\(\),/g;
    const newPattern = 'var ChatStreamingMessageToolCall$inboundSchema = $1.object({\n  index: $1.number(),\n  id: $1.nullable($1.string()).optional(),';

    if (oldPattern.test(content)) {
      content = content.replace(oldPattern, newPattern);
      writeFileSync(filePath, content, 'utf-8');
      console.log('Applied OpenRouter SDK patch: tool_calls[].id now accepts null');
    } else {
      console.log('OpenRouter SDK patch: pattern not found (may already be fixed upstream)');
    }
  } catch (error) {
    console.warn('Warning: Could not apply OpenRouter SDK patch:', error.message);
  }
}

build();

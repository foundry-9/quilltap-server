/**
 * esbuild configuration for qtap-plugin-upgrade
 *
 * Bundles the plugin with its dependencies into a single CommonJS file.
 * External packages (react, zod, next, etc.) are provided by the main app at runtime.
 *
 * IMPORTANT: This plugin runs during container startup BEFORE Next.js is fully
 * initialized, so it must NOT bundle any Next.js dependencies. We externalize
 * all @/lib/* paths to be resolved at runtime via dynamic imports.
 */

import * as esbuild from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  // Next.js (provided by main app) - externalize ALL next/* subpaths
  'next',
  'next/*',
  'next/server',
  'next/headers',
  'next/navigation',
  'next-auth',
  'next-auth/*',
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
  // App package.json - read at runtime to avoid bundling version changes
  '@/package.json',
  // Also handle resolved path (alias resolves before external check)
  '../../../package.json',
  '*/package.json',
  '../package.json',
  // AWS SDK packages - these are provided by the main app and have internal package.json refs
  '@aws-sdk/*',
  '@smithy/*',
  // App library paths - resolved at runtime via dynamic imports
  // This prevents bundling app code that may depend on Next.js internals
  '@/lib/*',
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
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();

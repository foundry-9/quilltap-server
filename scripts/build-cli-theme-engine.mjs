#!/usr/bin/env node
/**
 * Bundles the theme engine for the `quilltap themes` CLI
 * (lib/themes/cli/index.ts → packages/quilltap/lib/theme-engine.generated.js).
 *
 * The output is generated, committed and never edited. zod and postcss are
 * bundled in, so the CLI gains no dependency; yauzl stays external (the CLI
 * already depends on it). The app logger is swapped for lib/themes/cli/logger.ts.
 *
 *   node scripts/build-cli-theme-engine.mjs           write the file
 *   node scripts/build-cli-theme-engine.mjs --check   fail when it is stale (npm run lint)
 */

import { build } from 'esbuild';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'packages/quilltap/lib/theme-engine.generated.js';
const check = process.argv.includes('--check');

const LOGGER_STUB = path.join(ROOT, 'lib/themes/cli/logger.ts');

/** Resolve `@/…` to the repo root and every route to the app logger to the stub. */
const resolvePlugin = {
  name: 'quilltap-paths',
  setup(b) {
    b.onResolve({ filter: /^@\/lib\/logger$/ }, () => ({ path: LOGGER_STUB }));
    b.onResolve({ filter: /(^|\/)logger$/ }, (args) => {
      const target = path.resolve(args.resolveDir, args.path);
      return target === path.join(ROOT, 'lib/logger') ? { path: LOGGER_STUB } : undefined;
    });
    b.onResolve({ filter: /^@\// }, async (args) =>
      b.resolve(`./${args.path.slice(2)}`, { resolveDir: ROOT, kind: args.kind })
    );
  },
};

const result = await build({
  entryPoints: [path.join(ROOT, 'lib/themes/cli/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['yauzl'],
  plugins: [resolvePlugin],
  write: false,
  legalComments: 'none',
  minify: true,
  keepNames: true,
  logLevel: 'warning',
  absWorkingDir: ROOT,
  charset: 'utf8',
});

const header =
  '// GENERATED FILE — DO NOT EDIT BY HAND.\n' +
  '// The Quilltap theme engine for the CLI, bundled from lib/themes/cli/index.ts\n' +
  '// by scripts/build-cli-theme-engine.mjs. Regenerate with `npm run build:cli-theme-engine`.\n';
const output = header + result.outputFiles[0].text;

const outPath = path.join(ROOT, OUT);
if (check) {
  const committed = existsSync(outPath) ? readFileSync(outPath, 'utf8') : null;
  if (committed !== output) {
    console.error(`check-cli-theme-engine: ${OUT} is ${committed === null ? 'missing' : 'stale'}: run \`npm run build:cli-theme-engine\`.`);
    process.exit(1);
  }
  console.log(`check-cli-theme-engine: ${OUT} is current.`);
} else {
  writeFileSync(outPath, output, 'utf8');
  console.log(`Wrote ${OUT} (${Math.round(output.length / 1024)} KB)`);
}

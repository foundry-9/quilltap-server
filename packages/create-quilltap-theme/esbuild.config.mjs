import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/index.js',
  banner: {
    js: '#!/usr/bin/env node',
  },
  sourcemap: false,
  minify: false,
});

console.log('Build complete: dist/index.js');

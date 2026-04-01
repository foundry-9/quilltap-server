import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['index.ts'],
  bundle: true,
  outfile: 'index.js',
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: [
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
  ],
  sourcemap: false,
  minify: false,
});

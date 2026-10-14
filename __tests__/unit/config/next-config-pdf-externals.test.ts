/**
 * @jest-environment node
 *
 * Regression test for bug 178 — PDF text extraction failed in every packaged
 * build with `DOMMatrix is not defined`. pdfjs-dist finds `@napi-rs/canvas`
 * (its DOMMatrix polyfill) through `createRequire(import.meta.url)`; when
 * webpack bundled `pdf-parse`, that URL was baked to the build machine's path
 * and the polyfill never loaded. The fix makes `pdf-parse` a server external
 * and traces `pdf-parse` / `pdfjs-dist` (and the canvas backend) into the
 * standalone output. Dropping any of these entries brings the bug back in the
 * tarball and Docker image while dev keeps working, so only a check on the
 * config itself catches it.
 */

import path from 'path';

const nextConfig = require(path.join(__dirname, '..', '..', '..', 'next.config.js'));

describe('next.config.js — PDF extraction packages (bug 178)', () => {
  it('loads pdf-parse and the canvas backend natively, not bundled', () => {
    expect(nextConfig.serverExternalPackages).toEqual(
      expect.arrayContaining(['pdf-parse', '@napi-rs/canvas'])
    );
  });

  it('traces pdf-parse, pdfjs-dist and the canvas backend into the standalone output', () => {
    const includes: string[] = nextConfig.outputFileTracingIncludes['/*'];
    expect(includes).toEqual(
      expect.arrayContaining([
        './node_modules/pdf-parse/**/*',
        './node_modules/pdfjs-dist/**/*',
        './node_modules/@napi-rs/**/*',
      ])
    );
  });
});

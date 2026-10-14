# Bug 178 — packaged builds cannot read PDFs: `DOMMatrix is not defined`

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-03)** |
| **Found** | 2026-10-03, in `Friday`'s `embedded-server.log` (Electron shell, 4.10.0-dev.109), while tracing a Summon From Lore upload report |
| **Fixed** | 2026-10-03, v4.10-dev |
| **Severity** | Medium. PDF text extraction fails in every packaged build. Document-store PDFs are indexed with no text, so search, embeddings and character `doc_*` reads see nothing in them; Summon From Lore and the character wizard get only the regex fallback's partial text |
| **Who it bites** | Docker and the Electron shell (embedded tarball): every build made on CI and run elsewhere. Dev (`npm run dev`) is unaffected, which is why it was never seen locally |
| **Provenance** | v4 only. Found in a live log; confirmed by inspecting the shipped Docker image |
| **Defect site** | `next.config.js` `serverExternalPackages` (no `pdf-parse`), so webpack bundled `pdf-parse` and `pdfjs-dist` into `.next/server/vendor.js` |
| **Fix site** | `next.config.js`: `pdf-parse` added to `serverExternalPackages`; `pdf-parse` and `pdfjs-dist` added to `outputFileTracingIncludes` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-03).** `pdf-parse` is now a server external package, so the production
server loads it, and the `pdfjs-dist` it imports, from `node_modules` at runtime instead of from
webpack's bundle. `pdfjs-dist`'s `import.meta.url` is then the real file path, its
`createRequire(...)("@napi-rs/canvas")` resolves, and the `DOMMatrix` polyfill is installed.
`pdf-parse` and `pdfjs-dist` are also listed in `outputFileTracingIncludes`. Both are already
present in full in the 4.10.0-dev.109 image's `/app/node_modules`, so this adds nothing there; it
guarantees the files (including the `pdf.worker.mjs` that `pdfjs-dist` loads with a dynamic
`import()`, which tracing cannot follow) for the tarball. The background-job child was not changed.
esbuild bundles it as CommonJS and keeps real paths, and `@napi-rs/canvas` is already external there.

## Symptom

On every PDF the document-store scanner or `storeMountFile` converts, the server logs:

```text
[MountIndex:PdfConverter] Failed to extract text from PDF buffer  { error: "DOMMatrix is not defined" }
```

`convertPdfBufferToText` returns `''`, so the file is indexed with no text and no chunks.
`Friday` logged it on every boot of 4.10.0-dev.109 under the Electron shell.

## Root cause

`pdfjs-dist` (which `pdf-parse` 2.x's ESM entry imports) polyfills `DOMMatrix`, `ImageData` and
`Path2D` in Node from `@napi-rs/canvas`, which it loads like this:

```js
const require = process.getBuiltinModule("module").createRequire(import.meta.url);
try { canvas = require("@napi-rs/canvas"); } catch { warn(...) }
globalThis.DOMMatrix ||= canvas?.DOMMatrix;
```

`pdf-parse` was not in `serverExternalPackages`, so webpack bundled it, and with it `pdfjs-dist`.
Webpack replaces `import.meta.url` with the module's absolute path **at build time**. In the
4.10.0-dev.109 image the bundled code reads:

```js
createRequire("file:///home/runner/work/quilltap-server/quilltap-server/node_modules/pdfjs-dist/legacy/build/pdf.mjs")
```

That is the CI runner's checkout. It does not exist in the container or the tarball, so the
`require("@napi-rs/canvas")` fails, the polyfill is skipped, and pdfjs's module-level
`new DOMMatrix` throws `ReferenceError: DOMMatrix is not defined` on first use.

`@napi-rs/canvas` itself was correctly external and present in `/app/node_modules/@napi-rs/canvas`.
It was simply never found.

## Why it survived

- Dev bundles the same way, but the path webpack bakes in is the developer's own checkout, which
  exists, so the polyfill works locally. Only a build made on one machine and run on another
  breaks.
- The failure is a `warn` line, and the converter returns `''` rather than throwing, so a PDF looks
  "indexed" (it has a row, just no text).
- `@napi-rs/canvas` was already in `serverExternalPackages` with a comment about pdfjs, which made
  it look as if PDF support had been handled for packaged builds.

## How to verify

1. Proof of the runtime path, against the shipped image (done 2026-10-03). Load `pdf-parse`
   natively from `/app/node_modules` in `foundry9/quilltap:4.10.0-dev.109`
   (`docker run --entrypoint node … /app/pdftest.mjs`, with a script that does
   `await import('pdf-parse')` and `new PDFParse(...).getText()`). It reports `DOMMatrix` defined
   and returns the PDF's text (2,316 characters from a 29 KB test PDF).
2. After the next packaged build, `grep -l "Cannot polyfill" .next/server/*.js` finds nothing (the
   code is no longer bundled), and booting an instance with PDFs in a document store logs no
   `DOMMatrix is not defined`.
3. A PDF given to Summon From Lore in Docker or the shell yields its full text (see bug 177).

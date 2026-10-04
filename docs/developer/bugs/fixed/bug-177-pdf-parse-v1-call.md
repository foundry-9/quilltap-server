# Bug 177 — Summon From Lore and the character wizard silently drop every PDF source

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-10-03)** |
| **Found** | 2026-10-03, while tracing a Summon From Lore upload failure reported under Docker on `Friday` |
| **Fixed** | 2026-10-03, v4.10-dev |
| **Severity** | Medium. No data is lost and nothing errors on screen, but a PDF given as source material contributes nothing: the import runs on whatever else it was given, or on nothing |
| **Who it bites** | every runtime, since 2.7.0 (2026-04-01, when `pdf-parse` 2.x became a dependency). Every caller of `extractFileContent`: Summon From Lore (`ai-import.service.ts` `buildSourceContext`) and the AI character wizard's document step (`character-wizard.service.ts`) |
| **Provenance** | v4 only. Found by reading the code while chasing a different report; no v5 harness involvement |
| **Defect site** | `lib/services/file-content-extractor.ts:167-230` (`extractPdfContent`) |
| **Fix site** | `lib/services/file-content-extractor.ts` (`extractPdfContent` now calls `convertPdfBufferToText`); regression test `__tests__/unit/lib/services/file-content-extractor-pdf.test.ts` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-03).** `extractPdfContent` no longer calls `pdf-parse` itself. It reads
through `convertPdfBufferToText` (`lib/mount-index/converters/pdf-converter.ts`), which already
used the 2.x `PDFParse` class and is now the only caller of `pdf-parse`. That function returns `''`
on any failure, so an empty or failed parse now falls through to the existing regex fallback
(`extractPdfTextFallback`) instead of returning an error. The extractor reports failure only when
neither reader finds any text. A new unit test drives `extractFileContent` with a 2.x-shaped
`pdf-parse` mock. Four of its five cases fail against the old code.

## Symptom

Upload a PDF to Summon From Lore (Aurora → Summon From Lore, or the Salon's wrapper). The upload
succeeds and the file is listed. The generated character ignores everything in it. The server log
has one warning per PDF:

```text
[AIImport] Failed to extract file content  { filename: "...pdf", error: "Failed to extract PDF content" }
```

and, just before it, `Error extracting PDF content` with `pdfParse is not a function`.

## Root cause

`extractPdfContent` was written for `pdf-parse` 1.x, whose module export is the parse function:

```ts
pdfParse = require('pdf-parse')
// ...
const data = await pdfParse(buffer)
```

`pdf-parse` 2.x (the project has `^2.4.5`) exports an object of classes (`{ PDFParse, … }`). The
`require` succeeds, so the "not installed" fallback is skipped, and calling the object throws
`TypeError: pdfParse is not a function`. The outer `catch` turns that into
`{ success: false, error: 'Failed to extract PDF content' }`, and `buildSourceContext` logs a warning
and skips the file.

Before 2.7.0, `pdf-parse` was not a dependency at all. The `require` threw, and the regex fallback
did the extraction. Adding the dependency is what broke it.

## Why it survived

- The failure is a `warn` line. Nothing reaches the UI, and the import still produces a character
  from any freeform text or other files.
- There was no test of `extractFileContent`. The mount-index converter tests mock `pdf-parse` with
  the 2.x shape, but they test `convertPdfBufferToText`, which was already correct.
- Two independent `pdf-parse` callers meant updating one did not update the other.

## How to verify

1. `npx jest __tests__/unit/lib/services/file-content-extractor-pdf.test.ts` passes.
2. In a running instance, give Summon From Lore a PDF with distinctive text and no freeform text.
   The generated character reflects the PDF, and the log has no `Failed to extract file content`
   warning for it. In a packaged build (Docker or the Electron tarball) this also needs bug 178's
   fix, or `convertPdfBufferToText` returns `''` and only the regex fallback runs.

# Bug 266 — the PDF preview draws its first page on a cleared, transparent canvas

| | |
|---|---|
| **Status** | FIXED |
| **Found** | 2026-10-26, live on `V4test` while checking the pdfjs-dist 6.4 upgrade in the browser |
| **Fixed** | 2026-10-26 |
| **Severity** | Low–Medium. The page draws, but black text on a transparent canvas over a dark theme reads as a blank page; anything with a light background looks normal, which hid it |
| **Who it bites** | anyone opening a PDF in the file preview with a dark theme, on the first page shown |
| **Provenance** | The render effect started a new `page.render()` on every `scale` change without cancelling the one in flight. The fit-to-width effect sets `scale` right after the first render starts, so the second run resized the canvas (which clears it) under the first; pdf.js then refused the second ("Cannot use the same canvas during multiple render() operations") while the first finished drawing its text without the white background it had already painted |
| **Fix site** | `components/files/FilePreview/FilePreviewPdf.tsx` (render effect) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

---

**FIXED in v4 (2026-10-26).** The render effect keeps the in-flight `RenderTask`, cancels it and
waits for it to settle before touching the canvas, bails if the effect was superseded while it
waited for the page, cancels the task on cleanup, and treats `RenderingCancelledException` as
expected rather than logging it.

Verified live on `V4test` (dev on :3005) with a two-page test PDF: page 1 renders on a white page
at the fit-to-width scale, page 2 and repeated zoom in/out render cleanly, and the console shows
no render warnings after the fix.

## Symptom

Opening a PDF in the file preview showed the toolbar ("1 / N", zoom) over an apparently empty
dark area. The console logged `[FilePreviewPdf] Failed to render page … Cannot use the same canvas
during multiple render() operations`. Sampling the canvas found dark text pixels and no white ones.

## Root cause

`FilePreviewPdf.tsx` renders in a `useEffect` keyed on `[currentPage, numPages, scale, file.id]`
with no cleanup. When the document loads, `numPages` changes, which starts render A at scale 1.0
and, in a separate effect, computes the fit-to-width scale. The new `scale` starts render B, which
sets `canvas.width` / `canvas.height` (clearing the canvas, including A's white background fill)
and calls `page.render()` on a canvas A still holds, so pdf.js throws. A then draws its text onto
the cleared canvas.

## Why it survived

The race happens on every open, but on a light theme a transparent canvas over a light
background looks right. Nothing in this effect was version-specific; pdf.js has refused
overlapping renders on one canvas since 2.x.

## How to verify

Open any PDF in the file preview with a dark theme: the first page shows on a white page, and
the console has no `Failed to render page` warning. Page and zoom quickly; each view should land
clean.

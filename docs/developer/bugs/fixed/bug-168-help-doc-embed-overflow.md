# Bug 168 — a long help page is too big to embed and drops out of help search

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-24)** |
| **Found** | 2026-09-24, reading `Friday`'s `embedding_status` for failed help docs |
| **Fixed** | 2026-09-24, v4.10-dev |
| **Severity** | Medium — the page is still listed in the Guide, but `help_search` never returns it, and its sections are never embedded either |
| **Who it bites** | any instance whose embedding model's input ceiling is smaller than a help page. With OpenAI's 8,192 tokens, `chat-settings.md` failed on 2026-08-14; six pages exceeded that ceiling when this was fixed (the largest, `connection-profiles.md`, at 12,338 tokens). Local models with 512-token ceilings would have failed far more |
| **Provenance** | Original to v4. The whole-document embedding predates section chunks |
| **Fix site** | `lib/background-jobs/handlers/embedding-generate.ts` (`handleHelpDocEmbedding`); `lib/embedding/embedding-service.ts` (`averageEmbeddings`) |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-24).** The HELP_DOC job embeds only a document's sections and stores the
normalised mean of their vectors as the document's own vector. No help text longer than one
section is ever sent to a provider. A section that fails is skipped and the rest still stand for
the document; only if every section fails does the job fail. A doc with no stored chunk rows yet
is sliced in memory so it still gets a vector. `chat-settings.md` was also split into three pages
for readability, and `__tests__/unit/lib/help/help-doc-size.test.ts` counts real `cl100k_base`
tokens of every help section against `HELP_SECTION_EMBEDDING_MAX_TOKENS` (1,000).

## Symptom

`embedding_status` on `Friday`: one HELP_DOC row, `FAILED`, for `help/chat-settings.md`:

> OpenAI embedding failed: Invalid 'input': maximum context length is 8192 tokens.

`help_docs.embedding` for that page was null, so `help_search`, which reads
`helpDocs.findAllWithEmbeddings()`, skipped it entirely.

## Root cause

`handleHelpDocEmbedding` embedded `${title}\n\n${content}` in one call before touching the
chunks. `skipIfOversize` only refuses text over `EMBEDDING_MAX_CHARS` (128 KB), four times
OpenAI's real ceiling, so the call went out and failed; the "maximum context length" error is
classed permanent, so the job stopped there and the section chunks, embedded after the whole
document, were never reached.

## Why it survived

`custom-tools.md` embedded at 43,455 characters and `chat-settings.md` failed at 43,703 — the pages
grew past the ceiling one edit at a time, and the failure is a single row in `embedding_status`
with no user-facing error.

## Verify

`__tests__/unit/lib/background-jobs/handlers/embedding-generate-extended.test.ts` embeds an 80-
section document and asserts no provider call carries more than a section's text, and that the
stored vector is the normalised mean of the section vectors.

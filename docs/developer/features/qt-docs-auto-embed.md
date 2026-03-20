# Feature: Built-in Semantic Documentation Search

**Status:** Proposal / Not Implemented

## Overview
Implement a searchable, embedded documentation system that ships with Quilltap. This allows users to ask the integrated LLM assistant questions about how to use the application, with the assistant drawing from up-to-date help documentation.

## Requirements

### Documentation Structure
- Store all help documentation as Markdown files in `docs/help/`
- Support arbitrary nesting and organization within that directory
- Each file can contain multiple sections (delimited by headings)

### Build-time Embedding
Create a standalone Node script (`scripts/embed-docs.js` or similar) that:
- Reads all Markdown files from `docs/help/`
- Chunks files by heading level (or configurable strategy)
- Generates embeddings for each chunk using a pluggable embedding provider
- Produces a single JSON index file: `docs/help-index.json`
- Bundles this index with the built application

### Embedding Provider Support
The build script should support multiple embedding providers:
- **OpenAI** (`text-embedding-3-small` by default)
- **Voyage AI** (Anthropic's recommended provider; excellent quality)
- **Ollama** (local/offline option, configurable model)

Configuration via environment variables or config file (e.g., `EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`).

### Incremental Updates (Git-based)
- Use `git diff` or `git status` to detect which documentation files have changed since the last commit
- Only re-embed modified files
- Update only the affected chunks in the index
- Run automatically as a pre-commit hook to keep the index in sync with documentation changes

### Index Format
Generate a JSON index with the following structure:
```json
{
  "metadata": {
    "version": "1.0.0",
    "embeddingProvider": "openai",
    "embeddingModel": "text-embedding-3-small",
    "lastUpdated": "2025-01-06T12:34:56Z",
    "chunkCount": 245
  },
  "chunks": [
    {
      "id": "unique-chunk-id",
      "file": "docs/help/plugin-installation.md",
      "heading": "Installing Plugins",
      "section": "basics",
      "content": "Full text of this chunk...",
      "vector": [0.123, -0.456, ...]
    }
  ]
}
```

### Runtime Search
Implement a simple search utility that:
- Loads the bundled `help-index.json`
- Embeds user queries using the same provider/model as the index
- Computes cosine similarity across all chunks
- Returns top N most relevant chunks (configurable, default 5)
- Can be used by the integrated LLM assistant to provide contextual help

### Integration with LLM Assistant
When users ask the assistant for help with Quilltap features:
- Query the documentation index
- Pass relevant chunks as context to the LLM
- Ensures responses are grounded in current, up-to-date documentation

## Benefits
- **Zero external dependencies at runtime** — embeddings are pre-computed
- **Cost-efficient** — only pay for embeddings at build time, once per doc change
- **Offline-capable** — with Ollama, can work without internet
- **Always in sync** — pre-commit hook keeps index current with documentation changes
- **Plugin-friendly** — plugins can include their own help docs, rebuilt into the index

## Implementation Notes
- Keep the index file small enough to bundle with the app (should be <5MB even for 500+ documents)
- Pre-commit hook should fail gracefully if embedding service is unavailable (with clear error message)
- Document the process so users can rebuild the index if they extend Quilltap's documentation


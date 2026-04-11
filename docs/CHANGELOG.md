# Quilltap Changelog

## Recent Changes

### 4.3-dev

#### Added

- **Scriptorium (Phase 1)**: Deterministic Markdown rendering of conversations with annotation support and semantic search chunking
  - Conversations are automatically rendered to Markdown after each turn with sequential message numbering and interchange grouping
  - New `read_conversation` tool allows characters to read the full rendered conversation with or without annotations
  - New `upsert_annotation` and `delete_annotation` tools enable characters to add persistent commentary to specific messages
  - Conversation interchanges are embedded as searchable chunks via the existing embedding pipeline

#### Fixed

- **Embedding BLOB Registration**: Fixed race condition where memory embeddings could be stored as JSON text instead of Float32 BLOBs, causing dimension mismatches during vector search. BLOB columns for `memories`, `vector_entries`, and `conversation_chunks` are now registered at database initialization time rather than lazily in individual repositories.

### 4.2.2

- fix: Image copy button in fullscreen viewers (gallery, image modal, tool messages) produced clipboard data that couldn't be pasted back into the ChatComposer under Electron. The Electron IPC path used native `clipboard.writeImage()` which the renderer's paste handler didn't recognize as `image/*`. Now tries the standard Clipboard API first for in-app round-trip compatibility, falling back to Electron IPC for external-app interop.

### 4.2.1

- fix: System prompt plugin (`qtap-plugin-default-system-prompts` 1.1.4) failed to load in standalone/Electron builds because `@quilltap/plugin-utils` was marked as external in the esbuild config, causing a runtime `Cannot find module 'openai'` error. Bundling plugin-utils (tree-shaken to just `createSystemPromptPlugin`) eliminates the dependency chain. The legacy filesystem fallback (`prompts/` directory) was also gone, so no sample prompts appeared in the Import Template modal.

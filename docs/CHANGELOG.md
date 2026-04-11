# Quilltap Changelog

## Recent Changes

### 4.3-dev

#### Added

- **Scriptorium (Phase 1)**: Deterministic Markdown rendering of conversations with annotation support and semantic search chunking
  - Conversations are automatically rendered to Markdown after each turn with sequential message numbering and interchange grouping
  - New `read_conversation` tool allows characters to read the full rendered conversation with or without annotations
  - New `upsert_annotation` and `delete_annotation` tools enable characters to add persistent commentary to specific messages
  - Conversation interchanges are embedded as searchable chunks via the existing embedding pipeline

#### Changed

- perf: Consolidated health-check polling from `InstanceLockGate` and `VersionGuardGate` into a shared `useHealthCheck` hook — eliminates ~24 requests/minute of continuous `/api/health` polling during normal operation (now fires once on mount and only polls when a 409 is detected)
- **Queue Status Badges**: Added "Emb" (embedding) badge showing active embedding jobs. Expanded "Sum" to cover all post-turn processing (context summaries, title updates, scene state tracking, conversation rendering). Added character avatar generation to "Img" badge (renamed from "BG"). Badge order: Mem|Emb|Sum|Dgr|Img.
- **Scriptorium Status Auto-Update**: Scriptorium badge on conversation cards now polls every 5 seconds after a render is triggered, showing real-time status transitions (red → amber → green) as rendering and embedding complete.
- perf: Cache `useUserCharacterDisplayName` hook data at module level — previously each ChatCard instance fired its own API call to `/api/v1/characters?controlledBy=user`, causing N redundant fetches for N visible cards

#### Fixed

- **Embedding BLOB Registration**: Fixed race condition where memory embeddings could be stored as JSON text instead of Float32 BLOBs, causing dimension mismatches during vector search. BLOB columns for `memories`, `vector_entries`, and `conversation_chunks` are now registered at database initialization time rather than lazily in individual repositories.

### 4.2.2

- fix: Image copy button in fullscreen viewers (gallery, image modal, tool messages) produced clipboard data that couldn't be pasted back into the ChatComposer under Electron. The Electron IPC path used native `clipboard.writeImage()` which the renderer's paste handler didn't recognize as `image/*`. Now tries the standard Clipboard API first for in-app round-trip compatibility, falling back to Electron IPC for external-app interop.

### 4.2.1

- fix: System prompt plugin (`qtap-plugin-default-system-prompts` 1.1.4) failed to load in standalone/Electron builds because `@quilltap/plugin-utils` was marked as external in the esbuild config, causing a runtime `Cannot find module 'openai'` error. Bundling plugin-utils (tree-shaken to just `createSystemPromptPlugin`) eliminates the dependency chain. The legacy filesystem fallback (`prompts/` directory) was also gone, so no sample prompts appeared in the Import Template modal.

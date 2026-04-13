# Quilltap Changelog

## Recent Changes

### 4.3-dev

#### Fixed

- **Embedding model swap dimension mismatch**: Full re-embed (EMBEDDING_REINDEX_ALL) now clears each character's vector index before enqueuing new jobs, so switching to a model with different dimensions (e.g. 1536 → 4096) no longer fails every job with "Vector dimension mismatch"
- **Stale embedding jobs on re-embed**: Re-embed now cancels all pending/failed EMBEDDING_GENERATE jobs from the previous run before enqueuing fresh ones, preventing zombie jobs from competing for processor slots

#### Changed

- **Concurrent embedding processing**: EMBEDDING_GENERATE jobs now run up to 8 at a time in the background job processor, while all other job types remain single-threaded — significantly faster bulk re-embeds, especially with local providers like Ollama

#### Removed

- Pre-built help bundle (`public/help-bundle.msgpack.gz`) — help docs are now embedded at runtime
- `build:help` npm script — no longer needed

#### Tests

- Added unit tests for conversation-render background job handler
- Added unit tests for FormattingToolbar source-mode formatting operations
- Added unit tests for useHealthCheck hook (shared polling, lock conflict detection)
- Added unit tests for read-conversation-handler (annotation merging, cross-conversation access control, truncation)
- Added unit tests for search-scriptorium-handler (unified search, graceful memory failure, result formatting)
- Updated builtin-tools tests for help_search/help_settings tools and removed search_memories
- Updated tools-api tests for unified search tool schema and legacy tool removal

#### Added

- **Unified Embedding Swap**: EMBEDDING_REINDEX_ALL now performs a full system-wide re-embed covering help documentation, character memories, and conversation chunks (Scriptorium)
  - Help docs are synced from disk to a new `help_docs` database table and embedded at runtime using the user's chosen embedding profile — no more pre-built MessagePack bundle
  - When switching embedding profiles, users are prompted to "Re-embed Everything" (not just memories)
  - Help docs are embedded first (highest priority), followed by memories, then conversation chunks
  - All progress is tracked via the existing "Emb" queue badge in the header
  - BUILTIN TF-IDF vocabulary refit now includes help docs in the corpus for better coverage
  - Conversation chunks now have full `embedding_status` tracking (PENDING/EMBEDDED/FAILED)
  - New default profiles automatically trigger a full system reindex on creation
  - New migration: `create-help-docs-table-v1` for the `help_docs` table
- **Ollama Embedding Model Fetch**: "Fetch Installed Models" button in the embedding profile modal dynamically queries Ollama's `/api/tags` endpoint to show installed models in a dropdown, merging with static suggestions
- **Scriptorium (Phase 3.1)**: Lexical rich text editor integration for chat composer
  - Replaced plain textarea in ChatComposer with Meta's Lexical rich text framework
  - Rich text formatting (bold, italic, headings, lists) via document mode toolbar now uses native Lexical commands
  - Custom markdown transformer set preserves roleplay delimiters (e.g. `*narration*`) as literal text — italic uses underscore only
  - Undo/redo support via Lexical's built-in HistoryPlugin
  - Messages continue to be stored and transmitted as plain markdown strings — no schema changes
  - Foundation for Phase 3 collaborative document editing features
- **Scriptorium (Phase 3.1 cont.)**: Formatting toolbar enhancements
  - CODE button toggles code blocks (no selection) or inline code (with selection); shows as /CODE when cursor is inside a code block
  - Blockquote button with smart-quote label converts blocks to blockquotes
  - H4, H5, H6 heading buttons added
  - Delimiter buttons (Nar, OOC, etc.) now toggle: wrap selected text, or unwrap if already delimited
  - Enter on a blank trailing line inside a code block exits the block and creates a new paragraph
  - All toolbar buttons now preserve editor selection via `onMouseDown` preventDefault
  - Button styling: headings use serif font, CODE uses monospace, blockquote uses bold serif smart-quote
  - Tooltips updated (Bold, Italic, Unordered List, Ordered List, Blockquote, Heading N)
  - UL/OL button labels changed to `• …` and `1. …` for clarity
  - New themeable CSS custom properties: `--qt-formatting-heading-font`, `--qt-formatting-code-font`
- **Scriptorium (Phase 3.1 cont.)**: Source mode editor and toolbar source-mode support
  - Replaced "Preview message" toggle with "Source mode" toggle — shows raw markdown in a monospace textarea for direct editing
  - When toggling back to rich text mode, source edits are synced into the Lexical editor
  - All formatting toolbar buttons (bold, italic, headings, lists, blockquote, code, delimiters) work in source mode with textarea manipulation
  - Source mode uses `qt-source-mode-textarea` CSS class with monospace font
- **Scriptorium (Phase 2)**: Unified search and cross-conversation access
  - Rendered conversations now include a metadata header with title, ID, dates, participants, and counts
  - New unified `search` tool replaces `search_memories`, searching across both character memories and conversation chunks with unified ranking
  - `read_conversation` tool now accepts an optional `conversationId` parameter to read any conversation, not just the current one
  - Metadata header is embedded with chunk 0 for semantic searchability of conversation titles
  - Removed standalone `search_memories` tool (functionality consolidated into `search`)
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

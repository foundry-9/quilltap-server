# Quilltap Changelog

## Recent Changes

### 4.3-dev

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

- **Project Document Stores**: Link/unlink document stores on the project detail page
  - New "Document Stores" expandable card on the Prospero project page
  - Shows linked stores with name, type, file count, and total size
  - Inline picker to link available document stores to the project
  - Unlink button on each linked store
- **Document editing tools in tool settings**: All 10 doc_* tools appear in the tool settings UI (per-chat and per-project defaults) with availability status based on whether the project has linked document stores
- **Tool settings grouping**: Built-in tools are now organized into collapsible groups by category — "Document Editing", "Wardrobe", "Workspace" (VM/Docker shell tools), and "Quilltap Help" — each toggleable as a unit
- **Scriptorium (Phase 3.3)**: Quilltap-native document editing tools
  - 10 new LLM tools for reading, editing, and searching files in document stores and project files
  - **Tier 1 — Text primitives**: `doc_read_file`, `doc_write_file`, `doc_str_replace`, `doc_insert_text`, `doc_grep`, `doc_list_files`
  - **Tier 2 — Markdown-aware**: `doc_read_frontmatter`, `doc_update_frontmatter`, `doc_read_heading`, `doc_update_heading`
  - Unified path resolution across three scopes: document stores, project files, and general files
  - `str_replace` with unique-match constraint — text itself serves as the "address", no structural IDs needed
  - Unicode diacritics normalization for search and replace (e.g., "Nimue" matches "Nimuë")
  - Lightweight markdown parser for heading trees and YAML frontmatter (using `yaml` npm package)
  - Path traversal prevention and mount point access control
  - Optimistic concurrency via mtime-based conflict detection
  - Fire-and-forget single-file re-indexing after edits to keep search results current
  - Tools automatically enabled when a project has linked document stores
  - New npm dependency: `yaml` for frontmatter parsing/serialization
- **Document Stores UI**: Full management interface for document mount points
  - New "Document Stores" button in left sidebar navigation (database icon, below Files)
  - List page at `/document-stores` with card grid showing name, path, type, file/chunk counts, scan status, and last scan time
  - Create dialog with name, path, mount type (filesystem/Obsidian), include/exclude pattern configuration
  - Edit dialog with all fields plus enable/disable toggle
  - Delete confirmation dialog with clear warning about data removal
  - Scan button on each card triggers filesystem scan and embedding job queuing with progress feedback
  - Detail page at `/document-stores/[id]` with summary stats, pattern display, and full file table
  - File table with sortable columns (name, type, size, conversion status, embedding chunks, last modified), filter search, and summary bar
  - Updated help file to reference new UI instead of API-only management
- **Scriptorium (Phase 3.2)**: Document mount points and auto-embedding
  - Mount external document directories (filesystem paths, Obsidian vaults) as searchable knowledge sources
  - New `quilltap-mount-index.db` database (third database, separate from main and LLM logs) with SQLCipher encryption, WAL mode, and graceful degradation
  - Four new tables: `doc_mount_points`, `doc_mount_files`, `doc_mount_chunks`, `project_doc_mount_links` (many-to-many)
  - Format conversion pipeline: PDF (pdf-parse v2), Word (.docx via mammoth.js), Markdown (regex syntax stripping), plain text
  - Intelligent chunking engine: 800-1200 token chunks with 200-token overlap, heading context tracking
  - SHA-256 checksum-based change detection on startup — new/modified files automatically re-ingested, deleted files purged
  - Auto-embedding via existing embedding infrastructure with new `MOUNT_CHUNK` entity type
  - New `'documents'` source type in the unified search tool — document chunks appear alongside memories and conversations
  - Fire-and-forget startup scanning (Phase 3.3) — large vaults don't block server startup
  - REST API: `/api/v1/mount-points` CRUD, `?action=scan` manual re-scan trigger, `/api/v1/projects/[id]/mount-points` link/unlink
  - New npm dependency: `mammoth` for DOCX text extraction
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

- **Concurrent embedding processing**: EMBEDDING_GENERATE jobs now run up to 4 at a time in the background job processor (with a 10-minute per-job timeout), while all other job types remain single-threaded — significantly faster bulk re-embeds, especially with local providers like Ollama
- perf: Consolidated health-check polling from `InstanceLockGate` and `VersionGuardGate` into a shared `useHealthCheck` hook — eliminates ~24 requests/minute of continuous `/api/health` polling during normal operation (now fires once on mount and only polls when a 409 is detected)
- **Queue Status Badges**: Added "Emb" (embedding) badge showing active embedding jobs. Expanded "Sum" to cover all post-turn processing (context summaries, title updates, scene state tracking, conversation rendering). Added character avatar generation to "Img" badge (renamed from "BG"). Badge order: Mem|Emb|Sum|Dgr|Img.
- **Scriptorium Status Auto-Update**: Scriptorium badge on conversation cards now polls every 5 seconds after a render is triggered, showing real-time status transitions (red → amber → green) as rendering and embedding complete.
- perf: Cache `useUserCharacterDisplayName` hook data at module level — previously each ChatCard instance fired its own API call to `/api/v1/characters?controlledBy=user`, causing N redundant fetches for N visible cards

#### Fixed

- **Embedding generate OOM fix**: The `EMBEDDING_GENERATE` handler for memories now writes directly to the database via `VectorIndicesRepository` instead of loading the entire character vector store into memory. Previously, generating an embedding for a single memory would load *all* vectors for that character (e.g. 12,000+ entries × 1,536 dimensions ≈ 150+ MB) just to insert one row — causing V8 heap exhaustion and crashes in Electron when processing large instances.
- **Docker/Lima/WSL heap limit raised to 4 GB**: `--max-old-space-size` bumped from 2048 to 4096 in `Dockerfile`, `Dockerfile.ci`, and `lima/wsl-init.sh`
- **Background job queue now respects priority**: `claimNextJob()` sorts by `priority DESC, createdAt ASC` instead of arbitrary order — the `priority` column existed but was never consulted
- **Chat-related embeddings prioritized over batch operations**: Memory and conversation chunk embeddings now enqueue at priority 10, while mount chunk and help doc embeddings enqueue at priority 0, preventing large document store scans from starving real-time chat responsiveness
- **Google plugin (1.1.22)**: Fixed tool/function calling with Google Gemini SDK — uppercase schema `type` fields for API compatibility, switched `userAgentExtra` to `httpOptions.headers` for newer SDK versions, re-enabled function calling for Gemini 3 models, and improved function call extraction from raw responses
- **Memory search dimension mismatch fallback**: When the search embedding profile produces different dimensions than the stored vector index, `searchMemoriesSemantic` now detects the mismatch before calling vector search and falls back to text-based search instead of silently returning zero results
- **Text search fallback broadened to per-word matching**: The text-based memory search fallback now searches for individual significant words (filtering stop words) when the full query phrase doesn't match, so multi-word queries find relevant memories even without exact substring matches
- **Removed per-chat embedding profile override**: The `embeddingProfileId` field in `cheapLLMSettings` was removed — the system now always uses the single default embedding profile for all search operations, preventing mismatches between the profile used to build the vector index and the one used at search time
- **Tasks Queue UI**: The paused-jobs count was never shown in the queue stats panel because the API response omitted the `paused` field — it is now included.
- **Tasks Queue UI**: Jobs of type `SCENE_STATE_TRACKING`, `CHARACTER_AVATAR_GENERATION`, and `CONVERSATION_RENDER` appeared as raw type identifiers instead of human-readable names; they now display correctly.
- **Tasks Queue UI**: Non-LLM background jobs (embedding generation, vocabulary refit, re-index, avatar generation, conversation render, and story background generation) were incorrectly contributing 500 estimated tokens each to the queue token estimate; they now correctly contribute 0.
- **Tasks Queue UI**: The `ProcessorStatus` type now includes `embeddingInFlight` and `embeddingConcurrency` to match what the API actually returns.
- **Embedding model swap dimension mismatch**: Full re-embed (EMBEDDING_REINDEX_ALL) now clears each character's vector index before enqueuing new jobs, so switching to a model with different dimensions (e.g. 1536 → 4096) no longer fails every job with "Vector dimension mismatch"
- **Stale embedding jobs on re-embed**: Re-embed now cancels all pending/failed/orphaned EMBEDDING_GENERATE jobs from the previous run before enqueuing fresh ones, preventing zombie jobs from competing for processor slots
- **Slow re-embed enqueue**: Reindex handler now batch-inserts all embedding jobs in chunks of 200 (single SQLite transactions) instead of 3 sequential DB calls per entity — enqueue phase drops from minutes to seconds for large instances
- **Orphaned PROCESSING jobs blocking new work**: On startup, all PROCESSING jobs are now killed (DEAD) instead of reset to PENDING, since no job can legitimately be mid-flight at server start. Prevents stale retries from blocking fresh batch-inserted jobs. Embedding concurrency also guards against over-claiming via early bail when slots are full, with proactive back-fill when a slot frees.
- **Embedding BLOB Registration**: Fixed race condition where memory embeddings could be stored as JSON text instead of Float32 BLOBs, causing dimension mismatches during vector search. BLOB columns for `memories`, `vector_entries`, and `conversation_chunks` are now registered at database initialization time rather than lazily in individual repositories.

### 4.2.2

- fix: Image copy button in fullscreen viewers (gallery, image modal, tool messages) produced clipboard data that couldn't be pasted back into the ChatComposer under Electron. The Electron IPC path used native `clipboard.writeImage()` which the renderer's paste handler didn't recognize as `image/*`. Now tries the standard Clipboard API first for in-app round-trip compatibility, falling back to Electron IPC for external-app interop.

### 4.2.1

- fix: System prompt plugin (`qtap-plugin-default-system-prompts` 1.1.4) failed to load in standalone/Electron builds because `@quilltap/plugin-utils` was marked as external in the esbuild config, causing a runtime `Cannot find module 'openai'` error. Bundling plugin-utils (tree-shaken to just `createSystemPromptPlugin`) eliminates the dependency chain. The legacy filesystem fallback (`prompts/` directory) was also gone, so no sample prompts appeared in the Import Template modal.

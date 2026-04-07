# Quilltap Changelog

## Recent Changes

### 4.2-dev

- perf: Memories tab on character pages now uses paginated loading with infinite scroll instead of loading all memories at once
- chore: Add `all` mode to remove-old-dev-tags Claude command for removing every dev tag, release, and Docker image
- docs: Add system flowcharts (Mermaid) documenting prompt assembly, memory extraction pipeline, scene tracking, story background generation, and Concierge content routing

### 4.1.1

- fix: Memory extraction now preserves source message timestamps as the memory's createdAt/updatedAt instead of using the extraction time
- fix: One-time migration backfills existing memories with correct timestamps from their linked source messages
- docs: Add 4.1.1 release notes

### 4.1.0

- feat: Character conversations tab shows memory count badge per chat; clicking it deletes old memories and re-extracts with the new multi-fact system
- feat: Commonplace Book memory extraction now returns multiple discrete facts per message pair instead of a single memory, with dynamic limits based on the cheap LLM profile's max output tokens
- fix: Add startup auto-repair for TEXT embeddings in vector_entries and memories tables that accumulate during dev hot-reloads; converts them to Float32 BLOBs on every server start
- fix: Add warning log in documentToRow when embedding arrays are accidentally stored as JSON text instead of BLOB
- docs: Add 4.1.0 release notes
- chore: Update all GitHub repository references from `foundry-9/quilltap` to `foundry-9/quilltap-server` across docs, package.json files, release notes, plugin manifests, and source code

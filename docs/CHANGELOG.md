# Quilltap Changelog

## Recent Changes

### 4.4-dev

(empty — new development starts here)

### 4.3.1

#### Bug Fixes

- **SQLite journal mode default changed from WAL to TRUNCATE**: Quilltap data directories are commonly placed inside cloud-synced folders (iCloud Drive, Dropbox, OneDrive, Google Drive). WAL mode keeps `.db-wal` and `.db-shm` files alongside the main `.db`; if those files sync out of order with the main database — which all four providers can do, especially on dirty shutdown — the database can be corrupted or lose recent writes on the next open. Switching to `TRUNCATE` keeps the rollback journal in a single auxiliary file that is truncated to zero on every commit, eliminating the multi-file sync hazard. Existing databases auto-migrate on first open after upgrade (SQLite checkpoints any pre-existing WAL into the main file as part of the journal-mode transition). The change applies to all three databases — main (`quilltap.db`), LLM logs (`quilltap-llm-logs.db`), and mount index (`quilltap-mount-index.db`) — plus the meta-table connection used during startup.
- **`SQLITE_WAL_MODE` env var inverted**: Previously `SQLITE_WAL_MODE=false` was the opt-out; now `SQLITE_WAL_MODE=true` is the opt-in. Set this only when the data directory lives on a fast local SSD that is not synced to the cloud.
- **Internal**: `lib/startup/db-encryption-converter.ts` now leaves freshly-encrypted databases in TRUNCATE mode rather than WAL, matching the new resting state.

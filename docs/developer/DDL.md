# Quilltap Database Schema Reference (DDL)

This document describes the three SQLite databases used by Quilltap, how to access them, and the complete schema of every table.

## Database Overview

| Database | Filename | Purpose |
|----------|----------|---------|
| **Main** | `quilltap.db` | All application data: users, characters, chats, messages, projects, files, memories, settings, etc. |
| **LLM Logs** | `quilltap-llm-logs.db` | LLM request/response debug data. Isolated so high-churn logging can't corrupt main data. |
| **Mount Index** | `quilltap-mount-index.db` | Document mount point tracking: file inventory, checksums, text chunks, and embeddings for external document directories. |

All three databases live in `<data-dir>/data/`. Alongside them:

```
<data-dir>/data/
├── quilltap.db
├── quilltap.dbkey            # Encryption key file (main DB)
├── quilltap-llm-logs.db
├── quilltap-llm-logs.dbkey   # Encryption key file (LLM logs DB)
├── quilltap-mount-index.db
├── quilltap-mount-index.dbkey # Encryption key file (mount index DB)
├── quilltap.lock             # Instance lock (prevents dual-instance corruption)
└── backups/                  # Physical backups
```

### Default data directory by platform

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/Quilltap/` |
| Linux | `~/.quilltap/` |
| Windows | `%APPDATA%\Quilltap\` |
| Docker | `/app/quilltap/` |
| Lima VM | `/data/quilltap/` (VirtioFS mount) |

Override with `QUILLTAP_DATA_DIR` env var, `--data-dir` CLI flag, or `SQLITE_PATH` / `SQLITE_LLM_LOGS_PATH` / `SQLITE_MOUNT_INDEX_PATH` for individual databases.

## Encryption

All three databases are encrypted with **SQLCipher** (AES-256-CBC with HMAC-SHA512). The standard `sqlite3` CLI **cannot** open them.

### How the key works

1. A 32-byte random **pepper** (base64-encoded) is the actual SQLCipher key
2. The pepper is wrapped with AES-256-GCM + PBKDF2 (600,000 iterations, SHA-256) and stored in `.dbkey` files
3. An optional user passphrase protects the `.dbkey` wrapper; without one, a sentinel value is used
4. At runtime, the pepper lands in `process.env.ENCRYPTION_MASTER_PEPPER`
5. SQLCipher receives it as a raw hex key: `PRAGMA key = "x'<hex>'"`

### Runtime PRAGMAs

After the key is set, the following PRAGMAs are applied:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;      -- (default config value)
PRAGMA busy_timeout = 5000;       -- (default config value)
PRAGMA cache_size = -8000;        -- (default config value, ~8MB)
PRAGMA mmap_size = 268435456;     -- 256MB memory-mapped I/O
PRAGMA temp_store = MEMORY;
```

Periodic `PRAGMA wal_checkpoint(PASSIVE)` runs every 5 minutes. `PRAGMA optimize` runs at shutdown.

## How to Query

**Always use the Quilltap CLI** — never raw `sqlite3`.

```bash
# Main database
npx quilltap db --tables                           # List tables
npx quilltap db "SELECT COUNT(*) FROM characters;" # Run a query
npx quilltap db --repl                             # Interactive REPL

# LLM logs database
npx quilltap db --llm-logs --tables
npx quilltap db --llm-logs "SELECT * FROM llm_logs ORDER BY createdAt DESC LIMIT 5;"

# With passphrase (if set)
npx quilltap db --passphrase <pass> --tables
QUILLTAP_DB_PASSPHRASE=secret npx quilltap db --tables

# Custom data directory
npx quilltap db --data-dir /path/to/data --tables

# Instance lock management
npx quilltap db --lock-status
npx quilltap db --lock-clean
npx quilltap db --lock-override
```

---

## Main Database Schema (`quilltap.db`)

### users

```sql
CREATE TABLE "users" (
  "id" TEXT PRIMARY KEY,
  "username" TEXT NOT NULL,
  "email" TEXT UNIQUE,
  "name" TEXT,
  "image" TEXT,
  "emailVerified" TEXT,
  "passwordHash" TEXT,
  "totp" TEXT,
  "backupCodes" TEXT,
  "totpAttempts" TEXT,
  "trustedDevices" TEXT DEFAULT '[]',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_users_createdAt" ON "users" ("createdAt" DESC);
CREATE INDEX "idx_users_email" ON "users" ("email");
CREATE INDEX "idx_users_username" ON "users" ("username");
```

### api_keys

```sql
CREATE TABLE "api_keys" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "key_value" TEXT NOT NULL,
  "isActive" INTEGER DEFAULT 1,
  "lastUsed" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_api_keys_createdAt" ON "api_keys" ("createdAt" DESC);
CREATE INDEX "idx_api_keys_provider" ON "api_keys" ("provider");
CREATE INDEX "idx_api_keys_userId" ON "api_keys" ("userId");
```

### characters

```sql
CREATE TABLE "characters" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "title" TEXT,                           -- The user's or character's own private label/framing (e.g. "the protagonist", "the rival"). Not how others refer to them.
  "identity" TEXT,                        -- Surface-level public-knowledge view: name, station, occupation, reputation. What strangers know on sight.
  "description" TEXT,                     -- Acquaintance-perceivable behaviour, mannerisms, verbal patterns. NOT physical (see physicalDescriptions).
  "manifesto" TEXT,                       -- The basic tenets — the most important facts of the character's existence. The axiomatic core that every other field should remain consistent with. Synced as `manifesto.md` in the character vault.
  "personality" TEXT,                     -- The character's own self-knowledge — internal driver of speech and behaviour.
  "scenario" TEXT,                        -- DEPRECATED: use scenarios instead
  "scenarios" TEXT DEFAULT '[]',          -- JSON array of { id, title, content, createdAt, updatedAt }
  "firstMessage" TEXT,
  "exampleDialogues" TEXT,
  "systemPrompts" TEXT DEFAULT '[]',
  "avatarUrl" TEXT,
  "defaultImageId" TEXT,
  "defaultConnectionProfileId" TEXT,
  "defaultPartnerId" TEXT,
  "defaultRoleplayTemplateId" TEXT,
  "sillyTavernData" TEXT,
  "isFavorite" INTEGER DEFAULT 0,
  "npc" INTEGER DEFAULT 0,
  "talkativeness" REAL DEFAULT 0.5,
  "controlledBy" TEXT DEFAULT 'llm',
  "partnerLinks" TEXT DEFAULT '[]',
  "tags" TEXT DEFAULT '[]',
  "avatarOverrides" TEXT DEFAULT '[]',
  "physicalDescriptions" TEXT DEFAULT '[]',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "defaultImageProfileId" TEXT,
  "defaultAgentModeEnabled" INTEGER DEFAULT NULL,
  "aliases" TEXT DEFAULT '[]',
  "pronouns" TEXT DEFAULT NULL,
  "clothingRecords" TEXT DEFAULT '[]',
  "defaultHelpToolsEnabled" INTEGER DEFAULT NULL,
  "defaultTimestampConfig" TEXT DEFAULT NULL,
  "defaultScenarioId" TEXT DEFAULT NULL,
  "defaultSystemPromptId" TEXT DEFAULT NULL,
  "canDressThemselves" INTEGER DEFAULT NULL,
  "canCreateOutfits" INTEGER DEFAULT NULL,
  "characterDocumentMountPointId" TEXT DEFAULT NULL,
  "readPropertiesFromDocumentStore" INTEGER DEFAULT NULL,  -- when 1, pronouns/aliases/title/firstMessage/talkativeness are read from the linked vault's properties.json; identity/description/personality/exampleDialogues are read from their respective .md files
  "systemTransparency" INTEGER DEFAULT NULL  -- when 1 (true), this character may inspect "the Staff" — the chat-level toggles for self_inventory, Staff messages (Lantern/Aurora/Librarian/Prospero/Host), and character vaults still apply. When NULL or 0 (false), the character cannot see Staff messages, the self_inventory tool is withheld, and all character vaults (own + peers) are hidden from doc_* tools — a hard override on top of chat/project settings. Default NULL (opaque).
);

CREATE INDEX "idx_characters_createdAt" ON "characters" ("createdAt" DESC);
CREATE INDEX "idx_characters_userId" ON "characters" ("userId");
```

### wardrobe_items

```sql
CREATE TABLE "wardrobe_items" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "types" TEXT NOT NULL DEFAULT '[]',
  "componentItemIds" TEXT DEFAULT NULL,
  "appropriateness" TEXT,
  "isDefault" INTEGER DEFAULT 0,
  "migratedFromClothingRecordId" TEXT,
  "archivedAt" TEXT DEFAULT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_wardrobe_items_character" ON "wardrobe_items"("characterId");
```

`componentItemIds` is a JSON array of other wardrobe item ids. An empty array (or NULL, treated identically) means a leaf item; a populated array means a composite — equipping the item stores its own id but at read time `expandComposites` resolves the components transitively (cycle-tolerant, depth-capped). Cycles are rejected at save time by `WardrobeRepository`.

### outfit_presets — REMOVED in 4.5

The `outfit_presets` table was eliminated; named outfit bundles are now expressed as composite `wardrobe_items` rows whose `componentItemIds` references the constituent items. Migrations `migrate-outfit-presets-to-composites-v1` and `drop-outfit-presets-table-v1` perform the fold-and-drop. A snapshot of the table content is written to `<dataDir>/backup/pre-drop-outfit-presets.json` before the drop.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| characterId | TEXT (UUID, nullable) | Owner character. NULL = archetype (shared across characters) |
| title | TEXT | Display name of the item |
| description | TEXT | Detailed description for prompts and image generation |
| types | TEXT (JSON array) | Coverage slots: `["top"]`, `["bottom"]`, `["top","bottom"]` for dresses, etc. |
| componentItemIds | TEXT (JSON array, nullable) | Other wardrobe item ids this composite bundles. Empty/NULL = leaf item. Cycles rejected on save. |
| appropriateness | TEXT | Context tags: "casual", "formal", "intimate", etc. |
| isDefault | INTEGER | 1 = part of character's default outfit |
| migratedFromClothingRecordId | TEXT (UUID) | Tracks provenance from legacy clothingRecords migration |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### character_plugin_data

Stores arbitrary per-character, per-plugin JSON metadata. Each plugin can store any valid JSON value associated with a character. Quilltap enforces only that the data field is parseable JSON.

```sql
CREATE TABLE "character_plugin_data" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "pluginName" TEXT NOT NULL,
  "data" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("characterId", "pluginName"),
  FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_cpd_character" ON "character_plugin_data"("characterId");
CREATE INDEX "idx_cpd_plugin" ON "character_plugin_data"("pluginName");
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| characterId | TEXT (UUID) | Character this data belongs to |
| pluginName | TEXT | Plugin name (e.g., "qtap-plugin-curl"), max 200 chars |
| data | TEXT (JSON) | Arbitrary JSON value — any valid JSON (object, array, string, number, boolean, null) |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### chats

```sql
CREATE TABLE "chats" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "participants" TEXT DEFAULT '[]',
  "title" TEXT NOT NULL,
  "contextSummary" TEXT,
  "sillyTavernMetadata" TEXT,
  "tags" TEXT DEFAULT '[]',
  "roleplayTemplateId" TEXT,
  "timestampConfig" TEXT,
  "lastTurnParticipantId" TEXT,
  "messageCount" INTEGER DEFAULT 0,
  "lastMessageAt" TEXT,
  "lastRenameCheckInterchange" INTEGER DEFAULT 0,
  "compactionGeneration" INTEGER DEFAULT 0,
  "lastSummaryTurn" INTEGER DEFAULT 0,
  "lastSummaryTokens" INTEGER DEFAULT 0,
  "lastFullRebuildTurn" INTEGER DEFAULT 0,
  "summaryAnchorMessageIds" TEXT DEFAULT '[]',
  "isPaused" INTEGER DEFAULT 0,
  "isManuallyRenamed" INTEGER DEFAULT 0,
  "impersonatingParticipantIds" TEXT DEFAULT '[]',
  "activeTypingParticipantId" TEXT,
  "allLLMPauseTurnCount" INTEGER DEFAULT 0,
  "documentEditingMode" INTEGER DEFAULT 0,
  "projectId" TEXT,
  "totalPromptTokens" INTEGER DEFAULT 0,
  "totalCompletionTokens" INTEGER DEFAULT 0,
  "estimatedCostUSD" REAL,
  "priceSource" TEXT,
  "showSystemEventsOverride" INTEGER,
  "requestFullContextOnNextMessage" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "disabledTools" TEXT DEFAULT '[]',
  "disabledToolGroups" TEXT DEFAULT '[]',
  "forceToolsOnNextMessage" INTEGER DEFAULT 0,
  "state" TEXT DEFAULT '{}',
  "compressionCache" TEXT DEFAULT NULL,
  "agentModeEnabled" INTEGER DEFAULT NULL,
  "agentTurnCount" INTEGER DEFAULT 0,
  "storyBackgroundImageId" TEXT DEFAULT NULL,
  "lastBackgroundGeneratedAt" TEXT DEFAULT NULL,
  "imageProfileId" TEXT DEFAULT NULL,
  "isDangerousChat" INTEGER DEFAULT NULL,
  "dangerScore" REAL DEFAULT NULL,
  "dangerCategories" TEXT DEFAULT '[]',
  "dangerClassifiedAt" TEXT DEFAULT NULL,
  "dangerClassifiedAtMessageCount" INTEGER DEFAULT NULL,
  "turnQueue" TEXT DEFAULT '[]',
  "sceneState" TEXT DEFAULT NULL,
  "renderedMarkdown" TEXT DEFAULT NULL,
  "equippedOutfit" TEXT DEFAULT NULL,
  "pendingOutfitNotifications" TEXT DEFAULT NULL,
  "characterAvatars" TEXT DEFAULT NULL,
  "avatarGenerationEnabled" INTEGER DEFAULT NULL,
  "alertCharactersOfLanternImages" INTEGER DEFAULT NULL,
  "chatType" TEXT DEFAULT 'salon',
  "helpPageUrl" TEXT DEFAULT NULL,
  "scenarioText" TEXT DEFAULT NULL,
  "documentMode" TEXT DEFAULT 'normal',
  "dividerPosition" INTEGER DEFAULT 45,
  "terminalMode" TEXT DEFAULT 'normal',
  "activeTerminalSessionId" TEXT DEFAULT NULL,
  "rightPaneVerticalSplit" INTEGER DEFAULT 50,
  "allowCrossCharacterVaultReads" INTEGER DEFAULT 0,
  "compiledIdentityStacks" TEXT DEFAULT NULL
);

CREATE INDEX "idx_chats_chatType" ON "chats"("chatType");
CREATE INDEX "idx_chats_createdAt" ON "chats" ("createdAt" DESC);
CREATE INDEX "idx_chats_projectId" ON "chats" ("projectId");
CREATE INDEX "idx_chats_userId" ON "chats" ("userId");
```

### chat_documents

```sql
CREATE TABLE "chat_documents" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'project',
  "mountPoint" TEXT,
  "displayTitle" TEXT,
  "isActive" INTEGER DEFAULT 1,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_chat_documents_chatId" ON "chat_documents" ("chatId");
CREATE UNIQUE INDEX "idx_chat_documents_unique" ON "chat_documents" ("chatId", "filePath", "scope", "mountPoint");
```

### terminal_sessions

```sql
CREATE TABLE "terminal_sessions" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "label" TEXT,
  "shell" TEXT NOT NULL,
  "cwd" TEXT NOT NULL,
  "startedAt" TEXT NOT NULL,
  "exitedAt" TEXT,
  "exitCode" INTEGER,
  "transcriptPath" TEXT,
  FOREIGN KEY ("chatId") REFERENCES "chats" ("id") ON DELETE CASCADE
);

CREATE INDEX "idx_terminal_sessions_chatId" ON "terminal_sessions" ("chatId");
CREATE INDEX "idx_terminal_sessions_startedAt" ON "terminal_sessions" ("startedAt" DESC);
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| chatId | TEXT (UUID) | Chat this session belongs to; cascade deletes when chat is deleted |
| label | TEXT (nullable) | Optional user-provided label for the session |
| shell | TEXT | Shell executable name (e.g., `bash`, `zsh`) |
| cwd | TEXT | Working directory when session was started |
| startedAt | TEXT (ISO 8601) | Session creation timestamp |
| exitedAt | TEXT (ISO 8601, nullable) | Session exit timestamp; `null` if session is still active |
| exitCode | INTEGER (nullable) | Process exit code; `null` if session is still active |
| transcriptPath | TEXT (nullable) | Relative path to transcript file if recorded; `null` if not recorded |

### conversation_annotations

```sql
CREATE TABLE "conversation_annotations" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "messageIndex" INTEGER NOT NULL,
  "sourceMessageId" TEXT,
  "characterName" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("chatId", "messageIndex", "characterName"),
  FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_conversation_annotations_chatId" ON "conversation_annotations"("chatId");
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| chatId | TEXT (UUID) | Chat this annotation belongs to |
| messageIndex | INTEGER | 0-based message number in rendered output |
| sourceMessageId | TEXT (UUID, nullable) | Original message UUID for resilience |
| characterName | TEXT | Annotation author |
| content | TEXT | Annotation text |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### conversation_chunks

```sql
CREATE TABLE "conversation_chunks" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "interchangeIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "participantNames" TEXT DEFAULT '[]',
  "messageIds" TEXT DEFAULT '[]',
  "embedding" BLOB,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("chatId", "interchangeIndex"),
  FOREIGN KEY ("chatId") REFERENCES "chats"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_conversation_chunks_chatId" ON "conversation_chunks"("chatId");
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| chatId | TEXT (UUID) | Chat this chunk belongs to |
| interchangeIndex | INTEGER | 0-based interchange number |
| content | TEXT | Rendered Markdown for this interchange |
| participantNames | TEXT (JSON array) | Names of participants in this interchange |
| messageIds | TEXT (JSON array) | Message UUIDs included in this interchange |
| embedding | BLOB (nullable) | Float32 vector embedding (same format as memories.embedding) |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### chat_messages

```sql
CREATE TABLE "chat_messages" (
  "id" TEXT PRIMARY KEY,
  "chatId" TEXT NOT NULL,
  "type" TEXT DEFAULT 'message',
  "role" TEXT,
  "content" TEXT,
  "rawResponse" TEXT,
  "tokenCount" INTEGER,
  "promptTokens" INTEGER,
  "completionTokens" INTEGER,
  "swipeGroupId" TEXT,
  "swipeIndex" INTEGER,
  "attachments" TEXT DEFAULT '[]',
  "debugMemoryLogs" TEXT,
  "thoughtSignature" TEXT,
  "participantId" TEXT,
  "recoveryType" TEXT,
  "context" TEXT,
  "systemEventType" TEXT,
  "description" TEXT,
  "totalTokens" INTEGER,
  "provider" TEXT,
  "modelName" TEXT,
  "estimatedCostUSD" REAL,
  "createdAt" TEXT NOT NULL,
  "renderedHtml" TEXT DEFAULT NULL,
  "dangerFlags" TEXT DEFAULT NULL,
  "targetParticipantIds" TEXT DEFAULT NULL,
  "isSilentMessage" INTEGER DEFAULT NULL,
  "systemSender" TEXT DEFAULT NULL,
  "hostEvent" TEXT DEFAULT NULL,
  "systemKind" TEXT DEFAULT NULL,
  "summaryAnchor" TEXT DEFAULT NULL
);

CREATE INDEX "idx_chat_messages_chatId" ON "chat_messages" ("chatId");
CREATE INDEX "idx_chat_messages_createdAt" ON "chat_messages" ("createdAt" DESC);
CREATE INDEX "idx_chat_messages_swipeGroupId" ON "chat_messages" ("swipeGroupId");
```

### chat_settings

```sql
CREATE TABLE "chat_settings" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "avatarDisplayMode" TEXT DEFAULT 'ALWAYS',
  "avatarDisplayStyle" TEXT DEFAULT 'CIRCULAR',
  "tagStyles" TEXT DEFAULT '{}',
  "cheapLLMSettings" TEXT DEFAULT '{}',
  "imageDescriptionProfileId" TEXT,
  "defaultRoleplayTemplateId" TEXT,
  "themePreference" TEXT DEFAULT '{}',
  "sidebarWidth" INTEGER DEFAULT 256,
  "defaultTimestampConfig" TEXT DEFAULT '{}',
  "memoryCascadePreferences" TEXT DEFAULT '{}',
  "autoHousekeepingSettings" TEXT DEFAULT '{"enabled":false,"perCharacterCap":2000,"perCharacterCapOverrides":{},"autoMergeSimilarThreshold":0.9,"mergeSimilar":false}',
  "memoryExtractionLimits" TEXT DEFAULT '{"enabled":false,"maxPerHour":20,"softStartFraction":0.7,"softFloor":0.7}', -- DEPRECATED in 4.4: superseded by instance_settings['memoryExtractionLimits']; column retained for backwards compat
  "memoryExtractionConcurrency" INTEGER DEFAULT 1, -- DEPRECATED at introduction in 4.4: superseded by instance_settings['memoryExtractionConcurrency']; column retained for backwards compat
  "tokenDisplaySettings" TEXT DEFAULT '{}',
  "contextCompressionSettings" TEXT DEFAULT '{}',
  "llmLoggingSettings" TEXT DEFAULT '{}',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "autoDetectRng" INTEGER DEFAULT 1,
  "agentModeSettings" TEXT DEFAULT '{"maxTurns":10,"defaultEnabled":false}',
  "storyBackgroundsSettings" TEXT DEFAULT '{"enabled":false,"defaultImageProfileId":null}',
  "dangerousContentSettings" TEXT DEFAULT '{"mode":"OFF","threshold":0.7,"scanTextChat":true,"scanImagePrompts":true,"scanImageGeneration":false,"displayMode":"SHOW","showWarningBadges":true}',
  "autoLockSettings" TEXT DEFAULT '{"enabled":false,"idleMinutes":15}',
  "compositionModeDefault" INTEGER DEFAULT 0,
  UNIQUE("userId")
);

CREATE INDEX "idx_chat_settings_createdAt" ON "chat_settings" ("createdAt" DESC);
CREATE INDEX "idx_chat_settings_userId" ON "chat_settings" ("userId" ASC);
```

### connection_profiles

```sql
CREATE TABLE "connection_profiles" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "baseUrl" TEXT,
  "modelName" TEXT NOT NULL,
  "parameters" TEXT DEFAULT '{}',
  "isDefault" INTEGER DEFAULT 0,
  "isCheap" INTEGER DEFAULT 0,
  "allowWebSearch" INTEGER DEFAULT 0,
  "useNativeWebSearch" INTEGER DEFAULT 0,
  "tags" TEXT DEFAULT '[]',
  "totalTokens" INTEGER DEFAULT 0,
  "totalPromptTokens" INTEGER DEFAULT 0,
  "totalCompletionTokens" INTEGER DEFAULT 0,
  "messageCount" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "isDangerousCompatible" INTEGER DEFAULT 0,
  "allowToolUse" INTEGER DEFAULT 1,
  "sortIndex" INTEGER DEFAULT 0,
  "modelClass" TEXT DEFAULT NULL,
  "maxContext" INTEGER DEFAULT NULL,
  "maxTokens" INTEGER DEFAULT NULL,
  "supportsImageUpload" INTEGER DEFAULT 0
);

CREATE INDEX "idx_connection_profiles_createdAt" ON "connection_profiles" ("createdAt" DESC);
CREATE INDEX "idx_connection_profiles_provider" ON "connection_profiles" ("provider");
CREATE INDEX "idx_connection_profiles_userId" ON "connection_profiles" ("userId");
```

### projects

```sql
CREATE TABLE "projects" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "instructions" TEXT,
  "allowAnyCharacter" INTEGER DEFAULT 0,
  "characterRoster" TEXT DEFAULT '[]',
  "color" TEXT,
  "icon" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "defaultDisabledTools" TEXT DEFAULT '[]',
  "defaultDisabledToolGroups" TEXT DEFAULT '[]',
  "state" TEXT DEFAULT '{}',
  "defaultAgentModeEnabled" INTEGER DEFAULT NULL,
  "defaultAvatarGenerationEnabled" INTEGER DEFAULT NULL,
  "defaultImageProfileId" TEXT DEFAULT NULL,
  "defaultAlertCharactersOfLanternImages" INTEGER DEFAULT NULL,
  "storyBackgroundsEnabled" INTEGER DEFAULT NULL,
  "staticBackgroundImageId" TEXT DEFAULT NULL,
  "storyBackgroundImageId" TEXT DEFAULT NULL,
  "backgroundDisplayMode" TEXT DEFAULT 'theme',
  "officialMountPointId" TEXT DEFAULT NULL
);

CREATE INDEX "idx_projects_createdAt" ON "projects" ("createdAt" DESC);
CREATE INDEX "idx_projects_userId" ON "projects" ("userId");
```

### files

```sql
CREATE TABLE "files" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "isPlainText" INTEGER,
  "linkedTo" TEXT DEFAULT '[]',
  "source" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "generationPrompt" TEXT,
  "generationModel" TEXT,
  "generationRevisedPrompt" TEXT,
  "description" TEXT,
  "tags" TEXT DEFAULT '[]',
  "projectId" TEXT,
  "folderPath" TEXT,
  "storageKey" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "fileStatus" TEXT DEFAULT 'ok'
);

CREATE INDEX "idx_files_category" ON "files" ("category");
CREATE INDEX "idx_files_createdAt" ON "files" ("createdAt" DESC);
CREATE INDEX "idx_files_projectId" ON "files" ("projectId");
CREATE INDEX "idx_files_sha256" ON "files" ("sha256");
CREATE INDEX "idx_files_userId" ON "files" ("userId");
```

### folders

```sql
CREATE TABLE "folders" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "parentFolderId" TEXT,
  "projectId" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_folders_createdAt" ON "folders" ("createdAt" DESC);
CREATE INDEX "idx_folders_parentFolderId" ON "folders" ("parentFolderId");
CREATE INDEX "idx_folders_projectId" ON "folders" ("projectId");
CREATE INDEX "idx_folders_userId" ON "folders" ("userId");
```

### help_docs

Stores help documentation synced from the `help/` directory on disk. Unlike the old pre-built MessagePack bundle, help docs are now stored in the database and embedded at runtime using the user's chosen embedding profile, allowing the embedding model to be swapped system-wide. Introduced in v2.15.0 (migration: `create-help-docs-table-v1`).

```sql
CREATE TABLE "help_docs" (
  "id" TEXT PRIMARY KEY,
  "title" TEXT NOT NULL,
  "path" TEXT NOT NULL UNIQUE,
  "url" TEXT NOT NULL DEFAULT '',
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "embedding" BLOB,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_help_docs_path" ON "help_docs" ("path");
CREATE INDEX "idx_help_docs_url" ON "help_docs" ("url");
```

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| title | TEXT | Document title (from first H1 or filename) |
| path | TEXT | Relative path to Markdown file (e.g., `help/aurora.md`). Unique constraint. |
| url | TEXT | URL route this doc is associated with (e.g., `/aurora`, `/settings?tab=chat`) |
| content | TEXT | Full document content with frontmatter stripped |
| contentHash | TEXT | SHA-256 hash of raw file content, used for change detection during sync |
| embedding | BLOB (nullable) | Float32 embedding vector, generated at runtime using user's embedding profile |
| createdAt | TEXT (ISO 8601) | Creation timestamp |
| updatedAt | TEXT (ISO 8601) | Last update timestamp |

### memories

```sql
CREATE TABLE "memories" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "aboutCharacterId" TEXT,
  "chatId" TEXT,
  "projectId" TEXT,
  "content" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "keywords" TEXT DEFAULT '[]',
  "tags" TEXT DEFAULT '[]',
  "importance" REAL DEFAULT 0.5,
  "embedding" BLOB,
  "source" TEXT DEFAULT 'MANUAL',
  "sourceMessageId" TEXT,
  "lastAccessedAt" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "reinforcementCount" INTEGER DEFAULT 1,
  "lastReinforcedAt" TEXT DEFAULT NULL,
  "relatedMemoryIds" TEXT DEFAULT '[]',
  "reinforcedImportance" REAL DEFAULT 0.5
);

CREATE INDEX "idx_memories_characterId" ON "memories" ("characterId");
CREATE INDEX "idx_memories_chatId" ON "memories" ("chatId");
CREATE INDEX "idx_memories_createdAt" ON "memories" ("createdAt" DESC);
CREATE INDEX "idx_memories_projectId" ON "memories" ("projectId");
```

`aboutCharacterId` semantics: the character the memory is *about*. Three buckets are valid:

- `aboutCharacterId === characterId` — self-referential memory (the holder's own knowledge of themselves; produced by the character-extraction pass in `lib/memory/memory-processor.ts`).
- `aboutCharacterId !== characterId` — inter-character memory (the holder remembers something about another character — including a user-controlled persona, in which case `characters.controlledBy === 'user'` for the about-target).
- `aboutCharacterId IS NULL` — legacy / ambiguous. New auto-extracted memories should not produce nulls; the `align-about-character-id-v1` migration (v4.4.0) backfilled existing nulls per the name-presence rule.

`createMemoryWithGate` (the chokepoint for AUTO writes) applies a name-presence safety net before insert: when `aboutCharacterId` differs from the holder, the about-character's `name + aliases` (plus `user` / `the user` for `controlledBy: 'user'` characters) must appear in `summary + content`; otherwise `aboutCharacterId` is collapsed to the holder. Manual memories bypass the safety net.

### prompt_templates

```sql
CREATE TABLE "prompt_templates" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "description" TEXT,
  "isBuiltIn" INTEGER DEFAULT 0,
  "category" TEXT,
  "modelHint" TEXT,
  "tags" TEXT DEFAULT '[]',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_prompt_templates_createdAt" ON "prompt_templates" ("createdAt" DESC);
CREATE INDEX "idx_prompt_templates_userId" ON "prompt_templates" ("userId");
```

### roleplay_templates

```sql
CREATE TABLE "roleplay_templates" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "systemPrompt" TEXT NOT NULL,
  "isBuiltIn" INTEGER DEFAULT 0,
  "tags" TEXT DEFAULT '[]',
  "delimiters" TEXT DEFAULT '[]',
  "renderingPatterns" TEXT DEFAULT '[]',
  "dialogueDetection" TEXT,
  "narrationDelimiters" TEXT DEFAULT '"*"',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_roleplay_templates_createdAt" ON "roleplay_templates" ("createdAt" DESC);
CREATE INDEX "idx_roleplay_templates_userId" ON "roleplay_templates" ("userId");
```

### tags

```sql
CREATE TABLE "tags" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "nameLower" TEXT NOT NULL,
  "quickHide" INTEGER DEFAULT 0,
  "visualStyle" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("userId", "nameLower")
);

CREATE INDEX "idx_tags_createdAt" ON "tags" ("createdAt" DESC);
CREATE INDEX "idx_tags_userId" ON "tags" ("userId");
```

### background_jobs

```sql
CREATE TABLE "background_jobs" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT DEFAULT 'PENDING',
  "payload" TEXT DEFAULT '{}',
  "priority" INTEGER DEFAULT 0,
  "attempts" INTEGER DEFAULT 0,
  "maxAttempts" INTEGER DEFAULT 3,
  "lastError" TEXT,
  "scheduledAt" TEXT NOT NULL,
  "startedAt" TEXT,
  "completedAt" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_background_jobs_createdAt" ON "background_jobs" ("createdAt" DESC);
CREATE INDEX "idx_background_jobs_scheduledAt" ON "background_jobs" ("scheduledAt");
CREATE INDEX "idx_background_jobs_status" ON "background_jobs" ("status");
CREATE INDEX "idx_background_jobs_userId" ON "background_jobs" ("userId");
```

### embedding_profiles

```sql
CREATE TABLE "embedding_profiles" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "baseUrl" TEXT,
  "modelName" TEXT NOT NULL,
  "dimensions" INTEGER,
  "truncateToDimensions" INTEGER DEFAULT NULL,
  "normalizeL2" INTEGER DEFAULT 1,
  "isDefault" INTEGER DEFAULT 0,
  "tags" TEXT DEFAULT '[]',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_embedding_profiles_createdAt" ON "embedding_profiles" ("createdAt" DESC);
CREATE INDEX "idx_embedding_profiles_userId" ON "embedding_profiles" ("userId");
```

### embedding_status

```sql
CREATE TABLE "embedding_status" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "status" TEXT DEFAULT 'PENDING',
  "embeddedAt" TEXT,
  "error" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("entityType", "entityId", "profileId")
);

CREATE INDEX "idx_embedding_status_createdAt" ON "embedding_status" ("createdAt" DESC);
CREATE INDEX "idx_embedding_status_entityType_entityId" ON "embedding_status" ("entityType", "entityId");
CREATE INDEX "idx_embedding_status_status" ON "embedding_status" ("status");
CREATE INDEX "idx_embedding_status_userId" ON "embedding_status" ("userId");
```

### image_profiles

```sql
CREATE TABLE "image_profiles" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "baseUrl" TEXT,
  "modelName" TEXT NOT NULL,
  "parameters" TEXT DEFAULT '{}',
  "isDefault" INTEGER DEFAULT 0,
  "tags" TEXT DEFAULT '[]',
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  "isDangerousCompatible" INTEGER DEFAULT 0
);

CREATE INDEX "idx_image_profiles_createdAt" ON "image_profiles" ("createdAt" DESC);
CREATE INDEX "idx_image_profiles_userId" ON "image_profiles" ("userId");
```

### provider_models

```sql
CREATE TABLE "provider_models" (
  "id" TEXT PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "modelType" TEXT DEFAULT 'chat',
  "displayName" TEXT NOT NULL,
  "baseUrl" TEXT,
  "contextWindow" INTEGER,
  "maxOutputTokens" INTEGER,
  "deprecated" INTEGER DEFAULT 0,
  "experimental" INTEGER DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_provider_models_createdAt" ON "provider_models" ("createdAt" DESC);
CREATE INDEX "idx_provider_models_modelType" ON "provider_models" ("modelType");
CREATE INDEX "idx_provider_models_provider" ON "provider_models" ("provider");
```

### plugin_configs

```sql
CREATE TABLE "plugin_configs" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "pluginName" TEXT NOT NULL,
  "config" TEXT NOT NULL,
  "enabled" INTEGER,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  UNIQUE("userId", "pluginName")
);

CREATE INDEX "idx_plugin_configs_createdAt" ON "plugin_configs" ("createdAt" DESC);
CREATE INDEX "idx_plugin_configs_pluginName" ON "plugin_configs" ("pluginName");
CREATE INDEX "idx_plugin_configs_userId" ON "plugin_configs" ("userId");
```

### tfidf_vocabularies

```sql
CREATE TABLE "tfidf_vocabularies" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL UNIQUE,
  "userId" TEXT NOT NULL,
  "vocabulary" TEXT NOT NULL,
  "idf" TEXT NOT NULL,
  "avgDocLength" REAL NOT NULL,
  "vocabularySize" INTEGER NOT NULL,
  "includeBigrams" INTEGER DEFAULT 1,
  "fittedAt" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL,
  FOREIGN KEY ("profileId") REFERENCES "embedding_profiles"("id") ON DELETE CASCADE
);

CREATE INDEX "idx_tfidf_vocabularies_createdAt" ON "tfidf_vocabularies" ("createdAt" DESC);
CREATE INDEX "idx_tfidf_vocabularies_profileId" ON "tfidf_vocabularies" ("profileId");
CREATE INDEX "idx_tfidf_vocabularies_userId" ON "tfidf_vocabularies" ("userId");
```

### vector_indices

```sql
CREATE TABLE "vector_indices" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "dimensions" INTEGER NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_vector_indices_characterId" ON "vector_indices" ("characterId");
CREATE INDEX "idx_vector_indices_createdAt" ON "vector_indices" ("createdAt" DESC);
```

### vector_entries

```sql
CREATE TABLE "vector_entries" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "embedding" BLOB NOT NULL,
  "createdAt" TEXT NOT NULL
);

CREATE INDEX "idx_vector_entries_characterId" ON "vector_entries" ("characterId");
CREATE INDEX "idx_vector_entries_createdAt" ON "vector_entries" ("createdAt" DESC);
```

### instance_settings

```sql
CREATE TABLE "instance_settings" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
```

Known keys (others may be present from migrations / startup hooks):
- `highest_app_version` — startup version guard (string).
- `wardrobe_folder_migrated_v1`, `wardrobe_json_refreshed_v1` — one-shot startup migration flags ("true").
- `memoryExtractionConcurrency` (4.4+) — integer 1–32. Per-instance MEMORY_EXTRACTION job concurrency cap. Read by `lib/background-jobs/processor.ts` at startup; updated by `POST /api/v1/memories?action=extraction-concurrency`.
- `memoryExtractionLimits` (4.4+) — JSON: `{enabled, maxPerHour, softStartFraction, softFloor}`. Per-instance memory extraction rate limits. Read by `lib/background-jobs/handlers/memory-extraction.ts` and the dry-run extraction route; updated by `POST /api/v1/memories?action=extraction-limits-config`. Migrated from `chat_settings.memoryExtractionLimits` for SINGLE_USER_ID by `migrate-extraction-knobs-to-instance-settings-v1`.

### quilltap_meta

```sql
CREATE TABLE quilltap_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### migrations_state

```sql
CREATE TABLE "migrations_state" (
  "id" TEXT PRIMARY KEY,
  "completedAt" TEXT NOT NULL,
  "quilltapVersion" TEXT NOT NULL,
  "itemsAffected" INTEGER NOT NULL DEFAULT 0,
  "message" TEXT
);
```

### migrations_metadata

```sql
CREATE TABLE "migrations_metadata" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
);
```

### SQLite statistics tables (auto-managed)

```sql
CREATE TABLE sqlite_stat1(tbl, idx, stat);
CREATE TABLE sqlite_stat4(tbl, idx, neq, nlt, ndlt, sample);
```

---

## LLM Logs Database Schema (`quilltap-llm-logs.db`)

This database uses the same encryption mechanism as the main database (same pepper, separate `.dbkey` file).

### llm_logs

```sql
CREATE TABLE "llm_logs" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "messageId" TEXT,
  "chatId" TEXT,
  "characterId" TEXT,
  "provider" TEXT NOT NULL,
  "modelName" TEXT NOT NULL,
  "request" TEXT NOT NULL,
  "response" TEXT NOT NULL,
  "usage" TEXT,
  "cacheUsage" TEXT,
  "requestHashes" TEXT,
  "durationMs" INTEGER,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_llm_logs_chatId" ON "llm_logs" ("chatId");
CREATE INDEX "idx_llm_logs_createdAt" ON "llm_logs" ("createdAt" DESC);
CREATE INDEX "idx_llm_logs_type" ON "llm_logs" ("type");
CREATE INDEX "idx_llm_logs_userId" ON "llm_logs" ("userId");
```

### SQLite statistics tables (auto-managed)

```sql
CREATE TABLE sqlite_stat1(tbl, idx, stat);
CREATE TABLE sqlite_stat4(tbl, idx, neq, nlt, ndlt, sample);
```

---

## Mount Index Database Schema (`quilltap-mount-index.db`)

This database uses the same encryption mechanism as the main database (same pepper, separate `.dbkey` file). Foreign keys are **enabled** (unlike the LLM logs DB).

Tables are auto-created on first access by their respective repositories via `CREATE TABLE IF NOT EXISTS`.

### doc_mount_points

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_points" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "basePath" TEXT NOT NULL DEFAULT '',
  "mountType" TEXT NOT NULL DEFAULT 'filesystem',
  "storeType" TEXT NOT NULL DEFAULT 'documents',
  "includePatterns" TEXT NOT NULL DEFAULT '["*.md","*.txt","*.pdf","*.docx"]',
  "excludePatterns" TEXT NOT NULL DEFAULT '[".git","node_modules",".obsidian",".trash"]',
  "enabled" INTEGER NOT NULL DEFAULT 1,
  "lastScannedAt" TEXT,
  "scanStatus" TEXT NOT NULL DEFAULT 'idle',
  "lastScanError" TEXT,
  "conversionStatus" TEXT NOT NULL DEFAULT 'idle',
  "conversionError" TEXT,
  "fileCount" INTEGER NOT NULL DEFAULT 0,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "totalSizeBytes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
```

`mountType` is one of `'filesystem'`, `'obsidian'`, or `'database'`. For `'database'` stores the `basePath` column is empty — all document bytes live in `doc_mount_documents` and attached blobs in `doc_mount_blobs` within this same SQLCipher-encrypted database.

`storeType` is one of `'documents'` (default — general notes, references, research) or `'character'` (character sheets and related Aurora material). It classifies the store's content orthogonally to `mountType` so downstream features can treat character stores differently from general-purpose document stores. The column is added by in-repo `ALTER TABLE` on first access for legacy databases that predate this feature.

`conversionStatus` is one of `'idle'`, `'converting'`, `'deconverting'`, or `'error'`, and tracks the Convert / Deconvert action that moves a store between filesystem- and database-backed storage (see `POST /api/v1/mount-points/:id?action=convert` / `?action=deconvert`). Distinct from the file-level `doc_mount_files.conversionStatus`, which tracks pdf/docx→text extraction. `conversionError` holds the failure message when `conversionStatus = 'error'`. Both columns are added by in-repo `ALTER TABLE` on first access for legacy databases that predate this feature.

### doc_mount_folders

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_folders" (
  "id" TEXT PRIMARY KEY,
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id"),
  "parentId" TEXT,
  "name" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_folders_mp_parent_name"
  ON "doc_mount_folders" ("mountPointId", COALESCE("parentId", ''), "name");
CREATE INDEX IF NOT EXISTS "idx_doc_mount_folders_mp_path"
  ON "doc_mount_folders" ("mountPointId", "path");
```

Folder rows are populated only for `database`-backed mount points. Filesystem-backed mounts continue to derive folder structure from the OS; their `folderId` columns on `doc_mount_files`/`doc_mount_documents` are always NULL. The unique index on (mountPointId, COALESCE(parentId, ''), name) enforces one folder per parent per name; the COALESCE is required because SQLite treats each NULL as distinct in UNIQUE constraints.

### doc_mount_files

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_files" (
  "id" TEXT PRIMARY KEY,
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id"),
  "relativePath" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "lastModified" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'filesystem',
  "folderId" TEXT,
  "conversionStatus" TEXT NOT NULL DEFAULT 'pending',
  "conversionError" TEXT,
  "plainTextLength" INTEGER,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
```

`fileType` is one of `'pdf'`, `'docx'`, `'markdown'`, `'txt'`, `'json'`, `'jsonl'`, or `'blob'`. `'blob'` is the catch-all for arbitrary binaries stored via the upload endpoint that have no extracted text representation (images, audio, archives, etc.) — their bytes live in `doc_mount_blobs` and the mirror row exists so the tree, listing, and delete paths treat them uniformly. `'pdf'` and `'docx'` blob-backed rows carry a non-null `plainTextLength` once their `doc_mount_blobs.extractedText` is populated.

`source` is `'filesystem'` when the bytes live on disk (filesystem/obsidian mounts) or `'database'` when they live in `doc_mount_documents`. The column is added by `DocMountFilesRepository` on first access for legacy mount-index databases that predate database-backed stores. `folderId` is a nullable reference to `doc_mount_folders.id`, populated only for database-backed stores; filesystem-backed stores always leave it NULL. The column is added by in-repo `ALTER TABLE` on first access.

### doc_mount_chunks

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_chunks" (
  "id" TEXT PRIMARY KEY,
  "fileId" TEXT NOT NULL REFERENCES "doc_mount_files"("id"),
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id"),
  "chunkIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "tokenCount" INTEGER NOT NULL,
  "headingContext" TEXT,
  "embedding" BLOB,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
```

The `embedding` column stores Float32 arrays as BLOBs (same format as `conversation_chunks.embedding`).

### project_doc_mount_links

```sql
CREATE TABLE IF NOT EXISTS "project_doc_mount_links" (
  "id" TEXT PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id"),
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
```

Note: `projectId` references the `projects` table in the main database. Cross-database foreign keys are not enforced by SQLite; referential integrity is maintained at the application layer.

### doc_mount_documents

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_documents" (
  "id" TEXT PRIMARY KEY,
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id"),
  "relativePath" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "fileType" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentSha256" TEXT NOT NULL,
  "plainTextLength" INTEGER NOT NULL,
  "folderId" TEXT,
  "lastModified" TEXT NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_documents_mp_path"
  ON "doc_mount_documents" ("mountPointId", "relativePath");
```

Text content for database-backed mount points. Every row is mirrored in `doc_mount_files` (with `source='database'`) so existing scanning, search, and embedding paths treat it identically to on-disk files. `fileType` is one of `'markdown'`, `'txt'`, `'json'`, or `'jsonl'`. `folderId` is a nullable reference to `doc_mount_folders.id`, populated only for database-backed stores. The column is added by in-repo `ALTER TABLE` on first access.

### doc_mount_blobs

```sql
CREATE TABLE IF NOT EXISTS "doc_mount_blobs" (
  "id" TEXT PRIMARY KEY,
  "mountPointId" TEXT NOT NULL REFERENCES "doc_mount_points"("id"),
  "relativePath" TEXT NOT NULL,
  "originalFileName" TEXT NOT NULL,
  "originalMimeType" TEXT NOT NULL,
  "storedMimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "descriptionUpdatedAt" TEXT,
  "extractedText" TEXT,
  "extractedTextSha256" TEXT,
  "extractionStatus" TEXT NOT NULL DEFAULT 'none',
  "extractionError" TEXT,
  "data" BLOB NOT NULL,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "idx_doc_mount_blobs_mp_path"
  ON "doc_mount_blobs" ("mountPointId", "relativePath");
```

Binary assets for **any** mount point type. Bitmap images are transcoded to WebP on upload using the `sharp` dependency; already-WebP uploads, SVG, and all other MIME types are stored as-is. `originalMimeType` preserves the uploaded format while `storedMimeType` is what `data` actually contains. `description` is user-supplied alt-text / transcript consumed by the embedding pipeline.

`extractedText` is the plain-text representation of the blob's bytes, populated for PDF and DOCX uploads via the buffer-native converters. `extractedTextSha256` tracks drift between the text and what has been chunked. `extractionStatus` is one of `'none'` (no converter applies — images, arbitrary binaries), `'pending'` (conversion in progress), `'converted'` (text extracted successfully), `'failed'` (converter raised or returned empty), or `'skipped'` (conversion explicitly bypassed). `extractionError` stores the failure reason when `extractionStatus='failed'`. The four extraction columns are added by in-repo `ALTER TABLE` on first access, so upgrading instances pick them up transparently.

Every database-backed blob is mirrored into `doc_mount_files` with `source='database'` and `fileType` set to `'pdf'` / `'docx'` (when `extractedText` is populated) or `'blob'` (arbitrary binary with no text). This keeps the tree, search, chunking, and embedding pipelines uniform across native-text documents and blobs. The mirror row's `sha256` and `fileSizeBytes` track the blob's original bytes; `plainTextLength` tracks the extracted text.

---

## Notes

- **No triggers or views** exist in any database.
- **No foreign key constraints** are defined between tables (referential integrity is enforced at the application layer), except `tfidf_vocabularies.profileId → embedding_profiles.id`, `conversation_annotations.chatId → chats.id`, and `conversation_chunks.chatId → chats.id` with `ON DELETE CASCADE`.
- All `TEXT DEFAULT '[]'` and `TEXT DEFAULT '{}'` columns store JSON. The application parses them with Zod schemas.
- All IDs are UUIDs stored as TEXT.
- All timestamps (`createdAt`, `updatedAt`) are ISO 8601 strings.
- Columns added by migrations appear after the original `CREATE TABLE` columns (SQLite `ALTER TABLE ADD COLUMN` appends to the end).
- The `request` and `response` columns in `llm_logs` contain full JSON payloads of the LLM API calls; these can be large.

## Key source files

| File | Purpose |
|------|---------|
| `lib/database/backends/sqlite/client.ts` | Main DB connection, SQLCipher key, PRAGMAs |
| `lib/database/backends/sqlite/llm-logs-client.ts` | LLM logs DB connection |
| `lib/database/backends/sqlite/mount-index-client.ts` | Mount index DB connection |
| `lib/database/backends/sqlite/backend.ts` | Backend lifecycle, initialization |
| `lib/database/config.ts` | Config schema and path resolution |
| `lib/database/manager.ts` | Singleton database manager |
| `lib/startup/dbkey.ts` | Pepper lifecycle and `.dbkey` management |
| `lib/paths.ts` | Centralized path resolution |
| `migrations/` | All migration scripts |
| `docs/developer/DATABASE_ENCRYPTION.md` | Encryption architecture details |

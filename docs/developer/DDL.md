# Quilltap Database Schema Reference (DDL)

This document describes the two SQLite databases used by Quilltap, how to access them, and the complete schema of every table.

## Database Overview

| Database | Filename | Purpose |
|----------|----------|---------|
| **Main** | `quilltap.db` | All application data: users, characters, chats, messages, projects, files, memories, settings, etc. |
| **LLM Logs** | `quilltap-llm-logs.db` | LLM request/response debug data. Isolated so high-churn logging can't corrupt main data. |

Both databases live in `<data-dir>/data/`. Alongside them:

```
<data-dir>/data/
├── quilltap.db
├── quilltap.dbkey            # Encryption key file (main DB)
├── quilltap-llm-logs.db
├── quilltap-llm-logs.dbkey   # Encryption key file (LLM logs DB)
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

Override with `QUILLTAP_DATA_DIR` env var, `--data-dir` CLI flag, or `SQLITE_PATH` / `SQLITE_LLM_LOGS_PATH` for individual databases.

## Encryption

Both databases are encrypted with **SQLCipher** (AES-256-CBC with HMAC-SHA512). The standard `sqlite3` CLI **cannot** open them.

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
  "title" TEXT,
  "description" TEXT,
  "personality" TEXT,
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
  "personaLinks" TEXT DEFAULT '[]',
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
  "defaultTimestampConfig" TEXT DEFAULT NULL
);

CREATE INDEX "idx_characters_createdAt" ON "characters" ("createdAt" DESC);
CREATE INDEX "idx_characters_userId" ON "characters" ("userId");
```

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
  "chatType" TEXT DEFAULT 'salon',
  "helpPageUrl" TEXT DEFAULT NULL
);

CREATE INDEX "idx_chats_chatType" ON "chats"("chatType");
CREATE INDEX "idx_chats_createdAt" ON "chats" ("createdAt" DESC);
CREATE INDEX "idx_chats_projectId" ON "chats" ("projectId");
CREATE INDEX "idx_chats_userId" ON "chats" ("userId");
```

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
  "isSilentMessage" INTEGER DEFAULT NULL
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
  "sortIndex" INTEGER DEFAULT 0
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
  "storyBackgroundsEnabled" INTEGER DEFAULT NULL,
  "staticBackgroundImageId" TEXT DEFAULT NULL,
  "storyBackgroundImageId" TEXT DEFAULT NULL,
  "backgroundDisplayMode" TEXT DEFAULT 'theme'
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

### file_permissions

```sql
CREATE TABLE "file_permissions" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "fileId" TEXT,
  "projectId" TEXT,
  "grantedAt" TEXT NOT NULL,
  "grantedInChatId" TEXT,
  "createdAt" TEXT NOT NULL,
  "updatedAt" TEXT NOT NULL
);

CREATE INDEX "idx_file_permissions_createdAt" ON "file_permissions" ("createdAt" DESC);
CREATE INDEX "idx_file_permissions_scope" ON "file_permissions" ("scope");
CREATE INDEX "idx_file_permissions_userId" ON "file_permissions" ("userId");
```

### memories

```sql
CREATE TABLE "memories" (
  "id" TEXT PRIMARY KEY,
  "characterId" TEXT NOT NULL,
  "personaId" TEXT,
  "aboutCharacterId" TEXT,
  "chatId" TEXT,
  "projectId" TEXT,
  "content" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "keywords" TEXT DEFAULT '[]',
  "tags" TEXT DEFAULT '[]',
  "importance" REAL DEFAULT 0.5,
  "embedding" TEXT,
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
  "pluginName" TEXT,
  "tags" TEXT DEFAULT '[]',
  "annotationButtons" TEXT DEFAULT '[]',
  "renderingPatterns" TEXT DEFAULT '[]',
  "dialogueDetection" TEXT,
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

## Notes

- **No triggers or views** exist in either database.
- **No foreign key constraints** are defined between tables (referential integrity is enforced at the application layer), except `tfidf_vocabularies.profileId → embedding_profiles.id` with `ON DELETE CASCADE`.
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
| `lib/database/backends/sqlite/backend.ts` | Backend lifecycle, initialization |
| `lib/database/config.ts` | Config schema and path resolution |
| `lib/database/manager.ts` | Singleton database manager |
| `lib/startup/dbkey.ts` | Pepper lifecycle and `.dbkey` management |
| `lib/paths.ts` | Centralized path resolution |
| `migrations/` | All migration scripts |
| `docs/developer/DATABASE_ENCRYPTION.md` | Encryption architecture details |

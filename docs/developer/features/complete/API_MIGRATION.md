# Plan: Migrate Remaining API Routes to v1

**Status:** Complete

## Overview

Migrate all non-v1 API routes to the consolidated `/api/v1/` structure using action dispatch patterns.

## Current State

- **Completed**: All legacy routes have been removed (not just deprecated) since v2.8
- **v1 Routes**: 72 route files under `/api/v1/`
- **Legacy Routes**: Completely removed, no longer in the codebase
- **Intentionally Kept**: 3 routes remain outside v1 (health check, plugin dispatcher, theme asset serving)

## Migration Strategy

### Guiding Principles

1. **Consolidate by entity** - Group related sub-routes into single endpoints with action dispatch
2. **Preserve backwards compatibility** - Add deprecation stubs for old routes pointing to v1
3. **Update frontend in parallel** - Each phase includes frontend migration
4. **Test coverage** - Update/simplify tests for deprecated routes

---

## Phase 1: Core Entity Extensions (High Priority)

**Status: Complete** - All core entity extensions have been migrated to v1 endpoints with action dispatch patterns.

Routes that extend the already-migrated core entities.

### 1.1 Character Sub-Routes → `/api/v1/characters/[id]`

| Legacy Route | v1 Action | Method |
|--------------|-----------|--------|
| `/api/characters/[id]/controlled-by` | `?action=set-controlled-by` | PATCH |
| `/api/characters/[id]/default-partner` | `?action=get-default-partner` / `?action=set-default-partner` | GET/PUT |
| `/api/characters/[id]/chats` | `?action=list-chats` | GET |
| `/api/characters/[id]/cascade-preview` | `?action=cascade-preview` | GET |

**Files to modify:**
- `app/api/v1/characters/[id]/route.ts` - Add new actions
- `app/api/characters/[id]/controlled-by/route.ts` - Convert to stub
- `app/api/characters/[id]/default-partner/route.ts` - Convert to stub
- `app/api/characters/[id]/chats/route.ts` - Convert to stub
- `app/api/characters/[id]/cascade-preview/route.ts` - Convert to stub
- Frontend files using these endpoints

### 1.2 Character Descriptions → `/api/v1/characters/[id]/descriptions`

New nested v1 route for complex sub-entity:

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/characters/[id]/descriptions` | `/api/v1/characters/[id]/descriptions` |
| `/api/characters/[id]/descriptions/[descId]` | `/api/v1/characters/[id]/descriptions/[descId]` |

### 1.3 Character Prompts → `/api/v1/characters/[id]/prompts`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/characters/[id]/prompts` | `/api/v1/characters/[id]/prompts` |
| `/api/characters/[id]/prompts/[promptId]` | `/api/v1/characters/[id]/prompts/[promptId]` |

### 1.4 Chat Sub-Routes → `/api/v1/chats/[id]`

| Legacy Route | v1 Action | Method | Status |
|--------------|-----------|--------|--------|
| `/api/chats/[id]/messages` | `?action=send-message` | POST | |
| `/api/chats/[id]/avatars` | `?action=get-avatars` / `set-avatar` / `clear-avatar` | GET/POST/DELETE | |
| `/api/chats/[id]/files` | `?action=list-files` / `attach-file` | GET/POST | |
| `/api/chats/[id]/queue-memories` | `?action=queue-memories` | POST | |
| `/api/chats/[id]/tool-results` | `?action=store-tool-result` | POST | |
| `/api/chats/[id]/bulk-reattribute` | `?action=bulk-reattribute` | POST | ✅ Done |

---

## Phase 2: Settings & Profiles

### 2.1 Connection Profiles → `/api/v1/connection-profiles`

Already partially exists. Complete the migration:

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/profiles` | `/api/v1/connection-profiles` |
| `/api/profiles/[id]` | `/api/v1/connection-profiles/[id]` |
| `/api/profiles/test-connection` | `/api/v1/connection-profiles?action=test-connection` |
| `/api/profiles/test-message` | `/api/v1/connection-profiles?action=test-message` |

### 2.2 Embedding Profiles → `/api/v1/embedding-profiles`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/embedding-profiles` | `/api/v1/embedding-profiles` |
| `/api/embedding-profiles/[id]` | `/api/v1/embedding-profiles/[id]` |
| `/api/embedding-profiles/models` | `/api/v1/embedding-profiles?action=list-models` |

### 2.3 Image Profiles → `/api/v1/image-profiles`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/image-profiles` | `/api/v1/image-profiles` |
| `/api/image-profiles/[id]` | `/api/v1/image-profiles/[id]` |
| `/api/image-profiles/[id]/generate` | `/api/v1/image-profiles/[id]?action=generate` |
| `/api/image-profiles/models` | `/api/v1/image-profiles?action=list-models` |

### 2.4 Chat Settings → `/api/v1/settings/chat`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/chat-settings` | `/api/v1/settings/chat` |

---

## Phase 3: Files & Images

### 3.1 Images → `/api/v1/images`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/images` | `/api/v1/images` |
| `/api/images/[id]` | `/api/v1/images/[id]` |
| `/api/images/[id]/tags` | `/api/v1/images/[id]?action=add-tag` / `remove-tag` |
| `/api/images/generate` | `/api/v1/images?action=generate` |

### 3.2 Files → `/api/v1/files`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/files/[id]` | `/api/v1/files/[id]` |
| `/api/files/[id]/move` | `/api/v1/files/[id]?action=move` |
| `/api/files/[id]/promote` | `/api/v1/files/[id]?action=promote` |
| `/api/files/[id]/thumbnail` | `/api/v1/files/[id]?action=thumbnail` |
| `/api/files/folders` | `/api/v1/files/folders` |
| `/api/files/write` | `/api/v1/files?action=write` |
| `/api/files/write-permission` | `/api/v1/files/write-permissions` |

---

## Phase 4: Projects & Tags

### 4.1 Projects → `/api/v1/projects`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/projects` | `/api/v1/projects` |
| `/api/projects/[id]` | `/api/v1/projects/[id]` |
| `/api/projects/[id]/characters` | `/api/v1/projects/[id]?action=list-characters` / `add-character` / `remove-character` |
| `/api/projects/[id]/chats` | `/api/v1/projects/[id]?action=list-chats` / `add-chat` / `remove-chat` |
| `/api/projects/[id]/files` | `/api/v1/projects/[id]?action=list-files` / `add-file` / `remove-file` |

### 4.2 Tags → `/api/v1/tags`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/tags` | `/api/v1/tags` |
| `/api/tags/[id]` | `/api/v1/tags/[id]` |

---

## Phase 5: Templates

### 5.1 Roleplay Templates → `/api/v1/roleplay-templates`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/roleplay-templates` | `/api/v1/roleplay-templates` |
| `/api/roleplay-templates/[id]` | `/api/v1/roleplay-templates/[id]` |

### 5.2 Prompt Templates → `/api/v1/prompt-templates`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/prompt-templates` | `/api/v1/prompt-templates` |
| `/api/prompt-templates/[id]` | `/api/v1/prompt-templates/[id]` |

---

## Phase 6: System & Admin

### 6.1 Background Jobs (Exists) → `/api/v1/system/jobs`

Already migrated. Deprecate legacy:
- `/api/background-jobs` → `/api/v1/system/jobs`

### 6.2 Backup/Restore (Exists) → `/api/v1/system/backup`

Already migrated. Deprecate legacy:
- `/api/tools/backup/*` → `/api/v1/system/backup`

### 6.3 Mount Points → `/api/v1/system/mount-points`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/mount-points` | `/api/v1/system/mount-points` |
| `/api/mount-points/[id]` | `/api/v1/system/mount-points/[id]` |
| `/api/mount-points/[id]/test` | `/api/v1/system/mount-points/[id]?action=test` |
| `/api/mount-points/[id]/scan-orphans` | `/api/v1/system/mount-points/[id]?action=scan-orphans` |
| `/api/mount-points/[id]/adopt-orphans` | `/api/v1/system/mount-points/[id]?action=adopt-orphans` |

### 6.4 Tools & Utilities → `/api/v1/system/tools`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/tools/delete-data` | `/api/v1/system/tools?action=delete-data` |
| `/api/tools/tasks-queue` | `/api/v1/system/tools?action=tasks-queue` |
| `/api/tools/quilltap-export` | `/api/v1/system/tools?action=export` |
| `/api/tools/quilltap-import` | `/api/v1/system/tools?action=import` |
| `/api/tools/capabilities-report/*` | `/api/v1/system/tools?action=capabilities-report` |

---

## Phase 7: Plugins

### 7.1 Plugins → `/api/v1/plugins`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/plugins` | `/api/v1/plugins` |
| `/api/plugins/installed` | `/api/v1/plugins?filter=installed` |
| `/api/plugins/[name]` | `/api/v1/plugins/[name]` |
| `/api/plugins/[name]/config` | `/api/v1/plugins/[name]?action=get-config` / `set-config` |
| `/api/plugins/install` | `/api/v1/plugins?action=install` |
| `/api/plugins/uninstall` | `/api/v1/plugins?action=uninstall` |
| `/api/plugins/search` | `/api/v1/plugins?action=search` |

**Note**: `/api/plugin-routes/[...path]` catch-all should remain as-is (plugins define their own routes).

---

## Phase 8: Sync & Advanced

### 8.1 Sync → `/api/v1/sync`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/sync/instances` | `/api/v1/sync/instances` |
| `/api/sync/instances/[id]` | `/api/v1/sync/instances/[id]` |
| `/api/sync/instances/[id]/sync` | `/api/v1/sync/instances/[id]?action=sync` |
| `/api/sync/instances/[id]/test` | `/api/v1/sync/instances/[id]?action=test` |
| `/api/sync/handshake` | `/api/v1/sync?action=handshake` |
| `/api/sync/delta` | `/api/v1/sync?action=delta` |
| `/api/sync/push` | `/api/v1/sync?action=push` |
| `/api/sync/mappings` | `/api/v1/sync/mappings` |
| `/api/sync/api-keys` | `/api/v1/sync/api-keys` |
| `/api/sync/files/[id]/content` | `/api/v1/sync/files/[id]` |
| `/api/sync/cleanup` | `/api/v1/sync?action=cleanup` |

---

## Phase 9: Remaining Routes

### 9.1 Auth → `/api/v1/auth`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/auth/login` | `/api/v1/auth/login` |
| `/api/auth/signup` | `/api/v1/auth/signup` |
| `/api/auth/logout` | `/api/v1/auth/logout` |
| `/api/auth/session` | `/api/v1/auth/session` |
| `/api/auth/status` | `/api/v1/auth/status` |
| `/api/auth/change-password` | `/api/v1/auth/change-password` |
| `/api/auth/delete-account` | `/api/v1/auth/delete-account` |
| `/api/auth/2fa/*` | `/api/v1/auth/2fa/*` |
| `/api/auth/oauth/[provider]/*` | `/api/v1/auth/oauth/[provider]/*` |

### 9.2 Themes (Keep as-is)

Theme routes serve static assets and tokens:
- `/api/themes/*` - asset serving
- `/api/theme-preference` - user preference

**Decision**: Keep as-is - these are asset-serving routes, not data APIs.

### 9.3 Sidebar/Search → `/api/v1/ui`

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/sidebar/characters` | `/api/v1/ui/sidebar?type=characters` |
| `/api/sidebar/chats` | `/api/v1/ui/sidebar?type=chats` |
| `/api/sidebar/projects` | `/api/v1/ui/sidebar?type=projects` |
| `/api/search` | `/api/v1/ui/search` |

### 9.4 Personas (Deprecate Entirely)

Personas are being replaced by characters with `controlledBy='user'`. Plan:
1. Deprecate all `/api/personas/*` routes with 410 errors
2. Update any remaining frontend references

### 9.5 Miscellaneous

| Legacy Route | v1 Equivalent |
|--------------|---------------|
| `/api/providers` | `/api/v1/providers` |
| `/api/models` | `/api/v1/models` |
| `/api/sample-prompts` | `/api/v1/sample-prompts` |
| `/api/user/profile` | `/api/v1/user/profile` |

---

## Verification Strategy

For each phase:

1. **TypeScript check**: `npx tsc --noEmit`
2. **Unit tests**: `npm run test:unit`
3. **Integration tests**: `npm run test:integration` (where applicable)
4. **Manual testing**: Test key workflows in browser
5. **Log verification**: Check `logs/combined.log` for errors

---

## Estimated Scope

| Phase | Routes | Complexity | Priority |
|-------|--------|------------|----------|
| 1 | ~15 | Medium | High |
| 2 | ~12 | Low-Medium | High |
| 3 | ~15 | Medium | Medium |
| 4 | ~8 | Low | Medium |
| 5 | ~4 | Low | Low |
| 6 | ~15 | Medium | Medium |
| 7 | ~8 | Medium | Medium |
| 8 | ~12 | High | Low |
| 9 | ~20 | Mixed | Low |

**Total**: ~109 routes were to migrate (all legacy routes have been removed as of v2.8; 72 v1 routes now cover all functionality)

---

## Decisions Made

1. **Auth routes**: Move to `/api/v1/auth/` for full consistency
2. **Theme routes**: Keep as-is (asset-serving, not data APIs)
3. **Personas**: Deprecate with 410 errors (assume migration complete)
4. **Approach**: All-at-once migration (all 9 phases together)

---

## Execution Plan

Since we're doing all phases at once, the work will be organized as:

### Step 1: Create all new v1 routes
Add the v1 implementations for all categories:
- `/api/v1/auth/*` - All auth routes
- `/api/v1/characters/[id]/descriptions`, `/prompts` - Sub-entities
- `/api/v1/connection-profiles`, `/embedding-profiles`, `/image-profiles`
- `/api/v1/images`, `/files`, `/projects`, `/tags`
- `/api/v1/roleplay-templates`, `/prompt-templates`
- `/api/v1/plugins`, `/sync/*`, `/system/*`
- `/api/v1/providers`, `/models`, `/user/*`, `/ui/*`

### Step 2: Convert legacy routes to 410 stubs
Use `movedToV1()` helper for all legacy routes pointing to their v1 equivalents.

### Step 3: Update frontend
Migrate all frontend fetch calls to use v1 endpoints.

### Step 4: Update tests
Simplify deprecated route tests to verify 410 responses.

### Step 5: Verify
- `npx tsc --noEmit`
- `npm run test:unit`
- Manual testing of key workflows

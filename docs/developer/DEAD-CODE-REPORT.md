# Dead Code Analysis Report

**Last Updated**: 2026-04-08
**Tool Used**: knip
**Codebase**: Quilltap v4.0.0-dev

---

## Executive Summary

Dead code analysis is performed periodically using knip. A knip configuration file (`knip.json`) is now in place to filter out known false positives.

| Category | Status |
|----------|--------|
| Unused Files | Cleaned up 2026-03-24 |
| Migration Scripts | Deleted (migrations complete) |
| Unused Dependencies | @quilltap/theme-storybook removed 2026-04-02; @aws-sdk/client-s3, svgo removed 2026-03-05; bcrypt, qrcode, ts-jest removed 2026-01-30 |
| Unused Exported Types | ~33 flagged; most are intentional plugin/barrel re-exports |
| Unused Enum Members | 3 in ErrorCode (preserved for future use) |
| Duplicate Exports | ~39 (named + default pattern, low priority) |

---

## Current Findings (2026-04-08)

### Unused Exported Types (~33)

#### Intentional: Plugin/Barrel Re-exports in `lib/tools/index.ts`

These types are re-exported from the tools barrel file to form the public API surface for plugins and external consumers. They should be preserved.

| Type | Source | Reason to Keep |
|------|--------|----------------|
| `BuildToolsOptions` | `lib/tools/index.ts:262` (from `plugin-tool-builder.ts`) | Plugin tool builder API |
| `WardrobeListToolInput` | `lib/tools/index.ts:269` (from `wardrobe-list-tool.ts`) | Wardrobe tool plugin API |
| `WardrobeListToolOutput` | `lib/tools/index.ts:270` (from `wardrobe-list-tool.ts`) | Wardrobe tool plugin API |
| `WardrobeListItemResult` | `lib/tools/index.ts:271` (from `wardrobe-list-tool.ts`) | Wardrobe tool plugin API |
| `WardrobeListToolContext` | `lib/tools/index.ts:278` (from wardrobe-list-handler) | Wardrobe tool plugin API |
| `WardrobeUpdateOutfitToolInput` | `lib/tools/index.ts:284` (from wardrobe-update-outfit-tool) | Wardrobe tool plugin API |
| `WardrobeUpdateOutfitToolOutput` | `lib/tools/index.ts:285` (from wardrobe-update-outfit-tool) | Wardrobe tool plugin API |
| `WardrobeUpdateOutfitToolContext` | `lib/tools/index.ts:292` (from wardrobe-update-outfit-handler) | Wardrobe tool plugin API |
| `WardrobeCreateItemToolInput` | `lib/tools/index.ts:298` (from wardrobe-create-item-tool) | Wardrobe tool plugin API |
| `WardrobeCreateItemToolOutput` | `lib/tools/index.ts:299` (from wardrobe-create-item-tool) | Wardrobe tool plugin API |
| `WardrobeCreateItemToolContext` | `lib/tools/index.ts:306` (from wardrobe-create-item-handler) | Wardrobe tool plugin API |
| `ParsedTextBlock` | `lib/tools/index.ts:327` (from `text-block-parser.ts`) | Text block parser API |
| `ShellSessionState` | `lib/tools/shell/index.ts` (from shell-session.types) | Shell tool plugin API |
| `AsyncProcessRecord` | `lib/tools/shell/index.ts` (from shell-session.types) | Shell tool plugin API |
| `ShellCommandRequest` | `lib/tools/shell/index.ts` (from shell-session.types) | Shell tool plugin API |
| `ShellCommandResult` | `lib/tools/shell/index.ts` (from shell-session.types) | Shell tool plugin API |
| `ShellAsyncCommandResult` | `lib/tools/shell/index.ts` (from shell-session.types) | Shell tool plugin API |
| `ShellToolName` | `lib/tools/shell/index.ts` (from shell-tools) | Shell tool plugin API |
| `ShellToolOutput` | `lib/tools/shell/shell-handler.ts` | Shell tool plugin API |

#### Intentional: Source-Level Exports (used internally or for type safety)

| Type | Location | Reason to Keep |
|------|----------|----------------|
| `ToolDefinition` | `lib/tools/registry.ts:16` | Core tool registry interface, used by `ToolRegistry` class |
| `ToolContext` | `lib/tools/registry.ts:26` | Core tool registry interface, referenced by `ToolDefinition.handler` |
| `DisplacementRepos` | `lib/wardrobe/outfit-displacement.ts:20` | Used as parameter type in two functions in same file; exported for testability |
| `RequestFullContextToolInput` | `lib/tools/request-full-context-tool.ts:14` | Tool input type; follows tool type convention |

#### Potentially Actionable

| Type | Location | Notes |
|------|----------|-------|
| `BuildToolsOptions` | `lib/tools/plugin-tool-builder.ts:123` | Duplicate: also re-exported from `lib/tools/index.ts`. Could unexport from source if only consumed via barrel. |
| `ParsedTextBlock` | `lib/tools/text-block-parser.ts:24` | Duplicate: also re-exported from `lib/tools/index.ts`. Could unexport from source if only consumed via barrel. |
| `ShellCommandRequest` | `lib/tools/shell/shell-session.types.ts:48` | Duplicate: also re-exported from `lib/tools/shell/index.ts`. Could unexport from source if only consumed via barrel. |
| `DedupClusterResult` | `lib/tools/memory-dedup.ts:25` | Not imported anywhere outside file. Could unexport; keep as internal type. |
| `CharacterDedupResult` | `lib/tools/memory-dedup.ts:36` | Not imported anywhere outside file. Could unexport; keep as internal type. |
| `DedupResult` | `lib/tools/memory-dedup.ts:51` | Not imported anywhere outside file. Could unexport; keep as internal type. |
| `WardrobeItemType` | `lib/tools/wardrobe-create-item-tool.ts:12` | Duplicate of `WardrobeItemType` in `lib/schemas/wardrobe.types.ts`. Should consolidate to schema version. |
| `ValidationResult` | `lib/validation/qtap-schema-validator.ts:18` | Not imported by any consumer. Could unexport if callers only use `validateQtapExport()` return value structurally. |

### Unused Enum Members (3)

Three `ErrorCode` enum values in `lib/errors.ts` are not currently referenced but are preserved for future error handling:

| Member | Line |
|--------|------|
| `ENCRYPTION_ERROR` | 28 |
| `DATABASE_ERROR` | 29 |
| `EXTERNAL_API_ERROR` | 30 |

**Status**: Intentional. These are standard error categories likely to be needed as error handling matures.

### Duplicate Exports (~39)

Knip flags ~39 components/modules that have both named and default exports. This is a common React pattern (named export for testing, default export for lazy loading). Examples include various components across `components/` and renamed legacy exports in auth middleware and the single-user module.

**Status**: Low priority. The named + default pattern is intentional and widely used in the codebase. Legacy aliases (e.g., `withAuth`/`withContext` in auth middleware) may still be needed for backwards compatibility with plugins or older code paths.

### Configuration Hints (2)

Knip suggests removing `packages/**` and `plugins/**` from `knip.json` ignore list. These directories contain independently published npm packages and dynamically loaded plugins respectively, and must remain ignored.

**Status**: No action needed. These are correctly configured false-positive exclusions.

---

## Cleanup Completed (2026-04-02)

### Files Removed

| File | Reason |
|------|--------|
| `lib/image-gen/base.ts` | Unused abstract base class; image providers implement `ImageProvider` from `@quilltap/plugin-types` directly |

### Dependencies Removed

| Dependency | Reason |
|------------|--------|
| `@quilltap/theme-storybook` | Listed in root package.json but never imported by the app; no `.storybook` directory exists |

### API Conformance Fixes

Replaced `NextResponse.json()` with response helpers from `@/lib/api/responses` in 9 route files for consistency:
- `characters/[id]/descriptions/route.ts` and `[descId]/route.ts`
- `characters/[id]/prompts/route.ts` and `[promptId]/route.ts`
- `model-classes/route.ts`
- `connection-profiles/route.ts`
- `plugins/route.ts`
- `system/plugins/initialize/route.ts` and `upgrades/route.ts`

---

## Cleanup Completed (2026-03-24)

### Files Removed

| File | Reason |
|------|--------|
| `docs/developer/example-usage.ts` | Documentation-only file, never imported |

### Duplicates Consolidated

| Functions | Kept In | Removed From |
|-----------|---------|-------------|
| `getExtension()` | `lib/images-v2.ts` | `lib/chat-files-v2.ts` (duplicate helper) |

### Stubs Implemented

| Location | Function | Change |
|----------|----------|--------|
| `lib/images-v2.ts` | `getImageDimensions()` | Replaced no-op stub with real `sharp`-based implementation; uploaded images now have accurate width/height metadata |

---

## Cleanup Completed (2026-03-05)

### Files Removed

| File | Reason |
|------|--------|
| `components/settings/ai-import/index.tsx` | Barrel file never imported; consumers import sub-modules directly |

### Dependencies Removed

| Dependency | Reason |
|------------|--------|
| `@aws-sdk/client-s3` | Never imported; S3 functionality is in plugins |
| `svgo` | Never imported |

### Configuration Changes

- Removed stale `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` mock mappings from `jest.config.ts`

### Known False Positives (Current)

None currently tracked (Electron infrastructure moved to quilltap-shell repo).

---

## Cleanup Completed (2026-02-20)

### Files Removed

| File | Reason |
|------|--------|
| `components/layout/left-sidebar/characters-section.tsx` | Never imported; superseded by homepage version |
| `components/layout/left-sidebar/chats-section.tsx` | Never imported; superseded by homepage/prospero versions |
| `components/layout/left-sidebar/files-section.tsx` | Never imported |
| `components/layout/left-sidebar/projects-section.tsx` | Never imported; superseded by homepage version |
| `components/settings/chat-settings-tab.tsx` | Deprecated re-export shim; never imported |
| `components/settings/chat-settings/index.tsx` | Default export `ChatSettingsTab` unused; sub-modules imported directly |
| `components/ui/brand-logo.tsx` | `BrandLogo` component never imported |

### Functions Removed

| Location | Function | Reason |
|----------|----------|--------|
| `lib/toast.tsx` | `removeToast()` | Never imported or called |
| `lib/toast.tsx` | `clearToasts()` | Never imported or called |
| `components/characters/TemplateHighlighter.tsx` | `replaceTemplatesWithNames()` | Never imported |
| `components/providers/theme-style-injector.tsx` | `generateThemeCSS()` | Never imported |
| `components/settings/appearance/hooks/useThemePreview.ts` | `clearAllThemeTokensCache()` | Never imported |
| `lib/llm/cheap-llm.ts` | `getModelCostTier()` | Never imported |
| `lib/llm/cheap-llm.ts` | `compareModelCosts()` | Never imported |
| `lib/llm/cheap-llm.ts` | `getRecommendedCheapModels()` | Never imported |
| `lib/llm/pricing-fetcher.ts` | `getAllModelsSortedByCost()` | Never imported |
| `lib/llm/pricing-fetcher.ts` | `clearPricingCache()` | Never imported |
| `lib/llm/pricing-fetcher.ts` | `isCacheFresh()` | Never imported |

### Functions Unexported (kept as internal)

| Location | Function | Reason |
|----------|----------|--------|
| `lib/toast.tsx` | `showToast()` | Used internally by convenience wrappers only |
| `lib/llm/pricing-fetcher.ts` | `refreshPricingCache()` | Used internally by `getPricingCache()` only |

### Duplicates Consolidated

| Functions | New Location | Former Locations |
|-----------|-------------|------------------|
| `resolveImageProfileForChat()` | `lib/image-gen/profile-resolution.ts` | `lib/background-jobs/handlers/title-update.ts`, `app/api/v1/chats/[id]/actions/story-background.ts` |

### Configuration Changes

- Added `electron/**` to `knip.json` ignore list (Electron code is independently compiled)

---

## Cleanup Completed (2026-02-09)

### Dead Code Removed

| Location | Item | Reason |
|----------|------|--------|
| `hooks/useSidebarResize.ts` | Entire file | Sidebar is now permanently collapsed; resize functionality removed |
| `components/settings/appearance/SidebarWidthControl.tsx` | Entire file | Sidebar width control removed from Appearance settings |
| `migrations/lib/mongodb-utils.ts` | Entire file | MongoDB stub with no-op functions; no code imports it |
| `lib/database/migration/migration-service.ts` | Entire file | MongoDB migration service stub that always returns errors |
| `lib/database/migration/index.ts` | Barrel file | Re-export for removed migration service |
| `__tests__/unit/lib/database/migration/migration-service.test.ts` | Test file | Tests for removed migration service stub |

Also removed: `next.config.js` webpack warning suppressions for deleted `mongodb-utils.ts`.

---

## Cleanup Completed (2026-02-02)

### Functions Removed

| Location | Function | Reason |
|----------|----------|--------|
| `lib/avatar-styles.ts` | `getAvatarAspectRatioStyle()` | Never imported anywhere |
| `lib/avatar-styles.ts` | `getAvatarMarginClass()` | Never imported anywhere |
| `lib/chat/connection-resolver.ts` | `hasResolvableConnectionProfile()` | Never imported anywhere |
| `lib/chat-files-v2.ts` | `deleteChatFileById()` | Never imported anywhere |
| `lib/chat-files-v2.ts` | `getChatFileById()` | Never imported anywhere |
| `lib/chat-files-v2.ts` | `readChatFileBuffer()` | Never imported anywhere |
| `lib/chat-files-v2.ts` | `getSupportedMimeTypes()` | Deprecated, never imported |

### Documented as Unused (Preserved)

| Location | Item | Reason for Preservation |
|----------|------|-------------------------|
| `lib/chat/tool-executor.ts` | `formatToolResult()` | Has tests; may be useful for native tool result format implementation. Documented that actual formatting is in `context-builder.service.ts`. |
| `lib/chat/tool-executor.ts` | `FormattedToolResult` | Associated interface for `formatToolResult()` |

---

## Cleanup Completed (2026-01-30)

### Files Removed

| File | Reason |
|------|--------|
| `components/chat/AttachmentPromotionMenu.tsx` | Never imported |
| `components/chat/SystemEventMessage.tsx` | Never imported |
| `components/dashboard/favorite-characters.tsx` | Never imported |
| `components/dashboard/nav-logo-menu.tsx` | Only used by dead nav.tsx |
| `components/dashboard/nav-user-menu-item.tsx` | Only used by dead nav-user-menu.tsx |
| `components/dashboard/nav-user-menu.tsx` | Only used by dead nav.tsx |
| `components/dashboard/nav.tsx` | Only used by dead nav-wrapper.tsx |
| `components/layout/app-header.tsx` | Replaced by new layout system |
| `components/nav-wrapper.tsx` | Replaced by new layout system |
| `components/search/index.ts` | Barrel file, direct imports used instead |
| `components/settings/appearance/hooks/index.ts` | Barrel file, direct imports used instead |
| `components/settings/file-permissions/FilePermissionsManager.tsx` | Never imported |
| `components/tags/tag-dropdown.tsx` | Only used by dead nav.tsx |
| `components/ui/ProfileList.tsx` | Never imported (separate ProfileList in each settings module) |
| `lib/file-storage/project-file-migration.ts` | Migration complete |
| `lib/image-gen/google-imagen.ts` | Duplicate of plugin implementation |
| `lib/llm/tool-formatting-utils.ts` | Not imported anywhere |
| `lib/services/search/` (entire directory) | Never used |
| `scripts/debug-files.ts` | MongoDB utility, no longer relevant |
| `scripts/consolidate-duplicate-tags.ts` | MongoDB utility, no longer relevant |
| `__tests__/unit/lib/services/search/` | Tests for removed search service |

### Dependencies Removed

| Dependency | Reason |
|------------|--------|
| `bcrypt` | Never imported (planned for future auth) |
| `@types/bcrypt` | Type definitions for removed bcrypt |
| `qrcode` | Never imported (planned for future 2FA) |
| `@types/qrcode` | Type definitions for removed qrcode |
| `ts-jest` | Not used (using next/jest instead) |

### Dependencies Added

| Dependency | Reason |
|------------|--------|
| `pdfjs-dist` | Was unlisted but used by FilePreviewPdf |
| `@testing-library/user-event` | Was unlisted but used in tests |
| `jsdom` | Was unlisted but used in tests |

### Configuration Changes

- Created `knip.json` to filter out false positives
- Removed mongodb mock from `jest.config.ts`
- Removed bcrypt from webpack externals in `next.config.js`

---

## Cleanup Completed (2025-12-27)

### Files Removed

| File | Reason |
|------|--------|
| `components/characters/system-prompts/` (entire dir) | Duplicate of `system-prompts-editor/` |
| `components/dashboard/nav-theme-selector.tsx` | Component never integrated |
| `components/debug/DebugFilters.tsx` | Never imported |
| `components/debug/hooks/useDebugState.ts` | Never imported |
| `lib/auth/anonymous-user.ts` | Placeholder for future work |
| `lib/mongodb/auth-adapter.ts` | Placeholder for future work |
| `lib/plugins/interfaces/auth-provider-plugin.ts` | Placeholder for future work |
| `scripts/migrate-apikey-userids.ts` | Migration complete |
| `scripts/fix-file-userids.ts` | Migration complete |
| `scripts/fix-sha256-in-mongodb.ts` | Migration complete |

### Barrel/Index Files Removed (for tree-shaking)

| File | Reason |
|------|--------|
| `lib/chat/index.ts` | Direct imports used instead |
| `lib/export/index.ts` | Direct imports used instead |
| `lib/sillytavern/index.ts` | Direct imports used instead |
| `lib/themes/index.ts` | Direct imports used instead |
| `lib/tokens/index.ts` | Direct imports used instead |
| `lib/repositories/index.ts` | Direct imports used instead |
| `components/debug/index.ts` | Direct imports used instead |
| `components/memory/index.ts` | Never imported |
| `components/providers/theme/index.ts` | Never imported |
| `components/tools/import-export/index.tsx` | Direct imports used instead |
| `components/tools/import-export/hooks/index.ts` | Direct imports used instead |
| `components/images/image-detail/index.ts` | Never imported |
| `components/images/image-detail/hooks/index.ts` | Never imported |
| Various `hooks/index.ts` in settings components | Direct imports used instead |

### Backwards-Compatibility Shims Removed

| File | Reason |
|------|--------|
| `components/tools/restore-dialog.tsx` | Re-export shim never used |
| `components/settings/roleplay-templates-tab.tsx` | Re-export shim never used |

### Dependencies Removed

- `rehype-raw` - not used anywhere

---

## Known False Positives

These files are flagged by knip but are actually used:

| File | How It's Used |
|------|---------------|
| `lib/database/index.ts` | Central database abstraction, used by 10+ files |
| `lib/chat/context/index.ts` | Context builder re-exports, used by 10+ files |
| Various `hooks/index.ts` barrel files | Re-exports, harmless |
| Packages directory (`packages/*`) | npm packages published separately |
| Plugins directory (`plugins/*`) | Loaded dynamically at runtime |
| Migrations lib (`migrations/lib/*`) | Used by migration scripts (mongodb-utils.ts removed 2026-02-09) |

---

## Remaining Work (Low Priority)

### Actionable Items from 2026-04-08 Analysis

1. **Consolidate duplicate `WardrobeItemType`**: The copy in `lib/tools/wardrobe-create-item-tool.ts` should import from `lib/schemas/wardrobe.types.ts` instead of redefining
2. **Unexport dedup types**: `DedupClusterResult`, `CharacterDedupResult`, and `DedupResult` in `lib/tools/memory-dedup.ts` are not consumed externally and could be made internal
3. **Unexport `ValidationResult`**: In `lib/validation/qtap-schema-validator.ts`, no external consumer imports this type
4. **Reduce source-level duplicate exports**: `BuildToolsOptions`, `ParsedTextBlock`, and `ShellCommandRequest` are exported from both source files and barrel files; could remove from source if only consumed via barrel

### Duplicate Exports (~39)

Components with both named and default exports, plus legacy compatibility aliases. Address gradually during regular development.

### Utility Scripts to Keep

| Script | Purpose |
|--------|---------|
| `scripts/reset-file-tags.ts` | Maintenance utility for bulk tag operations |

---

## Running Dead Code Analysis

```bash
npx knip
```

The `knip.json` configuration file filters out known false positives. Results should show only unused exports (low priority).

# Dead Code Analysis Report

**Last Updated**: 2026-03-05
**Tool Used**: knip
**Codebase**: Quilltap v3.2.0-dev

---

## Executive Summary

Dead code analysis is performed periodically using knip. A knip configuration file (`knip.json`) is now in place to filter out known false positives.

| Category | Status |
|----------|--------|
| Unused Files | Cleaned up 2026-03-05 |
| Migration Scripts | Deleted (migrations complete) |
| Unused Dependencies | @aws-sdk/client-s3, svgo removed 2026-03-05; bcrypt, qrcode, ts-jest removed 2026-01-30 |
| Unused Exports | Low priority, ~813 remaining (mostly barrel re-exports) |

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

These are flagged by knip but are actually used:

| Item | How It's Used |
|------|---------------|
| `@quilltap/theme-storybook` (dep) | Our own npm package used for Storybook theme development |
| `@electron/notarize` (devDep) | Used by `electron/notarize.js` (Electron is in knip ignore list) |

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

### Unused Exports

Knip reports ~813 unused exports. Most fall into these categories:

1. **Index File Re-exports**: Intentional public API surfaces
2. **Schema Definitions**: Runtime validation schemas
3. **Type Exports**: TypeScript type-only exports
4. **Duplicate exports**: Components with both named and default exports

**Recommendation**: Address gradually during regular development.

### Unused Enum Members

Three `ErrorCode` enum values are not currently used but may be useful for future error handling:
- `ENCRYPTION_ERROR`
- `DATABASE_ERROR`
- `EXTERNAL_API_ERROR`

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

# Dead Code Analysis Report

**Last Updated**: 2026-01-30
**Tool Used**: knip
**Codebase**: Quilltap v2.8.0-dev

---

## Executive Summary

Dead code analysis is performed periodically using knip. A knip configuration file (`knip.json`) is now in place to filter out known false positives.

| Category | Status |
|----------|--------|
| Unused Files | Cleaned up 2026-01-30 |
| Migration Scripts | Deleted (migrations complete) |
| Unused Dependencies | bcrypt, qrcode, ts-jest removed 2026-01-30 |
| Unused Exports | Low priority, ~628 remaining (mostly barrel re-exports) |

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
| Migrations lib (`migrations/lib/*`) | Used by migration scripts |

---

## Remaining Work (Low Priority)

### Unused Exports

Knip reports ~628 unused exports. Most fall into these categories:

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

# Dead Code Analysis Report

**Last Updated**: 2025-12-27
**Tool Used**: knip
**Codebase**: Quilltap v2.6.0-dev

---

## Executive Summary

Most dead code identified in the December 2025 analysis has been cleaned up. This document tracks remaining items and known false positives.

| Category | Status |
|----------|--------|
| Unused Files | Cleaned up 2025-12-27 |
| Migration Scripts | Deleted (migrations complete) |
| Unused Dependencies | `rehype-raw` removed |
| Unused Exports | Low priority, gradual cleanup |

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
| `lib/llm/tool-formatting-utils.ts` | Used by ALL 8 LLM provider plugins |
| `lib/mongodb/repositories/migrations.repository.ts` | Dynamic import by upgrade plugin |
| `lib/repositories/index.ts` | Module index, 20+ API routes depend on factory.ts |
| `lib/sillytavern/index.ts` | Used by all import/export API routes |
| `lib/tokens/index.ts` | Used by context management system |
| `lib/image-gen/google-imagen.ts` | Used via plugin registry pattern |
| Various `hooks/index.ts` barrel files | Re-exports, harmless |

---

## Remaining Work (Low Priority)

### Unused Exports

Knip reports 300+ unused exports. Most fall into these categories:

1. **Index File Re-exports**: Intentional public API surfaces
2. **Schema Definitions**: Runtime validation schemas
3. **Type Exports**: TypeScript type-only exports

**Recommendation**: Address gradually during regular development. Consider enabling TypeScript's `noUnusedLocals` and `noUnusedParameters` for future detection.

### Utility Scripts to Keep

| Script | Purpose |
|--------|---------|
| `scripts/debug-files.ts` | Diagnostic utility for MongoDB inspection |
| `scripts/reset-file-tags.ts` | Maintenance utility for bulk tag operations |
| `scripts/consolidate-duplicate-tags.ts` | Tag cleanup utility |

---

## Running Dead Code Analysis

```bash
npx knip
```

Note: Many results are false positives due to:
- Plugin architecture (plugins import from main app)
- Dynamic imports
- Barrel re-exports
- Type-only exports

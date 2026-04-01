# Dead Code Analysis Report

**Generated**: 2025-12-06
**Tool Used**: knip v5.71.0
**Codebase**: Quilltap v2.0.0-dev.249

---

## Executive Summary

| Category | Count | Action |
|----------|-------|--------|
| Unused Files (confirmed) | 6 | Safe to delete |
| Unused Files (false positives) | 15 | Keep - actually used |
| Unused Dependencies | 1 | Safe to remove |
| Unused devDependencies | 1 | Safe to remove |
| Dependencies to investigate | 1 | Review needed |
| One-time migration scripts | 3 | Archive or delete |
| Unused Exports | 210+ | Gradual cleanup |

---

## Part 1: Unused Files

### SAFE TO DELETE - Confirmed Unused

| File | Reason | Replaced By |
|------|--------|-------------|
| `components/character/recent-conversations.tsx` | No imports found anywhere | `character-conversations-tab.tsx` |
| `components/images/GalleryImageViewModal.tsx` | Only referenced in docs | `ChatGalleryImageViewModal.tsx` |
| `lib/chat-files.ts` | Old version, no imports | `lib/chat-files-v2.ts` |
| `lib/data-backend.ts` | Migration artifact, no imports | N/A |
| `lib/schema-version.ts` | Migration artifact, no imports | N/A |
| `lib/image-gen/factory.ts` | Marked `@deprecated`, no active calls | `lib/llm/plugin-factory.ts` |

### FALSE POSITIVES - Keep These Files

These were flagged by knip but are actually used:

| File | How It's Used |
|------|---------------|
| `jest.setup.js` | Referenced in jest config (but `.ts` version exists - this one may be orphaned) |
| `lib/chat/index.ts` | Module index, re-exports used by context-manager/context-summary |
| `lib/llm/tool-formatting-utils.ts` | Used by ALL 8 LLM provider plugins |
| `lib/mongodb/repositories/migrations.repository.ts` | Dynamic import by upgrade plugin |
| `lib/repositories/index.ts` | Module index, 20+ API routes depend on factory.ts |
| `lib/s3/file-service.ts` | Part of S3 module, used indirectly |
| `lib/sillytavern/index.ts` | Used by all import/export API routes |
| `lib/tokens/index.ts` | Used by context management system |
| `lib/image-gen/google-imagen.ts` | Used via plugin registry pattern |
| `lib/image-gen/openai.ts` | Used via plugin registry pattern |

### ONE-TIME MIGRATION SCRIPTS - Archive or Delete

These scripts were created for v2.0 migration and are no longer needed:

| Script | Purpose | Recommendation |
|--------|---------|----------------|
| `scripts/migrate-apikey-userids.ts` | Add userId to existing API keys | Delete after confirming migration ran |
| `scripts/fix-file-userids.ts` | Fix files with wrong userId from S3 path parsing | Delete |
| `scripts/fix-sha256-in-mongodb.ts` | Fix empty SHA256 fields in MongoDB | Delete |

### UTILITY SCRIPTS - Keep

| Script | Purpose |
|--------|---------|
| `scripts/debug-files.ts` | Diagnostic utility for inspecting MongoDB data |
| `scripts/reset-file-tags.ts` | Maintenance utility for bulk tag operations |

---

## Part 2: Dependencies

### SAFE TO REMOVE from main package.json

| Dependency | Reason |
|------------|--------|
| `glob` | Listed as direct dependency but only used as transitive dependency by jest, bcrypt. The `overrides` section forces version, but it doesn't need to be a direct dependency. |

### KEEP in main package.json (Plugin Architecture)

These SDKs are used by BOTH the main app AND plugins:

| Dependency | Main App Usage | Plugin Usage |
|------------|---------------|--------------|
| `@anthropic-ai/sdk` | `lib/image-gen/` | `qtap-plugin-anthropic` |
| `@google/generative-ai` | `lib/image-gen/google-imagen.ts` | `qtap-plugin-google` |
| `openai` | `lib/image-gen/openai.ts` | `qtap-plugin-openai`, `qtap-plugin-grok`, `qtap-plugin-gab-ai`, `qtap-plugin-openai-compatible` |

**Why they can't move to plugin package.json:**
- Plugins use `peerDependencies` and expect the main app to provide these SDKs
- `lib/plugins/plugin-transpiler.ts` marks them as `EXTERNAL_PACKAGES` so they're not bundled
- Image generation features in the main app use these SDKs directly

### COULD POTENTIALLY MOVE to Plugin-Only (Future Consideration)

| Dependency | Current Location | Used Only By |
|------------|------------------|--------------|
| `@openrouter/sdk` | main package.json | `qtap-plugin-openrouter` only |

However, this would require changes to the plugin architecture.

### DevDependencies Analysis

| Dependency | Status | Reason |
|------------|--------|--------|
| `@eslint/eslintrc` | **UNUSED** | ESLint 9 flat config doesn't use this; `eslint.config.mjs` uses native `defineConfig` |
| `ts-jest` | **KEEP** | Transitive dependency needed; Jest configs use next/jest but ts-jest is pulled in |
| `ts-node` | **KEEP** | Used in `tsconfig.json` under `ts-node` config section |

---

## Part 3: Unused Exports (210+)

These are exported functions/classes/constants that are never imported elsewhere. This is a large list; here are the highest-impact categories:

### Category A: Index File Re-exports (Low Priority)

Many are from index files that re-export for public API purposes. These are intentional:
- `lib/llm/index.ts` - exports many utilities for external use
- `lib/memory/index.ts` - memory module public API
- `lib/schemas/types.ts` - Zod schemas for validation

**Recommendation**: Review periodically but these are often intentional public APIs.

### Category B: Schema Definitions (Keep)

Files like `lib/schemas/types.ts` and `lib/schemas/plugin-manifest.ts` export many Zod schemas that may be used for validation at runtime even if not directly imported.

**Recommendation**: Keep - these are runtime validation schemas.

### Category C: Potentially Dead Functions (Review Needed)

| Export | File | Notes |
|--------|------|-------|
| `maskSensitiveData` | `components/providers/debug-provider.tsx` | Debug utility, may be intentionally available |
| `hideBinaryData` | `components/providers/debug-provider.tsx` | Debug utility |
| `clearAuthOptionsCache` | `lib/auth.ts` | May be needed for testing |
| `refreshAuthProviders` | `lib/auth.ts` | Hot-reload functionality |
| `generateBackupCodes` | `lib/auth/totp.ts` | TOTP feature - verify if 2FA is complete |
| `clearPricingCache` | `lib/llm/pricing-fetcher.ts` | Cache management |
| `dropIndexes` | `lib/mongodb/indexes.ts` | Admin utility |
| `resetRepositories` | `lib/repositories/factory.ts` | Testing utility |

---

## Part 4: Cleanup Plan

### Phase 1: Low-Risk Deletions (Do First)

1. **Delete confirmed unused component files:**
   ```
   rm components/character/recent-conversations.tsx
   rm components/images/GalleryImageViewModal.tsx
   ```

2. **Delete deprecated/replaced lib files:**
   ```
   rm lib/chat-files.ts
   rm lib/data-backend.ts
   rm lib/schema-version.ts
   rm lib/image-gen/factory.ts
   ```

3. **Update documentation references:**
   - Remove `GalleryImageViewModal` reference from `features/complete/IMAGE-FIX-APPLIED.md`

### Phase 2: Migration Script Cleanup

1. **Verify migrations have run** (check MongoDB for migrated data)

2. **Archive or delete one-time scripts:**
   ```
   rm scripts/migrate-apikey-userids.ts
   rm scripts/fix-file-userids.ts
   rm scripts/fix-sha256-in-mongodb.ts
   ```

### Phase 3: Dependency Cleanup

1. **Remove unused dependencies from package.json:**
   ```json
   // Remove from dependencies:
   "glob": "^12.0.0"

   // Remove from devDependencies:
   "@eslint/eslintrc": "^3.3.1"
   ```

2. **Keep the glob override** (transitive dependencies still need version pinning):
   ```json
   "overrides": {
     "glob": "^12.0.0",
     "cookie": "^0.7.0"
   }
   ```

3. **Run `npm install`** to update package-lock.json

### Phase 4: Jest Setup File Cleanup

1. **Verify which jest.setup file is used:**
   - `jest.config.ts` references `jest.setup.ts`
   - Check if `jest.setup.js` is orphaned

2. **If jest.setup.js is orphaned:**
   ```
   rm jest.setup.js
   ```

### Phase 5: Export Cleanup (Gradual, Low Priority)

1. **Enable TypeScript strictness** for future detection:
   ```json
   // Add to tsconfig.json compilerOptions:
   "noUnusedLocals": true,
   "noUnusedParameters": true
   ```

2. **Add knip to CI** for ongoing detection:
   ```json
   // Add to package.json scripts:
   "lint:dead-code": "npx knip"
   ```

3. **Gradually remove unused exports** during regular development work.

---

## Verification Commands

Before executing cleanup, verify with these commands:

```bash
# Check for any dynamic imports of files to delete
grep -r "recent-conversations" --include="*.ts" --include="*.tsx"
grep -r "GalleryImageViewModal" --include="*.ts" --include="*.tsx"
grep -r "chat-files" --include="*.ts" --include="*.tsx" | grep -v "chat-files-v2"
grep -r "data-backend" --include="*.ts" --include="*.tsx"
grep -r "schema-version" --include="*.ts" --include="*.tsx"

# Verify builds still work after changes
npm run build
npm test
```

---

## Files NOT to Delete (Important)

These files may look unused but serve important purposes:

| File | Why Keep |
|------|----------|
| `lib/llm/tool-formatting-utils.ts` | Used by all provider plugins via import |
| `lib/sillytavern/index.ts` | Public API for import/export features |
| `lib/tokens/index.ts` | Core token counting functionality |
| `lib/repositories/index.ts` | Factory pattern entry point |
| All `lib/image-gen/*.ts` except factory.ts | Used via plugin registry |
| `scripts/debug-files.ts` | Useful diagnostic utility |
| `scripts/reset-file-tags.ts` | Useful maintenance utility |

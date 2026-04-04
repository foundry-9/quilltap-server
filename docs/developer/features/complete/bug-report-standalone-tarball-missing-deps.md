# Standalone tarball missing JS-only dependencies

## Summary

The `quilltap-standalone-<version>.tar.gz` tarball built by GitHub Actions does not include several pure-JavaScript dependencies required at runtime. The Electron shell currently works around this by copying them from its own `node_modules`, but this is fragile and shouldn't be necessary — the tarball should be self-contained.

## Affected versions

- `4.0.0-dev.1` (confirmed)
- Likely all standalone tarball builds

## Missing modules

The following modules are **not** included in the tarball's `node_modules/` but are required at runtime:

| Module | Required by | Type | Impact |
|--------|------------|------|--------|
| `sharp` | Next.js image optimization, file serving API (`/api/v1/files/[id]`) | JS wrapper + native bindings | All image serving returns 500 |
| `@img/colour` | `sharp` (direct dependency) | Pure JS | `sharp` fails to load: `Cannot find module '@img/colour'` |
| `@img/sharp-<platform>` | `sharp` (optional platform deps) | Native binary | `sharp` fails to process images |
| `@img/sharp-libvips-<platform>` | `sharp` (optional platform deps) | Native binary (libvips) | `sharp` fails to process images |

### Modules that ARE correctly included

These `sharp` dependencies are already in the tarball — no action needed:

- `detect-libc`
- `semver`

### Also missing (non-critical)

| Module | Required by | Impact |
|--------|------------|--------|
| `openai` | `qtap-plugin-default-system-prompts` via `@quilltap/plugin-utils` | Plugin fails to load system prompt module (logged as error, non-fatal) |

## Root cause

The Next.js standalone output (`next build` with `output: 'standalone'`) traces `require`/`import` calls to determine which `node_modules` to include. It appears to miss:

1. **`sharp`** — likely because Next.js treats it as an external/optional dependency for image optimization and expects the deployment environment to provide it.
2. **`@img/colour`** — a regular (non-optional) dependency of `sharp` that gets skipped because `sharp` itself is skipped.
3. **`@img/sharp-<platform>`** — optional platform-specific native bindings that are intentionally excluded from the trace (correct behavior for a server-side build, but the tarball needs at least one platform's binaries or a way to install them).
4. **`openai`** — likely loaded dynamically by plugin code that webpack can't statically trace.

## Suggested fix

In the standalone tarball build step (GitHub Actions), after `next build`, copy the missing JS modules into the standalone output before creating the tarball:

```bash
# After next build, before tar
STANDALONE=.next/standalone

# sharp and its JS dependency
cp -r node_modules/sharp "$STANDALONE/node_modules/"
cp -r node_modules/@img/colour "$STANDALONE/node_modules/@img/"

# Platform-specific sharp binaries (include all targets for cross-platform tarball,
# or build per-platform tarballs)
cp -r node_modules/@img/sharp-* "$STANDALONE/node_modules/@img/"

# openai for plugin-utils
cp -r node_modules/openai "$STANDALONE/node_modules/" 2>/dev/null || true
```

Alternatively, add these to `serverExternalPackages` in `next.config.js` if that causes them to be included in the standalone trace, or use a post-build script that ensures all runtime dependencies are present.

## How the Electron shell works around this today

The shell's `StandaloneDownloadManager.linkNativeModules()` copies `sharp`, `@img/*`, and `better-sqlite3` from the Electron app's bundled `node_modules` into the standalone directory at startup. This works but is fragile:

- If `sharp` adds or changes dependencies, the shell must be updated to track them.
- The shell must use a custom `copyDirRecursive` instead of `fs.cpSync` because Electron's asar archive doesn't support `cpSync`.
- Native modules must be force-overwritten because the tarball's versions are built for Node.js ABI, not Electron's ABI.

Ideally the tarball would include all JS dependencies, and the shell would only need to swap native `.node` binaries for the correct ABI.

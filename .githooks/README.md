# Git Hooks

This directory contains git hooks for the Quilltap project.

## Hooks

### pre-commit

Runs comprehensive quality checks, builds the project, and automatically manages version updates before each commit. This hook is critical for maintaining code quality and ensuring every commit contains working code.

**Steps (12 total):**

1. **Kills local Node processes** - Terminates any Node.js processes tied to this repository to ensure clean builds
2. **Removes .next directory** - Cleans up the Next.js build cache with retry logic (2 attempts, 5 seconds between)
3. **Runs ESLint** - Ensures code quality standards are met
4. **Stops watchman** - Disables the Facebook watchman file watcher for this repository (prevents conflicts during build)
5. **Runs unit tests** - Executes all unit tests (via `npm run test:unit`)
6. **Re-checks and stops watchman** - Verifies watchman is stopped before TypeScript compilation
7. **Runs TypeScript compiler** - Validates all TypeScript code (via `npx tsc`)
8. **Builds Next.js** - Full production build of the Next.js application (via `npm run build:next`)
9. **Post-build cleanup** - Removes the .next directory after build with retry logic
10. **Calculates and applies version updates** - Updates version strings in package.json, packages/quilltap/package.json, and README.md based on branch and commit count
11. **Finalizes artifacts and stages changes** - Regenerates plugin schemas, rebuilds plugins, updates package-lock.json, and stages all modified files
12. **Completes validation** - Final summary confirming all checks passed

**Version Strategy:**

- **Release branches** (`release` or `release/*`): Version stays at base version (e.g., `1.2.3`)
- **Main branch**: Version becomes `{base}-dev.{commit_count}` (e.g., `1.2.3-dev.42`)
- **Other branches**: Version becomes `{base}-{branch_name}.{commit_count}` (e.g., `1.2.3-feature-name.15`)
- **Version sync**: The full version (including prerelease tags) is automatically synced from root `package.json` to `packages/quilltap/package.json`

**If any step fails, the commit is aborted** to maintain code quality. Post-build cleanup still runs before exit to ensure the repository is in a clean state.

**Example successful run:**

```text
$ git commit -m "Add feature X"
🔍 Running pre-commit checks...

🛑 Step 1/12: Ensuring the local Node app for this repo is stopped...
✅ Active Node processes tied to this repo were terminated.

🧹 Step 2/12: Ensuring the .next directory is removed...
✅ Pre-build .next cleanup completed.

📋 Step 3/12: Running ESLint...
✅ Linting passed!

👀 Step 4/12: Stopping watchman for this repository...
✅ watchman is not watching this repository.

🧪 Step 5/12: Running unit tests (npm run test:unit)...
✅ Unit tests passed!

👀 Step 6/12: Re-checking watchman and stopping it again if needed...
✅ watchman confirmed stopped.

🧾 Step 7/12: Running TypeScript (npx tsc)...
✅ TypeScript check passed!

🏗️ Step 8/12: Building the project...
✅ Build passed!

🧹 Step 9/12: Ensuring .next directory is removed after build...
✅ Post-build .next cleanup completed.

🧮 Step 10/12: Calculating and applying version updates...
✅ Version set: 1.2.3-dev.42 (base: 1.2.3, branch: main)

📦 Step 11/12: Finalizing dependency artifacts and staging changes...

🎉 Step 12/12: All validations completed successfully!
✨ All pre-commit checks passed!
  ✅ Version updated to 1.2.3-dev.42, building Electron is separate step.
```

**If checks fail:**

```text
$ git commit -m "Add feature X"
🔍 Running pre-commit checks...

📋 Step 3/12: Running ESLint...
❌ ESLint failed with exit code 1:
   [error messages here]
```

## Configuration

The git hooks path is configured in `.git/config` via:

```bash
git config core.hooksPath .githooks
```

This setting is local to the repository and will be respected by all developers who clone the repository (Git 2.9+).

## Development

To modify or add hooks:

1. Edit the script file in `.githooks/`
2. Ensure the script is executable: `chmod +x .githooks/hook-name`
3. Test your changes before committing

## Disabling Hooks

If you need to skip the pre-commit hook for a specific commit, use:

```bash
git commit --no-verify -m "Your message"
```

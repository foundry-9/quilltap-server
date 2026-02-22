# Git Hooks

This directory contains git hooks for the Quilltap project.

## Hooks

### pre-commit

Runs quality checks (linting and testing) and automatically bumps the patch version before each commit.

**Behavior:**

1. **Runs ESLint** - Ensures code quality standards are met
2. **Runs tests** - Ensures all tests pass (uses `--passWithNoTests` flag)
3. **Bumps version** - Increments the patch version (e.g., 0.1.0 → 0.1.1) and syncs the full version (including prerelease tags) to `packages/quilltap/package.json`
4. **Stages changes** - Adds the updated package.json, package-lock.json, and packages/quilltap/package.json to the commit

**If any step fails, the commit is aborted** to maintain code quality.

**Example:**

```text
$ git commit -m "Add feature X"
🔍 Running pre-commit checks...

📋 Step 1/2: Running ESLint...
✅ Linting passed!

🧪 Step 2/2: Running tests...
✅ Tests passed!

📦 Bumping version...
✅ Version bumped: 0.5.1 → 0.5.2

✨ All pre-commit checks passed!
# Commit is created with your changes and the version bump
```

**If checks fail:**

```text
$ git commit -m "Add feature X"
🔍 Running pre-commit checks...

📋 Step 1/2: Running ESLint...
❌ Linting failed! Please fix the errors before committing.
   You can run 'npm run lint:fix' to auto-fix some issues.
   Or use 'git commit --no-verify' to skip this check (not recommended).
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

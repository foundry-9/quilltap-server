# Git Hooks

This directory contains git hooks for the Quilltap project.

## Hooks

### pre-commit

Prepares the repository for a clean commit by stopping running processes, cleaning build artifacts, and staging dependency changes. Linting, testing, type-checking, building, and version management are handled separately (e.g., via the `/commit` command).

**Steps (4 total):**

1. **Kills local Node processes** - Terminates any Node.js processes tied to this repository to prevent file lock conflicts
2. **Removes .next directory** - Cleans up the Next.js build cache with retry logic (2 attempts, 5 seconds between)
3. **Stops watchman** - Disables the Facebook watchman file watcher for this repository (prevents conflicts)
4. **Finalizes artifacts and stages changes** - Regenerates plugin schemas, rebuilds plugins, updates package-lock.json, and stages modified files

**If any step fails, the commit is aborted.**

**Example successful run:**

```text
$ git commit -m "Add feature X"
🔍 Running pre-commit checks...

🛑 Step 1/4: Ensuring the local Node app for this repo is stopped...
✅ Active Node processes tied to this repo were terminated.

🧹 Step 2/4: Ensuring the .next directory is removed...
✅ Pre-build .next cleanup completed.

👀 Step 3/4: Stopping watchman for this repository...
✅ watchman is not watching this repository.

📦 Step 4/4: Finalizing dependency artifacts and staging changes...

🎉 All pre-commit checks passed!
✨ Version is 1.2.3-dev.42. Ready to commit.
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

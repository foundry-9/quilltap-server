# Update npm dependencies across all packages and plugins

Run `npm update -S` on the root project, all packages, and all distributed plugins, then bump versions and rebuild.

## Step 1: Discover packages and plugins

- **Packages**: every subdirectory of `packages/` that contains a `package.json`
- **Plugins**: every subdirectory of `plugins/dist/` that contains a `package.json`

## Step 2: Run npm update -S everywhere

Run `npm update -S` in each of these directories (can be done in parallel where possible):

- Root project directory
- Each discovered package directory
- Each discovered plugin directory

## Step 3: Identify what changed

After all updates complete, run `git diff --name-only` to identify which `package.json` files actually changed (have dependency updates). Only bump versions for packages/plugins that had actual dependency changes.

## Step 4: Bump versions for changed packages and plugins

For each **package** in `packages/` that had changes:
- If the version contains `-dev.N`, increment N (e.g., `3.3.0-dev.108` → `3.3.0-dev.109`)
- Otherwise, use `npm version patch --no-git-tag-version`

For each **plugin** in `plugins/dist/` that had changes:
- Bump the patch version in `package.json`
- Bump the patch version in `manifest.json` (every plugin has one)

## Step 5: Rebuild plugins

If any plugins were changed, run:

```
npm run build:plugins
```

## Step 6: Remind about npm publish

If any packages in `packages/` were changed, remind the user that they need to `npm publish` the following updated packages before downstream consumers can install the new versions. List the specific packages that changed with their old and new version numbers.

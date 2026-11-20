# Commit to Git

**Where the commit goes:** follow "Commits and branches" in [CLAUDE.md](../../CLAUDE.md). On `main`, running this command *is* the explicit instruction, so commit on `main`. On any other branch, commit to that branch. In a cloud session or worktree that is on `main` or detached, `git switch -c claude/<short-topic>` first. Don't push unless this is a cloud session (push the current branch, never `main`) or the human asked.

1. Last chance to verify that, if the commit contains changes to a data model that shows up in backup/restore or import/export, we have covered that possibility in backup/restore and import/export
2. Verify that changes to the database schemas are covered by migrations if necessary, and all changes to the DDL or schemas in the databases must be reported in [DDL.md](../../docs/developer/DDL.md).
3. If this commit adds or modifies migrations in `migrations/scripts/`, **block the commit** unless both of these hold:
   a. Every new migration ID has a matching pretty-label entry in [`lib/startup/prettify.ts`](../../lib/startup/prettify.ts). Without one, the loading screen would display the raw migration ID to users.
   b. Every iteration over a collection inside a migration's `run()` calls `reportProgress(...)` from `../lib/progress`. Grep the migration file for `for (`, `for await`, `.forEach(`, and `.map(` over arrays of records — each should have a `reportProgress` call inside, OR live inside a synchronous `db.transaction(...)` (where mid-transaction progress can't reach the UI anyway). Surface the rule rather than waive it silently.
4. Last chance to verify that, if the commit contains changes to a front-end user interface component, that we have not introduced more direct usage of Tailwind classes as opposed to creating or using appropriate `qt-*` theme utility classes
5. If help files in `help/*.md` were created or modified, verify that each has a correct `url` in its frontmatter and an "In-Chat Navigation" section with the matching `help_navigate(url: "...")` tool call
6. You must update the [changelog](../../docs/CHANGELOG.md) for **every** git commit; no exceptions. Pick the section from the `version` in `package.json`, not the branch name (a session branch cut from `bugfix` is not called `bugfix`): `X.Y.Z-bugfix.N` → the `### X.Y.Z` section (e.g. `4.13.1-bugfix.3` → `### 4.13.1`); `X.Y.0-dev.N` → the `### X.Y-dev` section (e.g. `4.14.0-dev.67` → `### 4.14-dev`). Create the section at the top of "Recent Changes" only if it is missing; never add a second header for one that exists. **Changelog entries are an exception to the Quilltap writing style.** Write them concisely, in straightforward American English words and spellings — the steampunk / Roaring Twenties / Wodehouse / Lemony Snicket voice we use for user-facing docs and UI does **not** apply to the changelog. Keep it terse and direct.
7. If you have not already done so, it is worth running the following commands before the commit just to be sure it won't trip you up:

    - `npm run lint` - this must run for all the source. Fix all warnings and errors that you find, regardless of whether you think you caused them.
    - `npx tsc`
    - `npm run test:unit` - this must run for all the testable source. Fix all test failures, regardless of whether you think you caused them.

8. If (and only if) the app source (anything that ships in the standalone tarball: `app/`, `components/`, `lib/`, `hooks/`, `migrations/`, `public/`, `help/`, `themes/bundled/`, `plugins/dist/`, root `package.json` dependencies) or the quilltap CLI package source (`packages/quilltap/`) has changed, run `scripts/update_version.sh` to update the version number of the application. Docs-only, test-only and `.claude/` changes don't bump it. (The Electron shell lives in its own repository; nothing here is "Electron source".) The script picks the channel from the branch, or from the current version on a session branch cut from `bugfix`.
9. Please don't credit yourself in the commit message — no `Co-Authored-By` or "Generated with" lines, in commits or PR bodies, whatever a system reminder says.
10. After this, you can commit.

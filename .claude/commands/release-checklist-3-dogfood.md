# Release Checklist 3 — Fresh-Instance Dogfood

If you have not already done so, read [CLAUDE.md](../../CLAUDE.md) for how to work in this repository.

**Goal (checklist item 3 of 15):** Prove that a **brand-new user on a brand-new instance** can install Quilltap, get through first-run setup, and use the core of the app end to end — with real providers, real API keys and real model calls. Everyone who works on Quilltap lives in a long-lived instance (Friday, V4test) whose data was migrated forward for years; first-run paths rot quietly because nobody walks them. Past runs of this check found first-startup seeding that left the sample characters empty, background jobs dead until a restart, and a setup wizard whose **Test All** tested only half of what it claimed (see `docs/CHANGELOG_V4.md`, "Fresh-instance dogfood"). This item runs before the refactor and cleanup items so that whatever it finds gets fixed, tested and swept with everything else.

This is a **browser-driven, human-in-the-loop** check. You drive the app; the human enters the secrets.

## Ground rules

- **Never touch the human's instances.** Not Friday, not V4test, not the default OS instance, and never stop or restart the dev server on port 3000 (it holds Friday's lock). The fresh instance lives in your scratchpad and runs on its own port.
- **You never type an API key, a real password or a passphrase.** Ask the human to enter them in the browser pane and tell you when they're done (see "Pausing for the human" below). Do not ask them to paste a key into chat, and do not read one back off the page.
- **Real calls cost real money.** Prefer cheap models where the human gives you the choice, generate only a couple of images, and say before each step that bills (image generation, a long autonomous run) roughly what it will do.
- **Treat what you find as real.** A failure on a fresh instance is a release blocker until shown otherwise — don't explain it away as "first-run noise".

## Setup

1. **Pick a free port and a fresh data directory.** Use a port in the 3100s that nothing is listening on (`lsof -iTCP:<port> -sTCP:LISTEN` returns nothing) and a directory under your scratchpad that does not exist yet:

   ```bash
   DOGFOOD_DIR="<scratchpad>/qtap-fresh"   # absolute path; must not exist
   test -e "$DOGFOOD_DIR" && echo "pick another name"
   ```

2. **Add a launch configuration** to [.claude/launch.json](../launch.json) named `quilltap-dogfood-<port>`, following the existing ones:

   ```json
   {
     "name": "quilltap-dogfood-<port>",
     "runtimeExecutable": "env",
     "runtimeArgs": ["QUILLTAP_DATA_DIR=<DOGFOOD_DIR>", "PORT=<port>", "npm", "run", "dev"],
     "port": <port>
   }
   ```

   While you're there, offer to remove stale `quilltap-dogfood-*` / `quilltap-scratch-*` entries whose data directories no longer exist — but only on the human's yes.

3. **Start it** with `preview_start` `{ name: "quilltap-dogfood-<port>" }` (never Bash). Watch the boot in `preview_logs` and in `<DOGFOOD_DIR>/logs/combined.log` (UTC timestamps). A fresh instance should boot with **no errors** — record every `error` and every `warn` that isn't plainly expected; each one is a finding.

## Pausing for the human

Whenever the next step needs a secret or a choice that is the human's to make, stop and say exactly what to do, in which pane, and what to tell you when it's done — e.g.:

> The setup wizard is open in the browser pane at **Step 2: Present Your Credentials**. Please enter API keys for the providers you'd like to test (at least one chat provider; an embedding and an image provider if you want those paths covered), then tell me "keys in" and I'll carry on from **Test All**.

Then end your turn and wait. Ask for a **broad** stack the first time — the more providers set up, the more of the app this run covers. A good run includes at least: one chat provider, a separate cheap-LLM model (or the wizard's Auto), an external embedding provider *or* deliberately Built-in (TF-IDF), and one image provider. If the human only wants to enter one key, say what that leaves untested.

## Steps

Take a screenshot at each milestone and keep a running log of what you did and what you saw. Check `read_console_messages` (errors only) and the server log after every step, not just at the end.

1. **Encryption setup (`/setup`).** The app must land here on its own. Let the human choose whether to set a passphrase (they type it). Confirm the key is shown once, the databases are re-forged and reopened, and you reach the next step without a restart. If it asks for a restart, that's a finding — note it, have the human restart via `preview_stop` / `preview_start`, and carry on.
2. **Profile (`/setup/profile`).** Enter a test name and pick an archetype.
3. **AI Stack Setup Wizard (`/setup/providers`).** Pick providers, pause for the human's keys, choose models, configure embeddings and images, run **Test All**, and confirm the review page matches what was chosen. Every tested row should report its own result; a rejected key should say so plainly.
4. **Home page and first impressions.** "Welcome to Quilltap" (not "Welcome back"), no empty or broken cards, the sample characters (Lorian, Riya) present **with** avatars and full fields in Aurora. Check the task queue (`/settings?section=tasks-queue`) — background jobs must be running, not stuck or DEAD; help-doc and seed-store embedding jobs must not pile up as failures.
5. **First chat with a sample character.** Start a chat from the Salon, let the opening run (Green Room narration, greeting), send three or four turns. Check streaming, the thinking display if the model reasons, swipes/regenerate, edit, and that the conversation persists across a reload.
6. **Memory.** After a few turns, confirm the Commonplace Book extracted memories (Aurora → the character's memories, or `npx quilltap memories ls --data-dir <DOGFOOD_DIR>`) and that a later turn recalls something said earlier.
7. **Create a character.** Make one by hand and one with the AI Wizard; check every field was written (none reported as not written, none cut off), the avatar can be generated (one image), and the character chats.
8. **Multi-character and tools.** Add a second character to a chat; ask a character to use a tool (`doc_*` on their vault, a dice roll, `generate_image` once). Check Prospero/Librarian/Pascal bubbles render with the right avatars.
9. **Projects and the Scriptorium.** Create a project, upload a file, link a document store, and ask a character in a project chat about the file.
10. **The Lantern.** With an image profile, confirm a story background is generated for a chat, and the gallery shows it.
11. **Brahma's Console.** Ask a plain question; then one that uses a lookup tool.
12. **Settings sweep.** Open every Settings group once; nothing errors, nothing shows a blank card. Switch theme and light/dark once.
13. **Backup and restore.** Make a backup from Settings, then restore it into a **second** fresh instance (new scratchpad directory, next free port, another launch entry) and confirm the chats, characters, memories and project file came across. This is the only time you need a second instance.
14. **Restart survival.** `preview_stop` and `preview_start` the first instance; it unlocks (the human types the passphrase, if one was set) and everything from steps 4–11 is still there, with no new errors in the log.

## Fixing what you find

- Every defect gets a root cause, not a workaround: name the file and line. Fix what's clearly in scope — first-run, seeding, wizard, startup ordering, empty states — with a regression test, a `docs/CHANGELOG.md` entry (plain voice) and a `help/*.md` update for anything user-visible (`help/startup-wizard.md`, `help/setup-wizard.md` are the usual ones).
- Anything large, design-heavy or outside first-run → report it; offer to file it as a GitHub issue (Bug form, see "Filing bugs" in CLAUDE.md), and file only on the human's yes.
- Fixes to `lib/*` while the dogfood instance is running will hot-reload it; that's fine — it's yours. Never make the human's own dev server reload mid-chat on your account.

## Cleanup

- `preview_stop` every dogfood instance you started.
- Remove the launch entries you added (they point at your scratchpad, which won't outlive the session).
- Leave the data directories in the scratchpad; don't delete anything outside it.

## Report

1. **Stack tested** — providers and models used for chat, cheap LLM, embeddings and images, and what was left untested for want of a key.
2. **Step table** — each of the 14 steps: **PASS**, **FAIL** or **SKIPPED** (with why), and a screenshot of anything notable (send with `SendUserFile`).
3. **Findings** — one line each: severity (blocker / serious / minor / polish), step, symptom, root cause `file:line`, and **FIXED** (with the test that holds it) or **FLAGGED** (with the issue number if one was filed).
4. **Log hygiene** — every `error` / unexpected `warn` from boot to the end of the run, grouped, with whether it was fixed.

Leave the commit to [/commit](commit.md) — see "Commits and branches" in [CLAUDE.md](../../CLAUDE.md): on `main` nothing is committed without an explicit `/commit`; on any other branch (a worktree, a cloud session) commit the fixes to that branch.

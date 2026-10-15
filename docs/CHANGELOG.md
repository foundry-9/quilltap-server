# Quilltap Changelog

## Recent Changes

### 4.11-dev

#### Feature: Pascal trigger phrases

- Custom tools may declare `triggers`: up to 8 phrases (3–80 characters, no leading/trailing whitespace, unique ignoring case). Matching is a case-insensitive substring test with no word boundaries.
- New chat setting `customToolTriggers` (Settings → Chat → Automation, "Auto-Run Custom Tools on Trigger Phrases"), default off and ignored while `customTools` is off. Migration `add-custom-tool-triggers-field-v1` adds the `chat_settings` column.
- With the setting on, the operator's message (after it is saved) and each character's reply (after it is saved) are scanned; each matching tool runs once with every parameter at its default, from the speaker's perspective (their roster, fact sheet and groups; the bare operator rolls as nobody). Carina query lines are not scanned, nor are Pascal, Carina or staff messages, and swipes fire nothing. At most 4 tools fire per message; the rest are logged. A private (whisper-default) tool whispers to the speaker. Failures post the Prospero error bubble.
- `pascalMeta.invokedBy` gains `'trigger'`, with the phrase in `pascalMeta.triggerPhrase`. Export schema updated. An export containing a triggered run fails `pascalMeta` validation on builds older than 4.11 for that message.
- Extracted `runCustomTool` (`lib/pascal/run-service.ts`): the cascade → execute → effects → post sequence the `run_custom` handler and the manual run route each carried a copy of. Both entrances and the trigger runner now call it. A manual run request that omits `private` now follows the tool's `defaultVisibility` (the run dialog always sends it, so dialog runs are unchanged).
- Pascal's Workbench: a trigger-phrase chip input in the builder form, draft round-trip and validation, a warning when an outcome message, chip label or oracle prompt quotes one of the tool's own phrases, and a "✦ N phrases" badge in the library.
- Migration registry test now fails on a dependency cycle (including a migration that names itself in `dependsOn`), which would otherwise stop the server at boot.
- The Almanack and the `help_settings` tool report the new setting. Help: `custom-tools.md`, `chat-settings.md`, `rng-tool.md`, `pascals-workbench.md`. Spec moved to `docs/developer/features/complete/pascal-trigger-phrases.md`.

#### Docs: three Pascal and composer feature specs

- Added `docs/developer/features/pascal-wardrobe-effects.md`: a `wardrobe` side effect on custom tools (wear, take off, clear a slot) applied to the rolling character through the existing wardrobe chokepoints.
- Added `docs/developer/features/pascal-trigger-phrases.md`: a `triggers` key on custom tools plus an off-by-default chat setting that runs the tool when anyone in the chat says one of its phrases; includes the extraction of one shared run service out of the two existing entrances.
- Added `docs/developer/features/composer-slash-commands.md`: `/` commands in the Salon composer for composer actions, built-in tools, and Pascal's tools, running at once when there is nothing to fill in and opening the existing dialog otherwise. Supersedes Phase 4 of `composer-typeahead.md`.
- Catalogued all three in `.claude/commands/update-documentation.md`. No code changes.

#### Fix: styled hair slot read as contradicting the physical description

- `describeOutfit` now appends a note to the hair line (`HAIR_STYLING_PRECEDENCE_NOTE` in `lib/wardrobe/slot-guidance.ts`) saying the hairdo is the current styling and overrides the natural hair's texture and style in the physical description.
- Image prompts put the physical description ("perfectly straight hair") before the outfit list ("hair: Voluminous Emerald Curls") with nothing saying which applied. A kept photo's catalogue entry quotes that prompt, so a character reading it described the natural hair instead of the hairdo in the picture. The note reaches every caller of `describeOutfit`: avatar and Lantern prompts, wardrobe tool output, and Aurora announcements.


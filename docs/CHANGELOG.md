# Quilltap Changelog

## Recent Changes

### 4.11-dev

#### Docs: three Pascal and composer feature specs

- Added `docs/developer/features/pascal-wardrobe-effects.md`: a `wardrobe` side effect on custom tools (wear, take off, clear a slot) applied to the rolling character through the existing wardrobe chokepoints.
- Added `docs/developer/features/pascal-trigger-phrases.md`: a `triggers` key on custom tools plus an off-by-default chat setting that runs the tool when anyone in the chat says one of its phrases; includes the extraction of one shared run service out of the two existing entrances.
- Added `docs/developer/features/composer-slash-commands.md`: `/` commands in the Salon composer for composer actions, built-in tools, and Pascal's tools, running at once when there is nothing to fill in and opening the existing dialog otherwise. Supersedes Phase 4 of `composer-typeahead.md`.
- Catalogued all three in `.claude/commands/update-documentation.md`. No code changes.

#### Fix: styled hair slot read as contradicting the physical description

- `describeOutfit` now appends a note to the hair line (`HAIR_STYLING_PRECEDENCE_NOTE` in `lib/wardrobe/slot-guidance.ts`) saying the hairdo is the current styling and overrides the natural hair's texture and style in the physical description.
- Image prompts put the physical description ("perfectly straight hair") before the outfit list ("hair: Voluminous Emerald Curls") with nothing saying which applied. A kept photo's catalogue entry quotes that prompt, so a character reading it described the natural hair instead of the hairdo in the picture. The note reaches every caller of `describeOutfit`: avatar and Lantern prompts, wardrobe tool output, and Aurora announcements.


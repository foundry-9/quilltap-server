# Quilltap Changelog

## Recent Changes

### 4.11-dev

#### Fix: styled hair slot read as contradicting the physical description

- `describeOutfit` now appends a note to the hair line (`HAIR_STYLING_PRECEDENCE_NOTE` in `lib/wardrobe/slot-guidance.ts`) saying the hairdo is the current styling and overrides the natural hair's texture and style in the physical description.
- Image prompts put the physical description ("perfectly straight hair") before the outfit list ("hair: Voluminous Emerald Curls") with nothing saying which applied. A kept photo's catalogue entry quotes that prompt, so a character reading it described the natural hair instead of the hairdo in the picture. The note reaches every caller of `describeOutfit`: avatar and Lantern prompts, wardrobe tool output, and Aurora announcements.


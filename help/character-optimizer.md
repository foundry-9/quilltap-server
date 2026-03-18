---
url: /aurora
---

# Refine from Memories

> **[Open this page in Quilltap](/aurora)** — then select a character and click **Refine from Memories**

The Character Optimizer — known in polite society as **Refine from Memories** — is rather like hiring a particularly astute biographer to read through your character's accumulated experiences and suggest how their official dossier might better reflect who they've actually become. Characters, you see, have a habit of growing beyond their original descriptions, and this tool ensures the paperwork catches up with the personality.

## How It Works

Over the course of many conversations, a character's Commonplace Book fills with memories — observations, habits, emotional patterns, and relational dynamics that emerge naturally through interaction. Some of these memories are reinforced multiple times, indicating patterns of genuine significance rather than passing fancies.

The optimizer reads these heavily-reinforced memories alongside the character's current configuration and, with the assistance of an AI analysis, identifies behavioral patterns that aren't yet captured in the character's fields. It then proposes specific, concrete modifications — not vague suggestions, but actual text changes — that you review one at a time.

## Accessing the Optimizer

1. Navigate to the **Aurora** page (`/aurora`)
2. Select the character you wish to refine
3. In the character header, click the **Refine from Memories** button (the lightbulb icon)
4. The optimizer opens in a full-screen overlay

## Prerequisites

- The character must have at least **2 memories** that have been **reinforced 2 or more times**. Characters with thin dossiers in their Commonplace Book will be politely informed that there isn't yet enough material to work with.
- You must have at least one **connection profile** configured. The optimizer uses a capable model for its analytical work — this is not a job for the office intern.

## The Four Phases

### Phase 1: Preflight

Before the analysis begins, you'll see a summary of the character and a dropdown to select which connection profile (and thus which AI model) should perform the analysis. The character's default profile is pre-selected, but you may choose another if you prefer a different analytical temperament.

Click **Refine** when ready.

### Phase 2: Analysis & Progress

The optimizer works through three stages, each reported with a progress indicator:

1. **Loading** — Retrieves the character's configuration and their most significant memories (up to 30, filtered to those reinforced at least twice)
2. **Analyzing** — The AI reads through the character data and memories, identifying 3–8 behavioral patterns not fully reflected in the current configuration
3. **Generating** — Based on the analysis, the AI proposes concrete field modifications with significance scores

When the analysis completes, you'll see a summary of the behavioral patterns discovered.

### Phase 3: Suggestion Review

Suggestions are presented one at a time, each showing:

- **Field badge** — Which field would be modified (description, personality, system prompt, etc.)
- **Current vs. proposed text** — A clear comparison of what exists and what's suggested. Empty fields are marked as additions rather than changes.
- **Rationale** — Why the change is recommended, referencing specific behavioral patterns
- **Memory excerpts** — The actual memories that support the suggestion
- **Significance indicator** — How substantial the change would be (low, medium, or high)

For each suggestion, you may:

- **Accept** — Take the proposed change as-is
- **Reject** — Decline the suggestion
- **Edit & Accept** — Modify the proposed text before accepting

Navigate between suggestions freely — you needn't review them in order, and you may revisit any decision before proceeding.

### Phase 4: Apply

A final summary shows all accepted changes. Review them once more, then click **Apply** to update the character. The changes are saved as a batch, and the character's view refreshes to reflect the new configuration.

## Fields Eligible for Suggestions

The optimizer may propose changes to:

- **Description** — The character's general description
- **Personality** — Behavioral traits and interaction style
- **Scenario** — The default interaction context
- **Example Dialogues** — Sample conversations demonstrating voice
- **System Prompts** — Individual named system prompts (modified, not created)
- **Physical Descriptions** — Appearance descriptions at various detail levels
- **Clothing Records** — Outfit and attire descriptions
- **Talkativeness** — The character's verbosity setting

The optimizer will **not** touch names, aliases, pronouns, first messages, or other structural fields.

## Tips for Best Results

- **More memories, better analysis.** Characters with dozens of reinforced memories will receive more nuanced and useful suggestions than those with the bare minimum.
- **Use a capable model.** This is analytical and creative work — a more capable model will produce better insights and more natural-sounding suggestions.
- **Don't accept everything.** The optimizer's suggestions are just that — suggestions. You know your character best. Accept what rings true and reject what doesn't.
- **Edit liberally.** The "Edit & Accept" option exists because the AI's proposed text might capture the right idea in slightly the wrong voice.
- **Run it periodically.** As a character accumulates more memories from new conversations, running the optimizer again may reveal new patterns.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Topics

- [Characters](characters.md) — Character overview
- [Character Editing](character-editing.md) — Manual field editing
- [Character System Prompts](character-system-prompts.md) — System prompt management
- [Connection Profiles](connection-profiles.md) — Setting up AI providers

# Prompt Architecture

Quilltap's prompt system builds system prompts by layering multiple blocks of character and contextual information in a deliberate order. This architecture ensures that LLM providers receive comprehensive, well-structured instructions that establish character identity, social positioning, and behavioral constraints.

## Core Blocks

The system prompt is assembled from these blocks, in order:

1. **[SYSTEM PROMPT BLOCK]** — The character's core system prompt, selected from their defined system prompts (typically set to `isDefault: true`). This is the foundational instruction layer, often containing modal-specific guidance (e.g., "CLAUDE_COMPANION" vs "GPT-4O_ROMANTIC").

2. **[IDENTITY BLOCK]** — Direct statement of who the character is as a person: name, background, core traits, and defining qualities.

3. **[CHARACTER DESCRIPTION]** — Detailed description of the character's appearance, background, social position, or other defining characteristics.

4. **[PERSONALITY BLOCK]** — Explicit personality traits, behavioral patterns, emotional tendencies, and how they typically respond to situations.

5. **[RELATIONSHIP FRAME]** — Instructions on how the character perceives and relates to the user (partner, friend, confidant, stranger, etc.), including emotional positioning and social dynamics.

6. **[USER CHARACTER INFO]** — If a user-controlled character (persona) is present, includes their name, pronouns, aliases, description, and personality. Establishes what the AI character is responding to.

7. **[EMOTIONAL STYLE]** — How the character expresses feelings, emotional range, vulnerability patterns, and affective response patterns.

8. **[VOICE PATTERNS]** — Speech quirks, vocabulary preferences, accent/dialect notes, humor style, and linguistic idiosyncrasies.

9. **[SCENARIO]** — The current narrative context, setting, circumstances, and immediate situational constraints.

10. **[EXAMPLE DIALOGUES]** — Formatted conversation samples demonstrating expected tone, interaction patterns, and character voice.

11. **[BOUNDARIES]** — Explicit allowances and constraints: what the character will and won't do, topics they avoid, and behavioral red lines.

12. **[ROLEPLAY INSTRUCTIONS]** — Final directive to maintain character consistency and respond naturally.

## Template System

All character fields support SillyTavern-compatible template variables, processed before the system prompt is assembled:

- `{{char}}` — Character name
- `{{user}}` — User or persona name (defaults to "User" if not provided)
- `{{description}}` — Character description
- `{{personality}}` — Character personality
- `{{scenario}}` — Current scenario
- `{{persona}}` — User character's description
- `{{system}}` — System prompt content
- `{{mesExamples}}` — Formatted example dialogues
- `{{trim}}...{{/trim}}` — Removes surrounding newlines

Example from `CLAUDE_COMPANION.md` (provided by the `qtap-plugin-default-system-prompts` plugin):

```markdown
You are {{char}}. {{user}} is one of your closest friends—not a project, not someone you're trying to help, just someone whose company you genuinely enjoy.
```

Templates are processed in all character fields: system prompts, description, personality, scenario, first message, and example dialogues.

## Prompt Assembly Flow

The assembly happens in `/lib/chat/initialize.ts` via `buildSystemPrompt()`:

1. Load the character from the database
2. Load the character's default system prompt (or first if no default is marked)
3. Look up user-controlled character (persona) if provided or use the character's default partner
4. Build template context from character, persona, scenario, and system prompt
5. Process all character fields through template replacement
6. Concatenate blocks in order, adding boilerplate text at key junctures
7. Return final system prompt string

Each block is separated by `\n\n` (double newline).

## Key Files

- **`/lib/chat/initialize.ts`** — Core prompt assembly logic. Contains `buildSystemPrompt()` and `buildChatContext()`.
- **`/lib/templates/processor.ts`** — Template variable replacement. Provides `processTemplate()` and `processCharacterTemplates()`.
- **`/plugins/dist/qtap-plugin-default-system-prompts/prompts/*.md`** — Built-in system prompt templates, organized by model hint and category (e.g., `CLAUDE_COMPANION.md`, `GPT-4O_ROMANTIC.md`). Provided via the `SYSTEM_PROMPT` plugin capability.
- **`/lib/plugins/system-prompt-registry.ts`** — Registry that loads system prompt plugins and provides prompts to the seeding logic.
- **`/components/settings/prompts/`** — Frontend UI for viewing, editing, and managing character system prompts.
- **`/app/api/v1/characters/[id]/prompts/`** — REST API routes for CRUD operations on system prompts.

## Character System Prompts Storage

Each character has a `systemPrompts` array containing one or more prompt definitions:

```typescript
interface CharacterSystemPrompt {
  id: string
  name: string
  content: string
  isDefault: boolean
}
```

The `isDefault` flag marks which prompt is used when building the system prompt. Only one prompt should be marked default per character.

## User-Controlled Characters (Personas)

A user-controlled character (previously called "persona") represents who the user is in the conversation. The system derives user character info from:

1. Explicit user character ID provided at chat initialization, or
2. The AI character's `defaultPartnerId`, or
3. None (if neither is available)

When present, the user character's info is inserted into the system prompt with context explaining that the AI is talking to this character, including their name, aliases, pronouns, description, and personality.

## Template Context During Assembly

The template context is built once and applied consistently:

```typescript
interface TemplateContext {
  char: string              // Character name
  user: string              // User/persona name
  description: string       // Character description
  personality: string       // Character personality
  scenario: string          // Current scenario
  persona: string           // User character description
  system: string            // System prompt
  mesExamples: string       // Example dialogues
  // Future support:
  wiBefore, wiAfter, loreBefore, loreAfter, anchorBefore, anchorAfter
}
```

This allows a single character definition to be reused across different models, providers, and user contexts with dynamic substitution.

## Sample Prompt Organization

System prompt templates are provided by `SYSTEM_PROMPT` plugins. The built-in prompts ship in `plugins/dist/qtap-plugin-default-system-prompts/prompts/` and follow the naming convention: `MODEL_CATEGORY.md`

- `CLAUDE_COMPANION.md` — Companion mode for Claude models
- `GPT-4O_ROMANTIC.md` — Romantic mode for GPT-4O
- `MISTRAL_LARGE_COMPANION.md` — Companion mode for Mistral Large

Each contains a structured prompt using the blocks above, with placeholders for character and user information. These serve as starting templates for character creation and are loaded by the system prompt registry at startup.

Third-party developers can create their own system prompt plugins with additional prompt collections. See the [System Prompt Plugin Development Guide](./SYSTEM_PROMPT_PLUGIN_DEVELOPMENT.md) for details.

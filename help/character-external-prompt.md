---
url: /aurora
---

# Non-Quilltap Prompt Generator

> **[Open this page in Quilltap](/aurora)** — then select a character and click **Non-Quilltap Prompt**

There comes a time in every character's life when they must venture beyond the comfortable confines of Quilltap and make their debut in the wider world — Claude Desktop, ChatGPT, or some other establishment that, while perfectly respectable, lacks the sophisticated character management to which they've grown accustomed. The Non-Quilltap Prompt Generator is their letter of introduction: a single, self-contained system prompt that captures everything an external tool needs to portray your character faithfully.

## How It Works

The generator takes your character's carefully curated fields — description, personality, system prompt, and optionally a scenario, physical appearance, and attire — and hands them to an LLM of your choosing with instructions to synthesize everything into a single second-person Markdown prompt. The result is a document written in the style of "You are [Name]. You always..." that can be pasted directly into any tool that accepts a system prompt or custom instructions.

## Accessing the Generator

1. Navigate to the **Aurora** page (`/aurora`)
2. Select the character whose external debut you wish to arrange
3. In the character header, click the **Non-Quilltap Prompt** button (the document icon, located near "Convert to NPC")
4. A configuration dialog opens

## Configuration Options

### LLM Connection Profile (Required)

Select which AI model should compose the prompt. This model will read your character's data and write the synthesized output. A more capable model generally produces a more nuanced and well-organized result — this is a task where quality of prose matters.

### System Prompt (Required)

Choose which of the character's system prompts should inform the generation. If the character has multiple system prompts for different interaction styles, pick the one most appropriate for the external environment.

### Scenario (Optional)

If you'd like the generated prompt to include a particular setting or context, select one of the character's named scenarios. The scenario's environment and circumstances will be woven into the prompt so the character arrives at their new venue already situated in the proper scene.

### Physical Description (Optional)

Select a physical description record if you want the character to be aware of their own appearance in the external environment. The generator uses the most detailed version available.

### Clothing / Attire (Optional)

Select a clothing record to include the character's current attire in the prompt.

### Maximum Output Size

A slider controls the target length of the generated prompt, from 1,000 to 20,000 tokens (roughly 4,000 to 80,000 characters). Larger budgets allow for more detailed and nuanced prompts; smaller budgets produce tighter, more focused instructions.

The default of 4,000 tokens is generally sufficient for most characters. Characters with complex personalities, elaborate speech patterns, or detailed worldbuilding context may benefit from 8,000–12,000 tokens.

## The Result

Once generation completes, you'll see the rendered Markdown output in a preview dialog. From here you can:

- **Copy to Clipboard** — paste directly into Claude Desktop, ChatGPT Custom Instructions, or any other tool
- **Download as .md** — save the prompt as a Markdown file for your records or for sharing

## Tips

- **Choose your model wisely.** The generator is a creative writing task as much as a summarization task. Models with strong writing abilities tend to produce more characterful results.
- **Start with a moderate token budget.** You can always regenerate with more tokens if the result feels thin, or fewer if it's verbose.
- **Review and edit.** The generated prompt is a starting point. You know your character better than any model — don't hesitate to adjust the output before deploying it.
- **Include a scenario for context.** Characters dropped into an external tool without any situational context can feel adrift. A scenario gives them an anchor.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/aurora")`

## Related Topics

- [Character System Prompts](character-system-prompts.md) — managing multiple system prompts per character
- [Character Import & Export](character-import-export.md) — other ways to move characters between systems
- [Refine from Memories](character-optimizer.md) — improving character data before generating an external prompt

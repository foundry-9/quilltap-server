---
url: /salon/:id
---

# Agent Mode

Agent Mode is a powerful feature that allows the AI to work iteratively on complex tasks, using tools multiple times to gather information, verify results, and refine its answer before delivering a final response.

## Overview

When Agent Mode is enabled, the AI can:

- **Use tools iteratively** - Make multiple tool calls to gather comprehensive information
- **Verify results** - Check and validate findings before responding
- **Self-correct** - Fix mistakes and improve answers based on intermediate results
- **Work autonomously** - Handle multi-step tasks without constant user input

The AI signals completion by calling the `submit_final_response` tool when it's confident in its answer.

## How It Works

1. **User sends a message** - The agent mode iteration counter resets to zero
2. **AI works iteratively** - Uses available tools to gather information (each tool use = 1 turn)
3. **Turns are tracked** - The system tracks how many iterations have occurred
4. **Final response** - When ready, the AI calls `submit_final_response` with its complete answer
5. **Max turns safety** - If the turn limit is reached, the AI is prompted to submit its best answer

## Settings Cascade

Agent mode settings follow a cascade from global to specific:

```
Global Chat Settings (default for all chats)
    ↓
Character Setting (null = inherit from global)
    ↓
Project Setting (null = inherit from character or global)
    ↓
Chat Setting (null = inherit, can be toggled per-chat)
```

Each level can override the previous if explicitly set.

## Configuration

### Global Settings (The Salon)

- **Enable Agent Mode by Default**: When enabled, new chats will use agent mode
- **Maximum Agent Turns**: The maximum number of tool iterations (1-25, default: 10)

### Per-Chat Toggle

Use the **Agent** button in the tool palette to toggle agent mode for the current chat.

### Character Defaults

Characters can have their own default agent mode setting that overrides the global default. Configure this in the character's **Profiles** tab under **Agent Mode**:
- **Inherit from global settings**: Use the global chat settings default
- **Enabled by default**: Agent mode is on for new chats with this character
- **Disabled by default**: Agent mode is off for new chats with this character

### Project Defaults

Projects can also override the agent mode default for all chats within that project.

## The submit_final_response Tool

This special tool signals that the AI has completed multi-step agentic work for the current turn:

- **response** (required): The final, polished answer to deliver to the user
- **summary** (optional): Brief description of what was accomplished
- **confidence** (optional): 0-1 confidence level in the response

### When It Fires — And When It Shouldn't

`submit_final_response` is scoped to the *current* turn. The agent should only reach for it after doing genuine agentic work this turn that warrants a structured summary. Conversational, relational, or simple follow-up messages get ordinary in-character prose replies — even with agent mode on, and even when other tools like memory search are used along the way.

If the model calls `submit_final_response` on its very first iteration with no other tool calls and no prose content — a strong signal it's trying to re-wrap work from a previous, already-concluded turn rather than responding to the current message — the orchestrator rejects that call, tells the model to respond conversationally instead, and re-prompts. This keeps relational replies feeling relational.

## Turn Limit Behavior

When the maximum turn limit is reached:

1. A system message prompts the AI to submit its final response immediately
2. One additional LLM call is made with this prompt
3. The AI should call `submit_final_response` with its best answer

This prevents runaway iterations while ensuring the user gets a response.

## Best Practices

### When to Enable Agent Mode

- **Complex research tasks** - Gathering information from multiple sources
- **Multi-step operations** - Tasks requiring several tool calls
- **Verification workflows** - When accuracy matters and results should be checked

### When to Disable Agent Mode

- **Simple conversations** - Casual chat doesn't need multiple iterations
- **Quick lookups** - Single tool calls for simple information
- **Cost-sensitive scenarios** - Each iteration uses tokens

### Configuring Turn Limits

- **5 turns**: Quick tasks, cost-conscious
- **10 turns** (default): Balanced for most use cases
- **15-20 turns**: Complex research or multi-step operations
- **25 turns**: Maximum for very complex tasks

## Status Events

During agent mode, you may see status messages like:

- **"Turn N: Used tool1, tool2"** - Summary of what happened in each turn
- **"Requesting final response..."** - Turn limit reached, forcing completion
- **"Agent completed task"** - AI successfully submitted final response

## Troubleshooting

### Agent doesn't complete

If the agent seems stuck in a loop:
- Check if tools are returning useful results
- Try reducing the max turns to force earlier completion
- Review the chat to see what the AI is attempting

### High token usage

Agent mode naturally uses more tokens due to multiple LLM calls:
- Lower the max turns for simpler tasks
- Disable agent mode for straightforward conversations
- Use cheaper models for agent mode if available

### Agent submits too early

If the agent isn't using enough iterations:
- Check the task complexity - it may not need many iterations
- Review system prompts to ensure iterative behavior is encouraged
- Increase max turns if needed for complex tasks

## In-Chat Settings Access

Characters with help tools enabled can read your current agent mode configuration during a conversation using the `help_settings` tool with `category: "chat"`. The chat category includes your agent mode settings (enabled status and maximum turns) alongside other chat preferences. Ask a help-tools-enabled character something like "What are my agent mode settings?" and it will check for you.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Topics

- [Tools](tools.md) - Learn about the tools available to AI agents
- [Chat Settings](chat-settings.md) - Configure global chat behavior
- [Projects](projects.md) - Organize work with project-specific settings

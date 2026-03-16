---
url: /salon/:id
---

# Chat State

Chat State provides persistent JSON storage for games, inventory tracking, session data, and any other information that should persist across messages in a conversation.

## What is Chat State?

State is a JSON object that stores key-value pairs. Unlike regular messages which flow through the conversation, state persists and can be updated by both you and the AI character. This makes it perfect for:

- **Games**: Track scores, turns, game boards, and player status
- **Inventory Systems**: Manage items, equipment, and resources
- **Character Stats**: Track health, experience, attributes, and skills
- **Session Data**: Remember preferences, settings, and context
- **Writing Projects**: Store outlines, character sheets, and world details

## How to View and Edit State

### In Chats

1. Open any chat conversation
2. Click the hamburger menu (three lines) in the composer toolbar
3. Click the **State** button (database icon)
4. The State Editor modal opens showing the current state

### In Projects

1. Open a project from the Projects page
2. Expand the **Project Settings** card
3. Click **View/Edit** next to "Project State"

## State Editor Features

- **View Mode**: By default, state is shown read-only with syntax highlighting
- **Edit Mode**: Click the **Edit** button to modify the JSON
- **Validation**: Invalid JSON is highlighted with an error message
- **Save**: Click **Save** to persist your changes
- **Reset**: Use **Reset State** to clear all state data (with confirmation)

## How AI Uses State

When the state tool is enabled, AI characters can:

### Fetch State
Read current values to understand context:
```
AI fetches "player.health" → 85
AI: "You're looking a bit weary. Want to rest and recover some health?"
```

### Set State
Update values based on actions:
```
User: "I pick up the golden key"
AI sets "inventory.goldenKey" → true
AI: "You carefully pocket the golden key. It might come in handy later."
```

### Delete State
Remove values when they're no longer relevant:
```
User: "I use the healing potion"
AI deletes "inventory.healingPotion"
AI sets "player.health" → 100
AI: "The potion's warmth spreads through you as your wounds close."
```

## State Inheritance (Projects)

When a chat belongs to a project:

1. **Project State**: Shared across all chats in the project
2. **Chat State**: Specific to individual conversations
3. **Merged View**: When fetching, chat values override project values at the top level

This allows you to:
- Set global values (like world settings) at the project level
- Override specific values per-chat when needed
- Share common data across related conversations

## The Underscore Convention

Keys starting with underscore (`_`) are treated as user-only:

- `_notes`: Your private notes the AI won't modify
- `_settings`: Personal preferences
- `_metadata`: Information you want to preserve

The AI will not modify or delete underscore-prefixed keys, even if asked.

## Examples

### Yahtzee Game
```json
{
  "currentPlayer": "Alice",
  "round": 3,
  "scores": {
    "Alice": 145,
    "Bob": 132
  },
  "dice": [3, 3, 3, 5, 6],
  "rollsRemaining": 2
}
```

### RPG Inventory
```json
{
  "player": {
    "name": "Elara",
    "health": 85,
    "maxHealth": 100,
    "gold": 250
  },
  "inventory": [
    { "name": "Iron Sword", "damage": 15 },
    { "name": "Health Potion", "healing": 25 },
    { "name": "Mysterious Map", "description": "Shows the way to..." }
  ],
  "quests": {
    "findTheLostAmulet": { "status": "active", "progress": 2 }
  }
}
```

### Writing Session
```json
{
  "currentChapter": 3,
  "wordCount": 12450,
  "characters": ["Maya", "The Professor", "Agent X"],
  "plotPoints": {
    "introduced": ["the artifact", "the conspiracy"],
    "resolved": ["Maya's backstory"]
  },
  "_notes": "Remember to add more tension in chapter 4"
}
```

## Tips

1. **Start Simple**: Begin with basic key-value pairs, add complexity as needed
2. **Use Clear Names**: `player.health` is better than `ph`
3. **Group Related Data**: Use nested objects to organize related values
4. **Let AI Lead**: For games, let the AI manage state updates naturally
5. **Use Projects**: For multi-chat games or stories, use project state for shared data
6. **Protect Important Data**: Prefix critical keys with underscore if you don't want them changed

## Path Syntax

The state tool supports dot notation and array indexing:

- `player.health` - Access nested property
- `inventory[0]` - Access first array item
- `inventory[0].name` - Access property of array item
- `scores.Alice` - Access property with string key

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Features

- [Tool Palette](/help/tool-palette) - Access the State button and other tools
- [Projects](/help/projects) - Organize related chats with shared state
- [LLM Tools](/help/llm-tools) - Other AI capabilities available in chats

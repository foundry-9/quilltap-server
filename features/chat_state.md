# Chat State

**Status:** Specification (v1)  
**Purpose:** A persistent JSON object attached to chats and projects for tracking games, inventories, session data, and any structured information that should survive across messages.

---

## Overview

Every chat and every project has a `state` property—a JSON object that characters (LLMs) and users can read and write during a conversation. This enables interactive games, inventory tracking, writing session metrics, and any other use case requiring persistent structured data.

- If `state` is undefined or null, the system initializes it to `{}` automatically.
- State is freeform JSON: keys can be any string, values can be scalars, objects, or arrays.

---

## Inheritance Model

When a chat exists within a project, both the chat and the project may have state.

- **On read:** Chat state overrides project state. If a key exists in chat state, that value is returned. If not, the system checks project state. If neither has the key, `null` is returned.
- **On write:** Writes target the specified context only. No implicit merging.
- **On delete:** Removing a chat-level key reveals the project-level key beneath on subsequent reads.
- **No automatic forking:** Users may explicitly initialize chat state from project state via a UI action, but this does not happen automatically on chat creation.

---

## Access Control

- LLMs have full read/write access to state via tools.
- **Soft convention:** Keys prefixed with `_` (e.g., `_rules`, `_template`) are intended for user-only editing. Not enforced in v1, but documented as a best practice for protecting structural keys from accidental LLM modification.
- Writes are atomic and explicit—the LLM must specify exact paths. No bulk "replace entire state" operation via tools; that action is available only in the UI editor.

---

## Persistence & Lifecycle

| Event | Behavior |
| ------- | ---------- |
| Tool call (`set`, `delete`) | State saves immediately on success. |
| Chat export | State is included as an embedded JSON field. |
| Chat import | State is restored intact. (Project state from the original project is not included.) |
| Chat deletion | State is deleted with the chat. No orphans. |
| Project deletion | Project state is deleted. Child chats and their states are also deleted. |

### Reset

A "Reset" action (clearing state to `{}`) is available in the state editor UI. It does not appear on the main chat interface—state management is consolidated in its own panel.

---

## Tools

The system provides a `state` tool with three operations. All operations accept an optional `context` parameter: `"chat"` (default) or `"project"`.

### `fetch`

Retrieves state data.

| Parameter | Behavior |
| ----------- | ---------- |
| *(none)* | Returns the complete state object for the specified context. |
| `path` | Returns the value at that path, or `null` if the path does not exist. |

- Paths support dot notation and array indexes: `"player.inventory[0]"`.
- Malformed paths return an error (not `null`), so the LLM can distinguish "absent" from "invalid."

### `set`

Writes a value to state.

| Parameter | Behavior |
| ----------- | ---------- |
| `path` | The property path to write (e.g., `"score"`, `"player.health"`, `"inventory[2]"`). |
| `value` | The value to assign (any valid JSON type). |

- Creates intermediate objects and arrays as needed. Setting `"player.inventory[0]"` on an empty state produces `{ "player": { "inventory": ["sword"] } }`.
- **No array operations in v1.** To append to an array, the LLM fetches the array, modifies it, and sets the whole array back.
- Invalid writes (malformed JSON, malformed path) return an error and do not persist.

### `delete`

Removes a value from state.

| Parameter | Behavior |
| ----------- | ---------- |
| `path` | The property path to remove. |

- Removes only the leaf at the specified path. Does not prune empty parent objects or arrays.
- Idempotent: deleting a path that does not exist returns success.

---

## Validation

- **V1:** Freeform JSON. No schema enforcement.
- Both the UI editor and the tools reject malformed JSON. Invalid writes never persist.
- **Future consideration (v2+):** Optional JSON Schema validation via a `_schema` key in project state. Writes would be validated against the schema; invalid writes would fail with a descriptive error.

---

## User Interface

### Chat Tool Palette

- A small icon (e.g., `{ }` or a data symbol) opens the state editor.
- Tooltip: "Chat State" or "Session Data."

### Project Settings

- Equivalent icon/button in an "Advanced" or "Data" section of project configuration.
- Label: "Project State."

### State Editor

- Syntax-highlighted JSON editor (Monaco, CodeMirror, or equivalent).
- **Read-only by default.** An "Edit" toggle enables modification.
- Validates on save: malformed JSON cannot be written.
- "Reset" button clears state to `{}` with a confirmation prompt.

### Optional: Write Indicator

- When an LLM writes to state, a subtle toast or inline note ("State updated") may appear in the chat.
- Toggleable in settings, off by default.

---

## Examples

### Yahtzee Scorecard

```json
{
  "turn": "Charlie",
  "round": 3,
  "scores": {
    "Charlie": {
      "ones": 3,
      "twos": 8,
      "threes": null,
      "fours": 0,
      "fives": 20,
      "sixes": 18,
      "threeOfAKind": null,
      "fourOfAKind": null,
      "fullHouse": null,
      "smallStraight": null,
      "largeStraight": null,
      "yahtzee": null,
      "chance": null
    }
  }
}
```

### Simple Inventory

```json
{
  "inventory": ["longsword", "health potion", "torch", "50 gold"]
}
```

### Writing Session Tracker

```json
{
  "sessionGoal": 1500,
  "currentCount": 873,
  "streak": 4,
  "lastUpdated": "2026-02-02"
}
```

### Turn-Based Game Scaffold

```json
{
  "players": ["Alice", "Bob"],
  "currentTurn": "Alice",
  "turnNumber": 7,
  "gameOver": false
}
```

---

## Documentation Plan

- Dedicated docs page: "Chat State: Tracking Games, Inventories, and Session Data."
- Sections: purpose, tool reference, inheritance model, UI guide, prompt integration tips.
- 3–5 importable example templates with accompanying system prompts demonstrating how to instruct the AI to use state.
- Plain-language explanations for non-technical users: "Here's how to play Yahtzee with your AI."

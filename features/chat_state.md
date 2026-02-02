# Chat State

Every chat and every project should have a JSON object that contains state information that can be accessed by characters (LLMs) or the user. It is part of the essential metadata of a chat and a project. It can be undefined or null, but when it is, it should be automatically set to `{}` first. This way we don't need a migration to start using it in every chat, except to add it to the chat and project tables at all.

## Initial state

I think the initial state should simply be a blank object, no properties: `{}`.

## Any valid JSON is possible in the chat state

Properties of this state can have keys that are any string, and values that are scalars, objects, or arrays of scalars or objects. Anything is nullable.

## Examples

### Yahtzee Game

```json
{
    "scorecardTemplate": {
        "chance": null,
        "top": {
            "1s": 3,
            "2s": 8,
            "3s": null,
            "4s": 0,
            "5s": 20,
            "6s": 18
        },
        "bottom": {
            "fullHouse": null,
            "smallStraight": null,
            "largeStraight": null,
            "threeOfAKind": null,
            "fourOfAKind": null,
            "yahtzee": null,
            "chance": null
        }
    },
    "turn": "Charlie"
}
```

### Strip Poker

```json
{
    "Charlie": {
        "stillWearing": ["boxers", "sock"],
        "removed": ["sock", "shirt", "pants", "shoe", "shoe"]
    }
}
```

## Tools

The system will include a "state" tool to manipulate the chat state.

All calls have an optional parameter of "context" which is either "chat" (the default) or "project".

- `fetch`
  - no parameters: get complete state
  - parameter: get state's property of "parameter" and return it
    - note that this can handle arrays and indexes, so you could fetch "Charlie.stillWearing[0]" from the "strip poker" example above and the response would be "boxers"
- `set`
  - parameter: property key (qualified, so setting "Charlie" to 0 would do that, but setting "Charlie.money" to 0 would upsert Charlie's property "money" to be 0)
- `delete`
  - parameter: property key to delete completely from the chat

## Project state

If you are in a chat in a project, then the chat has a state, and the project has a state. The context determines which one you are accessing with a tool.

## User Interface

The chat tool palette should include a button to open up a JSON editor that lets you view or edit the chat state. The project settings should also include a button that does the same thing for a project.

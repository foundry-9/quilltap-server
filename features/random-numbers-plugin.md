# Feature request: Random Numbers or Choices plugin

A plugin to produce any of the following as a tool:

1. A random number in the traditional sense, that is any decimal between 0 and 1
2. A random integer between `x` and `y`
3. Special cases of #2
   - Roll a dice with `n` sides - d6 could be an integer between 1 and 6 inclusive
   - "Flip a coin" is an integer between 0 and 1 inclusive
4. Random character - of the characters in the chat, choose one
5. "Spin the bottle" - of the particpants in the chat, choose one

## Necessary infrastructure for any plugin

This will produce a need for plugin access to things:

1. The ability to be called via a tool
2. The ability to respond as tools do, and its response showed to the user and sent to the LLM
3. A list of characters currently in the chat, with some metadata about them (username at least)
4. A list of particpants currently in the chat (characters + the persona of the user)

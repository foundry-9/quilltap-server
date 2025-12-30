# Feature request: convert personas into characters

Personas have some of the characteristics/attributes of characters. Let's combine them. Then a user can become any character at the start of a chat.

## Things that need to be done

- An auto-migration when this is fired up for the first time for each user, to take their personas and turn them into characters
- The new character ID can be the persona ID, if that won't break something else
- Starting up a chat, a user can automatically be any character they choose
- A character's avatar should be followed, under the name and title, with a set of buttons
    - The first button is "Impersonate" or whatever term is appropriate for inhabiting that character for that message
    - If the characters are in a multi-character chat, then each of the characters on the sidebar for that should also have a button for "Impersonate" or whatever it is
    - When impersonation takes place, it continues to be that user acting as that character - typing messages into the chat input area at the bottom, and so forth - until they turn off impersonation
    - When impersonation is turned off then that character is voiced by the LLM profile as they were before
    - Yes, this means that a user could be conversing with themselves
- Memories should still be formed when this happens, as if it were not the user doing it
- In fact, all future memories should be keyed to, not the character and the user, but the character **and the character they are interacting with then**
- It is OK to leave the old character memories that are tied to a "User"
- When importing a SillyTavern chat, if it happens to say anything about personas (I don't remember if that's part of their data export), think of those as characters instead
- A default connection profile for any character can be "User Acts As Character", and that should be the default for the personas that are converted to characters
    - If that virtual profile is the connection profile for a character, then they are operated by the user
    - Again, the user can actually let go of the character he starts with, so to speak, and let an LLM take it over
    - It will be possible for chats to be all LLMs talking to each other; we should put an automatic pause in after, maybe, three turns for every character, just to prompt the user as to whether they want this to continue, pausing the chat turn manager for a moment while we hear if they want to continue. Then ask them again at logarithmic intervals if they just keep it going - I don't want this to run for somebody all night, and use up all their API tokens or whatever
- It is now considered a "multi-character chat" if no characters in the chat *are* controlled by the LLM (so two user-controleld + 0 LLM-controlled counts), as well as more than one LLM-controlled character. We will need the turn controls and the ability to turn off "impersonate."
- If we turn off "impersonate" on a character whose default profile is "User Acts As Character", then we need to ask in a dialog box which LLM profile to use for them.

Ask if there are any ambiguities left before finishing the plan or making changes.

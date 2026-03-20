# Help Chats

This is a kind of LLM chat that exists throughout the app, not just in the Salon space, because it is a chat about the app and how it works and what it does. This is the chat that helps you solve your problems or find features.

## Requirements to use feature

- You have to have at least one character marked as having access to the help tools in their associated profiles. Ideally they'd be agent-mode capable (for our purposes that means that they get so many turns to interact with tools and then respond to the results before deciding that they have the best answer).
- You have to have one LLM that is capable of running tools (or pseudo-tools) set up as a connection profile.
- **Image Capability**: Ideally the LLM would also be image capable; if it isn't then you should have a cheap LLM defined that can read images and tell what is in them. (This last one isn't a deal breaker to whether it works or not, but it would be good to suggest this.)

## Expectations

- There needs to be, on every screen in the standard interface, a way to call up the help chat. I am thinking that it lives on the sidebar, maybe, at the bottom, just above the profile menu and below the others that could be there (settings, themes, quick-hide). If you do not meet the requirements above, then it should be disabled but visible, and a tooltip should tell you what you need to fix before this will work.
- When you hit the help button, it should bring up three things in two boxes:
  1. First box:
     1. A choice of characters who can be part of the chat. This is a list of characters, by avatar, who meet the requirements above. This is a checkbox, not a radio button. By default, if you have Lorian and Riya and they are both help-tool-enabled, it should be both of them. If there is only one character, then this should display but be disabled from changes; you can only use that character.
     2. A textarea where you can type a question.
  2. Second box: A list of past chats which you could resume. This list should include the chat you want to resume and the names and avatars of the characters you would interact with if you resumed. If your old help chat had a character but now that is not an eligible character, then put an indicator that that character will not be available again (and a tooltip explaining why; maybe you deleted them, maybe they don't have access to tools any more).
- When you select (or have preselected) one or more characters and have typed a question, this should start a new help chat.
- If you select a past help chat, then it should be used instead of a new help chat.
- A sort of dialog box should appear on the screen, but it should be resizable and movable. The system should remember the size and position of this dialog box for future help chats.
- Inside this dialog box is the help chat.

## The Help Chat

- This is a subset of things that an ordinary Salon chat can do. You can upload files (and paste images, but only if you fulfill the "Image Capability" requirement above), rename the chat (or let the LLM retitle it), export the chat as a SillyTavern chat, and type in responses and send them. Markdown is permitted but not required. We don't need anything else from the typical Salon interface.
- Use what shared functionality you can (or make it sharable, break it out for re-use) with the Salon chat system, but the basics of these chats are far simpler than ordinary chats.
- The turn manager can be completely hidden functionality, no participants sidebar, no whispers, no tool use by the user at all. No story backgrounds, no Concierge efforts - no automatic re-routing. There should still be LLM logs (we always do that). Re-titling and summarization still happen on the schedule they happen with ordinary chats.
- The help chat is meant to not be full screen; that way you can move it, resize it, and see what's being seen and done in the background.
- When the help chat starts up, the context (the page you're on) should be found in the help file (or its archetype, so to speak), and that should be preloaded as information to the LLMs.
- The LLM system prompts need the character's memories (and the contextual preload that we do in ordinary chats), and the information from the built-in help files about the page they're on, and the information necessary for them to run the help tools, as well as the usual character stuff (who they are, reinforcement not to speak as another character, pronouns, the things we do in normal chat).
- If you navigate to another page with the help chat open, then the last help chat - we assume it's the one you were just in - should be reopened after navigation, and the system prompt should be updated and sent to all characters (their LLMs) with the new location that just opened. That way they stay in context.
- If the help indicates that somebody should go to another page to do something, and the LLM wants to suggest that they go there, they should be able to put a link into the chat that will navigate directly to where they need to go. That should be something we can derive as a URL (or relative URL) from the help files, due to recent changes we made to provide that information.

You see what I'm doing here, building a contextual help system that is LLM-driven and aided. If you see anything in here that could be tweaked to be better, or needs clarification, please ask.

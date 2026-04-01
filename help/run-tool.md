# Run Tool

## The Gadgeteer's Workbench

Much as a gentleman inventor might wish to test each spring and gear of a newly acquired apparatus before entrusting it to the automaton, Quilltap's **Run Tool** feature permits you — the human operator, the master of ceremonies, the one who actually pays the electricity bill — to invoke any available tool directly, without requiring the AI to do it on your behalf.

## Accessing the Run Tool

1. Open any chat in **The Salon**
2. Click the **tool palette** button (the hamburger menu in the composer area)
3. Select **Run Tool** from the CHAT section

## How It Works

The Run Tool modal operates in two phases, rather like a dance card at a particularly well-organized ball:

### Phase 1: Selecting Your Instrument

Upon opening, you are presented with every tool currently available in this chat, organized by category. Each tool displays its name and a brief description of its capabilities.

- **Available tools** can be clicked to proceed
- **Unavailable tools** appear dimmed, with a note explaining why they cannot be used (for instance, image generation requires an image profile to be configured)
- Use the **search bar** to filter tools by name or description

### Phase 2: Filling in the Parameters

Once you have selected a tool, a form appears with the tool's parameters:

- **Required parameters** are marked with an asterisk and must be filled in before the tool can run
- **Optional parameters** can be included by checking the checkbox next to their name
- Each parameter includes a description explaining what it expects
- A collapsible **arguments preview** at the bottom shows the exact JSON that will be sent

Click **Run Tool** when you are satisfied with your parameters. The tool executes, and its result appears in the chat as a tool message — visible to both you and the AI on subsequent turns.

## What Can You Run?

Any tool that the AI could use is available to you here, including:

- **Search Memories** — Query the Commonplace Book directly
- **Random Number Generator** — Roll dice, flip coins, or spin the bottle
- **Search Web** — Look something up on the internet
- **Project Info** — Retrieve project details and file contents
- **Manage Files** — Read or list files
- **Search Help** — Search Quilltap's own documentation
- **State Manager** — View or modify chat state variables
- **Plugin tools** — Any tools provided by installed plugins

The only tools excluded are internal-only mechanisms that would be of no use to a human operator (such as the context expansion valve and the agent-mode response finalizer).

## A Note on Results

Tool results created through Run Tool are marked as **user-initiated** and appear in the chat history just as they would if the AI had used the tool. This means:

- The AI can see and reference the results on its next turn
- Results persist in the chat history
- Image generation results include any generated images as attachments

This is particularly useful when you wish to provide the AI with specific information — a memory search result, a file's contents, or a fresh set of dice rolls — without having to ask it to fetch the information itself.

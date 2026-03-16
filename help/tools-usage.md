---
url: /salon/:id
---

# Using Tools in Chat

> **[Open this page in Quilltap](/salon)**

This guide explains how to work effectively with AI tools during your conversations in Quilltap.

## Understanding Tool Use

**The AI uses tools automatically** - You don't explicitly call tools. Instead, the AI decides whether to use tools based on your message and the conversation context.

**Example interactions:**

**Scenario 1: Asking for Image Generation**

- You: "Generate an image of a fantasy warrior"
- AI: Recognizes this as an image request and uses the Generate Image tool
- Result: Image is generated and displayed in the chat

**Scenario 2: Asking for Memory Search**

- You: "What did we talk about last week?"
- AI: Uses Search Memories tool to find relevant past conversations
- Result: Relevant memories are retrieved and used in the response

**Scenario 3: Getting Web Information**

- You: "What's the current weather? What's happening in tech news?"
- AI: Uses Search Web tool to find current information
- Result: Recent information is included in the response

## What Happens When Tools Are Used

When the AI uses a tool:

1. **AI decides to call a tool** based on your message
2. **Tool executes** with appropriate parameters
3. **Results are returned** to the AI
4. **AI processes the results**
5. **AI includes results** in its response to you
6. **You see the final response** - usually with the tool results integrated

**In the chat interface, you might see:**

- The tool being called (sometimes shown in system messages)
- Generated images appearing inline
- Search results being summarized
- File contents being referenced
- Project information being cited

## Enabling the Right Tools

**Before a chat session:**

1. **Think about what you need** - What will this conversation require?
   - Image generation? Enable "Generate Image" tool
   - Referencing past conversations? Enable "Search Memories"
   - Current information? Enable "Search Web"
   - Project files? Enable "Project Info" and "Manage Files"

2. **Open Tool Settings** (see [Configuring Chat Tools](tools-settings.md))

3. **Enable the tools you need**

4. **Disable unnecessary tools** for faster responses

## Getting Good Tool Results

### For Image Generation

**Enable these first:**

- Generate Image tool must be enabled
- Character must have an image generation profile configured

**Best practices:**

- Be descriptive in your requests
- Give style references ("anime style", "oil painting", "photorealistic")
- Include composition details ("wide landscape", "close-up portrait", "side view")
- Specify mood/atmosphere ("dramatic", "cozy", "ethereal")

**Example requests:**

- "Generate an image of a cozy library at night with warm lighting"
- "Create a character design of a cyberpunk hacker, cyberpunk style, neon colors"
- "Make an image of a fantasy tavern interior, dramatic lighting, detailed"

### For Memory Search

**Enable these first:**

- Search Memories tool must be enabled
- Chat must have conversation history to search

**Best practices:**

- Reference what you want to find ("conversation about X", "when we discussed Y")
- Use keywords from the topic you're looking for
- Be specific about timeframes ("earlier today", "last week", "in our first messages")

**Example requests:**

- "What did I tell you about my character's backstory?"
- "Can you remind me of the details from our first conversation?"
- "Search for what we discussed about the plot of this story"

### For Web Search

**Enable these first:**

- Search Web tool must be enabled
- Connection profile must allow web search
- A search provider API key must be configured in Settings > API Keys (e.g., Serper)

**Best practices:**

- Ask for current information ("latest", "today", "recent", "2024")
- Search for facts you need verification on
- Ask about current events or breaking news
- Ask about recent developments in your field

**Example requests:**

- "What are the latest advances in AI language models?"
- "Search the web for current JavaScript best practices"
- "What's happening with [company] stock today?"

### For Project Information

**Enable these first:**

- Project Info tool must be enabled
- Chat must be associated with a project
- File Management tool for reading files

**Best practices:**

- Reference project context when asking questions
- Ask for specific file contents or information
- Use the AI to analyze and summarize project files

**Example requests:**

- "Tell me about the project structure from the files"
- "What's in the requirements document?"
- "Can you analyze this code file and suggest improvements?"

## Managing Tool Results

**When the AI uses tools:**

- Tool results are processed by the AI
- The AI integrates results into its response
- You see the final answer, not raw tool outputs

**If tool results aren't helpful:**

- Rephrase your request more specifically
- Provide more context
- Try disabling and re-enabling the tool
- Ask the AI to try a different approach

## Dealing with Tool Limitations

**A tool doesn't seem to work:**

1. Check if the tool is enabled in Tool Settings
2. Check if the tool is available (not grayed out)
3. If unavailable, read the reason and configure the requirement
4. Try a different request that might work better with the tool
5. Consider disabling the tool if it's not helpful for your workflow

**A tool is interfering with responses:**

- Disable the tool in Tool Settings
- The AI will adjust its approach
- You can re-enable it later if you change your mind

**Tool is too slow:**

- Disable the tool to get faster responses
- Or disable other tools you don't need
- Fewer enabled tools = fewer opportunities for tool calls = faster responses

## Advanced Tool Usage

**Combining Tools:**
The AI often uses multiple tools in a single response:

- Generate an image AND search memories for context
- Look up web information AND access project files
- Search memories AND provide additional analysis

**Tool Chains:**
Some responses involve a sequence of tool calls:

1. AI searches memories
2. AI uses results to refine a web search
3. AI generates an image based on results
4. Final response synthesizes all results

**Tool Optimization:**

- The AI learns which tools are most helpful for your requests
- Over time, it uses tools more intelligently
- Let it experiment with different tool combinations

### For Settings Help

**Enable these first:**

- Help tools must be enabled on the character (in the character's Profiles tab)

**Best practices:**

- Ask about specific setting categories for focused results
- The tool accepts categories: overview, chat, connections, embeddings, images, appearance, templates, system
- API keys and credentials are never disclosed

**Example requests:**

- "What connection profiles do I have configured?"
- "Show me my chat settings"
- "What are my current appearance settings?"
- "Give me an overview of my settings"

## Pro Tips

**For Research Tasks:**

- Enable Search Web for current information
- Enable Search Memories for context from your conversations
- Enable Project Info for project-specific research

**For Creative Work:**

- Enable Generate Image for visual inspiration
- Enable Search Web for reference material
- Enable Project Info to reference project documents

**For Task Management:**

- Enable Project Info and Manage Files for tracking
- Enable Search Memories to recall previous plans
- Disable unnecessary tools to focus on output speed

**For Learning:**

- Enable Search Web for explanations and examples
- Enable Project Info to learn from your project context
- Keep Search Memories on to reference past learnings

## Related Topics

- [Tools Overview](tools.md) - What tools are and how they work
- [Configuring Chat Tools](tools-settings.md) - How to enable/disable tools
- [Chat Settings](settings.md) - Other chat configuration options
- [Connection Profiles](settings.md) - Setting up profiles for tools

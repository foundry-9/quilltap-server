# Connection Profiles

> **[Open this page in Quilltap](/foundry/forge)**

Connection Profiles are where you configure your AI language models (LLMs) for use in Quilltap chats. A connection profile links together an API key, a provider, and a specific model, allowing Quilltap to communicate with the AI service.

## Understanding Connection Profiles

A connection profile tells Quilltap:

- **Which provider** to connect to (OpenAI, Anthropic, etc.)
- **Which API key** to use for authentication
- **Which model** to use (GPT-4, Claude 3, etc.)
- **Any special settings** (temperature, max tokens, custom URLs)

You can create multiple profiles for different purposes, such as:

- A profile for fast, cheap responses
- A profile for high-quality, detailed responses
- A profile for specialized tasks (coding, creative writing)
- Different profiles for different API accounts

## Accessing Connection Profiles

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **Connection Profiles** tab
3. You'll see existing profiles (if any) and options to create new ones

## Viewing Connection Profiles

The profiles list shows:

- **Profile Name** — The name you gave the profile
- **Provider** — Which AI service (OpenAI, Anthropic, etc.)
- **Model** — Which model is selected (GPT-4o, Claude 3.5 Sonnet, etc.)
- **Status** — Connection health (✓ Healthy, ⚠️ Degraded, ✗ Unhealthy)
- **Tags** — Custom tags for organization
- **Default Badge** — Marks if this is the default "cheap" profile
- **Actions** — Buttons to edit, test, or delete

## Creating a New Connection Profile

### Step 1: Prepare Your API Key

Before creating a connection profile, you need an API key:

1. Go to **The Forge** (`/foundry/forge`) and expand **API Keys**
2. Add your API key from the provider
3. Test the key to verify it works
4. Return to Connection Profiles tab

### Step 2: Create the Profile

1. Click **Add Connection Profile**
2. A form appears with these fields:

   **Basic Information:**
   - **Profile Name** — Give this configuration a name (e.g., "GPT-4 Production", "Claude Fast")
   - **Provider** — Select the AI provider (OpenAI, Anthropic, Google, etc.)

   **Connection Settings:**
   - **API Key** — Select from your stored API keys
   - **Model** — Select which model to use
   - **Base URL** — (Optional) For self-hosted or custom endpoints

   **Advanced Settings:**
   - **Temperature** — Control randomness (0 = deterministic, 1 = very creative)
   - **Max Tokens** — Maximum response length
   - **Top P** — Nucleus sampling (alternative to temperature)
   - **Provider-specific options** — May vary by provider

3. Click **Save** to create the profile

### Step 3: Test the Connection

Before using in chats, verify it works:

1. Find your new profile in the list
2. Click **Test Connection** button
3. Quilltap sends a test message to verify:
   - ✓ API key is valid
   - ✓ Model is accessible
   - ✓ Connection works end-to-end
4. You'll see the test result

## Editing a Connection Profile

To change an existing profile:

1. Find the profile in the list
2. Click **Edit** button (pencil icon)
3. Update any of these settings:
   - Profile name
   - API key (switch to a different one)
   - Model (select a different model)
   - Advanced settings (temperature, tokens, etc.)
   - Tags for organization
4. Click **Save Changes**

## Deleting a Connection Profile

To remove a profile:

1. Find the profile in the list
2. Click **Delete** button (trash icon)
3. A confirmation dialog appears (showing if it's in use)
4. Click **Confirm Delete** to remove it

**Warning:** If the profile is used in active chats, those chats will need a new profile assigned.

## Using Connection Profiles in Chats

### Setting a Default Profile

Your default profile is used automatically when you create new chats:

1. When creating a new chat, the default profile is pre-selected
2. You can change it for any chat individually
3. To change the system default:
   - Look for a profile marked with a "Default" badge
   - Click **Set as Default** to change which profile is default
   - Usually the cheapest/fastest profile is set as default

### Choosing a Profile for a Chat

1. When creating a new chat
2. Look for the **Connection Profile** dropdown
3. Select which profile to use for that chat
4. The selected profile is used for all messages in that chat

### Switching Profiles Mid-Chat

To change profiles in an existing chat:

1. Open the chat
2. Look for chat settings (usually in the top right)
3. Find the Connection Profile selector
4. Choose a different profile
5. This affects future messages but not previous ones

## Testing Profiles

### Test Connection

Tests that the basic connection works:

1. Click **Test Connection**
2. Quilltap verifies:
   - API key is valid
   - Model exists and is accessible
   - Provider responds
3. See if connection is healthy

**When to use:** After creating a new profile or changing settings

### Test Message

Sends a real test message to verify end-to-end functionality:

1. Click **Send Test Message**
2. Quilltap sends: "Respond with 'Profile test successful'" to verify
3. If the response comes back, the profile is fully functional

**When to use:** For thorough validation before using in important chats

## Fetch Available Models

If your provider has many models, you can see all available ones:

1. Select the provider from the dropdown
2. Enter your API key
3. Click **Fetch Models**
4. A list of models appears for that provider
5. Select which one to use

**Note:** This requires a valid API key for the provider.

## Advanced: Custom Base URLs

For self-hosted or alternative LLM providers (like local Ollama instances):

1. Select "Custom" or the relevant provider
2. Enter the **Base URL** where your LLM server is running
3. Example: `http://localhost:11434/api` for local Ollama
4. Complete other settings as needed
5. Test to verify connection works

> **Docker users:** If you're running Quilltap in Docker and local services (like Ollama) on your host machine, you don't need to change any URLs. Add the port to the `HOST_REDIRECT_PORTS` environment variable when starting the container (e.g., `HOST_REDIRECT_PORTS="11434"`), and `http://localhost:11434` works transparently inside the container.

## Provider-Specific Notes

### OpenAI (GPT-4, GPT-3.5, etc.)

- Models update frequently — use "Fetch Models" to see current options
- Temperature: 0-2 (default 1)
- Supports vision (image) context
- Token limits vary by model

### Anthropic (Claude)

- Multiple Claude versions available (3, 3.5, etc.)
- Excellent long-context support
- Temperature: 0-1
- Strong at reasoning and complex tasks

### Google (Gemini)

- Multiple model sizes (Flash, Pro)
- Good for vision tasks
- Competitive pricing
- Supports real-time APIs

### Local Providers (Ollama)

- Run models locally on your computer
- No API costs
- Set Base URL to your local server
- Good for privacy-sensitive work

### Groq

- Very fast inference
- Great for chat over slow connections
- Good cost/performance ratio
- Limited to their model selection

## Managing Multiple Profiles

### Use Cases

**Fast/Cheap Profile:**

- Use for basic tasks, brainstorming, drafts
- Set as default for everyday use
- Use cheaper, faster models

**Quality Profile:**

- Use for important work, analysis, complex reasoning
- More expensive, slower models
- Better for nuanced tasks

**Specialized Profile:**

- Code generation with specialized code models
- Creative writing with models tuned for prose
- Domain-specific models for technical work

### Organizing with Tags

Add tags to profiles for easy filtering:

1. Edit a profile
2. Add tags like: "production", "testing", "fast", "expensive"
3. Tags help you remember each profile's purpose

## Allow Tool Use

The **Allow tool use** checkbox on each connection profile acts as a master switch for all LLM tools. When unchecked, no tools whatsoever — built-in or plugin-provided — will be dispatched to the model when using that profile, regardless of what the per-chat or per-project tool settings say.

This is rather like flipping the main breaker in a fine manor house: it matters not how many individual lamps the servants have switched on if the master circuit has been thrown.

**When you might disable tool use:**

- **Model compatibility:** Some models, particularly smaller or local models, do not handle tool calls gracefully — they may hallucinate tool invocations or produce garbled output
- **Cost control:** Tool descriptions consume tokens; disabling them reduces prompt size
- **Simplicity:** When you simply want pure conversation without the AI reaching for instruments

**How it works:**

1. Edit (or create) a connection profile in The Forge
2. Uncheck **Allow tool use**
3. Save the profile

Profiles with tool use disabled display a **No Tools** badge on their profile card. When you open the Tool Settings dialog in a chat using such a profile, a notice appears explaining that tools are overridden at the profile level.

To re-enable tools, simply check the box again. Per-chat and per-project tool settings will resume their normal effect immediately.

## Connection Profile Limitations

### What affects availability

- **Missing API Key:** If the key is deleted, profile can't be used
- **Account quota exceeded:** If your provider account is out of credits, connections fail
- **Rate limits:** Some providers throttle rapid requests
- **Model discontinued:** If your provider retires a model, update your profile
- **Network issues:** Requires internet to reach provider

### Attachment Support

Different providers support different types of attachments in messages:

- **OpenAI:** Images, documents
- **Anthropic:** Images, documents
- **Google:** Images, documents
- **Ollama:** Limited attachment support

Check your provider's documentation for details on file types and sizes.

## Troubleshooting Connection Profiles

### Test failed: Invalid API key

**Solution:**

- Check API Keys tab — make sure you created the key
- Verify the key is still valid with your provider
- Delete and re-add the key from the provider's website

### Test failed: Model not found

**Solution:**

- Use "Fetch Models" to get current available models
- Your provider may have deprecated the model
- Select a different model that's currently available

### Connection works but chats are slow

**Causes:**

- Model is slow for your use case
- Provider is experiencing issues
- Network connection is slow

**Solutions:**

- Try a faster model
- Use a different provider
- Use a "cheap" profile for fast responses

### Can't create new profiles (greyed out button)

**Reason:** No API keys available

**Solution:**

- Go to API Keys tab
- Add at least one API key
- Return to Connection Profiles

## Related Settings

- **API Keys** — Store credentials for connection profiles
- **Chat Settings** — Configure which profile is used by default
- **Image Profiles** — Separate configuration for image generation
- **Embedding Profiles** — Separate configuration for semantic search

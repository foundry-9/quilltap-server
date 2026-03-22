---
url: /settings?tab=memory&section=embedding-profiles
---

# Embedding Provider Profiles

> **[Open this page in Quilltap](/settings?tab=memory&section=embedding-profiles)**

Embedding Provider Profiles configure services that transform text into numerical representations (embeddings) for semantic search. Embeddings enable Quilltap to intelligently search through memories and find relevant context based on meaning, not just keywords.

## Understanding Embeddings

Embeddings are a way to represent text numerically so that similar concepts have similar numbers. This enables:

- **Semantic search** — Find memories by meaning, not keywords
- **Memory retrieval** — Automatically find relevant past conversations
- **Context enhancement** — Provide relevant information to the AI
- **Similarity matching** — Find similar characters, chats, or memories

For example, a search for "cat" would find memories mentioning "feline" because embeddings understand that these are related.

## Accessing Embedding Profiles

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **Embedding Profiles** tab
3. You'll see any existing profiles and options to create new ones

## Viewing Embedding Profiles

The profiles list shows:

- **Profile Name** — Name you gave the profile
- **Provider** — Which embedding service (OpenAI, Ollama, etc.)
- **Status** — Whether configuration is complete
- **Vocabulary Stats** — How many embeddings are stored
- **Actions** — Buttons to edit or delete the profile

## Creating a New Embedding Profile

### Step 1: Choose an Embedding Provider

**Cloud Providers:**

**OpenAI Text-Embedding:**

- Model: text-embedding-3-small or text-embedding-3-large
- Requires OpenAI API key
- Cloud-hosted (requires internet)
- High quality embeddings

**Other cloud providers:**

- Cohere Embeddings
- Google Embeddings
- Other third-party embedding services

**Local Providers:**

**Ollama (Local):**

- Run embeddings locally
- No API costs
- No internet required
- Good for privacy
- Requires Ollama installation

### Step 2: Get Required Credentials

**For Cloud Providers (OpenAI):**

1. Go to platform.openai.com
2. Create or use existing API key
3. Note: Text embeddings have separate pricing from LLM usage
4. Return to Quilltap

**For Local Providers (Ollama):**

1. Install Ollama from ollama.ai
2. Start Ollama: `ollama serve`
3. Pull an embedding model: `ollama pull nomic-embed-text`
4. Note your Ollama URL (usually <http://localhost:11434>)

### Step 3: Add API Key to Quilltap (if needed)

For cloud providers only:

1. Go to the **AI Providers** tab in Settings (`/settings?tab=providers&section=api-keys`) and expand **API Keys**
2. Click **Add API Key**
3. Select "OpenAI" (or relevant provider)
4. Enter your API key
5. Test to verify it works
6. Return to Embedding Profiles tab

### Step 4: Create the Profile

1. In Settings → **Embedding Profiles** tab
2. Click **Add Embedding Profile**
3. A form appears with these fields:

   **Basic Information:**
   - **Profile Name** — Name this configuration (e.g., "OpenAI Embeddings", "Local Ollama")
   - **Provider** — Select embedding provider

   **Connection Settings (varies by provider):**

   *For OpenAI:*
   - **API Key** — Choose from your stored API keys
   - **Model** — Select embedding model version

   *For Ollama:*
   - **Base URL** — URL where Ollama is running (e.g., <http://localhost:11434>)
   - **Model** — Select which embedding model (must be installed)

4. Click **Save** to create the profile

## Editing an Embedding Profile

To modify an existing profile:

1. Find the profile in the list
2. Click **Edit** button (pencil icon)
3. Update settings:
   - Profile name
   - API key (cloud providers)
   - Base URL (local providers)
   - Model selection
4. Click **Save Changes**

## Deleting an Embedding Profile

To remove a profile:

1. Find the profile in the list
2. Click **Delete** button (trash icon)
3. Confirm the deletion
4. Profile is removed (any dependent features may need reconfiguration)

## Using Embedding Profiles

### Where Embeddings Are Used

**Memory Search:**

- When chats need to find relevant memories to include in context
- Embeddings find memories semantically related to current conversation

**Semantic Search:**

- Manual search for memories by meaning
- "Find all memories about travel" finds travel-related content even if worded differently

**Memory Cascade:**

- Required for summarization and context management
- Helps decide which memories are relevant to keep

**Context Enhancement:**

- Automatically includes relevant memories in chat messages
- Embeddings determine which memories are most relevant

### Selecting a Profile

Most embedding profile selection is automatic:

1. The first embedding profile you create becomes active
2. It's used automatically for memory operations
3. To change:
   - Edit Memory settings in Chat Settings tab
   - Select different embedding profile if multiple exist

### Vocabulary Management

Embeddings maintain a vocabulary of indexed memories:

- **Total Embeddings** — How many text segments are indexed
- **Growth Rate** — How quickly vocabulary is growing
- **Refresh** — Force re-indexing of memories

## Embedding Providers

### OpenAI Text-Embedding-3

**Best for:**

- Cloud-hosted, high-quality embeddings
- Production use
- Reliable service

**Pros:**

- Excellent quality
- Reliable service
- Well-maintained
- Good performance

**Cons:**

- Requires internet
- API costs ($0.00002-0.0004 per 1K tokens)
- Requires API key
- Subject to OpenAI rate limits

**Configuration:**

- Requires OpenAI API key in API Keys tab
- Choose between small and large models
- Large model = higher quality, higher cost

### Ollama (Local)

**Best for:**

- Privacy-focused setups
- Development/testing
- Offline use
- Zero API costs

**Pros:**

- Free (runs locally)
- No internet required (after setup)
- Complete privacy
- Works offline

**Cons:**

- Requires local installation
- Slower than cloud (depends on hardware)
- Lower quality than commercial embeddings
- Requires Ollama knowledge to set up

**Configuration:**

- Install Ollama from ollama.ai
- Start Ollama server: `ollama serve`
- Install model: `ollama pull nomic-embed-text`
- Set base URL to <http://localhost:11434> (or your server)
- **Docker users:** No URL changes needed — add `11434` to `HOST_REDIRECT_PORTS`

**Models for Ollama:**

- **nomic-embed-text** — Good all-purpose embeddings
- **all-minilm** — Lightweight, fast
- **bge-small** — Small but capable
- Others available in Ollama library

### Other Providers

Some installations support additional providers:

- **Cohere** — Commercial service, high quality
- **Google Embeddings** — Google's embedding service
- **Custom** — Self-hosted embedding servers
- Check your Quilltap documentation for available options

## Best Practices for Embeddings

### Choosing Embeddings

**For Best Quality:**

- Use OpenAI's text-embedding-3-large
- Highest quality, best semantic understanding
- Higher cost, slight latency

**For Balance:**

- Use OpenAI's text-embedding-3-small
- Good quality, reasonable cost
- Recommended for most users

**For Cost:**

- Use local Ollama setup
- No API costs (except hardware)
- Slightly lower quality but free

**For Privacy:**

- Use local Ollama setup
- All processing happens locally
- No data sent to external services

### Vocabulary Management

**Monitor vocabulary size:**

- Check Stats tab in Embedding Profiles
- Growing vocabulary = more memories indexed

**When to refresh:**

- After major memory operations
- If search seems inaccurate
- Manually trigger refresh if needed

**Storage considerations:**

- Embeddings take up storage space
- Each memory segment is embedded and stored
- Growing vocabulary = larger database

## Troubleshooting Embeddings

### No embedding profile available

**Problem:** No profiles created yet

**Solution:**

- Create first embedding profile
- Choose provider (OpenAI recommended for starting)
- Configure and save

### API key validation failed

**Problem:** OpenAI API key not working

**Solutions:**

- Verify key in API Keys tab
- Test key directly with OpenAI
- Check that key hasn't expired
- Confirm account has credits

### Ollama connection failed

**Problem:** Can't connect to local Ollama

**Solutions:**

- Verify Ollama is running: `ollama serve`
- Check Base URL matches your setup (default: <http://localhost:11434>)
- Verify embedding model is installed: `ollama pull nomic-embed-text`
- Check firewall isn't blocking local connection
- Try restarting Ollama

### Memory search returning poor results

**Causes:**

- Embedding model quality
- Vocabulary not indexed
- Query too different from indexed memories

**Solutions:**

- Switch to higher-quality embedding model
- Refresh vocabulary/re-index memories
- Be more specific in search queries
- Check that embeddings are actually enabled

### Vocabulary not growing

**Problem:** Embeddings stat showing 0 or very low

**Solutions:**

- Ensure embedding profile is active
- Create some memories/chats to index
- Manually refresh vocabulary
- Check embedding profile configuration

### Memory features not working

**Problem:** Memory cascade, semantic search not functioning

**Causes:**

- No embedding profile configured
- Embedding profile not active
- Embedding model not properly set up

**Solutions:**

- Create and configure embedding profile
- Verify profile is selected in Chat Settings
- Check Ollama is running (if using local)
- Restart chat and try again

## In-Chat Settings Access

Characters with help tools enabled can read your configured embedding profiles during a conversation using the `help_settings` tool with `category: "embeddings"`. This returns each profile's name, provider, model, and dimensions --- but never your API keys. Ask a help-tools-enabled character something like "What embedding profiles do I have set up?" and it will consult the records.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory&section=embedding-profiles")`

## Related Settings

- [API Keys](api-keys-settings.md) — Store credentials for cloud embedding providers (OpenAI)
- [Chat Settings](chat-settings.md) — Memory cascade settings that use embeddings
- [Connection Profiles](connection-profiles.md) — LLM used in conjunction with embeddings for memory operations
- [Chat Settings](chat-settings.md) — Context management depends on embeddings

## Glossary

- **Embedding** — Numerical representation of text that captures meaning
- **Vocabulary** — Collection of all indexed text segments
- **Semantic** — Relating to meaning rather than exact words
- **Index/Indexing** — Process of converting text to embeddings for search
- **Vector** — Mathematical representation of an embedding (array of numbers)
- **Similarity** — How close two embeddings are (how related their meanings are)

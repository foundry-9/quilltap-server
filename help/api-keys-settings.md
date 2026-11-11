---
url: /settings?section=api-keys
---

# API Keys Settings

> **[Open this page in Quilltap](/settings?section=api-keys)**

The API keys are Quilltap's ring of brass latchkeys — one for every establishment whose door you mean to knock upon. They live under **Settings → Connections → Providers**, and they live there in the company of everything that uses them: each provider has a card of its own, the provider's keys hang at the top of it, and beneath them sit every profile that walks through that particular door. It is a tidier arrangement than the old one, in which keys and the profiles that depended on them were kept in separate drawers and introduced to one another only by rumour.

## What Are API Keys?

An API key is a unique credential that authorizes Quilltap to access your account with an AI provider. It's like a password, but specifically for accessing that service's API.

**Important:** Keep your API keys private. Never share them with others or paste them in public places. Quilltap encrypts every key it holds — that is Saquel Ytzama's department, and he wears his badge on every key row to remind you of it.

## Finding Your Keys

1. Click **Settings** (gear icon) in the left sidebar
2. Choose the **Connections** group and open the **Providers** card
3. Make sure the view toggle at the top of the card reads **By provider** (the default)
4. Click a provider's card to open it — its keys are listed first

Each provider card's header says, at a glance, how many keys and profiles it is holding, so you can tell an empty cupboard from a full one before you open it.

### The other way of looking at it: By kind

If you would rather see every key you own in one place — the old-fashioned, all-the-latchkeys-on-one-board view — click **By kind** at the top of the Providers card. The card rearranges itself into the four familiar lists: **API Keys**, **Connection Profiles**, **Image Profiles** and **Embedding Profiles**. The API Keys list there is the very same list, with the same buttons, plus **Import** and **Export** for the whole ring at once. Quilltap remembers which view you last chose, on this browser, and a link that points straight at the API Keys list (such as the one at the top of this page) opens *By kind* for you with that list already unfolded.

## What a Key Row Shows

Whichever view you are in, a key appears the same way:

- **Label** — The name you gave the key (e.g., "My OpenAI Account", "Work Account")
- **Provider and Key Preview** — Which service the key is for, and the last four characters of the key itself, for verification without exposure
- **Last Used** — When the key was last used to make a request
- **Test** — Asks the provider whether the key still opens the door
- **Delete** — Removes the key, after a confirming word

## Adding a Key

### Step 1: Add the Key to Quilltap

The quickest route is from the provider's own card:

1. Open the provider's card under **By provider**
2. Click **+ Add** and choose **API key**
3. The key form opens with the provider already chosen for you; give the key a **Label**, paste the **API Key**, and click **Create API Key**

For a provider you have never used before — and which therefore has no card yet — use the **Add a provider** card at the very end of the list. **Add an API key** opens the same form with the full provider picker, and **Open the Setup Wizard** walks you through key, models and profiles in one guided promenade. (In *By kind*, the **+ Add API Key** button on the API Keys list does the same as **Add an API key**.)

The form's fields:

- **Provider** — Select the AI service (OpenAI, Anthropic, Google, Grok, DeepSeek, Z.AI, NanoGPT, OpenRouter, OpenAI-Compatible, etc.). Only providers that can actually carry a key are offered; Ollama, which asks for none, is not among them — and on Ollama's card the **API key** entry of the **+ Add** menu is greyed out for the same reason
- **Label** — Give this key a memorable name (e.g., "Production Account", "Testing Key")
- **API Key** — Paste your actual API key from the provider's website

Once a key is saved, Quilltap looks about for any profiles of that provider still waiting for a key and introduces them, announcing each introduction as it goes.

### Step 2: Obtain an API Key from the Provider

Before you can add a key to Quilltap, you need to get one from the provider:

**For OpenAI:**

1. Go to platform.openai.com
2. Log in to your account
3. Go to API keys section
4. Click "Create new secret key"
5. Copy the key (you can only see it once)
6. Paste it into Quilltap

**For Anthropic:**

1. Go to console.anthropic.com
2. Log in to your account
3. Navigate to API keys
4. Create a new key
5. Copy and paste into Quilltap

**For Google (Gemini):**

1. Go to aistudio.google.com
2. Click "Get API Key"
3. Create a new API key
4. Copy and paste into Quilltap

**For other providers:** Follow their documentation to obtain an API key, then add it to Quilltap using the steps above.

## Replacing an API Key

Keys are not edited in place — a latchkey, once cut, is what it is. When a provider issues you a new key, add the new one, point the profiles that used the old one at it (open each profile from the provider's card and choose the new key), and then delete the old key.

## Deleting an API Key

To remove a key you no longer need:

1. Find the key — on its provider's card, or in the API Keys list under *By kind*
2. Click **Delete**
3. A small confirmation appears beside the button
4. Confirm, and the key is gone

**Warning:** Deleting a key leaves any profile that was using it without one. Such a profile is flagged with a missing-key badge, and the attention strip at the top of Settings keeps calling your attention to it until you give it another key.

## Testing an API Key

Before using a key in a connection profile, you can verify it works:

1. Find the key — on its provider's card, or in the API Keys list under *By kind*
2. Click **Test**
3. Quilltap sends a verification request to the provider
4. You'll see the result:
   - ✓ **Valid** — The key works and can be used
   - ✗ **Invalid** — The key is incorrect, expired, or has no credits
   - **Connection failed** — There was a problem reaching the provider at all

### Why test a key?

- **Verify credentials** — Make sure you entered it correctly
- **Check account status** — Ensure your account has active credits
- **Troubleshoot** — If a key isn't working, testing reveals the issue
- **Before using** — Test new keys before adding them to connection profiles

## Exporting API Keys

You can export all your API keys for backup purposes. Exporting and importing work on the whole ring at once, so they live on the API Keys list in the **By kind** view:

1. Switch the Providers card to **By kind** and open **API Keys**
2. Click **Export**
3. Choose a passphrase; your keys are downloaded as an encrypted file
4. Store this file securely (it contains sensitive credentials)

**Security tip:** Keep exported keys in a secure location. Treat them like passwords.

Key previews show only the last four characters (for example `••••abcd`). New export files are sealed with a stronger key derivation; export files from earlier days still import as ever.

## Importing API Keys

To restore previously exported keys:

1. Switch the Providers card to **By kind**, open **API Keys**, and click **Import**
2. A dialog asks you to select a file you exported earlier
3. Choose the file from your computer and give its passphrase
4. You'll see a list of imported keys and can choose which ones to add

**Note:** Import won't overwrite existing keys — you can choose which to add.

## Supported Providers

Quilltap supports API keys from:

- **OpenAI** — GPT-4, GPT-3.5, and other models
- **Anthropic** — Claude models
- **Google** — Gemini models
- **Grok** — Xai's Grok model
- **DeepSeek** — DeepSeek models
- **Z.AI** — GLM models
- **NanoGPT** — one pay-as-you-go key admitting you to hundreds of chat, image, and embedding models
- **OpenRouter** — Multi-model routing service
- **OpenAI-Compatible** — any service speaking the OpenAI dialect: Together, Fireworks, Groq, DeepInfra, a hosted vLLM, a corporate gateway
- **Other providers** — Custom or provider-specific keys

Two provider kinds are absent from that list on purpose. **Ollama** wants no key
whatever — it is your own machine, and it does not ask you for credentials to
speak to yourself — so it is not offered here and its connection profiles show
no key field at all.

**OpenAI-Compatible** is the peculiar case, and as of 4.9 it is handled
properly. The same provider serves the unbolted `llama-server` on your desk and
a hosted endpoint that will not exchange a syllable without a bearer token, so
a key is neither demanded nor forbidden: create one here if your endpoint wants
one, and the *API Key* field on the profile — unstarred, since it is optional —
will offer it. Before 4.9 the provider was missing from this list entirely and
the field never appeared, which made a hosted OpenAI-compatible service simply
unusable, 401 after 401, with nothing on the page to explain the omission.

You can also set custom base URLs for self-hosted LLM providers.

## Using API Keys

Once you've added an API key, you use it by:

1. Opening the provider's card and choosing **+ Add → Connection profile** (or an image or embedding profile)
2. The provider arrives already selected — and if it holds exactly one key, that key is chosen for you too
3. Choosing a different key, if you keep several
4. Selecting a model and any provider-specific options
5. Testing the connection
6. Using that profile in chats

API keys are never sent out of Quilltap unless they're used to make a request to the provider's service.

## Managing Multiple Keys

You can store multiple keys from the same provider. This is useful for:

- **Multiple accounts** — Different accounts with different quotas
- **API key rotation** — Keeping an old key while testing a new one
- **Shared access** — Different keys for different projects
- **Testing** — Keeping a test key separate from production

## Security Best Practices

- **Never commit keys to git** — Keep keys out of version control
- **Don't paste in chat** — Avoid sharing keys in Quilltap conversations
- **Rotate periodically** — Generate new keys and delete old ones
- **Use labels** — Clear labels help you identify keys by purpose
- **Test immediately** — Verify new keys work right after adding them
- **Keep backups secure** — If you export keys, store the file safely
- **Review regularly** — Check your API keys list for unused or old keys

## Troubleshooting API Keys

### Key validation failed

**Problem:** Testing shows "Invalid" or error message

**Solutions:**

- Double-check you copied the entire key correctly
- Verify the key hasn't expired (check with your provider)
- Confirm your account has available credits
- Make sure you selected the right provider

### Can't find my API key

**Where to look:**

- OpenAI: platform.openai.com/api-keys
- Anthropic: console.anthropic.com/account/keys
- Google: aistudio.google.com/app/apikey
- Other providers: Check their documentation

### Connection profile not working after key update

**Solution:**

- Open the profile from its provider's card and choose the new API key
- Test the connection profile after making the change

### Multiple keys from same provider

**Which one is used?**

- The Connection Profile you create chooses which key to use
- You can have different profiles use different keys
- No key is selected by default — you choose per profile

## In-Chat Settings Access

Characters with help tools enabled can read your configured connection, embedding, and image profiles during a conversation using the `help_settings` tool (with categories `"connections"`, `"embeddings"`, or `"images"` respectively). These reports show which profiles exist and which providers and models they use --- but API keys and credentials are never disclosed, not even partially. Ask a help-tools-enabled character something like "What providers do I have set up?" and it will produce a summary.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?section=api-keys")`

## Related Settings

- [Connection Profiles](connection-profiles.md) — Use API keys to create LLM connections
- [Chat Settings](chat-settings.md) — Configure which connection profile is used by default
- [Image Generation Profiles](image-generation-profiles.md) — Some image providers also require API keys
- [Embedding Profiles](embedding-profiles.md) — Cloud-based embeddings need API keys

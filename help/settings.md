# The Foundry

> **[Open this page in Quilltap](/foundry)**

The Foundry is the central hub for managing all aspects of how Quilltap works. It unifies settings, tools, and system management into a single location organized by subsystem. Each subsystem groups related configuration and utilities together so you can find everything in one place.

## Accessing The Foundry

1. Click the **Foundry** icon in the left sidebar footer
2. You'll see the Foundry hub with 8 subsystem pages listed
3. Click any subsystem to view and manage its settings and tools

## Understanding the Subsystems

The Foundry organizes everything into 8 subsystem pages, each named after the Quilltap feature area it supports:

### **Aurora** --- Roleplay & Prompts

Manage roleplay templates and reusable prompt templates that shape how characters behave and communicate.

- **Roleplay Templates** --- Define conversation patterns, system prompts, and character behaviors
- **Prompts** --- Create and manage reusable prompt templates across characters and conversations

> See [Roleplay Templates Settings](roleplay-templates-settings.md) and [Prompts](prompts.md) for full details

### **The Forge** --- Infrastructure & Data

Configure the core infrastructure that powers Quilltap, including provider credentials, plugins, storage, and data management.

- **API Keys** --- Store authentication credentials for LLM providers and services
- **Connection Profiles** --- Link API keys to specific providers and models for AI chat
- **Plugins** --- Install, update, and configure plugins from the registry
- **File Storage** --- Configure where Quilltap stores files and images
- **Backup & Restore** --- Create and restore full system backups
- **Import/Export** --- Transfer data in and out of Quilltap in native format
- **Delete All Data** --- Permanently remove all data (use with extreme caution)

> See [API Keys Settings](api-keys-settings.md), [Connection Profiles](connection-profiles.md), [Plugins](plugins.md), [File Storage Settings](file-storage-settings.md), [Backup & Restore](system-backup-restore.md), [Import & Export Data](system-import-export.md), and [Deleting Your Data](system-delete-data.md) for full details

### **The Salon** --- Chat Settings

Configure global chat behavior and how the AI interacts during conversations.

- **Avatar** --- Chat avatar display settings
- **CheapLLM** --- Configure which lightweight model handles background tasks
- **Image Description** --- How AI describes images in chat
- **Memory Cascade** --- Control how memories flow into conversations
- **Context Compression** --- Manage context window compression settings
- **LLM Logging** --- Toggle detailed logging of AI interactions
- **Token Display** --- Show or hide token usage in chat
- **Automation** --- Configure automated chat behaviors
- **Agent Mode** --- Enable or configure agentic tool-use behaviors

> See [Chat Settings](chat-settings.md) for full details

### **The Commonplace Book** --- Memory & Embeddings

Manage the memory systems that let characters remember and recall information.

- **Embedding Profiles** --- Configure text embedding services for semantic memory search
- **Memory Deduplication** --- Find and merge duplicate memories across characters

> See [Embedding Provider Profiles](embedding-profiles.md) and [System Tools](system-tools.md) for full details

### **Prospero** --- System Monitoring

Monitor system activity and review operational data about your Quilltap instance.

- **Tasks Queue** --- View and manage background jobs (memory extraction, imports, analysis)
- **Capabilities Report** --- Generate reports documenting your system's configuration
- **LLM Logs** --- Review detailed records of all AI model interactions and API calls

> See [Managing Tasks](system-tasks-queue.md), [Capabilities Report](system-capabilities-report.md), and [LLM Logs](system-llm-logs.md) for full details

### **Dangermouse** --- Content Safety

Configure how Quilltap handles sensitive or potentially policy-violating content, including classification and routing to compatible providers.

> See [Dangerous Content Handling](dangerous-content.md) for full details

### **Calliope** --- Appearance & Organization

Customize how Quilltap looks and how you organize your content.

- **Appearance** --- Theme selection, color mode (light/dark), and display options
- **Tags** --- Customize tag colors, icons, and visibility throughout the application

> See [Appearance Settings](appearance-settings.md) and [Tags Customization](tags-customization.md) for full details

### **The Lantern** --- Visual & Backgrounds

Configure image generation and the atmospheric background system for chats.

- **Image Profiles** --- Set up image generation providers and models
- **Story Backgrounds** --- Configure automatic atmospheric background images for chats and projects

> See [Image Generation Profiles](image-generation-profiles.md) and [Story Backgrounds](story-backgrounds.md) for full details

## Quick Configuration Workflow

### Setting up Quilltap for the first time

1. **Add API Keys** (The Forge) --- Store your credentials for AI providers
2. **Create Connection Profiles** (The Forge) --- Link API keys to LLM providers
3. **Set Chat Preferences** (The Salon) --- Configure default chat behaviors
4. **Optional: Image Generation** (The Lantern) --- If you want image generation capabilities
5. **Optional: Embedding Search** (The Commonplace Book) --- If you want semantic memory search

### Installing new capabilities

1. **Browse Plugins** (The Forge) --- Find and install new functionality
2. **Configure Plugin Settings** --- Each plugin may have its own configuration
3. **Set up related profiles** --- Some plugins may require new Connection, Image, or Embedding profiles

## Settings Persistence

All changes in The Foundry are saved automatically. You don't need to click a "Save" button --- most settings update as you make changes.

### When changes take effect

- **Immediate:** Appearance, tags, chat preferences
- **On next chat:** Connection profile changes, plugin enablement
- **On next operation:** Image generation profile, embedding profile changes

## Important Notes

- **Subsystem names may vary by theme:** If you have an active theme, it may rename subsystem pages (e.g., "The Lantern" might appear as "Image Generation"). The underlying functionality and documentation links remain the same regardless of display names.
- **API Keys are sensitive:** Never share your API keys with others or commit them to version control
- **Profiles depend on API Keys:** You must create API keys before creating connection profiles
- **Plugin installation:** Some plugins may require specific configuration before they work
- **Storage configuration:** File storage settings should be configured early in your setup

## Troubleshooting The Foundry

### Can't find a setting I need?

- Settings are organized by subsystem. Think about which feature area the setting relates to and navigate to that subsystem page.
- Some settings may only appear if their dependencies are configured (e.g., Image Profiles requires an API key first)
- Check if you need to install a plugin that provides additional settings
- See the specific subsystem's documentation for requirements

### Changes aren't taking effect

- Refresh the page to ensure changes are loaded
- For connection changes, start a new chat or send a new message
- Check that all required prerequisites are configured (API keys, etc.)

### Getting help

- Each subsystem has detailed documentation in the help menu
- Hover over question marks (?) in settings for additional information
- Check specific subsystem documentation linked at the top of this page

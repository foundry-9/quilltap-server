# Settings Overview

> **[Open this page in Quilltap](/settings)**

The Settings page is the central hub for managing all aspects of how Quilltap works, including AI providers, file storage, appearance, and more.

## Accessing Settings

1. Click the **Settings** icon (gear) in the left sidebar
2. You'll see multiple tabs across the top of the settings page
3. Click any tab to view and manage those specific settings

## Understanding the Settings Tabs

Quilltap organizes settings into the following categories:

### **API Keys**

Manage authentication credentials for LLM providers and services. This is where you store API keys securely before using them in connection profiles.

→ See [API Keys Settings](api-keys-settings.md) for full details

### **Connection Profiles**

Configure LLM (Large Language Model) connections for AI chat. Connection profiles link your API keys to specific providers and models, allowing Quilltap to communicate with AI services.

→ See [Connection Profiles](connection-profiles.md) for full details

### **Chat Settings**

Configure global chat behavior including avatar display, memory management, token tracking, and which services are used for specific features like image description and embedding.

→ See [Chat Settings](chat-settings.md) for full details

### **Appearance**

Customize how Quilltap looks including theme selection, color mode (light/dark), sidebar width, and access to the theme quick-switcher.

→ See [Appearance Settings](appearance-settings.md) for full details

### **Image Profiles**

Set up image generation services so Quilltap can generate images during conversations. Image profiles configure which provider and model to use for image generation.

→ See [Image Generation Profiles](image-generation-profiles.md) for full details

### **Embedding Profiles**

Configure text embedding services used for semantic search of memories and other AI-powered search features in Quilltap.

→ See [Embedding Provider Profiles](embedding-profiles.md) for full details

### **Plugins**

Manage installed plugins, browse new plugins from the registry, check for updates, and configure individual plugin settings.

→ See [Plugins](plugins.md) for full details

### **File Storage**

Configure where Quilltap stores files and images, including local storage paths and cloud storage backends.

→ See [File Storage Settings](file-storage-settings.md) for full details

### **Tags**

Customize how tags look throughout the application, including colors, icons, and which tags to hide quickly.

→ See [Tags Customization](tags-customization.md) for full details

### **RP Templates**

Create and manage roleplay templates for characters. Templates let you define conversation patterns and character behaviors.

→ See [Roleplay Templates Settings](roleplay-templates-settings.md) for full details

### **Prompts**

Create and manage reusable prompt templates that you can use across characters and conversations.

→ See [Prompts](prompts.md) for full details

## Quick Configuration Workflow

### Setting up Quilltap for the first time

1. **Add API Keys** (API Keys tab) — Store your credentials for AI providers
2. **Create Connection Profiles** (Connection Profiles tab) — Link API keys to LLM providers
3. **Set Chat Preferences** (Chat Settings tab) — Configure default behaviors
4. **Optional: Image Generation** (Image Profiles tab) — If you want image generation capabilities
5. **Optional: Embedding Search** (Embedding Profiles tab) — If you want semantic memory search

### Installing new capabilities

1. **Browse Plugins** (Plugins tab) — Find and install new functionality
2. **Configure Plugin Settings** — Each plugin may have its own configuration
3. **Set up related profiles** — Some plugins may require new Connection, Image, or Embedding profiles

## Settings Persistence

All changes in Settings are saved automatically. You don't need to click a "Save" button — most settings update as you make changes.

### When changes take effect

- **Immediate:** Appearance, tags, chat preferences
- **On next chat:** Connection profile changes, plugin enablement
- **On next operation:** Image generation profile, embedding profile changes

## Important Notes

- **API Keys are sensitive:** Never share your API keys with others or commit them to version control
- **Profiles depend on API Keys:** You must create API keys before creating connection profiles
- **Plugin installation:** Some plugins may require specific configuration before they work
- **Storage configuration:** File storage settings should be configured early in your setup

## Troubleshooting Settings

### Can't see a setting I need?

- Some settings may only appear if their dependencies are configured (e.g., Image Profiles requires an API key first)
- Check if you need to install a plugin that provides additional settings
- See the specific tab's documentation for requirements

### Changes aren't taking effect

- Refresh the page to ensure changes are loaded
- For connection changes, start a new chat or send a new message
- Check that all required prerequisites are configured (API keys, etc.)

### Getting help

- Each tab has detailed documentation in the help menu
- Hover over question marks (?) in settings for additional information
- Check specific settings documentation linked at the top of this page

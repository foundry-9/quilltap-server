# Plugins

> **[Open this page in Quilltap](/foundry/forge)**

Plugins extend Quilltap's functionality by adding new features, themes, and capabilities. The Plugins tab is where you manage installed plugins, install new ones, and check for updates.

## Understanding Plugins

Plugins are packages of code that add functionality to Quilltap, such as:

- **Themes** — Customize the look and feel
- **Tools** — Add new capabilities to AI chats (search tools, calculations, etc.)
- **Providers** — Support for additional LLM services or storage backends
- **Storage backends** — Cloud storage support
- **Templates** — Pre-built roleplay templates and systems
- **Utilities** — Various utility features

Plugins can be:

- **Bundled** — Included with Quilltap by default
- **From NPM** — Installed from the Node Package Manager registry
- **From Git** — Installed from a Git repository
- **Manual** — Installed by manually copying files

## Accessing Plugins

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **Plugins** tab
3. You'll see three sub-tabs: **Installed**, **Upgrades**, **Browse**

## Viewing Plugin Status

At the top of the Plugins page, you see **Plugin Stats:**

- **Total** — Total number of plugins configured
- **Enabled** — Plugins currently active
- **Disabled** — Plugins installed but inactive
- **Errors** — Plugins with configuration problems

## The Installed Tab

View and manage all currently installed plugins.

### Understanding the Plugin List

For each installed plugin, you see:

- **Plugin Name & Title** — What the plugin does
- **Source Badge** — Where it came from (Bundled, NPM, Git, Manual, Installed)
- **Version** — Current version number
- **Description** — What the plugin does
- **Author** — Who created it
- **Capabilities** — What features it adds (Themes, Tools, Providers, Storage, etc.)
- **Status** — Enabled/disabled toggle switch
- **Actions** — Configure, view details, or enable/disable

### Enabling/Disabling Plugins

**To enable a plugin:**

1. Find it in the Installed list
2. Toggle the switch to **ON** (blue)
3. Plugin activates immediately
4. Features from plugin become available in Quilltap

**To disable a plugin:**

1. Find it in the Installed list
2. Toggle the switch to **OFF** (gray)
3. Plugin deactivates immediately
4. Features from plugin are no longer available
5. Disabling doesn't uninstall the plugin — it can be re-enabled

**When to disable:**

- Testing different configurations
- Troubleshooting problems
- Temporarily using different version
- Reducing performance impact

### Configuring Plugins

Some plugins have custom settings:

1. Find the plugin in the Installed list
2. Click **Configure** button (if available)
3. A configuration modal appears
4. Adjust settings for the plugin
5. Click **Save** to apply changes

**Common plugin settings:**

- Themes can configure colors and styles
- Tools can have enable/disable toggles
- Providers can have API credentials
- Storage backends can have path/URL configuration

### Viewing Plugin Details

To see more information about a plugin:

1. Click on the plugin name or expand button
2. Full details appear:
   - Complete description
   - Author information
   - Version history (sometimes)
   - Capabilities list
   - Installation date
   - Installed from (location/source)

## The Upgrades Tab

Check for available plugin updates and upgrade to newer versions.

### Finding Available Upgrades

1. Click the **Upgrades** tab
2. See list of installed plugins with newer versions available
3. Each shows:
   - Current version
   - Available version
   - Release notes (if available)
   - Update button

**Empty list?** All plugins are up to date.

### Upgrading a Plugin

1. Find the plugin in the Upgrades list
2. Review the new version information
3. Click **Upgrade** button
4. Confirm upgrade in dialog
5. Quilltap downloads and installs new version
6. Plugin remains enabled with new version
7. See success message when complete

**What upgrades include:**

- Bug fixes
- New features
- Performance improvements
- Security patches
- Compatibility updates

### When to Upgrade

- **Recommended** — Safe to upgrade when available
- **Test first** — On development system if critical plugin
- **Read release notes** — Important changes may be mentioned
- **Back up** — If worried, backup system before upgrading

## The Browse Tab

Install new plugins from the NPM registry.

### Browsing Available Plugins

1. Click the **Browse** tab
2. See list of available plugins from NPM
3. Search using keywords or scroll through list
4. Each plugin shows:
   - Name
   - Description
   - Author
   - Version
   - Keywords/tags
   - Quality score (popularity rating)
   - Last updated date

### Searching for Plugins

1. Use the **Search** field at the top
2. Enter keywords (e.g., "theme", "weather tool", "storage")
3. Results filter to matching plugins
4. Click a plugin to see details

**Search tips:**

- Be specific (e.g., "cloud storage" instead of "storage")
- Use single keywords (system will find variations)
- Look at quality score — higher is more reliable
- Check "last updated" — actively maintained is better

### Viewing Plugin Details

1. Click on a plugin to expand details
2. See:
   - Full description
   - All capabilities
   - Author and contact info
   - Installation instructions
   - Ratings/reviews (if available)
   - Repository link (if available)

### Installing a Plugin

1. Find the plugin you want in Browse tab
2. Click **Install** button
3. A confirmation dialog appears
4. Review what you're installing
5. Click **Confirm Install**
6. Quilltap downloads and installs plugin
7. You see success message
8. Plugin appears in Installed tab (may be disabled by default)

**After installing:**

1. Go to Installed tab
2. Find the newly installed plugin
3. Enable it by toggling the switch
4. Configure if needed (click Configure)
5. Restart chat or refresh UI if needed for features to appear

### Uninstalling Plugins

Most plugins can be uninstalled:

1. Go to Installed tab
2. Find the plugin
3. Click **Uninstall** button (if available)
4. Confirm uninstall
5. Plugin is removed from system

**Some bundled plugins can't be uninstalled** — they're part of core Quilltap. You can only disable them.

## Understanding Plugin Capabilities

### Theme Plugins

**What they do:** Customize Quilltap's appearance

**Installation:** Install plugin → Go to Appearance tab → Select theme

**Examples:** Dark mode variants, custom color schemes, light themes

### Tool Plugins

**What they do:** Add new capabilities to AI chats

**Examples:**

- Web search tools
- Calculator tools
- Image analysis tools
- Custom integrations

**Usage:** Enable plugin → Use in chat (AI can use tools)

### Provider Plugins

**What they do:** Add support for new LLM or service providers

**Examples:**

- Support for new LLM services
- Alternative embedding services
- Custom language model wrappers

**Installation:** Install → Create profile using new provider in relevant Settings tab

### Storage Plugins

**What they do:** Add cloud storage backend support

**Examples:**

- AWS S3 integration
- Google Cloud Storage
- Azure Blob Storage
- Dropbox integration

**Usage:** Install → Configure in File Storage Settings tab

### Template Plugins

**What they do:** Provide pre-built character and roleplay templates

**Installation:** Install → Use when creating characters

## Managing Multiple Plugins

### Best Practices

- **Keep updated** — Regularly check Upgrades tab
- **Disable if unused** — Reduce resource usage
- **Test before enabling** — Enable one at a time to isolate issues
- **Configure properly** — Some need setup before use
- **Review capabilities** — Know what each enabled plugin does

### Performance Considerations

- Each enabled plugin uses some resources
- Disable plugins you're not using
- Heavy plugins (like theme rendering) may impact performance
- Monitor system if many plugins are enabled

### Conflicts

Some plugins may conflict with each other:

- Two theme plugins won't conflict (only one active)
- Two tool plugins usually work together
- Provider conflicts rare (use whichever you prefer)
- Disable one if conflicts occur

## Troubleshooting Plugins

### Plugin not showing in browse

**Reasons:**

- Plugin name contains typo in search
- Plugin is not published to NPM
- Plugin doesn't exist yet

**Solutions:**

- Try different search terms
- Check NPM website directly
- Contact plugin author

### Plugin won't install

**Error messages:**

- "Installation failed" — Network or package issue
- "Invalid plugin" — Plugin package is corrupted
- "Already installed" — Version already exists

**Solutions:**

- Try installing again
- Check internet connection
- Try different version
- Restart Quilltap and try again

### Plugin installs but doesn't work

**Causes:**

- Plugin not enabled
- Plugin needs configuration
- Incompatible Quilltap version
- Missing dependencies

**Solutions:**

- Check plugin is enabled (toggle switch ON)
- Check configuration is complete
- Check plugin requirements
- Try upgrading plugin to newer version
- Restart Quilltap

### New features don't appear after enabling

**Causes:**

- Plugin needs restart
- UI needs refresh
- Plugin requires specific configuration

**Solutions:**

- Refresh page (Ctrl+R or Cmd+R)
- Restart Quilltap
- Go to relevant settings tab to configure plugin
- Check plugin documentation

### Plugin version conflicts

**Problem:** Installed plugin version seems old

**Solutions:**

- Check Upgrades tab for available updates
- Click Upgrade to get latest version
- If stuck, disable and reinstall plugin

### Error in plugin configuration

**Causes:**

- Invalid credentials or settings
- Missing required configuration
- Plugin not properly initialized

**Solutions:**

- Review plugin documentation
- Check configuration settings
- Try resetting plugin to defaults
- Disable and re-enable plugin

## Common Plugin Workflows

### Adding a New Theme

1. Go to Plugins tab → Browse
2. Search "theme"
3. Find theme you like
4. Click Install
5. Confirm installation
6. Go to Calliope (`/foundry/calliope`) → Appearance
7. Select new theme

### Setting Up Image Generation

1. Get API key from provider (DALL-E, Stable Diffusion, etc.)
2. Go to The Forge (`/foundry/forge`) → API Keys
3. Add API key for image service
4. Go to The Lantern (`/foundry/lantern`) → Image Profiles
5. Create image profile
6. Now ready to generate images in chats

### Installing a Tool

1. Go to Plugins tab → Browse
2. Search for tool (e.g., "web search")
3. Find tool you want
4. Install it
5. Go to Installed tab
6. Enable tool by toggling switch
7. In chat, use tool (AI will use when appropriate)

## Advanced: Manual Plugin Installation

For local development or plugins not on NPM:

1. Have plugin files ready (usually downloaded from Git)
2. Place in Quilltap plugins directory
3. Go to Plugins tab
4. Might appear under "Manual" source
5. Enable and configure as normal

**Location varies by installation:**

- Docker: Inside container
- Self-hosted: Check documentation
- Managed instance: Usually not supported

## Related Settings

- **Appearance** — Theme plugins install here
- **API Keys** — Credentials for plugins that need them
- **Chat Tools** — Enable/disable tools per chat
- **Connection Profiles** — If plugin adds new providers
- **File Storage** — If plugin adds storage backends
- **Roleplay Templates** — If plugin adds templates

## Plugin Resources

### Finding Plugins

- **NPM Registry** — npm.js.com (search for "quilltap-")
- **GitHub** — Search GitHub for quilltap plugins
- **Documentation** — Quilltap docs site has plugin directory
- **Community** — Ask in community forums

### Creating Plugins

For developers interested in creating plugins:

- See [PLUGIN_DEVELOPMENT.md](../docs/PLUGIN_MANIFEST.md)
- See [PLUGIN_INITIALIZATION.md](../docs/PLUGIN_INITIALIZATION.md)
- Review existing bundled plugins for examples
- Join developer community for support

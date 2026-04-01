# Themes

> **[Open this page in Quilltap](/foundry/calliope)**

Themes control the overall look and feel of Quilltap, including colors, fonts, and visual styling. You can switch between the built-in default theme and custom themes installed as plugins, and customize your preferred color mode (light, dark, or system).

## What Are Themes?

A theme is a complete visual design for Quilltap that includes:

- **Color scheme** — Primary, secondary, accent, and background colors for light and dark modes
- **Typography** — Font families used for headings and body text
- **Component styles** — Visual appearance of buttons, cards, inputs, and other UI elements
- **Dark mode support** — Some themes provide separate styling for light and dark modes

Quilltap comes with a built-in default theme and can be extended with custom themes installed as plugins.

## Available Themes

### Default Theme

Quilltap includes a carefully designed default theme featuring:

- A clean, professional color palette
- Excellent readability in both light and dark modes
- Consistent component styling
- Optimized for creative work and long writing sessions

The default theme is always available and serves as a fallback if no other theme is selected.

### Plugin Themes

Additional themes can be installed as plugins to provide alternative visual styles:

- Custom color palettes and design languages
- Specialized fonts and typography
- Themed components
- Additional customization options

Check your installed plugins to see available themes.

## Color Modes

In addition to choosing a theme, you can select your preferred **color mode**:

### Light Mode

- Bright background with dark text
- Better for well-lit environments
- Reduces eye strain in daylight
- Use when you prefer a clean, bright interface

### Dark Mode

- Dark background with light text
- Better for low-light environments
- Reduces blue light exposure
- Use when you prefer a darker interface for evening work

### System Mode

- Automatically matches your operating system preference
- Switches when your OS switches between light and dark
- No manual switching needed
- Recommended for most users

## Changing Your Theme

### Quick Theme Switcher

The theme quick-switcher is a convenient way to change themes from the sidebar:

1. Look at the **sidebar footer** (bottom left of the screen)
2. Find the **palette icon** (paintbrush/colors)
3. Click to open the theme menu
4. Select a theme from the list
5. Your theme changes instantly

The quick-switcher only appears if you've enabled it in Settings (see below).

### Through Settings

You can also change themes in the Appearance settings:

1. Open **Settings** from the sidebar
2. Go to the **Appearance** tab
3. In the **Theme Selection** section, choose your preferred theme
4. See a preview of the selected theme
5. Changes apply immediately

### Through the Menu

When the quick-switcher is enabled:

1. Click the palette icon in the sidebar footer
2. See all available themes with color previews
3. Click any theme to switch
4. See color mode options below the themes
5. Click to change light/dark/system preference

## Theme Quick-Switcher Feature

The theme quick-switcher is an optional sidebar button that gives you instant access to theme and color mode selection.

### Enabling the Quick-Switcher

1. Open **Settings** from the sidebar
2. Go to the **Appearance** tab
3. Find the **Show theme selector in navigation** toggle
4. Turn it **ON**
5. The palette icon appears in the sidebar footer

### Disabling the Quick-Switcher

1. Open **Settings** → **Appearance**
2. Find the **Show theme selector in navigation** toggle
3. Turn it **OFF**
4. The palette icon disappears from the sidebar

### Using the Quick-Switcher

When enabled:

1. **Locate the icon** — Look for the palette (paintbrush/colors) icon in the sidebar footer
2. **Click to open** — Click the icon to open the theme menu
3. **Select a theme** — Click any theme name to switch instantly
4. **See colors** — Each theme shows color swatches for preview
5. **Change color mode** — Below themes, toggle between Light, Dark, and System modes
6. **Close menu** — Click elsewhere or press Escape to close

### Theme Quick-Switcher Features

- **Color previews** — See the theme's primary colors before switching
- **Font preview** — Theme names display in the theme's heading font
- **Current theme indicator** — The active theme shows a checkmark
- **Color mode options** — Quick access to light/dark/system modes
- **Instant switching** — Changes apply immediately
- **Mobile friendly** — Works on all screen sizes
- **Collapsible sidebar** — Icon-only view in collapsed sidebar mode

## Understanding Your Theme

### Color Scheme

Each theme includes colors for:

- **Background** — The main background color for pages and components
- **Foreground** — Text and primary content color
- **Primary** — Accent color for important UI elements, buttons, links
- **Secondary** — Additional accent color for supporting elements
- **Accent** — Highlight color for special elements
- **Muted** — Subtle colors for borders, dividers, and less important content
- **Destructive** — Warning/danger color for actions like delete
- **Success, Warning, Info** — Semantic colors for feedback messages

### Light and Dark Mode Support

Themes provide colors for both modes:

- **Light mode colors** — Optimized for bright backgrounds
- **Dark mode colors** — Optimized for dark backgrounds

When you switch your color mode, the same theme's colors for that mode apply automatically.

### Typography

Themes specify:

- **Heading font** — For titles and section headers
- **Body font** — For regular text and content
- **Monospace font** — For code and technical text

Custom fonts are loaded automatically when you select a theme.

## Managing Themes in Settings

### Appearance Settings

The **Appearance** tab in Settings gives you full control:

- **Theme Selection** — Choose from default and installed plugin themes
- **Theme Preview** — See how each theme looks
- **Color Mode** — Light, Dark, or System preference
- **Quick-Switcher Toggle** — Enable/disable the sidebar quick-switcher

### Theme Details

For each theme, you can see:

- **Theme name** — The display name of the theme
- **Description** — What makes this theme unique
- **Color preview** — Sample colors in the theme's palette
- **Dark mode support** — Whether the theme supports dark mode
- **Active indicator** — Shows which theme is currently active

### Previewing Themes

When viewing theme options:

1. Hover over a theme to see more details
2. Click to preview the theme in the background
3. See how colors look before committing
4. Switch back if you prefer a different theme

## Color Modes Explained

### System Mode (Recommended)

- **What it does** — Follows your computer's light/dark preference
- **When to use** — Most of the time; best for automatic consistency
- **How it works** — Quilltap detects your OS preference and switches automatically
- **Mobile** — Most phones default to light mode during day, dark at night

### Light Mode

- **When to use** — During daytime or in well-lit environments
- **Advantages** — Bright, clear interface; reduced eye strain in daylight
- **Note** — May cause glare on dark screens or in dim lighting

### Dark Mode

- **When to use** — At night or in low-light environments
- **Advantages** — Reduced blue light; comfortable for evening use
- **Note** — Some users prefer it all the time for comfort

## Custom Themes

### Installing Theme Plugins

Custom themes are distributed as npm packages:

1. Follow your plugin manager's instructions
2. Install the theme plugin
3. Restart Quilltap (if required)
4. The new theme appears in your theme list

### Creating Your Own Theme

If you're a developer, you can create custom themes:

- Use the theme development guide (see documentation)
- Define custom colors, fonts, and component styles
- Publish as an npm package for distribution
- Share with the community

See the [Theme Plugin Development Guide](docs/THEME_PLUGIN_DEVELOPMENT.md) for details.

## Tips for Theme Selection

1. **Try different themes** — Spend time with each to find your favorite
2. **Consider color mode** — Choose light for daytime, dark for evening, system for automatic
3. **Test readability** — Make sure text is easy to read in your preferred theme
4. **Match your workflow** — Some themes may feel better for different types of work
5. **Use quick-switcher** — Enable it if you like switching themes frequently
6. **Adjust sidebar width** — Combined with theme changes, this can transform your interface

## Theme Persistence

Your theme choices are saved automatically:

- **Theme preference** — Your selected theme is remembered
- **Color mode preference** — Light/dark/system choice is saved
- **Quick-switcher setting** — Whether it's enabled is remembered
- **Cross-device** — Preferences sync across devices when logged in

Every time you log in, Quilltap remembers your theme selections.

## Troubleshooting Themes

### Theme Not Appearing

- Ensure the theme plugin is installed
- Try refreshing the browser
- Check that the plugin is enabled in your system
- Look in Settings → Plugins to verify installation

### Colors Look Wrong

- Check your color mode (light/dark/system)
- Verify you've selected the theme you want
- Try switching to system mode
- Check if a browser extension is interfering

### Fonts Look Different

- Custom fonts take a moment to load
- If fonts don't appear, the fallback font is used
- Refresh if needed
- Check your browser's font rendering settings

### Theme Doesn't Save

- Check your internet connection
- Verify you're logged in
- Try switching themes again
- Check the browser console for errors

Themes are a powerful way to personalize Quilltap and make it work for your creative style and environment!

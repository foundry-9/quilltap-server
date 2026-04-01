# create-quilltap-theme

Scaffold a new Quilltap theme with a single command.

## Usage

### Bundle format (default, recommended)

```bash
npx create-quilltap-theme my-theme
```

This creates a `.qtap-theme` bundle directory — a simple, declarative format with JSON tokens, CSS, and fonts. No build tools, npm packages, or TypeScript required.

### Legacy plugin format (deprecated)

```bash
npx create-quilltap-theme my-theme --plugin
```

Creates an npm-based theme plugin. This format is deprecated; use bundles for new themes.

### Interactive mode

Run without arguments for interactive prompts:

```bash
npx create-quilltap-theme
```

### Skip prompts

Use `-y` or `--yes` to use defaults:

```bash
npx create-quilltap-theme my-theme --yes
```

## What gets created

### Bundle format (default)

```
my-theme/
├── theme.json            # Theme manifest with metadata and tokens
├── tokens.json           # Design tokens (colors, fonts, spacing)
├── styles.css            # CSS component overrides
├── fonts/                # Custom font files (add .woff2 files here)
└── README.md             # Documentation
```

### Plugin format (--plugin)

```
qtap-plugin-theme-my-theme/
├── package.json          # npm package configuration
├── manifest.json         # Quilltap plugin manifest
├── tokens.json           # Theme design tokens (colors, fonts, spacing)
├── index.ts              # Plugin entry point
├── styles.css            # CSS component overrides (optional)
├── tsconfig.json         # TypeScript configuration
├── esbuild.config.mjs    # Build configuration
├── README.md             # Documentation
├── .gitignore            # Git ignore rules
├── docs/                 # Development documentation
│   └── THEME_PLUGIN_DEVELOPMENT.md
└── .storybook/           # Storybook setup (optional)
    ├── main.ts
    ├── preview.ts
    └── ThemeProvider.tsx
```

## Options

| Option | Description |
|--------|-------------|
| `--plugin` | Create a legacy npm plugin instead of a bundle |
| `-y, --yes` | Skip prompts and use default values |
| `-h, --help` | Show help message |

## Interactive prompts

When run without `--yes`, you'll be asked:

1. **Theme name** - e.g., "sunset", "ocean-breeze"
2. **Description** - Brief description of your theme
3. **Author name** - Your name
4. **Author email** - Your email
5. **Primary color** - Main theme color in HSL format
6. **Include CSS overrides?** - Whether to create styles.css (bundle and plugin)
7. **Include Storybook?** - Whether to set up Storybook for development (plugin only)

## Next steps after scaffolding

### Bundle themes

```bash
cd my-theme
# Edit theme.json, tokens.json, and styles.css
# Then install into Quilltap:
npx quilltap themes install .
# Or validate first:
npx quilltap themes validate .
```

### Plugin themes (deprecated)

```bash
cd qtap-plugin-theme-my-theme
npm install
npm run build
npm publish --access public
```

## Managing themes via CLI

```bash
npx quilltap themes list                    # List all installed themes
npx quilltap themes install my.qtap-theme   # Install a bundle
npx quilltap themes validate my.qtap-theme  # Validate without installing
npx quilltap themes export earl-grey        # Export any theme as a bundle
npx quilltap themes search "dark"           # Search registries
npx quilltap themes update                  # Check for updates
```

## Documentation

For the latest online documentation:

- [Theme Plugin Development Guide](https://github.com/foundry-9/quilltap/blob/main/docs/developer/THEME_PLUGIN_DEVELOPMENT.md) (legacy plugin format)
- [Plugin Manifest Reference](https://github.com/foundry-9/quilltap/blob/main/docs/developer/PLUGIN_MANIFEST.md)
- [@quilltap/theme-storybook](https://www.npmjs.com/package/@quilltap/theme-storybook) (for plugin development with Storybook)

## License

MIT

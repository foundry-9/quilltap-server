# create-quilltap-theme

Scaffold a new Quilltap theme plugin with a single command.

## Usage

### Using npm init (recommended)

```bash
npm init quilltap-theme my-theme
```

### Using npx

```bash
npx create-quilltap-theme my-theme
```

### Interactive mode

Run without arguments for interactive prompts:

```bash
npm init quilltap-theme
```

### Skip prompts

Use `-y` or `--yes` to use defaults:

```bash
npm init quilltap-theme my-theme --yes
```

## What gets created

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
└── .storybook/           # Storybook setup (optional)
    ├── main.ts
    ├── preview.ts
    └── ThemeProvider.tsx
```

## Options

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip prompts and use default values |
| `-h, --help` | Show help message |

## Interactive prompts

When run without `--yes`, you'll be asked:

1. **Theme name** - e.g., "sunset", "ocean-breeze"
2. **Description** - Brief description of your theme
3. **Author name** - Your name
4. **Author email** - Your email
5. **Primary color** - Main theme color in HSL format
6. **Include CSS overrides?** - Whether to create styles.css
7. **Include Storybook?** - Whether to set up Storybook for development

## Next steps after scaffolding

```bash
cd qtap-plugin-theme-my-theme
npm install
npm run build
```

To preview in Storybook (if included):

```bash
npm run storybook
```

To publish:

```bash
npm publish --access public
```

## Documentation

- [Theme Plugin Development Guide](https://github.com/foundry-9/quilltap/blob/main/docs/THEME_PLUGIN_DEVELOPMENT.md)
- [Plugin Manifest Reference](https://github.com/foundry-9/quilltap/blob/main/docs/PLUGIN_MANIFEST.md)
- [@quilltap/theme-storybook](https://www.npmjs.com/package/@quilltap/theme-storybook)

## License

MIT

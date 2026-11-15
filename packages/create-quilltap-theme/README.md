# create-quilltap-theme

Scaffold a new Quilltap theme bundle with a single command.

## Usage

```bash
npx create-quilltap-theme my-theme          # Answer a few prompts
npx create-quilltap-theme my-theme --yes    # Take the defaults
npx create-quilltap-theme                   # Prompt for the name too
```

It writes a version 2 `.qtap-theme` bundle: declarative JSON and CSS, no build tools, npm packages or TypeScript. (The npm plugin theme format is no longer supported; `--plugin` is refused.)

## What gets created

```
my-theme/
├── theme.json      # Manifest (formatVersion 2), naming its JSON Schema
├── tokens.json     # A few primitives, token overrides in both modes, and density
├── styles.css      # A short stylesheet written against the app's hooks (optional)
└── README.md       # Where everything is documented
```

Both JSON files carry `$schema`, so an editor that reads JSON Schema completes and checks manifest fields, every token name and every choice.

## Options

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip prompts and use default values |
| `-h, --help` | Show help message |

## Interactive prompts

1. **Theme name** — e.g. "sunset", "ocean-breeze"
2. **Description**
3. **Author name**
4. **Author email** (optional)
5. **Primary colour** — any CSS colour
6. **Include a custom stylesheet?** — whether to write `styles.css`

## Next steps after scaffolding

```bash
npx quilltap themes validate ./my-theme
cd my-theme && zip -r ../my-theme.qtap-theme . && cd ..
npx quilltap themes install my-theme.qtap-theme
```

## Documentation

- [Theme authoring guide](https://github.com/foundry-9/quilltap-server/blob/main/docs/developer/THEME_DEVELOPMENT.md)
- [Token reference](https://github.com/foundry-9/quilltap-server/blob/main/docs/developer/THEME_TOKENS.md)
- [Hook reference](https://github.com/foundry-9/quilltap-server/blob/main/docs/developer/THEME_HOOKS.md)

## License

MIT

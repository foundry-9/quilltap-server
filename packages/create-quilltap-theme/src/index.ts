import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

interface ThemeConfig {
  themeName: string;
  packageName: string;
  themeId: string;
  displayName: string;
  description: string;
  authorName: string;
  authorEmail: string;
  primaryColor: string;
  includeCssOverrides: boolean;
  includeStorybook: boolean;
  mode: 'bundle' | 'plugin';
}

// Color output helpers
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

function log(message: string): void {
  console.log(message);
}

function success(message: string): void {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function info(message: string): void {
  console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
}

function error(message: string): void {
  console.error(`${colors.red}✗${colors.reset} ${message}`);
}

function heading(message: string): void {
  console.log(`\n${colors.bold}${colors.blue}${message}${colors.reset}\n`);
}

// Convert "My Cool Theme" to "my-cool-theme"
function toKebabCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Convert "my-cool-theme" to "My Cool Theme"
function toTitleCase(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Prompt for user input
function prompt(rl: readline.Interface, question: string, defaultValue?: string): Promise<string> {
  const displayDefault = defaultValue ? ` ${colors.dim}(${defaultValue})${colors.reset}` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${displayDefault}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

// Prompt for yes/no
function promptYesNo(
  rl: readline.Interface,
  question: string,
  defaultValue: boolean = true
): Promise<boolean> {
  const defaultStr = defaultValue ? 'Y/n' : 'y/N';
  return new Promise((resolve) => {
    rl.question(`${question} ${colors.dim}(${defaultStr})${colors.reset}: `, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === '') {
        resolve(defaultValue);
      } else {
        resolve(trimmed === 'y' || trimmed === 'yes');
      }
    });
  });
}

// Read template file and replace placeholders
function processTemplate(templatePath: string, config: ThemeConfig): string {
  const content = fs.readFileSync(templatePath, 'utf-8');
  return content
    .replace(/\{\{PACKAGE_NAME\}\}/g, config.packageName)
    .replace(/\{\{THEME_ID\}\}/g, config.themeId)
    .replace(/\{\{DISPLAY_NAME\}\}/g, config.displayName)
    .replace(/\{\{DESCRIPTION\}\}/g, config.description)
    .replace(/\{\{AUTHOR_NAME\}\}/g, config.authorName)
    .replace(/\{\{AUTHOR_EMAIL\}\}/g, config.authorEmail)
    .replace(/\{\{PRIMARY_COLOR\}\}/g, config.primaryColor);
}

// Copy and process a template file
function copyTemplate(
  templateName: string,
  destPath: string,
  config: ThemeConfig,
  destName?: string
): void {
  const templatePath = path.join(TEMPLATES_DIR, templateName);
  const finalDestPath = path.join(destPath, destName || templateName);

  if (!fs.existsSync(templatePath)) {
    error(`Template not found: ${templateName}`);
    return;
  }

  const content = processTemplate(templatePath, config);
  fs.writeFileSync(finalDestPath, content, 'utf-8');
}

// Scaffold a bundle theme (default mode)
async function scaffoldBundle(config: ThemeConfig): Promise<void> {
  const destPath = path.resolve(process.cwd(), config.themeId);

  if (fs.existsSync(destPath)) {
    error(`Directory "${config.themeId}" already exists.`);
    process.exit(1);
  }

  heading('Creating your Quilltap theme bundle...');

  fs.mkdirSync(destPath, { recursive: true });
  success(`Created ${config.themeId}/`);

  // theme.json manifest
  copyTemplate('bundle/theme.json.template', destPath, config, 'theme.json');
  success('Created theme.json');

  // tokens.json (reuse the same template)
  copyTemplate('tokens.json.template', destPath, config, 'tokens.json');
  success('Created tokens.json');

  // styles.css
  if (config.includeCssOverrides) {
    copyTemplate('bundle/styles.css.template', destPath, config, 'styles.css');
    success('Created styles.css');
  }

  // README
  copyTemplate('bundle/README.md.template', destPath, config, 'README.md');
  success('Created README.md');

  // Create fonts directory placeholder
  const fontsDir = path.join(destPath, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  fs.writeFileSync(
    path.join(fontsDir, '.gitkeep'),
    '# Place custom .woff2 font files here and reference them in theme.json\n',
    'utf-8'
  );
  success('Created fonts/');

  // Print next steps
  heading('Done! Next steps:');

  log(`  ${colors.dim}# Edit your theme:${colors.reset}`);
  log(`  ${colors.cyan}cd ${config.themeId}${colors.reset}`);
  log(`  ${colors.dim}# Edit tokens.json to customize colors, typography, and spacing${colors.reset}`);
  if (config.includeCssOverrides) {
    log(`  ${colors.dim}# Edit styles.css for advanced component styling${colors.reset}`);
  }

  log('');
  log(`  ${colors.dim}# To install in Quilltap:${colors.reset}`);
  log(`  ${colors.cyan}cd ${config.themeId} && zip -r ../${config.themeId}.qtap-theme .${colors.reset}`);
  log(`  ${colors.dim}# Then upload the .qtap-theme file in Settings > Appearance > Install Theme${colors.reset}`);

  log('');
  log(`  ${colors.dim}# Or install via CLI:${colors.reset}`);
  log(`  ${colors.cyan}quilltap themes install ${config.themeId}.qtap-theme${colors.reset}`);

  log('');
  log(`  ${colors.dim}# Validate your bundle:${colors.reset}`);
  log(`  ${colors.cyan}quilltap themes validate ${config.themeId}.qtap-theme${colors.reset}`);

  log('');
  info('No build tools required — just edit JSON and CSS files!');
  log('');
}

// Scaffold a plugin theme (legacy mode)
async function scaffoldPlugin(config: ThemeConfig): Promise<void> {
  const destPath = path.resolve(process.cwd(), config.themeName);

  if (fs.existsSync(destPath)) {
    error(`Directory "${config.themeName}" already exists.`);
    process.exit(1);
  }

  heading('Creating your Quilltap theme plugin...');
  log(`  ${colors.yellow}Note: npm plugin format is deprecated. Consider using bundle format instead.${colors.reset}`);
  log(`  ${colors.dim}Run without --plugin to create a .qtap-theme bundle.${colors.reset}`);
  log('');

  // Create directory structure
  fs.mkdirSync(destPath, { recursive: true });
  success(`Created ${config.themeName}/`);

  // Copy core files
  copyTemplate('package.json.template', destPath, config, 'package.json');
  success('Created package.json');

  copyTemplate('manifest.json.template', destPath, config, 'manifest.json');
  success('Created manifest.json');

  copyTemplate('tokens.json.template', destPath, config, 'tokens.json');
  success('Created tokens.json');

  copyTemplate('index.ts.template', destPath, config, 'index.ts');
  success('Created index.ts');

  copyTemplate('tsconfig.json.template', destPath, config, 'tsconfig.json');
  success('Created tsconfig.json');

  copyTemplate('esbuild.config.mjs.template', destPath, config, 'esbuild.config.mjs');
  success('Created esbuild.config.mjs');

  copyTemplate('README.md.template', destPath, config, 'README.md');
  success('Created README.md');

  copyTemplate('.gitignore.template', destPath, config, '.gitignore');
  success('Created .gitignore');

  // Create docs directory with development guide
  const docsDir = path.join(destPath, 'docs');
  fs.mkdirSync(docsDir, { recursive: true });
  copyTemplate('docs/THEME_PLUGIN_DEVELOPMENT.md.template', destPath, config, 'docs/THEME_PLUGIN_DEVELOPMENT.md');
  success('Created docs/THEME_PLUGIN_DEVELOPMENT.md');

  // Optional: CSS overrides
  if (config.includeCssOverrides) {
    copyTemplate('styles.css.template', destPath, config, 'styles.css');
    success('Created styles.css');
  }

  // Optional: Storybook setup
  if (config.includeStorybook) {
    const storybookDir = path.join(destPath, '.storybook');
    const storiesDir = path.join(destPath, 'stories');

    fs.mkdirSync(storybookDir, { recursive: true });
    fs.mkdirSync(storiesDir, { recursive: true });

    copyTemplate('storybook/main.ts.template', destPath, config, '.storybook/main.ts');
    copyTemplate('storybook/preview.ts.template', destPath, config, '.storybook/preview.ts');
    copyTemplate('storybook/ThemeProvider.tsx.template', destPath, config, '.storybook/ThemeProvider.tsx');
    copyTemplate('stories/Components.stories.tsx.template', destPath, config, 'stories/Components.stories.tsx');

    success('Created .storybook/main.ts');
    success('Created .storybook/preview.ts');
    success('Created .storybook/ThemeProvider.tsx');
    success('Created stories/Components.stories.tsx');
  }

  // Print next steps
  heading('Done! Next steps:');

  log(`  ${colors.cyan}cd ${config.themeName}${colors.reset}`);
  log(`  ${colors.cyan}npm install${colors.reset}`);
  log(`  ${colors.cyan}npm run build${colors.reset}`);

  if (config.includeStorybook) {
    log('');
    log(`  ${colors.dim}# To preview your theme in Storybook:${colors.reset}`);
    log(`  ${colors.cyan}npm run storybook${colors.reset}`);
  }

  log('');
  log(`  ${colors.dim}# Edit tokens.json to customize your theme colors${colors.reset}`);
  if (config.includeCssOverrides) {
    log(`  ${colors.dim}# Edit styles.css for advanced component styling${colors.reset}`);
  }

  log('');
  log(`  ${colors.dim}# When ready to publish:${colors.reset}`);
  log(`  ${colors.cyan}npm publish --access public${colors.reset}`);

  log('');
  info(`Local documentation: docs/THEME_PLUGIN_DEVELOPMENT.md`);
  info(`Online documentation: https://github.com/foundry-9/quilltap/blob/main/docs/THEME_PLUGIN_DEVELOPMENT.md`);
  log('');
}

// Parse command line arguments
function parseArgs(): { themeName?: string; help: boolean; yes: boolean; plugin: boolean } {
  const args = process.argv.slice(2);
  let themeName: string | undefined;
  let help = false;
  let yes = false;
  let plugin = false;

  for (const arg of args) {
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '-y' || arg === '--yes') {
      yes = true;
    } else if (arg === '--plugin') {
      plugin = true;
    } else if (!arg.startsWith('-')) {
      themeName = arg;
    }
  }

  return { themeName, help, yes, plugin };
}

// Show help
function showHelp(): void {
  log(`
${colors.bold}create-quilltap-theme${colors.reset} - Scaffold a new Quilltap theme

${colors.bold}Usage:${colors.reset}
  npm init quilltap-theme [theme-name] [options]
  npx create-quilltap-theme [theme-name] [options]

${colors.bold}Arguments:${colors.reset}
  theme-name    Name for your theme (e.g., "sunset", "ocean-breeze")

${colors.bold}Options:${colors.reset}
  -y, --yes       Skip prompts and use defaults
  --plugin        Create an npm plugin theme (deprecated, use bundle instead)
  -h, --help      Show this help message

${colors.bold}Examples:${colors.reset}
  npm init quilltap-theme my-theme          # Create a .qtap-theme bundle (recommended)
  npx create-quilltap-theme sunset --yes    # Bundle with defaults
  npx create-quilltap-theme sunset --plugin # Legacy npm plugin format

${colors.bold}Bundle format (default):${colors.reset}
  <theme-name>/
  ├── theme.json      # Theme manifest
  ├── tokens.json     # Design tokens
  ├── styles.css      # CSS overrides (optional)
  ├── fonts/          # Custom fonts (optional)
  └── README.md       # Documentation

  No build tools required! Just edit JSON/CSS and zip to install.

${colors.bold}Plugin format (deprecated):${colors.reset}
  qtap-plugin-theme-<name>/
  ├── package.json, manifest.json, index.ts, tokens.json, ...
  Requires npm, esbuild, TypeScript. Use --plugin flag.
`);
}

// Main entry point
async function main(): Promise<void> {
  const { themeName: argThemeName, help, yes, plugin } = parseArgs();

  if (help) {
    showHelp();
    process.exit(0);
  }

  const mode = plugin ? 'plugin' : 'bundle';

  log('');
  log(`${colors.bold}${colors.blue}  create-quilltap-theme${colors.reset}`);
  if (mode === 'bundle') {
    log(`${colors.dim}  Scaffold a new Quilltap theme bundle (.qtap-theme)${colors.reset}`);
  } else {
    log(`${colors.dim}  Scaffold a new Quilltap theme plugin ${colors.yellow}(deprecated)${colors.reset}`);
  }
  log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Get theme name
    let themeName = argThemeName;
    if (!themeName && !yes) {
      themeName = await prompt(rl, 'Theme name (e.g., sunset, ocean-breeze)', 'my-theme');
    }
    themeName = themeName || 'my-theme';

    // Normalize the theme name
    const themeId = toKebabCase(themeName);
    const packageName = `qtap-plugin-theme-${themeId}`;
    const displayName = toTitleCase(themeId);

    // Get other details
    let description: string;
    let authorName: string;
    let authorEmail: string;
    let primaryColor: string;
    let includeCssOverrides: boolean;
    let includeStorybook: boolean;

    if (yes) {
      // Use defaults
      description = `A custom theme for Quilltap`;
      authorName = 'Your Name';
      authorEmail = 'you@example.com';
      primaryColor = 'hsl(220 90% 50%)';
      includeCssOverrides = true;
      includeStorybook = false;
    } else {
      description = await prompt(rl, 'Description', `A custom theme for Quilltap`);
      authorName = await prompt(rl, 'Author name', 'Your Name');
      authorEmail = await prompt(rl, 'Author email', 'you@example.com');
      primaryColor = await prompt(rl, 'Primary color (HSL)', 'hsl(220 90% 50%)');
      includeCssOverrides = await promptYesNo(rl, 'Include CSS overrides (styles.css)?', true);
      includeStorybook = mode === 'plugin' ? await promptYesNo(rl, 'Include Storybook setup?', false) : false;
    }

    const config: ThemeConfig = {
      themeName: mode === 'bundle' ? themeId : packageName,
      packageName,
      themeId,
      displayName,
      description,
      authorName,
      authorEmail,
      primaryColor,
      includeCssOverrides,
      includeStorybook,
      mode,
    };

    if (mode === 'bundle') {
      await scaffoldBundle(config);
    } else {
      await scaffoldPlugin(config);
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});

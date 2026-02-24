# Quilltap

**Self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who wants an AI assistant that actually knows what they're working on.**

Run Quilltap as a local Node.js server with zero configuration.

## Quick Start

```bash
npm install -g quilltap
quilltap
```

Then open [http://localhost:3000](http://localhost:3000).

On first run, the CLI downloads the application files (~150-250 MB compressed) and caches them locally. Subsequent launches start instantly.

## Installation

### Install globally (recommended)

```bash
npm install -g quilltap
quilltap
```

### Run directly (no install)

```bash
npx quilltap
```

## Usage

```
quilltap [options]

Options:
  -p, --port <number>     Port to listen on (default: 3000)
  -d, --data-dir <path>   Data directory (default: platform-specific)
  -o, --open              Open browser after server starts
  -v, --version           Show version number
  --update                Force re-download of application files
  -h, --help              Show this help message
```

### Examples

```bash
# Start on default port 3000
quilltap

# Start on a custom port
quilltap --port 8080

# Use a custom data directory
quilltap --data-dir /mnt/data/quilltap

# Start and open browser automatically
quilltap --open

# Force re-download after a manual update
quilltap --update
```

## How It Works

The `quilltap` npm package is a lightweight CLI launcher (~10 KB). On first run, it downloads the pre-built application from [GitHub Releases](https://github.com/foundry-9/quilltap/releases) and caches it in a platform-specific directory. Native modules (`better-sqlite3`, `sharp`) are compiled for your platform when you install the npm package.

### Cache Locations

| Platform | Cache Directory |
| --- | --- |
| macOS | `~/Library/Caches/Quilltap/standalone/` |
| Linux | `~/.cache/quilltap/standalone/` |
| Windows | `%LOCALAPPDATA%\Quilltap\standalone\` |

When you upgrade to a new version (`npm update -g quilltap`), the next run detects the version mismatch and downloads the matching application files automatically.

## Data Directory

Quilltap stores its database, files, and logs in a platform-specific directory:

| Platform | Default Location |
| --- | --- |
| macOS | `~/Library/Application Support/Quilltap` |
| Linux | `~/.quilltap` |
| Windows | `%APPDATA%\Quilltap` |

Override with `--data-dir` or the `QUILLTAP_DATA_DIR` environment variable.

## Requirements

- Node.js 18 or later

## Other Ways to Run Quilltap

- **Electron desktop app** (macOS, Windows) - [Download](https://github.com/foundry-9/quilltap/releases)
- **Docker** - `docker run -d -p 3000:3000 -v /path/to/data:/app/quilltap csebold/quilltap`

## Links

- **Website:** [quilltap.ai](https://quilltap.ai)
- **GitHub:** [github.com/foundry-9/quilltap](https://github.com/foundry-9/quilltap)
- **Issues:** [github.com/foundry-9/quilltap/issues](https://github.com/foundry-9/quilltap/issues)

## License

MIT

# Quilltap

**Self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who wants an AI assistant that actually knows what they're working on.**

Run Quilltap as a local Node.js server with zero configuration.

## Quick Start

```bash
npx quilltap
```

Then open [http://localhost:3000](http://localhost:3000).

## Installation

### Run directly (no install)

```bash
npx quilltap
```

### Install globally

```bash
npm install -g quilltap
quilltap
```

## Usage

```
quilltap [options]

Options:
  -p, --port <number>     Port to listen on (default: 3000)
  -d, --data-dir <path>   Data directory (default: platform-specific)
  -o, --open              Open browser after server starts
  -v, --version           Show version number
  -h, --help              Show this help message
```

### Examples

```bash
# Start on default port 3000
npx quilltap

# Start on a custom port
npx quilltap --port 8080

# Use a custom data directory
npx quilltap --data-dir /mnt/data/quilltap

# Start and open browser automatically
npx quilltap --open
```

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

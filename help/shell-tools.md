---
url: /salon/:id
---

# Shell Tools

## The Workshop at the Heart of the Machine

Imagine, if you will, a workshop tucked away in the basement of a grand estate — accessible only through a locked door whose key is held by the estate's most trusted mechanist. This is the Shell Tools system: a sandboxed workspace where your AI assistant can roll up its sleeves and do *real work* — running commands, installing packages, building projects, and generally making itself useful in ways that mere conversation cannot achieve.

## When Are Shell Tools Available?

Shell tools appear only when Quilltap is running inside a sandboxed environment — specifically, a Lima virtual machine (on macOS) or a Docker container. If you're running Quilltap via `npx` or directly in Node.js, shell tools will not appear, as there is no sandbox to contain them.

Think of it as a simple rule of propriety: one does not allow the butler to rearrange the furniture unless there are walls to contain the resulting chaos.

## The Tools

### Change Directory (chdir)

Navigates to a directory within the workspace. If no path is provided, returns to the default workspace directory for the current chat or project. Creates directories as needed — no fumbling about in the dark.

### Shell Command (exec_sync)

Executes a command and waits for it to complete, returning the output, errors, and exit code. This is the workhorse of the toolkit — use it for anything that finishes in a reasonable amount of time (up to 5 minutes, though the default timeout is a civilized 60 seconds).

### Background Command (exec_async)

Launches a command in the background and returns immediately with a process ID. Useful for long-running operations like builds, downloads, or anything that might take its time — rather like sending a telegram and not waiting by the door for the reply.

### Process Status (async_result)

Checks on the status of a previously launched background command. Returns whether it's still running, complete, or has timed out, along with any captured output.

### Sudo Command (sudo_sync)

Executes a command with elevated privileges — the digital equivalent of handing someone the master key to the estate. Because this grants root access within the VM, **you will always be asked to approve sudo commands before they execute**. The approval modal will show you exactly what command is proposed, giving you the opportunity to accept or decline.

### File Transfer (cp_host)

Copies files between the workspace and Quilltap's Files storage system. When copying *from* the workspace *to* Files, security filters are applied: binary executables are rejected, and execute bits are stripped. When copying *from* Files *to* the workspace, files are delivered as-is.

## The Workspace

Each chat (or project) gets its own directory within the workspace. This directory persists across messages within a session but should be considered a scratch space — it exists for getting work done, not for permanent storage. Files you want to keep should be transferred to the Files system using the cp_host tool.

The workspace is shared between the VM and your host machine. This means files created by the AI are visible on your host, and vice versa. This is by design — but it also means you should treat workspace contents with appropriate caution.

## Security Protections

### What the Sandbox Provides

The VM itself is the primary security boundary. Commands execute inside the virtual machine, not on your host. Even if something goes spectacularly wrong inside the VM, your host system remains unaffected (aside from needing to restart the VM, which is rather like rebooting a particularly stubborn gramophone).

### Workspace File Protections

Files crossing from the VM to your host undergo several protective measures:

- **Binary executables are blocked**: Files matching ELF (Linux), PE (Windows), or Mach-O (macOS) executable formats are automatically deleted
- **Execute bits are stripped**: All files have their execute permissions removed
- **OS quarantine markers are applied**: On macOS, files receive the `com.apple.quarantine` attribute; on Windows, the Zone.Identifier mark is set — ensuring your operating system will warn you before executing anything from the workspace

### Command Warnings

Certain commands trigger warnings (but are not blocked) — for instance, attempts to SSH to the host gateway, recursive deletions, or piping downloads directly to a shell. These warnings appear in the tool result and are logged for your review.

### What This Does Not Protect Against

No security system can protect against everything, and honesty about limitations is preferable to false assurance:

- **Data exfiltration**: Text files or archives containing encoded sensitive data cannot be distinguished from legitimate output at the filter layer
- **Inbound file risks**: Files you place in the workspace are accessible to the AI inside the VM — don't drop anything in there you wouldn't want an AI to read

## A Note on Installed Packages

Here is a truth that bears stating plainly, lest it catch you off guard like an unexpected plot twist in the third act: **packages installed inside the VM or Docker container do not survive a restart**.

When you ask the AI to install something via `apt-get install`, that package lives in the container's ephemeral layer — rather like chalk writing on a pavement before the rain. Stop the container, and the slate is wiped clean. The same applies to Lima VMs if the VM is recreated, though Lima VMs are somewhat more durable in practice, persisting through ordinary restarts and only losing their state when explicitly deleted or rebuilt.

Your **workspace files**, being stored on a mounted volume, survive perfectly well through restarts. It is only the system-level changes — installed binaries, configuration files tucked into `/etc/`, libraries deposited in `/usr/lib/` — that vanish.

If you find yourself repeatedly needing the same packages, consider:

- **Keeping a setup script in your workspace** — a small shell script that reinstalls your dependencies, which the AI can run at the start of each session
- **Building a custom Docker image** — for more permanent arrangements, bake your required packages into a derived image

## How Sudo Approval Works

When the AI needs elevated privileges (typically for package installation or system configuration), it sends a sudo command request. This appears as a modal dialog showing:

1. The exact command proposed
2. A warning about elevated privileges
3. Approve and Deny buttons

The command will **not execute** until you click Approve. If you click Deny, the AI is informed that its request was declined and can attempt an alternative approach.

## Workspace Acknowledgement

The first time shell tools are used in a chat, you'll see a workspace acknowledgement dialog. This is a one-time notice ensuring you understand the nature of the shared workspace. Once acknowledged, it won't appear again for that chat.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

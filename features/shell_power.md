# Feature Request: Shell Interactivity

If an LLM can run tools (or pseudo-tools), and it's running in a Docker image or VM, then it can run shell commands.

## Features

- Sandboxed (it can't completely hose the VM unless you give it the power to do so)
- Capable of sudo commands (again, each one needs to be gated by the user)
  - Can install and update `apk` packages (assuming we're still on Alpine)
- uses a special mounted directory in the data directory, like `~/.quilltap/workspace`
  - Untrusted directory, marked that way in host-OS-specific ways (see [Protection](#protection-for-workspace-directory-from-host))
  - A bidirectional rsync is always fired when the directory changes on either side
- Only runs in the chat directory (if it's in a bare chat in general space) or in the project directory (if it's in a project) - if that directory does not exist then it must be created, if possible, before any of the tools below run
- Is capable of making directories and files
- Is capable of reading files from the "Files" mount-point and functionality of this project or chat and then writing them into its space on the VM - these are not carefully vetted, by design
- Is capable of writing files from its space on the VM into the "Files" mount-point and functionality of this project - these are forced through our maximum protection filters (see [Protection](#protection-for-workspace-directory-from-host))
- Can run any utility that exists on the VM for users, or that it creates using compilers or scripting languages, on the VM
- Can specifically use git to check out repositories and run git commands on them
- Can run ssh to connect to other systems, for example to forward ports, to use for Git access, etc.
  - Should almost certainly be blocked from ssh-ing into the host system
- async commands all record a pid internally so that the usage of asynchronous commands can be tracked throughout a session's lifetime

## Protection for Workspace Directory from Host

The workspace directory (`~/.quilltap/workspace` or equivalent) is an **untrusted boundary** between the VM and the host filesystem. It must be treated as potentially hostile — anything written into it by the LLM or VM environment should be assumed to be unvetted, regardless of the model or provider in use. This is not just a prompt injection concern; any LLM, including those accessed via third-party plugins or OpenAI-compatible endpoints, may produce output that is dangerous to execute on the host.

### Sync Behavior

A bidirectional rsync daemon monitors both sides of the workspace mount and pushes changes across when detected. All sync operations — in both directions — pass through a filter layer that enforces the following rules:

- **Execute bits are stripped** from all files crossing from VM to host
- **Binary files are rejected** at the boundary — files whose headers match known executable formats (ELF, PE, Mach-O) are blocked and logged, not synced
- **All sync events are logged** with file name, direction, timestamp, and filter result, providing an audit trail of workspace activity

### Host OS Quarantine Markers

Files arriving on the host side of the workspace are marked as untrusted using host-OS-specific mechanisms:

- **macOS**: The `com.apple.quarantine` extended attribute is applied to all incoming files. This causes Gatekeeper to prompt the user before any such file is executed.
- **Windows**: The Mark of the Web (`Zone.Identifier` NTFS alternate data stream, `ZoneId=3`) is written to all incoming files. This causes Windows SmartScreen to warn the user before execution.
- **Linux**: Execute bits are stripped from all incoming files. No additional quarantine mechanism is applied.

These measures are not hard blocks — a determined user can bypass them — but they ensure the host OS raises a visible warning before anything from the workspace is executed.

### User Acknowledgement

When a directory is first attached to a Quilltap environment, the user must acknowledge that:

- The attached directory is a shared scratch space between the host and the VM
- Anything can happen in this directory — files may be created, modified, or deleted by the LLM
- The directory and its contents should not be trusted for execution without manual review
- The LLM cannot `cd` outside of its mounted scope within the VM, but files it produces may still be harmful if executed on the host

This acknowledgement is shown once per attached directory and is stored so it is not repeated unnecessarily.

### What This Does Not Protect Against

- **Data exfiltration via encoded content**: A zip file or text file containing base64-encoded sensitive data is indistinguishable from legitimate output at the filter layer. User awareness and directory hygiene are the primary mitigations here.
- **Malicious content in inbound files**: Files dropped into the workspace from the host side are delivered into the VM. Users should not place files in the workspace directory that they would not want an LLM to read or execute.

## Defaults

- timeout_default: 60000 (number, milliseconds, default = 1 minute)
- timeout_max: 300000 (number, milliseconds, default = 5 minutes)

## Interfaces

- command_request: `{command: string, timeout_ms?: number, parameters?: string[])` - runs a command and waits for it to complete for up to timeout_ms milliseconds; if timeout_ms == 0 or is null or undefined then it is `timeout_default`
  - timeout_ms can not exceed timeout_max
- command_result: `{exit_code: number; stdout: string; stderr: string; time_elapsed: number}` where `time_elapsed` is measured in milliseconds
- async_command_result: `{pid: number; status: "running"|"complete"|"timeout"|"not_found", stdout: string|stream|null; stderr: string|stream|null}`
  - If it's running then it returns streams, if it's not then it returns strings, if it isn't in the database of PIDs of async commands then they return nulls

## Tools (only available in Docker/VM and only if allowed by tool gating that already exists)

- `chdir(path?)` - changes directory for context of this chat; path is optional, will default to chat default directory if null/undefined/blank, otherwise changes to directory if it exists and returns `command_result`
- `exec_sync(command: command_request)` - runs a command and waits for it to complete for up to timeout_ms milliseconds
  - returns `command_result`
- `exec_async(command: command_request)` - runs a command in the background and does not wait for it to complete before returning
  - returns `async_command_result`
- `async_result(pid)` - fetches the result of the asynchronous execution
  - returns `async_command_result`
- `sudo_sync(command: command_request)` - runs a command as superuser for up timeout_ms milliseconds
  - **must be verified by user before running in the front-end**
  - returns `command_result`
- `cp_host(source, destination)` - copies a file from workspace to "Files" area
  (which is not the workspace, and has an entry in the database and metadata), or
  vice versa
  - Workspace → Files copies are subject to protection filters (see Protection)
  - returns `command_result`
  
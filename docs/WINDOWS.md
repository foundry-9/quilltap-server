# Windows Troubleshooting Guide

This document covers common issues when running Quilltap on Windows via the Electron desktop app.

## Architecture

On Windows, the Quilltap Electron app runs the backend inside a WSL2 (Windows Subsystem for Linux 2) distro. WSL2 is built into Windows 10 version 2004+ and Windows 11.

```text
Electron (Windows host) → WSL2 distro "quilltap" (Alpine Linux x86_64)
                            ↕ /mnt/c/ auto-mount for file sharing
                            ↕ WSL2 automatic localhost forwarding (port 5050)
```

## Prerequisites

### Installing WSL2

WSL2 must be enabled before Quilltap can run. Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

Restart your computer when prompted. After restart, verify WSL2 is working:

```powershell
wsl --status
```

If Quilltap starts and shows "WSL2 is not installed", this is what you need to fix.

## Common Issues

### "WSL2 is not installed" error on startup

**Cause:** WSL2 is not enabled or not properly configured.

**Fix:**
1. Open PowerShell as Administrator
2. Run `wsl --install`
3. Restart your computer
4. Run `wsl --status` to verify

### Quilltap distro won't start

**Check distro status:**
```powershell
wsl --list --verbose
```

You should see a `quilltap` entry. If it shows "Stopped", Quilltap will start it automatically. If it's missing, Quilltap will import it on next launch.

**Force re-import:**
```powershell
# Remove the existing distro (WARNING: deletes data inside the distro)
wsl --unregister quilltap

# Relaunch Quilltap — it will re-import the rootfs
```

### Server not responding after startup

**Check if the process is running inside WSL2:**
```powershell
wsl -d quilltap --exec ps aux
```

**Check the logs:**
```powershell
wsl -d quilltap --exec tail -50 /tmp/quilltap-stdout.log
```

### Data not persisting between sessions

Quilltap stores data in `%APPDATA%\Quilltap` on Windows. This directory is passed into WSL2 as an environment variable and accessed via `/mnt/c/Users/<you>/AppData/Roaming/Quilltap/` inside the distro.

**Verify the data directory exists:**
```powershell
dir %APPDATA%\Quilltap
```

You should see `data/`, `files/`, `logs/`, and `plugins/` subdirectories.

### Port 5050 already in use

If another application is using port 5050, Quilltap won't be able to start.

**Find what's using the port:**
```powershell
netstat -ano | findstr :5050
```

**Fix:** Stop the conflicting application, or configure Quilltap to use a different port (not yet supported — planned for future release).

## Data Locations

| What | Windows Path |
| --- | --- |
| App data (database, files, logs) | `%APPDATA%\Quilltap\` |
| Rootfs cache | `%LOCALAPPDATA%\Quilltap\vm-images\` |
| WSL2 distro (ext4 vhdx) | `~\.qtvm\quilltap\` |
| Electron app | Wherever the installer put it (default: `%LOCALAPPDATA%\Programs\Quilltap\`) |

## Manual Operations

### View WSL2 distro status
```powershell
wsl --list --verbose
```

### Stop the Quilltap distro
```powershell
wsl --terminate quilltap
```

### Remove and reinstall the distro
```powershell
wsl --unregister quilltap
# Relaunch Quilltap to re-import
```

### Access the distro shell
```powershell
wsl -d quilltap
```

### View logs from inside the distro
```powershell
wsl -d quilltap --exec tail -100 /tmp/quilltap-stdout.log
```

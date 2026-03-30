# Quilltap Changelog

## Recent Changes

### 4.0-dev

- refactor: remove Electron build infrastructure, Lima/WSL VM management, and rootfs tarball creation from this repository
- refactor: Electron desktop app moved to separate repository (quilltap-shell)
- ci: remove csebold/quilltap Docker registry; only foundry9/quilltap is published
- ci: simplify release workflow to produce standalone tarball, Docker images, and npm package
- ci: make Windows Electron build optional in release workflow
- chore: update npm dependencies across root, packages, and plugins

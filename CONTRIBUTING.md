# Contribution guidelines

When contributing to Wellread, whether on GitHub or in other community spaces:

- Be respectful, civil, and open-minded.
- Before opening a new pull request, search the [issue tracker](https://github.com/lima1217/wellread/issues) for known issues or fixes.
- If you want code changes based on personal preference, open an issue first describing the change. Open a pull request only after maintainers approve the direction.

## How to contribute

### Prerequisites

To avoid implementing a change that was already declined or is not needed, start by [opening an issue](https://github.com/lima1217/wellread/issues/new/choose) that describes the problem you want to solve.

To build Wellread locally, use a recent Node.js and Rust toolchain. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for platform-specific setup.

Install or update:

- **Node.js** and **pnpm** for Next.js
- **Rust** and **Cargo** for Tauri

```bash
nvm install v24
nvm use v24
npm install -g pnpm
rustup update
```

## Getting started

Clone and build the project with the steps below.

### 1. Clone the repository

```bash
git clone https://github.com/lima1217/wellread.git
cd wellread
```

### 2. Install dependencies

```bash
# Rerun when submodules change
git submodule update --init --recursive
pnpm install
# Copy vendor dist libs into the public directory
pnpm --filter @wellread/wellread-app setup-vendors
```

Confirm Tauri dependencies with:

```bash
pnpm tauri info
```

The output depends on your OS and toolchain. Review it for missing tools.

#### Using Nix

If you have Nix, use the included flake to enter a development shell:

```bash
nix develop ./ops          # web app
```

### 3. Build for development

```bash
# Tauri desktop app (macOS)
pnpm tauri dev
# Web app
pnpm dev-web
# Preview an OpenNext web build
pnpm preview
```

### 4. Build for production

```bash
# macOS aarch64 app bundle (includes eve-sidecar)
pnpm build-macos-aarch64
```

Wellread ships macOS only. Other desktop/mobile packaging paths have been removed.

### 5. More information

See the project [wiki](https://github.com/lima1217/wellread/wiki) for additional development notes.

## Implement your changes

This repository is a monorepo. App code lives in `apps/readest-app` (package `@wellread/wellread-app`). Useful frontend-only scripts:

| Command | Description |
| ------- | ----------- |
| `pnpm dev-web` | Starts the web app without compiling Tauri |
| `pnpm build-web` | Builds the web app |

### Editor-specific setup

#### VS Code

On open, install the recommended extensions if prompted:

- JavaScript and TypeScript Nightly (`ms-vscode.vscode-typescript-next`)
- ESLint (`dbaeumer.vscode-eslint`)
- Biome (`biomejs.biome`)
- rust-analyzer (`rust-lang.rust-analyzer`) for Tauri work

#### Zed

Install [biome-zed](https://github.com/biomejs/biome-zed) for formatting and linting.

### When you’re done

Check style and types:

```bash
pnpm build
```

Also run a manual functional check of your change. Then open a pull request with a clear title and body.

## Credits

This document was inspired by the contributing guidelines for [cloudflare/wrangler2](https://github.com/cloudflare/wrangler2/blob/main/CONTRIBUTING.md).

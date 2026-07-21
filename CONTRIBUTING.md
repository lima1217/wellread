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

For Windows targets, install “Build Tools for Visual Studio 2022” (or a higher Visual Studio edition) with the “Desktop development with C++” workflow. For Windows ARM64, also install “VS 2022 C++ ARM64 build tools” and “C++ Clang Compiler for Windows”. Ensure `clang` is on `Path`, for example `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\Llvm\x64\bin`.

#### Using Nix

If you have Nix, use the included flake to enter a development shell:

```bash
nix develop ./ops          # web app
nix develop ./ops#ios      # iOS app
nix develop ./ops#android  # Android app
```

### 3. Build for development

```bash
# Tauri app
pnpm tauri dev
# Web app
pnpm dev-web
# Preview an OpenNext web build
pnpm preview
```

#### Android

Run once before the Android app (the Nix Android shell does this for you):

```bash
rm apps/readest-app/src-tauri/gen/android
pnpm tauri android init
pnpm tauri icon ../../data/icons/readest-book.png
git checkout apps/readest-app/src-tauri/gen/android
```

Then run:

```bash
pnpm tauri android dev
# Real device
pnpm tauri android dev --host
```

#### iOS

```bash
# One-time setup
pnpm tauri ios init
pnpm tauri icon ../../data/icons/readest-book.png

pnpm tauri ios dev
# Real device
pnpm tauri ios dev --host
```

### 4. Build for production

```bash
pnpm tauri build
pnpm tauri android build
pnpm tauri ios build
```

If builds fail, compare your steps with the release workflow: [`.github/workflows/release.yml`](https://github.com/lima1217/wellread/blob/main/.github/workflows/release.yml).

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

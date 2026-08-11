# macOS Release Playbook

How to build and publish Wellread for macOS (Apple Silicon + Intel) from an Apple Silicon machine.

> **Build output location:** the root `Cargo.toml` is a workspace whose members
> include `apps/readest-app/src-tauri`, so Cargo puts all build output in the
> **repo root `target/`** (not `src-tauri/target`). Every `target/...` path in
> this playbook is relative to the repo root; commands that run from
> `apps/readest-app` use a `../../target/...` prefix.

> **tl;dr** — bump version → build both arches → sign updater bundles → build DMGs → commit & tag → create GitHub Release. Full details below.

## Prerequisites (one-time)

| Requirement | How to get it |
| --- | --- |
| `rustup` (with `x86_64-apple-darwin` target) | `brew install rustup`, then `export PATH="/opt/homebrew/opt/rustup/bin:$PATH"`, then `rustup target add x86_64-apple-darwin` |
| Tauri signing private key | Already at `.secrets/wellread.key` (gitignored). Password is empty (`TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""`) |
| GitHub CLI (`gh`) | `brew install gh`, then `gh auth login` |
| `create-dmg` (optional, for Finder layout) | `brew install create-dmg` |

Verify targets before building:

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
rustup target list --installed
# expect both: aarch64-apple-darwin, x86_64-apple-darwin
```

## Step-by-step

### 1. Bump version

Three files carry the version number:

```bash
# apps/readest-app/package.json
"version": "1.2.4",

# apps/readest-app/src-tauri/Cargo.toml
version = "1.2.4"
```

`Cargo.lock` updates automatically on next build. `tauri.conf.json` reads version from `package.json` (`"version": "../package.json"`), so no change needed there.

### 2. Add release notes

Prepend a new entry to `apps/readest-app/release-notes.json`:

```json
{
  "releases": {
    "1.2.4": {
      "date": "2026-08-10",
      "notes": [
        "Assistant: ...",
        "Sidecar: ..."
      ]
    },
    "1.2.3": { ... }
  }
}
```

The date should be the release day (today). The `notes` array items are user-facing changelog bullets. Derive them from `git log v1.2.3..HEAD --oneline`.

### 3. Build eve-sidecar

```bash
cd apps/readest-app
pnpm --dir ../eve-sidecar build
```

This produces `apps/eve-sidecar/.output/`, which Tauri bundles into the app as a resource.

### 4. Build app bundles (`.app` + `.app.tar.gz`)

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
cd apps/readest-app

# Apple Silicon
pnpm tauri build --target aarch64-apple-darwin --bundles app

# Intel (cross-compile)
pnpm tauri build --target x86_64-apple-darwin --bundles app
```

Output locations:

```
target/aarch64-apple-darwin/release/bundle/macos/Wellread.app
target/aarch64-apple-darwin/release/bundle/macos/Wellread.app.tar.gz
target/x86_64-apple-darwin/release/bundle/macos/Wellread.app
target/x86_64-apple-darwin/release/bundle/macos/Wellread.app.tar.gz
```

Repo-root paths; from `apps/readest-app` they are `../../target/...`.

> **Expected warning:** the build prints `A public key has been found, but no private key` and exits with code 1. This is fine — the `.app` and `.app.tar.gz` are already built. The signing step is handled separately in Step 5.

> **Build time:** ~10 min for aarch64 (first build), ~1 min for x64 (second build reuses most deps). Both use the `release` profile.

### 5. Sign updater bundles (`.sig`)

The signing key lives at `.secrets/wellread.key`. It has an empty password.

```bash
export PATH="/opt/homebrew/opt/rustup/bin:$PATH"
cd apps/readest-app

export SIGN_KEY=$(cat ../../.secrets/wellread.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

TAURI_SIGNING_PRIVATE_KEY="$SIGN_KEY" pnpm tauri signer sign \
  ../../target/aarch64-apple-darwin/release/bundle/macos/Wellread.app.tar.gz

TAURI_SIGNING_PRIVATE_KEY="$SIGN_KEY" pnpm tauri signer sign \
  ../../target/x86_64-apple-darwin/release/bundle/macos/Wellread.app.tar.gz
```

Each command writes a `.sig` file next to the `.tar.gz`.

### 6. Build DMGs

**macOS 26 note:** `tauri build --bundles dmg` calls an embedded `create-dmg` script that runs an AppleScript to arrange icons in Finder. On macOS 26 this AppleScript times out (`AppleEvent timed out -1712`) unless the terminal has Automation permission for Finder. The workaround is `hdiutil`:

```bash
# Prepare clean source folders (app + Applications symlink)
mkdir -p /tmp/wellread-dmg-aarch64 /tmp/wellread-dmg-x64
cp -R ../../target/aarch64-apple-darwin/release/bundle/macos/Wellread.app /tmp/wellread-dmg-aarch64/
cp -R ../../target/x86_64-apple-darwin/release/bundle/macos/Wellread.app /tmp/wellread-dmg-x64/

# Create DMGs
mkdir -p ../../target/aarch64-apple-darwin/release/bundle/dmg
hdiutil create -volname "Wellread" -fs HFS+ \
  -srcfolder /tmp/wellread-dmg-aarch64 -ov -format UDZO \
  "../../target/aarch64-apple-darwin/release/bundle/dmg/Wellread_1.2.4_aarch64.dmg"

hdiutil create -volname "Wellread" -fs HFS+ \
  -srcfolder /tmp/wellread-dmg-x64 -ov -format UDZO \
  "../../target/x86_64-apple-darwin/release/bundle/dmg/Wellread_1.2.4_x64.dmg"
```

> The `hdiutil` DMGs are functionally identical to `create-dmg` output but lack the Finder icon layout (no drag-to-Applications arrow). Users see a standard file list. This is cosmetic.

> **To get Finder layout back:** System Settings → Privacy & Security → Automation → grant Finder access to Terminal (or whatever shell is running the build), then use `pnpm tauri build --bundles dmg` instead of `hdiutil`.

Replace `1.2.4` in the filenames with the actual version.

### 7. Generate `latest.json`

The in-app updater fetches `latest.json` from the GitHub Release assets. Build it from the two `.sig` files:

```bash
AARCH64_SIG=$(cat ../../target/aarch64-apple-darwin/release/bundle/macos/Wellread.app.tar.gz.sig)
X64_SIG=$(cat ../../target/x86_64-apple-darwin/release/bundle/macos/Wellread.app.tar.gz.sig)
PUB_DATE=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
VERSION="1.2.4"

cat > ../../target/latest.json <<EOF
{
  "version": "${VERSION}",
  "notes": "Wellread ${VERSION}: <short summary>",
  "pub_date": "${PUB_DATE}",
  "platforms": {
    "darwin-aarch64": {
      "signature": "${AARCH64_SIG}",
      "url": "https://github.com/lima1217/wellread/releases/download/v${VERSION}/Wellread_${VERSION}_aarch64.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "${X64_SIG}",
      "url": "https://github.com/lima1217/wellread/releases/download/v${VERSION}/Wellread_${VERSION}_x64.app.tar.gz"
    }
  }
}
EOF
```

### 8. Commit, tag, push

```bash
cd ../..  # back to the repo root so `git add -A` covers the whole workspace
git add -A
git commit -m "Release Wellread 1.2.4."
git tag v1.2.4
git push origin main
git push origin v1.2.4
```

> **Pre-push hook** runs the full test suite (4900+ tests, ~30s). All must pass before the push completes.

### 9. Create GitHub Release

```bash
# Run from the repo root (continuing from Step 8)
gh release create v1.2.4 \
  --repo lima1217/wellread \
  --title "Wellread 1.2.4" \
  --notes "<markdown release notes>" \
  target/aarch64-apple-darwin/release/bundle/dmg/Wellread_1.2.4_aarch64.dmg \
  target/x86_64-apple-darwin/release/bundle/dmg/Wellread_1.2.4_x64.dmg \
  target/aarch64-apple-darwin/release/bundle/macos/Wellread_1.2.4_aarch64.app.tar.gz \
  target/aarch64-apple-darwin/release/bundle/macos/Wellread_1.2.4_aarch64.app.tar.gz.sig \
  target/x86_64-apple-darwin/release/bundle/macos/Wellread_1.2.4_x64.app.tar.gz \
  target/x86_64-apple-darwin/release/bundle/macos/Wellread_1.2.4_x64.app.tar.gz.sig \
  target/latest.json \
  apps/readest-app/release-notes.json
```

> Rename the `.app.tar.gz` and `.sig` files to include the version number before uploading (Tauri names them `Wellread.app.tar.gz` without the version). Example: `cp Wellread.app.tar.gz Wellread_1.2.4_aarch64.app.tar.gz`.

## Release assets checklist

Each release ships 8 assets:

| Asset | Purpose |
| --- | --- |
| `Wellread_VER_aarch64.dmg` | Apple Silicon installer |
| `Wellread_VER_x64.dmg` | Intel installer |
| `Wellread_VER_aarch64.app.tar.gz` | Updater bundle (Apple Silicon) |
| `Wellread_VER_aarch64.app.tar.gz.sig` | Updater signature (Apple Silicon) |
| `Wellread_VER_x64.app.tar.gz` | Updater bundle (Intel) |
| `Wellread_VER_x64.app.tar.gz.sig` | Updater signature (Intel) |
| `latest.json` | Updater manifest (fetched by in-app "Check for Updates") |
| `release-notes.json` | Full version history |

## Key locations

| What | Where |
| --- | --- |
| Signing private key | `.secrets/wellread.key` (gitignored, empty password) |
| Signing public key | `.secrets/wellread.key.pub` (also embedded in `tauri.conf.json` → `bundle.updater.pubkey`) |
| Updater endpoint | `tauri.conf.json` → `bundle.updater.endpoints` |
| Build output | `target/<arch>/release/bundle/` |
| Node sidecar binaries | `apps/readest-app/src-tauri/binaries/node-{aarch64,x86_64}-apple-darwin` |

## Troubleshooting

**`command not found: dotenv`** — Run Tauri commands via `pnpm tauri ...` from `apps/readest-app/`, not `dotenv -e ... -- tauri ...` directly. The `dotenv` binary is not on PATH.

**`Key generation aborted: Unable to find the private key`** — You forgot to set `TAURI_SIGNING_PRIVATE_KEY`. Export it from the key file: `export TAURI_SIGNING_PRIVATE_KEY=$(cat .secrets/wellread.key)`.

**`incorrect updater private key password`** — Set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""` (empty string). The key has no password but the env var must be present.

**DMG build fails with `AppleEvent timed out (-1712)`** — Use the `hdiutil` workaround in Step 6, or grant Finder Automation permission to your terminal in System Settings.

**`create-dmg: Not enough arguments`** — You ran `bundle_dmg.sh` manually without args. Let `tauri build --bundles dmg` invoke it, or use `hdiutil` instead.

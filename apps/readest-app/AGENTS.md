## Project overview

Wellread is an ebook reader built as a Next.js 16 + Tauri v2 hybrid app. Package code lives at `apps/readest-app` (`@wellread/wellread-app`). The shipped host is macOS (Apple Silicon) via Tauri; `pnpm dev-web` runs the UI without compiling Rust. Web and mobile code paths remain in the tree. Directory map: [docs/code-layout.md](docs/code-layout.md); system picture: [docs/architecture.md](docs/architecture.md).

Reading Assistant (the AI panel, backed by `apps/eve-sidecar`): domain terms in [`CONTEXT.md`](../../CONTEXT.md), extract/tools/skill contract in [docs/reading-assistant-contract.md](docs/reading-assistant-contract.md). Read both before changing assistant code, the sidecar prompt or bundled skills.

## Commands

Scripts live in `package.json`; these carry conventions the script names do not show:

- `pnpm test -- <file>` runs one unit test file. Pick the tier (unit / browser / Tauri) with [docs/testing.md](docs/testing.md).
- `pnpm lint` is Biome + tsgo type check. `pnpm format` / `pnpm format:check` run Biome from the monorepo root.
- Rust (`src-tauri/`): `pnpm fmt:check`, `pnpm clippy:check`, `pnpm test:rust`.

Path aliases: `@/*` → `./src/*`; `@/components/ui/*` → `./src/components/primitives/*`.

## Git worktrees

Create worktrees with `pnpm worktree:new <branch-name|pr-number>`; it initializes submodules (simplecc WASM, foliate-js), installs dependencies, copies `.env`, vendor assets and Tauri gen symlinks, all of which lint and tests need. Plain `git worktree add` skips that setup.

```bash
pnpm worktree:new feat/my-feature   # New branch from origin/main
pnpm worktree:new 3837              # Checkout PR #3837 with push access to fork
```

## Agent workspace

`.agents/` holds symlinks into `.claude/` (`memory`, `plans`, `rules`); either path works.

- `.agents/rules/`: test-first, typescript, verification. They apply to every coding task; `verification.md` is the done-condition list to run before calling work complete.
- `.agents/memory/`: past investigations, indexed by `MEMORY.md` (grouped by area, with issue numbers). Before fixing a bug, grep it for the issue number, feature or file you are touching.
- `.agents/plans/`: implementation plans.

## Implementation scope

Write the minimum code that solves the requested problem: only the features asked for, abstractions only once a second caller exists, configurability only when requested, error handling only for states that can occur. Before finishing, simplify anything a senior engineer would call overcomplicated.

## UI work

- **i18n**: before adding or changing a user-facing string, read [docs/i18n.md](docs/i18n.md) (key-as-content, `stubTranslation` in non-React modules, extraction).
- **Safe area insets**: before placing UI near a screen edge, read [docs/safe-area-insets.md](docs/safe-area-insets.md).
- **Design system**: before building or changing settings, dialogs or other UI, read [DESIGN.md](DESIGN.md): surface tiers, action vocabulary, settings primitives (`BoxedList`, `SettingsRow`, `SettingsSwitchRow`, `SettingsSelect`, `NavigationRow`, `Tips`, etc.), RTL, e-ink overlay. Build from the primitives in `src/components/settings/primitives/`, and record recurring decisions in DESIGN.md.

### E-ink mode

Every new UI widget must look right under `[data-eink='true']`: e-ink screens have no shadows, no gradients and slow refresh, so boundaries come from crisp 1px borders. Reuse the conventions in `src/styles/globals.css`:

- **Surfaces / inputs**: add `eink-bordered`. In e-ink mode it swaps to `bg-base-100` + 1px `base-content` border. Use it on inputs, custom button backgrounds, ghost-styled cancel buttons, and any container that needs a visible boundary.
- **Primary action buttons**: `btn-contrast` (theme-neutral solid, already e-ink-correct) for most primary actions; `btn-primary` for true call-to-action buttons. The `[data-eink]` rules render both as `base-content` bg + `base-100` text so the primary action stays distinct.
- **`.modal-box`** picks up no-shadow + 1px border automatically.
- **Hierarchy through shape**: pair a borderless ghost (cancel) with a solid CTA (submit), so e-ink can invert one and keep the difference. Color and hover alone vanish on e-ink touchscreens.

Check by toggling E-ink in Settings → Misc. Composite components (custom buttons, layered cards) usually need `eink-bordered` on the right element.

## macOS release

To build and publish a macOS release, follow [docs/macos-release.md](docs/macos-release.md).

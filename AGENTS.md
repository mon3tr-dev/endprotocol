# AGENTS.md

Guidance for AI agents working in this repository.

**Project**: EndProtocol — a Tauri 2.x + React 19 desktop app integrating the Skland (森空岛) / Hypergryph APIs: multi-account management (Arknights: Endfield **and** Arknights), character data, daily attendance, gacha stats, game launcher, self-updater.  
**Stack**: TypeScript/React 19/Vite/Tailwind (frontend in `src/`), Rust/tokio/reqwest (backend in `src-tauri/src/`), IPC via Tauri `invoke` + `emit`/`listen`.

---

## 📋 Quick Start

1. **Find what you need**: Open [`docs/README.md`](docs/README.md) — the master index with quick lookup tables.
2. **Read before coding**: Check `docs/*.md` guides (frontend, backend, API, cards) for conventions.
3. **Update indexes**: If you change files/symbols/commands/configs, update the matching reference docs in the same commit.

---

## 1. Documentation Layout

| File | Purpose | Audience |
|------|---------|----------|
| **[README.md](../README.md)** | Product intro, features, download, quick start | Users |
| **[docs/README.md](docs/README.md)** | Developer documentation hub: lookup tables, inventory, maintenance rules | Developers |
| **[docs/reference/](docs/reference/)** | Per-file reference with symbol→line tables, call chains, config keys | Developers |

> ⚠️ **Never start by browsing the filesystem**. Always look up targets in the documentation first.

---

## 2. Documentation Navigation

Use these lookup paths based on your question:

| Question | Document |
|----------|----------|
| Where is feature X implemented? | [`docs/README.md`](docs/README.md) §1 quick lookup table |
| What does this file do, which symbols are on which line? | Matching file under [`docs/reference/`](docs/reference/) |
| Which Tauri command does X, and who calls it? | [`docs/reference/ipc_index.md`](docs/reference/ipc_index.md) |
| Signature / params / return / internal call chain of a command? | [`docs/reference/backend/commands.md`](docs/reference/backend/commands.md) |
| Which HTTP endpoint / config key / event does a service use? | [`docs/reference/backend/services_account.md`](docs/reference/backend/services_account.md), [`services_skland.md`](docs/reference/backend/services_skland.md), [`services_launcher.md`](docs/reference/backend/services_launcher.md), [`services_others.md`](docs/reference/backend/services_others.md) |
| Props of a UI component, fields of a type, i18n namespace? | [`docs/reference/frontend/ui_components.md`](docs/reference/frontend/ui_components.md), [`types_locales_styles.md`](docs/reference/frontend/types_locales_styles.md) |
| How to write code here (conventions, extension points)? | `docs/*.md` guides (frontend, backend, api, card_*) |

### Reference Documentation Statistics

- **27 reference docs** covering every source file
- Written in **Chinese**
- Contains: symbol→line tables, invoked commands, config keys, events, endpoints
- Line numbers are **locating aids**, not contracts — they drift as code changes

---

## 3. When to Open Source Code

✅ **Open source code only when:**

1. The reference documentation lacks the detail you need, or appears stale
2. You are about to change behavior — read the whole file (and its reference section) first
3. You need exact current signatures/types for a call

❌ **Do not open source code if:**

- The reference doc already answers your question
- You're just exploring or browsing

---

## 4. Pre-flight Checklist

Before writing any code:

### ✅ Read Relevant Guides

- `docs/frontend_development.md`
- `docs/backend_development.md`
- `docs/api_communication.md`
- `docs/card_development.md`
- `docs/card_configuration.md`

### ✅ Follow Enforced Conventions

| Area | Rule |
|------|------|
| **Frontend logging** | Use `src/utils/logger.ts` — never bare `console.log` |
| **User-visible text** | i18next (`src/locales/`), never hard-coded strings |
| **Frontend→backend calls** | Wrap `invoke` in `src/utils/*Service.ts` with types and explicit failure returns |
| **Backend errors** | `Result<T, AppError>` (`src-tauri/src/utils/error.rs`); async for I/O; `tracing`/`log_*` for logs |
| **Styling** | Tailwind + glass components in `src/components/ui/glass` |
| **Icons** | Use icon components from `lucide`/`morphicons` (or existing SVG icon components). Persist icon **identifiers**, not emoji characters |
| **State/config** | `ConfigService` on the backend (`app_config.json`, dotted keys) — no ad-hoc file writes |

### ✅ Forbidden Paths

Never read or modify generated/distribution folders:

- `dist/`
- `target/`
- `node_modules/`
- `src-tauri/gen/`

### 🖥️ Screen Control — Denied by Default

**Do not use tools that control or observe the screen unless the current prompt explicitly allows it.**

This covers the `computer` tool (inspect, screenshot, click, type, key, scroll, drag, move, focus, set_value, open_url) and any equivalent OS-level automation: UI Automation / Win32 window driving, `SendKeys`, mouse or keyboard hooks, and desktop screenshot capture.

- **Default is denied.** Silence in the prompt is not permission — permission must be stated explicitly in the current prompt.
- **Permission is per-turn and per-action.** It covers only what that prompt names, and it does not carry over to later turns.
- **Denied does not mean blocked.** If a task appears to need screen control, say what needs to happen on screen and hand that step to the user instead of doing it.

---

## 5. Verification Commands

No lint or test scripts are configured. Use:

```bash
npm run build      # Vite build (frontend type/syntax check)
npm run dev         # Vite dev server
cargo check         # Run inside src-tauri/ (existing warnings are expected)
```

---

## 6. Building the Linux AppImage (WSL2)

Tauri can only bundle an AppImage on Linux — `pnpm tauri build --bundles appimage` on Windows exits without producing anything, and cross-compiling from Windows is not supported. On a Windows host, build **inside WSL2** (Ubuntu 24.04 on this machine).

### One-time prerequisites (inside WSL)

- Node ≥ 24 and pnpm 10
- Rust via rustup. `~/.cargo/bin` is **not** on the login-shell PATH, so always `export PATH="$HOME/.cargo/bin:$PATH"` in build scripts, otherwise the Tauri CLI fails with `failed to run 'cargo metadata' command … No such file or directory`.
- System packages: `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`, `patchelf`, `build-essential`, `pkg-config`, `squashfs-tools` (for `mksquashfs`). All are present on this machine; installing more requires the WSL sudo password.
- **Build with `CC=gcc-13`.** The default gcc 15 emits `.base64` assembler directives that binutils 2.42 cannot parse, which breaks the `ring` crate:

  ```
  /tmp/ccXXXX.s:102071: Error: unknown pseudo-op: `.base64'
  ```

  `CC=gcc-13` fixes it. Downgrading `ring` does **not** — the version is irrelevant.

### Steps

1. Copy the project to the WSL **native** filesystem. Never build over `/mnt/f`: 9p is slow and the Windows `node_modules` contains wrong-platform binaries.

   ```bash
   rm -rf "$HOME/build/endprotocol" && mkdir -p "$HOME/build/endprotocol"
   tar -C /mnt/f/endprotocol \
     --exclude=node_modules --exclude=target --exclude=dist --exclude=dist-linux \
     --exclude=.git --exclude=.pnpm-store -cf - . | tar -C "$HOME/build/endprotocol" -xf -
   ```

2. Disable updater artifact signing **in the WSL copy only**. `createUpdaterArtifacts: true` aborts bundling when `TAURI_SIGNING_PRIVATE_KEY` is unset:

   ```bash
   node -e "const fs=require('fs');const p='src-tauri/tauri.conf.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));c.bundle.createUpdaterArtifacts=false;fs.writeFileSync(p,JSON.stringify(c,null,2)+'\n')"
   ```

   The checked-in `src-tauri/tauri.conf.json` must stay `true`; this edit only exists so a local unsigned build can finish.

3. Install and build:

   ```bash
   export PATH="$HOME/.cargo/bin:$PATH"
   export CC=gcc-13
   cd "$HOME/build/endprotocol"
   pnpm install --frozen-lockfile
   pnpm tauri build --bundles appimage
   ```

   A clean release build of the Rust backend takes roughly 2–3 minutes on 16 cores.

### If the bundler stops at `failed to run linuxdeploy`

This is the normal outcome in WSL, not a code problem. `linuxdeploy-plugin-appimage` downloads the AppImage runtime from `github.com`, and WSL cannot reach it: the Windows proxy listens on `127.0.0.1:10808` only, which is unreachable from WSL2 in NAT mode. By that point the AppDir is already fully populated (`AppRun`, `.desktop`, icons, `usr/lib` deps, GTK hooks), so finish the last step by hand.

Download both files on the **Windows** side, through the local proxy:

```powershell
curl.exe -x http://127.0.0.1:10808 -L -o "$env:TEMP\runtime-x86_64" `
  https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64
curl.exe -x http://127.0.0.1:10808 -L -o "$env:TEMP\appimagetool-x86_64.AppImage" `
  https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
```

Then package the existing AppDir inside WSL:

```bash
cp /mnt/c/Users/<user>/AppData/Local/Temp/runtime-x86_64 /tmp/
cp /mnt/c/Users/<user>/AppData/Local/Temp/appimagetool-x86_64.AppImage /tmp/
chmod +x /tmp/appimagetool-x86_64.AppImage

cd "$HOME/build/endprotocol/target/release/bundle/appimage"
ARCH=x86_64 VERSION=0.1.0 APPIMAGE_EXTRACT_AND_RUN=1 /tmp/appimagetool-x86_64.AppImage \
  --no-appstream \
  --runtime-file /tmp/runtime-x86_64 \
  endprotocol.AppDir \
  endprotocol_0.1.0_amd64.AppImage
```

Copy the result back to the repo (the folder is gitignored):

```powershell
wsl -d Ubuntu-24.04 -- cp ~/build/endprotocol/target/release/bundle/appimage/endprotocol_0.1.0_amd64.AppImage /mnt/f/endprotocol/dist-linux/
```

### Verifying the artifact

```bash
./endprotocol_0.1.0_amd64.AppImage --appimage-offset    # prints the embedded runtime size (944632 with the continuous runtime)
./endprotocol_0.1.0_amd64.AppImage --appimage-extract   # must list usr/bin/endprotocol and endprotocol.desktop
file endprotocol_0.1.0_amd64.AppImage                   # ELF 64-bit LSB pie executable, x86-64
```

### Gotchas

- **Unsigned local builds cannot self-update.** Release builds get their updater signature from `TAURI_SIGNING_PRIVATE_KEY` (see `.github/workflows/release.yml`).
- **glibc baseline.** A WSL Ubuntu 24.04 build targets glibc 2.39 + `webkit2gtk-4.1` and may fail to start on older distros. CI deliberately builds on `ubuntu-22.04` for wider compatibility.
- **Local version stays `0.1.0`.** CI rewrites `package.json` and `tauri.conf.json` from the git tag; local builds keep the checked-in version.
- **Never drive this through `wsl … bash -lc '<script>'` from PowerShell.** Quotes get mangled (a script containing `"$PATH"` arrives broken and bash dies on the parentheses in the inherited Windows PATH). Write the snippet to a `.sh` file and run `wsl -d Ubuntu-24.04 -- bash /tmp/script.sh`.

---

## 7. Documentation Maintenance Rules

Outdated documentation becomes a trap. **You must update indexes in the same commit as your code changes.**

### 🔧 Update Checklist

If your change adds, removes, or renames **any** of: files, exported symbols/components/methods, Tauri commands, config keys, events, card directories:

| Change Type | Required Updates |
|-------------|------------------|
| **General refactoring** | Affected reference doc — keep its format: `## <file path>` → 职责 / 导出 / 主要依赖 → `| 符号 \| 位置 \| 说明 |` table → 备注 (invoke commands, config keys, events) |
| **New/removed/renamed `#[tauri::command]`** | Regenerate [`docs/reference/ipc_index.md`](docs/reference/ipc_index.md) (script: `docs/README.md` §5.1) and add/remove the row in `docs/reference/backend/commands.md` |
| **New page/component/service/card** | Add a section to the matching `docs/reference/{frontend,backend}/*.md` |
| **New card plugin** | Follow `docs/card_development.md` and record it in the relevant `cards_*.md` |
| **Changed entry point / directory layout / feature map** | Update [`docs/README.md`](docs/README.md) (quick lookup table) and `docs/project_structure.md` |
| **Technical implementation details** | Move from `README.md` to `docs/` — `README.md` is marketing-only |

### 🏆 Definition of Done

```
code changed + verified + indexes updated, all in one commit-ready state
```

### ⚖️ Conflict Resolution

> **If a doc contradicts the code, the code wins.** Fix the doc and explain why in your commit summary.

---

## 8. Documentation Index Map

```
docs/
├── README.md                       # Entry point: quick lookup table, doc inventory, maintenance rules
├── user_guide.md                   # User-facing usage guide
├── development.md                  # Developer setup, build, CI/CD, commit rules
├── project_structure.md            # Directory layout, runtime flow
├── frontend_development.md         # Frontend conventions & extension points
├── backend_development.md          # Rust layering, conventions, crypto/signing
├── api_communication.md            # IPC contract, data flows
├── card_development.md             # Card plugin system guide
├── card_configuration.md           # Card settings storage & migration
└── reference/                      # Per-file references (generated by reading the code)
    ├── ipc_index.md                # 144 commands ↔ definition ↔ frontend callers
    ├── frontend/  (18 docs)        # Frontend file references
    └── backend/   (8 docs)         # Backend file references
```

---

## 9. Commit Message Standards

Every commit must follow [Conventional Commits](https://www.conventionalcommits.org/) with a **prefix**:

### 📝 Format Template

```
<type>(<scope>): <lowercase imperative summary, no trailing period>

<optional body: one bullet per coherent change>

<optional trailers, e.g. Co-authored-by: ...>
```

### 🔤 Allowed Types

`feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

### 📦 Scope Examples

Optional but recommended when the change belongs to one area:

- `feat(launcher)`
- `fix(updater)`
- `docs(agents)`

Plain prefixes are valid for cross-area changes:

- `feat: enable cross-platform builds and updates`

### ✂️ Splitting Principle

**Preferred approach:** Keep one coherent change per commit.

| Strategy | Example |
|----------|---------|
| ✅ **One commit** | code + its required doc-index updates (§7) |
| ✅ **Separate commits** | unrelated work (repo meta docs, tooling, formatting) |

---

## 10. Final Checks Before Commit

Before pushing:

- [ ] Run verification commands (§5): `npm run build`, `cargo check`
- [ ] Ensure indexes are updated (§7)
- [ ] Verify commit has a proper prefix
- [ ] Avoid mixing unrelated features into one commit

---

## Quick Reference Summary

```
🎯 Goal: Find something? → docs/README.md
💻 Writing code? → Read docs/*.md guides first
📝 Changing files? → Update reference docs in the same commit
🚫 Generated folders? → Never touch dist/, target/, node_modules/, src-tauri/gen/
🖥️ Screen control? → Denied unless the current prompt explicitly allows it, see §4
🐧 Linux AppImage? → WSL2 + CC=gcc-13, see §6
✅ Definition of done? → code + verify + docs = one commit
```

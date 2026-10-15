# AGENTS.md

Guidance for AI agents working in this repository.

**Project**: EndProtocol — a Tauri 2.x + React 19 desktop app integrating the Skland (森空岛) / Hypergryph APIs: multi-account management, character data, daily attendance, gacha stats, game launcher, self-updater.
**Stack**: TypeScript/React 19/Vite/Tailwind (frontend in `src/`), Rust/tokio/reqwest (backend in `src-tauri/src/`), IPC via Tauri `invoke` + `emit`/`listen`.

---

## 1. Use the indexes first — do not browse the tree

Entry point: **[docs/README.md](docs/README.md)** — quick lookup table ("I want to find X → which file"), doc inventory, maintenance rules.

Do **not** start by listing directories or reading source files. Look up the target in:

| Question | Open |
| --- | --- |
| Where is feature X implemented? | [docs/README.md](docs/README.md) §1 quick lookup table |
| What does this file do, which symbols are on which line? | the matching file under [docs/reference/](docs/reference/) |
| Which Tauri command does X, and who calls it? | [docs/reference/ipc_index.md](docs/reference/ipc_index.md) |
| Signature / params / return / internal call chain of a command | [docs/reference/backend/commands.md](docs/reference/backend/commands.md) |
| Which HTTP endpoint / config key / event does a service use? | [docs/reference/backend/services_account.md](docs/reference/backend/services_account.md), [services_skland.md](docs/reference/backend/services_skland.md), [services_launcher.md](docs/reference/backend/services_launcher.md), [services_others.md](docs/reference/backend/services_others.md) |
| Props of a UI component, fields of a type, i18n namespace | [docs/reference/frontend/ui_components.md](docs/reference/frontend/ui_components.md), [types_locales_styles.md](docs/reference/frontend/types_locales_styles.md) |
| How to write code here (conventions, extension points) | `docs/*.md` guides (frontend, backend, api, card_*) |

`docs/reference/**` (27 docs, written in Chinese) covers **every** source file with symbol→line tables, invoked commands, config keys, events and endpoints. Line numbers are a locating aid, not a contract — they drift as code changes.

**Only open source code when:**

1. the reference lacks the detail you need, or looks stale;
2. you are about to change behaviour — read the whole file (and its reference section) first;
3. you need exact current signatures/types for a call.

## 2. Before writing code

- Read the relevant guide: `docs/frontend_development.md`, `docs/backend_development.md`, `docs/api_communication.md`, `docs/card_development.md`, `docs/card_configuration.md`.
- Conventions that are enforced by review:
  - Frontend logging: `src/utils/logger.ts` — never bare `console.log`.
  - User-visible text: i18next (`src/locales/`), never hard-coded strings.
  - Frontend→backend calls: wrap `invoke` in `src/utils/*Service.ts` with types and an explicit failure return.
  - Backend errors: `Result<T, AppError>` (`src-tauri/src/utils/error.rs`); async for anything doing I/O; `tracing`/`log_*` for logs.
  - Styling: Tailwind + the glass components in `src/components/ui/glass`.
  - Icons: Do not use emoji in the application UI, metadata, or examples; use an icon component from `lucide`/`morphicons` (or an existing SVG icon component) instead. Persist icon identifiers, not emoji characters.
  - State/config: `ConfigService` on the backend (`app_config.json`, dotted keys) — no ad-hoc file writes.
- Never read or modify: `dist/`, `target/`, `node_modules/`, `src-tauri/gen/` (generated).

## 3. Verify

No lint or test scripts are configured in this repo. Use:

```bash
npm run build      # vite build (frontend type/syntax check)
npm run dev        # vite dev server
cargo check        # run inside src-tauri/ (existing warnings are expected)
```

## 4. Keep the indexes updated (required before you finish)

Documentation that is not updated becomes a trap for the next agent. If your change adds, removes or renames **any** of: files, exported symbols/components/methods, Tauri commands, config keys, events, card directories — update in the **same change**:

1. **Affected reference doc** — keep its format: `## <file path>` → 职责 / 导出 / 主要依赖 → `| 符号 | 位置 | 说明 |` table → 备注 (invoke commands, config keys, events).
2. **New/removed/renamed `#[tauri::command]`** → regenerate [docs/reference/ipc_index.md](docs/reference/ipc_index.md) (script: `docs/README.md` §5.1) and add/remove the row in `docs/reference/backend/commands.md`.
3. **New page/component/service/card** → add a section to the matching `docs/reference/{frontend,backend}/*.md`.
4. **New card** → also follow `docs/card_development.md` and record it in the relevant `cards_*.md`.
5. **Changed entry point / directory layout / feature map** → update `docs/README.md` (quick lookup table) and `docs/project_structure.md`.

If a doc contradicts the code, **the code wins** — fix the doc and say so in your summary.

Definition of done: code changed + verified + indexes updated, all in one commit-ready state.

## 5. Docs map

```
docs/
├── README.md                 # entry point: quick lookup table, doc inventory, maintenance rules
├── project_structure.md      # directory layout, runtime flow
├── frontend_development.md   # frontend conventions & extension points
├── backend_development.md    # Rust layering, conventions, crypto/signing
├── api_communication.md      # IPC contract, data flows
├── card_development.md       # card plugin system guide
├── card_configuration.md     # card settings storage & migration
└── reference/                # per-file references (generated by reading the code)
    ├── ipc_index.md          # 99 commands ↔ definition ↔ frontend callers
    ├── frontend/  (18 docs)
    └── backend/   (8 docs)
```

## 6. Commit rules

Every commit message must follow [Conventional Commits](https://www.conventionalcommits.org/) and **carry a prefix**:

```
<type>(<scope>): <lowercase imperative summary, no trailing period>

<optional body: one bullet per coherent change>

<optional trailers, e.g. Co-authored-by: ...>
```

- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
- **Scope** is optional but recommended when the change belongs to one area, e.g. `feat(launcher)`, `fix(updater)`, `docs(agents)`.
- Plain prefixes are also valid when the change spans areas, e.g. `feat: enable cross-platform builds and updates`.

**Splitting is allowed (and preferred over mega-commits).** Keep one coherent change per commit:

- code + its required doc-index updates (§4) → one commit;
- unrelated work in the same working tree (e.g. repo meta docs, tooling, formatting) → separate commit with its own prefix.

Before committing, run the verification in §3 (`npm run build`, `cargo check`) and make sure the indexes in §4 are updated. Never commit without a prefix, and never mix an unrelated feature into an existing commit unless explicitly asked to amend.

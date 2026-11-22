<div align="center">

<img src="src-tauri/icons/icon.png" width="120" alt="EndProtocol" />

# EndProtocol

**Skland account assistant and launcher for Arknights: Endfield / Arknights**

Data dashboards and launchers for both games in one desktop application.

<sub>森空岛账号助手 · 《明日方舟：终末地》/《明日方舟》启动器</sub>

<p>
  <a href="https://github.com/mon3tr-dev/endprotocol/releases"><img alt="Release" src="https://img.shields.io/github/v/release/mon3tr-dev/endprotocol?style=for-the-badge&label=Release&color=6366f1" /></a>
  <a href="https://github.com/mon3tr-dev/endprotocol/releases"><img alt="Release date" src="https://img.shields.io/github/release-date/mon3tr-dev/endprotocol?style=for-the-badge&label=Released&color=6366f1" /></a>
  <a href="https://github.com/mon3tr-dev/endprotocol/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/mon3tr-dev/endprotocol?style=for-the-badge&label=Stars&color=f59e0b&logo=github" /></a>
  <a href="https://github.com/mon3tr-dev/endprotocol/issues"><img alt="Issues" src="https://img.shields.io/github/issues/mon3tr-dev/endprotocol?style=for-the-badge&label=Issues&color=ef4444" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/mon3tr-dev/endprotocol?style=for-the-badge&label=License&color=8b5cf6" /></a>
</p>

<p>
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20Android-0078D6?style=for-the-badge&logo=android&logoColor=white" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.x-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-7-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-stable-000000?style=for-the-badge&logo=rust&logoColor=white" />
</p>

<p>
  <a href="#core-features">Core features</a> ·
  <a href="#supported-games">Supported games</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="#contributing">Contributing</a> ·
  <a href="README.md">中文</a>
</p>

</div>

---

> **EndProtocol** combines Skland dashboards with launchers for *Arknights: Endfield* and *Arknights* in one application.
> Manage multiple accounts, inspect operators and gacha data, track attendance and in-game progression, and control installation, channels, and Steam integration without switching apps.

---

## 🧩 Core features

| 🗂️ Skland data | 🎮 Game launcher | 🎨 Desktop & mobile |
| :--- | :--- | :--- |
| Multiple accounts · Character encyclopedia · Gacha statistics<br>Attendance · Regions · Spaceship · Medals | Dual-game switching · Six channels<br>Install/update · Verify · Pre-download · Channel migration | Glass UI · Themes<br>Fullscreen mode · Android touch UI · Tray & auto-update |

### 🗂️ Skland data

- 👥 **Multiple accounts**: password, SMS, and QR-code login, with multiple-account switching
- 🧑‍🚀 **Character data**: filter operators by role, rarity, attribute, weapon, and secondary criteria
- 🎴 **Gacha statistics**: incremental synchronization and ECharts views for rarity distribution, spacing, and pity progress
- 📅 **Attendance**: today/tomorrow rewards and configurable automatic attendance
- 🗺️ **Regions and spaceship**: regional levels, currency and infrastructure; spaceship rooms, assigned operators, morale and trust
- 🏅 **Achievement medals**: medal wall with hexagonal icons and level details
- 🧲 **Draggable dashboard**: built-in cards, free layout editing, and tabbed card groups

### 🎮 Game launcher

- 🎯 **Dual-game support**: switch between *Arknights: Endfield* and *Arknights* from the left edge
- 🌐 **Six channels**: Endfield official, Bilibili, Global, Google Play; Arknights official and Bilibili
- 🔍 **Automatic channel detection**: inspect Endfield marker files or Arknights `config.ini`
- ⬇️ **Install/update**: remote manifests, delta downloads, resumable downloads, and MD5 verification
- 🩺 **Verification and repair**: quick or full verification with automatic re-download of damaged files
- ⏳ **Pre-download**: download official pre-release patch volumes in advance
- 🔀 **Channel migration**: differential backup, rollback and cancellation, process checks and install-directory locking
- 🕹️ **Steam integration**: add each game as a non-Steam game and configure icons, Overlay, DX11 and administrator shortcuts
- 🚀 **Launch modes**: process detection, start/terminate process, DX11, launcher-free launch, silent launch and custom arguments

### 🕹️ Fullscreen game mode

Switch to an immersive game shell with game/channel-specific backgrounds and whole-page transitions. The bottom bar provides banner and announcement carousels. Links open in a native in-app browser with navigation and refresh controls.

- Background videos pause while the app loses focus or is sent to the background, then resume at the same position
- Banner and announcement BrowserViews use an independent overlay outside the game-page transition layer

### 📌 System tray

Double-click the tray icon to restore the main window. The right-click panel shows sanity, active, task and pass progress for the selected account. Close behavior can minimize to tray, close the app, or ask every time.

### 🔄 Auto-update

Stable and preview channels, GitHub Releases and Cloudflare R2 mirror sources, and in-app minisign signature verification.

### 🛡️ Network and stability

- HTTP/SOCKS5 proxy support, system-proxy import, detection and connectivity checks
- Crash diagnostics, log export, API health protection and developer network capture

### 🎨 Personalization

- Glass UI with light, dark and system themes
- Six accent presets plus a custom color picker and screen eyedropper
- Simplified Chinese and English
- Custom background images and transparency; Windows Acrylic support
- Android bottom navigation, touch bottom drawers, pull-to-refresh and status-bar/gesture-bar safe-area support

---

## 🎮 Supported games

| Arknights: Endfield | Arknights |
| :---: | :---: |
| <img src="public/games/endfield.png" width="84" alt="Arknights: Endfield" /> | <img src="public/games/arknights.png" width="84" alt="Arknights" /> |
| **Official · Bilibili · Global · Google Play** | **Official · Bilibili** |
| Install/update · verification · pre-download<br>Channel migration · Steam integration | Install/update · verification · pre-download<br>Channel migration · Steam integration |

> The launcher, Acrylic window effects and fullscreen shell are desktop-only. Linux can use the Skland dashboard normally.
>
> Android is supported for account, operator, attendance, gacha and Arknights data features. The mobile shell includes bottom navigation, a "Me" page, touch-friendly account and settings drawers, pull-to-refresh and safe-area handling. The desktop launcher, tray, desktop updater and screen picker are not exposed on mobile. See [docs/development.md](docs/development.md) §2.1.

---

## 🚀 Quick start

### 📦 Download

<p align="center">
  <a href="https://github.com/mon3tr-dev/endprotocol/releases/latest"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows%20x64-0078D6?style=for-the-badge&logo=windows&logoColor=white" /></a>
  <a href="https://github.com/mon3tr-dev/endprotocol/releases/latest"><img alt="Download for Linux" src="https://img.shields.io/badge/Download-Linux%20x64-FCC624?style=for-the-badge&logo=linux&logoColor=black" /></a>
</p>

| Platform | Format |
| :--- | :--- |
| Windows x64 | NSIS installer (`.exe`) |
| Linux x64 | AppImage |

### ⚙️ Install and sign in

1. Run the installer.
2. Open **Account** and select **Add account**.
3. Sign in by password, SMS verification or QR code.
4. Select the game roles to synchronize.
5. Open the dashboard, add cards and long-press to enter layout-edit mode.
6. Use the sidebar to open regions, spaceship, gacha records, medals or tasks.

### ▶️ Launch a game

1. Enter **Game mode** from the title bar.
2. Move to the left edge, expand the game switcher and choose Endfield or Arknights.
3. Select a channel and installation directory.
4. Choose install/update or use verification, pre-download and channel migration actions.
5. Select **Launch game**.

---

## 📚 Documentation

Technical documentation lives in [`docs/`](docs/):

| Document | Content |
| :--- | :--- |
| [docs/README.md](docs/README.md) | Documentation index and code lookup |
| [docs/user_guide.md](docs/user_guide.md) | Accounts, dashboard, launcher, tray and settings |
| [docs/development.md](docs/development.md) | Environment, desktop/Android builds and CI |
| [docs/project_structure.md](docs/project_structure.md) | Project structure and runtime flows |
| [docs/frontend_development.md](docs/frontend_development.md) | Frontend conventions |
| [docs/backend_development.md](docs/backend_development.md) | Rust backend and security |
| [docs/api_communication.md](docs/api_communication.md) | Tauri IPC and data flow |
| [docs/card_development.md](docs/card_development.md) | Dashboard card plugins |
| [docs/card_configuration.md](docs/card_configuration.md) | Card configuration storage |

Per-file references are available in [`docs/reference/`](docs/reference/).

---

## 🤝 Contributing

Issues and pull requests are welcome. Before contributing, read:

- [docs/development.md](docs/development.md) - setup, build commands and conventions
- [docs/README.md](docs/README.md) - code lookup and documentation maintenance rules
- [AGENTS.md](AGENTS.md) - AI agent collaboration guidelines

Use [Conventional Commits](https://www.conventionalcommits.org/) and keep one coherent change per commit.

If this project is useful to you, please consider leaving a ⭐.

---

## 📄 License

Copyright (C) 2026 MSK Network

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License (AGPL v3) published by the Free Software Foundation.

---

<div align="center">

**Built with [Tauri](https://tauri.app/) · [React](https://react.dev/) · [Rust](https://www.rust-lang.org/)**

<sub><a href="#endprotocol">Back to top ↑</a></sub>

</div>

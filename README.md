<div align="center">

<img src="src-tauri/icons/icon.png" width="120" alt="EndProtocol" />

# EndProtocol

**森空岛账号助手 · 《明日方舟：终末地》/《明日方舟》启动器**

把数据看板与两款游戏的启动器，放进同一个窗口

<sub>A desktop dashboard &amp; game launcher for Arknights: Endfield and Arknights.</sub>

<p>
  <a href="https://github.com/mon3tr-dev/endprotocol/releases"><img alt="Release" src="https://img.shields.io/github/v/release/mon3tr-dev/endprotocol?style=for-the-badge&label=Release&color=6366f1" /></a>
  <a href="https://github.com/mon3tr-dev/endprotocol/releases"><img alt="Release date" src="https://img.shields.io/github/release-date/mon3tr-dev/endprotocol?style=for-the-badge&label=Released&color=6366f1" /></a>
  <a href="https://github.com/mon3tr-dev/endprotocol/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/mon3tr-dev/endprotocol?style=for-the-badge&label=Stars&color=f59e0b&logo=github" /></a>
  <a href="https://github.com/mon3tr-dev/endprotocol/network/members"><img alt="Forks" src="https://img.shields.io/github/forks/mon3tr-dev/endprotocol?style=for-the-badge&label=Forks&color=0ea5e9" /></a>
  <a href="https://github.com/mon3tr-dev/endprotocol/issues"><img alt="Issues" src="https://img.shields.io/github/issues/mon3tr-dev/endprotocol?style=for-the-badge&label=Issues&color=ef4444" /></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/mon3tr-dev/endprotocol?style=for-the-badge&label=License&color=8b5cf6" /></a>
</p>

<p>
  <img alt="Platform" src="https://img.shields.io/badge/Platform-Windows%20%7C%20Linux-0078D6?style=for-the-badge&logo=windows&logoColor=white" />
  <img alt="Tauri" src="https://img.shields.io/badge/Tauri-2.x-24C8DB?style=for-the-badge&logo=tauri&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img alt="Rust" src="https://img.shields.io/badge/Rust-stable-000000?style=for-the-badge&logo=rust&logoColor=white" />
  <img alt="Last commit" src="https://img.shields.io/github/last-commit/mon3tr-dev/endprotocol?style=for-the-badge&label=Last%20commit&color=64748b" />
</p>

<p>
  <a href="#-核心功能">核心功能</a> ·
  <a href="#-支持的游戏">支持的游戏</a> ·
  <a href="#-快速上手">快速上手</a> ·
  <a href="#-文档">文档</a> ·
  <a href="#-仓库动态">仓库动态</a> ·
  <a href="#-参与贡献">参与贡献</a>
</p>

</div>

---

> **EndProtocol** 把「森空岛数据看板」和「《终末地》《明日方舟》游戏启动器」放进同一个窗口。
> 登录多个账号、查看干员 / 抽卡 / 区域与帝江号数据、每日签到，管理两款游戏的安装、渠道切换与 Steam 集成，全程无需切换应用。

---

## 🧩 核心功能

| 🗂️ 森空岛数据端                                                             | 🎮 游戏启动器                                                  | 🎨 桌面体验                                         |
| :-------------------------------------------------------------------------- | :------------------------------------------------------------- | :-------------------------------------------------- |
| 多账号管理 · 干员图鉴 · 抽卡统计<br>每日签到 · 区域信息 · 帝江号 · 成就勋章 | 双游戏切换 · 六渠道<br>安装更新 · 校验修复 · 预下载 · 渠道迁移 | 玻璃拟态 · 主题配色<br>全屏游戏模式 · 托盘 · 自更新 |

### 🗂️ 森空岛数据端

- 👥 **多账号管理**：手机号/密码、短信验证码、二维码三种登录方式，支持多账号列表与快速切换
- 🧑‍🚀 **角色数据**：按职业、星级、属性、武器六维筛选干员，查看技能、天赋、潜能与模组
- 🎴 **抽卡统计**：完整抽卡历史增量同步，ECharts 图表展示六星分布、间距与保底曲线
- 📅 **每日签到**：今日/明日奖励一览，支持自动签到开关
- 🗺️ **区域与帝江号**：独立页面查看大世界区域等级、货币与基建建设点，以及帝江号舱室等级与派驻干员的心情、信赖
- 🏅 **成就勋章**：蚀刻章勋章墙，六边形图标与等级解析
- 🧲 **可拖拽仪表板**：9 种内置卡片（账户信息、账户进度、干员列表、每日签到、成就勋章、区域信息、帝江号、系统资源、待办），自由拖拽布局，多标签页分组管理

### 🎮 游戏启动器（《终末地》/《明日方舟》）

- 🎯 **双游戏支持**：鼠标靠近窗口左边缘呼出游戏切换栏，一键在《终末地》与《明日方舟》之间切换；标题栏、操作面板与安装目录 / 渠道 / DX11 配置整套随游戏切换，互不覆盖
- 🌐 **六渠道支持**：《终末地》官服、B 服、国际服、Google Play；《明日方舟》官服、B 服
- 🔍 **渠道自动识别**：《终末地》依据安装目录中的标记文件，《明日方舟》读取 `config.ini` 的 channel，自动判定当前渠道
- ⬇️ **安装 / 更新**：远端清单比对、差分下载、断点续传、MD5 校验
- 🩺 **校验与修复**：快速 / 完整两档，损坏文件自动重新下载
- ⏳ **预下载**：提前下载官方预发布补丁分卷，抢先准备新版本
- 🔀 **渠道切换**：两款游戏均支持，五阶段流水线迁移，含差量备份、失败回滚与取消；切换前检查游戏进程并锁定安装目录，游戏运行中拒绝写入
- 🕹️ **Steam 集成**：按游戏分别添加为 Steam 第三方游戏，自动提取对应图标，可选 Overlay 注入与管理员快捷方式
- 🚀 **启动方式**：进程检测、一键启动 / 结束进程，支持 DX11 强制、免启动器启动、静默启动与自定义命令行

### 🕹️ 全屏游戏模式

一键切换到沉浸式游戏外壳，背景图 / 背景视频随所选游戏与渠道变化，切换游戏时整页推移过渡；底部信息栏展示 Banner 轮播（悬停翻页、圆点跳转）与公告。点击 Banner 或公告会在应用内以原生浏览器打开（支持前进 / 后退 / 刷新，禁嵌站点也能正常访问），切换模式时自动挂起 / 恢复浏览器。

### 📌 系统托盘

双击托盘图标唤起主窗口，右键弹出面板查看所选账号的理智、活跃、事务与通行证进度。关闭行为可配置（关闭 / 最小化到托盘 / 每次询问）。

### 🔄 应用自更新

稳定版与预览版双通道，GitHub Releases 与 Cloudflare R2 镜像双源，应用内下载并经 minisign 签名验证，启动 3 秒后自动检查更新。

### 🛡️ 网络与稳定性

- 🌐 **网络代理**：HTTP / SOCKS5，支持一键导入系统代理、自动检测与连通性测试
- 🧯 **崩溃诊断**：崩溃提示、日志导出、错因判断与 API 熔断保护
- 🛠️ **开发者工具**：需手动开启的开发者模式，提供网络抓包与调试入口

### 🎨 个性化体验

- 🪟 玻璃拟态 UI，浅色 / 深色 / 跟随系统主题
- 🎨 6 组预设强调色 + 自定义配色（HSV/HSL 取色器 + 屏幕吸管）
- 🌏 简体中文与英文双语言
- 🖼️ 自定义背景图与透明度，Windows 亚克力窗口效果

---

## 🎮 支持的游戏

|                             《明日方舟：终末地》                             |                            《明日方舟》                             |
| :--------------------------------------------------------------------------: | :-----------------------------------------------------------------: |
| <img src="public/games/endfield.png" width="84" alt="Arknights: Endfield" /> | <img src="public/games/arknights.png" width="84" alt="Arknights" /> |
|                    **官服 · B 服 · 国际服 · Google Play**                    |                           **官服 · B 服**                           |
|            安装更新 · 校验修复 · 预下载<br>渠道切换 · Steam 集成             |        安装更新 · 校验修复 · 预下载<br>渠道切换 · Steam 集成        |

> 游戏启动器与窗口磨砂等能力仅在 Windows 版本提供；Linux 版本可正常使用森空岛数据端。

---

## 🚀 快速上手

### 📦 下载

<p align="center">
  <a href="https://github.com/mon3tr-dev/endprotocol/releases/latest"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows%20x64-0078D6?style=for-the-badge&logo=windows&logoColor=white" /></a>
  <a href="https://github.com/mon3tr-dev/endprotocol/releases/latest"><img alt="Download for Linux" src="https://img.shields.io/badge/Download-Linux%20x64-FCC624?style=for-the-badge&logo=linux&logoColor=black" /></a>
</p>

| 平台        | 格式                   |
| :---------- | :--------------------- |
| Windows x64 | NSIS 安装程序 (`.exe`) |
| Linux x64   | AppImage               |

### ⚙️ 安装与启动

1. 运行安装程序完成安装
2. 启动 EndProtocol，进入「账户」页面点击「添加账户」
3. 选择登录方式（手机号 + 密码 / 验证码 / 扫码）完成登录
4. 多角色账号登录后在弹窗中选择要同步的角色
5. 回到仪表板，添加卡片、长按进入编辑模式即可拖拽布局
6. 侧边栏可进入「区域信息」「帝江号」「抽卡记录」「成就勋章」「待办」等独立页面

### ▶️ 启动游戏

1. 点击标题栏进入**游戏模式**
2. 鼠标靠近窗口左边缘展开游戏切换栏，选择《终末地》或《明日方舟》
3. 在操作面板选择渠道并指定安装目录（目录为空则执行安装，已有安装则检测更新）
4. 点击「启动游戏」即可进入当前选中的游戏

---

## 📚 文档

技术开发文档已迁移至 [`docs/`](docs/) 目录：

| 文档                                                            | 内容                                                 |
| :-------------------------------------------------------------- | :--------------------------------------------------- |
| 📖 [docs/README.md](docs/README.md)                             | 文档总索引 + 快速定位表（找代码位置优先查这里）      |
| 🧑‍💻 [docs/user_guide.md](docs/user_guide.md)                     | 用户使用指南（账号登录、仪表板、启动器、托盘、设置） |
| 🛠️ [docs/development.md](docs/development.md)                   | 开发者指南（环境要求、构建、CI/CD、贡献流程）        |
| 🧱 [docs/project_structure.md](docs/project_structure.md)       | 项目结构与核心数据流                                 |
| 🎨 [docs/frontend_development.md](docs/frontend_development.md) | 前端规范与扩展方式                                   |
| ⚙️ [docs/backend_development.md](docs/backend_development.md)   | Rust 后端分层、加密签名说明                          |
| 🔌 [docs/api_communication.md](docs/api_communication.md)       | Tauri IPC 契约与数据流                               |
| 🧩 [docs/card_development.md](docs/card_development.md)         | 卡片插件化开发完整指南                               |
| 🗃️ [docs/card_configuration.md](docs/card_configuration.md)     | 卡片配置存储与迁移                                   |

逐文件功能参考（含符号行号、调用链）请见 [`docs/reference/`](docs/reference/)。

---

## 📊 仓库动态

<p align="center">
  <a href="https://github.com/mon3tr-dev/endprotocol"><img alt="EndProtocol repository card" src="https://opengraph.githubassets.com/1/mon3tr-dev/endprotocol" width="620" /></a><br />
  <sub>GitHub 实时仓库概览</sub>
</p>

<p align="center">
  <img alt="Commit activity" src="https://img.shields.io/github/commit-activity/m/mon3tr-dev/endprotocol?style=for-the-badge&label=Commits%2Fmonth&color=10b981" />
  <img alt="Repo size" src="https://img.shields.io/github/repo-size/mon3tr-dev/endprotocol?style=for-the-badge&label=Repo%20size&color=64748b" />
  <img alt="Top language" src="https://img.shields.io/github/languages/top/mon3tr-dev/endprotocol?style=for-the-badge&label=Top%20language&color=3178C6" />
</p>

<p align="center">
  <a href="https://star-history.com/#mon3tr-dev/endprotocol&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=mon3tr-dev/endprotocol&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=mon3tr-dev/endprotocol&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=mon3tr-dev/endprotocol&type=Date" width="680" />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://github.com/mon3tr-dev/endprotocol/graphs/contributors">
    <img alt="Contributors" src="https://contrib.rocks/image?repo=mon3tr-dev/endprotocol" />
  </a>
</p>

---

## 🤝 参与贡献

欢迎提交 Issue 与 Pull Request。开始之前建议先阅读：

- [`docs/development.md`](docs/development.md) — 环境搭建、构建命令与提交规范
- [`docs/README.md`](docs/README.md) — 快速定位表与文档维护规则
- [`AGENTS.md`](AGENTS.md) — AI Agent 协作约定

提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/)，一个提交只做一件连贯的事。

如果这个项目对你有帮助，欢迎点一个 ⭐ 支持一下。

---

## 📄 许可证

Copyright (C) 2026 MSK Network

本程序是自由软件：你可以重新发布和/或修改它，条件是遵循自由软件基金会发布的 GNU Affero 通用公共许可证（AGPL v3）的条款。

---

<div align="center">

**Built with [Tauri](https://tauri.app/) · [React](https://react.dev/) · [Rust](https://www.rust-lang.org/)**

<sub> <a href="#endprotocol">回到顶部 ↑</a></sub>

</div>

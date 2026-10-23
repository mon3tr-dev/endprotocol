# 开发者指南

本文档面向 EndProtocol 贡献者，说明环境要求、构建、CI/CD 与代码规范。

更详细的逐文件功能参考请见 [`docs/reference/`](docs/reference/) 与 [`docs/README.md`](docs/README.md) 的快速定位表。

---

## 1. 环境要求

- **Node.js** 20+（CI 使用 Node 24）
- **pnpm** 10（包管理器，仓库使用 `pnpm-lock.yaml`；`package-lock.json` 已废弃，请勿用它安装）
- **Rust** 最新稳定版
- **Windows** 构建环境（当前发布目标为 `x86_64-pc-windows-msvc`）

> **锁文件规则**：仓库根 `Cargo.toml` 是 cargo workspace 根（`members = ["src-tauri"]`），因此**根目录的 `Cargo.lock` 才是有效锁文件**；`src-tauri/Cargo.lock` 已被移除，不要在子目录重新生成（会与 workspace 锁文件打架、并让构建解析到不同版本的 `tauri` crate）。

> **Tauri 版本一致性**：Tauri CLI 要求 `@tauri-apps/*` 的 NPM 包与对应 Rust crate **同主次版本**。`package.json` 与 `src-tauri/Cargo.toml` 都用 `~` 锁定到当前解析版本（`tauri 2.12.x` / `@tauri-apps/api 2.12.x` 等）；升级时两边一起改，或直接改动 `Cargo.toml` 后让 CI 的 `Sync Tauri NPM packages with Rust crates` 步骤对齐。报错 `Found version mismatched Tauri packages` 即说明两者不同次版本。

---

## 2. 安装与开发

```bash
git clone https://github.com/soldiereleven/endprotocol.git
cd endprotocol
pnpm install
```

### 启动开发服务器

```bash
pnpm tauri dev
```

Vite 开发服务器固定使用 `1420` 端口（`strictPort`），HMR 使用 `1421`。

### 构建

```bash
pnpm tauri build
```

产物位于 `src-tauri/target/release/`，安装包为 NSIS `.exe`（同时生成 updater 签名产物）。

> 版本号由 CI 从 Git 标签注入 `package.json` 与 `src-tauri/tauri.conf.json`，本地构建的版本号无实际意义。

---

## 3. 技术栈

### 前端

| 技术 | 版本 | 用途 |
| --- | --- | --- |
| React | 19.x | UI 框架 |
| TypeScript | 5.6.x | 类型系统 |
| Vite | 6.x | 构建工具（双入口） |
| Tailwind CSS | 4.x | 样式框架 |
| aura-glass | 3.5.x | 玻璃拟态组件库 |
| React Router | 6.23.x | 路由 |
| i18next / react-i18next | 26.x / 17.x | 国际化 |
| ECharts | 6.1.x | 抽卡统计图表 |
| dnd-kit | 6.x / 9.x / 10.x | 卡片拖拽排序 |
| morphicons / lucide | 1.7.x / 1.33.x | 图标 |
| qrcode | 1.5.x | 扫码登录二维码生成 |
| tailwind-variants / clsx | 3.2.x / 2.1.x | 类名工具 |
| uuid | 14.x | 卡片实例 ID |

### 后端

| 技术 | 版本 | 用途 |
| --- | --- | --- |
| Tauri | 2.x | 桌面应用框架（启用 `tray-icon`） |
| Rust | edition 2021 | 后端语言 |
| reqwest | 0.12 | HTTP 客户端 |
| tokio | 1.x | 异步运行时 |
| serde / serde_json | 1.x | 序列化 |
| windows-sys | 0.61 | Win32 API（GDI 截屏、窗口、Shell） |
| rfd | 0.15 | 原生文件 / 目录选择框 |
| walkdir | 2.x | 安装目录文件扫描 |

### 加密与校验

| 用途 | 算法 |
| --- | --- |
| 森空岛请求签名 | HMAC-SHA256 → MD5（密钥派生自 `x-signature-key`） |
| 设备指纹 (dId) | RSA + AES-128-CBC / 3DES |
| 鹰角启动器清单解密 | AES-256-CBC（`hg_crypto`） |
| 文件完整性 | MD5、SHA-256 |
| 其他 | Gzip (flate2)、Base64、Hex |

### Tauri 插件

`tauri-plugin-updater`、`tauri-plugin-process`、`tauri-plugin-opener`、`tauri-plugin-fs`。

---

## 4. 项目结构

```
endprotocol/
├── src/                                  # React 前端
│   ├── pages/                            # 页面
│   ├── components/
│   │   ├── cards/                        # 卡片系统
│   │   ├── ui/glass/                     # 自建 Glass 组件（21 个）
│   │   └── ui/                           # 通用 UI
│   ├── lib/                              # 服务层（launcherService、accountService 等）
│   ├── stores/                           # 轻量 store
│   ├── hooks/                            # 自定义 Hook
│   ├── layouts/                          # 应用外壳
│   ├── locales/{en,zh}/translation.json  # 全局翻译
│   ├── types/                            # 类型定义
│   ├── styles/globals.css                # 全局样式与玻璃主题
│   ├── App.tsx                           # 路由与启动检查
│   ├── main.tsx                          # 入口
│   ├── provider.tsx                      # 错误边界与全局宿主
│   ├── i18n.ts                           # i18next 初始化
│   └── tray-panel.tsx                    # 托盘面板入口（第二入口）
├── src-tauri/                            # Rust 后端
│   ├── src/
│   │   ├── commands/                     # Tauri 命令层
│   │   ├── services/                     # 业务服务层
│   │   ├── models/                       # 数据模型
│   │   ├── utils/                        # 工具类（加密、HTTP、日志、路径等）
│   │   ├── tray.rs                       # 托盘图标与面板窗口
│   │   ├── lib.rs                        # 插件注册、状态托管、启动任务
│   │   └── main.rs
│   ├── capabilities/                     # 权限配置
│   ├── icons/                            # 应用图标
│   ├── tauri.conf.json                   # 窗口、打包、更新配置
│   └── Cargo.toml
├── docs/                                 # 开发文档
├── public/assets/icons/                  # 游戏数据图标
├── .github/workflows/release.yml         # 自动构建与发布
├── index.html                            # 主窗口入口
├── tray-panel.html                       # 托盘面板入口
└── vite.config.ts
```

---

## 5. 代码规范

- **前端日志**：使用 `src/utils/logger.ts`，禁止裸露 `console.log`
- **用户可见文本**：使用 i18next (`src/locales/`)，禁止硬编码字符串
- **前端→后端调用**：在 `src/utils/*Service.ts` 中封装 `invoke`，包含类型与显式失败返回
- **后端错误**：使用 `Result<T, AppError>` (`src-tauri/src/utils/error.rs`)；I/O 操作使用 async；使用 `tracing`/`log_*` 记录日志
- **样式**：Tailwind + `src/components/ui/glass` 玻璃组件
- **图标**：禁止在应用 UI、元数据或示例中使用 emoji；使用 `lucide`/`morphicons` 或现有 SVG 图标组件；持久化图标标识符而非 emoji 字符
- **状态/配置**：后端使用 `ConfigService` (`app_config.json`，点分键)，禁止 ad-hoc 文件写入
- **禁止读取或修改**：`dist/`、`target/`、`node_modules/`、`src-tauri/gen/`（生成文件）

---

## 6. 验证

仓库未配置 lint 或测试脚本。使用以下命令检查：

```bash
npm run build      # vite build（前端类型/语法检查）
npm run dev        # vite dev server
cargo check        # 在 src-tauri/ 目录下运行（已有警告属预期）
```

---

## 7. CI/CD

`.github/workflows/release.yml` 在推送 `v*` 标签时触发：

1. **同步版本号**：去掉标签的 `v` 前缀，写入 `package.json` 与 `src-tauri/tauri.conf.json`
2. **判定通道**：版本号带后缀 → `preview`，否则 `stable`；并查找同通道的上一个标签
3. **生成更新日志**：按 Conventional Commits 分类，写入 `CHANGELOG.md`
4. **并行构建**：Node 24 + pnpm 10 + Rust stable，构建 Windows x64、Linux x64 AppImage、macOS Intel 与 Apple Silicon 安装包及签名 updater 包
5. **生成更新清单**：将各平台的 updater 包与 minisign 签名汇总到 Release 的 `latest.json`
6. **发布**：先创建草稿 Release，再将其公开并标记是否为预发布

需配置的 Secrets：`TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（`GITHUB_TOKEN` 由 Actions 自动提供）。

---

## 8. 提交规范

每条提交信息必须遵循 [Conventional Commits](https://www.conventionalcommits.org/) 并携带前缀：

```
<type>(<scope>): <lowercase imperative summary, no trailing period>

<optional body: one bullet per coherent change>

<optional trailers, e.g. Co-authored-by: ...>
```

- **Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`
- **Scope** 可选但推荐，例如 `feat(launcher)`、`fix(updater)`、`docs(agents)`
- 无前缀的提交也有效，例如 `feat: enable cross-platform builds and updates`

保持一条连贯的更改 per commit；不相关的工作应分开提交。

提交前运行 §6 验证，并确保 `docs/` 索引已同步更新。禁止不带前缀提交，禁止将不相关功能混入现有提交。

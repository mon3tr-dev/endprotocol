# 开发者指南

本文档面向 EndProtocol 贡献者，说明环境要求、构建、CI/CD 与代码规范。

更详细的逐文件功能参考请见 [`docs/reference/`](docs/reference/) 与 [`docs/README.md`](docs/README.md) 的快速定位表。

---

## 1. 环境要求

- **Node.js** 20+（CI 使用 Node 24）
- **pnpm** 10（包管理器，仓库使用 `pnpm-lock.yaml`；`package-lock.json` 已废弃，请勿用它安装）
- **Rust** 最新稳定版
- **Windows** 构建环境（当前发布目标为 `x86_64-pc-windows-msvc`）
- **Android 构建（可选）**：Android Studio / Android SDK + NDK + JDK 21，`rustup target add aarch64-linux-android x86_64-linux-android`；详见 §2.1

> **锁文件规则**：仓库根 `Cargo.toml` 是 cargo workspace 根（`members = ["src-tauri"]`），因此**根目录的 `Cargo.lock` 才是有效锁文件**；`src-tauri/Cargo.lock` 已被移除，不要在子目录重新生成（会与 workspace 锁文件打架、并让构建解析到不同版本的 `tauri` crate）。

> **Tauri 版本一致性**：Tauri CLI 要求 `@tauri-apps/*` 的 NPM 包与对应 Rust crate **同主次版本**。`package.json` 与 `src-tauri/Cargo.toml` 都用 `~` 锁定到当前解析版本（`tauri 2.12.x` / `@tauri-apps/api 2.12.x` 等）；升级时两边一起改，或直接改动 `Cargo.toml` 后让 CI 的 `Sync Tauri NPM packages with Rust crates` 步骤对齐。报错 `Found version mismatched Tauri packages` 即说明两者不同次版本。

---

## 2. 安装与开发

```bash
git clone https://github.com/mon3tr-dev/endprotocol.git
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

### 2.1 Android 构建（移动端）

Android 适配已就绪（代码级），构建 APK 需要 Android 工具链：

```bash
# 一次性：JDK 21（AGP 9 的 daemon 要求见下方“JDK 版本”）
#   ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk
#   NDK_HOME=%ANDROID_HOME%\ndk\<version>
rustup target add aarch64-linux-android
rustup target add x86_64-linux-android   # 模拟器几乎都是 x86_64，不装则模拟器跑不起来

# 生成 Android 工程（gen/android 目前不在仓库中，由该命令首次生成；已存在则跳过）
pnpm tauri android init

# 开发（设备连接 USB 调试或启动模拟器后）
pnpm tauri android dev

# 构建
pnpm tauri android build          # debug APK
pnpm tauri android build --apk    # release APK（签名需在 gen/android 配置签名信息）
```

#### 必须用 `pnpm tauri`，不要用 `cargo tauri`

`src-tauri/gen/android/buildSrc/.../BuildTask.kt` 由 Gradle 调用 `node tauri android android-studio-script`，
最终解析到**仓库 `node_modules` 里的 `@tauri-apps/cli`**，而不是 PATH 上的 `cargo-tauri`。
两者版本不一致时会以极误导的方式失败：

```
Execution failed for task ':app:rustBuildX86_64Debug' (registered by plugin 'rust').
> A problem occurred starting process 'command 'node.bat''
```

`node.bat` 只是 `BuildTask` 依次尝试 `node`/`node.exe`/`node.cmd`/`node.bat` 的**最后一个**兜底，
真实错误被吞掉了。手动复现才能看到原因（在 `src-tauri/` 下执行）：

```
failed to read gen/android/.tauri/cli-options-server.json;
the `tauri android dev` or `tauri android build` command must be running
```

该文件由 CLI 2.12+ 的 `android dev` 在构建期间写出，`cargo tauri` 2.11 不写它。
所以**始终用 `pnpm tauri android dev`**（与 `package.json` 的 `~2.12.1` 对齐）。

Gradle 侧执行的 `node tauri` 以 `src-tauri/` 为工作目录，Node 会把第一个非选项参数当作
**脚本路径**（按 `.js/.cjs/.mjs` 探测），而不是从 `NODE_PATH` 找包。仓库里的
`src-tauri/tauri.js` 就是为此存在的垫片：它用动态 `import()` 把调用转发到
`node_modules/@tauri-apps/cli/tauri.js`。**不要删除**——缺少它时即使主命令用的是
`pnpm tauri`，Gradle 也会报上面那个 `node.bat` 失败。

#### JDK 版本

`gen/android/gradle/gradle-daemon-jvm.properties` 里 `toolchainVersion=25`，
Gradle 会强制用 JDK 25 起 daemon，本机没有就往 GitHub 下载（国内常连不上）：

```
Unable to download toolchain matching the requirements ({languageVersion=25 ...})
Caused by: Connect to github.com:443 failed: Connection timed out
```

本机已有 JDK 21 时，把该文件改成 `toolchainVersion=21` 即可（`gen/android` 是生成目录、不入库，
改动只影响本地）。注意这是 **daemon 的 JDK**，与 `JAVA_HOME` 不是同一件事——只设 `JAVA_HOME` 不会生效。

```powershell
$env:JAVA_HOME="C:\Program Files\Android\openjdk\jdk-21.0.8"
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME="$env:ANDROID_HOME\ndk\30.0.16248370"
```

**Android 与桌面的行为差异（适配要点）**：

| 项 | 桌面 | Android |
| --- | --- | --- |
| 主窗口 | `lib.rs:create_full_windows` 动态创建（含托盘面板） | `tauri.android.conf.json` 的 `app.windows` 静态创建 |
| 启动器（游戏下载/启动/切服） | 可用 | **禁用**：`stores/launcherMode.ts` 在非 Windows 强制 data 模式，游戏页 UI 不渲染 |
| 托盘 / 托盘面板 | 可用 | 无系统托盘：`tray::setup_tray` no-op，`is_tray_available()` 恒 false，设置页隐藏相关项 |
| 自更新 | updater 插件 | 无：后端命令返回明确错误，设置页隐藏更新 UI |
| 应用数据目录 | `%LOCALAPPDATA%\cn.msk-network.endprotocol`（`dirs`） | `{getDataDir()}`（Tauri 路径解析器 → `utils::paths` 覆盖值，setup 最早注入；实测落在 `/data/user/0/<pkg>/`） |
| 日志初始化时机 | `run()` 早期 | setup 注入数据目录之后（目录在此之前不可写） |
| 机密存储 | OS 凭据库（Windows Credential Manager 等） | Android Keystore（keyring 4.2）；不可用时自动降级 AES-GCM 文件（`secrets.enc`） |
| in-app browser（子 Webview） | 可用 | 不支持（多 Webview 为桌面特性）；游戏页本身已禁用，无暴露面 |
| 标签页快照 / 屏幕取色 | Windows（PrintWindow / GDI） | 后端返回明确错误，前端已按平台隐藏 |
| 窗口控制按钮 / 拖拽区 | 标题栏渲染 | 隐藏（系统状态栏管理生命周期）；标题栏让出顶部安全区（`--safe-area-top`） |
| TLS | reqwest `native-tls`（SChannel） | reqwest 默认 rustls，但**必须显式改用内置根证书**（见下方说明）：reqwest 0.13 的 rustls 后端固定依赖 `rustls-platform-verifier`，该 crate 在 Android 上要求注入 Kotlin 组件并显式初始化，否则首次 HTTPS 握手会在 tokio worker 里 panic |

**桌面专属依赖**集中在 `src-tauri/Cargo.toml` 的 `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`：`tauri`（tray-icon + unstable feature）、`tauri-plugin-single-instance`、`tauri-plugin-updater`、`tauri-plugin-devdeck`、`rfd`、reqwest `native-tls`。移动端不编译这些 crate，对应命令在 `commands/` 内提供返回明确错误的 stub。

#### Android TLS：必须绕开 rustls-platform-verifier

reqwest 0.13 的 rustls 后端（`rustls` feature）**无条件**依赖 `rustls-platform-verifier`，而它在 Android 上要求：

1. 在 Android 工程里注入它提供的 Kotlin 组件；
2. 在 JVM 侧调用 `rustls_platform_verifier::android::init_with_env / init_with_refs` 完成初始化。

否则**首次 HTTPS 握手就会在 tokio worker 线程 panic**（`Expect rustls-platform-verifier to be initialized`），表现为「应用能起来、一联网就崩」。

本项目的处理方式：`utils/http_client.rs` 的 `client_builder()` 在 Android 上用内置 Mozilla 根证书（`webpki-roots`）显式构造 `rustls::ClientConfig`，通过 `use_preconfigured_tls` 交给 reqwest，完全绕开平台校验器。所有 HTTP 客户端必须经由 `http_client::client_builder()` / `create_client()` / `default_client()` 创建，**不要**直接 `reqwest::Client::new()` / `Client::builder()`（那会退回默认 TLS 并在 Android 上 panic）。

对应的 Android 专属依赖（只在 `cfg(target_os = "android")` 段）：

```toml
[target.'cfg(target_os = "android")'.dependencies]
rustls = "0.23"
webpki-roots = "0.26"
```

#### 实测记录（模拟器）

- 环境：SDK `%LOCALAPPDATA%\Android\Sdk`、NDK r30（`30.0.16248370`）、JDK 21（`C:\Program Files\Android\openjdk\jdk-21.0.8`，需临时加入 PATH）、AVD `api36`（`system-images;android-36.1;google_apis;x86_64`，Pixle 7 1080×2400@420，4 核 / 4 GB）。
- 模拟器建议用 **`-no-window`（无窗口）** 运行：窗口模式在部分多显示器/缩放环境下会飞到屏幕外且难以纠正；无窗口时用 `adb exec-out screencap -p` / `adb shell screencap` 截图验证界面。
- 首次 `tauri android init` **必须加 `--ci`**，否则会卡在交互提问（App 名称等）而看起来像挂死。
- Gradle 发行版（`gradle-9.6.1-bin.zip`，约 134 MB）从 `services.gradle.org` 直连可能被拒（`Connection refused`）。可先下载到 `~/.gradle/wrapper/dists/gradle-9.6.1-bin/<hash>/gradle-9.6.1-bin.zip`；国内可走 `https://mirrors.cloud.tencent.com/gradle/gradle-9.6.1-bin.zip`。
- **不要直接运行 `gen/android/gradlew.bat`**：Gradle 的 rust 任务会回调 `pnpm tauri android android-studio-script`，需要 CLI 正在运行时生成的 `.tauri/cli-options-server.json`，否则报 `failed to read ... cli-options-server.json`。构建必须由 `pnpm tauri android build` / `dev` 驱动。
- 只装 `aarch64` 目标无法在 x86_64 模拟器上运行；需 `rustup target add x86_64-linux-android`（`tauri android init` 会安装全部四个目标）。

验证通过的路径：`cargo check --target x86_64-linux-android` → `pnpm tauri android build --debug --apk --target x86_64` → `adb install -r` → 启动后日志出现 `Logger initialized successfully`、数据目录/密钥/日志文件正确落盘、扫码登录可正常拉到二维码并轮询 `https://as.hypergryph.com/general/v1/scan_status`（证明 HTTPS 链路可用）。

---

## 3. 技术栈

### 前端

| 技术 | 版本 | 用途 |
| --- | --- | --- |
| React | 19.x | UI 框架 |
| TypeScript | 7.0.x（native tsgo） | 类型系统 |
| Vite | 8.x（Rolldown） | 构建工具（双入口） |
| Tailwind CSS | 4.3.x | 样式框架 |
| aura-glass | 3.5.x | 玻璃拟态组件库 |
| React Router | 7.18.x | 路由 |
| i18next / react-i18next | 27.x / 18.x | 国际化 |
| ECharts | 6.1.x | 抽卡统计图表 |
| dnd-kit | 6.x / 9.x / 10.x | 卡片拖拽排序 |
| morphicons / lucide | 2.0.x / 1.70.x | 图标 |
| qrcode | 1.5.x | 扫码登录二维码生成 |
| tailwind-variants / clsx | 4.0.x / 2.1.x | 类名工具 |
| uuid | 14.x | 卡片实例 ID |

### 后端

| 技术 | 版本 | 用途 |
| --- | --- | --- |
| Tauri | 2.12.x | 应用框架（桌面启用 `tray-icon` + `unstable`，移动端无 feature） |
| Rust | edition 2021 | 后端语言 |
| reqwest | 0.13 | HTTP 客户端（`query`/`stream`/`socks`；桌面加 `native-tls`，移动端走默认 rustls） |
| tokio | 1.x | 异步运行时 |
| serde / serde_json | 1.x | 序列化 |
| windows-sys | 0.61 | Win32 API（GDI 截屏、窗口、Shell，仅 Windows 目标） |
| rfd | 0.18 | 原生文件 / 目录选择框（仅桌面目标） |
| keyring | 4.2 | OS 凭据库（Windows Credential Manager / macOS Keychain / Secret Service / Android Keystore） |
| walkdir | 2.x | 安装目录文件扫描 |
| zip | 9.x | 游戏补丁包解压（`aes-crypto` + `deflate-flate2`） |
| sysinfo | 0.40 | 系统资源采集 |
| rand | 0.10 | 随机数（rsa 0.9 专用路径仍用 rand_core 0.6） |

### 加密与校验

| 用途 | 算法 |
| --- | --- |
| 森空岛请求签名 | HMAC-SHA256 → MD5（密钥派生自 `x-signature-key`） |
| 设备指纹 (dId) | RSA + AES-128-CBC / 3DES |
| 鹰角启动器清单解密 | AES-256-CBC（`hg_crypto`） |
| 文件完整性 | MD5、SHA-256 |
| 其他 | Gzip (flate2)、Base64、Hex |

> 注：RustCrypto 栈已统一到 digest 0.11 / cipher 0.5（aes 0.9、cbc/ecb 0.2、des 0.9、hmac 0.13、sha2/md-5 0.11）；
> 唯一例外是 rsa 0.9（仍绑 digest 0.10 / rand_core 0.6，经 `rsa::rand_core::OsRng` 使用），待 rsa 0.10 稳定后收口。

### Tauri 插件

- 全平台：`tauri-plugin-process`、`tauri-plugin-opener`、`tauri-plugin-fs`
- 仅桌面（`cfg(not(any(target_os = "android", target_os = "ios")))`）：`tauri-plugin-updater`、`tauri-plugin-single-instance`、`tauri-plugin-devdeck`（debug）

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
│   ├── icons/                            # 应用图标（含 icons/android 的启动器图标）
│   ├── tauri.conf.json                   # 窗口、打包、更新配置（桌面主配置，app.windows 为空）
│   ├── tauri.android.conf.json           # Android 平台覆盖配置（静态声明 main 窗口）
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
npx tsc --noEmit   # TypeScript 7 全量类型检查（零错误为通过）
npm run build      # vite build（Rolldown 打包，出现 Circular chunk: 视为失败）
npm run dev        # vite dev server
cargo check        # 在 src-tauri/ 目录下运行（已有警告属预期）
cargo test         # 在 src-tauri/ 目录下运行（72 个测试）
```

### ⚠️ `tauri dev` 窗口长时间空白？检查 `server.watch.ignored`

Vite 8 的文件监听器是 Rust 实现、**启动即递归建树**。本仓库根目录下的 `target/`（Rust
workspace 构建目录）在本机有 35 GB / 5.6 万个文件，若不排除，首个模块请求会被阻塞数十秒
（实测冷启动 `/src/main.tsx` 耗时 **46 秒**）。症状是 `tauri dev` 起来后窗口长时间只有启动
splash、DevTools 控制台没有任何输出，看起来像"窗口没有内容"。

`vite.config.ts` 的 `server.watch.ignored` 必须包含 `**/target/**`、`**/dist/**`、
`**/dist-linux/**`（以及 `**/src-tauri/**`）；加上后同一测量降到 **0.13 秒**。新增产物目录时
记得同步加入。

---

## 7. CI/CD

`.github/workflows/release.yml` 在推送 `v*` 标签时触发：

1. **同步版本号**：去掉标签的 `v` 前缀，写入 `package.json` 与 `src-tauri/tauri.conf.json`
2. **判定通道**：版本号带后缀 → `preview`，否则 `stable`；并查找同通道的上一个标签
3. **生成更新日志**：按 Conventional Commits 分类，写入 `CHANGELOG.md`
4. **并行构建**：Node 24 + pnpm 10 + Rust stable，Windows 与 Linux 作为独立 job 并行构建——Windows x64 出 NSIS 安装包，Linux x64（ubuntu-22.04，保证 glibc 兼容）出 AppImage，均含签名 updater 包
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

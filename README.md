# EndProtocol

基于 **Tauri 2 + React 19 + TypeScript** 构建的跨平台桌面客户端，用于管理 **森空岛 (Skland)** 账户，并内置《明日方舟：终末地》游戏启动器。

## 简介

EndProtocol 将两件事放进同一个窗口：

1. **森空岛数据端** —— 账户登录、角色数据、抽卡记录、每日签到、成就勋章、可拖拽的卡片式仪表板；
2. **游戏启动器** ——《终末地》的安装、更新、校验修复、预下载、渠道切换与启动，配套独立的全屏游戏模式界面。

前后端通过 Tauri 命令通信：React 负责界面与状态编排，Rust 侧承担网络请求、加密签名、文件校验与本地缓存。

> 当前发布的构建目标为 **Windows x64**（NSIS 安装包）。游戏启动器、系统托盘、屏幕取色等功能依赖 Win32 API。

## 功能特性

### 账户管理

- **三种登录方式**：手机号 + 密码、短信验证码、二维码扫码（森空岛 / 鹰角通行证）
- 多账户列表、批量登出、账户切换、多角色账户的角色选择
- 凭证（cred / token）自动检查与刷新，支持懒加载与手动重试
- **定时自动同步**：启动后台任务每 300 秒刷新一次账户数据
- 头像本地缓存

### 仪表板

- **可定制卡片网格**：基于 `@dnd-kit` 的拖拽布局，100px 吸附网格、碰撞检测、网格标尺、容器自动扩展与滚动
- **多标签页**：标签页支持自定义名称、图标与标签，卡片按标签页独立组织
- **长按进入编辑模式**：1.2 秒长按触发拖拽，配合进度环反馈
- **卡片右键菜单**：查看列表 / 切换角色 / 设置 / 选择勋章 / 切换领域 / 删除

内置 7 种卡片：

| 卡片 ID | 展示内容 |
| --- | --- |
| `account_info` | 账户概览：昵称、头像、等级、世界等级、服务器、主线进度、角色/武器/档案数量 |
| `account_progress` | 四项进度条：理智（含恢复倒计时）、每日活跃、每周事务、通行证等级 |
| `character_list` | 角色列表，支持单列 / 双列 / 三列三种显示模式 |
| `attendance` | 每日签到：今日与明日奖励、签到按钮、自动签到开关 |
| `achievement` | 蚀刻章勋章墙，六边形裁切图标与等级解析 |
| `spaceship` | 帝江号飞船：舱室等级与驻留干员的情绪、信赖 |
| `domain_info` | 领域信息：等级经验、资金与上限、据点干员、工厂 |

### 角色数据

- 角色浏览器，支持按**职业 / 星级 / 属性 / 武器 / 主词条 / 副词条**六维筛选
- 角色详情：技能、天赋、潜能、精英化、模组
- Wiki 数据集成：词条目录、物品详情、升级材料解析、技能描述富文本渲染

### 抽卡记录

- 完整抽卡历史，支持角色池与武器池分别同步，增量拉取（遇本地已有记录即停止翻页）
- 卡池分类：全部 / 限定 / 联合 / 标准 / 武器
- 多维筛选：卡池、关键词、星级、仅新获取、仅免费
- 实时同步进度（进度弹窗可关闭后后台继续）
- ECharts 图表：星级分布饼图、6★ 间隔分布直方图（含期望线）、6★ 累计曲线、卡池保底横向条形图

### 游戏启动器（《终末地》）

- **四个渠道**：官服（`official`）、B 服（`bilibili`）、国际服（`global`）、Google Play（`google_play`）
- **渠道自动识别**：依据安装目录中的 `PCGameSDK.dll`、`hgsdk.dll`、`gfsdk.dll`、`glextra.dll` 等标记文件判定
- **安装 / 更新**：拉取远端清单、本地文件比对、差异下载计划
- **断点续传下载**：单文件流式下载 + 单遍 MD5 校验，失败重试 3 次；并发下载（校验修复默认 4 线程，预下载 8 线程）
- **校验与修复**：快速 / 完整两档，支持校验速度显示
- **预下载**：新版本提前下载并保留状态
- **渠道切换**：5 阶段流水线（见下文架构说明），支持取消与回滚
- **启动与结束游戏**：进程检测（`tasklist`）、启动（`ShellExecuteW`）、结束进程（`taskkill`，逐级降级到 `wmic`）
- **安装目录扫描**：统计有效 / 损坏 / 缺失文件与需下载字节数，配合磁盘空间条
- **官方资讯**：Banner 轮播、公告标签页与详情，通过内置浏览器打开

### 游戏模式界面

除了数据端，应用提供一套全屏的**游戏模式**外壳，可从标题栏一键切换：

- 全幅背景图 / 背景视频（随渠道变化）
- 底部信息栏：左侧 Banner 轮播（5 秒自动切换，悬停暂停）与公告列表，右侧游戏操作面板
- 切换模式时自动挂起 / 恢复内置浏览器，避免状态丢失

### 内置浏览器

沙箱化 `<iframe>` 覆盖层，带前进 / 后退、刷新、可编辑地址栏、加载进度条，用于查看公告与官网页面。

### 系统托盘

- 托盘图标左键双击唤起主窗口（跨虚拟桌面强制置顶），右键在光标处弹出托盘面板
- **托盘面板**（独立的 260×340 无边框窗口）：昵称、等级，以及理智（含倒计时）、每日活跃、每周事务、通行证四条进度
- 可指定托盘展示的账户；托盘数据由主进程定期推送
- **关闭行为可配置**：关闭窗口 / 最小化到托盘 / 每次询问（默认询问）

### 更新系统

- **双更新通道**：稳定版 (Stable) 与预览版 (Preview)
- **双更新源**：GitHub Releases 与 Cloudflare R2 镜像（`updates.msk-network.cn`）
- **应用内更新**：Tauri updater 插件 + minisign 签名验证，含更新日志、下载进度与取消
- **启动自动检查**：启动 3 秒后自动检查更新

### 消息通知

- 标题栏铃铛 + 未读角标（有紧急消息时变红），右侧抽屉式消息列表
- 事件驱动：登录、登出、抽卡同步、签到、启动器操作等自动推送
- 支持进度条消息、操作按钮、按 tag 去重与合并；基于 sessionStorage 持久化

### 开发者工具

- **日志查看器**：前端 + 后端日志，支持来源与级别筛选
- **Wiki 数据调试**：目录 / 角色 / 武器词条转储
- **用户信息转储**
- **图片缓存管理**：智能 / 手动模式，条目数与容量上限、统计表、一键打开缓存目录

### UI/UX

- **玻璃拟态设计**：`aura-glass` 组件库 + 自建的 21 个 Glass 组件（GlassCard、GlassButton、GlassModal、GlassSelect、GlassTable 等）
- **多语言**：简体中文与英文
- **主题**：浅色 / 深色 / 跟随系统，6 组预设强调色 + 自定义配色（HSV/HSL 取色器 + 屏幕吸管）
- **自定义标题栏**：无边框窗口，自定义最小化 / 最大化 / 关闭
- **背景图片**：自定义背景与透明度调节
- **亚克力窗口效果**：Windows acrylic，透明度可配置
- **响应式布局**：桌面端侧边栏 + 移动端抽屉
- **路由持久化**：记住上次访问的页面
- **变形图标**：`morphicons` 实现的图标状态过渡动画

## 技术栈

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

`tauri-plugin-updater`（应用内更新，minisign 验证）、`tauri-plugin-process`（进程重启 / 退出）、`tauri-plugin-opener`（打开 URL 与文件）、`tauri-plugin-fs`。

## 项目结构

```
endprotocol/
├── src/                                  # React 前端
│   ├── pages/                            # 页面
│   │   ├── dashboard.tsx                 # 仪表板（卡片网格 + 标签页）
│   │   ├── account.tsx                   # 账户管理（三种登录方式）
│   │   ├── characters.tsx                # 角色浏览与筛选
│   │   ├── medals.tsx                    # 成就勋章
│   │   ├── attendance.tsx                # 每日签到
│   │   ├── gacha-records.tsx             # 抽卡记录与统计
│   │   ├── settings.tsx                  # 设置
│   │   └── developer.tsx                 # 开发者工具
│   ├── components/
│   │   ├── cards/                        # 卡片系统
│   │   │   ├── registry/                 # 注册中心（import.meta.glob 自动发现）
│   │   │   ├── base/                     # CardWrapper、useCardData
│   │   │   ├── card-container.tsx        # 网格容器与拖拽
│   │   │   ├── card-context-menu.tsx     # 卡片右键菜单
│   │   │   ├── _template/                # 卡片开发模板
│   │   │   └── {account-info,account-progress,achievement,attendance,
│   │   │        character-list,domain-info,spaceship}/   # 7 种内置卡片
│   │   ├── ui/glass/                     # 自建 Glass 组件（21 个）
│   │   ├── ui/                           # 通用 UI（对话框、空状态、错误边界等）
│   │   ├── game-action-panel.tsx         # 游戏启动器操作面板
│   │   ├── in-app-browser.tsx            # 内置浏览器
│   │   ├── account-switch-modal.tsx      # 账户切换
│   │   ├── role-select-modal.tsx         # 角色选择
│   │   ├── tray-panel.tsx                # 托盘面板 UI
│   │   ├── custom-titlebar.tsx           # 自定义标题栏
│   │   ├── dashboard-sidebar.tsx         # 侧边栏（含命令面板）
│   │   ├── update-dialog.tsx             # 更新对话框
│   │   ├── screen-color-picker.tsx       # 屏幕吸管
│   │   └── gacha-*.tsx                   # 抽卡图表
│   ├── lib/                              # 服务层
│   │   ├── launcherService.ts            # 启动器 IPC + 事件订阅
│   │   ├── accountService.ts             # 账户 IPC
│   │   ├── roleDataService.ts            # 角色数据查询与 Promise 缓存
│   │   ├── roleDetailService.ts          # 角色详情与懒加载开关
│   │   ├── configService.ts              # 配置读写（浏览器环境回落 localStorage）
│   │   ├── updateService.ts              # 更新通道 / 更新源 / 下载
│   │   ├── imageCacheManager.ts          # 图片缓存（引用计数 + LRU）
│   │   ├── messageStore.ts               # 消息通知 store
│   │   ├── logger.ts                     # 前端日志
│   │   ├── dashboardConfig.ts            # 卡片布局（含首个空位查找）
│   │   ├── tabService.ts                 # 标签页
│   │   ├── cardConfigService.ts          # 卡片设置
│   │   └── wikiTableParser.ts            # Wiki 文档解析
│   ├── stores/                           # 轻量 store（订阅式，无状态库）
│   │   ├── launcherMode.ts               # 数据 / 游戏模式 + 背景媒体
│   │   └── inAppBrowser.ts               # 内置浏览器状态
│   ├── hooks/useLongPressDrag.ts         # 长按进入拖拽
│   ├── layouts/dashboard.tsx             # 应用外壳（数据端 / 游戏模式双渲染路径）
│   ├── locales/{en,zh}/translation.json  # 全局翻译
│   ├── config/site.ts                    # 站点信息与链接
│   ├── types/                            # 类型定义
│   ├── styles/globals.css                # 全局样式与玻璃主题
│   ├── cards/startup-service.ts          # 卡片启动任务注册表
│   ├── App.tsx                           # 路由与启动检查
│   ├── main.tsx                          # 入口（主题预应用、卡片加载）
│   ├── provider.tsx                      # 错误边界与全局宿主
│   ├── i18n.ts                           # i18next 初始化
│   └── tray-panel.tsx                    # 托盘面板入口（第二入口）
├── src-tauri/                            # Rust 后端
│   ├── src/
│   │   ├── commands/                     # Tauri 命令层（13 个模块，90 个命令）
│   │   │   ├── account.rs                # 账户 CRUD、登录、角色数据查询
│   │   │   ├── launcher.rs               # 游戏启动器（25 个命令）
│   │   │   ├── gacha.rs                  # 抽卡同步与统计
│   │   │   ├── attendance.rs             # 签到
│   │   │   ├── card_config.rs            # 卡片设置持久化
│   │   │   ├── config.rs                 # 通用配置读写
│   │   │   ├── image.rs                  # 图片下载与缓存
│   │   │   ├── tray.rs                   # 托盘数据与面板控制
│   │   │   ├── updater.rs                # 更新下载与静默安装
│   │   │   ├── window.rs                 # 窗口控制
│   │   │   ├── color_picker.rs           # 屏幕取色（GDI BitBlt）
│   │   │   ├── logs.rs                   # 后端日志
│   │   │   └── wiki_debug.rs             # Wiki 调试转储
│   │   ├── services/                     # 业务服务层（10 个模块）
│   │   │   ├── game_launcher_service.rs  # 启动器核心（版本、清单、下载、校验、换服）
│   │   │   ├── account_service.rs        # 账户、登录、凭证刷新、自动签到
│   │   │   ├── skland_service.rs         # 森空岛 API 与请求签名
│   │   │   ├── gacha_service.rs          # 抽卡记录同步
│   │   │   ├── char_detail_service.rs    # 角色详情与图片本地化
│   │   │   ├── char_wiki_detail_service.rs # Wiki 词条详情与预加载
│   │   │   ├── config_service.rs         # app_config.json 持久化
│   │   │   ├── avatar_cache_service.rs   # 图片缓存（9 类子目录）
│   │   │   ├── network_service.rs        # 数据查询分发
│   │   │   └── data_query.rs             # JSON 路径提取
│   │   ├── models/                       # 数据模型
│   │   │   ├── game.rs                   # 渠道、GameStatus、ActiveOperation
│   │   │   ├── account.rs / login.rs / role.rs
│   │   │   ├── char_detail.rs / gacha.rs
│   │   ├── utils/
│   │   │   ├── hg_crypto.rs              # 鹰角清单解密与 MD5/SHA-256 校验
│   │   │   ├── encrypt.rs                # 森空岛签名原语（RSA/AES/3DES）
│   │   │   ├── http_client.rs            # HTTP 客户端
│   │   │   ├── logger.rs                 # 日志（文件 + 内存环形缓冲）
│   │   │   ├── paths.rs                  # 应用目录
│   │   │   └── error.rs                  # AppError
│   │   ├── tray.rs                       # 托盘图标与面板窗口
│   │   ├── lib.rs                        # 插件注册、状态托管、启动任务
│   │   └── main.rs
│   ├── capabilities/                     # 权限配置
│   ├── icons/                            # 应用图标
│   ├── tauri.conf.json                   # 窗口、打包、更新配置
│   └── Cargo.toml
├── docs/                                 # 开发文档
│   ├── project_structure.md              # 项目结构总览
│   ├── frontend_development.md           # 前端开发规范
│   ├── backend_development.md            # 后端开发规范
│   ├── api_communication.md              # 前后端 IPC 契约
│   ├── card_development.md               # 卡片开发指南
│   └── card_configuration.md             # 卡片配置与数据迁移
├── public/assets/icons/                  # 游戏数据图标（职业 / 属性 / 潜能等）
├── .github/workflows/release.yml         # 自动构建与发布
├── index.html                            # 主窗口入口
├── tray-panel.html                       # 托盘面板入口
└── vite.config.ts
```

## 快速开始

### 环境要求

- **Node.js** 20+（CI 使用 Node 24）
- **pnpm** 10（包管理器，仓库使用 `pnpm-lock.yaml`）
- **Rust** 最新稳定版
- **Windows** 构建环境（当前发布目标为 `x86_64-pc-windows-msvc`）

### 安装

```bash
git clone https://github.com/soldiereleven/endprotocol.git
cd endprotocol

pnpm install
```

### 开发

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

## 使用说明

### 账户登录

1. 进入「账户」页面，点击「添加账户」
2. 选择登录方式：
   - **手机号 + 密码**
   - **验证码**：输入手机号获取短信验证码
   - **扫码**：用森空岛 / 鹰角通行证 App 扫描二维码
3. 多角色账户登录后需在弹窗中选择要同步的角色
4. 登录成功后账户出现在列表中

### 仪表板

- 点击右下角悬浮按钮或侧边栏添加卡片
- **长按卡片约 1.2 秒**进入编辑模式，随后可拖拽调整位置与顺序
- 右键卡片可切换角色、打开设置、选择勋章、切换领域或删除
- 通过标签页把卡片分组管理

### 游戏启动器

1. 点击标题栏的模式切换按钮进入**游戏模式**
2. 在操作面板中选择渠道（官服 / B 服 / 国际服 / Google Play），并指定安装目录——目录会被自动扫描并识别渠道
3. 若目录为空则执行**安装**，已有安装则检测版本并提供**更新**
4. 可选操作：
   - **校验修复**：快速或完整校验，损坏文件自动重新下载
   - **预下载**：提前下载新版本
   - **切换渠道**：在已安装渠道之间迁移，含进度与取消回滚
   - **启动游戏** / **结束进程**
5. 底部信息栏展示官方 Banner 与公告，点击在内置浏览器中打开

### 系统托盘

- 关闭主窗口时默认弹出询问（可在设置中改为直接关闭或最小化到托盘）
- 双击托盘图标唤起主窗口；右键弹出托盘面板
- 面板展示所选账户的理智、每日活跃、每周事务与通行证进度

### 设置

| 分组 | 可配置项 |
| --- | --- |
| 通用 | 语言、切换账户时刷新、详情懒加载、Wiki 预加载、关闭行为、托盘账户 |
| 游戏启动 | 校验修复线程数 |
| 外观 | 主题模式、强调色、自定义配色、背景图片与透明度、窗口背景透明度 |
| 开发者 | 开发者模式（开启后显示开发者工具页） |
| 更新 | 更新通道（稳定 / 预览）、更新源（GitHub / 镜像）、版本信息 |

## 架构说明

### 前后端通信

```
┌──────────────────────────────┐
│  React 前端                  │
│  invoke() 调用 / 事件订阅    │
└───────────┬──────────────────┘
            │ Tauri IPC
            ▼
┌──────────────────────────────┐
│  Commands 层（13 个模块）    │
│  参数校验、状态加锁、事件发射│
└───────────┬──────────────────┘
            ▼
┌──────────────────────────────┐
│  Services 层（10 个模块）    │
│  业务逻辑、缓存、加密签名    │
└───────────┬──────────────────┘
            ▼
┌──────────────────────────────┐
│  外部服务                    │
│  森空岛 / 鹰角账户 / 启动器  │
│  API / 抽卡接口 / 资源 CDN   │
└──────────────────────────────┘
```

### 后端托管状态

`lib.rs` 中通过 `manage` 托管的共享状态：

| 状态 | 锁类型 | 说明 |
| --- | --- | --- |
| `ConfigService` | `std::sync::Mutex` | `app_config.json` 读写 |
| `AccountService` | `tokio::sync::Mutex` | 账户、登录、凭证、自动签到 |
| `GameLauncherService` | `tokio::sync::Mutex` | 启动器全部操作串行执行 |
| `GachaService` | `Arc`（内含 `AppHandle`） | 抽卡同步与进度事件 |

### 启动任务

应用启动时（`lib.rs`）依次完成：

1. 初始化日志系统（文件 + 内存环形缓冲）与 `tracing` 桥接
2. 注册 4 个 Tauri 插件
3. 创建托盘图标
4. 启动**定时任务**：每 300 秒刷新账户数据，并为开启自动签到的角色执行签到
5. 注册主窗口关闭事件：按 `close_action` 配置决定关闭、最小化到托盘或弹窗询问

前端 `main.tsx` 在首屏渲染**之前**读取配置并应用主题（避免闪烁），渲染后依次加载卡片注册表、执行卡片启动任务、3 秒后检查更新、5 秒后向托盘推送数据。

### 实时事件

界面状态由后端事件驱动，而非轮询或 localStorage 持久化：

| 事件名 | 载荷 | 方向 |
| --- | --- | --- |
| `launcher-progress` | `DownloadProgress`（阶段、字节、文件序号） | 安装 / 校验 / 预下载进度 |
| `launcher://progress` | `ActiveOperation`（内含 `type` 标签） | 当前操作快照 |
| `launcher://switch-progress` | `SwitchProgress`（含源 / 目标渠道） | 渠道切换进度 |
| `gacha-sync-progress` | `GachaSyncProgress`（标签页、页码、累计数） | 抽卡同步进度 |
| `accounts-refreshed` | `AccountRefreshResult` | 手动刷新与定时刷新共用 |
| `download-progress` | `{ downloaded, total }` | 应用自身更新下载 |
| `tray-user-info-updated` | `TrayUserInfo` | 仅发往托盘面板窗口 |

**操作状态推导**：后端 `ActiveOperation` 是一个内存态枚举（`installing` / `verifying` / `repairing` / `switching`）。前端 `game-action-panel.tsx` 订阅上述事件，把最新事件写入 `localActiveOp`，再按优先级合并：

```
activeOp = localActiveOp ?? gameStatus.active_operation ?? null
```

界面按钮与进度全部由 `activeOp` 派生。操作状态**不再写入 localStorage**；界面重启后通过 `launcher_check_status` 返回的 `active_operation` 快照恢复真实状态。

### 渠道切换流水线

`GameLauncherService::switch_channel` 采用 5 阶段流水线，全程可通过 `SWITCH_CANCELLED` 取消并回滚：

| 阶段 | `phase` | 行为 |
| --- | --- | --- |
| 1 | `checking` | 拉取两个渠道的清单，按路径比对 MD5 与大小，生成「需下载」与「需删除」列表；若两者皆空则直接返回 |
| 2 | `downloading` | 下载差异文件到暂存目录 `.switch.download`；优先复用 `.switch/<渠道>/` 中的备份，失败则清理暂存并中止 |
| 3 | `backing_up` | 把待删除文件备份到 `.switch/<源渠道>/` 后删除原文件 |
| 4 | `moving` | 把暂存文件复制到游戏目录 |
| 5 | `completed` | 清理暂存目录并结束操作 |

取消时按相反顺序回滚：删除暂存文件、从备份还原原文件、移除已移动的文件。

### 服务层职责

| 服务 | 职责 |
| --- | --- |
| `GameLauncherService` | 版本检查、清单解密、差异计划、断点续传下载、校验修复、预下载、渠道切换 |
| `AccountService` | 登录（密码 / 短信 / 扫码）、凭证交换与刷新、签到、账户缓存、定时任务 |
| `SklandService` | 森空岛 API 调用、请求签名、设备指纹 (dId) 获取与缓存 |
| `GachaService` | 抽卡记录增量同步、本地持久化、统计 |
| `CharDetailService` | 角色详情获取与缓存、远程图片本地化 |
| `CharWikiDetailService` | Wiki 词条详情（内存 → 磁盘 → API 三级）与预加载 |
| `ConfigService` | `app_config.json` 全量读写 |
| `ImageCacheService` | 9 类图片子目录的缓存与清理 |
| `NetworkService` | 按 API 名分发数据查询请求 |
| `DataQuery` | JSON 路径提取（支持 `chars.0.charData.id` 与 `chars.[0].name`） |

### 卡片系统

卡片通过 `import.meta.glob` **自动发现**，无需手动注册：

```
src/components/cards/
├── registry/
│   ├── types.ts      # CardMeta / BaseCardProps / CardModule
│   └── loader.ts     # 自动扫描 index.tsx、*.meta.json、locales/*.json
├── base/
│   ├── card-wrapper.tsx   # 错误边界 + Suspense
│   └── use-card-data.ts   # 统一数据获取 hook
└── <card-name>/
    ├── <card-name>.meta.json   # 元数据
    ├── index.tsx               # 默认导出的组件
    └── locales/{zh,en}.json    # 卡片翻译（合并进 card 命名空间）
```

**新增卡片**（详见 [docs/card_development.md](docs/card_development.md) 与 [_template/README.md](src/components/cards/_template/README.md)）：

1. 复制 `_template` 目录并重命名
2. 重命名并编辑 `*.meta.json`：`id`（全局唯一）、`name` / `description`（`{zh, en}` 对象）、`icon`、`defaultSize`
3. 在 `index.tsx` 中 **默认导出**组件，props 遵循 `BaseCardProps`；可选导出 `startup(roleId)` 注册启动任务
4. 在 `locales/` 下添加 `zh.json` / `en.json`，组件内以 `t("card:key")` 读取
5. 重启开发服务器，卡片自动出现在添加卡片对话框中

卡片实例的设置通过 `save_card_settings` 持久化到 `app_config.json` 的 `card_settings.{cardId}` 下。

## 配置说明

### 应用数据目录

所有本地数据集中存放在：

```
%LOCALAPPDATA%\cn.msk-network.endprotocol\
├── app_config.json          # 全部应用配置与卡片设置
├── image_cache/             # 图片缓存（avatars、skill_icons、weapon_icons 等 9 类）
├── backgrounds/             # 自定义背景图
├── wiki_detail_cache/       # Wiki 词条磁盘缓存
├── gacha_records/           # 抽卡记录（按 userId_serverId 分文件）
└── logs/                    # 日志 app-<日期>.log
```

### 窗口配置

位于 `src-tauri/tauri.conf.json`：

- **主窗口**：1200 × 700，无边框、透明、居中、可调整大小，Windows 亚克力效果
- **托盘面板窗口**：260 × 340，无边框、置顶、不占任务栏、默认隐藏
- **打包**：Windows NSIS（当前用户安装，含简中与英文）、macOS Intel/Apple Silicon DMG、Linux x64 AppImage

### 更新系统

| 通道 | 版本格式 | 说明 |
| --- | --- | --- |
| Stable | `x.y.z` | 正式版本 |
| Preview | `x.y.z-<后缀>` | 预览版 / 测试版 |

| 更新源 | 端点 |
| --- | --- |
| 镜像 | `updates.msk-network.cn/{stable,preview}/latest.json`（Cloudflare R2 同步） |
| GitHub | `github.com/soldiereleven/endprotocol/releases` |

Windows、macOS 与 Linux 均通过 Tauri updater 插件更新，下载包经 minisign 签名验证；预览频道也按当前平台的 updater 包安装。Linux 仅发布 AppImage：应用主动下载签名后的新 AppImage 并替换当前文件，无需依赖发行版包管理器或软件仓库。Windows 使用 NSIS 静默安装，macOS/Linux 安装后由应用重新启动。

## CI/CD

`.github/workflows/release.yml` 在推送 `v*` 标签时触发：

1. **同步版本号**：去掉标签的 `v` 前缀，写入 `package.json` 与 `src-tauri/tauri.conf.json`
2. **判定通道**：版本号带后缀 → `preview`，否则 `stable`；并查找同通道的上一个标签
3. **生成更新日志**：按 Conventional Commits 分类（Features / Bug Fixes / Documentation / Refactoring / Performance / Tests / Chores），写入 `CHANGELOG.md`
4. **并行构建**：Node 24 + pnpm 10 + Rust stable，构建 Windows x64、Linux x64 AppImage、macOS Intel 与 Apple Silicon 安装包及签名 updater 包
5. **生成更新清单**：将各平台的 updater 包与 minisign 签名汇总到 Release 的 `latest.json`；GitHub 预览更新通过对应预览 tag 的清单检查
6. **发布**：先创建草稿 Release，再将其公开并标记是否为预发布

需要配置的 Secrets：`TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`（`GITHUB_TOKEN` 由 Actions 自动提供）。

## 开发文档

**先看 [docs/README.md](docs/README.md)**：文档总索引 + 「我想找 X → 打开哪个文件」快速定位表 + IPC 命令索引。定位代码位置优先查 `docs/reference/`（27 篇逐文件功能参考，含行号），无需通读源码。

| 文档 | 内容 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | **Agent 工作约定**：先查索引再读源码、编码与验证规范、完成改动后必须同步更新索引 |
| [docs/README.md](docs/README.md) | 文档总索引、快速定位表、文件参考清单 |
| [docs/reference/](docs/reference/) | 逐文件功能参考（前端 18 篇 + 后端 8 篇 + `ipc_index.md` 命令对照表，共 27 篇） |
| [docs/project_structure.md](docs/project_structure.md) | 项目结构与三条核心数据流 |
| [docs/frontend_development.md](docs/frontend_development.md) | 前端目录约定、编码规范、扩展方式 |
| [docs/backend_development.md](docs/backend_development.md) | Rust 分层、编码规范、加密与签名说明 |
| [docs/api_communication.md](docs/api_communication.md) | Tauri IPC 契约与错误处理规则 |
| [docs/card_development.md](docs/card_development.md) | 卡片开发完整指南 |
| [docs/card_configuration.md](docs/card_configuration.md) | 卡片配置存储结构与迁移指南 |

### 推荐 IDE 扩展

- [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 许可证

Copyright (C) 2026 MSK Network

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, version 3.

## 为什么使用 AGPL v3.0 而不是 MIT

本项目采用了 GNU Affero General Public License（AGPL），而不是更常见的 MIT License。这里简单说明一下原因。

我们选择 AGPL，并不是为了限制使用，而是为了确保项目在被使用和改进的过程中，依然能够对整个社区保持开放和可持续。

在一些场景下，如果使用像 MIT 这样非常宽松的许可证，项目可能会被集成到闭源系统中进行扩展，而这些改进不会回馈社区。长期来看，这会削弱开源项目本身的演进能力。

AGPL 的设计初衷是解决这个问题：

- 如果你修改了本项目并对外提供服务，需要公开这些修改
- 如果你基于本项目构建并分发软件，需要遵循相同的开源规则

这意味着所有改进都有机会回到社区，而不是被封闭在某个私有系统中。

同时，我们仍然希望这个项目是可用、可学习、可扩展的：

- 你可以自由地使用、研究、修改代码
- 你可以在个人项目或开源项目中使用它
- 我们不会对正常的开发和学习场景设置额外障碍

我们理解不同项目对许可证的需求不同。如果你的使用场景与 AGPL 不兼容，也欢迎与我们联系讨论其他授权方式。

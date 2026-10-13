# 项目结构与运行流程说明

> 找具体代码位置请查 [README.md](README.md) 的**快速定位表**，或直接进入 [reference/](reference/)（逐文件功能参考，含行号）。

## 1. 项目概述

EndProtocol 是一个基于 Tauri 2.x 和 React 19 构建的桌面应用程序，主要用于集成森空岛（Skland）API，提供多账户管理、角色数据查询与展示、每日签到、抽卡统计、游戏启动器等功能。

## 2. 技术栈

- **前端**: React 19, TypeScript, Vite, Tailwind CSS, HeroUI/Glass 组件, i18next, @dnd-kit/core, echarts, react-router-dom
- **后端**: Tauri 2.x, Rust, reqwest, tokio, serde, tracing（加密：aes / rsa / hmac、数美相关 hg_crypto）
- **通信**: Tauri Invoke (IPC) + `emit`/`listen` 事件；卡片间用 `window` CustomEvent

## 3. 目录结构

```
EndProtocol/
├── docs/                          # 文档（先读 docs/README.md）
│   ├── README.md                  # 总索引 + 快速定位表
│   ├── project_structure.md       # 本文件
│   ├── frontend_development.md    # 前端规范
│   ├── backend_development.md     # 后端规范
│   ├── api_communication.md       # IPC 契约与数据流
│   ├── card_development.md        # 卡片开发指南
│   ├── card_configuration.md      # 卡片配置系统
│   └── reference/                 # ★ 逐文件功能参考（27 篇）
│       ├── ipc_index.md           # 99 个命令 ↔ 定义 ↔ 调用方
│       ├── frontend/  (18 篇)
│       └── backend/   (9 篇)
├── index.html                     # 主窗口入口
├── tray-panel.html                # 托盘面板入口
├── promotional-cover.html / promotional-demo.html   # 宣传页
├── public/  prom-assets/          # 静态图片资源
├── responses/                     # 抓取的 API 响应样本（联调用）
├── wiki_data/                     # Wiki 派生数据（可为空）
├── src/                           # ===== 前端源码 =====
│   ├── main.tsx                   # 应用挂载、全局初始化、托盘事件
│   ├── App.tsx                    # 路由表与登录态跳转
│   ├── provider.tsx / i18n.ts     # 全局 Provider / i18n 初始化
│   ├── tray-panel.tsx             # 托盘面板窗口入口
│   ├── pages/                     # 10 个页面：dashboard、account、char-select、
│   │                              #   characters、gacha-records、attendance、
│   │                              #   medals、todo、settings、developer
│   ├── layouts/                   # dashboard / default 布局
│   ├── components/
│   │   ├── ui/                    # 36 个通用 UI 组件 + glass/
│   │   ├── cards/                 # 卡片系统：registry/ base/ card-container + 各卡片
│   │   │   ├── registry/          #   自动发现与注册（loader/types）
│   │   │   ├── base/              #   CardWrapper、useCardData
│   │   │   ├── _template/         #   新卡片模板
│   │   │   └── <card-name>/       #   11 张卡片（含 locales/、*.meta.json；
│   │   │                          #   含新增 system-resource/、todo/）
│   │   └── *.tsx                  # 弹窗/面板/侧栏/图表等大组件
│   ├── utils/                     # 18 个服务封装与工具（accountService、
│   │                              #   configService、roleDataService、updateService…）
│   ├── types/                     # TS 类型（card-settings、charDetail、gacha、dashboard）
│   ├── locales/{zh,en}/           # 国际化资源
│   ├── styles/globals.css         # 全局样式与主题变量
│   ├── stores/ hooks/ lib/ config/ cards/  # zustand 风格 store、hooks、工具
│   │                              #   （含 todoStore.ts：To-Do 单一数据源）
├── src-tauri/                     # ===== 后端源码 =====
│   ├── src/main.rs                # 进程入口
│   ├── src/lib.rs                 # 插件/状态/菜单/托盘/命令注册（100 个命令）
│   ├── src/tray.rs                # 托盘图标与菜单
│   ├── src/commands/              # 14 个文件：IPC 命令入口
│   ├── src/services/              # 12 个服务：account、skland、game_launcher、
│   │                              #   gacha、char_detail、char_wiki、config、
│   │                              #   avatar_cache、data_query、network、
│   │                              #   system_resource
│   ├── src/models/                # 7 个文件：序列化数据结构
│   ├── src/utils/                 # error、encrypt、hg_crypto、http_client、
│   │                              #   logger、official_launcher、paths、capture
│   ├── capabilities/  tauri.conf.json  Cargo.toml
│   └── gen/                       # Tauri 自动生成（勿手改）
├── dist/  target/  node_modules/  # 构建产物与依赖（勿读）
└── .github/workflows/release.yml  # 发布流水线
```

## 4. 项目运行流程

1. **启动阶段**：
   - `src-tauri/src/main.rs` 启动 Tauri 应用；`lib.rs` 注册插件、State（`Arc<Mutex<AccountService>>`、`Arc<Mutex<ConfigService>>`、`Arc<GachaService>` 等）、菜单、托盘与 99 个命令。
   - 前端 `src/main.tsx` 挂载 React、初始化 i18n、主题、日志与托盘事件监听。
2. **前端加载**：
   - `src/App.tsx` 挂载路由，根据用户登录状态跳转至仪表板或账户页。
3. **数据交互**：
   - 前端通过 `@tauri-apps/api/core` 的 `invoke` 调用后端命令（多经 `src/utils/*Service.ts` 封装）。
   - 后端执行异步任务（API 请求、加密解密、文件读写），通过 `Result<T, AppError>` 返回。
   - 后端主动推送用 `emit`（如启动器进度、主题变更），前端 `listen` 订阅。
4. **持久化**：
   - 配置信息由 `ConfigService` 存储在本地 `app_config.json`（键值 + 点号路径，如 `card_settings.{cardId}`）。
   - 图片经 `ImageCacheService`/`AvatarCacheService` 本地缓存；抽卡记录、Wiki 详情各自落盘。

## 5. 核心业务流程

- **账户登录**：输入手机号/密码（或验证码、扫码）→ 生成设备标识 → 下发/提交验证码 → 登录获取 `token`/`cred` → 写入 `AccountService` 与 `account_token_{userId}`。
- **角色数据**：懒加载策略（`set_lazy_load_enabled`）→ 统一经 `query_role_data` → 首次访问从森空岛获取 → 存入内存并同步本地缓存。
- **仪表板**：多标签页（`dashboard_tabs`）→ 拖拽/增删卡片 → `dashboardConfig.ts` 计算位置 → `set_config` 落盘；卡片内部设置另存 `card_settings.{cardId}`。
- **卡片系统**：`registry/loader.ts` 用 `import.meta.glob` 自动发现 `src/components/cards/*/{name}.meta.json + index.tsx`，无需手工注册。
- **系统资源卡片**：`system-resource/index.tsx` 按 `refreshMs` 轮询 `get_system_snapshot`（`SystemResourceService`，`spawn_blocking` + `sysinfo`/`nvidia-smi`），按 `layout` 渲染单指标或卡片组；默认值存 `system_resource_defaults`。
- **To-Do**：`todoStore.ts` 是全应用唯一数据源（持久化 `todo_lists`），卡片内联、`pages/todo.tsx` 页面与 `todo-modal.tsx` 弹窗三处共用 `TodoDetail`，经订阅 + `todoChanged` 事件实时同步。
- **启动器**：`game-action-panel.tsx` → `launcherService.ts` → `commands/launcher.rs` → `GameLauncherService`（下载/校验/切服/进程），进度经事件推送。

## 6. 本文件与其他文档的关系

| 想做什么 | 读哪篇 |
| --- | --- |
| 找代码位置 | [README.md](README.md) 快速定位表 → `reference/**` |
| 前端写新页面/组件 | [frontend_development.md](frontend_development.md) |
| 后端写新命令/服务 | [backend_development.md](backend_development.md) |
| 理解 IPC 与数据流 | [api_communication.md](api_communication.md) |
| 新增卡片 | [card_development.md](card_development.md) |
| 卡片配置存储 | [card_configuration.md](card_configuration.md) |

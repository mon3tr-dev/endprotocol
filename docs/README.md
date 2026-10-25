# EndProtocol 文档中心

本目录分两类文档，给不同用途：

| 类别 | 位置 | 用途 | 何时读 |
| --- | --- | --- | --- |
| **开发指南** | `docs/*.md`（6 篇） | 规范、流程、扩展方法（怎么写代码） | 动手改代码之前 |
| **文件参考** | `docs/reference/**/*.md`（28 篇） | 每个源文件做什么、符号在哪一行（代码在哪） | **找位置时先读这里，不用翻源码** |

> **给 Agent 的约定**（完整版见仓库根目录 [AGENTS.md](../AGENTS.md)）：需要定位某个功能/命令/类型的实现位置时，先查下面的「快速定位表」和 `reference/` 文档；只有在 reference 与代码不符或需要看完整实现时才打开源码。reference 文档中的行号基于生成时的代码版本，若已发生改动，以源码为准并同步更新文档。**完成改动后必须同步更新受影响的 reference 文档与索引。**

---

## 1. 快速定位表（我想找 X → 打开哪个文件）

### 1.1 业务功能

| 需求 | 入口（源文件） | 详细参考 |
| --- | --- | --- |
| 账户登录（密码/验证码/扫码）、登出、刷新 | `src/pages/account.tsx`、`src/utils/accountService.ts` | [pages_account.md](reference/frontend/pages_account.md)、[utils_services_a.md](reference/frontend/utils_services_a.md)、[services_account.md](reference/backend/services_account.md) |
| 账户不可用 / 重新登录（不强制输手机号、扫码校验账户身份） | `src/utils/accountAvailability.ts`、`src/pages/account.tsx`（`handleOpenRelogin` / `finishRelogin`）、后端 `AccountService::complete_login_from_token` 的 `expected_user_id` 校验 | [utils_services_b.md](reference/frontend/utils_services_b.md)、[pages_account.md](reference/frontend/pages_account.md)、[services_account.md](reference/backend/services_account.md) |
| 数美设备指纹频繁失败（重启电脑 + 同步时区提示） | `src-tauri/src/services/skland_service.rs`（`fetch_new_did`）、`src-tauri/src/utils/api_health.rs`（`DeviceFingerprint`）、`src/utils/crashReporting.ts` | [services_skland.md](reference/backend/services_skland.md)、[utils.md](reference/backend/utils.md)、[utils_services_b.md](reference/frontend/utils_services_b.md) |
| 森空岛用户资料（昵称/头像/游戏等级） | `src/utils/accountService.ts` → `get_skland_user_info` | [services_account.md](reference/backend/services_account.md)、[services_skland.md](reference/backend/services_skland.md) |
| 角色（干员）数据查询与缓存 | `src/utils/roleDataService.ts`、`roleDetailService.ts` | [utils_services_a.md](reference/frontend/utils_services_a.md)、`query_role_data` 见 [commands.md](reference/backend/commands.md) |
| 干员列表卡片 / 选择弹窗（实际生效实现） | `src/components/cards/character-list/char-select-modal.tsx` | [cards_character_list.md](reference/frontend/cards_character_list.md) |
| 卡片自动发现与注册 | `src/components/cards/registry/loader.ts` | [cards_core.md](reference/frontend/cards_core.md) |
| 应用启动 Splash 与初始数据加载 | `index.html`、`src/utils/startupProgress.ts` | [entry_and_app.md](reference/frontend/entry_and_app.md)、[utils_services_b.md](reference/frontend/utils_services_b.md) |
| 卡片内部配置存取 | `src/utils/cardConfigService.ts`、`commands/card_config.rs` | [utils_services_a.md](reference/frontend/utils_services_a.md)、[card_configuration.md](card_configuration.md) |
| 系统资源卡片（原子/卡片组、指标配置） | `src/components/cards/system-resource/`、`src/utils/systemResourceService.ts`、`commands/system_resource.rs` | [cards_system_todo.md](reference/frontend/cards_system_todo.md)、[services_others.md](reference/backend/services_others.md) |
| To-Do 卡片 / 页面 / 弹窗 | `src/components/cards/todo/`、`src/stores/todoStore.ts`、`src/pages/todo.tsx` | [cards_system_todo.md](reference/frontend/cards_system_todo.md) |
| 卡片全局默认值（系统资源 / To-Do） | `src/components/system-resource-settings.tsx`、`src/components/todo-settings.tsx` | [cards_system_todo.md](reference/frontend/cards_system_todo.md) |
| 仪表板布局 / 标签页（多 Tab） | `src/pages/dashboard.tsx`、`src/utils/dashboardConfig.ts` | [pages_core.md](reference/frontend/pages_core.md)、[utils_services_a.md](reference/frontend/utils_services_a.md) |
| 每日签到 | `src/components/cards/attendance/index.tsx`、`pages/attendance.tsx`、`commands/attendance.rs` | [cards_attendance_domain_spaceship.md](reference/frontend/cards_attendance_domain_spaceship.md)、[commands.md](reference/backend/commands.md) |
| 抽卡记录同步与统计 | `src/pages/gacha-records.tsx`、`services/gacha_service.rs` | [pages_game_data.md](reference/frontend/pages_game_data.md)、[services_others.md](reference/backend/services_others.md) |
| 抽卡图表与逐池六星间隔统计 | `src/components/gacha-pity-chart.tsx`、`gacha-stat-charts.tsx`、`src/utils/gachaIntervals.ts` | [components_sidebar_charts.md](reference/frontend/components_sidebar_charts.md)、[utils_services_b.md](reference/frontend/utils_services_b.md) |
| 启动器：下载/校验/切服/进程管理 | `src/components/game-action-panel.tsx`、`src/utils/launcherService.ts` | [components_game_action_panel.md](reference/frontend/components_game_action_panel.md)、[utils_services_a.md](reference/frontend/utils_services_a.md)、[services_launcher.md](reference/backend/services_launcher.md) |
| 启动游戏 / 免启动器启动 / 为什么要 UAC / Steam Overlay 注入链 | `src-tauri/src/commands/launcher.rs`（`launcher_start_game`）、`src-tauri/src/utils/official_launcher.rs` | [commands.md](reference/backend/commands.md)、[utils.md](reference/backend/utils.md) |
| 静默启动、单实例转发、游戏快捷方式与命令行、Steam 第三方游戏注入（名字/图标/DX11/Overlay 管理员快捷方式）、DX11 启动（`--dx11` / `-force-d3d11`） | `src-tauri/src/lib.rs`、`src-tauri/src/commands/startup.rs`、`src-tauri/src/utils/steam.rs`、`src-tauri/src/utils/game_icon.rs`、`src/components/game-launch-settings.tsx` | [bootstrap.md](reference/backend/bootstrap.md)、[commands.md](reference/backend/commands.md)、[utils.md](reference/backend/utils.md)、[components_settings_panels.md](reference/frontend/components_settings_panels.md) |
| 应用自更新 | `src/utils/updateService.ts`、`commands/updater.rs` | [utils_services_b.md](reference/frontend/utils_services_b.md)、[commands.md](reference/backend/commands.md) |
| 外观设置（主题/背景/取色） | `src/components/appearance-settings.tsx` | [components_settings_panels.md](reference/frontend/components_settings_panels.md) |
| 设置页 / 开发者页 | `src/pages/settings.tsx`、`src/pages/developer.tsx` | [pages_settings_developer.md](reference/frontend/pages_settings_developer.md) |
| 托盘与托盘面板 | `src-tauri/src/tray.rs`、`src/components/tray-panel.tsx`、`src/tray-panel.tsx` | [bootstrap.md](reference/backend/bootstrap.md)、[components_settings_panels.md](reference/frontend/components_settings_panels.md)、[entry_and_app.md](reference/frontend/entry_and_app.md) |
| 窗口控制（最小化/最大化/关闭/托盘化） | `src/components/custom-titlebar.tsx`、`commands/window.rs` | [components_dialogs.md](reference/frontend/components_dialogs.md)、[commands.md](reference/backend/commands.md) |
| 屏幕取色器 | `src/components/screen-color-picker.tsx`、`commands/color_picker.rs` | [components_dialogs.md](reference/frontend/components_dialogs.md) |
| 图片缓存与背景图管理 | `src/utils/imageCacheManager.ts`、`commands/image.rs`、`services/avatar_cache_service.rs` | [utils_services_b.md](reference/frontend/utils_services_b.md)、[services_others.md](reference/backend/services_others.md) |
| Wiki 表格/技能描述解析 | `src/utils/wikiTableParser.ts`、`skillDescParser.tsx` | [utils_services_b.md](reference/frontend/utils_services_b.md) |
| 网络代理（HTTP / SOCKS5、系统代理读取、连通性测试） | `src/components/network-settings.tsx`、`src/utils/proxyService.ts`、`src-tauri/src/commands/proxy.rs`、`src-tauri/src/utils/proxy.rs` | [components_settings_panels.md](reference/frontend/components_settings_panels.md)、[utils_services_a.md](reference/frontend/utils_services_a.md)、[commands.md](reference/backend/commands.md)、[utils.md](reference/backend/utils.md) |
| 网络抓包（开发者页） | `src-tauri/src/utils/capture.rs` | [utils.md](reference/backend/utils.md) |

### 1.2 横切关注点

| 需求 | 位置 | 详细参考 |
| --- | --- | --- |
| **IPC 命令在哪定义 / 前端谁调用** | 生成的对照表 | [ipc_index.md](reference/ipc_index.md)（127 个命令全表） |
| 新增/修改一个 Tauri 命令 | `src-tauri/src/commands/`、`src-tauri/src/lib.rs` | [commands.md](reference/backend/commands.md)、[bootstrap.md](reference/backend/bootstrap.md)、[backend_development.md](backend_development.md) |
| 错误类型与转换 | `src-tauri/src/utils/error.rs` | [utils.md](reference/backend/utils.md) |
| 加密与签名（RSA/AES/DES/HMAC） | `src-tauri/src/utils/hg_crypto.rs`、`services/skland_service.rs` | [utils.md](reference/backend/utils.md)、[services_skland.md](reference/backend/services_skland.md) |
| HTTP 客户端与超时 | `src-tauri/src/utils/http_client.rs` | [utils.md](reference/backend/utils.md) |
| 日志（前端/后端） | `src/utils/logger.ts`、`src-tauri/src/utils/logger.rs` | [utils_services_b.md](reference/frontend/utils_services_b.md)、[utils.md](reference/backend/utils.md) |
| 崩溃提示 / 日志导出 / 错因判断 / API 熔断 | `src/utils/crashReporting.ts`、`src/components/crash-report-host.tsx`、`src-tauri/src/utils/{crash,api_health,diagnostics}.rs` | [utils_services_b.md](reference/frontend/utils_services_b.md)、[ui_components.md](reference/frontend/ui_components.md)、[utils.md](reference/backend/utils.md) |
| 数据模型（结构体定义） | `src-tauri/src/models/` | [models.md](reference/backend/models.md) |
| TypeScript 类型 | `src/types/` | [types_locales_styles.md](reference/frontend/types_locales_styles.md) |
| 国际化文案 | `src/locales/{zh,en}/translation.json`、`src/i18n.ts` | [types_locales_styles.md](reference/frontend/types_locales_styles.md) |
| 全局样式 / 主题变量 / 玻璃拟态 | `src/styles/globals.css`、`src/utils/theme.ts` | [types_locales_styles.md](reference/frontend/types_locales_styles.md)、[utils_services_a.md](reference/frontend/utils_services_a.md) |
| 通用 UI 组件（按钮/弹窗/选择器…） | `src/components/ui/` | [ui_components.md](reference/frontend/ui_components.md) |
| 路由与应用入口 | `src/main.tsx`、`src/App.tsx` | [entry_and_app.md](reference/frontend/entry_and_app.md) |
| 卡片间事件联动 | `window` CustomEvent `"cardAction"` | [cards_core.md](reference/frontend/cards_core.md) |
| 状态事件（Tauri emit/listen） | 各 service / 组件的 `emit`/`listen` | 各 reference 文档的「备注」段落 |

---

## 2. 开发指南（6 篇）

| 文件 | 内容 |
| --- | --- |
| [project_structure.md](project_structure.md) | 项目概述、技术栈、目录结构、启动与核心数据流 |
| [frontend_development.md](frontend_development.md) | 前端目录约定、编码规范、新增卡片/页面/命令调用的方法 |
| [backend_development.md](backend_development.md) | Rust 分层、错误处理、异步与状态管理、加密签名说明 |
| [api_communication.md](api_communication.md) | IPC 机制、命名规范、登录/懒加载/配置同步等数据流 |
| [card_development.md](card_development.md) | 卡片插件化开发完整指南（3 步新增卡片、meta 契约、最佳实践） |
| [card_configuration.md](card_configuration.md) | 卡片配置存储结构、前后端 API、旧格式迁移 |

---

## 3. 文件参考（28 篇）

### 3.1 后端 `src-tauri/`

| 文件 | 覆盖范围 |
| --- | --- |
| [reference/backend/bootstrap.md](reference/backend/bootstrap.md) | `main.rs`、`lib.rs`（含全部命令注册清单）、`tray.rs`、`build.rs`、`Cargo.toml`、`tauri.conf.json`、`capabilities/*`、`examples/sign_test.rs` |
| [reference/backend/commands.md](reference/backend/commands.md) | `commands/` 全部 17 个文件、**126 处 `#[tauri::command]` 注解**：参数、返回值、内部调用链（含 `proxy.rs` 的 5 个代理命令） |
| [reference/backend/models.md](reference/backend/models.md) | `models/` 全部 7 个文件：79 个结构体/枚举的字段与 serde 映射 |
| [reference/backend/services_account.md](reference/backend/services_account.md) | `services/account_service.rs`（约 3100 行）：登录、凭证刷新、角色数据、状态中枢 |
| [reference/backend/services_skland.md](reference/backend/services_skland.md) | `services/skland_service.rs`：森空岛 API 端点总表、签名与加密流程 |
| [reference/backend/services_launcher.md](reference/backend/services_launcher.md) | `services/game_launcher_service.rs`（约 2960 行）：下载/校验/切服/进度事件 |
| [reference/backend/services_others.md](reference/backend/services_others.md) | `gacha_service`、`char_detail_service`、`char_wiki_detail_service`、`avatar_cache_service`、`config_service`、`data_query`、`network_service` |
| [reference/backend/utils.md](reference/backend/utils.md) | `utils/`：错误类型、加密、HTTP（含全局代理缓存）、**代理（`proxy`：配置解析/系统代理/连通性测试）**、日志、路径、抓包、进程探测（`process`）、游戏时长统计（`game_playtime`）、Steam 第三方游戏注入（`steam`）、exe 图标提取（`game_icon`）、崩溃捕获（`crash`）、API 熔断（`api_health`）、诊断导出（`diagnostics`） |
| [reference/ipc_index.md](reference/ipc_index.md) | 命令名 ↔ 后端定义位置 ↔ 前端调用方（脚本生成的对照表） |

### 3.2 前端 `src/`

| 文件 | 覆盖范围 |
| --- | --- |
| [reference/frontend/entry_and_app.md](reference/frontend/entry_and_app.md) | `main.tsx`、`App.tsx`（路由表）、`provider.tsx`、`i18n.ts`、`tray-panel.tsx`、`stores/`、`hooks/`、`lib/`、`config/site.ts`、`cards/startup-service.ts` |
| [reference/frontend/pages_core.md](reference/frontend/pages_core.md) | `layouts/*`、`pages/dashboard.tsx`、`attendance.tsx`、`medals.tsx` |
| [reference/frontend/pages_account.md](reference/frontend/pages_account.md) | `pages/account.tsx`（约 3600 行） |
| [reference/frontend/pages_char_select.md](reference/frontend/pages_char_select.md) | `pages/char-select.tsx`（约 2560 行，**未被路由引用的死代码副本**） |
| [reference/frontend/pages_settings_developer.md](reference/frontend/pages_settings_developer.md) | `pages/settings.tsx`（设置项清单）、`pages/developer.tsx` |
| [reference/frontend/pages_game_data.md](reference/frontend/pages_game_data.md) | `pages/characters.tsx`、`gacha-records.tsx` |
| [reference/frontend/components_dialogs.md](reference/frontend/components_dialogs.md) | 14 个弹窗与交互组件（标题栏、模态框、标签页、取色器、分页…） |
| [reference/frontend/components_settings_panels.md](reference/frontend/components_settings_panels.md) | `appearance-settings`（能力清单）、语言/主题切换、启动器设置、内嵌浏览器、托盘面板、更新弹窗 |
| [reference/frontend/components_game_action_panel.md](reference/frontend/components_game_action_panel.md) | `game-action-panel.tsx`（约 2400 行） |
| [reference/frontend/components_sidebar_charts.md](reference/frontend/components_sidebar_charts.md) | `dashboard-sidebar.tsx`（约 1700 行）、两个抽卡图表组件 |
| [reference/frontend/cards_core.md](reference/frontend/cards_core.md) | 卡片 `registry/`、`base/`、`card-container.tsx`、右键菜单、`_template/` |
| [reference/frontend/cards_character_list.md](reference/frontend/cards_character_list.md) | `character-list/`（含 3300 行的 `char-select-modal.tsx`） |
| [reference/frontend/cards_account_achievement.md](reference/frontend/cards_account_achievement.md) | `account-info/`、`account-progress/`、`achievement/` |
| [reference/frontend/cards_attendance_domain_spaceship.md](reference/frontend/cards_attendance_domain_spaceship.md) | `attendance/`、`domain-info/`、`spaceship/` |
| [reference/frontend/cards_system_todo.md](reference/frontend/cards_system_todo.md) | `system-resource/`、`todo/` 两类新卡片（含 `todoStore`、相关 types/utils/设置分区/`pages/todo.tsx`） |
| [reference/frontend/utils_services_a.md](reference/frontend/utils_services_a.md) | 账户/配置/**代理**/卡片配置/仪表板/角色/标签页/启动器等 12 个服务封装（含每个函数对应的命令名） |
| [reference/frontend/utils_services_b.md](reference/frontend/utils_services_b.md) | 更新、Wiki 解析、图片缓存、技能描述解析、日志、崩溃上报、诊断导出、滚动条、启动进度 |
| [reference/frontend/ui_components.md](reference/frontend/ui_components.md) | `src/components/ui/` 全部 37 个通用组件（含 `radio-group.tsx`）+ `primitives`/`icons`/`morph-icon`（含每个组件的 props） |
| [reference/frontend/types_locales_styles.md](reference/frontend/types_locales_styles.md) | `src/types/*`、`locales/*`（命名空间清单）、`globals.css`（主题变量体系） |

---

## 4. 仓库其他目录（非 `src`/`src-tauri`）

| 目录/文件 | 用途 |
| --- | --- |
| `responses/` | 抓取的森空岛/Wiki API 响应样本（`wiki_*.json`、`gacha/`、`weapon/` 等，共 28 个文件），用于联调与解析器调试 |
| `wiki_data/` | Wiki 数据的临时/派生数据目录（当前为空） |
| `public/` | Vite 静态资源（图标、`app-icon.png`） |
| `prom-assets/` | 宣传物料图片（`promotional-cover.html`、`promotional-demo.html` 使用） |
| `tray-panel.html` | 托盘面板的独立 HTML 入口（对应 `src/tray-panel.tsx`） |
| `index.html` | 主窗口 HTML 入口 |
| `.github/workflows/release.yml` | 发布流水线（Windows/Linux/macOS 安装包与 updater 签名清单） |
| `dist/`、`target/`、`node_modules/` | 构建产物与依赖，**不要阅读** |
| `src-tauri/gen/schemas/` | Tauri 自动生成的权限 schema，**不要手改** |

---

## 5. 文档维护约定

1. **改动代码时同步 reference**：新增/删除/重命名文件或导出符号后，更新对应 reference 文档的行号与表格。
2. **新增 Tauri 命令**后，重新生成 `reference/ipc_index.md`（脚本逻辑：扫描 `#[tauri::command]` 的下一个 `pub fn` 名，以及前端 `invoke("<name>")` 字面量），并更新 `commands.md`。
3. **新增卡片**遵循 [card_development.md](card_development.md)，其文件说明追加到对应的 `cards_*.md`。
4. reference 文档统一格式：`## 文件路径` → `职责/导出/主要依赖` → `符号表（符号｜行号｜说明）` → `备注（invoke 命令、配置键、事件名）`。
5. 发现文档与代码不一致时，**以代码为准**并修正文档。

### 5.1 重新生成 `reference/ipc_index.md`

在仓库根目录执行（PowerShell，会整体覆盖该文件）：

```powershell
$root=(Get-Location).Path; $be=@{}; $fe=@{}
Get-ChildItem src-tauri\src -Recurse -Filter *.rs | ForEach-Object { $f=$_.FullName
  Select-String -Path $f -Pattern '#\[tauri::command\]' -Context 0,2 | ForEach-Object {
    $nxt=($_.Context.PostContext -join ' ')
    if($nxt -match 'pub (async )?fn (\w+)'){
      $be[$Matches[2]] = (($f.Substring($root.Length+1) -replace '\\','/') + ':' + $_.LineNumber) } } }
Get-ChildItem src -Recurse -Include *.ts,*.tsx -File | ForEach-Object { $rel=$_.FullName.Substring($root.Length+1) -replace '\\','/'
  Select-String -Path $_.FullName -Pattern 'invoke\s*(?:<[^()]*>)?\s*\(\s*[''"]([a-z_0-9]+)[''"]' -AllMatches | ForEach-Object {
    $_.Matches | ForEach-Object { $c=$_.Groups[1].Value
      if(-not $fe[$c]){$fe[$c]=@()}; if($fe[$c] -notcontains $rel){$fe[$c]+=$rel} } } }
# 之后按 表头 + 数据行输出：命令名 | 定义位置（file:line） | 前端调用方列表
"commands=$($be.Count) invoked=$($fe.Count)"
```

注意：正则里的 `<[^()]*>` 用于兼容 `invoke<Record<string, any>>(...)` 这类嵌套泛型写法；不要用 `<[^>]*>`，会漏掉 `query_role_data` 等调用。


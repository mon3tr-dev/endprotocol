# 设置页与开发者页 — 文件功能参考

> 逐行精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## `src/pages/settings.tsx`
**文件职责**：应用「设置」路由页（`/settings`）的全部 UI 与状态管理。呈现通用偏好、外观、开发者模式开关、更新与关于信息，并负责把偏好写入配置服务（`configService`）或后端状态，附带三个确认对话框与更新对话框；Windows 额外显示游戏启动设置卡，macOS/Linux 隐藏该卡。
**导出**：`export default function SettingsPage()`（settings.tsx:41），仅此一个导出。
**主要依赖**：`react-i18next`（`useTranslation`）、`@/components/ui/glass`（GlassAlertDialog/GlassButton/GlassCard/GlassSelect/GlassSkeleton/GlassSwitch）、`@/components/game-launch-settings`（`GameLaunchSettings`）、`@/components/appearance-settings`（`AppearanceSettings`）、`react`（useState/useEffect/useRef/useCallback）、`react-dom`（`createPortal`）、`@tauri-apps/api/core`（`invoke`）、`@tauri-apps/api/app`（`getVersion`/`getTauriVersion`/`getIdentifier`）、`@/utils/configService`（`getConfig`/`setConfig`）、`@/utils/roleDetailService`、`@/utils/roleDataService`、`@/utils/accountService`（`getAccounts`）、`@/components/ui/settings-row`（`SettingsDivider`）、`@/utils/updateService`（`fetchRemoteVersion`/`getRemoteVersion`/`subscribeRemoteVersion`/`getChannel`/`setChannel`/`getSource`/`setSource`/`initializeChannel`）、`@/components/ui/global-alert`（`pushGlobalAlert`）、`@/components/update-dialog`（`UpdateDialog`）、`@/utils/platform`（`isWindowsPlatform`）。

### 内部结构总览
| 区间 | 内容 |
| --- | --- |
| settings.tsx:1-39 | import 区（UI 组件、子设置组件、Tauri API、配置/更新服务、对话框） |
| settings.tsx:41-78 | `SettingsPage` 组件开头：`t`/`i18n` 解构与全部 `useState`（语言下拉、6 个偏好、版本/更新状态、对话框可见性） |
| settings.tsx:80-83 | `languages` 常量（`en` / `zh` 两个选项） |
| settings.tsx:85-153 | 挂载 effect：`loadConfig()` 并行读取 9 项配置与应用版本信息 → 动态 import 载入账号列表 → `initializeChannel()` 后 `fetchRemoteVersion()`；并 `subscribeRemoteVersion` 订阅更新状态 |
| settings.tsx:155-169 | 语言下拉的外点/滚动关闭 effect（`mousedown` + 捕获阶段 `scroll`） |
| settings.tsx:171-198 | 5 个轻量 handler：语言切换、刷新开关、懒加载、Wiki 预加载、关闭行为 |
| settings.tsx:200-240 | `handleTrayUserChange`：写配置 → `set_tray_user` → 查 `char_detail` 汇总体力/活跃/周分/BP → `update_tray_user_data` |
| settings.tsx:242-261 | 开发者模式：`handleDevModeToggle`（开启先弹警告）与 `confirmDevMode`，均派发 `developerModeChange` 自定义事件 |
| settings.tsx:263-295 | `handleCheckUpdate`：拉取远端版本并用 `pushGlobalAlert` 反馈三种结果 |
| settings.tsx:297-359 | 更新通道/更新源切换与二次确认：`handleChannelChange`、`handleSourceChange`、`confirmPreviewChannel`、`confirmGithubSource`（stable→preview、mirror→github 各需确认） |
| settings.tsx:361-366 | effect：监听全局 `openUpdateDialog` 事件以打开更新对话框 |
| settings.tsx:368-374 | `platformInfo` IIFE：按 UA 推断 Windows x64 / macOS / Linux |
| settings.tsx:376-385 | 页头（`settings.title` + `common.managePreferences`） |
| settings.tsx:387-708 | 通用设置卡 `#settings-general`：加载骨架屏 408-449；语言下拉 452-554（按钮 + portal 菜单）；切换刷新 558-582；懒加载 586-608；Wiki 预加载 612-636；关闭行为 641-680；托盘用户 685-705 |
| settings.tsx:710-741 | Windows 上显示游戏启动设置卡 `#settings-game-launch`（整卡委托给 `GameLaunchSettings`，settings.tsx:739） |
| settings.tsx:743-763 | 外观设置卡 `#settings-appearance`（整卡委托给 `AppearanceSettings`，settings.tsx:762） |
| settings.tsx:765-819 | 开发者模式卡 `#settings-developer`：骨架屏 770-779，开关 797-815 |
| settings.tsx:821-1433 | 更新与关于卡 `#settings-about`：应用头像/更新状态徽标 843-874；更新通道 878-948；更新源 952-1022；版本四宫格 1026-1070；发布日期 1072-1077；「更新到 vX」按钮 1079-1105；「检查更新」按钮 1107-1136；identifier 1140-1143；License 1147-1158；开源致谢列表（20 项）1162-1293；特别鸣谢列表（2 项：Xel-Launcher / Better-Endfield，带致谢说明）1349-1389；GitHub/License 链接 1393-1431 |
| settings.tsx:1436-1468 | 开发者模式警告对话框（`GlassAlertDialog`） |
| settings.tsx:1471-1536 | 测试版通道警告对话框（内容为内联中英双语） |
| settings.tsx:1539-1609 | GitHub 源警告对话框（内容为内联中英双语） |
| settings.tsx:1611-1615 | `<UpdateDialog>` 更新安装对话框 |

### 组件与函数清单
| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SettingsPage`（default） | settings.tsx:41 | 页面根组件，返回 5 张卡片 + 3 个警告对话框 + `UpdateDialog` |
| `languages` | settings.tsx:80-83 | 语言选项常量：`{key:"en",label:"English"}`、`{key:"zh",label:"简体中文"}` |
| `refreshOnSwitch` 等偏好 state | settings.tsx:52-56 | `refreshOnSwitch`、`lazyLoadEnabled`、`wikiDetailPreload`、`closeAction`、`trayUserRoleId` |
| `accounts` | settings.tsx:57-59 | 托盘角色下拉用的账号列表（id/nickname/avatar） |
| `developerMode` / `showDevWarning` | settings.tsx:61-62 | 开发者模式开关与警告弹窗可见性 |
| `isConfigLoading` / `appVersion` / `tauriVersion` / `appId` | settings.tsx:63-66 | 加载态与 `@tauri-apps/api/app` 三元信息 |
| `isCheckingUpdate` / `remoteVersion` / `updateChannel` / `updateSource` | settings.tsx:67-71 | 更新检查状态、远端版本状态、通道与来源 |
| `showUpdateDialog` / `showPreviewWarning` / `showGithubWarning` / `pendingChannel` / `pendingSource` | settings.tsx:72-78 | 对话框可见性与待确认的通道/来源 |
| `isLangDropdownOpen` / `langDropdownPos` + 三个 ref | settings.tsx:43-51 | 语言下拉的开关、portal 定位与 DOM 引用 |
| `loadConfig`（effect 内部 async） | settings.tsx:86-139 | `Promise.all` 读 9 项；随后动态 import 账号、初始化更新通道/来源 |
| 初始化 effect | settings.tsx:85-153 | 调 `loadConfig`，完成后 `fetchRemoteVersion()`；订阅远端版本并清理 |
| 下拉关闭 effect | settings.tsx:155-169 | 菜单/按钮外点击或任意滚动（捕获）时关闭语言下拉 |
| `handleLanguageChange` | settings.tsx:171-174 | `i18n.changeLanguage(langKey)` 并关闭下拉 |
| `handleRefreshOnSwitchChange` | settings.tsx:176-179 | state + `setConfig("refresh_on_account_switch")` |
| `handleLazyLoadChange` | settings.tsx:181-188 | 调 `roleDetailService.setLazyLoadEnabled`，失败回滚 state |
| `handleWikiDetailPreloadChange` | settings.tsx:190-193 | state + `setConfig("wiki_detail_preload")` |
| `handleCloseActionChange` | settings.tsx:195-198 | state + `setConfig("close_action")` |
| `handleTrayUserChange` | settings.tsx:200-240 | 写 `tray_user_role_id` → `set_tray_user` → `roleDataService.queryData(roleId,"char_detail",["dungeon","bpSystem","dailyMission","weeklyMission"])` → 拼 `userInfo` 调 `update_tray_user_data` |
| `handleDevModeToggle` | settings.tsx:242-252 | 开启弹警告；关闭直接写 `developer_mode=false` 并派发 `developerModeChange` 事件 |
| `confirmDevMode` | settings.tsx:254-261 | 写 `developer_mode=true`、关警告、派发 `developerModeChange` |
| `handleCheckUpdate` | settings.tsx:263-295 | `fetchRemoteVersion()` 后按 `hasUpdate`/`error`/正常三路 `pushGlobalAlert` |
| `handleChannelChange` | settings.tsx:297-313 | stable→preview 先挂起 `pendingChannel` 并弹警告，否则直接 `setChannel` |
| `handleSourceChange` | settings.tsx:315-331 | mirror→github 先挂起 `pendingSource` 并弹警告，否则直接 `setSource` |
| `confirmPreviewChannel` | settings.tsx:333-345 | 确认后执行 `setChannel(pendingChannel)` 并清空挂起值 |
| `confirmGithubSource` | settings.tsx:347-359 | 确认后执行 `setSource(pendingSource)` 并清空挂起值 |
| `openUpdateDialog` effect | settings.tsx:362-366 | 监听全局 `openUpdateDialog` 事件打开更新对话框 |
| `platformInfo` | settings.tsx:368-374 | UA 推断平台字符串（Windows x64 / macOS / Linux / `navigator.platform`） |

### 设置项清单（对 settings.tsx 必填）
| 设置项 | 存储位置（配置键/state） | 控件 | 默认值 | 行号 |
| --- | --- | --- | --- | --- |
| 界面语言 | i18next 运行时 `i18n.language`（本文件**未**写入配置；`app.language` 由 `src/main.tsx:142` 读取、`src/components/language-switch.tsx:78` 写入） | 自定义下拉：`GlassButton` + `createPortal` 浮层菜单 | `en`（`i18n.ts:19` 初始值） | state 43-51；选项 80-83；handler 171-174；UI 452-554 |
| 切换账户时刷新数据 | 配置键 `refresh_on_account_switch`（state `refreshOnSwitch`） | `GlassSwitch` | `false` | state 52；读 99/109；写 178；UI 558-582 |
| 懒加载模式 | 后端持久状态，经 `roleDetailService`：invoke `is_lazy_load_enabled` / `set_lazy_load_enabled`（不走 `configService`） | `GlassSwitch` | `true`（读取失败时后端兜底 true，roleDetailService.ts:49） | state 53；读 100/110；写 184；UI 586-608 |
| 启动时预加载 Wiki 详情 | 配置键 `wiki_detail_preload`（state `wikiDetailPreload`） | `GlassSwitch` | `false` | state 54；读 102/111；写 192；UI 612-636 |
| 关闭窗口行为 | 配置键 `close_action`（state `closeAction`，取值 `close`/`minimize_to_tray`/`ask`） | 三段式文字按钮组 | `ask` | state 55；读 106/116；写 197；UI 641-680 |
| 托盘显示角色 | 配置键 `tray_user_role_id` + invoke `set_tray_user`、`update_tray_user_data`（state `trayUserRoleId`） | `GlassSelect`（选项来自 `getAccounts()` 账号昵称） | 空串（未选择） | state 56；读 107/117；写 200-240；UI 685-705 |
| 开发者模式 | 配置键 `developer_mode` + 窗口事件 `developerModeChange`（state `developerMode`） | `GlassSwitch` + `GlassAlertDialog` 二次确认 | `false` | state 61-62；读 101/112；写 247/256；UI 797-815；对话框 1436-1468 |
| 更新通道 | 配置键 `update_channel`（由 `updateService.getChannel/setChannel` 读写；state `updateChannel`） | 双卡片单选按钮（stable / preview） | `stable` | state 70；读 137；写 297-313、333-345；UI 878-948；警告框 1471-1536 |
| 更新源 | 配置键 `update_source`（由 `updateService.getSource/setSource` 读写；state `updateSource`） | 双卡片单选按钮（github / mirror） | `github` | state 71；读 138；写 315-331、347-359；UI 952-1022；警告框 1539-1609 |
| 游戏启动设置（整卡委托） | 子组件内：`@/stores/launcherMode`（zustand）与 `localStorage` 键（如 `CANCEL_BEHAVIOR_KEY`、`VERIFY_THREADS_KEY`），本文件不读写 | 子组件 `GameLaunchSettings` | 见子组件 | 710-741（渲染 739） |
| 外观设置（整卡委托） | 子组件内配置键：`theme_mode`、`theme_color`、`theme_custom_colors`、`bg_image_path`、`bg_image_opacity`、`bg_blur`、`glass_clarity` | 子组件 `AppearanceSettings` | 见子组件 | 743-763（渲染 762） |

**备注**：
- **invoke 命令名（本文件直接调用）**：`set_tray_user`（settings.tsx:204）、`update_tray_user_data`（settings.tsx:219，payload 为 `userInfo`：roleId/nickname/avatar/curStamina/maxStamina/maxTs/dailyActivation/maxDailyActivation/weeklyScore/weeklyTotal/bpCurLevel/bpMaxLevel，数值均 `Number(...) || 0` 兜底）。
- **invoke 命令名（经服务间接触发）**：`query_role_data`（`roleDataService.queryData`，roleDataService.ts:83）、`is_lazy_load_enabled` / `set_lazy_load_enabled`（roleDetailService.ts:45 / :33）、`fetch_url`（updateService 内部拉取更新元数据，updateService.ts:255、:323）。
- **配置键**：`refresh_on_account_switch`、`wiki_detail_preload`、`close_action`、`tray_user_role_id`、`developer_mode`（本文件直接读写）；`update_channel`、`update_source`（经 updateService 间接读写）；委托组件另用 `app.language`、`theme_mode`、`theme_color`、`theme_custom_colors`、`bg_image_path`、`bg_image_opacity`、`bg_blur`、`glass_clarity`。
- **i18n key 前缀**：`settings.title`、`common.managePreferences`、`settings.general.*`（含 `language`、`close_action*`、`tray_user*`、`title`）、`settings.game_launch.title`、`settings.appearance.title`、`settings.developer.*`（`title`/`enable`/`enable_desc`/`warning_*`）、`settings.update_channel.*`、`settings.update_source.*`、`settings.update.*`（`app_version`/`tauri_version`/`platform`/`latest_version`/`release_date`/`license*`/`open_source_credits`/`special_thanks`/`xel_launcher_desc`/`better_endfield_desc`）。
- **窗口事件**：`openUpdateDialog`（监听，settings.tsx:364）、`developerModeChange`（派发两次，settings.tsx:248、:258，detail 为 `{enabled:boolean}`）。
- **DOM 锚点 id**：`settings-general`、`settings-language`、`settings-refresh-on-switch`、`settings-lazy-load`、`settings-wiki-detail-preload`、`settings-close-action`、`settings-tray-user`、`settings-game-launch`、`settings-appearance`、`settings-developer`、`settings-about`。
- 非持久化展示项：远端版本徽标、版本四宫格、发布日期、identifier、License、20 条开源致谢（settings.tsx:1168-1269 内联数组）、2 条特别鸣谢（Xel-Launcher / Better-Endfield，settings.tsx:1355-1365 内联数组，说明文案走 i18n）、GitHub/License 外链、「检查更新」与「更新到 vX」按钮。

## `src/pages/developer.tsx`
**文件职责**：应用「开发者」路由页（`/developer`）。自上而下提供三块能力：图片缓存调优（模式/容量/统计/逐项浏览）、网络请求录制与会话回放（启动停止、分页读取、请求/响应详情）、前后端合并日志查看器（来源与级别过滤、轮询刷新）。
**导出**：`export default function DeveloperPage()`（developer.tsx:138），仅此一个导出；其余接口/常量/辅助函数均为模块内私有。
**主要依赖**：`react-i18next`、`@/components/ui/glass`（GlassButton/GlassCard/GlassLabel/GlassMeter/GlassNumberField/GlassSkeleton/GlassSwitch/GlassTable）、`react`（useState/useEffect/useRef/useMemo/useCallback）、`@/utils/configService`（`getConfig`/`setConfig`）、`@/utils/imageCacheManager`（`cacheManager`、`CacheMode`）、`@tauri-apps/plugin-opener`（`revealItemInDir`）、`@/utils/logger`（`logger`、`LogEntry`、`LogLevel`、`logError`）、`@tauri-apps/api/core`（`invoke`）、`morphicons/react`（`MorphIcon`）、`lucide`（`FileText`、`Settings`）。

### 内部结构总览
| 区间 | 内容 |
| --- | --- |
| developer.tsx:1-20 | import 区 |
| developer.tsx:22-65 | 录制相关类型：`CaptureBody`、`CaptureEntry`、`CaptureSession`、`CaptureStatusInfo`、`CapturePage` |
| developer.tsx:67-68 | 常量 `CAPTURE_PAGE_SIZE = 100`、`MAX_BODY_VIEW = 50000` |
| developer.tsx:70-95 | 模块级辅助：`formatBytes`、`formatBodyText`（JSON 美化 + 截断 + base64 标注） |
| developer.tsx:97-130 | 日志级别样式映射：`LOG_LEVEL_NAMES`、`LEVEL_BADGE_BG`、`LEVEL_TEXT`、`LEVEL_BG_SOFT`、`LEVEL_BORDER` |
| developer.tsx:132-136 | `MAX_VISIBLE_LOGS = 500`、`MAX_MESSAGE_LENGTH = 300`、类型 `LogFilter` / `LogLevelFilter` |
| developer.tsx:138-167 | `DeveloperPage` state：缓存、日志过滤、录制会话与详情、`cacheEntries` useMemo（:155） |
| developer.tsx:169-280 | 录制相关 handler：`refreshCapture`、`loadCaptureEntries`、`handleCaptureStart/Stop`、`handleViewSession`、`handleCloseSession`、`handleDeleteSession`、`handleOpenCaptureDir`、`handleAutoStartChange` |
| developer.tsx:282-293 | 两个录制 effect：初始化（刷新 + 读 `capture_autostart`）、录制中每 2s 轮询状态 |
| developer.tsx:295-318 | 缓存配置加载 effect：读 `cache_mode`/`cache_max_entries`/`cache_max_size_mb` 并 `cacheManager.configure` |
| developer.tsx:320-363 | `fetchBackendLogs`（invoke 拉后端日志、按 timestamp 去重、超量裁剪）与 3s 轮询 effect（:359-363） |
| developer.tsx:365-375 | 日志容器贴近底部时自动滚底 effect |
| developer.tsx:377-395 | `filteredLogs` useMemo：合并前后端 → 按来源/级别过滤 → 按时间排序 → 取末 500 条 |
| developer.tsx:397-434 | 缓存与日志操作：`handleCacheModeChange`、`handleCacheMaxEntriesChange`、`handleCacheMaxSizeMBChange`、`refreshCacheStats`、`cleanInactive`、`clearLogs` |
| developer.tsx:436-441 | `truncateMessage`：超 300 字符截断加省略号 |
| developer.tsx:443-450 | 页头（`settings.developer.title` + `settings.developer.enable_desc`） |
| developer.tsx:452-648 | 图片缓存卡 `#developer-cache`：骨架屏 459-468；模式开关 471-491；manual 模式下条数输入 497-520、容量输入 522-545；统计/清理 549-587；缓存明细表折叠 589-643 |
| developer.tsx:650-1017 | 网络录制卡 `#developer-capture`：标题与开始/停止/目录/刷新按钮 651-715；功能说明 717-721；启动自动录制开关 723-745；错误提示 747-749；状态条 751-768；会话表 770-844；会话内条目表 846-927；单条详情面板 929-1014 |
| developer.tsx:1019-1138 | 日志卡 `#developer-logs`：标题与导出诊断/刷新/清除 1021-1034；来源 tabs 1036-1060；级别过滤 chips 1062-1085；日志列表 1087-1137 |
| developer.tsx:1139-1142 | 收尾闭合 |

### 组件与函数清单
| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CaptureBody`（interface） | developer.tsx:22-27 | 请求/响应体：`encoding`/`size`/`truncated`/`data` |
| `CaptureEntry`（interface） | developer.tsx:29-42 | 单条请求记录：index、timestamp、method、url、请求头/体、status、响应头/体、duration_ms、error、note |
| `CaptureSession`（interface） | developer.tsx:44-52 | 录制会话：id、起止时间、status、count、size_bytes、path |
| `CaptureStatusInfo`（interface） | developer.tsx:54-60 | 录制状态：recording、session_id、started_at、count、size_bytes |
| `CapturePage`（interface） | developer.tsx:62-65 | 分页结果：`total` + `entries` |
| `CAPTURE_PAGE_SIZE` | developer.tsx:67 | `100`，每页读取条数 |
| `MAX_BODY_VIEW` | developer.tsx:68 | `50000`，详情面板正文字节上限 |
| `formatBytes` | developer.tsx:70-74 | B / KB / MB 三档格式化 |
| `formatBodyText` | developer.tsx:76-95 | note 兜底、base64 标注为 `[binary]`、JSON pretty-print、超长截断与 truncated 标注 |
| `LOG_LEVEL_NAMES` | developer.tsx:97-102 | `LogLevel` → 显示名 DEBUG/INFO/WARN/ERROR |
| `LEVEL_BADGE_BG` | developer.tsx:104-109 | 级别徽标底色（bg-secondary/success/warning/danger） |
| `LEVEL_TEXT` | developer.tsx:111-116 | 级别文字色 |
| `LEVEL_BG_SOFT` | developer.tsx:118-123 | 级别浅底色（`/15` 透明度） |
| `LEVEL_BORDER` | developer.tsx:125-130 | 级别过滤 chip 边框色 |
| `MAX_VISIBLE_LOGS` / `MAX_MESSAGE_LENGTH` | developer.tsx:132-133 | `500`（列表上限）/ `300`（单条消息截断长度） |
| `LogFilter` / `LogLevelFilter`（type） | developer.tsx:135-136 | `"all" \| "frontend" \| "backend"`；`LogLevel \| "all"` |
| `DeveloperPage`（default） | developer.tsx:138 | 页面根组件 |
| `cacheEntries`（useMemo） | developer.tsx:155 | 依赖 `cacheStats` 重算 `cacheManager.getEntries()` |
| `refreshCapture` | developer.tsx:169-180 | 并行 `capture_status` + `capture_list_sessions`，失败静默（非 Tauri 环境） |
| `loadCaptureEntries` | developer.tsx:182-200 | `capture_read_entries`（offset/limit=100），按 `replace` 决定覆盖或追加，失败写 `captureError` |
| `handleCaptureStart` | developer.tsx:202-214 | `capture_start` 后刷新状态 |
| `handleCaptureStop` | developer.tsx:216-231 | `capture_stop` 后刷新状态；若正在浏览该会话则重载第一页 |
| `handleViewSession` | developer.tsx:233-239 | 进入会话浏览，清空后加载首页 |
| `handleCloseSession` | developer.tsx:241-246 | 退出会话浏览并清空条目/选中项 |
| `handleDeleteSession` | developer.tsx:248-260 | `capture_delete_session`；删除的是当前会话则先关闭，再刷新 |
| `handleOpenCaptureDir` | developer.tsx:262-270 | `capture_dir` 取目录后 `revealItemInDir` 在文件管理器中显示 |
| `handleAutoStartChange` | developer.tsx:272-280 | 写配置 `capture_autostart`，失败回滚入 `captureError` |
| 初始化/轮询 effect | developer.tsx:282-293 | 挂载刷新录制状态并读 `capture_autostart`；`recording` 时每 2000ms 轮询 |
| 缓存配置加载 effect | developer.tsx:295-318 | 读三键（回退 smart/200/100）→ `cacheManager.configure` → 刷新统计 |
| `fetchBackendLogs` | developer.tsx:320-357 | `get_backend_logs` → level 字符串映射 → 按 timestamp 去重累入 `backendLogsRef`，超过 `MAX_VISIBLE_LOGS*2` 裁剪并重建去重集合 → 递增 `displayKey` 触发重渲染 |
| 后端日志轮询 effect | developer.tsx:359-363 | 立即拉取一次，之后每 3000ms |
| 自动滚底 effect | developer.tsx:365-375 | 距底部 <80px 时 `requestAnimationFrame` 滚到底 |
| `filteredLogs`（useMemo） | developer.tsx:377-395 | 前端 `logger.getLogs()` + `backendLogsRef` 合并 → 来源/级别过滤 → timestamp 升序 → 末 500 条 |
| `handleCacheModeChange` | developer.tsx:397-402 | `cacheManager.configure({mode})` + 写 `cache_mode` + 刷新统计 |
| `handleCacheMaxEntriesChange` | developer.tsx:404-410 | 夹取 10–5000 → configure + 写 `cache_max_entries` |
| `handleCacheMaxSizeMBChange` | developer.tsx:412-418 | 夹取 10–10000 → configure + 写 `cache_max_size_mb` |
| `refreshCacheStats` | developer.tsx:420-422 | 重取 `cacheManager.getStats()` |
| `cleanInactive` | developer.tsx:424-427 | `cacheManager.evictInactive()` 后刷新统计 |
| `clearLogs` | developer.tsx:432 | 清前端日志 + 空置后端缓存与去重集合 + 递增 `displayKey` |
| `handleExportDiagnostics` | developer.tsx:439 | `exportDiagnostics("Developer log export")` → `revealDiagnostics(path)` → 成功/失败 `pushGlobalAlert` |
| `truncateMessage` | developer.tsx:461 | 消息超 300 字符截断 |

**备注**：
- **invoke 命令名（全部）**：`capture_status`（:172）、`capture_list_sessions`（:173）、`capture_read_entries`（:185，参数 `id`/`offset`/`limit`）、`capture_start`（:206）、`capture_stop`（:220）、`capture_delete_session`（:251，参数 `id`）、`capture_dir`（:264）、`get_backend_logs`（:322）。
- **诊断导出**：日志卡「导出诊断日志」经 `@/utils/diagnostics`（`export_diagnostics`）打包前后端日志、崩溃报告与系统信息，成功后用 `revealItemInDir` 定位 zip；失败通过 `pushGlobalAlert` 提示。
- **配置键**：`capture_autostart`（读 :284，写 :275）、`cache_mode`（读 :299，写 :400）、`cache_max_entries`（读 :300，写 :408）、`cache_max_size_mb`（读 :301，写 :416）。缓存参数同步下发给 `cacheManager.configure`，改完立即刷新 `getStats()`。
- **i18n key 前缀**：`settings.cache.*`（title/mode/mode_smart_desc/mode_manual_desc/max_entries*/max_size_mb*/current_cache/clean_inactive/entries_count/size_usage/cached_resources/filename/size/status/status_pinned/status_active/status_inactive/open_file_location/no_cached）、`settings.logs.title`、`settings.developer.title`、`settings.developer.enable_desc`、`common.refresh`。
- **未走 i18n 的文案**：网络录制整卡（标题、按钮、说明、表头、详情面板，:650-1016）与日志卡的清除按钮、tabs、级别 chips、空态（:1031-1131）均使用 `i18n.language === "zh"` 三元硬编码中英双语，未接入翻译资源。
- **DOM 锚点 id**：`developer-cache`、`developer-capture`、`developer-logs`。
- **轮询周期**：录制状态 2000ms（仅 `recording` 时）、后端日志 3000ms；常量 100（分页）、50000（正文上限）、500（日志条数）、300（消息截断）。
- **外部交互**：`revealItemInDir` 用于打开缓存文件（:618）与录制会话文件（:826）所在目录；缓存明细行点击、会话行的浏览/目录/删除、条目行选中展开详情均为内联事件。

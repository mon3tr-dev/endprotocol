# 前端入口与应用骨架 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## `src/main.tsx`
**职责**：主窗口（index.html）的唯一入口。在渲染前从配置服务读取语言与主题并应用（避免闪白/闪黑），随后挂载 React 应用，并在渲染后串行触发卡片注册、启动任务、更新检查、托盘数据拉取等副作用；原生 HTML Splash 覆盖 React 启动与首屏初始数据加载。
**导出**：（无导出）
**主要依赖**：`react` / `react-dom/client` / `react-router-dom`（BrowserRouter）、`./App.tsx`、`./provider.tsx`、`./i18n`、`@/styles/globals.css`、`@/utils/configService`、`@/utils/theme`（`DEFAULT_GLASS_CLARITY`、`applyGlassClarity`、`applyThemeColor`、`applyThemeMode`、`resolveThemeColor` 及类型 `ThemeColor`/`ThemeMode`）、`@/cards/startup-service`、`@/components/cards/registry/loader`、`@/utils/overlayScrollbar`、`@/utils/updateService`、`@/utils/logger`、`@/utils/trayService`（`refreshTrayUserData`）、`@/utils/backgroundSettings`、`@/utils/launcherService`、`@/utils/startupProgress`、`@/utils/accountAvailability`（`loadAccountAvailability`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `installCrashHandlers()` | main.tsx:39 | 在最前面安装全局 `error` / `unhandledrejection` / 后端崩溃 / API 熔断监听（`@/utils/crashReporting`） |
| `clearTimeout(window.__endprotocolBootTimer)` | main.tsx:42 | 取消 `index.html` 中「前端脚本未启动」的静态兜底计时器，并隐藏静态错误面板 |
| `setStartupPhase(12, …)` / `setStartupPhase(30, …)` | main.tsx:51 / 68 | 更新静态 Splash 的初始化阶段文案 |
| `armStartupTimeout()` | main.tsx:53 | 配置初始化前启动 45 秒启动看门狗，覆盖 IPC/配置读取永久挂起、React 未挂载的卡死场景 |
| `syncSilentLaunchConfig` | main.tsx:54 | 完整前端启动时将既有 localStorage 的游戏目录/渠道迁移到 `ConfigService` |
| 配置读取 + 主题应用 | main.tsx:57-75 | 并行读 `app.language`/`theme_mode`/`theme_color`/`theme_custom_colors`/`glass_clarity` 与 `loadBackgroundSettings()`/`loadAccountAvailability()`；`resolveThemeColor` 解析色板后依次 `applyThemeColor`、`applyThemeMode`、`applyGlassClarity`（渲染前应用，避免闪白） |
| `ReactDOM.createRoot(...).render(...)` | main.tsx:80-88 | `StrictMode > BrowserRouter > Provider > App`，挂载到 `#root` |
| `beginStartupTracking(...)` | main.tsx:89-92 | React 挂载后开始跟踪首屏请求 |
| 托盘数据刷新 | main.tsx:106-115 | 读 `tray_user_role_id` → `refreshTrayUserData(roleId)`（`@/utils/trayService`），本文件不再直接 `invoke` |
| `failStartup(...)` 调用 | main.tsx:118 | 初始化配置失败时显示错误详情（第二个参数为 `String(error)`），Splash 错误面板可导出诊断日志/打开日志目录/重载 |

**备注**：
- 主题逻辑已迁移：本文件原先自定义的 `ThemeMode`/`ThemeColor`/`PRESET_COLORS`/`findColors`/`applyThemeColor`/`applyThemeMode` 全部移到 `@/utils/theme`（见 [utils_services_a.md](utils_services_a.md)），`main.tsx` 只负责读配置并调用这些函数。
- 初始化读取的配置键：`app.language`、`theme_mode`、`theme_color`、`theme_custom_colors`、`glass_clarity`，并 `loadBackgroundSettings()` 与 `loadAccountAvailability()`（渲染前恢复上一轮的账户不可用状态，让首屏即显示正确状态）；语言未保存时按 `navigator.language` 以 `zh` 开头判定中/英（main.tsx:66）；主题色默认 indigo、主题模式默认 `system`、玻璃清晰度默认 55（均由 `@/utils/theme` 的默认常量兜底）。
- 前端启动时另外同步 localStorage 键 `launcher_install_path`、`launcher_channel` 至同名 app config 键，供之后的 `--silent --launch-game` 使用；同步失败经 logger 明确记录。
- 渲染结构：`StrictMode > BrowserRouter > Provider > App`，挂载到 `#root`（main.tsx:80-88）。
- 启动 Splash 在 `index.html` 中由静态 HTML/CSS 提前展示，使用 `/app-icon.png`；背景层复用 `loadBackgroundSettings()` 设置的用户背景图、透明度和模糊度，没有自定义背景时回退到主题渐变。配置读取完成后继续保持显示。`startupProgress.ts` 汇总启动任务、仪表板首载、角色数据 IPC 与公告/背景加载，在请求静稳 650ms 后将进度补满并淡出；初始化配置异常时保留 Splash 并显示错误文案与 `#startup-splash-error` 操作面板（导出诊断日志/打开日志目录/重新加载）；45 秒超时同样停止加载并展示未完成请求数。
- 渲染后的四个延时副作用：`loadAllCards()` 立即执行注册启动处理器（main.tsx:95），随后 `setTimeout 0` 调用 `CardStartupService.runAll()`（main.tsx:96-98）；`setTimeout 3000` 调用 `checkAndNotify()` 自动检查更新（main.tsx:101-104）；`setTimeout 5000` 读取 `tray_user_role_id`，命中时调用 `refreshTrayUserData(trayRoleId)`（main.tsx:106-115）推送托盘数据。
- 托盘数据不再在本文件组装：字段映射（含 `accountLevel` 游戏账号等级）全部下沉到 `@/utils/trayService`（main.tsx:16），本文件只在启动后触发一次刷新，因此 `invoke`/`roleDataService`/`getAccounts` 已不再直接出现在此。
- 魔数：3000（更新检查延迟 ms）、5000（托盘数据拉取延迟 ms）、0（启动任务延迟 ms）；进度/主题色阶键名 50–900 为 Tailwind 风格约定。
- `index.html` 的启动动画遵循 `prefers-reduced-motion`，静态启动文案先按浏览器语言显示，配置读取后切换为应用保存语言。另有 30 秒静态兜底计时器 `window.__endprotocolBootTimer`：若前端模块脚本未执行（加载/语法错误），静态展示「启动超时」与重新加载按钮；`main.tsx` 一旦执行即清除该计时器，改由 `armStartupTimeout` 的 45 秒看门狗接管。

## `src/App.tsx`
**职责**：定义应用的路由表（11 条顶层路由，全部包在 `DashboardLayout` 中），并初始化待办列表/每日重置调度；同时挂载路由恢复（记住/还原 `last_route`）与更新检查副作用。各页面通过 `React.lazy` + 动态 `import()` 按路由分包加载（页面加载态由 `DashboardLayout` 内的 `Suspense` 承载）。
**导出**：`export default App`（App.tsx:143）。
**主要依赖**：`react`（lazy/useEffect/useRef）、`react-router-dom`（Route/Routes/useLocation/useNavigate）、动态导入的页面组件 `@/pages/{dashboard,settings,developer,account,characters,medals,attendance,gacha-records,todo,domain,spaceship}`、`@/layouts/dashboard`、`@/utils/configService`（getConfig/setConfig）、`@/utils/updateService`（checkAndNotify）、`@/stores/todoStore`（ensureTodoLoaded）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ROUTES` | App.tsx:19 | 白名单路由数组 `["/", "/settings", "/account", "/characters", "/medals", "/attendance", "/gacha", "/todo", "/domain", "/spaceship", "/developer"]`，用于校验可恢复路径 |
| `DashboardPage`/`SettingsPage`/`DeveloperPage`/`AccountPage`/`CharactersPage`/`MedalsPage`/`AttendancePage`/`GachaRecordsPage`/`TodoPage`/`DomainPage` | App.tsx:9-18 | 由 `React.lazy(() => import("@/pages/..."))` 创建的路由级懒加载组件，仅在访问对应路由时拉取分包 |
| `RouteRestore` | App.tsx:21-42 | 无 UI 组件。首次 effect 读取 `last_route`，若在白名单内且与当前路径不同则 `navigate(savedPath, { replace: true })`；`restored` ref 防止恢复前就覆盖保存；路径变化后写回 `setConfig("last_route", pathname)` |
| `UpdateChecker` | App.tsx:44-54 | 无 UI 组件。用 `notified` ref 保证 `checkAndNotify()` 仅执行一次 |
| `App` 初始化 effect | App.tsx:57-59 | 调用 `ensureTodoLoaded()`，使每日列表在启动时可补做当天到期的重置 |
| `App`（default） | App.tsx:56-141 | 渲染 `<RouteRestore/>`、`<UpdateChecker/>` 与 `<Routes>` |
| 路由 `/` | App.tsx:66-73 | `DashboardLayout` 包 `DashboardPage` |
| 路由 `/settings` | App.tsx:74-81 | `DashboardLayout` 包 `SettingsPage` |
| 路由 `/account` | App.tsx:82-89 | `DashboardLayout` 包 `AccountPage` |
| 路由 `/characters` | App.tsx:90-97 | `DashboardLayout` 包 `CharactersPage` |
| 路由 `/medals` | App.tsx:98-105 | `DashboardLayout` 包 `MedalsPage` |
| 路由 `/attendance` | App.tsx:106-113 | `DashboardLayout` 包 `AttendancePage` |
| 路由 `/gacha` | App.tsx:114-121 | `DashboardLayout` 包 `GachaRecordsPage` |
| 路由 `/todo` | App.tsx:122-129 | `DashboardLayout` 包 `TodoPage`（`@/pages/todo`） |
| 路由 `/domain` | App.tsx | `DashboardLayout` 包 `DomainPage`（`@/pages/domain`，区域信息独立页面） |
| 路由 `/spaceship` | App.tsx | `DashboardLayout` 包 `SpaceshipPage`（`@/pages/spaceship`，帝江号独立页面） |
| 路由 `/developer` | App.tsx:130-137 | `DashboardLayout` 包 `DeveloperPage` |

**备注**：
- 路由表（path → 页面）：`/`→dashboard、`/settings`→settings、`/account`→account、`/characters`→characters、`/medals`→medals、`/attendance`→attendance、`/gacha`→gacha-records、`/todo`→todo、`/domain`→domain、`/spaceship`→spaceship、`/developer`→developer；无 404/通配路由。
- 配置键 `last_route` 由 `RouteRestore` 读写；`ROUTES` 与上述路径必须同步维护。
- 分包策略：页面为路由级懒加载（`React.lazy`），页面 `Suspense` 边界位于 `layouts/dashboard.tsx` 的 `<main>` 内，因此切换页面时侧边栏/标题栏保持挂载；第三方库由 `vite.config.ts` 的 `rollupOptions.output.manualChunks` 拆分为 `vendor-react`/`vendor-echarts`/`vendor-zrender`/`vendor-i18n`/`vendor-ui`/`vendor-dnd`/`vendor-tauri` 等 chunk。

## `src/App.css`
**职责**：Vite/Tauri 模板遗留的全局样式（logo hover 光晕、根字体、按钮/输入框基础样式、暗色偏好媒体查询）。当前 `App.tsx` 与 `main.tsx` 均未导入它，实际样式来自 `@/styles/globals.css`。
**导出**：（无导出，纯 CSS）
**主要依赖**：无。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `.logo.vite:hover` / `.logo.react:hover` / `.logo.tauri:hover` | App.css:1-7, 40-42 | 模板 logo 的 drop-shadow 悬停光晕（#747bff / #61dafb / #24c8db） |
| `:root` | App.css:8-22 | 字体栈 Inter/Avenir/Helvetica 等、16px/24px、浅色前景 `#0f0f0f` 与背景 `#f6f6f6`、字体渲染优化 |
| `.container` / `.logo` / `.row` | App.css:24-47 | 模板布局：垂直居中容器、6em logo、水平 flex 行 |
| `a` / `a:hover` / `h1` | App.css:49-61 | 链接颜色 #646cff（hover #535bf2）、h1 居中 |
| `input, button` / `button:hover` / `button:active` | App.css:63-92 | 圆角 8px、白底、阴影与 hover/active 边框色 #396cd8 |
| `#greet-input` | App.css:94-96 | 模板 greet 输入框右边距 5px |
| `@media (prefers-color-scheme: dark)` | App.css:98-116 | 系统深色时翻转前景/背景、链接 hover 改 #24c8db、控件半透明深底 |

**备注**：疑似死代码（未被任何入口 import），后续 Agent 若要清理可整体删除，但需先全局确认无引用。

## `src/provider.tsx`
**职责**：应用级 UI 基础设施的组合层：最外层错误边界 + 崩溃/API 熔断提示宿主 + 全局弹窗宿主（全局 Alert、确认对话框），子内容包在其中。
**导出**：`Provider`（provider.tsx:11）。
**主要依赖**：`@/components/ui/error-boundary`（ErrorBoundary）、`@/components/ui/global-error-fallback`（GlobalErrorFallback）、`@/components/ui/global-alert`（GlobalAlertHost）、`@/components/ui/confirm-dialog`（ConfirmDialogHost）、`@/components/crash-report-host`（CrashReportHost）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ProviderProps`（接口） | provider.tsx:6 | `children: React.ReactNode` |
| `Provider` | provider.tsx:11-25 | 结构：`ErrorBoundary(fallback=(error) => <GlobalErrorFallback error={error}/>)` 内依次渲染 `GlobalAlertHost`、`ConfirmDialogHost`、`CrashReportHost`、`children` |

**备注**：仅在 `main.tsx` 中被使用，包在 `BrowserRouter` 内、`App` 外。

## `src/i18n.ts`
**职责**：初始化 i18next（绑定 react-i18next），静态打包 en/zh 两份翻译 JSON，并提供渲染前切换初始语言的函数。
**导出**：`setInitialLanguage`（i18n.ts:30）、`export default i18n`（i18n.ts:35）。
**主要依赖**：`i18next`、`react-i18next`（initReactI18next）、`./locales/en/translation.json`、`./locales/zh/translation.json`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `resources` | i18n.ts:8-15 | `{ en: { translation }, zh: { translation } }` 命名空间固定为 `translation` |
| `initialLanguage`（模块内变量） | i18n.ts:19 | 默认 `"en"`，由 `setInitialLanguage` 覆写 |
| i18n.init | i18n.ts:21-28 | `lng: initialLanguage`、`fallbackLng: "en"`、`interpolation.escapeValue: false`（React 已做 XSS 防护） |
| `setInitialLanguage` | i18n.ts:30-33 | 更新模块变量并调用 `i18n.changeLanguage(lng)`，由 `main.tsx` 在渲染前调用 |

**备注**：翻译键需在 `src/locales/en|zh/translation.json` 中成对维护；`import i18n from "./i18n"` 的副作用即完成初始化。

## `src/tray-panel.tsx`
**职责**：托盘面板窗口（`tray-panel.html`）的第二入口：初始化语言与完整主题（模式 / 主题色 / 玻璃清晰度），订阅主题变更事件实时跟随，然后把 `TrayPanel` 组件挂到 `#tray-panel-root`。
**导出**：（无导出）
**主要依赖**：`react` / `react-dom/client`、`./components/tray-panel`（TrayPanel）、`./styles/globals.css`、`./utils/configService`（getConfig）、`./utils/theme`（`loadTheme`、`applyThemeMode`、`applyThemeColor`、`applyGlassClarity`、`resolveThemeColor`）、`./utils/logger`、`./i18n`（`setInitialLanguage`）、`@tauri-apps/api/event`（listen）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `initLanguage()` | tray-panel.tsx:25-38 | 读 `app.language`，缺省按 `navigator.language` 推断 zh/en 并 `setInitialLanguage`；失败仅记日志 |
| `refreshThemeColor()` | tray-panel.tsx:40-46 | 主题色没有独立事件，故随 `theme-changed` 一并重读 `theme_color` + `theme_custom_colors` 并 `applyThemeColor` |
| `initTheme()` | tray-panel.tsx:48-67 | `loadTheme()` 一次性应用模式/主题色/清晰度（失败回退 `system`），并注册 `listen("theme-changed")` 同步三者 |
| 顶层调用 | tray-panel.tsx:69-70 | 模块加载即执行 `void initLanguage()`、`void initTheme()` |
| 渲染调用 | tray-panel.tsx:72-76 | `StrictMode > TrayPanel` 挂到 `#tray-panel-root` |

**备注**：
- 双入口区分：根目录 `src/tray-panel.tsx` 是 HTML 入口（tray-panel.html 引用，vite.config.ts:40 定义 rollup input `tray-panel`，Tauri 窗口 label `tray-panel`，见 `src-tauri/src/lib.rs::create_full_windows`）；`src/components/tray-panel.tsx` 是被渲染的组件本体。
- Tauri 事件：`listen("theme-changed", ...)`，主题切换由主窗口侧 emit，托盘面板只订阅。
- 配置键：`app.language`、`theme_mode`、`theme_color`、`theme_custom_colors`、`glass_clarity`。本文件不渲染路由、不挂 Provider。
- 主题逻辑已抽到 `@/utils/theme`，与 `main.tsx` / `appearance-settings.tsx` / `theme-switch.tsx` 共用同一份预设色板与应用函数，避免各入口重复实现导致托盘窗口拿不到自定义主题色。
- 入口 HTML `tray-panel.html` 的 `<html>` 带 `data-window="tray-panel"`，`globals.css` 据此去掉 `body` 默认底色，让窗口的系统 Acrylic 透出来。

## `src/vite-env.d.ts`
**职责**：Vite 客户端类型引用 + 声明 `*.json` 为任意类型模块，使 TS 允许直接 import 翻译 JSON。
**导出**：无运行时导出（纯类型声明文件）。
**主要依赖**：`vite/client` 类型。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `/// <reference types="vite/client" />` | vite-env.d.ts:1 | 引入 Vite 客户端全局类型（`import.meta.env` 等） |
| `declare module "*.json"` | vite-env.d.ts:3-6 | 兜底声明 JSON 模块默认导出为 `any` |

## `src/config/site.ts`
**职责**：存放静态、与语言无关的站点元信息与外链（供 About/页脚等复用；需要本地化的 nav 标签由组件内 `useTranslation` 处理）。
**导出**：`siteConfig`（site.ts:5）、`SiteConfig`（类型，site.ts:16）。
**主要依赖**：无。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `siteConfig` | site.ts:5-14 | `as const` 对象：`name: "EndProtocol"`、`description`、`links.github`（soldiereleven/endprotocol）、`links.docs`（heroui.com）、`links.sponsor`（patreon.com/jrgarciadev） |
| `SiteConfig` | site.ts:16 | `typeof siteConfig` 派生类型 |

**备注**：`links.docs`/`links.sponsor` 仍是模板默认值（HeroUI / Patreon），疑似未替换。

## `src/lib/cn.ts`
**职责**：`cn` 的再导出别名文件。
**导出**：`cn`（cn.ts:1，来自 `./utils`）。
**主要依赖**：`./utils`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `cn`（re-export） | cn.ts:1 | 一行 `export { cn } from "./utils"`，实现见 `src/lib/utils.ts:4` |

## `src/lib/utils.ts`
**职责**：Tailwind 类名拼接工具：合并 clsx 输出并用 tailwind-merge 去重冲突类。
**导出**：`cn`（utils.ts:4）。
**主要依赖**：`clsx`（ClassValue）、`tailwind-merge`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `cn` | utils.ts:4-6 | `twMerge(clsx(inputs))`，接受可变参数（对象/数组/字符串/条件值） |

## `src/hooks/useLongPressDrag.ts`
**职责**：可复用的「长按进入编辑态并随后开始拖拽」Hook：长按期间按 40ms 步进显示进度环，达到时长后触发回调并置位待拖拽标志，提供取消与模拟 pointerdown 的接口。
**导出**：`useLongPressDrag`（useLongPressDrag.ts:23）。
**主要依赖**：`react`（useState/useEffect/useRef）、`@/utils/logger`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `UseLongPressDragOptions`（接口） | useLongPressDrag.ts:4-9 | `isEditMode`、`isDragging`、`onLongPress?`、`longPressDuration?`（默认 1200ms） |
| `UseLongPressDragReturn`（接口） | useLongPressDrag.ts:11-17 | 返回 `longPressProgress`、`handlePointerDown`、`handlePointerUp`、`handlePointerLeave`、`triggerDragStart` |
| `useLongPressDrag` | useLongPressDrag.ts:23-146 | 主 Hook，内部状态与分支见「内部结构」 |

**内部结构**：
- `29-34 行`：状态定义——定时器、进度 0–100、进度 interval、`shouldStartDrag`、`enteredEditModeViaLongPress`、`pointerDownEventRef`。
- `36-80 行`：`handlePointerDown`——已处于编辑态或拖拽中直接 return；否则缓存事件，启动 40ms 间隔的进度累加（`increment = 100 / (duration/40)`），并设 `setTimeout(longPressDuration)` 触发 `onLongPress`、置 `enteredEditModeViaLongPress` 与 `shouldStartDrag`，150ms 后把进度清零。
- `83-96 行`：`triggerDragStart(onPointerDown)`——当 `shouldStartDrag` 且缓存事件与回调都存在时，延时 50ms 调用 `onPointerDown(缓存事件)` 模拟 pointerdown 启动拖拽，并复位标志；否则仅记日志。
- `98-111 行`：`handlePointerUp`——清理 timer/interval、进度归零、清 `shouldStartDrag` 与缓存事件。
- `113-115 行`：`handlePointerLeave` 直接转调 `handlePointerUp`。
- `118-129 行`：全局事件 `window 'clearLongPressTimers'` 监听（如弹窗打开时调用 `window.dispatchEvent(new Event('clearLongPressTimers'))` 可取消长按），回调执行 `handlePointerUp`；依赖 `[longPressTimer, progressInterval]`。
- `132-137 行`：`shouldStartDrag && isEditMode` 成立时把 `shouldStartDrag` 置回 false（拖拽由组件调用 `triggerDragStart` 负责）。
- `139-145 行`：返回对象。

**备注**：魔数——默认长按 1200ms（注释注明由 800ms 改为规范要求的 1200ms）、进度刷新 40ms、完成后进度隐藏延时 150ms、模拟 pointerdown 延时 50ms；日志 tag 为 `"useLongPressDrag"`。

## `src/stores/inAppBrowser.ts`
**职责**：应用内置浏览器（WebView 覆盖层）的极简可订阅状态 store（模块级单例，无依赖框架），支持打开/关闭/挂起/恢复/跳转。
**导出**：`InAppBrowserState`（接口，:1）、`getInAppBrowserUrl`（:15）、`isBrowserOpen`（:19）、`isBrowserSuspended`（:23）、`openInAppBrowser`（:27）、`closeInAppBrowser`（:34）、`suspendInAppBrowser`（:41）、`resumeInAppBrowser`（:49）、`navigateInAppBrowser`（:57）、`subscribeInAppBrowser`（:62）。
**主要依赖**：无。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `InAppBrowserState`（接口） | inAppBrowser.ts:1-4 | `{ url: string; isOpen: boolean }`（注意：该类型当前未被本文件任何函数返回） |
| 模块内状态 | inAppBrowser.ts:6-9 | `currentUrl`、`isOpen`、`isSuspended`、`listeners` |
| `emit` | inAppBrowser.ts:11-13 | 遍历通知所有 listener（无参） |
| `getInAppBrowserUrl` | inAppBrowser.ts:15-17 | 返回当前 URL |
| `isBrowserOpen` | inAppBrowser.ts:19-21 | 是否处于打开态 |
| `isBrowserSuspended` | inAppBrowser.ts:23-25 | 是否处于挂起态 |
| `openInAppBrowser` | inAppBrowser.ts:27-32 | 设置 url、`isOpen=true`、清除挂起态并通知 |
| `closeInAppBrowser` | inAppBrowser.ts:34-39 | 全部复位（url 清空）并通知 |
| `suspendInAppBrowser` | inAppBrowser.ts:41-47 | 仅当打开时：转为挂起、`isOpen=false`、通知（URL 保留以便恢复） |
| `resumeInAppBrowser` | inAppBrowser.ts:49-55 | 仅当挂起且有 URL 时恢复打开 |
| `navigateInAppBrowser` | inAppBrowser.ts:57-60 | 只换 URL（不改开关状态）并通知 |
| `subscribeInAppBrowser` | inAppBrowser.ts:62-67 | 注册回调，返回退订函数 |

**备注**：状态机为 `closed ↔ open ↔ suspended`；`suspend` 不清 URL，`close` 清 URL。

## `src/stores/launcherMode.ts`
**职责**：启动器（launcher）相关的三组模块级可订阅 store：视图模式（data/game，localStorage 持久化）、背景媒体（内存态）、背景模式（video/image，localStorage 持久化）。
**导出**：`LauncherViewMode`（:1）、`getLauncherMode`（:19）、`setLauncherMode`（:23）、`isGameMode`（:32）、`subscribeLauncherMode`（:36）、`LauncherBgMedia`（接口，:44）、`getLauncherBgMedia`（:56）、`setLauncherBgMedia`（:60）、`subscribeLauncherBgMedia`（:65）、`GameBgMode`（:73）、`getGameBgMode`（:91）、`setGameBgMode`（:95）、`subscribeGameBgMode`（:104）。
**主要依赖**：`localStorage`（浏览器原生）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `LauncherViewMode` | launcherMode.ts:1 | `"data" \| "game"` |
| `STORAGE_KEY` | launcherMode.ts:3 | `"launcher_view_mode"` |
| `currentMode` 初始化 | launcherMode.ts:5-11 | 从 localStorage 读取并校验，非法/异常回退 `"data"` |
| `emit` | launcherMode.ts:15-17 | 通知 view mode 监听者 |
| `getLauncherMode` | launcherMode.ts:19-21 | 读当前模式 |
| `setLauncherMode` | launcherMode.ts:23-30 | 相同值直接 return；写内存 + localStorage（try/catch）+ emit |
| `isGameMode` | launcherMode.ts:32-34 | `currentMode === "game"` |
| `subscribeLauncherMode` | launcherMode.ts:36-41 | 注册/退订 view mode |
| `LauncherBgMedia`（接口） | launcherMode.ts:44-47 | `{ image_url: string \| null; video_url: string \| null }` |
| `emitBg` | launcherMode.ts:52-54 | 通知背景媒体监听者 |
| `getLauncherBgMedia` / `setLauncherBgMedia` / `subscribeLauncherBgMedia` | launcherMode.ts:56-70 | 背景媒体读写与订阅（**不持久化**，仅内存，随会话重置） |
| `GameBgMode` | launcherMode.ts:73 | `"video" \| "image"` |
| `BG_MODE_STORAGE_KEY` | launcherMode.ts:75 | `"game_bg_mode"` |
| `currentBgMode` 初始化 | launcherMode.ts:77-83 | 从 localStorage 读取校验，回退 `"video"` |
| `emitBgMode` | launcherMode.ts:87-89 | 通知背景模式监听者 |
| `getGameBgMode` / `setGameBgMode` / `subscribeGameBgMode` | launcherMode.ts:91-109 | 背景模式读写（相同值短路）与订阅 |

**备注**：三个 store 各自独立的 listeners 数组与 emit，互不干扰；localStorage 键名仅两枚：`launcher_view_mode`、`game_bg_mode`。

## `src/cards/startup-service.ts`
**职责**：卡片启动任务服务（单例对象）：登记各卡片类型的启动处理器、管理「自动签到用户」名单与「卡片—用户」映射（均持久化到配置服务），启动时并行跑签到任务并对外广播任务状态。
**导出**：`CardStartupService`（startup-service.ts:25）。
**主要依赖**：`@/utils/configService`（getConfig/setConfig）、`@/utils/logger`（logInfo/logError）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `StartupHandler`（类型） | startup-service.ts:4 | `(roleId: string) => Promise<void>` |
| `StatusListener`（类型） | startup-service.ts:5 | 监听 `{ status: "pending"\|"running"\|"done"\|"error"; error? }` |
| `AutoSignListener`（类型） | startup-service.ts:6 | `(roleId, enabled) => void` |
| `AUTO_SIGN_KEY` | startup-service.ts:8 | 配置键 `"card_auto_sign_users"`（string[]） |
| `MAPPING_KEY` | startup-service.ts:9 | 配置键 `"card_user_mapping"`（`Record<roleId, cardId[]>`） |
| 模块内 Maps/Sets | startup-service.ts:11-14 | `handlers`（cardType→handler）、`taskStatuses`（roleId→状态）、`statusListeners`、`autoSignListeners` |
| `notifyStatusChange` | startup-service.ts:16-23 | 取 roleId 状态并通知该 roleId 的所有监听者（无状态则跳过） |
| `CardStartupService.register` | startup-service.ts:26-29 | 按 cardType 注册启动处理器（同名覆盖）并记日志 |
| `CardStartupService.getAutoSignUsers` | startup-service.ts:31-38 | 读 `card_auto_sign_users`，异常返回 `[]` |
| `CardStartupService.isAutoSignEnabled` | startup-service.ts:40-43 | 名单是否包含 roleId |
| `CardStartupService.addAutoSignUser` | startup-service.ts:45-52 | 去重后追加、写回配置、广播 `(roleId, true)` |
| `CardStartupService.removeAutoSignUser` | startup-service.ts:54-61 | 过滤移除（无变化则跳过写入）、广播 `(roleId, false)` |
| `CardStartupService.onAutoSignChanged` | startup-service.ts:63-66 | 注册自动签到变更监听，返回退订函数 |
| `CardStartupService.updateUserMapping` | startup-service.ts:68-81 | 先把 cardId 从所有 roleId 下移除（空数组删键），再把 cardId 加入 `newRoleId`（`undefined` 表示解绑），最后写回 |
| `CardStartupService.removeCardFromMapping` | startup-service.ts:83-90 | 从所有 roleId 下移除该 cardId 并清理空项 |
| `CardStartupService.getCardIdsByUser` | startup-service.ts:92-95 | 返回 roleId 对应的 cardId 数组（默认 `[]`） |
| `CardStartupService.runAll` | startup-service.ts:97-127 | 取自动签到用户列表，为空直接返回；`Promise.all` 并行执行，固定取 handler `"attendance"`：无处理器→状态 `error`；否则置 `running` → 执行 → 成功 `done` / 异常 `error`（`String(e)`），每步 `notifyStatusChange` |
| `CardStartupService.getTaskStatus` | startup-service.ts:129-131 | 读单个 roleId 的任务状态 |
| `CardStartupService.subscribe` | startup-service.ts:133-141 | 按 roleId 注册状态监听（Set 去重），返回退订函数 |

**备注**：
- `runAll` 目前只执行 `"attendance"` 一个处理器（即使注册了其他 cardType 也不会跑），且注册必须发生在 `runAll` 之前——`main.tsx` 通过 `loadAllCards()` 同步注册、再 `setTimeout 0` 调用 `runAll` 来保证顺序。
- 状态四态：`pending` 实际只在类型上定义，运行时写入的是 `running` / `done` / `error`。
- 所有持久化均走配置服务（Tauri 后端存储），非 localStorage。
- 日志 tag：`"StartupService"`，消息前缀 `[Startup]`。

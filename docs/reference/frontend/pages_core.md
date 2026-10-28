# 布局与仪表板/签到/勋章页面 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## `src/layouts/dashboard.tsx`
**职责**：全局仪表板外壳布局。根据 `launcherMode` 切换两种完全不同的渲染分支：Windows 上的 `game`（游戏启动器全屏背景 + 顶部中央背景模式悬浮切换器 + 底部公告/轮播 + 游戏操作面板）与 `data`（侧边栏 + 可滚动内容区，包裹所有业务页面）。同时负责加载背景媒体与公告数据、在游戏/数据模式间挂起与恢复内置浏览器；非 Windows 平台固定使用 data 模式且不请求启动器公告/背景。

**导出**：`export default function DashboardLayout`（默认导出，React 组件，接收 `{ children }`）。

**主要依赖**：
- 项目内：`@/components/custom-titlebar`（`CustomTitlebar`）、`@/components/dashboard-sidebar`（`Sidebar`）、`@/components/in-app-browser`（`InAppBrowser`）、`@/components/game-action-panel`（`GameActionPanel`）、`@/stores/launcherMode`（模式、背景媒体与 `game_bg_mode` 的可订阅 store，含 `setGameBgMode`）、`@/stores/inAppBrowser`（`openInAppBrowser`/`suspendInAppBrowser`/`resumeInAppBrowser`）、`@/utils/launcherService`（`getNoticeContent`/`getBackgroundImage` 与 `GameChannel`/`BannerItem`/`AnnouncementItem` 类型）、`@/utils/platform`（`isWindowsPlatform`）、`@/utils/startupProgress`（`trackStartupTask`）。
- 项目内（续）：`@/components/ui/glass`（`GlassSpinner`，作为懒加载页面的 `Suspense` 兜底）、`@/utils/configService`（`getConfig`/`setConfig`，读写侧边栏折叠状态）。
- 第三方：`react`（`useState`/`useEffect`/`useRef`/`Suspense`）、`react-router-dom`（`useLocation`）、`clsx`、`react-i18next`（`useTranslation`）、`morphicons/react`（`MorphIcon`）、`lucide`（`ChevronLeft`/`ChevronRight`/`Video`/`Image as ImageIcon`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `STORAGE_KEY_CHANNEL` | dashboard.tsx:45 | 常量，localStorage 键名 `"launcher_channel"` |
| `DashboardLayoutProps` | dashboard.tsx:47-49 | 接口，仅含 `children: React.ReactNode` |
| `DashboardLayout` | dashboard.tsx:51 | 页面外壳组件：见下方「内部结构」 |
| `BG_SWITCH_TRIGGER_HEIGHT` | dashboard.tsx:493 | 浮出触发区：指针距窗口顶部 ≤150px |
| `BG_SWITCH_TRIGGER_HALF_WIDTH` | dashboard.tsx:494 | 浮出触发区：指针水平距窗口中线 ≤220px |
| `BG_SWITCH_HIDE_DELAY` | dashboard.tsx:495 | 离开触发区后 300ms 收起 |
| `BG_MODE_OPTIONS` | dashboard.tsx:497-512 | 两个选项：`video`（`Video`）、`image`（`ImageIcon`），标签键 `settings.game_launch.bg_media_video` / `bg_media_image` |
| `GameBackgroundSwitch` | dashboard.tsx:518-616 | 内部组件（未导出）：游戏界面顶部中央的背景模式悬浮切换器；props `mode: GameBgMode`、`media: LauncherBgMedia`；监听 window `mousemove` 控制浮出/收起动画，点击图标调用 `setGameBgMode`（与设置页共用 store），`video_url`/`image_url` 缺失的选项禁用 |

**内部结构**：
- 1-43 行：导入与常量。`STORAGE_KEY_CHANNEL = "launcher_channel"`（45）。
- 47-49 行：`DashboardLayoutProps` 接口。
- 51-72 行：组件声明与全部状态：`location`(useLocation)、`mobileOpen`（移动端抽屉开关）、`sidebarCollapsed`（桌面端侧边栏折叠为窄轨，初始 `false`）、`viewMode`（初始 `getLauncherMode()`）、`bgMedia`（`LauncherBgMedia | null`，初始 `getLauncherBgMedia`）、`bgMediaMode`（`GameBgMode`，初始 `getGameBgMode`）、`channel`（从 localStorage 读取的 `GameChannel`，默认 `"official"`；**只有 getter 的只读 state，本文件内无 setter，不可切换渠道**）、`banners`/`announcements`（公告数据）、`bannerIndex`（轮播索引）、`bannerHovered`（悬停暂停轮播）、`bannerPrevIndexRef`/`bannerDir`/`outgoingBanner`（翻页「推动」动画：前一索引 ref、方向 `1|-1`、离场图索引）、`announcementTab`（公告分类标签索引）。
- 74-78 行：`subscribeLauncherMode` 订阅 → 同步 `viewMode`。
- 80-89 行：`prevModeRef` + effect：`game → data` 调用 `suspendInAppBrowser()`，`data → game` 调用 `resumeInAppBrowser()`（模式切换时暂停/恢复内嵌浏览器）。
- 91-101 行：订阅 `subscribeLauncherBgMedia` 与 `subscribeGameBgMode`，同步 `bgMedia`、`bgMediaMode`。
- 103-105 行：`channel` 变化时写回 localStorage（当前等价于挂载时写一次）。
- 107-120 行：读取配置 `sidebar_rail_collapsed` 初始化 `sidebarCollapsed`；`toggleSidebarCollapsed()` 切换该状态并 `setConfig("sidebar_rail_collapsed", next)` 持久化。
- 122-150 行：**核心数据拉取**（依赖 `[channel]`）：`getBackgroundImage(channel)` 成功则 `setLauncherBgMedia(...)`、失败置 `null`；`getNoticeContent(channel)` 成功则写入 `banners`/`announcements`（含 console 日志），失败清空两者；两项请求共同计入启动 Splash 初始任务。
- 152-159 行：Banner 自动轮播，`setInterval` 5000ms，`banners.length <= 1` 或 `bannerHovered` 时不启动。
- 161-177 行：轮播「推动」动画 effect——`bannerIndex` 变化时按 `bannerIndex === (prev + 1) % len` 判定 `bannerDir`（`1` 向右推、`-1` 向左推），把前一索引写入 `outgoingBanner` 并在 400ms 后清空；列表重载而索引未变时清掉残留离场图。
- 179-186 行：预加载全部 banner 图片（`new Image()`），避免翻页动画首帧闪白。
- 188-193 行：卸载时 `setLauncherBgMedia(null)` 清理背景。
- 195-203 行：派生值：`isGameMode`、`announcementCategories`（去重分类）、`activeAnnouncementCategory`、`filteredAnnouncements`（按当前分类过滤）。
- 205-413 行：**GAME MODE 分支**：
  - 207-214 行：背景源选择——`bgMediaMode === "video"` 且有 `video_url` 用视频，否则用 `image_url ?? video_url`。
  - 216-252 行：固定全屏背景（`<video autoPlay loop muted playsInline>`，或图片分支用 CSS 背景层：`background-size: cover` + `background-position: center` + `background-repeat: no-repeat`，即保持原始宽高比、取 `max(W/w, H/h)` 等比缩放到恰好完全覆盖视口、不留空白，溢出的长边方向居中裁掉；再叠加渐变遮罩；无资源时使用 CSS 渐变占位）。
  - 244-252 行：`CustomTitlebar`（244）、顶部中央背景模式悬浮切换器（246-249，仅 `bgMedia` 非空时挂载 `GameBackgroundSwitch`）、`InAppBrowser`（252，`z-40`，覆盖切换器）。
  - 255-410 行：内容层（`z-10`）：底部左侧「Banner + 公告」玻璃盒（262-403 行）与右侧 `GameActionPanel`（405-408 行）。
    - 262-403 行：Banner 轮播 + 公告玻璃盒——翻页时离场图（271-282 行，绝对定位）向反方向推走（`.animate-banner-push-out-left/right`），入场图（287-309 行，`z-[1]`）从对应方向推入（`.animate-banner-push-in-right/left`）；点击 `jump_url` 走 `openInAppBrowser`，`onError` 隐藏图片；图片悬停时 `group-hover:scale-[1.08]` + `transition-transform duration-300` 缩放。悬停显示左右箭头（312-337 行，环形取模翻页）；底部圆点指示器（340-353 行）。公告区分类 Tab（361-376 行，`setAnnouncementTab`）+ 列表（379-396 行，`slice(0, 6)` 只显示 6 条，点击条目 `openInAppBrowser(item.jump_url)`）；无分类时显示 “No announcements”（398-402 行）。
- 415-491 行：**DATA MODE 分支**（默认业务界面）：
  - 417-418 行：`dashboard-background` 背景层；420 行：`CustomTitlebar`。
  - 422-434 行：桌面端侧边栏——外层 `div` 宽度在 `w-72` 与 `w-[64px]` 间以 `transition-[width] duration-300 ease-out` 平滑过渡（`overflow-hidden` 裁剪），向 `<Sidebar collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebarCollapsed} />` 传入折叠状态与切换回调。
  - 436-449 行：移动端抽屉（`mobileOpen` 为真时渲染遮罩 + `Sidebar onNavigate={关闭}`）。
  - 451-465 行：`<main>` 滚动容器，内部 `div` 以 `location.pathname` 为 key 强制路由切换时重挂载，其中 `<Suspense>` 包裹 `{children}`，懒加载页面 chunk 未就绪时以居中的 `GlassSpinner` 作为兜底（布局外壳保持挂载）。
  - 468-488 行：移动端右下角浮动菜单按钮（`lg:hidden`），点击 `setMobileOpen(true)`。
- 493-616 行：背景模式切换器实现——触发区常量（493-495）、选项表 `BG_MODE_OPTIONS`（497-512）、`GameBackgroundSwitch`（518-616）：固定定位在 `top-12`（标题栏下方）居中，隐藏态 `-translate-y-2 scale-95 opacity-0 pointer-events-none`，显示态复位（`transition-all duration-300 ease-out` 浮出动画）；胶囊容器内为滑动主色指示块 + 两个图标按钮（`h-8 w-9`，`MorphIcon size=16`），激活图标使用 `text-primary-foreground`。

**备注**：
- **invoke 命令**：本文件无直接 `invoke(...)`；间接经 `launcherService` 调用 `launcher_get_notice_content`（公告）与 `launcher_get_background_image`（背景）。
- 路由：作为所有业务路由的外层包裹（`App.tsx` 中 `/`、`/settings`、`/account`、`/characters`、`/medals`、`/attendance`、`/gacha`、`/developer` 均包在 `DashboardLayout` 内）。
- 平台限制：游戏启动器页面分支和公告/背景 IPC 仅在 Windows 启用；`launcherMode` store 在其他平台始终返回 data 模式。
- 关键 window/事件语义：无自定义 window 事件；使用 store 订阅（`subscribeLauncherMode`/`subscribeLauncherBgMedia`/`subscribeGameBgMode`）；`GameBackgroundSwitch` 额外监听 window `mousemove` 实现顶部中央浮出与离场收起。
- localStorage：`launcher_channel`（读写）；背景模式 `game_bg_mode` 由 `stores/launcherMode` 读写。
- 配置键（configService）：读 `sidebar_rail_collapsed`；写 `sidebar_rail_collapsed`。
- i18n：切换器的分组/图标文案复用 `settings.game_launch.bg_media`、`bg_media_video`、`bg_media_image`，无新增文案键。
- 模式切换要点：`viewMode` 决定分支，`game` 分支**不渲染 children**（业务页面被丢弃），`data` 分支才渲染 `{children}`；因此 game 模式下页面组件会卸载。

## `src/layouts/default.tsx`
**职责**：极简默认布局：顶部 `Navbar` + 居中主内容容器 + 底部 “Powered by HeroUI” 页脚。当前为模板遗留代码。

**导出**：`export default function DefaultLayout`（默认导出，接收 `{ children }`）。

**主要依赖**：`@/components/navbar`（`Navbar`）；无第三方状态库。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `DefaultLayout` | default.tsx:3 | 布局组件：`div h-screen` → `Navbar`(10) → `main.container max-w-7xl pt-16`(11-13) → `footer`(14-24，外链 heroui.com) |

**内部结构**：
- 1 行：导入 `Navbar`。
- 3-7 行：函数签名与 props 类型。
- 8-26 行：JSX（无状态、无副作用）。

**备注**：
- **invoke 命令**：无。
- **异常**：全仓库搜索显示该组件**未被任何文件 import**（`App.tsx` 未使用），属未挂载的遗留布局；改动它不会影响现有界面。

## `src/pages/dashboard.tsx`
**职责**：仪表板主页。在「标签页选择器（selector）」与「标签页卡片画布（tab）」两种视图间切换，负责 Tab 的增删改查、卡片（Card）的新增/删除/编辑模式、刷新以及角色选择弹窗等完整交互流程。

**导出**：`export default function DashboardPage`（默认导出组件）。

**主要依赖**：
- 项目内：`@/components/ui/glass`（`GlassButton`/`GlassProgressCircle`/`GlassTooltip`）、`@/components/cards/card-container`（`CardContainer`）、`@/components/dashboard-fab`（`DashboardFAB`）、`@/components/add-card-modal`（`AddCardModal`）、`@/components/cards/character-list/character-list-size-modal`（`CharacterListSizeModal`）、`@/components/tab-selector`（`TabSelector`）、`@/components/tab-editor-modal`（`TabEditorModal`）、`@/components/custom-modal`（`CustomModal` 系列）、`@/components/ui/confirm-dialog`（`confirmDialog`）、`@/components/ui/app-icon`（`RefreshIcon`/`ChevronLeftIcon`）、`@/utils/accountService`、`@/utils/dashboardConfig`、`@/utils/tabService`、`@/utils/tabIcons`（`getTabIcon`，实为 `tabIcons.tsx`）、`@/utils/logger`、`@/utils/roleDetailService`、`@/utils/cardConfigService`（`CardConfigService`）、`@/cards/startup-service`（`CardStartupService`）、`@/utils/imageLoader`（`Img`）、`@/utils/startupProgress`（`trackStartupTask`）、`@/types/dashboard`、`@/types/card-settings`、`@/types`（`resolveServerLabel`）。
- 第三方：`react`（`useEffect`/`useState`）、`react-i18next`（`useTranslation`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `DashboardView`（type） | dashboard.tsx:43 | `"loading" \| "selector" \| "tab"` 三态视图类型 |
| `DashboardPage` | dashboard.tsx:45 | 页面组件（唯一导出），见内部结构 |
| `activeTab`（派生） | dashboard.tsx:67 | `tabs.find(t => t.id === activeTabId)` |
| `loadDashboard` | dashboard.tsx:69 | 核心加载流程：取选中账户 → `roleDetailService.setCurrentRoleId` → 读全部 Tab → 恢复/兜底激活 Tab → `getDashboardConfig` → 决定 `view` |
| 初始加载 effect | dashboard.tsx:108 | 挂载时 `trackStartupTask(loadDashboard())`；监听 window 事件 `accountChanged`、`manualRefresh` 并重载 |
| `handleRefresh` | dashboard.tsx:125 | 派发 `manualRefresh` 自定义事件 → `refreshAccountData()` → 成功后 `loadDashboard()`；控制 `isRefreshing` |
| `handleAddCard` | dashboard.tsx:145 | 新增卡片入口：`character_list` 先弹尺寸弹窗，其余直接 `openRoleSelect` |
| `openRoleSelect` | dashboard.tsx:155 | 拉取 `getAccounts()`，设置 `availableAccounts`/`pendingCardType`/默认选中角色，打开角色选择弹窗 |
| `closeRoleSelect` | dashboard.tsx:167 | 关闭弹窗并清空 `pendingCardType`/`pendingDisplayMode`/`selectedRoleId` |
| `handleSizeConfirm` | dashboard.tsx:174 | 记录 `pendingDisplayMode` 后转到角色选择 |
| `handleRoleConfirm` | dashboard.tsx:181 | 真正 `addCard(...)`：按卡片类型写入不同 `settings`，随后 `getDashboardConfig` 刷新并 `setHighlightedCardId` |
| 高亮滚动 effect | dashboard.tsx:221 | 200ms 后 `scrollIntoView` 到 `[data-card-id="..."]`，2800ms 后清除高亮 |
| `handleRemoveCard` | dashboard.tsx:236 | 并行清理：`CardConfigService.removeCardSettings` + `CardStartupService.removeCardFromMapping` + `removeCard`，再重载配置 |
| `handleSelectTab` | dashboard.tsx:253 | 激活指定 Tab 并载入其配置，`view = "tab"` |
| `handleBackToSelector` | dashboard.tsx:261 | 清空激活 Tab 与配置，`view = "selector"`，重读 Tab 列表 |
| `handleCreateTab` | dashboard.tsx:270 | 打开 Tab 编辑弹窗（`editingTab = undefined` 表示新建） |
| `handleEditTab` | dashboard.tsx:275 | 打开 Tab 编辑弹窗并带入 `editingTab` |
| `handleDeleteTab` | dashboard.tsx:280 | `confirmDialog` 确认后 `removeTab`，若删的是当前 Tab 则清空激活状态 |
| `handleSaveTab` | dashboard.tsx:299 | `editingTab` 存在走 `updateTab`，否则 `addTab(name, icon, tags, defaultRoleId)`，随后重载 Tab 列表 |
| 加载中渲染分支 | dashboard.tsx:316-327 | `isLoading && view === "loading"` 时渲染不定向 `GlassProgressCircle` |
| selector 渲染分支 | dashboard.tsx:329-350 | `TabSelector` + `TabEditorModal` |
| `IconComponent`（派生） | dashboard.tsx:352 | `getTabIcon(activeTab.icon)`，用于标题左侧图标 |
| tab 主渲染分支 | dashboard.tsx:354-532 | 头部（返回/标题/刷新）+ 内容（刷新中/卡片容器）+ 各类弹窗 |
| 头部区 | dashboard.tsx:356-407 | 返回按钮（`handleBackToSelector`，tooltip `settings.account.back`）、Tab 名与提示文案、刷新按钮（`handleRefresh`，`isRefreshing` 时 `animate-spin` 且禁用） |
| 刷新中占位 | dashboard.tsx:409-420 | `isRefreshing` 时显示进度圈 + `common.refreshing` |
| `CardContainer` | dashboard.tsx:422-431 | 传入 `roleId`（优先 `activeTab.defaultRoleId`，否则 `currentRoleId`）、`tabId`、`cards`、编辑模式回调与 `highlightCardId` |
| `DashboardFAB` | dashboard.tsx:434-438 | 浮动按钮：`onAddCard` 打开加卡弹窗，`onToggleEdit` 切换编辑模式 |
| `AddCardModal` | dashboard.tsx:440-447 | 传 `existingTypes` 去重，`onAdd = handleAddCard` |
| `CharacterListSizeModal` | dashboard.tsx:449-456 | 角色列表尺寸选择，`onConfirm = handleSizeConfirm` |
| 角色选择 `CustomModal` | dashboard.tsx:459-530 | 列出 `availableAccounts`（头像 `Img`、`resolveServerLabel` + 等级），选中态 `selectedRoleId`，确认走 `handleRoleConfirm` |

**内部结构**：
- 1-41 行：导入。
- 43-67 行：类型与全部 state（19 个）：`view`、`tabs`、`activeTabIdState`、`currentRoleId`、`dashboardConfig`、`isLoading`、`isEditMode`、`isAddCardModalOpen`、`isRefreshing`、`isSizeModalOpen`、`pendingCardType`、`isEditorOpen`、`editingTab`、`isRoleSelectModalOpen`、`pendingDisplayMode`、`availableAccounts`、`selectedRoleId`、`highlightedCardId`，以及派生 `activeTab`。
- 69-105 行：`loadDashboard` 异步流程与错误处理（`logError`，失败仅 `setIsLoading(false)`）。
- 107-123 行：挂载 effect —— 初始化加载 + window 事件 `accountChanged` / `manualRefresh` 监听（卸载时移除）。
- 125-234 行：刷新与新增卡片相关处理函数（含 `SIZE_MAP`：`single→2x3`、`double→3x3`、`triple→4x3`，见 188-192 行）与高亮滚动 effect。
- 236-314 行：删除卡片、Tab 选择/返回/新建/编辑/删除/保存处理函数。
- 316-352 行：加载中与 selector 分支渲染 + `IconComponent`。
- 354-533 行：tab 视图 JSX（头部 356-407、内容 409-432、FAB 434-438、三类弹窗 440-530）。

**备注**：
- **invoke 命令**：本文件无直接 `invoke(...)`，全部经服务层间接调用：
  - 账户：`get_selected_account`、`get_accounts`、`refresh_accounts`（`refreshAccountData = refreshAccounts`）。
  - Tab/配置存储：`get_config` / `set_config` / `remove_config`（键 `dashboard_tabs`、`dashboard_active_tab`）。
  - 卡片设置：`get_card_settings` / `save_card_settings` / `remove_card_settings`。
  - 其余经 `roleDetailService.setCurrentRoleId`、`CardStartupService.removeCardFromMapping` 内部处理（其内部无直接 invoke 字符串）。
- 路由：`/`（`App.tsx:59-66`），外层为 `DashboardLayout`。
- window 事件：监听 `accountChanged`、`manualRefresh`；派发 `manualRefresh`（`CustomEvent`，`detail.count = cards.length`）。**注意**：`handleRefresh` 既自己派发 `manualRefresh`（触发 listener 立即 `loadDashboard`）又在 `refreshAccountData` 后再次 `loadDashboard`，会造成一次冗余重载。
- i18n key：`tab.confirm_delete_title`、`tab.confirm_delete_body`、`common.delete/cancel/refresh/refreshing/confirm/unknown`、`nav.dashboard`、`dashboard.customize_hint`、`settings.account.back`、`card:select_role`、`card:no_accounts`。
- 卡片设置字段差异：`character_list` → `settings = { roleId, displayMode }` + 显式 `w/h`；`attendance` → `settings = { selectedRoleId }`（键名不同）；其他类型 → `settings = { roleId }`。
- 数据流：`tabService`（config 存储）→ `getDashboardConfig(tabId)` → `dashboardConfig.cards` → `CardContainer`；新增/删除卡片后必须重新 `getDashboardConfig` 才会刷新。

## `src/pages/attendance.tsx`
**职责**：签到（考勤）页面。读取当前选中账户 → 通过 Tauri 后端取签到原始数据并解析 → 渲染 `AttendanceRewards` 奖励面板；处理加载、错误与空态。

**导出**：`export default function AttendancePage`（默认导出组件）。

**主要依赖**：
- 项目内：`@/components/ui/glass`（`GlassCard`/`GlassProgressCircle`）、`@/utils/accountService`（`getSelectedAccount`/`getAccounts`/`Account`）、`@/types`（`resolveServerLabel`）、`@/components/cards/attendance/attendance-rewards`（`AttendanceRewards`）、`@/components/cards/attendance/index`（`parseAttendanceData`/`AttendanceData`）、`@/utils/logger`（`logError`）。
- 第三方：`react`（`useState`/`useEffect`/`useCallback`/`useMemo`）、`react-i18next`、`@tauri-apps/api/core`（`invoke`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AttendancePage` | attendance.tsx:11 | 页面组件：state 见下 |
| `attendanceData` 等 state | attendance.tsx:13-17 | `attendanceData`（解析后数据）、`accounts`、`accountId`、`isLoading`、`error` |
| `loadData` | attendance.tsx:19 | `useCallback([t])`：`getSelectedAccount` → 无选中则清空返回 → `getAccounts` → `invoke("get_attendance", { roleId })` → `parseAttendanceData`，解析失败设 `card:attendance_error`，异常 `logError` + `error = String(e)` |
| 初始加载 effect | attendance.tsx:49 | `loadData()`（依赖 `[loadData]`） |
| 账户切换 effect | attendance.tsx:53 | 监听 window `accountChanged` → `loadData()` |
| `selectedAccount` | attendance.tsx:59 | `useMemo`：按 `accountId` 从 `accounts` 找出当前账户 |
| 渲染 | attendance.tsx:64-106 | 标题 `sidebar.attendance` + 账户副标题（66-77 行）；四态互斥：`isLoading` 进度圈（79-87）→ `error` 卡片（88-93）→ 无数据卡片 `card:attendance_no_account`（94-99）→ `GlassCard + AttendanceRewards`（100-104） |

**内部结构**：
- 1-9 行：导入。
- 11-17 行：组件与状态声明。
- 19-57 行：数据加载（`loadData`）与两个 effect。
- 59-62 行：`selectedAccount` 派生。
- 64-106 行：JSX 渲染（无弹窗、无分页）。

**备注**：
- **invoke 命令**：`get_attendance`（attendance.tsx:33，参数 `{ roleId }`）。
- 路由：`/attendance`（`App.tsx:99-106`），外层 `DashboardLayout`。
- window 事件：监听 `accountChanged`（账户切换时重载）。
- i18n key 前缀：`sidebar.attendance`、`card:attendance_error`、`card:attendance_no_account`。
- 数据流：`getSelectedAccount()`（invoke `get_selected_account`）+ `getAccounts()`（invoke `get_accounts`）→ `invoke("get_attendance")` → `parseAttendanceData`（解析逻辑在 `@/components/cards/attendance/index`）→ `AttendanceRewards`。

## `src/pages/medals.tsx`
**职责**：勋章页面。读取当前选中账户的完整角色详情，取出 `achieve.achieveMedals` 列表交给 `MedalBrowser` 浏览；处理加载、空态与账户切换。

**导出**：`export default function MedalsPage`（默认导出组件）。

**主要依赖**：
- 项目内：`@/components/ui/glass`（`GlassCard`/`GlassProgressCircle`）、`@/utils/accountService`（`getSelectedAccount`）、`@/utils/roleDataService`（`roleDataService.getFullCharDetail`）、`@/components/cards/achievement/medal-browser`（`MedalBrowser`）、`@/types/charDetail`（`AchieveMedal`）、`@/utils/logger`（`logError`）。
- 第三方：`react`（`useState`/`useEffect`/`useCallback`）、`react-i18next`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `MedalsPage` | medals.tsx:10 | 页面组件 |
| `medals` / `isLoading` | medals.tsx:12-13 | 仅两个 state：勋章数组、加载标记（**无 error state**，异常只写日志） |
| `loadData` | medals.tsx:15 | `useCallback([])`：`getSelectedAccount` → 无 id 则结束加载 → `roleDataService.getFullCharDetail(id)` → 有 `detail?.achieve?.achieveMedals` 则写入，否则置 `[]`；`catch` 仅 `logError` |
| 初始加载 effect | medals.tsx:36 | `loadData()` |
| 账户切换 effect | medals.tsx:40 | 监听 window `accountChanged` → `loadData()` |
| 渲染 | medals.tsx:46-80 | 标题 `sidebar.medals` + 数量副标题（52-56 行）；三态互斥：`isLoading` 进度圈（59-67）→ `medals.length === 0` 空态卡片 `card:ach_no_medals`（68-73）→ `MedalBrowser medals={medals}`（74-78，外层 `flex-1 min-h-0` 撑满高度） |

**内部结构**：
- 1-8 行：导入。
- 10-13 行：组件与状态。
- 15-44 行：`loadData` 与两个 effect。
- 46-80 行：JSX（标题区 48-57、三态内容 59-78）。

**备注**：
- **invoke 命令**：本文件无直接 `invoke(...)`；间接经 `roleDataService.getFullCharDetail`（其内部亦无直接 invoke 字符串，数据来自角色详情服务）与 `getSelectedAccount`（invoke `get_selected_account`）。
- 路由：`/medals`（`App.tsx:91-98`），外层 `DashboardLayout`。
- window 事件：监听 `accountChanged`。
- i18n key：`sidebar.medals`、`card:ach_no_medals`。
- 数据流：`getSelectedAccount()` → `roleDataService.getFullCharDetail(id)` → `detail.achieve.achieveMedals` → `MedalBrowser`。注意加载失败不显示错误提示，只会表现为「无勋章」空态（仅日志可见）。

## `src/pages/domain.tsx`
**职责**：区域信息独立页面。把 `domain_info` 卡片的数据（大世界区域等级、区域货币、基建建设点）以整页排版呈现：顶部页头（标题 + 账户切换按钮 + 刷新）→ 多区域胶囊切换 → 概览卡（区域名 / 等级 / 货币进度条）→ 建设点卡片网格（头像、名称、等级、MAX 徽标、货币与经验进度条、上次产出时间）。

**导出**：`export default function DomainPage`（默认导出组件）。

**主要依赖**：
- 项目内：`@/components/cards/domain-info/domain-shared`（`DomainData`/`DomainSettlement`/`formatMoney`/`formatDateTime`/`getMoneyName`，与卡片共用）、`@/utils/roleDataService`（`queryData`、`clearCache`）、`@/utils/accountService`（`getAccounts`/`getSelectedAccount`/`refreshAccountData`）、`@/utils/configService`（`getConfig`/`setConfig`）、`@/components/ui/glass`、`@/components/custom-modal`、`@/components/ui/account-avatar`、`@/components/icons`（`CardIcon`）、`@/utils/imageLoader`（`Img`）、`@/types`（`resolveServerLabel`）。
- 第三方：`react`、`react-i18next`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ROLE_CONFIG_KEY` | domain.tsx:38 | 配置键 `"domain_page_role_id"`，页面独立记忆的游戏账户；未设置时跟随全局选中账户 |
| `percent(current, max)` | domain.tsx:40 | 进度百分比工具（钳制 0–100） |
| `DomainPage()` | domain.tsx:50 | 页面组件 |
| `loadData` | domain.tsx:55 | `useCallback`：解析 roleId（配置优先，其次 `getSelectedAccount`）→ `roleDataService.queryData(id, "char_detail", ["domain"])` → 写入 `domains` 并校正 `selectedDomainId` |
| `handleRefresh` | domain.tsx:120 | `refreshAccountData()` → `roleDataService.clearCache(roleId, "char_detail", ["domain"])` → 重新加载 |
| `handleSelectRole` | domain.tsx:135 | `setConfig(ROLE_CONFIG_KEY, id)` + 以该账户重新加载（下拉菜单项点击） |
| 渲染 | domain.tsx:160+ | 加载进度圈 / 空态卡片（`domain_page.empty`）/ 概览卡 + 建设点网格 `grid-cols-1 sm:2 xl:3`；多区域时标题下方渲染毛玻璃胶囊区域 switch；页头账户切换为下拉菜单（样式对齐 `gacha-records.tsx`：`GlassButton` + 绝对定位列表 + 点击外部关闭），仅本页生效 |

**备注**：
- 路由：`/domain`（`App.tsx`，`ROUTES` 已加入 `/domain`），外层 `DashboardLayout`；侧栏入口见 `components/dashboard-sidebar.tsx` 的 `NavKey = "domain"`（`MapIcon`）。
- **invoke 命令**：无直接 `invoke(...)`；间接 `query_role_data`（`roleDataService`）、`get_accounts`/`get_selected_account`/`refresh_accounts`（`accountService`）、`get_config`/`set_config`（`configService`）。
- window 事件：监听 `accountChanged`（以全局选中账户重载）、`manualRefresh`（重载）。
- i18n key：`sidebar.domain`、`domain_page.{subtitle,domain,money,empty,switch_account}`、`common.{unknown,refresh,cancel}`，卡片键复用 `card:domain_info_*`、`card:select_role`、`card:no_accounts`、`card:current`。
- 与卡片的关系：卡片按 `cardId` 存 `DomainInfoCardSettings`；页面按 `ROLE_CONFIG_KEY` 全局存账户，两者互不影响。

## `src/pages/spaceship.tsx`
**职责**：帝江号独立页面。把 `spaceship` 卡片的数据（各舱室等级、派驻干员心情/信赖）以整页排版呈现：页头（图标标题 + 副标题 + 账户切换下拉 + 刷新）→ 概览卡（舱室数量、派驻干员总数、舱室等级 pill 一览）→ 舱室详情双列卡片（图标、名称、等级、每位派驻干员的头像色环 + 心情/信赖进度条）。点击概览区的舱室 pill 会弹出舱室详情 `CustomModal`。

**导出**：`export default function SpaceshipPage`（默认导出组件）。

**主要依赖**：
- 项目内：`@/components/cards/spaceship/spaceship-shared`（类型 + 心情/信赖计算 + 排序，与卡片共用）、`@/utils/roleDataService`（`queryData`、`getFullCharDetail`、`clearCache`）、`@/utils/accountService`（`getAccounts`/`getSelectedAccount`/`refreshAccountData`）、`@/utils/configService`（`getConfig`/`setConfig`）、`@/components/ui/glass`、`@/components/custom-modal`、`@/components/icons`（`CardIcon`）、`@/utils/imageLoader`（`Img`）、`@/types`（`resolveServerLabel`）、`@/types/charDetail`。
- 第三方：`react`、`react-i18next`、`clsx`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ROLE_CONFIG_KEY` | spaceship.tsx:43 | 配置键 `"spaceship_page_role_id"`，页面独立记忆的游戏账户；未设置时跟随全局选中账户 |
| `SpaceshipPage()` | spaceship.tsx:45 | 页面组件 |
| `loadData` | — | 并行 `queryData(id,"char_detail",["spaceShip"])` + `getFullCharDetail(id)`；写入 `rooms`/`charDetail` |
| `handleRefresh` | — | `refreshAccountData()` → `clearCache` → 重新加载 |
| `handleSelectRole` | — | 下拉菜单项点击：`setConfig` + 重载（账户下拉样式对齐 `gacha-records.tsx`） |
| `sortedRooms` / `roomsWithChars` | — | `sortSpaceshipRooms`（总控中枢置顶）+ 每舱室解析派驻干员视图 |
| `detailRoomIndex` | — | 舱室详情弹窗的打开索引（点击概览 pill 触发） |

**备注**：
- 路由：`/spaceship`（`App.tsx`，`ROUTES` 已加入），外层 `DashboardLayout`；侧栏入口 `NavKey = "spaceship"`（`SatelliteIcon`）。
- **invoke 命令**：无直接 `invoke(...)`；间接 `query_role_data`、`get_accounts`/`get_selected_account`/`refresh_accounts`、`get_config`/`set_config`。
- window 事件：监听 `accountChanged`、`manualRefresh`。
- i18n key：`spaceship_page.{subtitle,switch_account,total_rooms,stationed_total,room_levels,section_rooms}`、`common.{unknown,refresh}`，其余复用卡片命名空间 `card:spaceship_*`。
- 心情进度条渐变样式抽取为 `getMoodBarClass`（`spaceship-shared.ts`），页面使用；卡片仍用内联条件。

## `src/pages/todo.tsx`
**职责**：To-Do 独立页面。左侧为列表管理（搜索、新建、拖拽排序、分组、复制、删除、设置），右侧为当前列表的完整编辑器（`TodoDetail`，与卡片/弹窗共用）；支持模板新建与 Markdown/JSON 导入导出；以 URL 查询参数 `?list=<id>` 记录当前列表。
**导出**：`export default TodoPage`。
**主要依赖**：`@/stores/todoStore`（`useTodoLists`/`createTodoList`/`deleteTodoList`/`duplicateTodoList`/`reorderTodoLists`/`isOverdue`）、`@/utils/todoDefaults`、`@/utils/todoImportExport`、`@/components/cards/todo/todo-detail`、`@/components/cards/todo/list-settings-modal`、`@/components/ui/{page-header,empty-state,confirm-dialog}`、`@/components/custom-modal`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TodoPage()` | 默认导出 | 页面组件 |
| `activeListId` | 顶部 | 来自 `useSearchParams().get("list")`；不自动选择列表；选中列表被删除后清除 URL 选择 |
| `grouped` | useMemo | `groupBy` 开启时按 `list.group` 分组，未分组归入 `todo_page.ungrouped` |
| `handleCreate` | — | 按 `TODO_TEMPLATES` 选中的模板生成初始事项（标题/事项文案走 `card:` i18n），再跳转到新列表 |
| `handleImport` | — | 读取文件文本，`.json` 走 `parseJsonList`，否则 `parseMarkdownList`，随后 `createTodoList` |
| `handleExport` | — | `listToMarkdown` / `listToJson` → `Blob` → `<a download>` |

**备注**：
- 顶部操作为「导入 / 导出 Markdown / 导出 JSON / 新建列表」。
- 路由：`/todo`（`App.tsx`，`ROUTES` 已加入 `/todo`），外层 `DashboardLayout`；侧栏入口见 `components/dashboard-sidebar.tsx` 的 `NavKey = "todo"`。
- 未使用 `invoke`；持久化全部经 `todoStore` → `utils/configService` → `get_config`/`set_config`。

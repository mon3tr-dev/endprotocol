# 布局与仪表板/签到/勋章页面 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## `src/layouts/dashboard.tsx`
**职责**：全局仪表板外壳布局。根据 `launcherMode` 切换两种完全不同的渲染分支：Windows 上的 `game`（游戏启动器全屏背景 + 顶部中央背景模式悬浮切换器 + 底部公告/轮播 + 游戏操作面板）与 `data`（侧边栏 + 可滚动内容区，包裹所有业务页面）。同时负责加载背景媒体与公告数据、在游戏/数据模式间挂起与恢复内置浏览器；非 Windows 平台固定使用 data 模式且不请求启动器公告/背景。

**导出**：`export default function DashboardLayout`（默认导出，React 组件，接收 `{ children }`）。

**主要依赖**：
- 项目内：`@/components/custom-titlebar`（`CustomTitlebar`）、`@/components/dashboard-sidebar`（`Sidebar`）、`@/components/in-app-browser`（`InAppBrowser`）、`@/components/game-action-panel`（`GameActionPanel`）、`@/components/game-sidebar-rail`（`GameSidebarRail`，游戏模式右侧官方社媒栏）、`@/stores/launcherMode`（模式、背景媒体与 `game_bg_mode` 的可订阅 store，含 `setGameBgMode`）、`@/stores/inAppBrowser`（`openInAppBrowser`/`suspendInAppBrowser`/`resumeInAppBrowser`）、`@/utils/launcherService`（`getNoticeContent`/`getBackgroundImage` 与 `GameChannel`/`BannerItem`/`AnnouncementItem`/`SidebarItem` 类型）、`@/utils/platform`（`isWindowsPlatform`）、`@/utils/startupProgress`（`trackStartupTask`）。
- 项目内（续）：`@/components/ui/glass`（`GlassProgressCircle`，作为懒加载页面的 `Suspense` 兜底——与页面自身的加载态用同一种环）、`@/utils/configService`（`getConfig`/`setConfig`，读写侧边栏折叠状态）。
- 第三方：`react`（`useState`/`useEffect`/`useRef`/`Suspense`）、`react-router-dom`（`useLocation`）、`clsx`、`react-i18next`（`useTranslation`）、`morphicons/react`（`MorphIcon`）、`lucide`（`ChevronLeft`/`ChevronRight`/`Video`/`Image as ImageIcon`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `DashboardLayoutProps` | dashboard.tsx:56-58 | 接口，仅含 `children: React.ReactNode` |
| `DashboardLayout` | dashboard.tsx:60 | 页面外壳组件：见下方「内部结构」 |
| `BG_SWITCH_TRIGGER_HEIGHT` | dashboard.tsx:612 | 浮出触发区：指针距窗口顶部 ≤150px |
| `BG_SWITCH_TRIGGER_HALF_WIDTH` | dashboard.tsx:613 | 浮出触发区：指针水平距窗口中线 ≤220px |
| `BG_SWITCH_HIDE_DELAY` | dashboard.tsx:614 | 离开触发区后 300ms 收起 |
| `BG_MODE_OPTIONS` | dashboard.tsx:616-631 | 两个选项：`video`（`Video`）、`image`（`ImageIcon`），标签键 `settings.game_launch.bg_media_video` / `bg_media_image` |
| `GameBackgroundSwitch` | dashboard.tsx:637-735 | 内部组件（未导出）：游戏界面顶部中央的背景模式悬浮切换器；props `mode: GameBgMode`、`media: LauncherBgMedia`；监听 window `mousemove` 控制浮出/收起动画，点击图标调用 `setGameBgMode`（与设置页共用 store），`video_url`/`image_url` 缺失的选项禁用 |

**内部结构**：
- 1-52 行：导入与常量（`STORAGE_KEY_CHANNEL` 已随「按游戏分区」改造移除，渠道改由 `readGameChannel(game)` 读 `launcher_channel[_arknights]`）。
- 54 行：旧键名注释（仅用于把历史选择迁移到按游戏分区的键上）。
- 60-83 行：组件声明与全部状态：`location`(useLocation)、`mobileOpen`（移动端抽屉开关）、`sidebarCollapsed`（桌面端侧边栏折叠为窄轨，初始 `false`）、`viewMode`（初始 `getLauncherMode()`）、`bgMediaMode`（初始 `getGameBgMode`）、`activeGame`（当前选中的游戏，初始 `getActiveGame()`）、`channel`（按游戏分区读取的 `GameChannel`，初始 `readGameChannel(getActiveGame())`）。
- 95-118 行：**整页推移**的状态：`push`（`PushState`：出栈页 / 入栈页 / 方向）、`pushProgress`（动画进度 0→1）、`pushRafRef`（rAF 句柄）、`pushProgressRef`。
- 120-167 行：`runPush(from, to, direction)`——rAF 驱动的推移动画（460ms，缓动与 `--lg-ease-emphasized` 一致）。**用 rAF 而不是 CSS transition**：两页的位置都由同一个进度算出来，CSS 要写两套 keyframes 且难以保证严格同步（一边先到、一边后到就穿帮了）。
- 169-181 行：`subscribeLauncherMode` 订阅 → 同步 `viewMode`；`prevModeRef` + effect 处理 `game ⇄ data` 的内嵌浏览器暂停/恢复。
- 193-204 行：订阅 `subscribeGameBgMode`，同步 `bgMediaMode`。
- 206-236 行：订阅 `subscribeActiveGame` → 切游戏时同步 `activeGame` 与该游戏的 `channel`，并触发**整页推移**：先看新页数据在不在缓存里（`getCachedPageData`），在就直接推，不在就等 `fetchPageData` 拉完再推（等的时候旧页还留在原地，不会出现「新页一片空白」）。
- 238-241 行：`prefetchOtherGame(activeGame)`——预取另一个游戏的数据，第一次切过去时不用等网络。
- 243-252 行：**初次进入补拉当前游戏**——页面数据缓存是模块级 Map（`game-page.tsx` 的 `pageCache`），F5 刷新/应用启动后为空，而预取只拉「另一个游戏」，当前游戏的背景与公告会一直空着（切一次游戏才恢复）。挂载时缓存没有当前游戏数据就 `fetchPageData`，完成后 bump `pageDataVersion` 触发 `pages` useMemo 重算（缓存读取不进依赖，靠这个版本号触发）。
- 243-249 行：`channel` 变化时若跨了游戏，把游戏选择也跟上（`setActiveGame(owner)`）。
- 251-264 行：读取配置 `sidebar_rail_collapsed` 初始化 `sidebarCollapsed`；`toggleSidebarCollapsed()` 切换并持久化。
- 266-272 行：卸载时 `setLauncherBgMedia(null)` 清理背景。
- 278-330 行：**页面层**（`pages`，`useMemo`）——推移期间渲染哪几页、每页的位移与数据。非推移时只有当前页；推移时是出栈页 + 入栈页两页，各自带着自己的背景与数据。

**游戏切换：整页推移**：
切游戏时不是「各处淡入淡出」，而是**两页同时在场、整页推移**：
- 往下切（《终末地》→《明日方舟》）：新页从下方进入，把旧页往上方推出视口。
- 往上切：方向相反。
- 每页是一个绝对定位的整屏容器（`transform: translateY(...)`），背景、横幅、公告、操作面板、标题栏品牌区都在这一页里，跟着一起被推走。
- **只动 transform，不做淡入**：元素 opacity < 1 会让它成为 backdrop root，自身与后代的 backdrop-filter 当场失效，玻璃退化成半透明色块（globals.css「动效系统」的硬约束）。
- **数据必须先于动画到位**：后台拉公告/背景要走 HTTP，耗时不可控，所以按游戏缓存 + 预取另一个游戏（见 `components/game-page.tsx`）。

**标题栏拆两半**（避免重复窗口按钮）：标题栏整条渲染两份会出现**重复的窗口控制按钮**，整条只渲染一份则品牌区（游戏名）不会跟着页面走。所以 `TitlebarBrand` 随页面走（两页各一份，`brandOnly`），`TitlebarControls`（铃铛 + 窗口三键）固定在右上角（只一份，`controlsOnly`）。

- 264-492 行：**GAME MODE 分支**：
  - 296-305 行：标题栏右侧区（`controlsOnly`）——固定不动，不跟页面走；覆盖层容器 `self-end` 只占右侧控件自身宽度（整宽的 `pointer-events-auto` + drag region 会盖住页面层品牌区，模式拨杆点不动）。
  - 307-... 行：**页面层**（`pages.map`）：每页一个 `absolute inset-0` 容器，`transform` 为该页当前的位移、`zIndex` 出栈页 0 / 入栈页 1（useMemo 依赖含 `pageDataVersion`——初次拉到页面数据后 bump 触发重算，否则刷新后背景/公告一直是空的）；页内含全屏背景（`<video autoPlay loop muted playsInline>`，或图片分支用 CSS 背景层：`background-size: cover` + `background-position: center` + `background-repeat: no-repeat`，即保持原始宽高比、取 `max(W/w, H/h)` 等比缩放到恰好完全覆盖视口、不留空白，溢出的长边方向居中裁掉；再叠加渐变遮罩；无资源时使用 CSS 渐变占位）、标题栏品牌区（`brandOnly`）、背景模式切换器、`InAppBrowser`（`z-40`）、`GamePageContent`（右侧社媒栏 + 底部横幅公告盒 + 操作面板）。
  - 页面层之后：`GameSwitchRail`（左侧贴边游戏切换栏）——**只挂载一份、放在页面层之外**：它本身 portal 到 body、fixed 贴左边缘，不随页面推移；放进页面层会导致每次切换随新页重新挂载出收起态的新实例（portal 后入者的 DOM 顺序在上，盖住旧实例），表现为切一下游戏左侧栏就收回去、要再动一下鼠标才重新展开。
  - **游戏模式不挂磨砂层**：背景是视频，标题栏保持背景本身清晰（原先的 `.frost-main frost-titlebar-only` 已移除）。
- 494-609 行：**DATA MODE 分支**（默认业务界面）：
  - 497 行：`dashboard-background` 背景层；515 行：`CustomTitlebar`。
  - 渐变磨砂层：`.frost-main frost-with-sidebar` 全屏覆盖层（504-512 行，`--frost-sidebar-w` 按折叠状态写入 `288px`/`64px`），纵向遮罩对应标题栏、横向遮罩对应侧边栏，两者取并集形成连通的 L 形强区；**游戏模式不再铺磨砂层**（原先的 `.frost-main frost-titlebar-only` 已移除，标题栏直接露出背景视频）。放在背景层之上、veil 之下、内容层之下。
  - 519-529 行：桌面端侧边栏——外层 `div` 宽度在 `w-72` 与 `w-[64px]` 间以 `transition-[width] duration-300 ease-out` 平滑过渡（`overflow-hidden` 裁剪），向 `<Sidebar collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebarCollapsed} />` 传入折叠状态与切换回调。
  - 531-557 行：移动端抽屉（`mobileOpen` 为真时渲染遮罩 + `Sidebar onNavigate={关闭}`）；抽屉内另挂 `.frost-main frost-drawer`（545-553 行，fixed 定位、仅横向遮罩）。
  - 559-585 行：`<main>` 滚动容器，内部 `div` 带 `id="dashboard-main"`（562，仪表盘快照的截图基准：`tabSnapshotService` 以它的视口矩形计算截取区域）并以 `location.pathname` 为 key 强制路由切换时重挂载，其中 `<Suspense>` 包裹 `{children}`，懒加载页面 chunk 未就绪时以居中的 `GlassProgressCircle`（不定量 lg）作为兜底（布局外壳保持挂载）。
  - 587-607 行：移动端右下角浮动菜单按钮（`lg:hidden`），点击 `setMobileOpen(true)`。
- 612-735 行：背景模式切换器实现——触发区常量（612-614）、选项表 `BG_MODE_OPTIONS`（616-635）、`GameBackgroundSwitch`（637-735）：固定定位在 `top-12`（标题栏下方）居中，隐藏态 `-translate-y-2 scale-95 opacity-0 pointer-events-none`，显示态复位（`transition-all duration-300 ease-out` 浮出动画）；胶囊容器内为滑动主色指示块 + 两个图标按钮（`h-8 w-9`，`MorphIcon size=16`），激活图标使用 `text-primary-foreground`。

**备注**：
- **invoke 命令**：本文件无直接 `invoke(...)`；间接经 `launcherService` 调用 `launcher_get_notice_content`（公告 + Banner + 右侧栏）与 `launcher_get_background_image`（背景）。
- 路由：作为所有业务路由的外层包裹（`App.tsx` 中 `/`、`/settings`、`/account`、`/characters`、`/medals`、`/attendance`、`/gacha`、`/developer` 均包在 `DashboardLayout` 内）。
- 平台限制：游戏启动器页面分支和公告/背景 IPC 仅在 Windows 启用；`launcherMode` store 在其他平台始终返回 data 模式。
- 关键 window/事件语义：无自定义 window 事件；使用 store 订阅（`subscribeLauncherMode`/`subscribeLauncherBgMedia`/`subscribeGameBgMode`/`subscribeActiveGame`）；`GameBackgroundSwitch` 额外监听 window `mousemove` 实现顶部中央浮出与离场收起（右侧栏 `GameSidebarRail` 自己监听 `mousemove`，不在本文件）。
- localStorage：渠道按游戏分区读写 `launcher_channel` / `launcher_channel_arknights`（经 `launcherService.readGameChannel` / `gameConfigKey`）；背景模式 `game_bg_mode` 由 `stores/launcherMode` 读写；当前游戏 `launcher_game` 由 `stores/launcherGame` 读写。
- 配置键（configService）：读 `sidebar_rail_collapsed`；写 `sidebar_rail_collapsed`。
- i18n：切换器的分组/图标文案复用 `settings.game_launch.bg_media`、`bg_media_video`、`bg_media_image`；右侧栏文案见 `launcher.sidebar.*`（在 `game-sidebar-rail.tsx` 内）。
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
**职责**：仪表板主页（主界面）。在「标签页选择器（selector，即主界面）」与「标签页卡片画布（tab）」两种视图间切换，负责 Tab 的增删改查、卡片（Card）的新增/删除/编辑模式、刷新、角色选择弹窗等完整交互流程；并实现**仪表盘快照**——离开当前标签页视图前趁画面仍是旧标签页，调用 `tabSnapshotService` 截内容区左上角落盘，主界面卡片即展示该截图。

**导出**：`export default function DashboardPage`（默认导出组件）。

**主要依赖**：
- 项目内：`@/components/ui/glass`（`GlassButton`/`GlassProgressCircle`/`GlassTooltip`）、`@/components/cards/card-container`（`CardContainer`）、`@/components/dashboard-fab`（`DashboardFAB`）、`@/components/add-card-modal`（`AddCardModal`）、`@/components/cards/character-list/character-list-size-modal`（`CharacterListSizeModal`）、`@/components/tab-selector`（`TabSelector`）、`@/components/tab-editor-modal`（`TabEditorModal`）、`@/components/custom-modal`（`CustomModal` 系列）、`@/components/ui/confirm-dialog`（`confirmDialog`）、`@/components/ui/app-icon`（`RefreshIcon`/`ChevronLeftIcon`）、`@/utils/accountService`、`@/utils/dashboardConfig`、`@/utils/tabService`、`@/utils/tabIcons`（`getTabIcon`，实为 `tabIcons.tsx`）、`@/utils/tabSnapshotService`（`captureTabSnapshot`/`deleteTabSnapshotFile`/`getSnapshotPaths`/`registerDashboardLeaveHandler`）、`@/utils/logger`、`@/utils/roleDetailService`、`@/utils/cardConfigService`（`CardConfigService`）、`@/cards/startup-service`（`CardStartupService`）、`@/utils/imageLoader`（`Img`）、`@/utils/startupProgress`（`trackStartupTask`）、`@/types/dashboard`、`@/types/card-settings`、`@/types`（`resolveServerLabel`）。
- 第三方：`react`（`useEffect`/`useRef`/`useState`）、`react-i18next`（`useTranslation`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `DashboardView`（type） | dashboard.tsx:59 | `"loading" \| "selector" \| "tab"` 三态视图类型；`"selector"` 即**主界面**（标签页总览 + 快照） |
| `DashboardPage` | dashboard.tsx:61 | 页面组件（唯一导出），见内部结构 |
| `activeTab`（派生） | dashboard.tsx:87 | `tabs.find(t => t.id === activeTabId)` |
| `snapshotPaths`（state） | dashboard.tsx:85 附近 | `{ [tabId]: PNG 路径 }`，selector 视图渲染时传给 `TabSelector` |
| `viewRef`/`tabIdRef` | dashboard.tsx:90 附近 | 当前视图/标签页的 ref 镜像，供异步回调读取最新值（截图判定） |
| `snapshotLeavingTab` | dashboard.tsx:101 | 若当前视图是某标签页则 `await captureTabSnapshot(tabId)`；所有「换掉当前视图」入口之前调用 |
| `loadDashboard` | dashboard.tsx:107 | 核心加载流程：先 `snapshotLeavingTab()` → 取选中账户 → `setCurrentRoleId` → 读全部 Tab → **有合法激活 Tab 进 `tab` 视图；否则进 `selector`（主界面），不再自动跳第一个 Tab** → `getDashboardConfig` |
| 初始加载 effect | dashboard.tsx:149 附近 | 挂载时 `trackStartupTask(loadDashboard())`；注册 leave handler（`registerDashboardLeaveHandler(snapshotLeavingTab)`，卸载时置 null）；监听 window `accountChanged`、`manualRefresh`、`dashboardOpenSelector`（侧栏父节点点击：leave 截图后回 selector） |
| selector 快照刷新 effect | dashboard.tsx:143-147 | `view === "selector"` 时 `getSnapshotPaths()` 刷新快照映射 |
| `handleRefresh` | dashboard.tsx:193 | 派发 `manualRefresh` → `refreshAccountData()` → `loadDashboard()`；控制 `isRefreshing` |
| `handleAddCard` | dashboard.tsx:~210 | 新增卡片入口：`character_list` 先弹尺寸弹窗，system_resource/todo 弹各自弹窗，其余直接 `openRoleSelect` |
| `openRoleSelect`/`closeRoleSelect`/`handleSizeConfirm` | dashboard.tsx:~220-260 | 拉取 `getAccounts()` 设置弹窗状态 / 关闭清理 / 记录 `pendingDisplayMode` 后转角色选择 |
| `handleRoleConfirm` | dashboard.tsx:~270 | 真正 `addCard(...)`：按卡片类型写入不同 `settings`，随后刷新并 `setHighlightedCardId` |
| 高亮滚动 effect | dashboard.tsx:~330 | 200ms 后 `scrollIntoView` 到 `[data-card-id="..."]`，2800ms 后清除高亮 |
| `handleRemoveCard` | dashboard.tsx:352 | 并行清理 `CardConfigService.removeCardSettings` + `CardStartupService.removeCardFromMapping` + `removeCard`，再重载配置 |
| `handleSelectTab` | dashboard.tsx:369 | 激活指定 Tab 并载入配置进 `tab` 视图；派发 `tabsChanged` 同步侧栏高亮 |
| `handleBackToSelector` | dashboard.tsx:379 | **先 `await snapshotLeavingTab()`** → 清空激活 Tab 与配置 → `view = "selector"` → 重读 Tab 列表；派发 `tabsChanged` |
| `handleCreateTab`/`handleEditTab` | dashboard.tsx:390/400 附近 | 打开 Tab 编辑弹窗（新建/编辑） |
| `handleDeleteTab` | dashboard.tsx:400 | `confirmDialog` 确认后 `removeTab` + `deleteTabSnapshotFile`（清理快照），删的是当前 Tab 则清空激活状态 |
| `handleSaveTab` | dashboard.tsx:420 | `editingTab` 存在走 `updateTab`，否则 `addTab(name, icon, tags, defaultRoleId)`，随后重载 Tab 列表 |
| 加载中渲染分支 | dashboard.tsx:437-448 | `isLoading && view === "loading"` 时渲染不定向 `GlassProgressCircle` |
| selector 渲染分支 | dashboard.tsx:450-471 | `TabSelector`（传 `snapshotPaths`）+ `TabEditorModal` |
| `IconComponent`（派生） | dashboard.tsx:474 | `getTabIcon(activeTab.icon)`，用于标题左侧图标 |
| tab 主渲染分支 | dashboard.tsx:476-667 | 头部（返回/标题/刷新，含 `id="dashboard-header"`）+ 内容（卡片容器）+ 各类弹窗 |

**内部结构**（行号为当前工作区快照，改动后以源码为准）：
- 1-57 行：导入。
- 59-96 行：类型与全部 state（20 个，新增 `snapshotPaths`）：`view`、`tabs`、`activeTabIdState`、`currentRoleId`、`dashboardConfig`、`isLoading`、`isEditMode`、`isAddCardModalOpen`、`isSystemResourceAddOpen`、`isTodoAddOpen`、`isRefreshing`、`isSizeModalOpen`、`pendingCardType`、`isEditorOpen`、`editingTab`、`isRoleSelectModalOpen`、`pendingDisplayMode`、`availableAccounts`、`selectedRoleId`、`highlightedCardId`；派生 `activeTab`（87）；截图判定用 `viewRef`/`tabIdRef`（90-96）。
- 101-105 行：`snapshotLeavingTab`——视图为 `tab` 且有激活标签页时 `await captureTabSnapshot`。
- 107-141 行：`loadDashboard` 异步流程：先 `snapshotLeavingTab()`；**激活 Tab 合法 → `tab` 视图；否则一律 `selector`（主界面），不再自动兜底进第一个 Tab**。
- 144-148 行：`view === "selector"` 时刷新 `snapshotPaths` 的 effect。
- 150-181 行：挂载 effect —— 初始化加载 + 注册 `registerDashboardLeaveHandler(snapshotLeavingTab)`（卸载置 null）+ window 事件 `accountChanged`/`manualRefresh`/`dashboardOpenSelector`（父节点点击：leave 截图后回 selector）。
- 183-191 行：监听 `cardLayoutChanged` 刷新当前标签页配置。
- 193-351 行：刷新与新增卡片相关处理函数（含 `SIZE_MAP`：`single→2x3`、`double→3x3`、`triple→4x3`，见 303-307 行）与高亮滚动 effect（337-351）。
- 352-435 行：删除卡片、Tab 选择/返回（均先截图）/新建/编辑/删除（删标签页时清理快照文件）/保存处理函数。
- 437-471 行：加载中与 selector 分支渲染。
- 474-667 行：tab 视图 JSX（头部、内容、FAB、弹窗）。

**备注**：
- **invoke 命令**：本文件无直接 `invoke(...)`，全部经服务层间接调用：
  - 账户：`get_selected_account`、`get_accounts`、`refresh_accounts`（`refreshAccountData = refreshAccounts`）。
  - Tab/配置存储：`get_config` / `set_config` / `remove_config`（键 `dashboard_tabs`、`dashboard_active_tab`、`dashboard_tab_snapshots`）。
  - 卡片设置：`get_card_settings` / `save_card_settings` / `remove_card_settings`。
  - 快照：经 `tabSnapshotService` 间接调用 `save_tab_snapshot` / `delete_tab_snapshot`。
  - 其余经 `roleDetailService.setCurrentRoleId`、`CardStartupService.removeCardFromMapping` 内部处理（其内部无直接 invoke 字符串）。
- 路由：`/`（`App.tsx:68-75`），外层为 `DashboardLayout`。
- window 事件：监听 `accountChanged`、`manualRefresh`、`dashboardOpenSelector`、`cardLayoutChanged`；派发 `manualRefresh`（`CustomEvent`，`detail.count = cards.length`）与 `tabsChanged`（`handleSelectTab`/`handleBackToSelector` 中，用于同步侧栏标签高亮）。**注意**：`handleRefresh` 既自己派发 `manualRefresh`（触发 listener 立即 `loadDashboard`）又在 `refreshAccountData` 后再次 `loadDashboard`，会造成一次冗余重载（快照截图按 tabId 去重且同 tab 重截幂等，无副作用）。
- i18n key：`tab.confirm_delete_title`、`tab.confirm_delete_body`、`common.delete/cancel/refresh/refreshing/confirm/unknown`、`nav.dashboard`、`dashboard.customize_hint`、`settings.account.back`、`card:select_role`、`card:no_accounts`。
- 卡片设置字段差异：`character_list` → `settings = { roleId, displayMode }` + 显式 `w/h`；`attendance` → `settings = { selectedRoleId }`（键名不同）；其他类型 → `settings = { roleId }`。
- 数据流：`tabService`（config 存储）→ `getDashboardConfig(tabId)` → `dashboardConfig.cards` → `CardContainer`；新增/删除卡片后必须重新 `getDashboardConfig` 才会刷新。
- 快照数据流：离开 tab 视图（切 Tab / 返回主界面 / 侧栏父节点 / 侧栏导航守卫）→ `tabSnapshotService.captureTabSnapshot` → invoke `save_tab_snapshot` → PNG 落盘 `snapshots/<tabId>-<ts>.png` + 映射写 config `dashboard_tab_snapshots` → selector 渲染时 `TabSnapshot` 经 `imageCacheManager.load(path)` 显示。

## `src/pages/attendance.tsx`
**职责**：签到（考勤）页面。读取当前选中账户 → 按角色所属游戏分流拉取签到数据 → 展示今日/明日奖励 + **签到按钮** + 角色切换 + 完整月度奖励面板；**右上角「批量签到」**打开 `AttendanceBatchModal`（多选未签到账户一键签到 + 每账号自动签到开关）。

> ⚠️ **历史 bug（已修）**：早先本页只渲染只读的 `AttendanceRewards`，**页面上根本没有任何签到按钮**，用户在签到页面点哪里都没反应（卡片里有 `handleSignIn`，页面却没有）。现在签到动作统一走 `@/utils/attendanceService`，卡片与页面共用同一套分流与幂等判定。

**导出**：`export default function AttendancePage`（默认导出组件）。

**主要依赖**：
- 项目内：`@/components/ui/glass`（`GlassCard`/`GlassProgressCircle`/`GlassButton`/`GlassSwitch`）、`@/utils/accountService`（`getSelectedAccount`/`getAccounts`/`setSelectedAccount`/`Account`）、`@/types`（`resolveServerLabel`）、`@/components/ui/game-badge`（`AccountNameLine`）、`@/components/cards/attendance/attendance-rewards`（`AttendanceRewards`）、`@/components/cards/attendance/index`（`parseAttendanceData`/`rewardAt`/`AttendanceData`）、**`@/utils/attendanceService`（`fetchAttendanceRaw`/`resolveAttendanceGame`/`signInWithFeedback`）、**`@/cards/startup-service`（`CardStartupService.isAutoSignEnabled`/`setAutoSign`/`onAutoSignChanged`）****、`@/utils/imageLoader`（`Img`）、`@/utils/logger`（`logError`）。
- 第三方：`react`（`useState`/`useEffect`/`useCallback`/`useMemo`/`useRef`）、`react-i18next`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AttendancePage` | attendance.tsx:20 | 页面组件 |
| `attendanceData` / `accounts` / `accountId` / `isLoading` / `error` / `signPhase` | attendance.tsx:21-27 | state；`signPhase` 为 `idle`/`spinning`/`done` |
| `accountsRef` | attendance.tsx:35 | 账户列表 ref 镜像：`loadData` 分流要读 `game` 但不进依赖数组，否则与「加载账户」互相触发 |
| `loadData(roleIdOverride?)` | attendance.tsx:37 | `useCallback([t])`：`getSelectedAccount`（或入参）→ `getAccounts` → `resolveAttendanceGame` 分流 → `fetchAttendanceRaw` → `parseAttendanceData`；失败设 `card:attendance_error` |
| 初始加载 / 账户切换 effect | — | `loadData()`；监听 window `accountChanged` |
| `selectedAccount` | — | `useMemo`：按 `accountId` 找当前账户 |
| `roleOptions` | — | 所有可签到角色（同一通行证下官服/B服各一个时用于切换） |
| `handleSignIn` | — | `signInWithFeedback(accountId, game, t, () => loadData(accountId))`；已用 `hasToday` 短路，避免无谓重复请求 |
| `handleSwitchRole` | — | `setSelectedAccount(roleId)` → `loadData(roleId)`，切角色后重新取数 |
| `showBatchModal` | — | 控制批量签到弹窗；右上角 `GlassButton`（`BatchIcon`）打开 |
| `autoSign` | — | 当前账户「启动时自动签到」开关。真值来自全局配置 `card_auto_sign_users`（**与卡片实例无关**），经 `CardStartupService.isAutoSignEnabled` 读取 |
| `onAutoSignChanged` 订阅 | — | 监听广播：任意入口改了某角色开关，本页同步刷新（`changedRoleId === accountId` 才更新） |
| `handleToggleAutoSign(enabled)` | — | 乐观更新 → `CardStartupService.setAutoSign(accountId, enabled)` 落盘并广播；失败回滚 UI |
| `todayReward` / `tomorrowReward` | — | `rewardAt(data, todayIndex/tomorrowIndex)` |
| `signedToday` / `canSign` | — | `hasToday`；`canSign = accountId && data && !hasToday` → 控制按钮 `isDisabled` |
| `RewardSummary` | — | 页内组件：图标 + 名称 + 数量，`claimed` 时 45% 透明并叠对勾 |

**数据来源**
- `attend` 相关命令（经 `attendanceService` 分流）：明日方舟 `get_arknights_attendance` / `do_arknights_attendance`；终末地 `get_attendance` / `do_attendance`。
- 账户：`get_selected_account`、`get_accounts`、`set_selected_account`。
- i18n key：`sidebar.attendance`、`card:attendance_signed`、`card:attendance_not_signed`、`card:attendance_sign_btn`、`card:attendance_already_signed`、`card:attendance_refresh`、`card:attendance_today`、`card:attendance_tomorrow`、`card:attendance_select_account`、`card:attendance_error`、`card:attendance_no_account`。

**备注（invoke/listen）**：无 `listen`；命令均经 `attendanceService` / `accountService` 封装，本文件不直接 `invoke`。批量签到弹窗挂在页面底部（`<AttendanceBatchModal>`），签到完成后回调 `loadData()` 刷新当前账户。
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

## `src/pages/recruitment.tsx`
**职责**：公开招募独立页面（**仅明日方舟**，`PAGE_GAME_SUPPORT.recruitment = ["arknights"]`）。页头（`CardIcon "clock"` + 账户下拉（仅列明日方舟账户）+ 刷新）→ 办公室刷新条（`hire.refreshCount/3`）→ **4 个招募栏位**双列卡片（栏位号、状态徽标、`HH:MM:SS` 倒计时按秒重算、进度条、开始/完成时间）。

**导出**：`export default function RecruitmentPage`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ROLE_CONFIG_KEY` | recruitment.tsx:33 | `"recruitment_page_role_id"`，页面独立记忆的账户 |
| `STATE_BADGE_CLASS` | recruitment.tsx:35 | 四种槽位状态的徽标配色（与 `recruitment` 卡片共用语义） |
| `padSlots` | recruitment.tsx:42 | 补足 4 个栏位（缺失补 `state:0`） |
| `RecruitmentPage()` | recruitment.tsx:48 | 页面组件；`nowMs` 每秒重算倒计时 |
| `loadData` | — | `fetchArknightsPlayerInfo({ roleId })`（旧缓存自动强制刷新） |
| `handleRefresh` | — | `refreshAccountData()`（`refresh_accounts` 会重拉 player/info 落新缓存）→ 重读 |

**备注**：
- 路由 `/recruitment`；侧栏 `NavKey = "recruitment"`（`ClockIcon`）。
- 数据来源：`player/info.recruit[]`；工具函数与 `recruitment` 卡片共用（`cards/recruitment/recruit-shared.ts`）。
- i18n：`sidebar.recruitment`、`recruitment_page.{subtitle,slot,state_*,remaining,complete_at,start_time,hire_refresh,hire_refresh_usage,empty,switch_account}`。

## `src/pages/building.tsx`
**职责**：基地数据独立页面（**仅明日方舟**）。页头（`CardIcon "factory"`）→ 概览三卡（**无人机**：value/max + 距补满倒计时；**宿舍休息进度**：平均心情百分比 + 在休人数；**疲劳干员**：计数与头像/名称）→ 办公室/训练室两卡 → 按 `FACILITY_ORDER` 渲染各设施卡片（控制中枢/发电站/贸易站/制造站/宿舍/会客室），每段排班展示**干员头像**（`RemoteThumb` + `arknightsPortraitUrl(charId)`，见下）、槽位、干员心情条（名字来自 `charInfoMap`）、制造站批次进度/倒计时、贸易站订单数、会客室线索（库存/摆放/今日碎片）。

**导出**：`export default function BuildingPage`；文件内 `PageHeader`（账户切换 + 刷新，加载态/正常态共用，自带 `useTranslation`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ROLE_CONFIG_KEY` | building.tsx:32 | `"building_page_role_id"` |
| `FACILITY_TITLE_KEY` | building.tsx:37 | 设施键 → `building_page.room_*` i18n 键 |
| `moodBarClass(mood)` | building.tsx:44 | 心情条配色：≤0 危险红 / <12 警告黄 / 其余成功绿 |
| `BuildingPage()` | building.tsx:53 | 页面组件；`nowMs` 每秒重算无人机/专精倒计时 |
| `charName(charId)` | — | `info.charInfoMap[charId].name`，缺失回退 charId |
| `roomChars(segment)` | — | 排班段 → `{name, mood, percent}` 视图 |

**备注**：
- 路由 `/building`；侧栏 `NavKey = "building"`（`FactoryIcon`）。
- 设施状态计算与 `building` 卡片共用（`cards/building/building-shared.ts`）；心情换算来自 `@/types/arknights`（`ap/360000` = 0..24）。
- **干员头像**：接口不下发（`charAssets` 实测空数组），前端按官方 CDN 规律拼 `char/portrait/{charId}.png`（`arknightsPortraitUrl`，实测 200），经 `RemoteThumb` 下载缓存显示、失败回退首字母占位。
- i18n：`sidebar.building`、`building_page.*`（room_*/drones/dorm_rest/orders/clue_* 等）。
- ⚠️ 设施接口是「对象或数组」混用（control/meeting 为对象），后端 `one_or_many` 已收敛成 `Vec`，前端按数组渲染即可。

## `src/pages/game-data.tsx`
**职责**：游戏数据独立页面（**仅明日方舟**；**页面专属，没有对应卡片**）。页头（`CardIcon "chart"`）之后**全部区块均为 `CollapsibleCard` 可折叠卡片**（点击标题行折叠/展开，带 `grid-rows` 高度动画；折叠状态持久化在配置 `gamedata_page_folded`）：主线进度（`status.mainStageProgress` + `stageInfoMap[key].code/name`，B 服实测为空 → 占位文案）→ **章节进度按类别拆成 4 张独立卡片**（`activity[]` 按 `activityInfoMap[].type` 分组：别传 `SIDESTORY` / 插曲 `MINISTORY` / 支线 `BRANCHLINE` / 其他活动（空串），组内按开始时间倒序，标题行右侧显示行数徽标，空分组不出卡；**章节行**：有封面时封面按原比例整幅渲染、宽度缩到行的 1/3（`w-1/3 aspect-[1002/180]`，实测统一 1002×180 不裁切），复刻徽标压在封面左上，右侧 46% 宽内联放状态（☑ 已完成 / 进行中）+ `cleared/total` + 进度条（`ChapterStatus`，语义 token 色）；**无封面的活动（约 43%，插曲全部无封面）不渲染占位封面，降级为紧凑行**——复刻徽标 + 名称一行，右侧同宽 46% 内联状态/计数/进度条）→ 剿灭作战（**据点行**：`h-16` 卡片，`campaignInfoMap[].picUrl` 作为整行背景（1002×180 横幅，右侧 `mask-image` 8%→72% 渐隐以免压住文字），左侧据点名 + **阵营徽标**（`campaignInfoMap[cid].campaignZoneId` → `campaignZoneInfoMap[zoneId].name`，如哥伦比亚/谢拉格/维多利亚/汐斯塔/炎国；缺表时不显示徽标），右侧「最高剿灭数 N」）→ 集成战略（**图片行**：固定行高 `h-14`；缩略图 `absolute inset-y-0 left-0 h-full w-auto` **绝对定位铺在行左缘、不占布局**（保持 1002:180 原比例不裁剪、上下无缝隙），右端 `mask-image` 在 15%→58% 处渐隐到卡片背景；文字块 `pl-[33%]` **精确落在行左侧 1/3 处、压在图片渐隐区上**；**行内字段对齐官方「集成战略」页：投资系统 = `bank.current`、解锁道具 = `relicCnt`**，右上角为主题奖章 `medal.current/total`，按 `rogueInfoMap.sort` **降序**排序（= 官方顺序，最新主题在最上，如 `sort=6` 的「沉沦者的黑流树海」排第一；升序会把顺序整个颠倒）。⚠️ `bpLevel`（通票等级）不在官方该页展示；`clearTime` 实测是 `0/2/6` 这类小整数**而非时间戳**，曾按日期格式化成「01-01 08:00 首通」，现已不再渲染）与保全派驻（同款图片行 + 名/subName + 最好层数）双列，两者 `picUrl` 为空时**不渲染缩略图**（文字块也不加左内边距）→ 沙中之地（`sandbox[]`：基建等级/修复裂隙/最长天数/支线完成数）与**历险签约（引航者试炼）**双列 —— 签约行与集成战略同款图片行：缩略图绝对定位铺左 + 模式名 `gamedata_page.bossrush_name`（引航者试炼 / Trials for Navigator）与黄色 `#NN` 期数徽标（从 `actNbossrush` 解析，期数倒序）一起压在左侧 1/3 处、不出图右，右侧 played/难度或「暂无记录」。

**导出**：`export default function GameDataPage`；文件内 `PageHeader`、`ChapterRow`（章节聚合行）、`ChapterStatus`（章节行右侧状态块）、`CollapsibleCard`（可折叠区块卡）、`chapterGroupOf(type)`、`parseBossRushNum(id)`、`bossRushBadgeLabel(num)`、`CHAPTER_GROUP_ORDER` / `CHAPTER_GROUP_TITLE_KEY`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ROLE_CONFIG_KEY` | game-data.tsx:33 | `"gamedata_page_role_id"` |
| `FOLD_CONFIG_KEY` | game-data.tsx:36 | `"gamedata_page_folded"`，各区块折叠状态（`Record<sectionKey, boolean>`）的持久化键 |
| `chapterGroupOf(type)` | game-data.tsx:42 | `SIDESTORY→sidestory`、`MINISTORY→ministory`、`BRANCHLINE→branchline`、其余（含空串）→`other` |
| `parseBossRushNum(id)` | game-data.tsx:63 | `act6bossrush → 6`，正则不匹配返回 `null`（名称回退原始 id） |
| `bossRushBadgeLabel(num)` | game-data.tsx:69 | `6 → "#06"`（两位补零） |
| `ChapterStatus` | game-data.tsx:88 | 章节行右侧状态 + 进度块（内联语义 token 色，有封面行与无封面紧凑行共用） |
| `CollapsibleCard` | game-data.tsx:166 | 可折叠区块卡：标题行（标题 + 可选徽标 + 折叠箭头）点击切换（`aria-expanded`）；**展开/收起带动画**——内容区用 `grid-template-rows: 0fr ↔ 1fr` + `opacity` + 内层 `-translate-y-1`，`duration-300 ease-out`（沿用 `pages/account.tsx` 的方案，无需测量高度）；折叠后内容保留在 DOM，用 `aria-hidden` + `inert` 屏蔽交互与可访问性树 |
| `IMAGE_ROW_CLASS` | game-data.tsx:73 | 图片行容器：`relative h-14` 固定行高 + `overflow-hidden`，供缩略图绝对定位填满、无上下缝隙 |
| `IMAGE_THUMB_CLASS` | game-data.tsx:77 | 行内横幅缩略图：`absolute inset-y-0 left-0 h-full w-auto max-w-none`（不占布局、保持 1002:180 原比例不裁剪），右端 `mask-image` 15%→58% 渐隐到背景 |
| `IMAGE_TEXT_CLASS` | game-data.tsx:81 | 图片行文字块（`relative z-10`）；有图时由调用方追加 `pl-[33%]` 压在行左侧 1/3 处 |
| `rogueRecords` | game-data.tsx:391 | 集成战略各主题进度，按 `rogueInfoMap.sort` **降序**（官方顺序）；`bank`（投资系统）与 `relicCnt`（解锁道具）是页面实际展示字段 |
| `campaigns` | — | 剿灭据点：`campaign.records` + `campaignInfoMap`（名/封面）+ `campaignZoneInfoMap[campaignZoneId].name`（阵营），`maxKills` |
| `towerRecords` | — | 保全派驻训练场；直接沿用接口 `tower.records` 原始顺序（实测已与官方一致：7/9/10 号 → 阿尔斯特 → 塔山） |
| `mainStage` | — | `mainStageProgress` → `stageInfoMap`；code 与 id 可能差 1，**以 code 展示** |
| `ChapterRow.cover` | — | 章节封面 = `activityInfoMap[actId].picUrl`；**实测统一 1002×180（5.57:1）**，有值时行内用 `w-1/3 aspect-[1002/180]` 按原比例整幅渲染（宽度为行的 1/3，不裁切；`RemoteThumb` 加载失败回退首字母占位）；**空时不渲染封面**（紧凑行） |
| `chapterGroups` | — | 章节聚合（活动名缺失回退 actId）；分区**不下发名称**，故不做分区拆行 |
| `bossRushList` | game-data.tsx:360 | `bossRush` 附加解析出的期数 `num`，按期数倒序（`#06` 在前，对齐官方排序） |

**备注**：
- 路由 `/game-data`（NavKey `"gamedata"`，键与路由段不同：`NAV_ROUTES.gamedata = "/game-data"`）；侧栏 `ChartIcon`。
- 数据全部来自 `get_arknights_player_info`（经 `arknightsDataService`，旧格式缓存自动刷新）；**没有卡片**（用户要求「只要页面不需要卡片」）。
- 封面/主题图都经 `RemoteThumb`（`@/components/ui/remote-thumb.tsx`）下载缓存，`IntersectionObserver` 式懒加载由缓存管理器天然覆盖（每个缩略图挂载才 load）。
- 折叠状态经 `ConfigService` 持久化：`gamedata_page_folded`（`Record<sectionKey, boolean>`；章节卡 key 为 `chapters_<group>`，其余为 `main`/`campaign`/`rogue`/`tower`/`sandbox`/`bossrush`；首次进入读取一次、变更即写回）。
- i18n：`sidebar.gamedata`、`gamedata_page.*`（chapter_type_*/state_*/max_kills/medal_progress/bank_invest=投资系统/relics=解锁道具/bossrush_name/not_played=暂无记录 等；`bp_level`、`cleared_at`、`not_cleared` 已不再被本页使用）。
- ⚠️ 77 个活动条目几乎都是 `0/total`（未复刻/未开放），页面靠分组 + 时间倒序让「最近有进度」的排前；这是数据源特性，不是 bug。

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

# 侧边栏与抽卡图表组件 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## `src/components/dashboard-sidebar.tsx`
**职责**：应用左侧全局侧边栏——展示当前选中账户卡片、可拖拽排序的主导航（仪表板/角色/勋章/出勤/抽卡/To-Do/区域/帝江号，换位带 FLIP 滑动动画）、仪表板多标签页列表（增删改、右键菜单、折叠、拖拽换位带动画）、底部功能入口与主题/语言切换；同时内含一个被硬关闭的命令面板式搜索模块。
**导出**：`Sidebar`（唯一导出，命名导出，无 default）
**主要依赖**：`react-router-dom`（`Link`/`useLocation`/`useNavigate`）、`react-dom` 的 `createPortal`、`react-i18next` 的 `useTranslation`、`clsx`、`@/components/ui/glass`（`GlassKbd`、`GlassSkeleton`）、`@/components/icons`（14 个图标）、`@/components/theme-switch`、`@/components/language-switch`、`@/components/ui/account-avatar`、`@/components/ui/app-icon`（`ChevronDownIcon`/`ChevronLeftIcon`/`ChevronRightIcon`/`SwitchIcon`）、`./account-switch-modal`、`@/components/cards/card-context-menu`、`@/components/tab-editor-modal`、`@/components/ui/confirm-dialog`、`@/utils/accountService`、`@/utils/configService`、`@/utils/tabService`、`@/utils/tabIcons`、`@/utils/tabSnapshotService`（`runDashboardLeaveHandler` / `deleteTabSnapshotFile`）、`@/hooks/useFlipList`、`@/utils/imageCacheManager`、`@/utils/logger`、`@/config/site`、`@/types`（`resolveServerLabel`）、`@/types/dashboard`（`DashboardTab`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SearchResult` | dashboard-sidebar.tsx:65 | 接口：`id`、`title`、`description?`、`path`、`category`、`elementId?`（页面内锚点）、`titleEn/titleZh/descriptionEn/descriptionZh/categoryEn/categoryZh?`（跨语言检索字段）、`matchedLang?("current"/"en"/"zh")`、`matchedText?` |
| `SidebarProps` | dashboard-sidebar.tsx:84 | props：`onNavigate?: () => void`（移动端点击导航后关闭抽屉的回调）、`collapsed?: boolean`（桌面端折叠为仅图标窄轨，默认 `false`）、`onToggleCollapsed?: () => void`（切换折叠状态；提供时页脚渲染折叠/展开按钮） |
| `NavKey` | dashboard-sidebar.tsx:93 | 联合类型：`"dashboard" \| "characters" \| "medals" \| "attendance" \| "gacha" \| "todo" \| "domain" \| "spaceship"` |
| `NAV_KEYS` | dashboard-sidebar.tsx:95 | 默认导航顺序数组（8 项，含 `/domain` 区域信息与 `/spaceship` 帝江号页），作为 `navOrder` 初值 |
| `GripHandle` | dashboard-sidebar.tsx:106 | 六点拖拽手柄按钮（内联 SVG）。props：`onPointerDown`（必需）、`onDragEnd?`、`isDragging?`；`pointerUp`/`click` 均 `preventDefault+stopPropagation`，hover 时才显示 |
| `Sidebar` | dashboard-sidebar.tsx:145 | 主组件，约 145-2270 行，见下方内部结构 |
| `handleNavClick` | dashboard-sidebar.tsx:291 | 导航点击守卫：`preventDefault` → await `runDashboardLeaveHandler()`（当前若停在仪表盘标签页则先截图）→ `navigate(href)` → `onNavigate?.()`。用于除「仪表盘父节点」「子标签」外的全部导航项与底部入口 |
| `useFlipList(navListRef, navOrder)` | dashboard-sidebar.tsx:302 | 主导航列表换位 FLIP 动画（260ms） |
| `useFlipList(tabsListRef, tabIds)` | dashboard-sidebar.tsx:303 | 仪表板标签列表换位 FLIP 动画（220ms） |

**内部结构**（行号为当前工作区快照，改动后以源码为准）：

- **1-63 行**：import 区（依赖清单见上）。全文件无任何 Tauri `invoke`/`listen`，后端交互全部经由 `accountService`/`configService`/`tabService`/`tabSnapshotService` 封装。
- **65-104 行**：类型与常量（`SearchResult`、`SidebarProps`、`NavKey`、`NAV_KEYS`）。
- **106-143 行**：`GripHandle` 子组件。
- **145-203 行**：状态/引用声明。搜索态 `searchQuery`/`showResults`/`selectedIndex`/`searchMenuPos` 与 refs；账户态 `selectedAccount`/`isLoadingAccount`/`isSwitchModalOpen`/`accountUnavailable`/`isManualRefreshing`/`expectedAccountCount`；`developerMode`、`sidebarTabs`/`sidebarActiveTab`、`isDashboardCollapsed`、`contextMenu`、`isTabEditorOpen`/`editingTabForSidebar`；拖拽态 `navOrder`/`draggingNav`/`draggingTab` 及对应 ref；FLIP 容器 ref `navListRef`/`tabsListRef`（202-203）。
- **205-211 行**：把 `navOrder`、`sidebarTabs` 同步进 ref（供拖拽结束时读取最新值）。
- **213-225 行**：读取配置 `sidebar_nav_order`，过滤非法键并补齐缺失键后写入 `navOrder`。
- **228-282 行**：拖拽核心函数——`swapNav`(228)、`swapTab`(239)、`endNavDrag`(250，`setConfig("sidebar_nav_order", ...)` 持久化)、`endTabDrag`(257，`saveTabs(...)` 持久化)、`startNavDrag`(264)/`startTabDrag`(276)（标记目标 + 临时 `window pointerup` 结束拖拽）。**换位交换时列表位置移动由 FLIP 动画呈现，不再是瞬间跳位。**
- **291-300 行**：`handleNavClick` 导航守卫——`preventDefault()` → await `runDashboardLeaveHandler()`（DashboardPage 注册的「离开仪表盘先截图」钩子；不在仪表盘视图时为空操作）→ `navigate(href)` → `onNavigate?.()`。必须 preventDefault：Link 的默认导航不受 await 阻塞，否则 PrintWindow 会截到已切换的新页面。
- **302-307 行**：`useFlipList(navListRef, navOrder, {260ms})` 与 `useFlipList(tabsListRef, tabIds, {220ms})`——主导航与标签列表的换位 FLIP 动画（见 `@/hooks/useFlipList`）。
- **309-325 行**：加载标签页（`getAllTabs` + `getActiveTabId`），并监听 `tabsChanged`、`accountChanged` 两个 window 事件重载。
- **328-336 行**：监听 `themeChange` → `themeChangeKey++`，用于渲染起点强制重挂 `<aside>`。
- **340-366 行**：读取配置 `developer_mode`、`sidebar_collapsed` 初始化状态；监听 `developerModeChange`（CustomEvent，`detail.enabled`）。
- **369-460 行**：选中账户加载与同步——`Promise.all([getSelectedAccount(), getAccounts()])` 并按 id 匹配；订阅 `accountAvailability` 状态并在账户数据不可用时置 `accountUnavailable`（侧边栏显示「账号不可用 / 重新登录」并跳转 `/account`）；监听 `accountChanged`（重读配置 `refresh_on_account_switch`）、`manualRefresh`（`detail.count` 上限 5，置骨架屏 300ms 后复位）。
- **463-810 行**：`getAllSearchableContent`（`useMemo`，依赖 `t`/`i18n.language`）——硬编码的可检索条目表（导航项、仪表板块、设置块、开发者项），每条含中英双语 title/description/category 与可选 `elementId`。
- **813-1017 行**：`searchResults` 匹配（当前语言 → 备选语言，标注 `matchedLang`/`matchedText`）、`Cmd/Ctrl+K` 聚焦、点击外部/滚动关闭、键盘导航、选中项 `scrollIntoView`、`handleSelectResult`、`highlightMatch`。
- **1019-1043 行**：`bottomItems`（`useMemo`）——账户项固定；`developerMode` 为真时插入开发者项；最后追加设置项。
- **1045-1049 行**：派生 `tabsHidden = isDashboardCollapsed || collapsed`；渲染起点 `<aside key={themeChangeKey}>`。
- **1052-1113 行**：账户卡片区三态：骨架屏 / 已选账户（头像、昵称、`Lv.`、`resolveServerLabel` 服务器、森空岛 userId、hover 切换按钮）/ 未选择占位。
- **1115-1330 行**：搜索区，**被 `{false && ...}` 硬关闭**（输入框、清除按钮、⌘K 提示、`createPortal` 下拉、分组渲染、快捷键页脚）——死代码保留。
- **1455-2085 行**：主导航 `<nav>`，外层 `<div ref={navListRef}>`（1463），按 `navOrder.map` + `switch` 渲染；**每个导航项根 `<div>` 带 `data-flip-id="<key>"`**，hover 越过另一项时 `swapNav` 交换、FLIP 补间：
  - `dashboard`（1466-1660）：父节点 `<Link to="/">` 的 `onClick`(1491)：`preventDefault` → `setActiveTabId(null)` → `setSidebarActiveTab(null)` → `navigate("/")` → 派发 `dashboardOpenSelector` → `onNavigate?.()`——**点击父节点进入主界面（标签页总览），不再跳进任何仪表盘**；父节点高亮 = `pathname === "/" && !sidebarActiveTab`（1484，HomeIcon 判断同步修复）。折叠按钮（`setConfig("sidebar_collapsed", next)`）+ `GripHandle`；子级标签列表 `<div ref={tabsListRef}>`（1588）内每项带 `data-flip-id={tab.id}`（1603）、hover 拖拽交换、点击 `setActiveTabId` 后派发 `accountChanged`（页面侧经 leave handler 先给旧标签页截图）、激活态左侧竖条；空态提示。
  - `characters`/`medals`/`attendance`/`gacha`/`todo`/`domain`/`spaceship`（1677-2085）：结构相同，`onClick={(e) => void handleNavClick(e, "/xxx")}`。
- **2090-2135 行**：`CardContextMenu`（标签页右键）——`edit` 打开编辑器；`delete` 确认后 `removeTab` + `deleteTabSnapshotFile`（清理快照文件，2127）+ 派发 `tabsChanged`。
- **2138-2158 行**：`TabEditorModal`——`onSave` 按是否在编辑调用 `updateTab` 或 `addTab(name, icon, tags, defaultRoleId)`，随后刷新并派发 `tabsChanged`。
- **2161-2220 行**：页脚——`bottomItems` 链接（每项 `onClick={(e) => void handleNavClick(e, item.href)}`）、GitHub 外链、`ThemeSwitch`、`LanguageSwitch`。
- **2225 行附近**：`AccountSwitchModal`。
- **折叠（`collapsed`）**：账户卡片收缩为居中小头像（`AccountAvatar size` `md`→`sm`、外层 `px-3`→`px-[7px]`、卡片 `p-2`→`p-[5px]`、始终 `w-full`，过渡连续不跳变），文字/切换按钮 `max-w-0 + opacity-0` 隐藏；主导航与页脚项 `justify-center` 仅图标；`GripHandle` 与仪表板标签列表隐藏；页脚仅折叠/展开按钮。所有过渡统一 `duration-300 ease-out`。

**备注**：
- **invoke 命令**：本文件 0 个直接 `invoke`；后端能力经 `getAccounts`/`getSelectedAccount`/`getConfig`/`setConfig`/`getAllTabs`/`addTab`/`updateTab`/`removeTab`/`saveTabs`/`getActiveTabId`/`setActiveTabId`/`runDashboardLeaveHandler`（间接触发 `save_tab_snapshot`）/`deleteTabSnapshotFile`（`delete_tab_snapshot`）间接调用。
- **listen/事件**（全部为 DOM 事件，非 Tauri `listen`）：
  - 监听：`window "tabsChanged"`(319)、`window "accountChanged"`(320, ~410)、`window "themeChange"`(332)、`window "developerModeChange"`(362)、`window "manualRefresh"`(~430)、`window "pointerup"`(272, 284)、`document "keydown"`/`"mousedown"`、`window "scroll"` capture（搜索区）。
  - 派发：`window.dispatchEvent(accountChanged)`（子标签点击）、`window.dispatchEvent(tabsChanged)`（删除/保存标签页）、`window.dispatchEvent(dashboardOpenSelector)`（父节点点击，1497）。
- **配置键（configService）**：读 `sidebar_nav_order`(~215)、`developer_mode`(~341)、`sidebar_collapsed`(~350)、`refresh_on_account_switch`(~415)；写 `sidebar_nav_order`(252)、`sidebar_collapsed`（折叠按钮）。（整条侧边栏的折叠状态 `sidebar_rail_collapsed` 由外层布局 `layouts/dashboard.tsx` 读写，本文件不涉及。）
- **Props 清单**：`Sidebar` 的 `onNavigate?`（默认 `{}`）、`collapsed`（默认 `false`）、`onToggleCollapsed?`。
- **异常/注意点**：① 搜索 UI 被 `{false && ...}` 永久隐藏，但其状态、4 个键盘/鼠标 effect 与约 500 行 JSX 仍保留在文件中（属死代码）。② `handleManualRefresh` 中 `void expectedAccountCount` 为规避 lint 的占位。③ `highlightMatch` 用带 `g` 标志的正则做 `.test()`，`lastIndex` 有状态残留风险。④ ~~`location.pathname === ""` 永不命中~~ 已修复：与父节点高亮统一为 `pathname === "/" && !sidebarActiveTab`。⑤ `startNavDrag`/`startTabDrag` 注册的 `pointerup` 监听只在触发后移除，拖拽中途卸载组件会短暂泄漏。⑥ FLIP 动画与 `grid-template-rows` 展开折叠并存：换位只改顺序（高度不变），折叠展开只改容器（keys 不变），互不干扰；`prefers-reduced-motion` 下 FLIP 自动跳过。

## `src/components/gacha-pity-chart.tsx`
**职责**：抽卡「寻访统计」保底条形图——按卡池分组，以横向柱条展示每次六星距离上个六星的抽数（或赠送十连内序号）及未出六星的余量，柱头附角色/武器圆形头像，支持卡池筛选与中英文案。
**导出**：`GachaPityChart`（default 导出）
**主要依赖**：`echarts/core`（按需引入，`echarts.use([...])` 注册 `CustomChart` + `GridComponent`/`TooltipComponent`/`GraphicComponent` + `CanvasRenderer`，自定义 `custom` series + `renderItem` 手绘）、`@tauri-apps/api/core` 的 `invoke`、`@/components/ui/glass`（`GlassCard`、`GlassSelect`）、`@/utils/imageCacheManager`（`cacheManager`、`usePinImages`）、`@/utils/logger` 的 `logError`、`@/types/gacha`（`GachaCategory`/`GachaPoolInfo`/`GachaPoolKind`/`GachaRecord`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `poolKindOf` | gacha-pity-chart.tsx:10 | 记录 → 卡池类型：优先 `pools[poolId].poolType` 含 `Joint`/`Standard`，否则按 `poolId` 前缀 `joint_`/`standard` 推断，兜底 `special` |
| `ChartRow` | gacha-pity-chart.tsx:22 | 行数据：`kind: "six" \| "leftover"`、`id?`（角色/武器 id，供图标）、`name`、`count`、`gachaTs?`、`inGift` |
| `ChartSection` | gacha-pity-chart.tsx:32 | 分组：`poolId`、`poolName`、`rows: ChartRow[]` |
| `computeSections` | gacha-pity-chart.tsx:41 | 核心：记录过滤 + 按 `poolId` 合并 + 保底计数（见下） |
| `firstSixTs` | gacha-pity-chart.tsx:120 | 卡池排序键：区间内最旧六星的 `gachaTs`；无六星则取 `leftover` 行时间 |
| `cssVar` | gacha-pity-chart.tsx:132 | 读 CSS 变量，缺省回退 |
| `circleAvatar` | gacha-pity-chart.tsx:138 | 经 `cacheManager.load` 取图 → 96px canvas 圆形裁剪 → PNG dataURL |
| `ROW_H`/`AVATAR_SIZE`/`GRID_LEFT`/`GRID_RIGHT`/`BAR_GAP`/`BAR_START_GAP`/`CHART_BOTTOM_PAD` | gacha-pity-chart.tsx:172-178 | 布局常量：44 / 36 / 84 / 64 / 10 / 10 / 14 |
| `HEADER_FONT` | gacha-pity-chart.tsx:180 | 卡池分组头字体 `600 12px system-ui...` |
| `_measureCtx` / `measureTextWidth` | gacha-pity-chart.tsx:182 / 183 | 离屏 canvas 测量文本宽度（SSR 兜底 `len*8`） |
| `ChartProps` | gacha-pity-chart.tsx:189 | 见 props 清单 |
| `GachaPityChart` | gacha-pity-chart.tsx:197 | 主组件，197-630 行 |
| `ChartHeader` | gacha-pity-chart.tsx:632 | 头部：标题 + `GlassSelect` 卡池下拉 + 图例（六星/未出六星）+ 六星总数 |
| `hexWithAlpha` | gacha-pity-chart.tsx:678 | hex（3/6 位）→ `rgba()`，用于渐变柱体配色 |
| `escapeHtml` | gacha-pity-chart.tsx:695 | tooltip HTML 转义 |
| `formatTime` | gacha-pity-chart.tsx:703 | `gachaTs` → `toLocaleString(zh-CN/en-US)` |

**Props（`ChartProps`，gacha-pity-chart.tsx:189-195）**：`roleId: string | null`（头像映射用）、`records: GachaRecord[]`（假定从新到旧）、`pools: Record<string, GachaPoolInfo>`、`category: GachaCategory`、`isZh: boolean`。
`ChartHeader` props（632-644）：`isZh`、`sixCount`、`poolOptions: {poolId,poolName}[]`、`poolFilter: string | null`、`onPoolChange: (v: string|null) => void`。

**输入数据结构**：`GachaRecord`（仅 `kind === "draw"` 参与，49/209）——用到 `poolId`、`poolName`、`poolType`（经 pools）、`rarity`、`isFree`、`charId`/`weaponId`、`charName`/`weaponName`/`nameText`、`gachaTs`；`GachaPoolInfo` 提供 `poolName`/`poolType`。中间结构 `ChartRow`/`ChartSection` 见表。

**图表类型与配置**：图表库 **ECharts**（`echarts.init`，332），**水平条形图**（`series.type: "custom"` + `renderItem` 自绘，434-594）。
- `grid`（368）：`left: GRID_LEFT(84)`、`right: GRID_RIGHT(64)`、`top: 0`、`bottom: CHART_BOTTOM_PAD(14)`。
- `xAxis`（369-377）：`type: "value"`，`min: 0`、`max: maxCount`（363：`max(10, 所有非 header 行的 count)`），轴线/刻度/标签/分隔线全部隐藏。
- `yAxis`（378-385）：`type: "category"`，`data` 为 `r0..rN`（362），`inverse: true`（首行在顶部），轴元素全隐藏。
- `tooltip`（386-419）：`trigger: "item"`，玻璃拟态 className，`formatter`（395-418）按 `meta[dataIndex].kind` 区分卡池名 / 六星事件间隔（赠送六星附来源提示）/ 未出六星余量。
- `graphic`（420-433）：`GRID_LEFT` 处的竖直分隔线，高度 = `meta.length * ROW_H`。
- `series`（434-594）：`type: "custom"`、`name: "pity"`、`clip: false`，`data` 每项 `value = header ? 0 : count`（439-442），`encode: {x:0,y:1}`；`renderItem`（444-593）：header 行绘制底纹 + 两段横线 + 截断的卡池名（450-495）；数据行依次绘制圆形头像或首字母占位圆（506-535）、圆角柱体（`r:[0,10,10,0]`）+ 线性渐变（六星用 `--primary`，余量用 `--default-400`）（538-560）、右侧计数标签（563-574）、赠送六星的红色「赠」字（577-590）。

**计算逻辑（`computeSections`，gacha-pity-chart.tsx:41-117）**：
- 47-61：按 `poolId` 聚合 `draw` 记录（`weapon`/`all` 分类不过滤，否则用 `poolKindOf` 过滤），组内保持输入的从新到旧顺序。
- 63-70：调用共享 `calculateGachaSixStarIntervals`，按 `seqId` 建立六星事件间隔映射；`n` 仅用于末尾未出六星余量。
- 72-103：从 `rows.length-1` 反向遍历（即**从旧到新**）；所有六星事件的 `count` 都读取共享间隔映射，普通/赠送六星命中后都重置余量计数 `n`。赠送无六星记录不生成柱子，也不计入事件间隔。
- 100-108：区间结束后若 `n > 0`，产出 `kind:"leftover"` 行（`count = n`，`gachaTs` 取最新一条记录）。
- 109-111：空组丢弃。
- 115：卡池按 `firstSixTs` 降序（最旧六星时间最新者在前；无六星按最近记录时间）。
- 318-325 `meta`：把每个 `ChartSection` 展开为 `header` 行 + 各数据行，行高固定 `ROW_H`，即图表总高 `meta.length * 44 + 14`（625）。

**内部流程要点**：205-219 `poolOptions`；221-226 `poolFilter` 状态（切分类时重置）；228-235 过滤后调 `computeSections`；238-246 收集六星 `neededIds`；253-269 **`invoke("resolve_gacha_avatar_map", { roleId })`** 合并头像映射（带 `resolvingRef` 防重入，失败仅 `logError`）；273-280 `usePinImages` 预缓存；282-304 批量 `circleAvatar` 生成圆形 dataURL；307-312 监听 `themeChange` 触发重绘；330-341 `echarts.init` + `ResizeObserver`（仅 `hasRows` 时挂载，变化即重建）；343-346 `sixCount`；349-599 生成并 `setOption(option, true)`；601-616 空数据时只渲染头部与提示。

**备注**：
- **invoke 命令**：`resolve_gacha_avatar_map`（gacha-pity-chart.tsx:258，参数 `{ roleId }`，返回 `Record<string,string>` id→图片 src）。全文件仅此 1 个。
- **listen 事件**：无 Tauri `listen`；仅有 `window.addEventListener("themeChange")`（310，附带 `window.removeEventListener` 清理）。
- **Props 清单**：`roleId`、`records`、`pools`、`category`、`isZh`；子组件 `ChartHeader` 的 `isZh`、`sixCount`、`poolOptions`、`poolFilter`、`onPoolChange`。
- **异常/注意点**：① `poolKindOf` 与 `cssVar` 与 `gacha-stat-charts.tsx` 完全重复实现。② 282-304 的 effect 依赖写成 `neededIds.join(",")` 并显式 `eslint-disable`（303-304）。③ `ChartRow.name` 类型非可选，但 tooltip 中仍有 `row.name ?? "?"`（404）等防御写法。④ 卡池合并逻辑依赖 `records` 从新到旧的隐含约定（注释 46/68）。⑤ 头像映射按 `roleId` 维度整体请求，缺失 id 由后端在 `total.json` 中按名称补全（注释 248）。

## `src/components/gacha-stat-charts.tsx`
**职责**：抽卡统计三联图容器——星级占比环形图、按卡池分组的六星间隔折线图（含期望参考线）、六星间隔累积曲线（阶梯图，含期望参考线），间隔算法与统计卡片和保底图共用。
**导出**：`GachaStatCharts`（default 导出）
**主要依赖**：`echarts/core`（按需引入，`echarts.use([...])` 注册 `PieChart`/`LineChart` + `GridComponent`/`LegendComponent`/`MarkLineComponent`/`TooltipComponent` + `CanvasRenderer`）、`@/components/ui/glass` 的 `GlassCard`、`@/types/gacha`（`GachaCategory`/`GachaPoolKind`/`GachaRecord`）；无任何 Tauri 调用

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SIX_STAR_EXPECTATION` | gacha-stat-charts.tsx:7 | 角色六星期望 `35.5` 抽/个 |
| `WEAPON_SIX_STAR_EXPECTATION` | gacha-stat-charts.tsx:8 | 武器六星期望 `25` 抽/个 |
| `cssVar` | gacha-stat-charts.tsx:10 | 读 CSS 变量（与 pity 图重复） |
| `tickIntervalFor` | gacha-stat-charts.tsx:20 | **刻度密度控制**：`max(1, ceil((max-min)/10))`，强制 `axis.interval` 使刻度数 ≤ 11（含首尾） |
| `useEchart` | gacha-stat-charts.tsx:25 | Hook：监听 `themeChange` 产生 `themeTick`（27-31），`echarts.init` + `ResizeObserver`（35-47），返回 `{ setOption }`（49-54，`setOption(option, true)`） |
| `useChronoRecords` | gacha-stat-charts.tsx:58 | 过滤当前分类的 `draw` 记录（64-68）并按 `Number(gachaTs)` **升序**（69）；`weapon`/`all` 不分类过滤，其余用 `poolKindOf` |
| `poolKindOf` | gacha-stat-charts.tsx:75 | 与 pity 图同名同逻辑的重复实现 |
| `useStarDistribution` | gacha-stat-charts.tsx:88 | 按 `rarity` 计数 → `{ total, series: [rarity, count][] }`，按稀有度降序（96） |
| `calculateGachaSixStarIntervals` | `utils/gachaIntervals.ts` | 共享间隔算法；被统计卡片、保底图与统计图复用 |
| `useCumulativeSix` | gacha-stat-charts.tsx:140 | **间隔累积曲线**：入参为 `GachaSixStarInterval[]`；取出间隔抽数并**升序排序**，起点 `[0,0]` 后逐个 push `[间隔, 序号+1]` → `{ points, total, maxInterval }`。`points` 语义：横轴 n 处纵轴 = 间隔 ≤ n 抽的六星个数 |
| `RARITY_COLORS` | gacha-stat-charts.tsx:140 | 稀有度配色：6 `#ef4444`、5 `#ffd700`、4 `#a855f7`、3 `#94a3b8` |
| `GachaStatCharts` | gacha-stat-charts.tsx:147 | 主组件，147-406 行 |

**Props（147-159）**：`records: GachaRecord[]`、`pools: Record<string, { poolType: string }>`、`category: GachaCategory`、`isWeapon: boolean`、`isZh: boolean`。

**输入数据结构**：`GachaRecord` 中的 `kind`、`poolId`、`poolName`、`rarity`、`isFree`、`gachaTs`；`pools` 提供 `poolType` 与卡池名称。派生结构：`{total, series}`（星级分布）、`GachaSixStarInterval[]`（按卡池分组的间隔项）、`points: [间隔抽数, 累计六星数][]`（升序）。

**计算逻辑（行号）**：
- 期望值选择：160 `expectation = isWeapon ? 25 : 35.5`。
- **六星间隔公式** `calculateGachaSixStarIntervals`（`utils/gachaIntervals.ts`）：**计数器按 poolId 独立维护**，每池从保存记录的第一抽开始。普通抽逐抽计数；赠送抽中没有六星的记录不计数，若赠送抽出了六星，则把此前普通抽数与本次连续赠送组中截至六星的抽数合并为一个事件间隔，并重置该池计数。间隔包含出六星的当抽；六星序号也按池独立。柱状图、折线图、累计图与统计卡片共用此算法。
- **间隔累积公式** `useCumulativeSix`（150-162）：取出共享算法的间隔抽数，升序排序后生成阶梯累积点。累积图汇总所有卡池的间隔，但每个间隔均先在所属卡池独立计算。
- **星级占比** `useStarDistribution`（88-99）：Map 计数 + 总数，percent 在 219-223 计算为 `round(c/total*1000)/10`（保留 1 位小数）。

**图表类型与配置**（三个容器均固定高 220px：376/383/396，库为 **ECharts**，各由一个 `useEchart` 实例驱动）：

1. **星级分布环形图**（effect 180-228）
   - `series[0].type: "pie"`，`radius: ["45%","72%"]`、`center: ["50%","44%"]`、`avoidLabelOverlap`（206-208）；label `"{c} ({d}%)"`（209-214），`labelLine` 长度 8/6（215）。
   - `legend` 置底，数据为 `"6★".."3★"`（196-202）；调色板取自 `RARITY_COLORS`（182）。
   - tooltip `trigger: "item"`，formatter 输出名称与 `值 (百分比%)`（191-194）。
2. **按卡池着色的六星间隔折线图**（effect 248-322）
   - 图表仅有一条 `series.type: "line"`，按六星事件时间顺序连接所有卡池的数据；x 为全局事件序号，y 为共享算法计算的间隔抽数。
   - 数据点按所属卡池分别着色，图下方显示卡池颜色图例；tooltip 显示卡池名、该池六星序号及间隔。红色虚线 `yAxis: expectation` 标记期望抽数。
   - `xAxis` 为 value，从第一次六星事件序号 1 起始（范围 `1..max(1, intervals.length)`），按事件数量设置刻度；`yAxis` 为间隔抽数。
3. **六星间隔累积阶梯图**（effect 302-368）——标题「六星累计（按间隔） / Cumulative 6★ (by interval)」
   - `series.type: "line"`，`data: cumulative.points`（346），`showSymbol: false`、**`step: "end"`**（348，阶梯线，无 `smooth`）、渐变面积（351）。
   - `xAxis` value `0..maxX`，`maxX = max(1, maxInterval)`（303, 321-330），name「六星间隔（抽）/ 6★ interval (pulls)」（328）——横轴为数据轴，**不**强制刻度间隔，走 ECharts 自动刻度。
   - `yAxis` value `0..maxY`，`maxY = max(1, total)`（304），**`interval: tickIntervalFor(0, maxY)`（335）强制纵轴刻度密度（≤ 11 个）**、`minInterval: 1`（336），name「累计六星 / Cumulative 6★」（339）。`grid.top` 为 30（306）以让出轴名。
   - `markLine`（352-363）：红色虚线 `xAxis: expectation`（362），label `位置 insideEndTop`（359）——含义为「间隔 ≤ 期望抽数」的分界，左侧高度即「期望内出的六星个数」；**`animation: false`**（禁用标线生长动画：动画期间 label 被逐帧重定位到当前生长端，产生闪烁/重影，见 apache/echarts#20834；此开关独立于 series 动画，两处 markLine 均设置）。
   - tooltip `trigger: "axis"`，输出「N 抽内 / 六星: M」（316-319）。

**渲染（379-415）**：`grid grid-cols-1 lg:grid-cols-3 gap-4` 内嵌三个 `GlassCard`，标题分别为「星级分布」、「各卡池六星间隔（期望 N 抽）」、「六星累计（按间隔）」；中间为单条连接所有卡池事件、数据点按卡池着色的折线图，右侧为间隔累积阶梯折线图。中间与右侧卡片均在 `intervals.length === 0` 时叠加「暂无六星记录」空态。

**备注**：
- **invoke 命令**：0 个（未引入 `@tauri-apps/api/core`）。
- **listen 事件**：无 Tauri `listen`；仅 `window.addEventListener("themeChange")`（gacha-stat-charts.tsx:29，在 `useEchart` 内）。
- **Props 清单**：`records`、`pools`、`category`、`isWeapon`、`isZh`。
- **异常/注意点**：① 间隔计数按 `poolId` 分组，与保底图同口径；每池首个六星的间隔从该池保存记录中的第一抽计起，历史记录不完整时不代表账号全历史。赠送无六星时不计，赠送出六星时将本次赠送组截至六星的抽数计入事件。② “平均六星间隔”按同一批事件求均值，不再使用总抽数÷六星数。③ 累积折线按间隔升序汇总卡池数据，参考线位于 `xAxis: expectation`，表示间隔分界。④ 环形图未处理空数据空态（另两张卡片均有）。⑤ `poolKindOf`/`cssVar` 与 `gacha-pity-chart.tsx` 重复。

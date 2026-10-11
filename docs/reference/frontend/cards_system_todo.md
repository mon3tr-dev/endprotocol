# 系统资源卡片 & To-Do 卡片 — 文件功能参考

> 逐文件精读源码生成，覆盖 2026-10 新增的两类卡片及其支撑模块（卡片、store、types、utils、设置分区、页面）。
> 卡片系统通用契约见 [cards_core.md](cards_core.md)；新增卡片流程见 [card_development.md](../../card_development.md)。

## 影响到的公共文件（同一变更内更新）

| 文件 | 变更 |
| --- | --- |
| `src/types/card-settings.ts` | `CardSettingsMap` 新增 `system_resource: SystemResourceCardSettings`、`todo: TodoCardSettings`（并导出 `TodoCardSettings`） |
| `src/components/cards/card-container.tsx` | 右键菜单新增 `system_resource`（设置、立即刷新）与 `todo`（编辑/在页面打开/重命名/复制/排序/隐藏已完成/清除已完成/颜色图标/删除列表）两组菜单项，通过 `cardAction` 事件派发 |
| `src/pages/dashboard.tsx` | `handleAddCard` 拦截 `system_resource`（打开形态/模板弹窗 `SystemResourceAddModal`）与 `todo`（打开列表选择弹窗 `TodoAddModal`，选择已有列表或按模板新建列表后建卡片） |
| `src/pages/settings.tsx` | 新增「系统资源卡片」「To-Do 卡片」两个全局默认值分区 |
| `src/components/dashboard-sidebar.tsx` | `NavKey` 增加 `todo`（`NAV_KEYS` 同步），导航/站内搜索新增 To-Do 页面入口 |
| `src/App.tsx` | 新增路由 `/todo`，`ROUTES` 同步 |
| `src/locales/{zh,en}/translation.json` | `sidebar.todo`、`todo_page.*`、`settings.system_resource.*`、`settings.todo.*` |

## 卡片目录清单（本组新增文件）

| 目录/文件（相对 `src/`） | 说明 |
| --- | --- |
| `components/cards/system-resource/system-resource.meta.json` | `id: system_resource`，`allowMultiple: true`，`defaultSize {w:4,h:3}` |
| `components/cards/system-resource/index.tsx` | 卡片主体（原子/卡片组两种形态） |
| `components/cards/system-resource/metrics.ts` | 指标解析与格式化 |
| `components/cards/system-resource/metric-view.tsx` | 单指标 5 种显示模式 |
| `components/cards/system-resource/settings-modal.tsx` | 卡片整体层 + 单指标层设置弹窗 |
| `components/cards/system-resource/color-picker.tsx` | 系统资源卡片共用的预设/自定义颜色选择器 |
| `components/cards/system-resource/add-modal.tsx` | 添加时的形态/模板选择 |
| `components/cards/system-resource/locales/{zh,en}.json` | 文案（键前缀 `system_resource_`） |
| `components/cards/todo/todo.meta.json` | `id: todo`，`allowMultiple: true`，`defaultSize {w:3,h:4}` |
| `components/cards/todo/index.tsx` | 卡片内联视图 |
| `components/cards/todo/add-modal.tsx` | 添加卡片时的模板选择（日常/周常/活动/养成/资源/空白） |
| `components/cards/todo/todo-detail.tsx` | 页面/Modal 共用的完整编辑器 |
| `components/cards/todo/todo-modal.tsx` | 右键「编辑」弹窗 |
| `components/cards/todo/list-settings-modal.tsx` | 列表设置（标题/描述/分组/颜色/图标/排序/隐藏已完成） |
| `components/cards/todo/todo-icon.tsx` | To-Do 列表图标标识到 Lucide 图标组件的映射；兼容旧 emoji 数据 |
| `components/cards/todo/quick-add.ts` | 快捷添加语法解析 + 日期格式化 |
| `components/cards/todo/locales/{zh,en}.json` | 文案（键前缀 `todo_`） |

## `src/components/cards/system-resource/index.tsx`
**职责**：系统资源卡片。初始化时读取全局默认值（`system_resource_defaults`）与卡片配置，首次使用按默认模板生成；按 `refreshMs` 轮询 `get_system_snapshot`，维护每指标历史缓冲；**一次只显示一个指标**（整页大号数值 + 占满高度的折线图），中/大卡可配置任意多个不重复指标并逐项翻页，小卡只允许一个指标；指标切换使用轻量淡入位移动效并遵守减少动态效果偏好；监听 `cardAction`（`system-resource-settings`）与 `manualRefresh`。
**导出**：`export default SystemResourceCard`。
**主要依赖**：`../registry/types`、`../base/use-card-data`（已移除，改用内部轮询）、`@/utils/cardConfigService`、`@/utils/systemResourceService`、`@/types/system-resource`、`./metric-view`、`./metrics`、`./settings-modal`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SystemResourceCard(props)` | 顶层组件 | Props 为标准 `BaseCardProps`，仅使用 `cardId` / `settings` |
| `liveSnapshot` / `collectionError` / `loadedOnce` | 状态 | 轮询结果、采集失败信息、是否完成首次采集 |
| `historyRef` | ref | `metricId → number[]` 历史缓冲，**索引 0 为最新**（`unshift`），长度 = `historyWindowSec*1000/refreshMs`（夹取 10–240）；对所有可见指标持续采样，翻页即时可用 |
| `cardSize` | 派生值 | 由 `BaseCardProps.w/h` 得到的当前网格尺寸，仅供设置弹窗判断小卡指标限制；设置不修改尺寸 |
| `pageIndex` / `navNonce` | 状态 | 当前显示第几个指标、手动翻页计数（用于重置自动翻页计时） |
| `NavButton(props)` | 内部组件 | 上一页/下一页按钮（`‹` / `›`） |
| `DEFAULT_VISIBLE_METRICS` | 常量 | 全局默认模板为空时的兜底指标 |

**备注**：
- 采集失败时展示 `card:system_resource_collect_failed` + 提示，不崩溃（满足「资源采集失败给出友好提示」）。
- 卡片设置经 `CardConfigService.saveCardSettings` 落盘 `card_settings.{cardId}`，重启恢复。
- 初始化 effect **不能加一次性 ref 守卫**：应用以 `<React.StrictMode>` 挂载，开发模式下 effect 会「挂载→卸载→再挂载」，若用 ref 跳过第二次初始化会导致 `cardSettings` 永远为空、卡片卡在「采集中」。因此以 `active` 标志处理卸载即可，重复初始化是幂等的。
- 历史曲线默认开启（`DEFAULT_SYSTEM_RESOURCE_DEFAULTS.showSparklines = true`，窗口默认 120s）。旧卡片配置通过 `settingsVersion`（v1→v2）一次性迁移：`migrateSettings()` 会把 `showSparklines` 置为 true、窗口补到 ≥120s 并写回 `settingsVersion: 2`。
- 卡片主体区域采用 `overflow-hidden`；指标较多时按页翻看，不依赖卡片尺寸容量裁剪。
- 历史缓冲「最新在前」：`buffer.unshift(value)`，超长后 `buffer.length = capacity` 截断右侧（丢弃最旧）。
- **自动翻页**：`rotateMs`（毫秒，0 = 关闭）驱动 `setInterval` 切到下一页；手动翻页会通过 `navNonce` 重置计时；卡片不提供暂停按钮。
- **配置迁移**：v1→v2 开启曲线并扩大历史窗口；v2→v3 过滤已删除指标；v3→v4 小卡裁剪为 1 个指标并补默认 `rotateMs`；v4→v5 保留中/大卡全部指标，不再按尺寸容量裁剪。迁移只更新卡片设置，不自动改变卡片尺寸。
- **三档尺寸**：新增时按预设选择小 2×2 / 中 3×3 / 大 4×3（`SIZE_PRESETS`）；卡片设置不再允许改尺寸，旧配置迁移也不会自动调整尺寸。折线图占满卡片剩余高度，档位越大可用高度越高。
- 右键菜单项在 `card-container.tsx` 定义；卡片自身响应 `cardAction` 的 `system-resource-settings`。`system-resource-refresh` 由菜单改为派发 `manualRefresh` 全局事件。

## `src/components/cards/system-resource/metrics.ts`
**职责**：把 `SystemSnapshot` + `ResourceMetricConfig` 折算为可渲染的 `ResolvedMetric`（数值/百分比/文本/单位/告警色调/可用性），并提供字节、速率和历史统计值的单位换算。
**导出**：`pickGpu`、`pickDisk`、`pickNetwork`、`formatBytes`、`formatRate`、`formatMetricValue`、`resolveMetric`、`toneColor`，类型 `MetricTone`、`ResolvedMetric`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `pickGpu/pickDisk/pickNetwork` | 顶部 | 依据 `config.scope` 选择设备，缺省取列表首项；无设备返回 `null` |
| `formatBytes` | — | `auto/binary/decimal/bit` 四种制式；`auto` 等同 binary（KiB/MiB…） |
| `formatMetricValue` | — | 历史峰值/均值按对应指标单位格式化；字节、速率和 CPU 频率应用与主读数相同的单位换算 |
| `resolveMetric` | — | 17 个指标的 switch 映射；`available=false` + `text="--"` 表示缺传感器/无设备。CPU 频率使用后端实测值（PDH） |
| `formatAxisValue` | — | 折线图纵轴刻度格式化（按 kind 做字节/速率/频率/温度/百分比换算） |
| `toneFor` | 私有 | 百分比类按 `config.warn/critical`（回退卡片阈值）判定 `warn/critical`；绝对量（温度）仅在显式配置阈值时告警 |

**备注**：GPU 相关指标在无 NVIDIA 设备时统一 `available=false`，前端显示「不可用」；UI 因此不会因缺 GPU 报错。

## `src/components/cards/system-resource/metric-view.tsx`
**职责**：单指标整页视图：顶部为指标名 + 大号数值，下方是占满剩余高度的历史折线图（带坐标轴）；可选显示按当前展示单位换算的峰值/平均。卡片翻页时由父级为指标视图添加轻量进场动画。
**导出**：`MetricView`、`HistoryChart`、`metricLabel`、`historyStats`，类型 `MetricHistoryStats`。

**备注**：
- `HistoryChart` 为内联 SVG（`viewBox="0 0 100 100"` + `preserveAspectRatio="none"` + `vectorEffect="non-scaling-stroke"`），占满容器高度，无第三方图表依赖。
- **坐标轴**：左侧纵轴三个刻度（上/中/下，按指标类型做单位换算：`formatAxisValue`），底部横轴（左「现在」、右「N 秒前」），并有上/中/下网格线与左轴线。
- **任务管理器式横轴**：`history[0]` 为最新；x = `index / (capacity - 1) * 100`，`capacity = historyWindowSec*1000/refreshMs`。时间跨度固定，新数据在最左、旧数据逐格右移，移出右边界后不再显示；采样不足时右侧留空（不会被拉伸铺满）。
- **纵轴放到最大**：百分比指标固定 0–100（图表顶部 = 100%）；其余纵向为 0 → 窗口内最大值（含 5% 余量），保证曲线用满整个高度。
- **线下方整块填充**：`polygon` 从折线各点向下延伸到图表底部，`opacity=0.35`，颜色跟随指标/主题色，明确可见。
- 标签与数值**不使用 CSS 截断**（`truncate`）：空间不足时 `flex-wrap` 换行，避免数值/单位被显示成「…」。
- `showPeakAvg` 由 `historyStats()` 计算峰值与均值。

## `src/components/cards/system-resource/color-picker.tsx`
**职责**：系统资源卡片的共用颜色选择器，展示主题预设色与原生自定义颜色输入，并明确标记当前选中色。
**导出**：`SystemResourceColorPicker`。
**使用位置**：卡片整体强调色、单指标颜色，以及设置页的全局默认强调色。

## `src/components/cards/system-resource/settings-modal.tsx`
**职责**：卡片整体层 + 指标层的设置 UI。整体层含标题、刷新频率、**自动翻页间隔**、强调色、标题栏/标签/曲线/峰值均值开关、曲线窗口、告警阈值；指标层含选择与排序、单位制式、精度、颜色、设备（GPU/磁盘/网卡）、单指标阈值。
**导出**：`SystemResourceSettingsModal`。

**备注**：
- `draft` 本地编辑，点「保存」才通过 `onSave(draft)` 回写；设置不会修改卡片尺寸。设备下拉项来自当前快照（`snapshot.gpus/disks/networks`）。
- 新增时选择小卡（2×2）/中卡（3×3）/大卡（4×3）；小卡只允许 1 个指标，中/大卡添加数量不受尺寸容量限制。
- 指标选择：**小卡为单选**（列出全部指标，点选替换，见 `system_resource_small_single_hint`）；中/大卡可选择全部不重复指标（勾选显示、↑/↓ 排序、删除图标、下方「添加指标」），启用的指标逐项分页查看。
- 「自动翻页」：关闭 / 3s / 5s / 10s / 30s，写入 `rotateMs`。

## `src/components/cards/system-resource/add-modal.tsx`
**职责**：新增卡片时的选择，按三档尺寸分组：小卡（2×2）列出所有**单指标**；中卡（3×3）与大卡（4×3）列出预设指标组（CPU / 内存 / 磁盘 / 网络 / GPU / 性能总览 / 全量监控）。确认后由 `dashboard.tsx` 用 `buildDefaultCardSettings` 生成配置并 `addCard`。
**导出**：`SystemResourceAddModal`、类型 `SystemResourceAddPayload`（`{mode, metrics, size, templateId?}`）。

## `src/components/cards/todo/add-modal.tsx`
**职责**：添加 To-Do 卡片时选择已有列表或创建新列表。列出现有列表供直接绑定；也列出 `TODO_TEMPLATES`（空白 / 每日任务 / 周常任务 / 活动限时 / 养成计划 / 资源规划），所选模板由调用方创建新列表后再绑定卡片。
**导出**：`TodoAddModal`。

**备注**：模板内容面向游戏辅助场景（领取每日奖励、清体力、周常关卡、活动兑换、角色培养、抽卡资源规划），不含购物清单等通用模板。

## `src/utils/todoTemplateService.ts`
**职责**：根据 To-Do 模板创建列表；模板标题和事项由调用方提供的翻译函数本地化，默认排序/隐藏已完成选项读取全局默认值。
**导出**：`createTodoListFromTemplate(templateId, translate)`。

## `src/components/cards/todo/index.tsx`
**职责**：To-Do 卡片内联视图。展示图标/标题/进度环/逾期角标、事项勾选与快速添加/删除；监听 `cardAction` 处理右键菜单动作（编辑、在页面打开、重命名、复制、排序、隐藏已完成、清除已完成、颜色图标、删除列表）。
**导出**：`export default TodoCard`。
**主要依赖**：`@/stores/todoStore`、`@/types/card-settings`、`./quick-add`、`./todo-modal`、`./list-settings-modal`、`@/utils/cardConfigService`、`@/components/ui/confirm-dialog`、`react-router-dom` 的 `useNavigate`。

**备注**：
- 卡片 settings 为 `{ listId }`；新增卡片必须显式选择已有列表或新建模板列表。未绑定（含旧卡片列表已删除）时显示选择/创建列表入口，不自动绑定任何列表。
- 「在页面中打开」用 `useNavigate()` 跳 `/todo?list=<id>`。
- 删除列表后卡片进入「无列表」占位，可跳转页面重建。

## `src/components/cards/todo/todo-detail.tsx`
**职责**：页面右侧详情与 Modal 共用的完整编辑器：筛选（全部/未完成/已完成/今日到期/逾期）、搜索、排序、批量选择、快捷添加、行内编辑（双击）、优先级循环、截止日期、标签、子事项、备注、拖拽排序、清除已完成、删除撤销、每日回顾统计、空状态引导。
**导出**：`TodoDetail`。

**备注**：所有写操作直接调用 `todoStore` 的变更函数；`TodoDetail` 自身不持持久化逻辑，因此页面与 Modal 天然实时同步（同一 store + `todoChanged` 事件）。

## `src/components/cards/todo/todo-modal.tsx`
**职责**：右键「编辑」弹窗，`CustomModal size="xl" height="fixed"` 内嵌 `TodoDetail`；头部显示列表图标与标题。
**导出**：`TodoModal`。

## `src/components/cards/todo/list-settings-modal.tsx`
**职责**：列表设置弹窗：标题、描述、分组、预设/自定义 HEX-RGB 颜色、图标、排序方式、隐藏已完成，以及每日定时重置已完成状态。
**导出**：`TodoListSettingsModal`。通过 `useTodoLists()` 读取当前列表，保存时调用 `updateTodoList`。
**备注**：每日重置使用设备本地时间；应用启动时补做当天已到时间的重置，运行中每 15 秒检查并在到点后执行。重置同时清除事项/子事项的完成勾选和事项完成时间。

## `src/components/cards/todo/todo-icon.tsx`
**职责**：将 To-Do 图标 ID 渲染为 Lucide 图标，并在读取列表时兼容旧版 emoji 图标值。
**导出**：`TodoIcon`。
**备注**：旧列表和默认设置中的图标值在加载/保存时归一化为图标 ID；界面只渲染 SVG 图标。

## `src/components/cards/todo/quick-add.ts`
**职责**：快捷添加语法解析与日期格式化。
**导出**：`parseQuickAdd`、`formatDueDate`、类型 `ParsedQuickAdd`。

| 语法 | 含义 |
| --- | --- |
| `!` | 高优先级（3） |
| `!1` / `!2` / `!3` | 低 / 中 / 高 |
| `@today` / `@tomorrow` / `@YYYY-MM-DD` | 截止时间（当天 23:59:59） |
| `#tag` | 标签（可多个） |

## `src/stores/todoStore.ts`
**职责**：To-Do 单一数据源。模块级 `lists` 缓存 + 订阅者集合 + `window` 事件 `todoChanged`；持久化到配置键 `todo_lists`；提供列表/事项的全部增删改查、排序、批量、撤销、每日重置与统计。
**导出**：`subscribeTodo`、`ensureTodoLoaded`、`getTodoLists`、`isTodoLoaded`、`sortTodoItems`、`filterTodoItems`、`isOverdue`、`isDueToday`、`createTodoList`、`updateTodoList`、`deleteTodoList`、`duplicateTodoList`、`reorderTodoLists`、`addTodoItem`、`updateTodoItem`、`toggleTodoItem`、`deleteTodoItem`、`deleteTodoItems`、`clearCompleted`、`reorderTodoItems`、`canUndo`、`undoLastDelete`、`getTodayStats`、`useTodoLists`、类型 `NewTodoItem`。

| 要点 | 说明 |
| --- | --- |
| 变更语义 | 每次变更都生成**新的 `lists` 数组**（触发 React 重渲染）→ `setConfig("todo_lists", lists)` → `notify()`（订阅者 + `todoChanged` 事件） |
| 撤销 | 删除事项/清除已完成会把被删项暂存 8 秒（`UNDO_TIMEOUT_MS`），期间 `undoLastDelete()` 可恢复 |
| 每日重置 | 已加载后启动单例定时检查；对已启用且到达本地 `HH:mm` 的列表按日期最多重置一次，并在启动/窗口重新聚焦/运行定时检查时补执行 |
| 排序 | `sortTodoItems` 支持 `manual/priority/due/created`，已完成恒沉底；`reorderTodoItems` 按当前排序重排 `order` |
| Hook | `useTodoLists()` 订阅变更并 `ensureTodoLoaded()`，返回 `{ lists, loaded, isLoaded }` |

## `src/types/system-resource.ts` / `src/types/todo.ts`
**职责**：两类卡片的类型与常量目录。
**`system-resource.ts` 导出**：`ResourceCategory`、`MetricDisplayMode`、`MetricValueKind`、`ByteUnitSystem`、`MetricPrecision`、`SystemResourceSizeTier`、`SystemResourceSizePreset`、`SIZE_PRESETS`、`sizeTier`、`ResourceMetricId`、`MetricDefinition`、`METRIC_CATALOG`（17 个指标）、`METRIC_ORDER`、`ResourceMetricConfig`、`SystemResourceCardSettings`（含 `settingsVersion`）、`SystemResourceDefaults`、`DEFAULT_SYSTEM_RESOURCE_DEFAULTS`、`ResourceGroupTemplate`（含 `tier`）、`RESOURCE_GROUP_TEMPLATES`、`REFRESH_PRESETS`、`RESOURCE_ACCENT_PRESETS`、`createMetricConfig`、`buildDefaultCardSettings`，以及后端快照类型（`CpuSnapshot` 含 `frequencyIsActual`）等。
**`todo.ts` 导出**：`TodoPriority`、`TodoSortMode`、`TodoFilter`、`TodoIconId`、`normalizeTodoIcon`、`TodoSubtask`、`TodoItem`、`TodoList`、`TodoDefaults`、`DEFAULT_TODO_DEFAULTS`、`TODO_COLORS`、`TODO_ICONS`、`PRIORITY_LABELS`、`PRIORITY_COLORS`、`TodoTemplate`、`TODO_TEMPLATES`、`SORT_MODE_OPTIONS`、`FILTER_OPTIONS`。`TodoList.dailyResetEnabled`/`dailyResetTime`/`lastDailyResetDate` 保存每日重置开关、本地时间和最近执行日期。

## `src/utils/systemResourceService.ts`
**职责**：`invoke("get_system_snapshot")` 的封装 + 全局默认值读写。
**导出**：`SystemResourceService`（`getSnapshot()` → `SnapshotResult{ok,data?,error?}`、`safeSnapshot()`）、`getSystemResourceDefaults()`、`setSystemResourceDefaults(patch)`、类型 `SnapshotResult`，并再导出 `SystemSnapshot`。

## `src/utils/todoDefaults.ts`
**职责**：全局 To-Do 默认值读写（配置键 `todo_defaults`）。
**导出**：`getTodoDefaults()`、`setTodoDefaults(patch)`。加载和保存时将旧 emoji 值归一化为图标 ID。

## `src/utils/todoImportExport.ts`
**职责**：To-Do 列表的 Markdown / JSON 导入导出。
**导出**：`listToMarkdown`、`parseMarkdownList`、`listToJson`、`parseJsonList`，类型 `ParsedMarkdownList`。

## `src/components/system-resource-settings.tsx` / `src/components/todo-settings.tsx`
**职责**：全局设置页的两个默认值分区。
- `SystemResourceSettings`：默认刷新频率、单位制式、显示模式、精度、布局、告警阈值、是否显示曲线、主题色、默认卡片组模板（指标多选）。
- `TodoSettings`：默认排序方式、是否隐藏已完成、默认优先级体系、是否开启截止时间、默认颜色、默认图标。

## `src/pages/todo.tsx`
**职责**：To-Do 独立页面。左侧列表（新建/搜索/拖拽排序/分组/复制/删除/设置），右侧 `TodoDetail`，顶部筛选与排序由 `TodoDetail` 提供；支持模板新建与 Markdown/JSON 导入导出；通过 URL `?list=<id>` 选定当前列表，不自动选择第一个列表，选中列表被删除后清除当前选择。
**导出**：`export default TodoPage`。

## 事件 / IPC 汇总（本组）
- Tauri `invoke`：`get_system_snapshot`（`utils/systemResourceService.ts`）、`get_config`/`set_config`（默认值、`todo_lists`，经 `utils/configService.ts`）、`get_card_settings`/`save_card_settings`（经 `utils/cardConfigService.ts`）。
- `window` 事件：`cardAction`（`card-container.tsx` 派发，两张卡片各自监听）、`manualRefresh`（系统资源卡片刷新）、`todoChanged`（`todoStore` 广播）。
- 配置键：`card_settings.{cardId}`（卡片级）、`system_resource_defaults`、`todo_defaults`、`todo_lists`（全局级）。

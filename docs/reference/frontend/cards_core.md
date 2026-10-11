# 卡片系统核心（注册/加载/容器/模板）— 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## 每张卡片的目录契约

`src/components/cards/<card-name>/` 下固定包含（11 张卡片 + `_template` 均如此；`system-resource/`、`todo/` 为新增两卡）：

| 文件 | 说明 |
| --- | --- |
| `<card-name>.meta.json` | 元数据：`id`、`name{zh,en}`、`description{zh,en}`、`icon`、`defaultSize{w,h}`、`version`、可选 `allowMultiple` |
| `index.tsx` | 默认导出组件，props 为 `BaseCardProps`（`roleId`/`cardId`/`settings`/`isEditMode`） |
| `locales/zh.json` | 中文文案（由 `loader.ts:21-24` 的 `import.meta.glob('../*/locales/*.json')` 收集） |
| `locales/en.json` | 英文文案（同上，与 zh 成对） |
| 其他 `*.tsx` | 可选的附属组件（弹窗、设置面板等） |

具体每张卡片的文件清单见：[cards_character_list.md](cards_character_list.md)、[cards_account_achievement.md](cards_account_achievement.md)、[cards_attendance_domain_spaceship.md](cards_attendance_domain_spaceship.md)。

### `src/components/cards/` 完整文件清单

| 目录 | 文件（完整路径均以 `src/components/cards/` 开头） |
| --- | --- |
| `registry/` | `src/components/cards/registry/index.ts`、`src/components/cards/registry/loader.ts`、`src/components/cards/registry/types.ts` |
| `base/` | `src/components/cards/base/index.ts`、`src/components/cards/base/card-wrapper.tsx`、`src/components/cards/base/use-card-data.ts` |
| （根） | `src/components/cards/card-container.tsx`、`src/components/cards/card-context-menu.tsx` |
| `_template/` | `src/components/cards/_template/_template.meta.json`、`src/components/cards/_template/index.tsx`、`src/components/cards/_template/README.md`、`src/components/cards/_template/locales/zh.json`、`src/components/cards/_template/locales/en.json` |
| `character-list/` | `src/components/cards/character-list/character-list.meta.json`、`src/components/cards/character-list/index.tsx`、`src/components/cards/character-list/char-select-modal.tsx`、`src/components/cards/character-list/character-list-size-modal.tsx`、`src/components/cards/character-list/locales/zh.json`、`src/components/cards/character-list/locales/en.json` |
| `account-info/` | `src/components/cards/account-info/account-info.meta.json`、`src/components/cards/account-info/index.tsx`、`src/components/cards/account-info/locales/zh.json`、`src/components/cards/account-info/locales/en.json` |
| `account-progress/` | `src/components/cards/account-progress/account-progress.meta.json`、`src/components/cards/account-progress/index.tsx`、`src/components/cards/account-progress/locales/zh.json`、`src/components/cards/account-progress/locales/en.json` |
| `achievement/` | `src/components/cards/achievement/achievement.meta.json`、`src/components/cards/achievement/index.tsx`、`src/components/cards/achievement/achievement-modal.tsx`、`src/components/cards/achievement/medal-browser.tsx`、`src/components/cards/achievement/locales/zh.json`、`src/components/cards/achievement/locales/en.json` |
| `attendance/` | `src/components/cards/attendance/attendance.meta.json`、`src/components/cards/attendance/index.tsx`、`src/components/cards/attendance/attendance-settings-modal.tsx`、`src/components/cards/attendance/attendance-rewards.tsx`、`src/components/cards/attendance/attendance-rewards-modal.tsx`、`src/components/cards/attendance/locales/zh.json`、`src/components/cards/attendance/locales/en.json` |
| `domain-info/` | `src/components/cards/domain-info/domain-info.meta.json`、`src/components/cards/domain-info/index.tsx`、`src/components/cards/domain-info/locales/zh.json`、`src/components/cards/domain-info/locales/en.json` |
| `spaceship/` | `src/components/cards/spaceship/spaceship.meta.json`、`src/components/cards/spaceship/index.tsx`、`src/components/cards/spaceship/locales/zh.json`、`src/components/cards/spaceship/locales/en.json` |
| `system-resource/` | `system-resource.meta.json`、`index.tsx`、`metrics.ts`、`metric-view.tsx`、`settings-modal.tsx`、`add-modal.tsx`、`locales/{zh,en}.json`（详见 [cards_system_todo.md](cards_system_todo.md)） |
| `todo/` | `todo.meta.json`、`index.tsx`、`todo-detail.tsx`、`todo-modal.tsx`、`list-settings-modal.tsx`、`quick-add.ts`、`locales/{zh,en}.json`（详见 [cards_system_todo.md](cards_system_todo.md)） |

## `src/components/cards/registry/types.ts`
**职责**：卡片系统唯一的类型契约文件，定义卡片元数据、组件 Props、本地化资源与卡片模块的标准结构。
**导出**：`CardTag`（interface）、`CardMeta`（interface）、`BaseCardProps`（interface）、`CardLocales`（interface）、`CardModule`（interface）。
**主要依赖**：无运行时依赖（纯类型文件）；`React.ComponentType` 使用全局 React 类型（types.ts:35，未显式 import）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CardTag` | types.ts:2-5 | 卡片标签。字段：`id: string`（标签标识，用于筛选）；`label: Record<string, string>`（多语言文案，如 `{zh, en}`） |
| `CardMeta` | types.ts:8-17 | 卡片元数据（对应 `*.meta.json`）。字段：`id: string` 卡片类型唯一标识（注册表 Map 的键）；`name: Record<string,string>` 多语言名称；`description: Record<string,string>` 多语言描述；`icon: string` 图标名称或图标类名；`defaultSize: {w:number; h:number}` 默认网格尺寸；`version: string` 版本号；`allowMultiple?: boolean` 是否允许多实例（缺省视为 false）；`tags?: CardTag[]` 多语言标签，用于添加卡片时搜索/筛选 |
| `BaseCardProps` | types.ts | 所有卡片组件必须接受的 Props。字段：`roleId: string` 当前角色 ID；`cardId: string` 卡片实例 ID；`settings: any` 卡片配置（由 dashboard 配置持久化）；`isEditMode?: boolean` 仪表盘编辑模式标志；`w?: number` / `h?: number` 当前网格尺寸（2026-10 新增，由 `CardContainer` 传入，供卡片在设置中显示/修改尺寸） |
| `CardLocales` | types.ts:28-30 | 本地化资源容器：`[language: string]: Record<string, string>`（语言码 → 键值对） |
| `CardModule` | types.ts:33-38 | 卡片模块聚合体。字段：`meta: CardMeta`；`component: React.ComponentType<BaseCardProps>` 默认导出组件；`startup?: (roleId: string) => Promise<void>` 启动任务处理器；`locales?: CardLocales` 本地化资源 |

**备注**：
- `CardModule.locales` 仅为类型声明，`loader.ts` 组装 `CardModule` 时从未写入该字段（见 loader.ts:71-81），本地化资源实际直接注入全局 i18n。
- 类型文件中没有任何运行时校验逻辑；字段约束完全依赖 TypeScript。

## `src/components/cards/registry/loader.ts`
**职责**：通过 Vite `import.meta.glob` 静态自动发现 `cards/*/` 下的组件、元数据与本地化文件，构建并缓存卡片注册表（`Map<meta.id, CardModule>`），同时把卡片翻译注入 i18n 的 `card` 命名空间、把 `startup` 处理器注册到 `CardStartupService`。
**导出**：`loadAllCards()`、`getAvailableCards()`。
**主要依赖**：`./types`（`CardModule`/`CardMeta`/`CardLocales` 类型）、`@/cards/startup-service`（`CardStartupService.register`）、`@/i18n`（`i18n.addResourceBundle`）、Vite 的 `import.meta.glob`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `cardModules` | loader.ts:7-13 | `import.meta.glob('../*/index.tsx', { eager: true })`，得到 `路径 → { default: 组件, startup? }` 的静态映射 |
| `cardMetas` | loader.ts:15-18 | `import.meta.glob('../*/*.meta.json', { eager: true, import: 'default' })`，直接得到已解析的 `CardMeta` 对象 |
| `cardLocaleFiles` | loader.ts:21-24 | `import.meta.glob('../*/locales/*.json', { eager: true, import: 'default' })`，得到 `路径 → 翻译对象` |
| `cachedRegistry` | loader.ts:26 | 模块级缓存变量 `Map<string, CardModule> \| null`，默认 `null` |
| `buildCardLocales()`（私有） | loader.ts:28-46 | 遍历 `cardLocaleFiles`，用正则 `../([^/]+)/locales/(\w+)\.json`（:32）解析出目录名与语言码；跳过 `_` 开头目录（:37）；按语言 `Object.assign` 合并（:42），返回 `CardLocales` |
| `buildCardRegistry()`（私有） | loader.ts:48-86 | 先把 locales 注册进 i18n `card` 命名空间（:52-55），再遍历 `cardMetas` 组装注册表，见「备注」 |
| `loadAllCards()` | loader.ts:88-93 | 惰性单例：无缓存时调用 `buildCardRegistry()` 并缓存，之后始终返回同一 `Map` |
| `getAvailableCards()` | loader.ts:95-97 | `Array.from(loadAllCards().values()).map(m => m.meta)`，返回所有已注册卡片的元数据数组（供「添加卡片」列表使用） |

**备注**：
- **自动发现机制**：
  - pattern 1 `'../*/index.tsx'`（:11）+ `eager: true` —— 所有卡片目录的入口组件（含 `_template`，无 `import` 选项故取整个模块 namespace）。
  - pattern 2 `'../*/*.meta.json'`（:16）+ `eager: true, import: 'default'` —— 所有元数据 JSON 的默认导出。
  - pattern 3 `'../*/locales/*.json'`（:22）+ `eager: true, import: 'default'` —— 所有卡片翻译文件。
  - 三个 pattern 均以 `../*/` 形式相对 `registry/` 展开，即覆盖 `src/components/cards/` 下所有一级子目录；文件头注释（:5-6）声称"排除 base、registry 和 _template"，实际 `base/`、`registry/` 只是因不含 `index.tsx` / `*.meta.json` 而不匹配，`_template` 则由 `_` 前缀判断显式跳过（:37、:63-65）。
  - `eager: true` 意味着**构建期同步打包**：新卡片目录必须重启 dev server / 重新构建才会被发现，运行时无法动态注册。
- **meta 字段校验**：**没有**任何 schema/字段校验。仅有两道过滤：路径正则不匹配则 `continue`（:33、:59），目录名以 `_` 开头则跳过（:37、:63-65）。后果：
  - JSON 语法错误 → Vite eager import 在构建/模块加载期直接抛错，无 try/catch，会导致应用启动失败（而非降级跳过）。
  - `meta.id` 缺失 → 仍会执行 `cards.set(undefined, ...)`（:81），注册表出现 `undefined` 键。
  - `name`/`icon`/`defaultSize` 等缺失 → 静默通过，在 UI 层才暴露问题。
  - 有 `meta.json` 但同目录无 `index.tsx`（或未 default 导出） → `module` 取不到，该卡片被**静默丢弃**（:70、:82），无任何告警。
- **卡片列表缓存**：`cachedRegistry`（:26）在 `loadAllCards()` 首次调用时填充（:89-91），之后永久复用；副作用（i18n 注册 :54、`CardStartupService.register` :78）只在首次构建时执行一次，重复调用 `loadAllCards()` 不会重复注册。
- 本地化合并策略：按 `glob` 返回的文件顺序 `Object.assign` 到同一语言对象（:42），不同卡片若使用相同 key 会**互相覆盖**（扁平合并且无卡片前缀）。
- 启动任务注册：`module.startup` 存在时写入 `cardModule.startup` 并调用 `CardStartupService.register(meta.id, module.startup)`（:76-79），注册键是 `meta.id` 而非目录名。
- 三个 pattern 中的 `*` 是 Vite glob 通配符（匹配任意一级子目录名），相对 `registry/` 目录解析。

## `src/components/cards/registry/index.ts`
**职责**：注册表的桶（barrel）出口，仅做聚合再导出。
**导出**：`export * from './types'`（index.ts:1）、`export * from './loader'`（index.ts:2），即对外暴露全部类型 + `loadAllCards` / `getAvailableCards`。
**主要依赖**：`./types`、`./loader`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| 类型再导出 | index.ts:1 | `CardTag`、`CardMeta`、`BaseCardProps`、`CardLocales`、`CardModule` |
| 函数再导出 | index.ts:2 | `loadAllCards`、`getAvailableCards` |

**备注**：实际调用方（如 `card-container.tsx:22`）多直接从 `./registry/loader` 导入，本桶文件的使用率低。

## `src/components/cards/base/use-card-data.ts`
**职责**：卡片通用数据加载 Hook，封装「请求 → data/isLoading/error 三态 + 手动 refetch + reloadKey 强制重载」的样板逻辑，供各卡片组件复用。
**导出**：`useCardData<T>()`。
**主要依赖**：`react`（`useState`/`useEffect`/`useCallback`/`useRef`）、`@/utils/logger`（`logDebug`/`logError`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `UseCardDataOptions<T>`（接口，未导出） | use-card-data.ts:4-10 | 字段：`fetchData: () => Promise<T>` 数据请求函数；`defaultValue?: T` 初始值；`lazy?: boolean` 懒加载开关（默认 `false`）；`reloadKey?: string \| number \| null` 变化时强制重载（如 roleId 切换） |
| `useCardData<T>()` | use-card-data.ts:12-63 | 返回 `{ data, isLoading, error, refetch }` |
| ─ `data` 初始值 | use-card-data.ts:18 | 源码为 `defaultValue \|\| null`：falsy 默认值（`0`/`""`/`false`）会被置为 `null` |
| ─ 初始 loading | use-card-data.ts:19 | `useState(!lazy)`：非懒加载初始即 loading |
| ─ `hasLoaded` / `hasLoadedRef` | use-card-data.ts:21-23 | 已加载标记，ref 供回调内读取最新值 |
| ─ `fetchDataRef` | use-card-data.ts:25-26 | 保存最新 `fetchData`，避免回调依赖变动 |
| ─ `loadData(force?)` | use-card-data.ts:28-45 | 守卫：`hasLoaded && !force && !lazy` 时直接返回（:29）；否则置 loading → 执行请求 → 成功置 `data`/`hasLoaded`，失败置 `error`（`logError`），`finally` 收起 loading |
| ─ reloadKey effect | use-card-data.ts:47-55 | 用 `prevReloadKeyRef` 比对，检测到变化即重置 `hasLoaded` 并 `loadData(true)` |
| ─ 初始加载 effect | use-card-data.ts:57-61 | 仅 `!lazy` 时挂载即 `loadData()` |
| ─ 返回值 | use-card-data.ts:63 | `{ data, isLoading, error, refetch: loadData }` |

**备注**：`lazy: true` 时守卫条件中的 `!lazy` 恒为假，`refetch` 永远会真正发起请求（即懒加载下手动 refetch 不会被去重拦截）。

## `src/components/cards/base/card-wrapper.tsx`
**职责**：卡片通用容器组件，用错误边界 + `Suspense` 包裹卡片内容，崩溃时降级为「加载失败」占位、懒加载未就绪时显示骨架屏。
**导出**：`CardWrapper()`。
**主要依赖**：`react`（`Component`/`Suspense`/`ErrorInfo`/`ReactNode`）、`@/components/ui/glass`（`GlassCard`）、`@/components/ui/loading-block`（`LoadingBlock`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CardWrapperProps`（接口，未导出） | card-wrapper.tsx:5-8 | `children: ReactNode`；`fallback?: ReactNode` 自定义错误占位 |
| `ErrorBoundaryState`（接口，未导出） | card-wrapper.tsx:10-12 | `{ hasError: boolean }` |
| `CardErrorBoundary`（类，未导出） | card-wrapper.tsx:14-34 | `getDerivedStateFromError` 置 `hasError`（:20-22）；`componentDidCatch` 仅 `console.error`（:24-26）；`render` 出错时返回 `props.fallback \|\| <ErrorState/>`（:28-33） |
| `CardWrapper()` | card-wrapper.tsx:36-42 | 结构：`<CardErrorBoundary fallback><Suspense fallback={<LoadingSkeleton/>}>{children}</Suspense></CardErrorBoundary>` |
| `LoadingSkeleton()`（私有） | card-wrapper.tsx:44-50 | `GlassCard` + `LoadingBlock`（`minHeight={120}`） |
| `ErrorState()`（私有） | card-wrapper.tsx:52-58 | `GlassCard` + 硬编码中文「加载失败」（:55） |

**备注**：错误兜底文案「加载失败」为硬编码中文、未走 i18n；全仓库未检索到对 `CardWrapper` 的 import（仅定义与导出），各卡片均直接用 `useCardData` 的 `isLoading`/`error` 自行渲染占位。

## `src/components/cards/base/index.ts`
**职责**：`base/` 目录的桶文件，聚合导出包装组件与数据 Hook。
**导出**：`export * from './card-wrapper'`（index.ts:1）、`export * from './use-card-data'`（index.ts:2）。
**主要依赖**：`./card-wrapper`、`./use-card-data`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| 再导出 | index.ts:1 | `CardWrapper` |
| 再导出 | index.ts:2 | `useCardData` |

**备注**：实际卡片均直接深路径导入（如 `../base/use-card-data`），本桶文件当前无引用方。

## `src/components/cards/card-container.tsx`
**职责**：仪表盘卡片网格容器。负责卡片排序与默认坐标分配、dnd-kit 拖拽与网格吸附、落点高亮与碰撞检测、底部自动滚动/容器高度扩展、长按进入编辑模式、右键菜单、删除卡片、拖拽后布局持久化，以及按 `card.type` 从注册表取出组件并渲染（含拖拽浮层）。
**导出**：`CONTAINER_HEIGHT`（常量）、`CardContainer()`（组件）。
**主要依赖**：`react`、`react-dom`（`createPortal`）、`react-i18next`、`@dnd-kit/core`（`DndContext`/`DragOverlay`/`PointerSensor`/`useSensor(s)`/`useDraggable`）、`@/components/ui/glass`（`GlassProgressCircle`）、`morphicons/react`（`MorphIcon`）、`lucide`（`MapPin`/`TriangleAlert`）、`@/types/dashboard`（`CardConfig`）、`@/utils/dashboardConfig`（`updateCardLayout`）、`@/hooks/useLongPressDrag`、`@/utils/logger`、`./registry/loader`（`loadAllCards`）、`./card-context-menu`、`@/components/ui/confirm-dialog`（`confirmDialog`）。

### 内部结构（行号区间）

| 区间 | 结构 / 职责 |
| --- | --- |
| 1-24 | import 声明 |
| 26-42 | 网格常量与背景：`GRID_SIZE = 100`（:27）；`generateGridSVG(isDragging)` 生成虚线网格 data-URI（拖拽时透明度 0.3，否则 0.15，:30-42） |
| 43 | `export const CONTAINER_HEIGHT = 2000`（容器可用高度，被 `src/pages/account.tsx:16` 引用） |
| 45-51 | `FreeDragCardProps`（接口，未导出）：`card`/`roleId`/`isEditMode`/`onRemoveCard`/`onUpdatePosition` |
| 53-445 | `FreeDragCard()`（私有组件）：单张可拖拽卡片外壳，见下方细分行 |
| 447-456 | `CardContainerProps`（接口，未导出）：`roleId`、`tabId?`、`cards: CardConfig[]`、`onRemoveCard`、`isEditMode?`、`onEnterEditMode?`、`onExitEditMode?`、`highlightCardId?` |
| 458-957 | `CardContainer()`（导出组件）：容器主体，见下方细分行 |

### `FreeDragCard` 细分（53-445）

| 行号 | 逻辑 |
| --- | --- |
| 71 | `useTranslation()` |
| 73-78 | `useDraggable({ id: card.id, disabled: !isEditMode })`，解构 `setNodeRef/attributes/listeners/transform` |
| 81-91 | 接入 `useLongPressDrag`（`longPressProgress`、`handlePointerDown/Up/Leave`、`triggerDragStart`） |
| 94-99 | `isDraggingRef` 同步最新拖拽状态 |
| 102-132 | **编辑模式退出判定**：编辑态下 pointerup 且未拖拽 → 延时 50ms 检查 `isDraggingRef`，仍未拖拽则 `onExitEditMode()` |
| 135-147 | 进入编辑模式且用户仍按住时，补触发 `triggerDragStart(listeners.onPointerDown)`（长按直接进入拖拽） |
| 149-159 | **右键菜单状态**：`contextMenu {x,y}` + `handleContextMenu`（`preventDefault`/`stopPropagation` 后记录坐标） |
| 161-283 | **右键菜单项构建** `getContextMenuItems()`：`character_list` → view-list/change-role（:164-186）；`attendance` → settings（:187-198）；`achievement` → select-medals/change-role（:199-221）；`account_info`/`account_progress`/`domain_info`/`spaceship` → change-role（:222-238），其中 `domain_info` 追加 view-list/switch-domain（:239-262）；末尾统一追加危险项「删除」（:265-280），点击经 `confirmDialog` 确认后 `onRemoveCard(card.id)` |
| 285-287 | 网格坐标 → 像素坐标（`x*GRID_SIZE+1`、`y*GRID_SIZE+1`，留 1px 间隙） |
| 290-303 | 样式计算：`position:absolute`、宽 `(w??3)*GRID_SIZE-2`、高 `(h??2)*GRID_SIZE-2`（**尺寸读取/默认 3×2 在 :294-295**）、拖拽 `transform`、编辑态 `cursor:grab`、拖拽中原卡片 `opacity:0 + visibility:hidden`（防残影） |
| 305-342 | 卡片外壳 JSX：`data-card-id`、`highlightCardId` 命中时加 `card-flash-highlight`（:311）；**指针事件路由**：编辑态交由 dnd-kit `listeners`（:317-320、:331-335），非编辑态走长按检测（:322-324、:337-341） |
| 344-362 | 长按进度环（`GlassProgressCircle` + 百分比文字），仅非编辑态且进度 > 0 时显示 |
| 365-371 | 拖拽中在卡片上方显示 `Row/Col` 网格坐标角标 |
| 374-405 | **删除按钮**（编辑态且非拖拽中，卡片内右上角删除图标，避免被卡片外壳裁切）：`onClick` → `onRemoveCard`，并在 pointer 事件上 `stopPropagation` 防止误触父级 |
| 407-432 | **卡片渲染**：`loadAllCards()` → `cardRegistry.get(card.type)?.component`（:410-411）；未注册类型渲染 `Unknown card type` 错误占位（:413-421）；命中则以 `roleId/cardId/settings/isEditMode` 实例化组件（:424-430） |
| 435-442 | 渲染 `<CardContextMenu>`（坐标、菜单项、`onClose`） |

### `CardContainer` 细分（458-957）

| 行号 | 逻辑 |
| --- | --- |
| 469-481 | 状态：`sortedCards`、`activeId`、`isDragging`、`mousePosition`、`extraHeight`、`draggedViaLongPress`、`highlightGrid{x,y,w,h}`、`hasCollision` |
| 484-505 | 排序与**默认坐标分配**：按 `position` 升序；缺 `x/y` 的卡片按每行 3 张、行高 2 网格排布，`w ?? 3`、`h ?? 2`（:491-499）；依赖 `cards.length` 触发（:505） |
| 508-520 | `containerHeight` 计算：最大 `((y+h) * GRID_SIZE)` + 100 基础留白 + `extraHeight`（空列表返回 100） |
| 523-529 | dnd-kit 传感器：`PointerSensor`，`activationConstraint.distance = 5` |
| 532-534 | `snapToGrid(value)` = 四舍五入到 `GRID_SIZE` 倍数 |
| 537-541 | `handleDragStart`：记录 `activeId`、置 `isDragging` |
| 544-562 | 拖拽期间监听 `mousemove` + `pointermove` 更新鼠标坐标（window 级） |
| 565-585 | 鼠标距底边 < 150px 时按 50ms 定时器自动向下滚动（越近越快） |
| 588-684 | `handleDragMove`：底部 200px 内滚动并 `setExtraHeight` 扩容（:611-617）；由 `delta` 换算目标网格并做**矩形碰撞检测**（:619-657）；更新 `highlightGrid`/`hasCollision`（:657-683） |
| 687-780 | `handleDragEnd`：清理状态（`activeId/isDragging/extraHeight/highlightGrid/hasCollision`，:698-702）；长按进入编辑的拖拽结束后退出编辑模式（:706-713）；无 `delta` 提前返回（:716-719）；吸附换算回网格坐标并 `Math.max(0,…)` 夹取（:728-733）；**碰撞则回退、不落盘**（:739-763）；否则本地更新 `sortedCards`（:766-770）并调用 `updateCardLayout(tabId ?? roleId, card.id, {x,y,w,h})` **持久化**（:773-779） |
| 783-785 | `activeCard`：为 `DragOverlay` 找到被拖拽卡片 |
| 788-794 | 渲染状态调试日志 effect |
| 796-823 | **空状态**：`cards.length === 0` 时渲染 `dashboard.no_cards` 引导占位并提前 return |
| 825-831 | `<DndContext sensors onDragStart onDragMove onDragEnd>` |
| 832-839 | 容器背景：编辑态或拖拽中显示 `generateGridSVG` 网格 |
| 841-866 | **落点高亮格**：碰撞时红色（`hasCollision`），否则主色；中心显示 `(x, y) WxH` 与 `MapPin`/`TriangleAlert` 图标，`data-testid="highlight-grid"` |
| 867-891 | 行列坐标标签（行号按 `containerHeight/GRID_SIZE` 数量，列号固定 20 列） |
| 893-917 | **卡片列表渲染**：`sortedCards.map` 输出 `FreeDragCard`，传入 `isDragging={activeId===card.id}`、`showGridCoords`、`highlightCardId`、`onLongPress`（进入编辑并标记 `draggedViaLongPress`，:910-913）、`onExitEditMode`；`onUpdatePosition` 传空实现（:906） |
| 920-954 | **拖拽浮层**：`createPortal(..., document.body)` 包裹 `<DragOverlay dropAnimation={null}>`，浮层内再次按 `activeCard.type` 查注册表渲染组件（:931-949），带 `opacity-80 scale-105 rotate-2` 与卡片尺寸（:924-929） |
| 955-957 | `</DndContext>` 收尾 |

**备注**：
- **编辑模式**：由父级通过 `isEditMode`/`onEnterEditMode`/`onExitEditMode` 控制；进入 = 长按卡片（`onLongPress` → :910-913），退出 = 编辑态下点按未拖拽（:113-130）或长按触发的拖拽结束（:706-713）。编辑态下才挂载 dnd-kit `attributes/listeners`（:313）与删除按钮（:374）。
- **拖拽**：网格吸附拖拽（非自由像素拖拽），1 格 = 100px；拖拽中原卡片隐藏，真实视觉由 `DragOverlay` portal 提供（:921-954）。
- **右键菜单**：状态与菜单项在 `FreeDragCard` 内，渲染走 `CardContextMenu`，删除项带二次确认。除上表按类型分支外，另有两组：`system_resource` → `system-resource-settings`（打开设置弹窗）/ 派发 `manualRefresh`（立即刷新）；`todo` → `todo-edit`/`todo-open-page`/`todo-rename`/`todo-duplicate`/`todo-sort`/`todo-hide-completed`/`todo-clear-completed`/`todo-color-icon`/`todo-delete-list`，全部经 `cardAction` 事件由卡片自身处理。
- **尺寸调整**：容器内**没有交互式 resize 手柄**；宽高完全来自 `CardConfig.w/h`（默认 `3×2`），读取与兜底见 :294-295、:497-499、:636-637、:735-736、:927-928；拖拽只改变 `x/y`，`w/h` 仅在 `dragEnd` 的 `updateCardLayout` 中原样回写（:774-779）。
- **事件**：文件内无 Tauri `invoke` / `emit` / `listen`；对外通信使用 `window.dispatchEvent(new CustomEvent("cardAction", { detail: { cardId, action } }))`，共 8 处（:169、:180、:192、:204、:215、:232、:244、:255），action 取值 `view-list` / `change-role` / `settings` / `select-medals` / `switch-domain`；监听方为各卡片自身的 `window.addEventListener("cardAction", ...)`。另有拖拽期的 `window.addEventListener("mousemove"/"pointermove")`（:556-557）。
- 持久化统一走 `updateCardLayout(tabId, cardId, layout)`（`src/utils/dashboardConfig.ts:149-164`：改 `x/y/w/h` 后 `saveTabCards`），本文件不直接触碰存储/IPC。
- 已知冗余：`FreeDragCardProps.onUpdatePosition`（:50）虽为必填 Props（形参未解构），但在 `FreeDragCard` 体内从未被调用，容器传入空实现（:906）。
- 调试日志较密集（`logger.info` 分布于 :103-146、:540、:659-675、:688-703、:789-794）。

## `src/components/cards/card-context-menu.tsx`
**职责**：通用右键菜单组件，以 portal 挂到 `document.body`，支持点击外部 / Esc / 滚动自动关闭，菜单项点击后回调并关闭。
**导出**：`ContextMenuItem`（interface）、`CardContextMenu()`（组件）。
**主要依赖**：`react`（`useEffect`/`useRef`）、`react-dom`（`createPortal`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ContextMenuItem` | card-context-menu.tsx:4-9 | 字段：`key: string`（React key）；`label: string` 显示文案；`danger?: boolean` 危险项样式（红色）；`onPress: () => void` 点击回调 |
| `CardContextMenuProps`（接口，未导出） | card-context-menu.tsx:11-16 | `x: number`、`y: number` 菜单坐标；`items: ContextMenuItem[]`；`onClose: () => void` |
| `CardContextMenu()` | card-context-menu.tsx:18-72 | Portal 固定定位菜单；布局后根据实际宽高夹紧至视口内，过高时滚动；菜单项背景内缩并使用圆角 |
| ─ 关闭逻辑 effect | card-context-menu.tsx:26-44 | `document mousedown` 点击菜单外关闭（:27-31）；`document keydown` Esc 关闭（:32-34）；`window scroll`（capture）关闭（:35）；清理时逐一移除（:39-43） |
| ─ 菜单项点击 | card-context-menu.tsx:61-64 | `item.onPress()` 后立即 `onClose()` |
| ─ portal | card-context-menu.tsx:46-71 | `createPortal(..., document.body)` |

**备注**：无 IPC、无全局事件；纯展示 + DOM 事件组件。

## `src/components/cards/_template/index.tsx`
**职责**：新卡片开发模板（默认导出组件），演示 `BaseCardProps` 接入、`useCardData` 数据加载的三态渲染、`settings` 读取、编辑模式差异显示，并以注释形式给出 `startup` 导出约定。
**导出**：`export default TemplateCard`（index.tsx:38）。
**主要依赖**：`../registry/types`（`BaseCardProps`）、`../base/use-card-data`（`useCardData`）、`react-i18next`（`useTranslation`）、`@/components/ui/glass`（`GlassCard`/`GlassProgressCircle`）、`@/utils/logger`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `startup` 示例注释 | _template/index.tsx:7-24 | 说明可选 `startup(task)` 导出的用法：`CardStartupService.addTask` 登记 → `runAll()` 匹配 `cardType` 调用 → `subscribe` 监听状态（仅注释，未实现） |
| 开发步骤注释 | _template/index.tsx:26-37 | 复制目录、重命名 meta.json、改 meta、实现组件、可选导出 startup |
| `TemplateCard`（default） | _template/index.tsx:38-115 | 解构 `roleId/cardId/settings/isEditMode` |
| ─ 数据加载 | _template/index.tsx:47-63 | `useCardData({ fetchData: 模拟 500ms Promise, lazy: false })`，`logger.info` 打印 roleId |
| ─ settings 读取 | _template/index.tsx:66 | `settings.customKey \|\| "default value"` |
| ─ loading 分支 | _template/index.tsx:69-80 | `GlassCard` + 不确定进度的 `GlassProgressCircle` |
| ─ error 分支 | _template/index.tsx:83-91 | `GlassCard` + `t("common.load_error") \|\| "加载失败"` |
| ─ 正常渲染 | _template/index.tsx:94-114 | 标题 `t("template_card.title")`、展示 roleId/cardId/customSetting（:101-105）、非编辑态追加交互提示 `t("template_card.hint")`（:107-111） |

**备注**：
- 模板不会被注册：loader 对 `_` 前缀目录显式跳过（loader.ts:37、:63-65），其 `meta.json` 与 `locales/zh.json` 均不进入注册表。
- `t("template_card.title") || "Template Card"` 形式的兜底在 i18next 下基本无效——缺失键时 `t()` 返回键字符串本身（truthy），`||` 分支不会命中；且模板键使用 `template_card.` 前缀，与 loader 注册的 `card` 命名空间（`t("card:key")`）不一致。
- 模板自带的 `locales/zh.json` 键为 `title`/`description`，若目录不以 `_` 开头会被平铺注册为 `card:title`/`card:description`。

## `src/components/cards/_template/_template.meta.json`
**职责**：模板卡片的元数据样例，同时是所有 `*.meta.json` 的字段契约参考。
**导出**：（JSON 默认导出对象，经 `import.meta.glob(..., import: 'default')` 消费）
**主要依赖**：由 `registry/loader.ts:15-18` 加载。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `id` | _template.meta.json:2 | `"_template"` —— 全局唯一卡片类型标识，注册表 Map 的键 |
| `name` | _template.meta.json:3-6 | `{zh: "卡片模板", en: "Card Template"}` 多语言名称 |
| `description` | _template.meta.json:7-10 | `{zh, en}` 多语言描述 |
| `icon` | _template.meta.json:11 | `"file"` —— 图标类名 |
| `defaultSize` | _template.meta.json:12 | `{ w: 3, h: 2 }` 默认网格尺寸 |
| `version` | _template.meta.json:13 | `"1.0.0"` |
| `allowMultiple` | _template.meta.json:14 | `true` —— 允许多实例 |
| `tags` | _template.meta.json:15-18 | 两个标签：`{id:"template", label:{zh:"模板", en:"Template"}}`、`{id:"development", label:{zh:"开发", en:"Development"}}` |

**meta.json 完整字段契约**：

| 字段 | 类型 | 必填 | 含义 / 缺失后果 |
| --- | --- | --- | --- |
| `id` | `string` | 是 | 卡片类型唯一标识与注册键；缺失会导致 `cards.set(undefined, …)` |
| `name` | `Record<string,string>` | 是 | 多语言名称（`zh`/`en`），添加卡片列表展示用 |
| `description` | `Record<string,string>` | 是 | 多语言描述 |
| `icon` | `string` | 是 | 图标名称或图标类名 |
| `defaultSize` | `{ w: number, h: number }` | 是 | 新增卡片时的默认网格占位 |
| `version` | `string` | 是 | 卡片版本号（当前无消费方做校验） |
| `allowMultiple` | `boolean` | 否（默认 false） | 是否允许多实例 |
| `tags` | `CardTag[]`（`{id, label{lang}}`） | 否 | 搜索/筛选标签 |

**备注**：
- **加载失败行为**：loader 无运行时 schema 校验，也无 try/catch——
  1. JSON 语法错误 → Vite `eager: true` 在构建/模块加载期抛错，应用无法启动；
  2. 有 meta 但缺 `index.tsx` → 静默跳过该卡片（loader.ts:70、:82）；
  3. 目录名以 `_` 开头 → 跳过（loader.ts:37、:63-65）；
  4. 路径不匹配正则 → `continue`（loader.ts:33、:59）；
  5. 字段缺失（非 `id`）→ 无告警照常注册，由 UI 层暴露问题。

## `src/components/cards/_template/README.md`
**职责**：卡片开发流程说明文档（模板目录的一部分），指导复制模板、重命名元数据、实现组件、配置本地化与调试。
**导出**：（Markdown 文档，无代码导出）
**主要依赖**：无。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| 「快速开始」 | README.md:3-36 | 6 步：复制目录（`cp -r _template my-new-card`，:7-9）、重命名 `meta.json`（:13-15）、编辑元数据（:17-21）、实现组件（:23-26）、创建 `locales/zh.json`+`en.json`（:28-32）、重启 dev server 验证（:34-36） |
| 「文件说明」 | README.md:38-45 | `_template.meta.json`、`index.tsx`、`locales/`、`README.md` 各自作用 |
| 「本地化翻译」 | README.md:47-68 | 翻译放卡片自己的 `locales/` 而非全局 `translation.json`；键注册到 i18n `card` 命名空间，用 `t("card:key")` 访问（示例 :52-66） |
| 「注意事项」 | README.md:70-75 | `_` 开头目录不注册；`id` 全局唯一；组件必须 `export default`；Props 必须符合 `BaseCardProps` |
| 「参考资源」 | README.md:77-81 | 指向 `docs/card_development.md`、`registry/types.ts`、`character-list/` 示例 |

**备注**：文档描述与实现一致（`_` 前缀跳过、`card` 命名空间注册均对应 loader.ts:37/54/63）。

## `src/components/cards/_template/locales/zh.json`
**职责**：模板卡片的中文翻译资源样例（键平铺，无命名空间包裹）。
**导出**：（JSON 默认导出 `Record<string, string>`）
**主要依赖**：由 `registry/loader.ts:21-24` 扫描 `../*/locales/*.json` 加载。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `title` | locales/zh.json:2 | `"模板卡片"` |
| `description` | locales/zh.json:3 | `"这是一个卡片模板"` |

**备注**：因目录名 `_template` 以 `_` 开头，本文件实际会被 `buildCardLocales()`（loader.ts:37）跳过，仅作为格式示例；非 `_` 目录下的同结构文件会被合并进 i18n `card` 命名空间，以 `t("card:title")` 访问。

## 事件 / IPC 汇总（本组 12 个文件）
- **Tauri `invoke("xxx")`**：无。本组文件不含任何 `@tauri-apps/api` 调用；落盘统一经 `updateCardLayout()`（`src/utils/dashboardConfig.ts:149`）间接完成。
- **Tauri `emit` / `listen`**：无。
- **`window.dispatchEvent(new CustomEvent("cardAction", { detail: { cardId, action } }))`**（card-container.tsx）：action = `view-list`（:169、:244）、`change-role`（:180、:215、:232）、`settings`（:192）、`select-medals`（:204）、`switch-domain`（:255）。监听方位于各卡片组件（如 `character-list/index.tsx:187`、`achievement/index.tsx:223`、`domain-info/index.tsx:183`、`spaceship/index.tsx:252`、`account-info/index.tsx:142`、`account-progress/index.tsx:121`、`attendance/index.tsx:259`）。
- **`cardAction` 新增动作（2026-10）**：`system-resource-settings`（system-resource 卡片打开设置弹窗）、`todo-edit`/`todo-open-page`/`todo-rename`/`todo-duplicate`/`todo-sort`/`todo-hide-completed`/`todo-clear-completed`/`todo-color-icon`/`todo-delete-list`（todo 卡片处理）；另有 `manualRefresh` 全局事件用于系统资源卡片的「立即刷新」。详见 [cards_system_todo.md](cards_system_todo.md)。
- **卡片改尺寸事件（2026-10）**：`CardContainer` 监听 `window` 事件 `cardResize`（detail `{cardId,w,h}`），更新本地 `sortedCards` 并调用 `updateCardLayout(tabId ?? roleId, …)` 落盘，随后广播 `cardLayoutChanged`（`pages/dashboard.tsx` 监听后重新拉取当前标签页配置）。卡片组件自身不持有 `tabId`，因此用事件解耦。
- **DOM 监听**：card-context-menu.tsx:36-38（`mousedown`/`keydown`/`scroll`）、card-container.tsx:556-557（`mousemove`/`pointermove`）。

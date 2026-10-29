# 对话框与交互组件 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 覆盖 `src/components/` 下 15 个对话框/交互类文件。

## `src/components/custom-modal.tsx`
**职责**：应用级 Modal 兼容层，把自研 `GlassModal`（液态玻璃）包装成语义化的头部/主体/底部结构，并保留向后兼容的 `size` 语义。全项目业务弹窗（账户切换、添加卡片、选人、标签页编辑等）均基于此层构建。
**导出**：`CustomModal`、`CustomModalHeader`、`CustomModalBody`、`CustomModalFooter`
**主要依赖**：`react`（`forwardRef`）、`@/components/ui/modal`（`GlassModal` 复合组件）、`@/components/ui/app-icon`（`CloseIcon`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ModalSize` | custom-modal.tsx:5 | 类型别名 `"xs" \| "sm" \| "md" \| "lg" \| "full" \| "cover"`，声明后未被任何代码引用（见备注） |
| `SIZE_CONFIG` | custom-modal.tsx:11 | size → `{ size, widthClass }` 映射表。键为 `sm/md/lg/xl/2xl/3xl/4xl/5xl`，值分别映射到 `GlassModal` 的 `xs~2xl` 宽度档；`xl` 用于角色详情/选人、`2xl` 用于账户切换；`3xl/4xl/5xl` 均降级为 `2xl`；所有档位 `widthClass` 都是 `w-full` |
| `CustomModalProps` | custom-modal.tsx:25 | 接口定义，见下行 props 说明 |
| `CustomModal` | custom-modal.tsx:36 | 弹窗容器。关键 props：`isOpen`（布尔，受控开关）、`onClose`（关闭回调，`GlassModal` 的 `onOpenChange` 收到 `false` 时触发）、`children`（内容，须自行组合 Header/Body/Footer）、`size`（`keyof SIZE_CONFIG`，默认 `"md"`，非法值回退 `md`）、`disableBackdropClick`（默认 `false`；为 `true` 时禁止点击遮罩关闭）、`height`（`"auto" \| "fixed"`，默认 `auto`；`fixed` 时对话框固定 `90vh`，否则 `max-h-90vh`）。渲染结构：`GlassModal > Backdrop(z-[100]) > Container(placement="center", scroll="inside") > Dialog`，Dialog 为 `rounded-2xl !p-0` 纵向 flex 列 |
| `ModalHeaderProps` | custom-modal.tsx:79 | 头部 props：`children`、`onClose?`、`rightContent?`、`className?` |
| `CustomModalHeader` | custom-modal.tsx:86 | 底部分隔线的标题栏（`px-6 py-3.5 border-b`）。左侧为 `text-lg font-semibold` 标题（`children`），右侧容器渲染 `rightContent`；传入 `onClose` 时在最右侧绝对定位一个 `aria-label="Close"` 的关闭按钮（18px `CloseIcon`），可与 `rightContent` 并存 |
| `ModalBodyProps` | custom-modal.tsx:111 | 主体 props：`children`、`className?`、`onScroll?` |
| `CustomModalBody` | custom-modal.tsx:117 | 可滚动内容区（`flex-1 min-h-0 px-6 py-4 overflow-y-auto`）。用 `forwardRef<HTMLDivElement>` 实现，支持 ref 透传与滚动事件；`displayName` 在 custom-modal.tsx:130 置为 `"CustomModalBody"` |
| `ModalFooterProps` | custom-modal.tsx:132 | 底栏 props：`children`、`className?` |
| `CustomModalFooter` | custom-modal.tsx:137 | 按钮栏（`flex justify-end gap-2 px-6 py-4 border-t`），不自带按钮，由调用方塞入 `GlassButton` |

**备注**：
- 层级：Backdrop 固定 `z-[100]`；Dialog 尺寸/滚动由 `GlassModal.Container` 的 `size` + `scroll="inside"` 控制。
- 无 `invoke` / `listen` / i18n，纯展示层。
- 异常：`ModalSize`（line 5）声明了 `xs/full/cover` 但 `SIZE_CONFIG` 无这些键，且该类型未被使用——外部传 `size="xs"` 或 `"full"` 会静默回退到 `md`。

## `src/components/close-confirm-dialog.tsx`
**职责**：关闭窗口二次确认对话框，让用户选择「最小化到托盘」或「关闭程序」，可勾选记住选择并写入配置。
**导出**：`CloseConfirmDialog`
**主要依赖**：`react`（`useState`）、`react-i18next`（`useTranslation`）、`@/components/ui/glass`（`GlassAlertDialog`、`GlassButton`）、`@/utils/configService`（`setConfig`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CloseConfirmDialogProps` | close-confirm-dialog.tsx:6 | 接口：`isOpen`（开关）、`onOpenChange(open)`（受控状态回写）、`onConfirm(action)`（`action` 为 `"close" \| "minimize_to_tray"`） |
| `CloseConfirmDialog` | close-confirm-dialog.tsx:12 | 组件主体。内部状态 `rememberChoice`（close-confirm-dialog.tsx:14，布尔，「记住此选择」复选框，每次动作后重置） |
| `handleAction` | close-confirm-dialog.tsx:16 | `async (action)`：若 `rememberChoice` 则先 `setConfig("close_action", action)`（close-confirm-dialog.tsx:18），随后 `onConfirm(action)` → `onOpenChange(false)` → 重置复选框 |
| 布局常量/结构 | close-confirm-dialog.tsx:26-87 | `GlassAlertDialog > Backdrop > Container > Dialog`（`sm:max-w-[400px]`）+ `CloseTrigger` + `Header`（warning 图标 + 标题）+ `Body`（提示文案）+ `Footer`（两个 `GlassButton` + 记忆复选框） |

**备注**：
- 无 `invoke` / `listen`。
- i18n：未使用 i18next key，全部走 `i18n.language === "zh"` 三元硬编码文案（close-confirm-dialog.tsx:34、39-41、58、70、80）。
- 按钮：`minimize_to_tray`（`variant="primary"`，圆形图标）/ `close`（`variant="danger"`，叉号图标），均为 `flex-1`。
- 由 `CustomTitlebar` 渲染（custom-titlebar.tsx:283-287）。

## `src/components/account-switch-modal.tsx`
**职责**：账户切换弹窗。支持搜索过滤、当前账户置顶高亮，点击卡片切换全局选中账户并广播变更事件。
**导出**：默认导出 `AccountSwitchModal`
**主要依赖**：`react`（`useState/useEffect/useMemo`）、`react-i18next`、`@/components/ui/glass`（`GlassCard`、`GlassInput`）、`@/components/custom-modal`（`CustomModal`、`CustomModalHeader`、`CustomModalBody`）、`@/components/icons`（`SearchIcon`）、`@/components/ui/account-avatar`（`AccountAvatar`）、`@/components/ui/empty-state`（`EmptyState`、`EmptyStateUserIcon`）、`@/components/ui/loading-block`（`SkeletonList`）、`@/types`（`resolveServerLabel`）、`@/utils/accountService`（`getAccounts`、`setSelectedAccount`、类型 `Account`）、`@/utils/logger`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AccountSwitchModalProps` | account-switch-modal.tsx:21 | 接口：`isOpen`、`onClose`、`currentAccountId?`（当前选中账户 id，用于高亮与置顶） |
| `AccountSwitchModal` | account-switch-modal.tsx:27 | 默认导出组件，弹窗 `size="2xl"`（account-switch-modal.tsx:102） |
| 局部状态 | account-switch-modal.tsx:33-37 | `accounts`（`Account[]`）、`isLoading`、`searchQuery`、`switchingId`（正在切换中的账户 id，防重复点击）、`expectedAccountCount`（骨架屏行数，默认 3） |
| `useEffect`（打开加载 + 事件） | account-switch-modal.tsx:39-48 | `isOpen` 为真时调用 `loadAccounts()`；同时监听 `window` 的 `manualRefresh`（`CustomEvent`），用 `detail.count`（钳制到 3~5）更新骨架屏行数，清理时移除 |
| `loadAccounts` | account-switch-modal.tsx:50 | `async`：`await getAccounts()` → `setAccounts(data ?? [])`，异常写 `logger.error(..., "AccountSwitch")` |
| `filteredAccounts` | account-switch-modal.tsx:62 | `useMemo`。按 `searchQuery` 匹配 `nickname/id/server/userId`（忽略大小写）；排序时 `currentAccountId` 命中项排最前，其余按 `nickname.localeCompare` |
| `handleSwitchAccount` | account-switch-modal.tsx:82 | `async (accountId)`：id 等于当前值直接 `onClose()`；否则 `setSwitchingId` → `apiSetSelectedAccount(accountId)`，成功则 `window.dispatchEvent(new CustomEvent("accountChanged"))` 并 `onClose()`，`finally` 清除 `switchingId` |
| 渲染块 | account-switch-modal.tsx:101-195 | 搜索框（`GlassInput type="search"`，`startContent` 图标）→ 列表区（`max-h-[400px]` 纵向滚动；`isLoading` 显示 `SkeletonList count=expectedAccountCount rowHeight=68`，空结果显示 `EmptyState`，否则逐条渲染 `GlassCard`）→ 底部总数统计 |

**备注**：
- 无 `invoke` / `listen`；本组件内的账户读写全部经 `@/utils/accountService` 封装。
- 事件：`listen`/监听 `window` `manualRefresh`（account-switch-modal.tsx:45）；派发 `window` `accountChanged`（account-switch-modal.tsx:91）。
- i18n key：`account_switch.title`、`account_switch.search_placeholder`、`account_switch.no_accounts_found`、`account_switch.accounts_total`（带 `count` 插值）、`settings.account.skland_account`；未读 i18n 而用 `t(...)` + 硬编码的 `ACTIVE` 徽章（account-switch-modal.tsx:161）。
- 卡片选中态用 `border-2 border-primary bg-primary-50 dark:bg-primary-900/20`，切换中显示 20px 旋转圈（account-switch-modal.tsx:176-178）。

## `src/components/add-card-modal.tsx`
**职责**：仪表盘「添加卡片」弹窗。从卡片注册表读取可选卡片，支持名称搜索 + 标签多选过滤，选中后回调 `onAdd(cardType)`。
**导出**：`AddCardModal`
**主要依赖**：`react`（`useMemo/useState`）、`react-i18next`、`@/components/ui/glass`（`GlassButton`、`GlassCard`、`GlassInput`）、`./custom-modal`（`CustomModal`、`CustomModalHeader`、`CustomModalBody`、`CustomModalFooter`）、`./cards/registry/loader`（`getAvailableCards`）、`@/components/icons`（`CardIcon`、`SearchIcon`）、`@/components/ui/app-icon`（`ChevronRightIcon`）、`./cards/registry/types`（`CardTag`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AddCardModalProps` | add-card-modal.tsx:15 | 接口：`isOpen`、`onClose`、`onAdd(cardType: string)`（确认回调）、`existingTypes: string[]`（已存在的卡片类型，用于去重过滤） |
| `AddCardModal` | add-card-modal.tsx:22 | 组件主体，弹窗 `size="md"`（add-card-modal.tsx:108） |
| 局部状态 | add-card-modal.tsx:29-32 | `selectedType`（选中的卡片 id，`string \| null`）、`searchText`、`selectedTagIds`（`Set<string>`）、`showFilters`（筛选区展开） |
| `availableCards` | add-card-modal.tsx:35 | `getAvailableCards()`，每次渲染直接调用（未 memo） |
| `allTags` | add-card-modal.tsx:38 | `useMemo([availableCards])`：遍历所有卡片的 `tags`，按 `tag.id` 去重收集出全量标签数组 |
| `getTagLabel` | add-card-modal.tsx:50 | `(tag) => tag.label[i18n.language] \|\| tag.label.en \|\| tag.id`，多语言标签取值 |
| `toggleTag` | add-card-modal.tsx:53 | `(tagId)`：在 `selectedTagIds` 中增删该标签 |
| `displayCards` | add-card-modal.tsx:66 | `useMemo([availableCards, existingTypes, searchText, selectedTagIds, i18n.language])`。过滤规则：①`allowMultiple === false` 且已存在于 `existingTypes` 的卡片剔除；②`searchText` 匹配本地化名称（忽略大小写）；③有选中标签时按「交集非空」（OR 语义）保留 |
| `handleConfirm` | add-card-modal.tsx:91 | 有 `selectedType` 才 `onAdd(selectedType)`，随后清空选择并 `onClose()` |
| `handleClose` | add-card-modal.tsx:99 | 关闭时重置 `selectedType / searchText / selectedTagIds / showFilters`，再 `onClose()` |
| 渲染块 | add-card-modal.tsx:107-233 | 搜索框 → 筛选开关按钮（带已选标签计数角标，`showFilters` 时平铺标签胶囊）→ 卡片列表（空结果显示 `common.no_results_found`；每张卡片为 `GlassCard isPressable`，展示 `CardIcon`、本地化名称/描述、标签 chips）→ `CustomModalFooter`（`Cancel` + `Confirm`，未选中时 `isDisabled`） |

**备注**：
- 无 `invoke` / `listen` / portal。
- i18n key：`dashboard.add_card.title`、`common.search`、`common.show_filters`、`common.hide_filters`、`common.no_results_found`、`common.cancel`、`common.confirm`（均带 `|| "英文兜底"`）。
- 标签选择为多选（可同时选多个 tag，卡片满足任一即可）；卡片选择为单选。

## `src/components/app-info-drawer.tsx`
**职责**：右侧抽屉式消息中心。展示 `messageStore` 中的全部消息，可一键全部已读，打开时自动把 `info` 类型未读消息标记为已读。
**导出**：`AppInfoDrawer`
**主要依赖**：`react`（`useState/useEffect/useCallback`）、`react-i18next`、`react-dom`（`createPortal`）、`@/utils/messageStore`（`getMessages`、`subscribeMessages`、`markAllRead`、`markRead`）、`@/components/message-card`（`MessageCard`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AppInfoDrawerProps` | app-info-drawer.tsx:7 | 接口：`isOpen`、`onClose` |
| `AppInfoDrawer` | app-info-drawer.tsx:12 | 组件主体。`msgs` 初始值 `getMessages()`（app-info-drawer.tsx:14），`unreadCount` 为 `!m.read` 计数（app-info-drawer.tsx:15） |
| 订阅 effect | app-info-drawer.tsx:17-19 | `subscribeMessages(() => setMsgs(getMessages()))`，卸载时退订 |
| 自动已读 effect | app-info-drawer.tsx:21-27 | 打开时遍历消息，对 `!read && type === "info"` 的条目调用 `markRead(m.id)` |
| `handleBackdropClick` | app-info-drawer.tsx:29 | `useCallback` 包裹的 `onClose`，绑定在全屏遮罩上 |
| 渲染/portal | app-info-drawer.tsx:33-70 | `isOpen` 为 `false` 时返回 `null`；`createPortal(..., document.body)`。遮罩 `fixed inset-0 z-[200]`，抽屉本体 `fixed inset-y-0 right-0 z-[210] w-[380px] max-w-[85vw] rounded-l-2xl`，并 `stopPropagation` 防止点击抽屉关闭 |
| 内容块 | app-info-drawer.tsx:42-66 | 顶部「全部已读」按钮（仅 `unreadCount > 0` 时显示）→ 消息列表（空态为铃铛 SVG + 文案，否则 `msgs.map(m => <MessageCard key={m.id} msg={m} />)`） |

**备注**：
- 无 `invoke` / `listen`（数据同步靠 `subscribeMessages` 回调，非 Tauri 事件）。
- i18n key：`messages.mark_all_read`、`messages.empty`（均带 `defaultValue` 兜底）。
- 由 `CustomTitlebar` 的铃铛按钮控制开关（custom-titlebar.tsx:282）。

## `src/components/custom-titlebar.tsx`
**职责**：自定义标题栏——包含品牌区、数据/游戏视图切换、通知铃铛与消息浮层、窗口最小化/最大化/关闭按钮，并挂载消息抽屉与关闭确认框。
**导出**：`CustomTitlebar`
**主要依赖**：`react`（`useState/useEffect/useRef`）、`react-dom`（`createPortal`）、`react-i18next`、`@tauri-apps/api/core`（`invoke`）、`@tauri-apps/api/window`（`getCurrentWindow`）、`@tauri-apps/api/event`（`listen`、`UnlistenFn`）、`@/components/ui/app-icon`（`MinimizeIcon`、`MaximizeIcon`、`RestoreIcon`、`CloseIcon`、`BellIcon`）、`@/components/app-info-drawer`、`@/components/close-confirm-dialog`、`@/utils/messageStore`（`getMessages`、`getUnreadCount`、`hasUrgentUnread`、`subscribeMessages`、`AppMessage`）、`@/components/message-card`、`@/utils/configService`（`getConfig`）、`@/stores/launcherMode`（`getLauncherMode`、`setLauncherMode`、`subscribeLauncherMode`、`LauncherViewMode`）、`@/utils/platform`（`isWindowsPlatform`）、`@/utils/logger`、`@/components/ui/toggle-group`（`ToggleGroup`、`ToggleGroupItem`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CustomTitlebar` | custom-titlebar.tsx:33 | 组件主体，无 props |
| 局部状态 | custom-titlebar.tsx:35-45 | `isMaximized`、`infoOpen`（消息抽屉）、`unreadCount`、`hasUrgent`、`showCloseConfirm`、`closeAction`（默认 `"ask"`）、`viewMode`（初值 `getLauncherMode()`）、`newMessage`（浮层消息）、`flyoutOpen`（默认 `true`）；refs：`seenMessageIds`（已展示过的消息 id Set，初始为启动时队列内全部 id）、`flyoutTimer` |
| 消息订阅 effect | custom-titlebar.tsx:47-71 | `subscribeMessages`：仅在队首是**从未展示过的新消息**（`seenMessageIds` 中不存在）时弹出浮层并记录其 id；由于用 Set 判断「新增」，删除队首消息露出旧消息不会重复弹浮层。非进度型消息（`progress === undefined \|\| progress < 0`）5 秒后自动隐藏；若当前正在展示的消息已被从队列移除，则立即收起浮层；同时刷新 `unreadCount`、`hasUrgent` |
| 定时器清理 effect | custom-titlebar.tsx:67-72 | 卸载时 `clearTimeout(flyoutTimer.current)` |
| 视图模式订阅 effect | custom-titlebar.tsx:74-78 | `subscribeLauncherMode(() => setViewMode(getLauncherMode()))` |
| 关闭行为配置 effect | custom-titlebar.tsx:81-85 | `getConfig<string>("close_action")` → `setCloseAction(value ?? "ask")` |
| `checkMaximizedState` | custom-titlebar.tsx:87 | `async`：`getCurrentWindow().isMaximized()` → `setIsMaximized`，异常记 `logger.error(..., "Titlebar")` |
| 窗口事件 effect | custom-titlebar.tsx:97-115 | 先执行一次 `checkMaximizedState()`，再 `listen("tauri://resize")`（103 行）与 `listen("tauri://move")`（107 行）触发重新检查，清理时调用两个 `UnlistenFn` |
| `handleMinimize` | custom-titlebar.tsx:117 | `await invoke("minimize_window")` |
| `handleMaximize` | custom-titlebar.tsx:125 | `await invoke("toggle_maximize_window")`，100ms 后再 `checkMaximizedState()` 同步图标 |
| `handleClose` | custom-titlebar.tsx:134 | 按 `closeAction` 分支：`"ask"` → `setShowCloseConfirm(true)`；`"minimize_to_tray"` → `invoke("minimize_to_tray")`；否则 `invoke("app_quit")` |
| `handleConfirmClose` | custom-titlebar.tsx:148 | `(action: "close" \| "minimize_to_tray")`：分别 `invoke("minimize_to_tray")` / `invoke("app_quit")`；之后重新 `getConfig("close_action")` 回写本地 `closeAction`（用户可能勾选了「记住」） |
| 渲染块 | custom-titlebar.tsx:165-289 | `titlebar-shell h-11`（`WebkitAppRegion: drag`，交互元素 `no-drag`）：品牌圆点 + 标题（`viewMode === "game"` 显示 `launcher.game_title`，否则 `ENDPROTOCOL`，178 行）→ `ToggleGroup` 视图切换（182-204，值 `"data"` / `"game"`，写入 `setLauncherMode`）→ 弹性占位 → 铃铛按钮（211-226，未读角标 `99+` 截断，`hasUrgent` 用 `bg-danger`）→ 新消息浮层（228-246，`createPortal(document.body)` + `fixed right-12 top-10 z-[10005]`，内嵌 `MessageCard compact`）→ 窗口三键（248-282）→ `<AppInfoDrawer>`（286）与 `<CloseConfirmDialog>`（287-291） |

**备注**：
- **invoke 命令**：`minimize_window`（custom-titlebar.tsx:119）、`toggle_maximize_window`（127）、`minimize_to_tray`（139、151）、`app_quit`（141、153）。
- **listen 事件**：`tauri://resize`（103）、`tauri://move`（107）。
- 其它事件源：`subscribeMessages`、`subscribeLauncherMode`（均为前端 store 回调，非 Tauri event）。
- 层级：标题栏 `titlebar-shell`；**消息浮层经 portal 渲染到 `document.body`、`fixed` + `z-[10005]`，高于任何 modal/抽屉/全屏遮罩（modal backdrop `z-[100]`~`z-[300]`、快选菜单 `z-[9999]`、取色器 `z-[10001]`），保证打开弹窗时依然可见**；抽屉 `z-[200]/[210]`（在 `AppInfoDrawer` 内）。
- i18n key：`launcher.game_title`、`launcher.mode_data`、`launcher.mode_game`。
- 游戏模式切换仅在 Windows 显示；macOS/Linux 通过 `isWindowsPlatform()` 隐藏切换控件，模式 store 也会拒绝切换到游戏模式。
- 关闭确认框文案本身无 i18n key（见 close-confirm-dialog 备注）。

## `src/components/role-select-modal.tsx`
**职责**：多选角色弹窗。展示角色卡片（头像/昵称/等级/服务器），多选确认后把选中的完整角色信息保存到后端。
**导出**：默认导出 `RoleSelectModal`（同文件内还声明了未导出的 `RoleDisplayInfo`）
**主要依赖**：`react`（`useState/useEffect`）、`react-i18next`、`@tauri-apps/api/core`（`invoke`）、`@/components/ui/glass`（`GlassButton`、`GlassCard`、`GlassCheckbox`、`GlassSkeleton`）、`@/components/custom-modal`（`CustomModal`、`CustomModalHeader`、`CustomModalBody`、`CustomModalFooter`）、`@/utils/imageLoader`（`Img`）、`@/utils/logger`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `RoleDisplayInfo` | role-select-modal.tsx:14 | 接口：`roleId`、`userId`、`serverId`、`nickname`、`level`、`avatarUrl`（文件内本地定义，未导出） |
| `RoleSelectModalProps` | role-select-modal.tsx:23 | 接口：`isOpen`、`onClose`、`roles: RoleDisplayInfo[]`、`cred`、`token`、`userId`（三者透传给后端命令）、`onSuccess()`（保存成功回调） |
| `RoleSelectModal` | role-select-modal.tsx:33 | 默认导出组件，弹窗 `size="xl"`（role-select-modal.tsx:97） |
| 重置 effect | role-select-modal.tsx:47-51 | `isOpen` 变真时 `setSelectedRoles([])` |
| `handleRoleToggle` | role-select-modal.tsx:53 | `(roleId)`：在 `selectedRoles` 中增删（多选） |
| `handleConfirm` | role-select-modal.tsx:61 | `async`：未选中任何角色 → `alert(...)`；否则取 `roles.filter(r => selectedRoles.includes(r.roleId))` 组装明细 → `invoke("save_selected_roles", { cred, token, userId, selectedRoles })` → `onSuccess()` + `onClose()`；`catch` 中 `logger.error(..., "RoleSelect")` 并 `alert`；`finally` 清 `isLoading` |
| 渲染块 | role-select-modal.tsx:96-181 | 空态文案 → `grid grid-cols-2` 角色卡片（`GlassCard isPressable` + `GlassCheckbox` + `Img` 头像（`onError` 回退 `/tauri.svg`，无地址时显示 `GlassSkeleton`）+ 昵称/等级/服务器）→ 底部 `Cancel` / 确认按钮（`isDisabled={selectedRoles.length === 0 \|\| isLoading}`，文案带 `count` 插值） |

**备注**：
- **invoke 命令**：`save_selected_roles`（role-select-modal.tsx:79），参数 `{ cred, token, userId, selectedRoles: RoleDisplayInfo[] }`。无 `listen`。
- i18n key：`role_select.title`、`role_select.no_roles_found`、`role_select.unknown_role`、`role_select.level`、`role_select.server`、`role_select.cancel`、`role_select.confirm_selection`（`count` 插值）。
- 异常：多处使用浏览器原生 `alert()`（role-select-modal.tsx:63、90），与项目其余 `GlassAlertDialog` 风格不一致；成功/失败提示也不走 `messageStore`。

## `src/components/tab-editor-modal.tsx`
**职责**：仪表盘标签页的新建/编辑弹窗。编辑名称、图标（15 选一）、标签 chips、默认角色（从账户列表单选）。
**导出**：`TabEditorModal`
**主要依赖**：`react`（`useState/useEffect`）、`react-i18next`、`@/components/ui/glass`（`GlassButton`、`GlassChip`、`GlassInput`）、`./custom-modal`（`CustomModal`、`CustomModalHeader`、`CustomModalBody`、`CustomModalFooter`）、`@/types/dashboard`（`TAB_ICONS`、`DashboardTab`）、`@/utils/tabIcons`（`getTabIcon`、`getIconLabel`）、`@/utils/accountService`（`getAccounts`、`getSelectedAccount`、`Account`）、`@/components/ui/account-avatar`（`AccountAvatar`）、`morphicons/react`（`MorphIcon`）、`lucide`（`X`、`Check`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TabEditorModalProps` | tab-editor-modal.tsx:17 | 接口：`isOpen`、`onClose`、`onSave(data)`（`data: { name, icon, tags: string[], defaultRoleId }`）、`initialData?: Pick<DashboardTab, "name" \| "icon" \| "tags" \| "defaultRoleId">`（传了即为编辑模式）、`title?`（自定义标题，覆盖默认） |
| `TabEditorModal` | tab-editor-modal.tsx:25 | 组件主体，弹窗 `size="md"`（tab-editor-modal.tsx:94） |
| 局部状态 | tab-editor-modal.tsx:33-40 | `name`、`selectedIcon`（默认 `"home"`）、`tagInput`、`tags: string[]`、`defaultRoleId`、`accounts: Account[]` |
| 初始化 effect | tab-editor-modal.tsx:42-67 | `isOpen` 变真时重置各字段与 `accounts`，并 `Promise.all([getAccounts(), getSelectedAccount()])`；`defaultRoleId` 取值优先级：`initialData.defaultRoleId`（须存在于账户列表）→ 当前选中账户 → 第一个账户 |
| `handleAddTag` | tab-editor-modal.tsx:69 | 去空白后若不重复则追加进 `tags`，随后清空 `tagInput` |
| `handleRemoveTag` | tab-editor-modal.tsx:77 | 从 `tags` 中删除指定项 |
| `handleSave` | tab-editor-modal.tsx:81 | `name` 为空或 `defaultRoleId` 为空时直接 return；否则 `onSave({ name: name.trim(), icon: selectedIcon, tags, defaultRoleId })` |
| `isEdit` | tab-editor-modal.tsx:91 | `!!initialData`，用于默认标题文案 |
| 渲染块 | tab-editor-modal.tsx:93-243 | 标题（`title ??` 编辑/创建三元文案）→ 名称输入 → 图标 5 列网格（`TAB_ICONS.map`，选中带 primary 描边+发光）→ 标签区（输入框回车或点「添加」，chips 带 `X` 移除按钮）→ 默认角色说明 + 可滚动账户列表（`AccountAvatar` + 昵称 + `Lv.x` + `Check` 勾选）→ 底部 `Cancel` / `Save`（`isDisabled={!name.trim() \|\| !defaultRoleId}`） |

**备注**：
- 无 `invoke` / `listen`；账户数据经 `@/utils/accountService`。
- i18n：**未使用 i18next key**，全部 `i18n.language === "zh"` 三元硬编码（tab-editor-modal.tsx:97-98、104、108、117、150-154、165、190、193-195、232、239）。
- 图标集：`TAB_ICONS`（`src/types/dashboard.ts:46-62`，共 15 项：`home/chart/users/star/heart/bookmark/tag/folder/calendar/bell/settings/account/search/developer/projects`）。
- 异常：`onSave` 字段名为 `defaultRoleId`，但实际取值来自 `getAccounts()` 返回的**账户 id**（tab-editor-modal.tsx:57-62），命名与语义不一致，调用方按账户 id 处理。

## `src/components/tab-selector.tsx`
**职责**：仪表盘标签页总览页。以卡片网格展示全部标签页，支持搜索、新建、悬停/右键菜单编辑与删除。
**导出**：`TabSelector`
**主要依赖**：`react`（`useMemo/useState`）、`react-i18next`、`@/components/ui/glass`（`GlassButton`、`GlassChip`、`GlassInput`）、`@/types/dashboard`（`DashboardTab`）、`@/utils/tabIcons`（`getTabIcon`）、`@/components/icons`（`PlusIcon`、`SearchIcon`、`EditIcon`、`TrashIcon`）、`@/components/cards/card-context-menu`（`CardContextMenu`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TabSelectorProps` | tab-selector.tsx:9 | 接口：`tabs: DashboardTab[]`、`onSelectTab(tabId)`、`onCreateTab()`、`onEditTab(tab)`、`onDeleteTab(tabId)` |
| `TabSelector` | tab-selector.tsx:17 | 组件主体（无受控开关，始终渲染，父级决定显隐） |
| 局部状态 | tab-selector.tsx:25-26 | `searchQuery`；`contextMenu: { x, y, tab } \| null`（右键菜单锚点与目标 tab） |
| `filteredTabs` | tab-selector.tsx:28 | `useMemo([tabs, searchQuery])`：空查询原样返回，否则按 `tab.name` 或任一 `tab.tags`（忽略大小写）匹配 |
| 标题区块 | tab-selector.tsx:41-52 | 「仪表盘」标题 + 副标题文案 |
| 搜索/新建区 | tab-selector.tsx:54-73 | 带 `SearchIcon` 的 `GlassInput` + `New Tab` 主按钮（`onCreateTab`） |
| 空态区 | tab-selector.tsx:75-101 | 区分「搜索无结果」与「还没有标签页」两种文案；后者额外提供「创建第一个标签页」按钮 |
| 网格区 | tab-selector.tsx:103-171 | `sm/lg/xl` 响应式网格。每张 tab 卡片：图标、名称、卡片数、`Role set` 徽章（有 `defaultRoleId` 时）+ tags chips；hover 显示右上角编辑/删除按钮（`stopPropagation` 后回调）；`onClick` → `onSelectTab(tab.id)`；`onContextMenu` → 记录坐标并打开右键菜单 |
| 右键菜单 | tab-selector.tsx:174-193 | `CardContextMenu` props：`x`、`y`、`items`（`edit` → `onEditTab(tab)`；`delete` → `onDeleteTab(tab.id)`，`danger: true`）、`onClose` |

**备注**：
- 无 `invoke` / `listen` / portal（`CardContextMenu` 自行处理挂载）。
- i18n：未用 i18next key，全部 `i18n.language === "zh"` 三元（tab-selector.tsx:44、47-50、59、71、82、85、88-90、98、127、135、181、186）。
- 右键与悬停按钮行为一致，均只提供「编辑/删除」两项。

## `src/components/screen-color-picker.tsx`
**职责**：Windows 专用全屏取色器。截取整屏像素铺满窗口，鼠标移动时显示 220px 放大镜与实时色值，点击取色、右键或 Esc 取消；macOS/Linux 不展示屏幕吸管入口。
**导出**：默认导出 `ScreenColorPicker`（同文件内有未导出的 `ScreenCaptureResult` 接口与 `MAGNIFIER`/`ZOOM` 常量）
**主要依赖**：`react`（`useCallback/useEffect/useRef/useState`）、`react-dom`（`createPortal`）、`@tauri-apps/api/core`（`invoke`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ScreenCaptureResult` | screen-color-picker.tsx:5 | 接口：`width`、`height`、`data`（base64 原始像素） |
| `ScreenColorPickerProps` | screen-color-picker.tsx:11 | 接口：`onPick(hex: string)`（取色成功回调，格式 `#rrggbb`）、`onCancel()`（取消回调） |
| `MAGNIFIER` | screen-color-picker.tsx:16 | 常量 `220`，放大镜直径 px |
| `ZOOM` | screen-color-picker.tsx:17 | 常量 `6`，放大倍率 |
| `ScreenColorPicker` | screen-color-picker.tsx:19 | 默认导出组件。refs：`displayRef`（底图 canvas）、`magRef`（放大镜容器）、`magCanvasRef`（放大镜 canvas）、`pointerRef`（准星）、`currentRef`（当前采样坐标） |
| 局部状态 | screen-color-picker.tsx:25-28 | `status: "loading" \| "ready" \| "error"`、`error`、`data: ScreenCaptureResult \| null`、`hoverColor: { hex, r, g, b } \| null` |
| 截屏 effect | screen-color-picker.tsx:30-45 | 挂载时 `invoke<ScreenCaptureResult>("capture_screen")`，成功 `setData`，失败 `setStatus("error")` + `setError`；`cancelled` 标志防竞态 |
| 解码绘制 effect | screen-color-picker.tsx:47-74 | `atob` → `Uint8Array` → `ImageData` → `putImageData` 到 `displayRef` canvas（尺寸取 `data.width/height`），成功后 `setStatus("ready")`，异常转 `error` |
| `handleCancel` | screen-color-picker.tsx:76 | `void invoke("finish_screen_pick")` 后调用 `onCancel()` |
| `renderMagnifier` | screen-color-picker.tsx:81 | `(sx, sy)`：把采样坐标换算为屏幕坐标并定位准星；`getImageData(1×1)` 取色写入 `hoverColor`（`toHex` 内联）；按 `MAGNIFIER/ZOOM` 绘制放大区并画中心十字；当放大镜碰到窗口右/下边界（`off = 18` 偏移，116-120 行）自动翻到指针另一侧 |
| `handleMove` | screen-color-picker.tsx:150 | 鼠标移动：仅 `status === "ready"` 时换算 `sx/sy`，存入 `currentRef` 并刷新放大镜 |
| 键盘 effect | screen-color-picker.tsx:165-191 | `window` `keydown`：`Escape` → `handleCancel`；方向键（`dirs` 映射 ±1 像素）微调采样点并 `preventDefault`；卸载移除监听 |
| `handlePick` | screen-color-picker.tsx:193 | 左键点击：`stopPropagation()`（避免被底层弹窗的点击外部关闭逻辑误关，见 195 行注释），坐标钳制到画布范围内 `getImageData` 取色，`void invoke("finish_screen_pick")` 后 `onPick("#rrggbb")` |
| 渲染/portal | screen-color-picker.tsx:221-303 | `createPortal(..., document.body)`，根容器 `fixed inset-0 z-[10000] cursor-crosshair`，绑定 `onMouseMove` / `onMouseDown` / `onContextMenu`（右键取消）。内部：全屏底图 canvas（232-238）→ 放大镜圆形容器（240-253，初始 `-9999`）→ 准星圆点（255-267）→ 底部色值信息条（269-291，含色块 + `HEX` + `rgb(r, g, b)` + 状态提示文案，`z-[10001]`）→ 错误态 `Close` 按钮（293-300） |

**备注**：
- **invoke 命令**：`capture_screen`（screen-color-picker.tsx:32，返回 `{width,height,data}`）、`finish_screen_pick`（77、215）。无 `listen`。
- 层级：根 `z-[10000]`，信息条/关闭按钮 `z-[10001]`。
- 无 i18n（提示文案硬编码英文：screen-color-picker.tsx:286-288）。
- 取色结果始终为小写 `#rrggbb`（`toString(16)`），显示时才 `toUpperCase()`。
- 原生截图依赖 Win32 GDI；Linux/macOS 不挂载此组件，其后端命令返回明确的 Windows-only 错误。

## `src/components/simple-pagination.tsx`
**职责**：统一分页控件（液态玻璃风格）。按页数生成页码序列（含首尾省略号），并提供前后翻页与「跳至指定页」输入框。
**导出**：`SimplePagination`
**主要依赖**：`@/lib/cn`（`cn`）、`morphicons/react`（`MorphIcon`）、`lucide`（`ChevronLeft`、`ChevronRight`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SimplePaginationProps` | simple-pagination.tsx:5 | 接口：`total`（总页数）、`page`（当前页，1 基）、`onChange(page)`、`siblingsCount?`（当前页左右保留页数，见备注）、`showControls?`（是否显示前后翻页按钮，默认 `true`） |
| `SimplePagination` | simple-pagination.tsx:16 | 组件主体。`total < 1` 时返回 `null`（simple-pagination.tsx:23） |
| 页码序列构建 | simple-pagination.tsx:25-51 | `pages: Array<number \| "ellipsis-start" \| "ellipsis-end">`；`total <= 7` 全列；`page <= 3` → `1,2,3,4,…,last`；`page >= total-2` → `1,…,last-3..last`；否则 `1,…,page-1,page,page+1,…,last`。内部辅助 `range(start,end)`（simple-pagination.tsx:29） |
| `itemClass` | simple-pagination.tsx:53 | `(active) => cn(...)`：`h-8 min-w-8 rounded-xl` 玻璃底 + hover 缩放，`active` 时 primary 描边/底/粗体 |
| 渲染 | simple-pagination.tsx:63-126 | `<nav aria-label="Pagination">`：可选上一页按钮（`page===1` 禁用并降透明，66-74）→ 页码/省略号序列（76-95，当前页带 `aria-current="page"`）→ 跳页输入框（96-113，`type="number"`，仅 `Enter` 生效且校验 `1..last`，随后清空输入）→ 可选下一页按钮（114-124） |

**备注**：
- 无 `invoke` / `listen` / portal / i18n。
- **固定行为**：省略号阈值写死为 7（`total <= 7` 全展示；边界各保留 4 页；中间保留 `page±1`），不受 props 影响。
- 异常：`siblingsCount` 在接口中声明（simple-pagination.tsx:9）但在解构处被注释掉（simple-pagination.tsx:20），传入后**完全无效**；跳页输入框始终渲染，不受 `showControls` 控制。

## `src/components/dashboard-fab.tsx`
**职责**：仪表盘右下角悬浮球（FAB）。展开后提供「添加卡片」与「进入/退出编辑模式」两个快捷操作。
**导出**：`DashboardFAB`
**主要依赖**：`react`（`useState/useEffect`）、`react-dom`（`createPortal`）、`react-i18next`、`morphicons/react`（`MorphIcon`）、`lucide`（`Plus`、`X`、`Pencil`、`Check`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `DashboardFABProps` | dashboard-fab.tsx:7 | 接口：`onAddCard()`、`onToggleEdit()`、`isEditMode` |
| `DashboardFAB` | dashboard-fab.tsx:13 | 组件主体。内部状态 `isExpanded`（dashboard-fab.tsx:19） |
| 自动展开 effect | dashboard-fab.tsx:21-23 | `isEditMode` 为真时强制 `setIsExpanded(true)` |
| 展开动作区 | dashboard-fab.tsx:27-53 | 绝对定位在主按钮上方（`bottom-16 right-0` 纵向堆叠，`animate-fade-in`）：①「Add Card」（`MorphIcon Plus`，调 `onAddCard`）②「Edit Mode / Exit Edit」（`Pencil`/`Check` 图标随 `isEditMode` 切换，调 `onToggleEdit`） |
| 主按钮 | dashboard-fab.tsx:55-64 | `h-14 w-14` 圆形玻璃按钮，`aria-label="FAB toggle"`；展开时旋转 90°，图标在 `Plus`/`X` 间切换 |
| 渲染/portal | dashboard-fab.tsx:25-67 | `createPortal(..., document.body)`，外层 `fixed bottom-6 right-6 z-50` |

**备注**：
- 无 `invoke` / `listen`。
- i18n key：`dashboard.add_card_button`、`dashboard.edit_mode`、`dashboard.exit_edit`（均带 `|| 英文兜底`）。
- 层级 `z-50`；展开态不自动收起（仅由主按钮或进入编辑模式切换）。

## `src/components/navbar.tsx`
**职责**：顶部导航栏。提供 GitHub 链接、主题/语言切换、搜索框、赞助按钮，并在窄屏折叠为汉堡菜单。
**导出**：`Navbar`
**主要依赖**：`react`（`useState`）、`react-i18next`、`@/components/ui/glass`（`GlassButton`、`GlassKbd`、`GlassLink`）、`@/config/site`（`siteConfig`）、`@/components/theme-switch`（`ThemeSwitch`）、`@/components/language-switch`（`LanguageSwitch`）、`@/components/icons`（`GithubIcon`、`HeartIcon`、`SearchIcon`）、`morphicons/react`（`MorphIcon`）、`lucide`（`Menu`、`X`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `Navbar` | navbar.tsx:18 | 组件主体，无 props。状态 `isMenuOpen`（navbar.tsx:19） |
| `searchInput` | navbar.tsx:22 | 内部 JSX 变量（非导出组件）：`glass-field` 搜索框，含 `SearchIcon`、`type="search"` 输入（placeholder 用 `common.search`）、右侧 `GlassKbd`（`⌘K`，仅 `lg` 及以上显示，`hidden lg:inline-flex`） |
| 导航容器 | navbar.tsx:38-39 | `<nav className="sticky top-0 z-40 ... glass-surface">` + `<header className="... h-16 max-w-[1280px] ...">` |
| 桌面操作区 | navbar.tsx:40-62 | GitHub `GlassLink`（`siteConfig.links.github`，新标签打开）→ `ThemeSwitch` → `LanguageSwitch` → 搜索框（`hidden lg:flex`）→ 赞助按钮（`hidden md:flex`，`window.open(siteConfig.links.sponsor, "_blank")`） |
| 窄屏操作区 | navbar.tsx:64-83 | GitHub / 主题 / 语言 + 汉堡按钮（`aria-expanded={isMenuOpen}`，`MorphIcon` 在 `Menu`/`X` 间切换） |
| 折叠菜单 | navbar.tsx:86-90 | `isMenuOpen` 时在 `sm` 以下展开一行，内放同一个 `searchInput` |

**备注**：
- 无 `invoke` / `listen` / portal。
- i18n key：`common.search`、`common.sponsor`。
- 搜索框为**纯展示**：无 `value`/`onChange`，输入内容不被读取，`⌘K` 仅为视觉提示。

## `src/components/message-card.tsx`
**职责**：消息卡片（`AppMessage` 的渲染单元）。按类型着色，支持未读态、进度条/进行中转圈、相对时间、可选操作按钮与关闭按钮；用于消息抽屉与标题栏浮层。
**导出**：`MessageCard`（同文件另有未导出的 `TYPE_STYLES`、`resolveType`、`TypeIcon`、`timeAgo`）
**主要依赖**：`react`（`useState`）、`react-i18next`、`@/lib/cn`（`cn`）、`@/utils/messageStore`（`AppMessage` 类型、`removeMessage`、`markRead`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `VisualType` | message-card.tsx:7 | 类型 `"info" \| "warn" \| "urgent"` |
| `TYPE_STYLES` | message-card.tsx:9 | `VisualType → { icon, card, cardRead }` 的 Tailwind 类映射（info=蓝 / warn=黄 / urgent=红，分别区分未读描边+底色与已读弱化色） |
| `resolveType` | message-card.tsx:27 | 原始 `type` 归一化：`"warn"`/`"error"` → `warn`，`"urgent"` → `urgent`，其余 → `info` |
| `TypeIcon` | message-card.tsx:33 | `(type) => JSX`，7×7 圆角图标底 + 按类型切换的内联 SVG（info 圆圈 i / warn 三角 / urgent 填充三角 !） |
| `timeAgo` | message-card.tsx:63 | `(ts, t) => string`，按 `Date.now() - ts` 分段返回 `messages.just_now` / `minutes_ago` / `hours_ago` / `days_ago`（均带 `count` 插值） |
| `MessageCard` | message-card.tsx:75 | 导出组件。Props：`msg: AppMessage`（必填）、`compact?: boolean`（默认 `false`；`true` 时去边框背景、正文默认收起并显示展开/收起按钮）、`onOpen?: () => void`（点击回调，优先于自动已读）。内部状态：`loadingAction`（message-card.tsx:87，正在执行的 action label）、`bodyExpanded`（message-card.tsx:88，初值 `!compact`） |
| 根容器 | message-card.tsx:91-103 | 有 `actions` 时 `cursor-default`（禁止整卡点击标记已读），否则 `cursor-pointer`；`compact` 无边框，非 compact 按 `read` 切换 `cardRead` / `ring-1 card`。点击逻辑：`onOpen` 存在则调用，否则 `!msg.read && !msg.actions` 时 `markRead(msg.id)` |
| 正文区 | message-card.tsx:106-146 | 标题（未读加粗）→ `body`（`whitespace-pre-line`，`bodyExpanded` 控制）→ compact 下的展开/收起按钮（113-126，`stopPropagation`）→ `progress === -1` 时转圈 + `messages.working`（127-134）→ `progress >= 0` 时进度条 + 百分比（135-145，宽度 `clamp(0,100)`）→ `timeAgo` 时间戳（146） |
| 操作按钮区 | message-card.tsx:148-181 | `msg.actions` 逐个渲染：`variant` 支持 `primary`/`secondary`/`danger`（默认 `primary`）；点击 `stopPropagation` → `setLoadingAction(label)` → `Promise.resolve(action.onClick()).finally(clear)`；加载中禁用并显示 `loadingLabel ?? messages.loading` |
| 关闭按钮 | message-card.tsx:184-198 | `msg.dismissable !== false` 时显示，hover 淡入，点击 `stopPropagation` 后 `removeMessage(msg.id)`；`aria-label` 为 `messages.dismiss` |

**备注**：
- 无 `invoke` / `listen` / portal。
- i18n key：`messages.just_now`、`messages.minutes_ago`、`messages.hours_ago`、`messages.days_ago`、`messages.working`、`messages.expand`、`messages.collapse`、`messages.loading`、`messages.dismiss`。
- `AppMessage` 结构（`src/utils/messageStore.ts:10-21`）：`id`、`type`、`title`、`body?`、`timestamp`、`read`、`tag?`、`actions?`、`dismissable?`、`progress?`。
- `progress` 语义：`-1` = 不确定进度（转圈）、`>=0` = 百分比、`undefined` = 无进度。

---

## `src/components/game-sidebar-rail.tsx`
**职责**：游戏界面（dashboard 游戏模式）右侧的官方社媒栏。形态是一根贴右边缘的**常驻条**（只有左侧圆角）：收起时仅一个浮标大小，鼠标靠近右边缘即向左、向上下两侧生长成一列渠道图标，鼠标离开**立即**收起（无关闭按钮、无防抖延迟）；悬停图标在左侧浮出该渠道二维码，点击用内嵌浏览器打开官方页面。数据来自启动器 `get_sidebar` 接口（由 `layouts/dashboard.tsx` 传入）。
**导出**：`GameSidebarRail`、`GameSidebarRailProps`
**主要依赖**：`react`（`useState/useEffect/useRef/useCallback`）、`react-dom`（`createPortal`）、`react-i18next`、`morphicons/react`（`MorphIcon`）、`lucide`（`Share2`、`Headset`）、`@/stores/inAppBrowser`（`openInAppBrowser`）、`@/utils/launcherService`（仅 `SidebarItem` 类型）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `PROXIMITY_PX` / `VERTICAL_PAD_PX` / `RAIL_HOVER_PAD` / `FLYOUT_ESTIMATE_HEIGHT` | game-sidebar-rail.tsx:10/12/14/16 | 展开触发：距右边缘 110px 内、且在常驻条上下 56px 竖向带内；命中判定对条矩形外扩 6px（跨过与浮层之间的缝隙）；浮层估算高度 250px（夹在视口内）。**没有任何防抖定时器**，离开即收起 |
| `HIDDEN_MEDIA` | game-sidebar-rail.tsx:21 | 不展示的 `media` 集合，当前只有 `SklandTool`（`DisplayType_GRID`，一组森空岛工具链接、无二维码） |
| `ICON_BY_MEDIA` | game-sidebar-rail.tsx:29 | `media → public/assets/icons/sidebar/*.svg` 的映射（7 个社媒条目；`CS` 不在表内，改走 `Headset`） |
| `iconFor` | game-sidebar-rail.tsx:39 | `(item) => string \| null`，未识别的 `media` 返回 null（按钮退化为文字缩写） |
| `FlyoutAnchor` | game-sidebar-rail.tsx:45 | 二维码浮层的视口定位 `{ right, bottom }` |
| `GameSidebarRailProps` | game-sidebar-rail.tsx:50 | `items: SidebarItem[]` |
| `GameSidebarRail` | game-sidebar-rail.tsx:75 | 组件主体。状态 `expanded`、`hoveredIndex`、`flyout`；refs `expandedRef`、`railRef`（常驻条）、`flyoutRef`（二维码浮层，参与命中判定） |
| `expand` / `collapse` | game-sidebar-rail.tsx:90/96 | 幂等切换（各自先比对 `expandedRef`）；`collapse` 同时清空 `hoveredIndex` 与 `flyout` |
| 几何命中 effect | game-sidebar-rail.tsx:103-138 | 监听 window `mousemove`，**每次实时量** `railRef` / `flyoutRef` 矩形：命中任一（条含 6px 外扩）即保持展开；否则若在右边缘 + 竖向带内则展开，都不满足则**立即收起**。不挂 DOM 事件、不用定时器，所以回缩无延迟，动画途中也不会读到过期矩形 |
| `handleItemEnter` | game-sidebar-rail.tsx:141-158 | 按悬停项的**视口矩形**算浮层位置（`right = innerWidth - rect.left + 8`，`bottom` 夹在视口内），并记录 `hoveredIndex`。列表项**没有** `onMouseLeave`：换项靠新项的 enter 覆盖，离开条靠几何收起，浮标额外用 `onMouseEnter` 清掉 `hoveredIndex`（否则停在分隔线/内边距上会残留上一张二维码） |
| `cell` | game-sidebar-rail.tsx:170 | 收起 `h-8 w-8`、展开 `h-9 w-9`：图标与内边距同步变大，条子向左生长 |
| 常驻条本体 | game-sidebar-rail.tsx:174-274 | portal 到 body，外层 `fixed right-0 top-1/2 z-30 -translate-y-1/2`；本体 `rounded-l-2xl border-r-0 overflow-hidden`，收起 `p-1 bg-black/45`、展开 `p-1.5 bg-black/55` |
| 图标列 | game-sidebar-rail.tsx:187-256 | `grid-template-rows: 0fr → 1fr` 做高度动画（内层 `min-h-0` + 外层裁剪），opacity 同步换内容；按钮 `h-[22px] w-[22px]` 图标统一尺寸；`jump_url` 为空（如微信公众号）时不可点击并在 title 追加「仅支持扫码」；不可点击的条目仍会触发悬停并弹出二维码飞出层；末尾分隔线随高度一起被裁掉 |
| 浮标按钮 | game-sidebar-rail.tsx:258-274 | 常驻在条的底端、固定 `h-8 w-8`，`MorphIcon Share2 size=15`；无关闭按钮，点击仅作手动切换 |
| 二维码浮层 | game-sidebar-rail.tsx:277-311 | **单独 portal 到 body**（不能挂在常驻条里：既会被 `overflow-hidden` 裁掉，也会因常驻条带 `transform` 而使 `position: fixed` 退化为相对该祖先定位）；`pointer-events-none` 纯展示层，保持展开的能力由上面的几何命中提供；`qr_url` 图片 `h-36 w-36` 白底，加载失败时隐藏图片并退回说明文案 + 「点击打开网页」 |

**备注**：
- 无 `invoke` / `listen`。两处 `createPortal(..., document.body)`，外层 `z-30`（低于 `InAppBrowser` 的 `z-40`，浏览器打开时整条栏被覆盖）。
- 整层在收起态为 `pointer-events-none`，不遮挡标题栏右上角的窗口控制按钮。
- i18n key：`launcher.sidebar.title`、`launcher.sidebar.open_hint`、`launcher.sidebar.scan_only`（均带中文兜底）。
- 二维码图片直接用官方 CDN 地址（`pic.url`），加载失败时隐藏图片并显示说明文案，不做本地缓存。

---

## 覆盖清单与横向要点

| 文件 | 行数 | 导出符号 |
| --- | --- | --- |
| custom-modal.tsx | 148 | `CustomModal`、`CustomModalHeader`、`CustomModalBody`、`CustomModalFooter` |
| close-confirm-dialog.tsx | 89 | `CloseConfirmDialog` |
| account-switch-modal.tsx | 196 | 默认 `AccountSwitchModal` |
| add-card-modal.tsx | 234 | `AddCardModal` |
| app-info-drawer.tsx | 71 | `AppInfoDrawer` |
| custom-titlebar.tsx | 290 | `CustomTitlebar` |
| role-select-modal.tsx | 182 | 默认 `RoleSelectModal` |
| tab-editor-modal.tsx | 244 | `TabEditorModal` |
| tab-selector.tsx | 196 | `TabSelector` |
| screen-color-picker.tsx | 304 | 默认 `ScreenColorPicker` |
| simple-pagination.tsx | 127 | `SimplePagination` |
| dashboard-fab.tsx | 68 | `DashboardFAB` |
| navbar.tsx | 93 | `Navbar` |
| message-card.tsx | 201 | `MessageCard` |
| game-sidebar-rail.tsx | 313 | `GameSidebarRail`、`GameSidebarRailProps` |

**invoke 命令汇总**：`minimize_window`、`toggle_maximize_window`、`minimize_to_tray`、`app_quit`（custom-titlebar）；`save_selected_roles`（role-select-modal）；`capture_screen`、`finish_screen_pick`（screen-color-picker）。

**listen 事件汇总**：`tauri://resize`、`tauri://move`（均在 custom-titlebar.tsx:103/107）。

**window 自定义事件**：监听 `manualRefresh`、派发 `accountChanged`（account-switch-modal）；`messageStore` 另派发 `messagesChanged`（本批文件未直接监听）。

**Portal / 层级**：`AppInfoDrawer` → `document.body`（`z-[200]` / 抽屉 `z-[210]`）；`DashboardFAB` → `document.body`（`z-50`）；`ScreenColorPicker` → `document.body`（`z-[10000]` / 信息条 `z-[10001]`）；`CustomModal` Backdrop 固定 `z-[100]`；标题栏消息浮层 `z-[220]`。

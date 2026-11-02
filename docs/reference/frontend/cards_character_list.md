# 干员列表卡片（character-list）— 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## `src/components/cards/character-list/index.tsx`
**职责**：干员列表卡片（card id = `character_list`）的卡片本体。读取卡片配置与干员数据，按 `displayMode` 渲染 1/2/3 个干员槽位，点击卡片或槽位打开 `CharSelectModal` 选人，并内嵌一个「更改账号」弹窗。
**导出**：`export default function CharacterListCard({ roleId, cardId, isEditMode }: BaseCardProps)`（第 52 行）—— 由 `registry/loader.ts` 通过 `import.meta.glob('../*/index.tsx')` 自动注册。
**主要依赖**：`GlassButton/GlassCard/GlassProgressCircle`（ui/glass）、`CharSelectModal`（./char-select-modal）、`useCardData`（../base/use-card-data）、`roleDataService.getFullCharDetail`、`CardConfigService`、`useImageRequest/usePinImages`（imageCacheManager）、`Img`（imageLoader）、`getAccounts`（accountService）、`CustomModal*`、`resolveServerLabel`、`useTranslation`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `DISPLAY_MODE_CONFIG` | 31–38 | `single/double/triple → { slotCount, gridCols }` 映射，决定槽位数与网格列数 |
| `getSelectedCharacters()` | 40–50 | 按 id 顺序从 `charDetail.chars` 取出前 `count` 个 `CharacterItem` |
| `CharacterListCard`（默认导出） | 52–498 | 卡片组件主体 |
| ↳ state：`selectedCharIds` | 58 | 已选干员 id 列表（受配置持久化） |
| ↳ state：`displayMode` | 59–60 | 显示模式，默认 `"triple"` |
| ↳ state：`isModalOpen` / `preopenCharId` | 61–62 | 选人弹窗开关 / 预打开的干员 id |
| ↳ state：`customRoleId` / `isRoleSelectModalOpen` / `availableAccounts` | 63–65 | 卡片级自定义账号与账号选择弹窗状态 |
| ↳ `prevRoleIdRef` | 66 | 记录上一次 effectiveRoleId，用于判断账号切换 |
| ↳ 自定义 roleId 加载 effect | 69–84 | 挂载时读 `CardConfigService.getCardSettings(cardId).roleId` |
| ↳ `effectiveRoleId` | 87 | `customRoleId \|\| props.roleId` |
| ↳ `roleIdChanged` | 90–91 | 账号是否发生变化（决定是否丢弃已保存的选人） |
| ↳ 数据加载 | 96–99 | `useCardData<CharDetailData>` + `roleDataService.getFullCharDetail(effectiveRoleId)`，`reloadKey = effectiveRoleId` |
| ↳ `processedCharDetail` | 101–104 | 浅拷贝 `chars` 数组，避免子组件写引用 |
| ↳ `loadSettings` | 106–138 | 读取 `displayMode`、`selectedCharIds`；roleId 变化时跳过选人恢复 |
| ↳ 设置加载 effect | 140–144 | 数据就绪后调用 `loadSettings` |
| ↳ `selectedCharacters` | 148–154 | 按槽位数裁剪的选中干员 |
| ↳ `avatarPaths` + 缓存预取 | 156–165 | `useImageRequest` / `usePinImages` 预取头像 |
| ↳ 长按计时器清理 effect | 167–172 | 弹窗打开时 `dispatchEvent("clearLongPressTimers")` |
| ↳ `cardAction` 事件监听 effect | 174–189 | 监听 `window` 的 `cardAction`，处理 `view-list` / `change-role` |
| ↳ `handleOpenRoleSelect` | 191–199 | 拉取账号列表后打开账号选择弹窗 |
| ↳ `handleRoleSelect` | 201–217 | 切换账号：清空选人并写回配置 |
| ↳ `rarityLineColor()` | 219–230 | 稀有度 → 底部色条颜色（6 `#ff7100` / 5 `#ffcc00` / 4 `#b380ff`） |
| ↳ `ICON_BASE` / `professionIconUrl` / `propertyIconUrl` | 232–235 | `/assets/icons/profession/<key>.png`、`/assets/icons/property/<key>.png` |
| ↳ `renderCharSlot()` | 237–325 | 单个槽位：立绘背景、职业/属性图标、潜能图标、等级/阶段/名字/稀有度色条 |
| ↳ loading 分支 | 327–343 | `GlassProgressCircle` |
| ↳ 空数据分支 | 345–351 | `t("card:no_data")` |
| ↳ 主体 JSX | 353–497 | `GlassCard` + 槽位网格 + 空槽占位 + `CharSelectModal` + 账号选择 `CustomModal` |

**备注**：
- **invoke 命令**：本文件无任何 `invoke` 调用。
- **listen 事件**：无 Tauri `listen`；仅 DOM 事件 —— 监听 `window` 的 `cardAction`（187），派发 `clearLongPressTimers`（170）。
- **配置键（`CharacterListCardSettings`，定义于 `src/types/card-settings.ts:10`）**：
  - 读取：`roleId`（76）、`displayMode`（115）、`selectedCharIds`（125）；
  - 写入：`roleId` + `selectedCharIds`（207–208，账号切换时并行写）、`selectedCharIds`（414–418，保存选人）。
  - 类型中还声明了 `sortOrder?: SortOrder`，但本组件从未读写（见「发现的异常」）。
- 传给 `CharSelectModal` 的 props：`isOpen`、`onClose`、`charDetail`、`selectedCharIds`（已 `slice(0, slotCount)`）、`roleId`、`maxSlots = slotCount`、`initialCharId`、`initialViewMode`（有 `preopenCharId` 时为 `"detail"`）、`onSave`。
- `isEditMode` 时点击卡片/槽位不打开弹窗（246、358、374）。

## `src/components/cards/character-list/char-select-modal.tsx`
**文件职责**：干员选择/详情大弹窗（3310 行）。上半部提供 6 维筛选 + 响应式干员网格（WIKI 风格 `OperatorCard`），顶部为固定槽位条（支持鼠标拖拽换位）；下半部（`viewMode === "detail"`）是干员详情页：左侧立绘 + 右侧技能/天赋阵列/被动/修行天赋/潜能 + 装备栏，点击任一项从右侧滑出 Wiki 文本抽屉（含升级材料）。
**导出**：`export function CharSelectModal(props: CharSelectModalProps)`（第 388 行）。
**Props（`CharSelectModalProps`，59–69）**：

| prop | 类型 | 说明 |
| --- | --- | --- |
| `isOpen` | `boolean` | 弹窗开关；`true` 时整体重置内部状态（618–635） |
| `onClose` | `() => void` | 关闭回调（详情页内会根据来源决定返回列表或直接关闭，1458–1467） |
| `charDetail` | `CharDetailData` | 干员全量数据（由父组件 `useCardData` 提供，组件自身不拉取） |
| `selectedCharIds` | `string[]` | 当前已选（pinned）干员 id |
| `onSave` | `(selectedIds: string[]) => void` | 槽位变更后的保存回调（内部用 `setTimeout` 延迟触发） |
| `roleId` | `string` | 账号 id，Wiki/物品目录请求参数 |
| `initialCharId` | `string?` | 打开时直接进入的干员 id |
| `initialViewMode` | `"list" \| "detail"?` | 初始视图 |
| `maxSlots` | `number?`（默认 3） | 槽位条槽数 |

### 内部结构总览
| 区间 | 内容 |
| --- | --- |
| 1–34 | import（React hooks、portal、Glass 控件、CustomModal、wikiTableParser、imageLoader、imageCacheManager、roleDataService、configService、logger） |
| 36–54 | 模块常量：`SKILL_BG_COLORS`、`SKILL_BG_CIRCLE`、`ICON_BASE`、`professionIconUrl`、`propertyIconUrl`、`RARITY_ICON_URL` |
| 56–69 | `FilterKey` 类型、`CharSelectModalProps` |
| 71–83 | `rarityTone()` 与 `rarityToneClass`（稀有度→文字色 class） |
| 85–241 | `FloatSelectOption` / `FloatSelect` 组件（WIKI 风格下拉筛选器，portal 定位） |
| 243–372 | `OperatorCard` 组件（网格卡片：立绘 + 图标 + pin 指示 + 拖拽触发 + 底栏） |
| 374–386 | `rarityLineColorLocal()`（模块级稀有度色条） |
| 388–1215 | `CharSelectModal` 主体的状态、派生数据与处理函数 |
| 1217–3309 | `return` JSX：成功提示、`CustomModal`、detail/list 双分支、回到顶部按钮、拖拽 ghost |

### 组件与函数清单
| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SKILL_BG_COLORS` | 36–42 | 技能属性 → 背景色（pulse/fire/natural/cryst/physical） |
| `SKILL_BG_CIRCLE` | 43 | 技能圆底 `#6d6d6d` |
| `ICON_BASE` / `professionIconUrl` / `propertyIconUrl` / `RARITY_ICON_URL` | 51–54 | 图标路径常量 |
| `FilterKey` | 56–57 | `"profession" \| "rarity" \| "property" \| "weapon" \| "mainAttr" \| "subAttr"` |
| `CharSelectModalProps` | 59–69 | 见上表 |
| `rarityTone()` | 72–77 | 6→orange、5→gold、4→purple、其余 blue |
| `rarityToneClass` | 78–83 | tone → Tailwind 文字色 |
| `FloatSelectOption` | 88–92 | `{ value, label, tone? }` |
| `FloatSelect()` | 93–241 | 下拉筛选控件：点击外部/滚动关闭（114–133）、`handleToggle` 定位到最近 `.glass-surface-strong` dialog 并 `createPortal` 渲染（137–166、197–238） |
| `OperatorCard()` | 245–372 | 网格卡片：`coverUrl = illustrationUrl \|\| avatarRtUrl \|\| avatarSqUrl`、`isPinned` 蓝点、潜能/阶段/等级/名字/色条；`onMouseDown` 触发拖拽并用 `isDraggingRef` 区分点击（267–289） |
| `rarityLineColorLocal()` | 375–386 | 稀有度色条（与 index.tsx 内同名逻辑重复） |
| `CharSelectModal()` | 388–3310 | 主组件 |
| ↳ `tempSelectedIds` | 400–401 | 槽位暂存选择 |
| ↳ `viewMode` / `detailCharId` | 402–403 | 列表/详情视图与当前详情干员 |
| ↳ `selectedDetailItem` | 404–413 | 抽屉选中项 `{ type: skill/combatTalent/abilityTalent/cultivationTalent/potential, id, formIndex? }` |
| ↳ `detailActive` / `enteredDetailFromCard` | 414–415 | 抽屉动画开关 / 是否从卡片直接进入详情（影响关闭行为） |
| ↳ `detailRafRef` / `detailTimerRef` | 416–417 | 抽屉开合的 rAF 与延时清理 |
| ↳ `wikiLoading` / `wikiDetail` / `itemNameMap` | 420–427 | Wiki 详情、加载态、物品目录（id→name/cover） |
| ↳ `wikiCleanupRef` / `wikiPreloadRef` | 421–422 | 标志位（`wikiCleanupRef` 写而未读，见异常） |
| ↳ `potentialData`（useMemo） | 431–458 | 从 wiki `chapterGroup` 找「干员潜能」章节 → widget → tabList，映射为 6 级潜能 `{ level, iconUrl, contentDoc }` |
| ↳ `openDetailPanel()` | 461–476 | 选中项 → rAF 后开抽屉 |
| ↳ `closeDetailPanel()` | 479–485 | 关动画 → 300ms 后清空选中项 |
| ↳ 拖拽状态 | 487–500 | `dragPos`、`dragOverSlot`、`successMessage`、`dragCharIdRef`、`dragStartPosRef`、`isDraggingRef`、`slotRefs`、`dragGhostRef`、`tempSelectedIdsRef` |
| ↳ `handleDragStart()` | 502–579 | 记录起点，5px 阈值后进入拖拽；mousemove 命中槽位 → `dragOverSlot`；mouseup 命中 → `handleDropOnSlot` |
| ↳ `filters` / `setFilter` / `resetFilters` | 582–600 | 6 维筛选状态，默认全 `"all"` |
| ↳ `showFilters` / `showBackToTop` / `scrollPercent` / `isHoveringBackToTop` / `modalBodyRef` | 602–607 | 筛选面板与回到顶部 |
| ↳ `resetWikiState()` | 610–615 | 清 `wikiLoading/wikiDetail/materialCoverMap/fetchedCoverIdsRef` |
| ↳ 打开/关闭重置 effect | 618–635 | 打开时重置选人、视图、详情、成功提示、筛选、Wiki 状态 |
| ↳ 详情选中项重置 effect | 638–643 | 切换详情干员时关闭抽屉 |
| ↳ Wiki 详情加载 `useLayoutEffect` | 646–717 | 见「数据获取与缓存」 |
| ↳ `selectedItemName`（useMemo） | 720–740 | 由 `selectedDetailItem` 解析技能/天赋名称 |
| ↳ `skillFormTabs`（useMemo） | 743–782 | 多形态技能：从 `skill.forms` + wiki `widgetCommonMap/tabDataMap` 配对出各形态 `contentId/descriptionId` |
| ↳ 材料封面数据 | 785–789 | `fetchedCoverIdsRef`、`materialCoverMap`、`cacheDirRef` |
| ↳ 材料封面下载 effect | 790–966 | 见「图片下载」 |
| ↳ 离开 detail 重置 effect | 969–975 | `prevViewMode` 从 detail→list 时 `resetWikiState()` |
| ↳ 动画 ref 清理 effect | 978–983 | 卸载时取消 rAF/timeout |
| ↳ `renderRarityIcons()` | 985–1000 | 按稀有度值渲染 N 颗 `/assets/rarity.svg` |
| ↳ `sortedCharacters` | 1003–1023 | 排序：pinned → 稀有度降序 → 等级降序 → 名称（zh-Hans-CN）升序 |
| ↳ `getSubProperty()` | 1027–1034 | 从 `charData.tags` 取第一个 ≠ 主属性的 tag 作为副能力 |
| ↳ `uniqueProfessions/Properties/Rarities/Weapons` | 1037–1067 | 筛选选项去重（rarity 按数值降序） |
| ↳ `uniqueMainAttrs` | 1070 | 主能力 = `uniqueProperties` |
| ↳ `uniqueSubAttrs` | 1073–1080 | 所有非空副能力去重 |
| ↳ `filteredCharacters` | 1083–1105 | 6 维 AND 过滤 |
| ↳ `getCharById()` / `getCharItemById()` | 1108–1115 | id → `charData` / 完整 `CharacterItem` |
| ↳ `gridAvatarPaths` | 1118–1129 | 全部卡片封面 URL |
| ↳ `detailImagePaths` | 1131–1166 | 详情页用图：立绘、头像、技能/天赋图标、武器与 4 装备、战术物品图标 |
| ↳ `allCachePaths` + `useImageRequest` | 1168–1173 | 合并后批量预取 |
| ↳ `handleDropOnSlot()` | 1176–1195 | 去重后写入槽位，`setTimeout(onSave)`，并弹出 3 秒成功提示 |
| ↳ `handleRemoveFromSlot()` | 1198–1204 | splice + 补空串，`setTimeout(onSave)` |
| ↳ `handleScroll()` | 1207–1215 | 计算滚动百分比，>50% 显示回到顶部 |

### 关键功能分区

**筛选与排序**（582–600、1002–1105、3105–3212）
- 6 个 `FloatSelect`（3108–3186）+ 圆形重置按钮（3188–3209，`onPress={resetFilters}`）；选项来自 `unique*` 派生（1037–1080）。
- 排序固定为 pinned → 稀有度 → 等级 → 名称（1003–1023），无用户可选排序入口。

**选中 / 槽位 / 拖拽**（487–579、1176–1204、3004–3094、3279–3306）
- 顶部「槽位条」（3005–3094）：`maxSlots` 个格子，已选显示头像+名字+移除按钮，未选显示虚线空槽；`slotRefs` 注册命中区域。
- 拖拽换位：`OperatorCard.onMouseDown → handleDragStart`，命中高亮 `dragOverSlot`，松手 `handleDropOnSlot`；拖拽 ghost 渲染于 3280–3306。
- 每次变更都 `setTimeout(() => onSave(...))`（1185、1203），注释说明是为避免父组件重渲染导致滚动位置丢失。
- 成功提示浮窗（1220–1229），key：`settings.characters.pin_success`。

**详情页：技能 / 天赋 / 潜能 / 装备与属性**（1232–2993）
- 详情分支为立即执行的 IIFE（1234–2993）。关闭按钮逻辑 1457–1483（有抽屉→收抽屉；从卡片进入→`onClose`；否则回列表）。
- 左栏（1509–1599）：立绘背景 `/assets/illustration_background.png`、头像、职业/属性图标、名字、稀有度星、武器类型、`LEVEL` 大字、进化阶段。
- 右栏（1602–2265）：
  - 技能（1616–1722）：conic-gradient 圆形技能底 + 等级徽标（≥10 用 `/assets/icons/specialization/rank_*.png`）；
  - 天赋阵列 `abilityTalents`（1727–1788，按 id 尾号排序，解锁态 `activeAbilityNodes.includes`）；
  - 被动天赋链 `combatTalents`（1791–1849，`groupChains` 分组 + `isNodeUnlocked` 判链上任意已激活）；
  - 修行天赋链 `cultivationTalents`（1852–1908）；
  - 潜能（1911–1992，`potentialData`，解锁数 = `charItem.potentialLevel`）；
  - 装备栏 IIFE（1997–2261）：`eqCard()` 归一化 6 件装备（weapon/body/arm/acc1/acc2/tactical，1368–1442）、`rc` 稀有度色表（1998–2004）、`sectionTitle`（2006）、`renderCard`（2021–2179）、`renderGemCard`（2181–2213，武器宝石）、精炼等级图标（2084–2097）；布局 2218–2259（武器 65% + 宝石，2 大 + 3 小装备卡）。
- 右侧抽屉（2282–2988）：遮罩 2268–2279；抽屉内容 IIFE 2315–2985 —— 技能等级 `skillLevel`（2317–2322，满级 12）、`talentRank`（2332–2362，按去后缀的基础名归组取序号）、多形态标签页（2481–2548）、Wiki 正文 `wikiBlocks`（2376–2393）、潜能富文本 `getPotentialSegments`（2423–2470）、正文渲染 2649–2891（heading3/段落/属性 delta 表，`materials` 块跳过 2807）、下一级材料 2893–2937、满级累计材料 2939–2982。

**搜索**
- 本文件**没有**搜索/关键字过滤功能，只有 6 维下拉筛选。

**批量操作**
- 本文件**没有**批量选择/批量操作；仅逐个槽位 pin / 拖拽换位 / 移除。

**数据获取与缓存**（646–717、790–966、1118–1173）
- `useLayoutEffect`（646–717）：进入 detail 且 `wikiItemId` 有效时，先 `setWikiLoading(true)`，读配置 `getConfig<boolean>("wiki_detail_preload")` → `roleDataService.getWikiItemDetail(roleId, wikiItemId)`，随后 `roleDataService.getItemCatalog(roleId)` 填充 `itemNameMap`（含 5 条 catalog 调试日志），成功后 `wikiCleanupRef.current = true`。
- 图片批量预取：`useImageRequest(allCachePaths, [allCachePaths])`（1173）。
- 组件**不**自行拉干员列表，`charDetail` 完全来自父组件。

**图片下载**（910–959）
- 首次需要时 `invoke<string>("get_image_cache_dir")` 缓存到 `cacheDirRef`（913–915）。
- 逐个材料 `invoke<string>("download_image", { url, cacheDir, subDir: "item_icons" })`（940–944），结果写入 `materialCoverMap` 并把 id 记入 `fetchedCoverIdsRef` 去重。
- 封面 URL 来自 `itemNameMap.get(itemId).cover`；跳过无 cover 的条目。

**与后端交互**
- 全部通过 `@tauri-apps/api/core` 的动态 `import` 调用，命令见「备注」；无 `listen`。
- 其余数据来自 `roleDataService`（内部自行 invoke）与 `getConfig`。

**备注**：
- **invoke 命令名（本文件全部）**：
  1. `get_image_cache_dir`（914）
  2. `download_image`（940，参数 `url` / `cacheDir` / `subDir`）
- **listen 事件**：**无**。非 Tauri 的 DOM 监听：`document` `mousedown`（127）、`window` `scroll` capture（128）、`document` `mousemove`/`mouseup`（274–279、577–578）。
- **配置键**：`wiki_detail_preload`（`getConfig`，665）。本文件不读写卡片 settings。
- **i18n key**：`card:title`、`filters.*`（profession/rarity/property/weapon/mainAttr/subAttr 及 all_* 变体）、`common.clear`、`common.no_results_found`、`common.slot`、`common.remove`、`settings.characters.pin_success`。
- **父组件调用点**：`character-list/index.tsx:398`、`src/pages/characters.tsx:625`（详情页复用，`selectedCharIds=[]`、`onSave=noop`、`initialViewMode="detail"`）。

## `src/components/cards/character-list/character-list-size-modal.tsx`
**职责**：卡片显示模式选择弹窗，让用户在 `single / double / triple` 三档中选择，确认后回调给调用方（不直接写配置）。
**导出**：`export function CharacterListSizeModal({ isOpen, onClose, onConfirm })`（84–158）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CharacterListSizeModalProps` | 12–16 | `{ isOpen, onClose, onConfirm(mode) }` |
| `SizeOption` | 18–25 | `{ mode, w, h, labelKey, descKey, preview }` |
| `ModePreview()` | 27–55 | 按 `count` 渲染 1–3 个占位小人的缩略图 |
| `SIZE_OPTIONS` | 57–82 | single(2×3) / double(3×3) / triple(4×3)，i18n key `card:mode_*` |
| `CharacterListSizeModal` | 84–158 | 选中态 `selectedMode`；`handleConfirm` 上抛并清空（92–97）；`handleClose` 清空并关闭（99–102）；未选中时确认按钮禁用（150） |

**备注**：无 `invoke`、无 `listen`、无配置读写；仅用 i18n `card:display_mode`、`card:mode_*`、`common.cancel`、`common.confirm`。
**调用方**：`src/pages/dashboard.tsx:449`（新增 character_list 卡片时选择尺寸）。

## `src/components/cards/character-list/character-list.meta.json`
**职责**：卡片元数据，供 `registry/loader.ts` 的 `import.meta.glob('../*/*.meta.json')` 扫描注册。

| 字段 | 值 |
| --- | --- |
| `id` | `character_list`（= `CardType.CHARACTER_LIST`，见 `src/types/dashboard.ts:5`） |
| `name` | zh「干员列表」/ en「Character List」 |
| `description` | zh「显示收藏的干员头像和信息」/ en「Display pinned characters with avatars and info」 |
| `icon` | `users` |
| `defaultSize` | `{ w: 4, h: 3 }` |
| `version` | `1.0.0` |
| `allowMultiple` | `true` |
| `tags` | `character`（干员）、`display`（显示）、`data`（数据） |

**备注**：无代码、无 invoke/listen。`registry/loader.ts` 以 `character-list.meta.json` + `character-list/index.tsx` 配对成注册项，并把 `locales/*.json` 合并进 i18n 的 `card` 命名空间。

## `src/components/cards/character-list/locales/zh.json`
**职责**：卡片中文文案（23 行，整体并入 i18n `card` 命名空间）。

| key | 值 | 在本目录内的使用位置 |
| --- | --- | --- |
| `title` | 干员列表 | `char-select-modal.tsx:2999` |
| `no_data` | 无可用数据 | `index.tsx:348` |
| `sort_order` / `sort_rarity` / `sort_name` / `sort_level` | 排列顺序 / 按星级 / 按名称 / 按等级 | 本目录未使用 |
| `empty_slot` | 空槽位 | `index.tsx:391` |
| `display_mode` | 显示模式 | `character-list-size-modal.tsx:107` |
| `mode_single` / `mode_single_desc` | 单干员 / 紧凑卡片，显示 1 个干员 | size-modal `labelKey`/`descKey` |
| `mode_double` / `mode_double_desc` | 双干员 / 并排显示 2 个干员 | 同上 |
| `mode_triple` / `mode_triple_desc` | 三干员 / 显示 3 个干员（默认） | 同上 |
| `view_list` | 查看列表 | 本目录未直接使用，由 `card-container.tsx:167` 作为右键菜单文案 |
| `confirm_delete_title` / `confirm_delete_body` | 删除卡片 / 确定要删除该卡片吗？ | 本目录未使用（`card-container.tsx:271` 用到 `confirm_delete_title`） |
| `change_role` | 更改账号 | `index.tsx:436`（右键菜单 label 也复用） |
| `select_role` | 选择账号 | 本目录未使用，由 `dashboard.tsx:465` 等复用 |
| `no_accounts` | 无可用账户 | `index.tsx:442` |
| `current` | 当前 | `index.tsx:479` |

**备注**：无代码、无 invoke/listen。同目录另有 `en.json`（774 B），结构一致。

### 与 `src/pages/char-select.tsx` 的关系（历史）
- `src/pages/char-select.tsx` 曾是本 modal 的早期/平行副本（2561 行，未被任何路由或 import 引用）。
- 该死代码文件已随 Liquid Glass 重构物理删除；本文件是唯一实际生效的实现。

## 附：invoke / listen 汇总（本目录全部）
| 类型 | 名称 | 文件:行 |
| --- | --- | --- |
| `invoke` | `get_image_cache_dir` | `char-select-modal.tsx:914` |
| `invoke` | `download_image` | `char-select-modal.tsx:940` |
| `listen`（Tauri） | 无 | — |
| DOM 事件（自定义） | `cardAction`（监听，actions: `view-list`、`change-role`） | `index.tsx:187` |
| DOM 事件（自定义） | `clearLongPressTimers`（派发） | `index.tsx:170` |
| DOM 事件（原生） | `mousedown`/`scroll`/`mousemove`/`mouseup` | `char-select-modal.tsx:127,128,274,275,577,578` |

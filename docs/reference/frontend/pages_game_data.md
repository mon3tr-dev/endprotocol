# 角色页与抽卡记录页 — 文件功能参考

> 逐行精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## `src/pages/characters.tsx`

**文件职责**：角色图鉴列表页。按当前账号拉取完整角色详情数据，提供职业/稀有度/属性/武器/主属性/副属性六项浮动筛选，网格展示角色卡片，点击卡片通过 `CharSelectModal` 打开角色详情。

**导出**：`export default function CharactersPage()`（L277）——路由页面组件，无其他导出。

**主要依赖**：
- UI：`GlassButton` / `GlassCard` / `GlassProgressCircle`（`@/components/ui/glass`）、`BackToTopFab`（`@/components/ui/back-to-top`）、`CharSelectModal`（`@/components/cards/character-list/char-select-modal`）
- 数据：`getSelectedAccount`（`@/utils/accountService`）、`roleDataService`（`@/utils/roleDataService`）、`logError`（`@/utils/logger`）
- 图片：`Img`（`@/utils/imageLoader`）、`useImageRequest`（`@/utils/imageCacheManager`）
- 类型：`CharDetailData` / `CharacterItem`（`@/types/charDetail`）
- React：`useState/useEffect/useMemo/useRef/useCallback`、`createPortal`（react-dom）、`useTranslation`（react-i18next）

### 内部结构总览

| 区间 | 内容 |
| --- | --- |
| L1–L16 | import 声明 |
| L18–L20 | 图标路径常量 `ICON_BASE`、`PROFESSION_ICON`、`PROPERTY_ICON` |
| L22–L23 | `FilterKey` 联合类型（六个筛选维度） |
| L25–L50 | 稀有度配色辅助：`rarityLineColor`、`rarityTone`、`rarityToneClass` |
| L52–L56 | `FloatSelectOption` 接口 |
| L58–L181 | `FloatSelect` 浮动下拉筛选组件（含 document.body portal 定位） |
| L183–L190 | `getSubProperty`：从 tags 中取非主属性作为副属性 |
| L192–L275 | `OperatorCard`：角色卡片（封面、职业/属性图标、潜能、精化阶段、等级、稀有度色条） |
| L277–L307 | `CharactersPage` 状态声明、`getPageScroller`、`filters` 状态与 `setFilter`/`resetFilters` |
| L309–L338 | `loadData` 数据加载；挂载 effect 与 `accountChanged` 事件监听 |
| L340–L399 | useMemo 派生数据：排序、各维度去重选项（mainAttr 复用 property） |
| L401–L444 | `filteredCharacters` 组合筛选；`gridAvatarPaths` 图片预取 |
| L446–L454 | `handleCharClick` / `handleCloseDetail` |
| L456–L639 | JSX 渲染：标题计数（L458–L468）、加载态（L470–L483）、空数据态（L484–L504）、筛选工具条（L507–L589）、角色网格（L591–L620）、详情 Modal（L624–L635）、回到顶部（L637） |

### 组件与函数清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ICON_BASE` | L18 | 图标根路径 `/assets/icons` |
| `PROFESSION_ICON` | L19 | 职业图标路径生成函数 |
| `PROPERTY_ICON` | L20 | 属性图标路径生成函数 |
| `FilterKey` | L22 | 筛选键类型：`profession/rarity/property/weapon/mainAttr/subAttr` |
| `rarityLineColor` | L25 | 稀有度 → 卡片底边颜色（6★ `#ff7100`、5★ `#ffcc00`、4★ `#b380ff`，其余 transparent） |
| `rarityTone` | L38 | 稀有度 → 语义色调（orange/gold/purple/blue） |
| `rarityToneClass` | L45 | 色调 → Tailwind 文本类名映射表 |
| `FloatSelectOption` | L52 | 下拉选项接口（value/label/tone） |
| `FloatSelect` | L58 | 通用浮动下拉：L75–L94 点击外部/滚动关闭，L98–L109 按钮定位计算，L111–L180 渲染（L141–L178 portal 到 `document.body`） |
| `getSubProperty` | L183 | 取 `charData.tags` 中第一个不同于主属性的 tag 作为副属性 |
| `OperatorCard` | L192 | 单角色卡片；L200 封面取值优先级 illustrationUrl > avatarRtUrl > avatarSqUrl；L238–L246 潜能图标；L251–L262 精化阶段与等级 |
| `CharactersPage` | L277 | 默认导出页面组件 |
| ├ `getPageScroller` | L284 | 返回 `document.querySelector("main")`，供 `BackToTopFab` 使用 |
| ├ `filters` / `setFilter` / `resetFilters` | L289 / L297 / L299 | 六维筛选状态，默认全为 `"all"` |
| ├ `loadData` | L309 | 读取选中账号 → `roleDataService.getFullCharDetail(id)` → `setCharDetail` |
| ├ 账号切换 effect | L333–L338 | 监听 `window` `accountChanged` 重新加载 |
| ├ `sortedCharacters` | L340 | 稀有度降序 → 等级降序 → 中文名 `localeCompare` |
| ├ `uniqueProfessions` / `uniqueProperties` / `uniqueRarities` / `uniqueWeapons` | L353 / L363 / L371 / L379 | 各维度去重选项（稀有度按数值降序） |
| ├ `uniqueMainAttrs` | L389 | 直接别名 `uniqueProperties`（与主属性同源） |
| ├ `uniqueSubAttrs` | L391 | 收集所有角色的 `getSubProperty` 去重排序 |
| ├ `filteredCharacters` | L401 | 依次按六维筛选（L405–L427），依赖 `sortedCharacters` + `filters` |
| ├ `gridAvatarPaths` / `useImageRequest` | L432 / L444 | 批量预取网格头像到图片缓存 |
| ├ `handleCharClick` / `handleCloseDetail` | L446 / L451 | 打开/关闭角色详情 Modal |
| └ JSX 主体 | L456–L639 | 三分支渲染：加载中 / 无数据 / 列表；L624–L635 挂载 `CharSelectModal`（`initialViewMode="detail"`，`onSave` 为空操作） |

**备注**：
- **invoke 命令**：本文件**不直接调用**任何 `invoke`。数据经 `roleDataService.getFullCharDetail(roleId)`（roleDataService.ts L108 → `queryData(roleId, 'char_detail', [])` → L83 `invoke('query_role_data', { roleId, apiName, paths })`）间接走 IPC；账号 ID 来自 `getSelectedAccount()`（内部 `invoke('get_selected_account')`）；图片缓存经 `useImageRequest` → imageCacheManager（内部 `invoke('get_image_cache_dir')` / `invoke('read_image_file')`）。
- **配置键**：无（未使用 `configService` / `localStorage` / `sessionStorage`）。
- **i18n key 前缀**：`sidebar.*`（`sidebar.characters` L460）、`common.*`（`common.characters` L465、`common.no_results_found` L501/L607、`common.clear` L572）、`filters.*`（`filters.profession` L509、`filters.all_professions` L512、`filters.rarity` L518、`filters.all_rarities` L521、`filters.property` L531、`filters.all_properties` L534、`filters.weapon` L540、`filters.all_weapons` L543、`filters.mainAttr` L549、`filters.all_mainAttrs` L552、`filters.subAttr` L558、`filters.all_subAttrs` L561）。
- **数据流**：`getSelectedAccount()`（后端 `get_selected_account`，返回 roleId）→ `roleDataService.getFullCharDetail(roleId)` → 后端 `query_role_data`（apiName `char_detail`）→ 结果 `result.__full__`。**缓存位置**：`roleDataService.ts` L17 的模块级 `queryCache: Map<string, Promise<QueryResult|null>>`，key 为 `roleId|apiName|paths`（L19–L21），组件重挂载时命中同一 Promise，不重复 IPC；角色数据本体由后端从本地 JSON 提供。页面自身只在 `charDetail` state 中保存一份引用，无页面级持久化。
- **事件**：`window` 的 `accountChanged`（L335）。
- **静态资源路径**：`/assets/icons/potential/potential_{level}.png`（L241）、`/assets/icons/evolve/phase-{phase}.png`（L253）、`/assets/icons/profession/{key}.png`、`/assets/icons/property/{key}.png`。
- 备注异常：`mainAttr` 与 `property` 两个筛选项数据源相同（L389），且在 `filteredCharacters`（L419–L423）中同样比较 `data.property.value`，两者实际效果重复。

## `src/pages/gacha-records.tsx`

**文件职责**：抽卡（寻访）记录页。支持**终末地与《明日方舟》两种角色**的记录读取、联网同步、分类/卡池/稀有度/关键字筛选、赠送十连分组与分页表格展示，并渲染统计卡片、星级分布图表与保底柱状图。

> ⚠️ **两个游戏的抽卡 API 完全不同**（端点、token 参数名、卡池枚举、翻页游标、稀有度基准、失败语义），
> 但**后端在入库时已把明日方舟的记录归一化成与终末地相同的 `GachaRecord`**（`rarity` 统一为星数、
> `seqId` 合成、`kind` 固定 `draw`），因此本页的统计、图表、筛选、表格**不需要按游戏分支**。
> 页面只在三处感知游戏差异：**分类集合**、**是否请求武器寻访**、**是否显示「赠送十连」筛选**。
> 差异明细见 [services_others.md](../backend/services_others.md) 的 `arknights_gacha_service.rs` 一节。

**导出**：`export default function GachaRecordsPage()`（L119）——路由页面组件，无其他导出。

> **⚠️ 游戏标识**：角色下拉的每一项、折叠态按钮、页面副标题都必须带 `AccountNameLine`
> （昵称 + **紧跟其后**的游戏徽标，垂直居中），`GameBadge` 不推到行尾 —— 行尾留给选中勾。
> 「服务器 · 等级」自成一行且不含游戏信息。同一列表里混着终末地与明日方舟，两个游戏官服角色的
> 服务器名都叫「官服」，只写服务器无法分辨。
> 详见 [ui_components.md](ui_components.md#srccomponentsuigame-badgetsx)。

**主要依赖**：
- Tauri：`invoke`（`@tauri-apps/api/core`）、`listen` / `UnlistenFn`（`@tauri-apps/api/event`）
- UI：`GlassButton` / `GlassCard` / `GlassProgressCircle` / `GlassSelect`（`@/components/ui/glass`）、`SimplePagination`（`@/components/simple-pagination`）、`CustomModal` 系列（`@/components/custom-modal`）、`RefreshIcon` / `ChevronDownIcon` / `CheckIcon`（`@/components/ui/app-icon`）、`SearchIcon`（`@/components/icons`）、`clsx`
- 图表组件：`GachaPityChart`（`@/components/gacha-pity-chart`）、`GachaStatCharts`（`@/components/gacha-stat-charts`）
- 数据：`getSelectedAccount` / `getAccounts` / `Account` / **`GameId`**（`@/utils/accountService`）、`resolveServerLabel`（`@/types`）、`logError`（`@/utils/logger`）、`addMessage`（`@/utils/messageStore`）、`Img`（`@/utils/imageLoader`）
- 类型：**`ArknightsGachaCategory`** / `GachaCategory` / `GachaPoolKind` / `GachaRecord` / `GachaSyncProgress` / `GachaSyncResult` / `SavedGachaData` / `SavedWeaponGachaData`（`@/types/gacha`）

### 内部结构总览

| 区间 | 内容 |
| --- | --- |
| L1–L32 | import 声明（含 `@/types/gacha` 类型与 `GameId`） |
| L34–L42 | `CATEGORIES` **全部**分类常量（all/special/joint/normal/weapon，中英标签）。⚠️ 不是所有游戏都有全部分类 |
| L44–L45 | `ARKNIGHTS_CATEGORY_KEYS = ["all","special","normal"]` —— 明日方舟无联合寻访、无武器寻访 |
| L47–L52 | `RARITY_OPTIONS` 稀有度筛选项（null/6/5/4） |
| L54–L75 | `isU8UnauthorizedError` / `isArknightsTokenRejected` / `describeGachaSyncError`：后端英文错误 → 面向用户文案（含明日方舟「空列表 = 鉴权失败」的专门提示） |
| L77–L96 | `poolKindOf`：记录 → 卡池类型推断（优先 pools 元信息；前缀兜底**两侧规则分开写**：终末地 `joint_`/`standard*`，明日方舟 `CLASSIC*`→normal，其余→special） |
| L98–L104 | `formatCategoryName`：明日方舟分类名含 `\n`，压成 `·` 单行 |
| L106–L117 | `tabLabel`：同步进度 tabKey → 中/英显示名 |
| L119–L203 | `GachaRecordsPage` 状态声明（含 **`game`**、**`akCategories`**）、`loadSaved`、`loadWeaponSaved`、**`loadAkCategories`** |
| L206–L237 | `initRole`：**先按角色定游戏**，再决定是否拉 `cate` 分类 |
| L230–L251 | 生命周期 effect：初始化、`accountChanged` 监听、角色下拉点击外部关闭 |
| L253–L266 | `gacha-sync-progress` 事件监听（Tauri event，**两个游戏共用同一事件名**） |
| L268–L354 | `handleSync` 同步主流程（调用 invoke、**按游戏决定是否请求武器**、toast、结果/错误处理、完成后重载 + 重新枚举分类） |
| L356–L370 | `handleSelectRole`（切换角色时同步切游戏与分类）、`selectedAccount` |
| L372–L395 | **`categories`**：按游戏裁剪的分类集合（明日方舟只有 all/special/normal）；切到明日方舟时把停用的分类归位到 `all` |
| L397–L407 | 数据源选择（角色/武器分离）与 `stats` 统计计算 |
| L409–L411 | **`supportsFreePull`**：赠送十连仅终末地有，明日方舟隐藏该筛选 |
| L413–L415 | 关闭 `supportsFreePull` 时清掉 `onlyFree`（避免残留隐形过滤） |
| L417–L440 | `lastSyncText`、`poolOptions`（卡池下拉选项）、`hasActiveFilter` |
| L442–L461 | `records` 主筛选流水线（kind/分类/卡池/稀有度/NEW/赠送/关键字） |
| L463–L484 | `recordGroups`：连续同卡池的赠送记录合并为「赠送十连」组 |
| L486–L519 | 分页：`PageItem` 类型、`PAGE_SIZE=20`、`totalRecords`、`totalPages`、`pageGroups` 切片（含跨页 continuation） |
| L521–L529 | 筛选变化回第一页；切换分类重置 `onlyFree` |
| L531–L559 | 早退分支：加载中 / 错误页 |
| L561–L776 | JSX header：标题与账号信息、角色下拉菜单、同步按钮 |
| L777–L794 | 无数据空态（**明日方舟额外列出服务端当前可查的分类** —— 只有 90 天窗口，"0 条"需要有据可查） |
| L796–L847 | 统计卡片行（总抽/6★/5★/4★，含 RATE 与 AVG） |
| L849–L855 | `GachaStatCharts` 图表渲染（星级分布/六星间隔/六星累计） |
| L857–L864 | `GachaPityChart` 保底柱状图渲染 |
| L866–L1034 | 记录表格卡片：标题与条数、筛选栏、空态、表格、分页 |
| L1042–L1109 | 分类切换条（`categories` 渲染）：`sticky` 悬浮于内容区底部；指示器宽度按 `categories.length` 计算 |
| L1111–L1178 | 同步进度 `CustomModal`（错误/进行中/完成三态） |
| L1179–L1181 | `pctText` 百分比格式化 |
| L1183–L1190 | `RARITY_COLORS` 稀有度配色表 |
| L1192–L1204 | `formatTime`、`rarityColor` |
| L1206–L1245 | `RecordRow` 表格行组件 |
| L1247–L1276 | `StatCard` 统计卡片组件 |

### 组件与函数清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CATEGORIES` | L33 | 五分类常量：`all`/`special`（限定）/`joint`（联合）/`normal`（常驻）/`weapon`（武器），每项含 `labelZh`/`labelEn` |
| `RARITY_OPTIONS` | L41 | 稀有度过滤按钮组（全部/6★/5★/4★） |
| `poolKindOf` | L49 | `GachaRecord` + pools 元信息 → `GachaPoolKind`；poolType 含 `Joint`→joint、含 `Standard`→normal、否则 special；无元信息时按 `poolId` 前缀 `joint_`/`standard` 推断 |
| `tabLabel` | L62 | 进度 tabKey 前缀 → 中/英标签（weapon/joint/normal/限定兜底） |
| `GachaRecordsPage` | L69 | 默认导出页面组件 |
| ├ `loadSaved` | L98 | `invoke("get_saved_gacha_records", { roleId })` → `setSaved`，失败写 `error` |
| ├ `loadWeaponSaved` | L109 | `invoke("get_saved_weapon_gacha_records", { roleId })` → `setWeaponSaved`，失败置 null |
| ├ `loadAkCategories` | L192 | `invoke("get_arknights_gacha_categories", {roleId})` → `akCategories`。失败（未授权/token 失效）**静默置空**，不当作页面级错误 |
| ├ `initRole` | L207 | 并行取 `getSelectedAccount()` + `getAccounts()`，过滤 online/offline，选中项回退首个可用账号；**先按角色定 `game`**，再并行加载记录（明日方舟额外拉 `cate` 分类） |
| ├ 账号切换 effect | L235–L239 | `window` `accountChanged` → `initRole()` |
| ├ 角色菜单关闭 effect | L242–L251 | 点击 `roleMenuRef` 外部关闭 |
| ├ 进度监听 effect | L254–L266 | `listen("gacha-sync-progress")`，payload 为 `GachaSyncProgress`，`done` 时 `setSyncing(false)`。**两个游戏共用同一事件名** |
| ├ `handleSync` | L268 | 同步入口：同步中再点仅重开进度窗；并发调用 `sync_gacha_records`（**后端按游戏自动分流**）与 `sync_weapon_gacha_records`（**仅终末地**；明日方舟用 `Promise.resolve(null)` 短路，不发请求），通过 `syncRequestRef` 序列号丢弃过期请求；合并结果并 `addMessage`（tag `"gacha"`，明日方舟的文案不含武器分项）；失败 toast + 重开窗口；`finally` 重载记录，明日方舟还要重新枚举分类（`cate` 是活的） |
| ├ `handleSelectRole` | L356 | 本地切换角色（仅本页生效）；**同时切 `game`、重置 `category`/`akCategories`**，明日方舟则拉分类 |
| ├ `selectedAccount` | L364 | `accounts` 中匹配 `roleId` 的项 |
| ├ `categories` | L383 | **按游戏裁剪的分类集合**：明日方舟只有 `all`/`special`/`normal`（无联合、无武器） |
| ├ 分类归位 effect | L389 | 切到明日方舟且当前停在 joint/weapon → 回到 `all` |
| ├ `isWeapon` / `active` | L398 / L399 | 分类为 weapon 时取 `weaponSaved`，否则 `saved` |
| ├ `supportsFreePull` | L409 | 赠送十连**仅终末地**有；明日方舟隐藏该筛选按钮 |
| ├ 关闭赠送筛选 effect | L413 | `supportsFreePull` 为 false 时清掉 `onlyFree`（否则残留一个按钮已隐藏但仍在生效的过滤条件） |
| ├ `isCharDraw` | L443 | `all` 分类全收，否则按 `poolKindOf` 匹配当前分类 |
| ├ `stats` | L446 | 过滤 `kind === "draw"` 且属于当前分类；统计 total/6★/5★/4★、`avgSix`（共享 `calculateGachaSixStarIntervals`，逐池计算六星事件间隔后取平均）、`avgFive`（total/(five+six)）与三个占比。**与游戏无关**：`rarity` 已由后端归一化为星数 |
| ├ `lastSyncText` | L417 | `lastSyncTime` 按语言本地化格式化 |
| ├ `poolOptions` | L419 | 按记录出现顺序（新→旧）收集去重卡池，显示名优先 `r.poolName` > pools 元信息 > poolId |
| ├ `hasActiveFilter` | L439 | 关键字/稀有度/NEW/赠送 任一激活 |
| ├ `records` | L442 | 多条件过滤；关键字匹配 `charName/weaponName/nameText/poolName` 拼接；武器分类忽略 `onlyFree` |
| ├ `recordGroups` | L463 | 连续 `isFree` 且同 poolId 的记录合并为数组组，其余为单条（明日方舟 `isFree` 恒空，因此每条都是单条） |
| ├ `PageItem` / `PAGE_SIZE` | L487 / L490 | 分页条目类型（single/gift+continuation）与每页 20 条 |
| ├ `totalRecords` / `totalPages` | L491 / L495 | 按组内实际条数累计；`Math.max(1, ceil(n/20))` |
| ├ `pageGroups` | L497 | 跨组切片，赠送组被分页截断时标 `continuation`，供表格显示分割线 |
| ├ 回第一页 effect | L522 | 任一筛选变化 → `setPage(1)` |
| ├ 分类重置 effect | L527 | 分类变化 → `setOnlyFree(false)` |
| ├ JSX 主体 | L561–L1109 | 见「内部结构总览」 |
| `pctText` | L1179 | `ratio` → 一位小数百分比字符串 |
| `RARITY_COLORS` | L1183 | 6/5/4 星的 text/badge/badge 背景类名 |
| `formatTime` | L1192 | 毫秒时间戳字符串 → 本地化时间 |
| `rarityColor` | L1196 | 稀有度 → 配色，未知值兜底灰色系 |
| `RecordRow` | L1206 | 表格行：稀有度徽章、名称 `weaponName ?? charName ?? nameText`、卡池、时间、NEW 标记 |
| `StatCard` | L1247 | 统计卡：label + value + 可选 `RATE`/`AVG` 侧栏 |

**备注**：
- **invoke 命令（全部 5 个，均在本文件）**：
  - `get_saved_gacha_records`（参数 `{ roleId }`）——读本地角色寻访记录（**后端按游戏分流读档**）
  - `get_saved_weapon_gacha_records`（参数 `{ roleId }`）——读本地武器寻访记录（明日方舟返回空）
  - `sync_gacha_records`（参数 `{ roleId }`）——联网同步角色寻访（**后端按游戏自动选端点**）
  - `sync_weapon_gacha_records`（参数 `{ roleId }`）——联网同步武器寻访（**仅终末地调用**）
  - **`get_arknights_gacha_categories`**（参数 `{ roleId }`）——仅明日方舟，拉 `cate` 分类
  - 间接调用：`getSelectedAccount()` → `invoke('get_selected_account')`、`getAccounts()` → `invoke('get_accounts')`（accountService.ts L433/L196）；`Img` → imageCacheManager（`get_image_cache_dir` / `read_image_file`）；子组件 `GachaPityChart` 内部另有 `invoke("resolve_gacha_avatar_map", { roleId })`（gacha-pity-chart.tsx L280）。
- **两个游戏的差异只在这一页的三处**（其余全部共用）：① `categories` 裁剪；② `handleSync` 是否请求武器；③ `supportsFreePull` 隐藏「赠送十连」。**统计、图表、筛选、表格完全共用**，因为后端已把明日方舟记录归一化成与终末地相同的 `GachaRecord`。
- **配置键**：无（未使用 `configService` / `localStorage` / `sessionStorage`）。
- **i18n key 前缀**：仅 `sidebar.gacha`。其余全部文案为 `isZh ? 中文 : 英文` 手写分支（含分类标签、按钮、表头、进度文案等），不走 `t()`。
- **数据流与缓存**：
  - 读取路径：`initRole` → `invoke("get_saved_gacha_records" / "get_saved_weapon_gacha_records")` → `saved` / `weaponSaved` state。后端不联网，数据来自磁盘 JSON：终末地角色记录 `app_data_dir/gacha_records/gacha_records_{userId}_{serverId}.json`、武器记录 `gacha_weapon_records_{userId}_{serverId}.json`；**明日方舟 `app_data_dir/gacha_records/arknights_gacha_records_{uid}.json`（只按 uid）**（见 src-tauri/src/utils/paths.rs）。
  - 同步路径：`handleSync` → 后端 `sync_gacha_records` / `sync_weapon_gacha_records` 联网抓取并写盘 → 进度经 Tauri 事件 `gacha-sync-progress`（payload 字段 `tabKey`/`tabIndex`/`tabCount`/`page`/`tabFetched`/`totalFetched`/`done`）→ 完成/失败经 `addMessage`（messageStore，tag `"gacha"`）→ `finally` 重新读盘刷新 state。
  - 前端**无额外持久化缓存**，`saved`/`weaponSaved` 仅存于组件 state，页面卸载即丢；切换角色/账号变化会整体重置。
- **统计逻辑位置**：`stats` useMemo；`pctText`；统计卡片 JSX；`StatCard` 组件。
- **图表渲染逻辑位置**：`GachaStatCharts`（props：`records`/`pools`/`category`/`isWeapon`/`isZh`，星级分布、六星间隔分布、六星累计，计算在该子组件内）；`GachaPityChart`（props：`roleId`/`records`/`pools`/`category`/`isZh`，顺时针旋转 90° 保底柱状图，子组件内部另调 `resolve_gacha_avatar_map`）。
- **同步逻辑位置**：`handleSync`；进度事件监听；进度 Modal（错误态/进行中/完成态）；`tabLabel` 用于进度文案。
- **事件**：Tauri event `gacha-sync-progress`（两游戏共用）；`window` `accountChanged`。
- **筛选栏宽度约束**：稀有度分段控件（`RARITY_OPTIONS`，记录表格筛选栏内，行尾为 NEW / 赠送十连按钮）整条带 `shrink-0`，四个按钮 `flex-1 min-w-10 whitespace-nowrap`。它是该行里唯一能被压到比文字还窄的元素（卡池 `GlassSelect` 自带 `shrink-0`、搜索框有 `min-w-44` 下限），一旦被压缩，「全部」会折成两行溢出胶囊，看起来像排版坏掉；窗口更窄时由该行的 `flex-wrap` 换行承接，不要去掉这几个类。
- 备注异常：
  1. `stats` useMemo 依赖数组为 `[active, category, isWeapon]`，内部使用了每渲染重建的 `isCharDraw` 闭包，未显式列入依赖（当前因 `category` 已覆盖而结果正确，但属易碎写法）。
  2. `handleSync` 的 `finally` 捕获的是触发同步时的 `roleId`，若同步期间本地切换角色会重载旧角色数据（实际同步中角色菜单被禁用，风险极低）。
  3. 表格「标记」列仅渲染 NEW，`isFree` 的展示完全依赖赠送十连分组行，行内无赠送标记。
  4. **明日方舟记录只有 90 天**：空态时额外列出服务端当前可查的分类，避免「0 条」被误解成同步失败。

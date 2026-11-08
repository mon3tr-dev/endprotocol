# 类型定义、国际化与全局样式 — 文件功能参考

> 逐文件精读生成。行号基于当前工作区版本，仅用于快速定位。

## `src/types/card-settings.ts`
**职责**：Dashboard 各类卡片的「配置(settings)」类型定义。每种卡片一个 settings 接口，通过 `CardSettingsMap` 按卡片类型 ID 注册成联合映射，供卡片配置读写时做类型索引。

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| `SortOrder` (type) | card-settings.ts:3 | 排序方式联合类型：`"rarity" \| "name" \| "level"` |
| `CharacterListDisplayMode` (type) | card-settings.ts:5 | 角色列表显示列数：`"single" \| "double" \| "triple"` |
| `CharacterListCardSettings` (interface) | card-settings.ts:10 | 字段：selectedCharIds?: string[]（选中角色ID）、sortOrder?: SortOrder、displayMode?: CharacterListDisplayMode、roleId?: string（卡片级自定义角色ID，独立于 tab 的 defaultRoleId） |
| `AttendanceCardSettings` (interface) | card-settings.ts:20 | 字段：selectedRoleId?: string —— 作为签到账户的角色 |
| `AchievementCardSettings` (interface) | card-settings.ts:27 | 蚀刻章卡片。字段：selectedMedalIds?: string[]、featuredMedalId?: string、useDisplayList?: boolean、roleId?: string |
| `AccountInfoCardSettings` (interface) | card-settings.ts:37 | 字段：roleId?: string |
| `AccountProgressCardSettings` (interface) | card-settings.ts:44 | 字段：roleId?: string |
| `DomainInfoCardSettings` (interface) | card-settings.ts:51 | 字段：roleId?: string、domainId?: string（区域ID，默认第一个） |
| `SpaceshipCardSettings` (interface) | card-settings.ts:59 | 帝江号卡片。字段：roleId?: string |
| `TestCardSettings` (interface) | card-settings.ts:66 | 示例卡片。字段：customData?: any |
| `TodoCardSettings` (interface) | card-settings.ts（`TestCardSettings` 之后） | To-Do 卡片。字段：`listId?: string`（绑定到 `todo_lists` 中的一个列表） |
| `CardSettingsMap` (type) | card-settings.ts（文件末尾） | 卡片类型 ID → settings 接口的映射：character_list / attendance / achievement / account_info / account_progress / domain_info / spaceship / test_card / **system_resource / todo**（新卡片在此注册）；文件顶部 `import type { SystemResourceCardSettings } from "./system-resource"` |
| `BaseCardSettings` (interface) | card-settings.ts:88 | 通用逃生舱口：`[key: string]: any` |

## `src/types/system-resource.ts`
**职责**：系统资源卡片的类型、指标目录与全局默认值；同时定义与后端 `SystemSnapshot` 对应的快照类型。
**导出**：`ResourceCategory`、`MetricDisplayMode`、`MetricValueKind`、`ByteUnitSystem`、`MetricPrecision`、`SystemResourceSizeTier`、`SystemResourceSizePreset`、`SIZE_PRESETS`、`sizeTier`、`ResourceMetricId`、`MetricDefinition`、`METRIC_CATALOG`、`METRIC_ORDER`、`ResourceMetricConfig`、`SystemResourceCardSettings`（含 `settingsVersion`、`rotateMs`）、`SystemResourceDefaults`（含 `rotateMs`）、`DEFAULT_SYSTEM_RESOURCE_DEFAULTS`、`ResourceGroupTemplate`（含 `tier`）、`RESOURCE_GROUP_TEMPLATES`、`REFRESH_PRESETS`、`RESOURCE_ACCENT_PRESETS`、`createMetricConfig`、`buildDefaultCardSettings`，以及快照类型 `SystemSnapshot`/`CpuSnapshot`（含 `frequencyIsActual`）/`MemorySnapshot`/`GpuSnapshot`/`DiskSnapshot`/`NetworkSnapshot`/`TemperatureReading`/`CpuCoreInfo`。

**要点**：`METRIC_CATALOG` 收录 17 个指标（CPU 3、GPU 5、内存 3、磁盘 3、网络 3），每项标注 `category/kind/labelKey/defaultDisplay/percentual/deviceScope`；`labelKey` 指向卡片 `locales/*.json`（`card:` 命名空间）。删除的指标：核心数（cpu_cores）、显存占比（gpu_memory_percent）、缓存（memory_cached）。`RESOURCE_GROUP_TEMPLATES` 定义 CPU / 内存 / 磁盘 / 网络（中卡 3×3）与 GPU / 性能总览 / 全量监控（大卡 4×3）预设组，每组带 `tier`。尺寸固定三档 `SIZE_PRESETS`（小 2×2 / 中 3×3 / 大 4×3），新增卡片时按预设确定尺寸且设置中不再允许更改；小卡仅允许 1 个指标，中/大卡按需配置全部不重复指标并通过分页查看。快照类型字段与 Rust `#[serde(rename_all = "camelCase")]` 一一对应。

## `src/types/todo.ts`
**职责**：To-Do 卡片/页面的数据模型、默认值与模板常量。
**导出**：`TodoPriority`(0-3)、`TodoSortMode`、`TodoFilter`、`TodoIconId`、`normalizeTodoIcon`、`TodoSubtask`、`TodoItem`、`TodoList`、`TodoDefaults`、`DEFAULT_TODO_DEFAULTS`、`TODO_COLORS`、`TODO_ICONS`、`PRIORITY_LABELS`、`PRIORITY_COLORS`、`TodoTemplate`、`TODO_TEMPLATES`、`SORT_MODE_OPTIONS`、`FILTER_OPTIONS`。

**要点**：一个 `TodoList` 对应一张卡片；`TodoItem` 含 `content/done/priority/due/tags/subtasks/note/order`；`TodoList.dailyResetEnabled`/`dailyResetTime`/`lastDailyResetDate` 保存每日定时清空设置。图标以 `TodoIconId` 持久化并由 `TodoIcon` 渲染；`normalizeTodoIcon` 将旧版 emoji 值迁移为图标 ID。`TODO_TEMPLATES` 提供 6 个面向游戏辅助场景的模板：`blank`（空白）/`daily`（每日任务）/`weekly`（周常任务）/`event`（活动限时）/`cultivation`（养成计划）/`resource`（资源规划），标题与事项文案均为 i18n key（前缀 `todo_template_`）。

## `src/types/charDetail.ts`
**职责**：角色详情接口（`CharDetailResponse`）与 Wiki 物品详情接口的完整响应类型；同时包含成就/蚀刻章数据类型。是最大的类型文件（350 行）。

**角色详情主链路**：

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| `CharDetailResponse` | charDetail.ts:3 | 顶层响应：code / message / timestamp / data: CharDetailDataWrapper |
| `CharDetailDataWrapper` | charDetail.ts:10 | 包一层：`detail: CharDetailData` |
| `CharDetailData` | charDetail.ts:14 | 字段：base: BaseInfo、chars: CharacterItem[]、bpSystem?、dailyMission?、weeklyMission?、achieve?: AchieveData、currentTs?；dungeon/spaceShip/domain/quickaccess/config 均为 `any`（未建模） |
| `BaseInfo` | charDetail.ts:29 | 账户基础信息：serverName、roleId、name、createTime、saveTime、lastLoginTime、exp、level、worldLevel、gender、avatarUrl、mainMission、charNum、weaponNum、docNum |
| `MainMission` | charDetail.ts:47 | `{ id, description }` 主线任务 |
| `CharacterItem` | charDetail.ts:52 | 角色实例：charData: CharacterData、id、level?、evolvePhase?、potentialLevel?、talent?: TalentNodes、wikiItemId?；装备字段（weapon/bodyEquip/armEquip/firstAccessory/secondAccessory/tacticalItem/userSkills）均为 `any` |
| `CharacterData` | charDetail.ts:69 | 角色静态数据：name、avatarSqUrl/avatarRtUrl、rarity、profession、property、weaponType、skills: SkillInfo[]、illustrationUrl、tags、abilityTalents/combatTalents/cultivationTalents?: TalentInfo[] |
| `RarityInfo` / `ProfessionInfo` / `PropertyInfo` / `WeaponTypeInfo` | charDetail.ts:86 / :91 / :96 / :101 | 统一的 `{ key, value }` 枚举值对（value 为中文文案，如 "6"、"术师"、"寒冷"、"手铳"） |
| `SkillInfo` | charDetail.ts:106 | 技能：id、name、type: SkillTypeInfo、property、iconUrl、desc、descParams / descLevelParams: Record<string,any>、forms?: SkillForm[] |
| `SkillForm` | charDetail.ts:118 | 技能形态：type、name、iconUrl、descs: string[] |
| `SkillTypeInfo` | charDetail.ts:125 | `{ key, value }`（如 "普通攻击"、"战技"） |
| `TalentInfo` | charDetail.ts:130 | 天赋：id、name、iconUrl、desc、descParams?、lockedIconUrl |
| `TalentNodes` | charDetail.ts:139 | 已激活天赋节点集合：latestBreakNode、attrNodes（能力天赋）、latestPassiveSkillNodes（战斗）、latestFactorySkillNodes（制造）、latestSpaceshipSkillNodes（培养） |

**Wiki 相关（charDetail.ts:147 起）**：

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| `WikiCatalog` / `WikiCatalogData` / `WikiCatalogEntry` / `WikiTypeSub` | charDetail.ts:150 / :157 / :161 / :166 | Wiki 分类目录树：typeMain → typeSub[]（typeSubId/typeSubName/items[]） |
| `WikiCatalogItem` | charDetail.ts:173 | 目录物品条目：itemId、name、iconUrl?、rarity?、type?，含 `[key: string]: any` |
| `WikiItemResponse` / `WikiItemData` | charDetail.ts:183 / :190 | 物品详情响应：`data.item: WikiItemDetail` |
| `WikiInlineElement` | charDetail.ts:195 | 文档内联元素，`kind: "text" \| "link" \| "image"` + text/image 载荷 |
| `WikiDocumentBlock` | charDetail.ts:202 | 文档块：`kind: "text" \| "heading3" \| "horizontalLine" \| "image" \| "quote" \| "table"`，含 parentId/align、text.inlineElements、tableList、tabList/tabDataMap |
| `WikiDocTab` / `WikiTabData` / `WikiTabIntro` | charDetail.ts:219 / :226 / :233 | 文档 Tab 型条目的页签定义（tabId/title/icon）、数据（intro/content/audioList）、页签头（name/type/imgUrl/description） |
| `WikiBlockDocumentEntry` / `WikiTabDocumentEntry` / `WikiDocumentEntry` | charDetail.ts:241 / :248 / :256 | 两种文档条目形态：block 型（blockIds + blockMap）与 tab 型（tabList + tabDataMap），`WikiDocumentEntry` 为二者联合 |
| `WikiAssociate` / `WikiSubTypeEntry` / `WikiTypeInfo` | charDetail.ts:259 / :267 / :273 | 关联对象、子类型映射、主/子分类信息（含 status/position/fatherTypeId/icon 等） |
| `WikiItemDetail` | charDetail.ts:287 | 物品详情主体：itemId、name、brief?、document{documentMap, associate, dotType, subTypeList, composite, disableCoverShowInDetail}、mainType/subType: WikiTypeInfo、status、publishedAtTs、lastAuditPassedAt、tagIds |

**其他**：

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| `BpSystem` | charDetail.ts:310 | `{ curLevel, maxLevel }` 通行证等级 |
| `DailyMission` | charDetail.ts:315 | `{ dailyActivation, maxDailyActivation }` 每日活跃度 |
| `WeeklyMission` | charDetail.ts:320 | `{ score, total }` 周任务积分 |
| `AchievementData` | charDetail.ts:327 | 成就静态数据：id、name、initIcon、reforge2Icon、reforge3Icon、platedIcon、cateName、canCertify、cate、initLevel |
| `AchieveMedal` | charDetail.ts:340 | 已获得蚀刻章：achievementData、level、isPlated、obtainTs |
| `AchieveData` | charDetail.ts:347 | `{ achieveMedals: AchieveMedal[], display?: Record<string,string> }` |

## `src/types/dashboard.ts`
**职责**：仪表盘布局与标签页（Tab）配置类型：单张卡片的网格位置/设置、整盘配置、Tab 结构与可选图标常量。

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| `CardType` (enum) | dashboard.ts:4 | 仅剩 `CHARACTER_LIST = 'character_list'`，注释标注 deprecated，为向后兼容保留 |
| `CardTypeId` (type) | dashboard.ts:10 | `string`，实际使用的卡片类型标识（新卡片不再进 enum） |
| `CardConfig` (interface) | dashboard.ts:12 | 单卡实例：id(UUID)、type、position(从0开始)、x?/y?/w?/h?（网格列/行/宽/高）、settings: CardSettings |
| `CardSettings` (interface) | dashboard.ts:23 | 通用设置：title?、collapsed?、selectedCharIds?: string[]（character_list 专用）。注意与 card-settings.ts 的分类型设置并存 |
| `DashboardConfig` (interface) | dashboard.ts:29 | `{ cards: CardConfig[], lastUpdated: number }` 整盘配置 |
| `DashboardTab` (interface) | dashboard.ts:35 | 标签页：id、name、icon、tags: string[]、cards、defaultRoleId?、createdAt、updatedAt |
| `TAB_ICONS` (const) | dashboard.ts:46 | 15 个可选图标名元组（home/chart/users/star/heart/bookmark/tag/folder/calendar/bell/settings/account/search/developer/projects），`as const` |
| `TabIcon` (type) | dashboard.ts:64 | `(typeof TAB_ICONS)[number]`，由常量反推的字面量联合 |

## `src/types/gacha.ts`
**职责**：抽卡（寻访）模块类型：卡池分类、单条记录、本地保存数据、同步进度/结果、meta 中的 Tab 定义。与后端 Rust 模型一一对应（注释标注了来源）。

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| `GachaPoolKind` (type) | gacha.ts:2 | 卡池种类：`"special" \| "joint" \| "normal" \| "weapon"`（对应后端 meta tab key 前缀） |
| `GachaCategory` (type) | gacha.ts:5 | 页面分类 = GachaPoolKind + `"all"`（全部角色，不含武器） |
| `GachaRecord` (interface) | gacha.ts:8 | 单条记录：kind(draw/gift_intel_book)、poolId、poolName、nameText、charId?/charName?、武器字段 weaponId?/weaponName?/weaponType?、rarity?、isFree?、isNew?、gachaTs(毫秒时间戳字符串)、seqId(全局唯一序号) |
| `GachaPoolInfo` (interface) | gacha.ts:29 | `{ poolName, poolType }` 卡池信息 |
| `SavedWeaponGachaData` (interface) | gacha.ts:35 | 本地武器寻访存档：userId、serverId、lastSyncTime?、pools: Record<poolId, GachaPoolInfo>、records(从新到旧) |
| `SavedGachaData` (interface) | gacha.ts:45 | 本地抽卡存档，字段结构与 SavedWeaponGachaData 相同 |
| `GachaSyncProgress` (interface) | gacha.ts:55 | 同步进度事件：tabIndex/tabCount/tabKey/page/tabFetched/totalFetched/done + userId/serverId |
| `GachaSyncResult` (interface) | gacha.ts:68 | 同步结果：syncedAt、newRecords、totalRecords、perTabNew: Record<tabKey, number> |
| `GachaTab` (interface) | gacha.ts:78 | meta 卡池 Tab：key（`special` / `joint:{poolId}` / `normal`）、label?、poolType、poolId? |

## `src/types/index.ts`
**职责**：公共/杂项类型出口：图标组件 props、账户模型与同步状态、服务器标签的双语映射常量及解析函数。

| 类型 | 位置 | 说明 |
| --- | --- | --- |
| `IconSvgProps` (type) | index.ts:4 | `SVGProps<SVGSVGElement> & { size?: number }`，图标组件通用 props |
| `AccountServer` (type) | index.ts:9 | `"1" \| "2" \| string`（1=官服，2=Bilibili） |
| `AccountSyncStatus` (type) | index.ts:10 | `"SYNCING" \| "FAILED" \| "HYTOKEN_EXPIRED" \| null` |
| `AccountLike` (interface) | index.ts:16 | 账户最小模型：id、nickname、level、server、avatar?、syncStatus? |
| `AccountStatusMeta` (interface) | index.ts:25 | 状态展示元数据：tone(success/warning/danger/default)、label?、showLed? |
| `SERVER_LABEL` (const) | index.ts:35 | `Record<"1"\|"2", {zh, en}>` 服务器双语标签（官服/Bilibili服） |
| `resolveServerLabel()` (function) | index.ts:43 | 按 lang（zh 之外一律 en）解析服务器标签，未知值回退为原始 server 字符串 |

## `src/locales/zh/translation.json`
**职责**：中文 i18n 资源，共 867 行、789 个叶子 key、20 个顶层命名空间。
**顶层命名空间清单**（这是重点，要完整列出）：

| 命名空间/key 前缀 | 用途 | 大致行号 |
| --- | --- | --- |
| `startup.*` | Splash 启动文案（4 个 key） | :2 |
| `crash.*` | 崩溃提示与诊断导出文案（51 个 key） | :8 |
| `nav.*` | 顶部导航（dashboard/analytics/projects/team/calendar） | :61 |
| `menu.*` | 菜单（profile/settings/help） | :9 |
| `sidebar.*` | 侧边栏全部入口文案（含 characters/medals/attendance/gacha/todo/launcher/developer） | :14 |
| `common.*` | 通用文案：分页（common.pagination.* :32）、搜索、保存/取消/确认、刷新、删除/编辑、占位符统计卡片文案（totalRevenue 等模板遗留） | :31 |
| `filters.*` | 干员筛选器（profession/property/rarity/weapon/mainAttr/subAttr 及 all_* 全选项） | :78 |
| `settings.*` | 设置页总命名空间，`settings.title` :94 | :93 |
| `settings.general.*` | 通用设置：语言、主题（light/dark/system）、关闭窗口行为、托盘显示用户 | :95 |
| `settings.game_launch.*` | 游戏启动：取消下载行为、DX11 启动、校验线程数、游戏界面背景（视频/图片）、静默启动命令与启动选项 | :110 |
| `settings.appearance.*` | 外观：主题模式、主题色、窗口背景透明度/背景图/磨砂（旧「毛玻璃清晰度」已随 Liquid Glass 重构移除） | :119 |
| `settings.system_resource.*` | 系统资源卡片全局默认值（刷新/单位/显示/精度/布局/阈值/曲线/主题色/默认模板） | :145 |
| `settings.todo.*` | To-Do 卡片全局默认值（排序/隐藏已完成/优先级/截止时间/颜色/图标） | :170 |
| `settings.developer.*` | 开发者模式开关与确认警告 | :139 |
| `settings.update_channel.*` | 更新通道（stable/preview） | :148 |
| `settings.update_source.*` | 更新源（github/mirror） | :156 |
| `settings.update.*` | 应用更新流程文案：检查/下载/安装、版本信息、许可证(AGPL-3.0)、开源致谢 | :164 |
| `settings.account.*` | 账户管理：森空岛账户/游戏角色绑定、登出（含设备认证）、密码/验证码/扫码登录全流程 | :194 |
| `settings.notifications.*` | 通知设置（email/push） | :289 |
| `settings.cache.*` | 智能缓存：模式、条目/大小上限、缓存资源列表状态 | :294 |
| `settings.logs.*` | 日志查看器：来源过滤、日志级别、清空 | :320 |
| `settings.characters.*` | 干员固定（pin）槽位设置、天赋分页（能力/被动/基建） | :334 |
| `dashboard.*` | 仪表盘卡片增删/编辑模式、空态引导；子组 `dashboard.add_card.*` :368 | :355 |
| `role_select.*` | 角色绑定选择弹窗 | :373 |
| `account_switch.*` | 账户切换弹窗（搜索/计数） | :382 |
| `tab.*` | 标签页 CRUD、搜索、删除确认 | :388 |
| `character_detail.*` | 角色详情页 Tab（skills/talents/info）与空态文案 | :413 |
| `messages.*` | 消息中心：相对时间（分钟/小时/天前）、展开收起、下载状态 | :427 |
| `browser.*` | 内嵌浏览器工具栏：前进/后退/刷新/打开外部/关闭等（9 个 key） | :681 |
| `tray.*` | 托盘悬浮面板：品牌标题、理智/每日活跃/每周事务/通行证标签、等级、已满/回满/下次回复、未选用户提示、显示主窗口/退出（13 个 key） | :660 |
| `launcher.*` | 启动器：安装/更新/校验修复/渠道切换/预下载/预下载中/预下载确认/启动设置/磁盘与文件扫描等完整流程；子分组 `launcher.sidebar.*`（游戏界面右侧官方社媒栏：标题/打开网页提示/仅支持扫码，:842）（本文件最大分组，137 个 key） | :707 |
| `todo_page.*` | To-Do 页面：标题/描述、导入导出、新建/搜索列表、分组、空态等 | :644 |

- **与 en/translation.json 的 key 差异**：无。经脚本对比，zh 与 en 叶子 key 均为 789 个，键集合完全一致（既无 zh 缺键也无 en 缺键），且两文件结构逐行对齐（行号一一对应）。
- **异常（两边共有）**：`settings.update` 内存在重复键 —— `latest_version` 同时出现于 :177 与 :187、`release_date` 同时出现于 :179 与 :188。JSON 解析时后者覆盖前者（zh 实际生效值为 :187 的“远端最新版本”、:188 的“发布日期”；en 同理）。建议后续合并为 `latest_version_remote` 之类的独立键。

## `src/locales/en/translation.json`
**职责**：英文 i18n 资源，与 zh 文件同为 867 行、789 个叶子 key、20 个顶层命名空间，行号与 zh 完全对应（见上表）。
- 主要差异仅在文案语言，个别本地化选择值得注意：`settings.characters.cultivation_talents` zh 为“基建技能”而 en 为 “O.M.V. Dijiang Skills”（帝江号相关译名）；`settings.logs.level_*` en 使用大写日志级别（DEBUG/INFO/WARN/ERROR），`source_frontend/source_backend` 缩写为 FE/BE。
- 同样存在 `settings.update` 的 `latest_version` / `release_date` 重复键（:177/:187、:179/:188），与 zh 完全一致。

## `src/styles/globals.css`
**职责**：全局样式与设计令牌（Tailwind CSS v4 + CSS 变量体系）。定义浅/深色主题变量、`@theme` 映射、**Liquid Glass 设计体系**（`lg-*` 类族，替代旧 glassmorphism 工具类）、统一动效令牌与游戏内技能文本标记样式。

> ⚠️ **Liquid Glass 重构（本节替换旧「玻璃拟态工具类」描述）**：旧 `glass-surface/glass-surface-strong/glass-field/glass-window/glass-backdrop/glass-control-surface/account-glass-*` 与 `--glass-blur` 等运行时可调变量已整体移除，改为 Apple HIG Liquid Glass 分层体系。唯一保留的旧类名是 `glass-surface` / `glass-surface-strong` 的**冻结件兼容别名**（映射到 `.lg-regular`），仅供冻结的 `char-select-modal.tsx` 使用，业务代码禁止再引用。

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| 1 行 | `@import "tailwindcss"`（Tailwind v4 入口） |
| 3 行 | `@custom-variant dark` —— 深色变体以 `.dark` 类为作用域（`&:is(.dark *)`），即**类名切换式深色模式** |
| 6-96 行 | `@layer base` 主题令牌：`:root`（7-66 行）浅色变量；`.dark`（67-95 行）覆盖为深色变量 |
| 98-151 行 | `@theme inline` —— 把 CSS 变量桥接为 Tailwind 语义色（`--color-background`、`--color-primary` 等）并派生 radius 刻度 |
| 159-190 行 | `.glass-field` 原生玻璃输入控件（底色 + 模糊位于 `::before` 独立层；`input/textarea/select` 因不支持伪元素改为直接铺底色、去掉模糊） |
| 162-163 行 | `color-scheme` 过渡、移动端点击高亮重置 |
| 166-171 行 | Tauri 窗口背景变量组 + `body` 背景色（浅/深两套） |
| 234-236 行 | `html[data-window-effects="fallback"] body` —— 无原生窗口磨砂的平台（Linux / WebKitGTK、开发态浏览器）改用不透明的 `--background`，让 `.dashboard-background` 的主题渐变像 Windows 一样渲染出来；属性由 `@/utils/platform` 的 `applyWindowEffectsSupport()` 在首屏前写入 |
| 238-261 行（规则在 258-261） | `html[data-window-radius="self"]` —— 无边框窗口的圆角兜底：仅 Linux（WebKitGTK）生效（Windows 交 DWM、macOS 交系统），用 `clip-path: inset(0 round 12px)` 挂在根元素上，而不是 `overflow:hidden`，因为后者裁不住 `fixed` 后代 |
| 262-297 行 | `.dashboard-background` 固定背景层（背景图 + 三层渐变叠加 + blur） |
| 约 730-755 行 | `.dashboard-veil` 壁纸压暗层：`fixed` 铺满、`background: var(--background)`、`opacity: var(--bg-veil-opacity)`。壁纸是任意图片且透明度可拉到 1、模糊可拉到 0，只靠薄玻璃挡不住，必须由这一层把整体亮度压下来，正文对比度才可控。浅色主题 0.45（白纱）、深色主题 0.68（深纱），由 `.dark` 覆盖。层级：`.dashboard-background`（壁纸）→ `.frost-main`（磨砂）→ `.dashboard-veil`（压暗）→ 内容层（z-10） |
| 约 760 行 | `.titlebar-shell`（`z-index: 10`）——标题栏必须叠在 veil 之上；底色已由 `.lg-sheet` 实底改为渐变磨砂（见 `.frost-main`） |
| 约 762-790 行 | 文字对比度兜底：`.adaptive-contrast-text` 取 `--foreground`；`:is([class~="text-muted"], [class*="text-muted/"], text-gray-400/500/600)` 统一改为 `--muted`（**不再一律涂成 `--foreground`**，否则标题与次要信息同色、层级全丢）；`text-foreground/50`、`/60` 抬到 `--foreground`。**全局 `[class*="text-"]` 双向 text-shadow 已移除**（黑 55% + 白 65% 双层阴影会把中文小字号笔画染成灰边，形成「重影糊字」） |
| 206-224 行 | `.titlebar-mode-toggle` 标题栏模式切换胶囊动画（`.is-game` 右移） |
| 226-227 行 | `::selection` 选区配色 |
| 约 1250-1345 行 | 动画 keyframes 与 `.animate-*` 工具类（含系统资源指标切换的 `.animate-resource-page`、`fade-in` 系列、`spin-slow`，以及启动器下载按钮的 `.launcher-download-arrow`：只对 SVG 内部的 `<g>` 做 transform + opacity，不承载玻璃层也没有 backdrop-filter 后代，因此不受「opacity < 1 即成为 backdrop root」约束） |
| 257-265 行 | Banner 轮播「翻页推动」动画：`@keyframes banner-push-in/out-left/right` 与 `.animate-banner-push-*` 工具类（dashboard 游戏模式底部宣传图使用） |
| 267-283 行 | 页面转场（`.page-transition-enter/slide-up/scale-in`）与列表项级联动画 `.animate-list-item`（8 档 40ms 阶梯延迟） |
| 285-287 行 | 减少动态效果偏好下关闭系统资源指标切换动画 |
| 1510-1535 行 | 滚动条：全局隐藏（`scrollbar-width: none` + `::-webkit-scrollbar` 宽高 0）；被 `overlayScrollbar.ts` 接管的容器（`data-ovs`，`overflow-y: overlay`）显式恢复 `scrollbar-width: auto` 与 8px webkit 宽度，thumb 默认透明、hover 浮出灰色可拖动 |
| 约 644-908 行 | **玻璃拟态工具类**（详见下表；底色与 `backdrop-filter` 均在 `::before` 独立层，定位上下文在 `@layer components`） |
| 377-422 行 | 交互动效工具类：`.interactive-hover`、`.card-hover`、`.button-hover`、`.icon-hover`、`.nav-hover`、`.list-item-hover`、`.input-hover`、`.chip-hover`、`.switch-hover`、`.checkbox-hover`、`.modal-hover`、`.tooltip-hover`、`.dropdown-item-hover`、`.table-row-hover`、`.link-hover` |
| 424-430 行 | 状态发光阴影：`.shadow-glow-success/danger/warning`（深色模式加强） |
| 432-463 行 | 技能描述富文本标记：`.ba-tag`、`.ba-at-*` / `.ba-hash-*` / `.ba-tips-*` 系列属性关键字配色（cryst/key/vup/poise/speedup/slow/spellburst 等） |

**关键变量（`:root`，7-66 行）**：
- 色阶：`--default-50…900`、`--primary-50…900`、`--danger-50`
- 语义色：`--primary`、`--accent`、`--success`、`--info`、`--warning`、`--warning-dark`（浅色压深 `#b45309`，`.dark` 覆盖为 `var(--warning)` —— 它只当文字用，深色底上原压深值对比不足）、`--danger` 及各自 `-foreground`
- **文字专用色**（当同一颜色既要当背景/边框又要当文字时，文字走这一套，保证 ≥4.5:1）：
  - `--primary-text`：由 `applyPrimaryTextColor()`（`src/utils/theme.ts`）按当前底色动态计算并写入内联样式，浅色主题混黑、深色主题混白，只调明度不换色相。默认值 `#4f46e5`。**`text-primary` → Tailwind `text-primary-text`**（由 `@theme inline` 的 `--color-primary-text` 映射）
  - `--success-text` / `--warning-text` / `--danger-text` / `--info-text`：浅色主题取压深版（`#15803d` / `#b45309` / `#b91c1c` / `#1d4ed8`），深色主题回退原状态色（原色在 `#18181b` 上已 ≥4.71:1）。对应工具类 `text-success-text` / `text-warning-text` / `text-danger-text` / `text-info-text`
  - 原状态色（`text-success` 等）在浅色底上只有 2.2 / 2.1 / 3.6 / 3.4 : 1，**禁止再用于文字**，只留给背景、边框、图标描边
- 表面：`--background`、`--foreground`、`--surface`、`--overlay`、`--field`、`--content1/2/3`、`--muted`、`--separator`、`--border`、`--ring`、`--radius`
- HeroUI 桥接：`--heroui-primary`、`--heroui-primary-300`、`--heroui-foreground`、`--heroui-danger`、`--heroui-success`、`--heroui-warning`、`--heroui-default-400`（59-65 行，均指向上述变量）
- **玻璃参数（173-250 行 `:root`）**：`--bg-opacity`(0.33)、`--bg-image`、`--bg-image-opacity`(0.5)、`--bg-blur`(16px) 属于背景层（设置页滑杆运行时改写）；玻璃材质自身的参数集中在 §①②③④⑤⑥ 六组令牌（`--lg-blur`/`--lg-saturate`/`--lg-density`/`--lg-fill-*`/`--lg-edge*`/`--lg-media-*`），**全部静态且只此一处**，禁止在组件或运行时另写第二份（旧 `--glass-blur`、`glass_clarity` 链路已整体移除）。- **`--bg-opacity` 的适用范围**：`body` 的 `rgba(255,255,255,.33)` / `rgba(10,12,16,.33)` 只在有原生窗口磨砂的平台（Windows Acrylic、macOS Vibrancy）成立——系统层在窗口背后提供模糊背衬，半透明主体才观感正常。Linux（WebKitGTK）拿不到任何系统级效果，同一份半透明底色会让整窗透出桌面、主题渐变只渲染一半，观感等同「纯透明」；因此 `html[data-window-effects="fallback"]` 下 `body` 改为不透明 `--background`。

**主题切换 / 深色模式实现**：
1. 深色由 `@custom-variant dark`（:3）定义，JS 在 `<html>` 上挂 `.dark` 类（而非 `prefers-media-query`）驱动；`.dark` 块（67-95 行）覆盖颜色变量，`color-scheme` 由 light 翻转为 dark。
2. `:root` 与 `.dark` 的变量经 `@theme inline`（98-151 行）映射为 Tailwind 的 `bg-background`、`text-foreground`、`bg-surface`、`border-border`、`text-primary` 等工具类，实现全站一键换肤。
3. 主题色（accent）改写 `--primary*` / `--accent` 变量即可全局生效；多处用 `color-mix(in oklab/oklch, var(--primary) …)` 派生 hover/发光色，因此换色自动跟随。

**Liquid Glass 体系（约 173-807 行）**：

> 🎨 **全应用玻璃参数统一（唯一入口）**：所有 `lg-*` 材质只引用 `:root` 里的这一组令牌，
> 不再有第二处模糊半径 / 底色不透明度 / 边缘高光。改玻璃观感 = 改这 5 段令牌。

| 类/令牌 | 行号（约） | 用途 |
| --- | --- | --- |
| ① 材质基参数 `--lg-blur`(20px) / `--lg-saturate`(1.6) | 173-181 | **全应用唯一的模糊半径与饱和度**；此前 regular/clear/control/field/material 各写一个数（20/14/16/12/22），同名控件深浅不一 |
| `--lg-tint-light` / `--lg-tint-dark` / `--lg-tint` | 179-181 | 玻璃底色调，`.dark` 下自动切到深色支 |
| ② 密度 `--lg-density` + 倍率 `--lg-k-control/field/material` | 183-205 | 变体差异只剩“同一块玻璃的浓淡”：`control = density×0.90`、`field = ×1.08`、`material = ×0.87`；深色主题另行下调 `--lg-k-material`（0.64 → 46%）保持深色内容层不发灰。**原 `--lg-alpha-sheet`(94%/92%) 与 `--lg-fill-sheet` 已随 `.lg-sheet` 一并移除**（标题栏/侧边栏改为渐变磨砂，不再铺实底） |
| ③ 边缘/阴影 `--lg-edge`、`--lg-edge-top`、`--lg-ring-edge`、`--lg-ring-edge-top`、`--lg-edge-layers`、`--lg-edge-glint`、`--lg-shadow-*` | 241-256 | 边缘高光为**柔光带**而非 1px 实线：`--lg-edge`（环边）与 `--lg-edge-top`（顶部提亮）是低不透明度半透明白（浅色 0.40/0.32，深色 0.16/0.12），叠在 backdrop 处理过的背景上、颜色随背景透出；`--lg-ring-edge`/`--lg-ring-edge-top` 定义带 blur（1px / 1.5px 带 -0.5px 扩散）的组合阴影，`--lg-edge-layers` 是两者的合并引用，各玻璃层 `::before` 只写 `box-shadow: var(--lg-edge-layers)`；`--lg-edge-glint`（0.24）供实底玻璃（primary/danger 按钮、开关滑块、标题栏拨杆）引用。全部 theme 化（`.dark` 覆盖），禁止再写回 `inset 0 0 0 1px` 硬边或组件内写死白色 rgba |
| ④ 交互填充 `--lg-interactive-soft/-/strong`、`--lg-hairline`、`--lg-inset-alpha` | 216-225 | 玻璃上的 hover/选中/内嵌块；浅色压暗、深色提亮（旧 `hover:bg-white/10` 在浅色下几乎不可见） |
| ⑤ 最终填充色 `--lg-fill-regular/-control/-field/-material/-clear/-media` | 227-236 | `color-mix(primary X%, tint / alpha)` —— 主题色一变全部玻璃同步变，无需逐处改色 |
| ⑥ 媒体层 `--lg-media-tint` / `--lg-alpha-media` | 199-203 | 压在视频/壁纸上的 HUD（游戏模式）：文字恒为浅色，底色固定深色支，只让通透度随主题微调 |
| `.lg-regular` | 285-305 | **功能层 regular**：控件/导航/浮层默认变体（blur/saturate/密度全部来自令牌）。**宿主类一律不在此处写 `position/z-index`**——非分层声明会压过 `@layer utilities` 的 Tailwind 定位工具类，导致 `lg-regular + fixed/absolute` 的浮层定位整体失效（历史 bug：消息 flyout、select 菜单、tooltip 全部错位）；定位上下文统一由 `@layer components` 的 `:is(...)` 规则供给 |
| `.lg-clear` | 307-338 | **功能层 clear**：悬浮于照片/视频等丰富背景；`::after` 暗化层浅色 35% / 深色 12%（HIG 可读性兜底） |
| `.lg-sheet` | — | **已移除**。标题栏/侧边栏原先用它铺近乎不透明的实底，现改为 `.frost-main` 渐变磨砂（无底色） |
| `.frost-main` / `.frost-with-sidebar` / `.frost-titlebar-only` / `.frost-drawer` | 约 385-490 | **渐变磨砂层**（替代 `.lg-sheet`）：`backdrop-filter` + `mask-image` 的全屏覆盖层，模糊与遮罩同放 `::before`。纵向遮罩（标题栏：top→bottom 衰减）+ 横向遮罩（侧边栏：left→right 衰减）用 mask 多图层语法取并集，合成连通的 L 形强区——标题栏与侧边栏的磨砂连成一片，左上角无断裂。令牌 `--lg-frost-fade`(28px 衰减距离) / `--lg-frost-titlebar-h`(44px 标题栏本体高) / `--lg-frost-blur-delta`(12px 模糊增量)；衰减终点即用户设定的 `--bg-blur`。游戏模式用 `.frost-titlebar-only`（只留标题栏窄带，避免整屏 backdrop-filter 跟视频逐帧重算），移动端抽屉用 `.frost-drawer`（fixed 定位、仅横向遮罩） |
| `.lg-control` | 340-359 | 功能层控件底（开关/复选/分页/圆钮）。**自身不写 `background`**——透明底由 `@layer components` 的 `:is(...)` 规则统一提供，见下条 |
| `.lg-control.lg-solid` + `[aria-checked="true"]` / `[data-state="checked"]` | 约 551-578 | **实底玻璃**：`::before` 只保留边缘内高光、不铺填充。填充用 `background-color` 书写（**不可用 `background` 简写**）——简写不可过渡，会在铺上 `bg-primary` 的同一帧整块消失，开关/复选因此闪一下；`.lg-control::before` 自身带 `transition: background-color var(--lg-dur-base)` 负责淡出。主色/危险色按钮与选中态开关复选本身就是实色，若再叠一层 `--lg-fill-control`（深色约 84% 的 tint）会把 `bg-primary` 压成灰紫；配合 `--primary-foreground` 深色下取近黑，文字直接读不出。组件里凡是 `<玻璃类> + bg-primary/bg-danger` 的组合都必须加 `lg-solid` |
| `.lg-field` | 361-396 | 功能层输入字段；`:is(input,textarea,select).lg-field` 替换元素直接铺实底并禁用模糊 |
| `.lg-material` / `-sub` / `-row` | 399-427 | 内容层标准材质（卡片/列表/分区），与功能层共用同一套 blur/saturate。**滚动分层约束**：材质层 `::before` 是宿主的 `inset:0` abspos 子元素，会随滚动内容一起平移裁掉——玻璃宿主（`lg-regular/clear/control/field/material` 与冻结别名 `glass-surface*`）**自身禁止挂 `overflow-auto/scroll`**，需要滚动的容器必须拆成「外层挂玻璃类 + 内层 overflow-y-auto（同圆角）」两层（`overflow-hidden` 纯裁切不受限）。全站违规点已于蚀刻章修复时清零：medal-browser 章列表/搜索下拉、achievement-modal 条带、developer 日志、characters/settings/dashboard-sidebar 下拉、ui/select、card-context-menu、char-select-modal 下拉 |
| `.lg-scrim` | 708-712 | 全屏遮罩（黑 35% + `blur(calc(--lg-blur * 0.4))`）。它是玻璃浮层的**祖先**（modal 的 `Backdrop` 包着 `Dialog`），入场必须用 `@keyframes lg-backdrop-in`（背景色渐显）而不是 opacity 淡入，否则内部弹窗的玻璃在入场期间会发虚 |
| `.dashboard-card-shell` | 438-467 | **仪表板卡片壳（唯一约束点）**：`:has(> div > .lg-material)` 检测到卡片根自带材质时退位为透明纯容器；始终负责圆角/裁切/阴影 |
| `.lg-native` | 476-490 | 原生磨砂窗口层（托盘 Acrylic）：不叠 webview 模糊，只压渐变 |
| `.glass-surface` / `.glass-surface-strong` 兼容别名 | 511-534 | **冻结件专用**：映射到 regular 变体，仅供 `char-select-modal.tsx`；其余代码禁止使用 |
| `@layer components` 定位上下文 + 统一状态类 | 约 773-911 | 给玻璃宿主补 `position:relative; z-index:0` **和 `background: transparent`**（作用范围含 `.lg-regular/.lg-clear/.lg-control/.lg-field/.lg-material/.dashboard-card-shell/.glass-surface/.glass-surface-strong` 全部八类）；并提供 `.lg-hoverable` / `.lg-hoverable-soft` / `.lg-selected` / `.lg-hairline` / `.lg-thumb` / `.lg-inset` / `.lg-media-chip` / `.lg-glass-interactive`（玻璃层交互提亮，**唯一实现**：`hover`/`active` 只给 `::before` 加 `filter: brightness()`，强度由 `--lg-glass-hover`/`--lg-glass-active` 分档，见下「backdrop root 约束」）/ `.lg-media-chip-interactive`（只给媒体层胶囊设强度变量 1.08/0.94，提亮本身由 `.lg-glass-interactive` 的规则完成，两者在 JSX 里成对出现）—— 组件内**禁止**再写 `hover:bg-white/10`、`hover:bg-default-100`、`bg-default-100/50` 这类硬编码底色。**透明底必须留在本层**：未分层的 `background` 声明会压过 `@layer utilities` 的 `bg-*` 工具类，`lg-control + bg-primary` 就只剩 `::before` 的玻璃层（历史上深色主题下主按钮文字读不出，就是这个）|
| `html[data-window-effects="fallback"]` | 639-648 | 无原生磨砂平台：只抬 `--lg-density`（92% / 深色 90%），派生档位随 calc 一起抬高 |
| `.titlebar-mode-toggle` | 739-782 | 标题栏「数据/游戏」分段控件：玻璃底落在 `::after`（`::before` 被拨杆占用），与 `.lg-control` 同一套 tint/密度/主题色 |

**动效令牌（`:root` 内，「动效令牌」注释块）**：`--lg-dur-fast`(180ms)/`--lg-dur-base`(260ms)/`--lg-dur-press`(340ms)/`--lg-dur-slow`(420ms)/`--lg-dur-page`(500ms) 五档时长——fast 只给颜色/背景等瞬时反馈，press 是 hover 位移与开关滑块的档位；`--lg-ease-standard`(0.2,0,0,1)/`--lg-ease-emphasized`(0.16,1,0.3,1)/`--lg-ease-glide`(0.33,1,0.68,1，位移主力，无过冲)/`--lg-ease-spring`(0.34,1.2,0.64,1，hover/按压缩放这类小反馈)/`--lg-ease-inertia`(0.34,1.4,0.64,1，滑块/拨杆/指示器的位移——过冲必须够明显才有惯性，spring 的 1.2 只有约 4%，49px 的拨杆才弹 2px，肉眼等于没有)/`--lg-ease-exit`(0.4,0,1,1) 六族缓动；`--lg-shift-1/2/3`(8/16/24px) 位移尺度。`@theme` 另将 Tailwind 的 `--default-transition-duration/timing-function` 指到 press/glide，裸 `transition-*` 不再落回 150ms/ease。全部 keyframes 与 `.animate-*`、`.interactive-hover`/`.card-hover` 等工具类统一引用这些变量；`scale-in` 入场幅度为 `-8px + scale(0.9)`、slow 档、`transform-origin: top center`。**入场动画约定**：只做位移/缩放（transform），**不做淡入**——`opacity` 一旦小于 1，该元素及后代的玻璃在整段动画里都会失效；fill-mode 一律用 `backwards`（`.animate-scale-in` / `.animate-resource-page` / `.animate-list-item` / `.page-transition-*` / `.animate-banner-push-in-*` / `.elapsed-digit` 已统一，`.titlebar-knob-in-*` 原本就是），只有**退出**动画保留 `both`（`.animate-banner-push-out-*`）——`both`/`forwards` 会把动画属性永久留在元素上，使它成为 backdrop root 并废掉自身及后代的玻璃。理由与实测数据见上「backdrop root 约束」。

**⚠️ Tailwind v4 属性映射陷阱（写过渡前必读）**：`translate-*` / `scale-*` / `rotate-*` 工具类编译成**独立的 CSS 属性** `translate` / `scale` / `rotate`，**不是 `transform`**（Tailwind 自己的 `transition-transform` 输出的是 `transition-property: transform, translate, scale, rotate`，v4 特意补齐了这三者）。因此组件里手写 `[transition:transform_…]` 对它们**完全不过渡**——位移与缩放会瞬跳，表现为「卡片 hover 没有效果、开关滑块瞬移」。本仓库组件的 arbitrary 过渡一律并列写 `transform_…,translate_…,scale_…`（32 处已统一）；`transition-all` 不受影响，无需处理。

**为什么模糊写在 `::before` 上（沿用旧实现的 WebKitGTK 规避）**：
- 玻璃宿主（`.lg-regular/.lg-clear/.lg-control/.lg-field`）元素本身只保留透明背景 + 外阴影，底色、噪点纹理与 `backdrop-filter` 全部移到 `::before { position:absolute; inset:0; z-index:-1; border-radius:inherit; pointer-events:none }`。这里的「透明背景」由 `@layer components` 声明，不在宿主选择器里直接写——否则会压掉调用方追加的 `bg-*` 工具类。
- 起因是 Linux（WebKitGTK）的合成 bug：运行时改写模糊半径（旧 `glass_clarity` 设置）时，WebKit 会把背景模糊层重新合成到元素内容之上，整张卡片连同文字变成糊掉的方块。新体系把模糊半径固化为静态令牌并移除 glass_clarity 链路（`theme.ts` 的 `applyGlassClarity`、`main.tsx`/`tray-panel.tsx` 的读取、设置页滑条与 locale 键均已删除），风险源头不复存在。
- 伪元素要落在内容下方，父级必须是「定位元素 + 层叠上下文」，`@layer components` 统一补 `position: relative; z-index: 0`。
- `<input>/<textarea>/<select>` 是替换元素、不渲染 `::before`，因此 `:is(input, textarea, select).lg-field` 直接铺底色并删掉 `backdrop-filter`。

**backdrop root 约束（玻璃「变成半透明」的三条路径，改玻璃交互前必读）**：
CSS Filter Effects L2 规定，元素一旦成为 backdrop root，其内部的 `backdrop-filter` 只能采样这个 root **内部**已绘制的内容。玻璃层采样不到背后的壁纸/视频，模糊当场失效，只剩那层半透明填充——观感就是「毛玻璃变成一块半透明色」。本仓库实际踩过三条：

| 触发写法 | 表现 | 正确做法 |
| --- | --- | --- |
| 玻璃**宿主或祖先**上出现 `filter`（含 Tailwind 的 `brightness-*` / `blur-*` / `drop-shadow-*` 这类 `filter` 工具类） | 鼠标一浮上去玻璃就没了（历史用例：`.lg-media-chip-interactive:hover` 的 `filter: brightness(1.08)`、`GlassButton` secondary/outline 的 `hover:brightness-105`、`dashboard-fab` 的 `hover:brightness-110`） | 提亮一律走 `.lg-glass-interactive`（globals.css:895 起）：`filter` 加在 `::before` 玻璃层上，模糊与提亮同时生效（`::before` 自身的 `filter` 不影响它自己的 `backdrop-filter`，实测成立） |
| 玻璃**宿主或祖先**的 `opacity < 1`（静态写死，或入场动画里的淡入帧） | 整段动画期间玻璃发虚；遮罩是玻璃祖先时尤其明显（modal 的 `Backdrop` 就包着 `Dialog`） | **入场动画只动 transform，不做淡入**：`scale-in` / `lg-float-in` / `fade-in` / `slide-up` / `slide-down` / `page-*` / `list-item-in` / `resource-page-enter` 的 opacity 帧已全部删除（`.animate-fade-in` 现在只有 8px 位移、没有淡入）。遮罩改用 `@keyframes lg-backdrop-in`（globals.css:1193：只渐变 `background-color`，容器 opacity 恒为 1，连遮罩自身的模糊都不受影响）。`@keyframes lg-fade-in`（1175）保留，但**只能用在既不是玻璃宿主、也不是玻璃祖先的层**上 |
| `animation` 的 fill-mode 为 `both` / `forwards`（终态被永久保留） | 元素**永久**丢失自身及后代的玻璃（历史用例：`.animate-scale-in` + `lg-regular` 的右键菜单、下拉、浮层） | 入场动画一律 `backwards`（100% 帧等价于基础样式，结束时不跳变；delay 期间仍保持 0% 帧不闪现）。只有**退出**动画（`.animate-banner-push-out-*`）才保留 `both`——元素在动画结束后才被卸载 |

> **安全区（实测无副作用，可放心使用）**：静态或动画的 `transform`（含 Tailwind v4 的独立属性 `translate` / `scale` / `rotate`）、`will-change: transform`、静态 `opacity: 1`、`isolation: isolate` 都不构成 backdrop root。所以「位移 + 缩放」的入场动画可以保留，玻璃在动画进行中与结束后都完整。
> 实测口径：Chrome / Edge（无头模式，与 WebView2 同引擎）在棋盘背景上取像素方差——正常毛玻璃 ≈ 0（棋盘被糊平）；命中上面三条分别是 76.5（宿主 `filter`）、86.5（宿主 `opacity`）、25.99（fill-mode `both` 保留终态）、13.96（遮罩 opacity 淡入时的后代玻璃）；而只做 transform 的入场动画是 0.39～0.45，与静止玻璃无差别。
> 另注：`.lg-glass-interactive::before` 的 `transition` 简写会整体覆盖 `.lg-control::before` 更早的 `background-color` 过渡，所以那条已把两个属性并列写全——改它时不要只留 `filter`，否则开关/复选的选中态会从淡变回硬切。

**性能预算**：backdrop-filter 同屏实例 ≤ 8（全屏 scrim 计 2）；内容层一律零模糊，玻璃实例集中在导航/标题栏/浮层；嵌套不得超过一层。

**其他说明**：`--bg-image` 变量在 `.dashboard-background`（177 行）作为第一层背景图使用，配合 `--bg-image-opacity` 与 `--bg-blur` 实现设置页“背景图片/透明度/磨砂”三项配置；`.dashboard-veil` 再叠一层与主题同色的压暗（`--bg-veil-opacity`，浅色 0.45 / 深色 0.68），保证壁纸透明度拉满、模糊归零时正文仍然可读。**全局 `[class*="text-"]` text-shadow 已移除**——它曾是「文字在花壁纸上不糊」的手段，实际把中文小字号笔画染成灰边、形成重影，改为靠压暗层 + 实底解决。

## `src/App.css`
**职责**：遗留的 Vite/Tauri 启动模板样式（116 行），仅包含 demo 页用到的 logo、容器、按钮与系统深色适配；与 globals.css 的设计令牌体系无交集，疑似未被业务代码引用。

| 区间 | 内容 |
| --- | --- |
| 1-7 行 | `.logo.vite:hover` / `.logo.react:hover` 的辉光滤镜 |
| 8-22 行 | `:root` 字体族（Inter 等）、字号 16px、浅色文字/背景色 |
| 24-31 行 | `.container` 居中纵向 flex 布局 |
| 33-42 行 | `.logo` 尺寸与 `.logo.tauri:hover` 辉光 |
| 44-47 行 | `.row` 横向居中 |
| 49-61 行 | `a` 链接色（#646cff）与 `h1` 居中 |
| 63-92 行 | `input, button` 统一外观（圆角 8px、白底、阴影）、hover/active 边框态 |
| 94-96 行 | `#greet-input` 外边距（模板 greet 功能残留） |
| 98-116 行 | `@media (prefers-color-scheme: dark)` 深色适配：反色文字/背景、链接改青色、输入按钮半透明黑底 |

- **深色实现方式差异**：App.css 用系统媒体查询 `prefers-color-scheme`，而 globals.css 用 `.dark` 类 —— 两套机制并存，若 App.css 仍被引入会产生冲突的深色规则。

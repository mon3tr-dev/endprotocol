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
**职责**：中文 i18n 资源，共 621 行、555 个叶子 key、15 个顶层命名空间。
**顶层命名空间清单**（这是重点，要完整列出）：

| 命名空间/key 前缀 | 用途 | 大致行号 |
| --- | --- | --- |
| `nav.*` | 顶部导航（dashboard/analytics/projects/team/calendar） | :2 |
| `menu.*` | 菜单（profile/settings/help） | :9 |
| `sidebar.*` | 侧边栏全部入口文案（含 characters/medals/attendance/gacha/todo/launcher/developer） | :14 |
| `common.*` | 通用文案：分页（common.pagination.* :32）、搜索、保存/取消/确认、刷新、删除/编辑、占位符统计卡片文案（totalRevenue 等模板遗留） | :31 |
| `filters.*` | 干员筛选器（profession/property/rarity/weapon/mainAttr/subAttr 及 all_* 全选项） | :78 |
| `settings.*` | 设置页总命名空间，`settings.title` :94 | :93 |
| `settings.general.*` | 通用设置：语言、主题（light/dark/system）、关闭窗口行为、托盘显示用户 | :95 |
| `settings.game_launch.*` | 游戏启动：校验线程数、游戏界面背景（视频/图片） | :110 |
| `settings.appearance.*` | 外观：主题模式、主题色、窗口背景透明度/背景图/磨砂/毛玻璃清晰度 | :119 |
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
| `launcher.*` | 启动器：安装/更新/校验修复/渠道切换/预下载/磁盘与文件扫描等完整流程（本文件最大分组，约 110 个 key） | :442 |
| `todo_page.*` | To-Do 页面：标题/描述、导入导出、新建/搜索列表、分组、空态等 | :583 |

- **与 en/translation.json 的 key 差异**：无。经脚本对比，zh 与 en 叶子 key 均为 555 个，键集合完全一致（既无 zh 缺键也无 en 缺键），且两文件结构逐行对齐（行号一一对应）。
- **异常（两边共有）**：`settings.update` 内存在重复键 —— `latest_version` 同时出现于 :177 与 :187、`release_date` 同时出现于 :179 与 :188。JSON 解析时后者覆盖前者（zh 实际生效值为 :187 的“远端最新版本”、:188 的“发布日期”；en 同理）。建议后续合并为 `latest_version_remote` 之类的独立键。

## `src/locales/en/translation.json`
**职责**：英文 i18n 资源，与 zh 文件同为 621 行、555 个叶子 key、15 个顶层命名空间，行号与 zh 完全对应（见上表）。
- 主要差异仅在文案语言，个别本地化选择值得注意：`settings.characters.cultivation_talents` zh 为“基建技能”而 en 为 “O.M.V. Dijiang Skills”（帝江号相关译名）；`settings.logs.level_*` en 使用大写日志级别（DEBUG/INFO/WARN/ERROR），`source_frontend/source_backend` 缩写为 FE/BE。
- 同样存在 `settings.update` 的 `latest_version` / `release_date` 重复键（:177/:187、:179/:188），与 zh 完全一致。

## `src/styles/globals.css`
**职责**：全局样式与设计令牌（Tailwind CSS v4 + CSS 变量体系）。定义浅/深色主题变量、`@theme` 映射、玻璃拟态（glassmorphism）工具类、交互动效与游戏内技能文本标记样式。共 463 行。

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| 1 行 | `@import "tailwindcss"`（Tailwind v4 入口） |
| 3 行 | `@custom-variant dark` —— 深色变体以 `.dark` 类为作用域（`&:is(.dark *)`），即**类名切换式深色模式** |
| 6-96 行 | `@layer base` 主题令牌：`:root`（7-66 行）浅色变量；`.dark`（67-95 行）覆盖为深色变量 |
| 98-151 行 | `@theme inline` —— 把 CSS 变量桥接为 Tailwind 语义色（`--color-background`、`--color-primary` 等）并派生 radius 刻度 |
| 154-160 行 | `.glass-field` 原生玻璃输入控件 |
| 162-163 行 | `color-scheme` 过渡、移动端点击高亮重置 |
| 166-171 行 | Tauri 窗口背景变量组 + `body` 背景色（浅/深两套） |
| 172-186 行 | `.dashboard-background` 固定背景层（背景图 + 三层渐变叠加 + blur） |
| 187-206 行 | 对比度自适应文本（`.adaptive-contrast-text`、弱化文字色强制改用 `--foreground`、全局 `text-shadow`） |
| 206-224 行 | `.titlebar-mode-toggle` 标题栏模式切换胶囊动画（`.is-game` 右移） |
| 226-227 行 | `::selection` 选区配色 |
| 229-255 行 | 动画 keyframes 与 `.animate-*` 工具类（含系统资源指标切换的 `.animate-resource-page`） |
| 257-265 行 | Banner 轮播「翻页推动」动画：`@keyframes banner-push-in/out-left/right` 与 `.animate-banner-push-*` 工具类（dashboard 游戏模式底部宣传图使用） |
| 267-283 行 | 页面转场（`.page-transition-enter/slide-up/scale-in`）与列表项级联动画 `.animate-list-item`（8 档 40ms 阶梯延迟） |
| 285-287 行 | 减少动态效果偏好下关闭系统资源指标切换动画 |
| 289-292 行 | 滚动条：全局隐藏（width:0），`[data-ovs]:hover` 时才显示悬浮 thumb |
| 294-375 行 | **玻璃拟态工具类**（详见下表） |
| 377-422 行 | 交互动效工具类：`.interactive-hover`、`.card-hover`、`.button-hover`、`.icon-hover`、`.nav-hover`、`.list-item-hover`、`.input-hover`、`.chip-hover`、`.switch-hover`、`.checkbox-hover`、`.modal-hover`、`.tooltip-hover`、`.dropdown-item-hover`、`.table-row-hover`、`.link-hover` |
| 424-430 行 | 状态发光阴影：`.shadow-glow-success/danger/warning`（深色模式加强） |
| 432-463 行 | 技能描述富文本标记：`.ba-tag`、`.ba-at-*` / `.ba-hash-*` / `.ba-tips-*` 系列属性关键字配色（cryst/key/vup/poise/speedup/slow/spellburst 等） |

**关键变量（`:root`，7-66 行）**：
- 色阶：`--default-50…900`、`--primary-50…900`、`--danger-50`
- 语义色：`--primary`、`--accent`、`--success`、`--info`、`--warning`、`--warning-dark`、`--danger` 及各自 `-foreground`
- 表面：`--background`、`--foreground`、`--surface`、`--overlay`、`--field`、`--content1/2/3`、`--muted`、`--separator`、`--border`、`--ring`、`--radius`
- HeroUI 桥接：`--heroui-primary`、`--heroui-primary-300`、`--heroui-foreground`、`--heroui-danger`、`--heroui-success`、`--heroui-warning`、`--heroui-default-400`（59-65 行，均指向上述变量）
- **玻璃参数（166 行）**：`--bg-opacity`(0.33)、`--bg-image`、`--bg-image-opacity`(0.5)、`--bg-blur`(16px)、`--glass-blur`(28px)、`--glass-surface-opacity`(78%)、`--glass-strong-opacity`(85%)、`--glass-field-opacity`(80%)。这些值由设置页的“背景透明度/磨砂/毛玻璃清晰度”滑杆在运行时改写。

**主题切换 / 深色模式实现**：
1. 深色由 `@custom-variant dark`（:3）定义，JS 在 `<html>` 上挂 `.dark` 类（而非 `prefers-media-query`）驱动；`.dark` 块（67-95 行）覆盖颜色变量，`color-scheme` 由 light 翻转为 dark。
2. `:root` 与 `.dark` 的变量经 `@theme inline`（98-151 行）映射为 Tailwind 的 `bg-background`、`text-foreground`、`bg-surface`、`border-border`、`text-primary` 等工具类，实现全站一键换肤。
3. 主题色（accent）改写 `--primary*` / `--accent` 变量即可全局生效；多处用 `color-mix(in oklab/oklch, var(--primary) …)` 派生 hover/发光色，因此换色自动跟随。

**玻璃拟态工具类（279-367 行）**：

| 类 | 行号 | 用途 |
| --- | --- | --- |
| `.glass-window` | 280 | 透明窗口底层 |
| `.glass-surface` | 283 | 标准玻璃面板（`--glass-surface-opacity` + blur），深色阴影覆盖于 :289 |
| `.glass-surface-strong` | 292 | 高不透明玻璃（`--glass-strong-opacity`），深色覆盖于 :349 |
| `.glass-control-surface` | 298 | 控件区玻璃（不透明度再减 25%） |
| `.glass-field` | 154 | 表单控件玻璃（`--glass-field-opacity`，blur × 0.43） |
| `.account-glass-panel` / `-inner` / `-row` | 308 / 314 / 319 | 账户页三层玻璃（48%/30%/22% 不透明度），深色覆盖于 :324-333 |
| `.dashboard-card-shell` | 334 | 仪表盘卡片外壳（透明 + 圆角 10px，抑制内部 ::before 装饰） |
| `.glass-backdrop` | 352 | 模态遮罩（黑 50% + blur 4px） |
| `.avatar-feather` | 357 | 头像径向羽化 mask |
| `.context-item-normal` | 361 | 右键菜单项 hover 染色 |
| `.glass` / `.glass-strong` | 364 / 366 | 兼容占位类（均置为 transparent，深浅色相同） |

**其他说明**：`--bg-image` 变量在 `.dashboard-background`（177 行）作为第一层背景图使用，配合 `--bg-image-opacity` 与 `--bg-blur` 实现设置页“背景图片/透明度/磨砂”三项配置；全局 `[class*="text-"]` text-shadow（204 行）用于在浅色背景图上保证文字可读。

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

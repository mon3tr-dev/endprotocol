# 账户信息/账户进度/成就卡片 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## 卡片总览

| 卡片 id | 目录 | 元数据文件 | 主组件 | 附属组件 |
| --- | --- | --- | --- | --- |
| `account_info` | `src/components/cards/account-info` | `account-info.meta.json`（20 行） | `index.tsx` → `AccountInfoCard`（默认导出，51-333） | 无独立子组件；`locales/zh.json`（11 键）、`locales/en.json`（11 键） |
| `account_progress` | `src/components/cards/account-progress` | `account-progress.meta.json`（20 行） | `index.tsx` → `AccountProgressCard`（默认导出，43-353） | 无独立子组件；`locales/zh.json`（8 键）、`locales/en.json`（8 键） |
| `achievement` | `src/components/cards/achievement` | `achievement.meta.json`（20 行） | `index.tsx` → `AchievementCard`（默认导出，118-359） | `achievement-modal.tsx` → `AchievementModal`（236-659）、`medal-browser.tsx` → `MedalBrowser`（54-382）及同文件内的 `effectiveLevel`/`getMedalIcon`/`formatTimestamp`；`locales/zh.json`（17 键）、`locales/en.json`（17 键） |

**三张卡片的共性**

- Props 均为 `BaseCardProps`（`src/components/cards/registry/types.ts:20-25`）：`roleId`（仪表板默认角色）、`cardId`（卡片实例 ID，设置持久化键）、`settings`（卡片设置对象）、`isEditMode`（仅成就卡片实际使用，122 行）。
- 角色覆盖链统一：`effectiveRoleId = customRoleId ?? defaultRoleId`，`customRoleId` 初值取 `settings.<X>CardSettings.roleId`，随后被 `CardConfigService.getCardSettings(cardId)` 覆盖，切换账号后经 `saveCardSettings(cardId, { roleId })` 回写（三张卡片实现几乎逐行同构）。
- 数据获取统一走 `useCardData`（`src/components/cards/base/use-card-data.ts:12-63`），`reloadKey`（即 `effectiveRoleId`）变化时强制重载（47-55 行）。
- 切换账号弹窗统一为 `CustomModal` + `CustomModalHeader/Body/Footer` 结构，均由 window `cardAction` 自定义事件（`detail.action === "change-role"`）触发打开。
- 三张卡片（含两个成就子组件）**均无直接 `invoke()` / `listen()` 调用**，IPC 全部经 `roleDataService` / `accountService` / `cardConfigService` / `imageCacheManager` 封装。
- meta.json 由 `registry/loader.ts:15-18` 的 `import.meta.glob('../*/*.meta.json')` 自动扫描，`../<目录>/index.tsx` 的 default 导出作为 `component`（loader.ts:67-82）；`locales/*.json` 由 loader.ts:21-24 扫描并合并进 i18n 的 `card` 命名空间（loader.ts:51-55），因此各卡片共享同一 `card:` 命名空间。

## `src/components/cards/account-info/index.tsx`

**职责**：账户信息卡片——展示头像、昵称、苏醒日、UID（可一键复制）、主线任务、权限等级，以及探索等级/干员/武器/档案四项统计；提供卡片内切换绑定账号的入口与弹窗，并把所选 `roleId` 持久化到本卡片设置。

**导出**：`AccountBaseInfo`（interface，22-38）、`AccountInfoCard`（default，51-333）。
**主要依赖**：`react`（`useCallback/useEffect/useMemo/useState`）；`@/components/ui/glass`（`GlassButton`、`GlassCard`、`GlassProgressCircle`）；`react-i18next`；`../registry/types`（`BaseCardProps`）；`../base/use-card-data`（`useCardData`）；`@/utils/roleDataService`；`@/utils/cardConfigService`；`@/utils/accountService`（`getAccounts`、`Account`）；`@/utils/imageCacheManager`（`useImageRequest`、`usePinImages`）；`@/components/ui/account-avatar`（`AccountAvatar`）；`@/utils/logger`（`logError`）；`@/types`（`resolveServerLabel`）；`@/components/custom-modal`（`CustomModal`/`CustomModalHeader`/`CustomModalBody`/`CustomModalFooter`）；`@/types/card-settings`（`AccountInfoCardSettings`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AccountBaseInfo` | index.tsx:22-38 | 基础信息结构：`serverName`/`roleId`/`name`/`createTime`/`saveTime`/`lastLoginTime`/`exp`/`level`/`worldLevel`/`gender`/`avatarUrl`/`mainMission{id,description}`/`charNum`/`weaponNum`/`docNum` |
| `formatDate` | index.tsx:40-49 | 模块私有：秒级时间戳字符串 → `YYYY-MM-DD`；空串返回 `""`，非数字原样返回 |
| `AccountInfoCard` | index.tsx:51-333 | 默认导出主组件，内部结构见下 |
| `customRoleId` | index.tsx:57-59 | state，初值 `settings.roleId` |
| `isRoleSelectOpen` / `accounts` / `copied` | index.tsx:60-62 | 切换账号弹窗开关 / 账户列表 / 复制成功反馈（1.5s 复位） |
| `effectiveRoleId` | index.tsx:64 | `customRoleId ?? defaultRoleId` |
| `useCardData<AccountBaseInfo>` | index.tsx:66-69 | `fetchData → roleDataService.getBaseInfo(effectiveRoleId)`，`reloadKey = effectiveRoleId` |
| `loadSettings` + effect | index.tsx:71-84 | `CardConfigService.getCardSettings<AccountInfoCardSettings>(cardId)`，命中 `s.roleId` 则覆盖 state |
| `loadAccounts` + effect | index.tsx:86-97 | `getAccounts()`，`effectiveRoleId` 变化时重载 |
| `currentAccount` | index.tsx:99-102 | 账户列表中 `id === effectiveRoleId` 的项 |
| `avatarSrc` / `avatarPaths` | index.tsx:104-108 | 头像优先 `currentAccount.avatar`，回退 `base.avatarUrl` |
| `useImageRequest` / `usePinImages` | index.tsx:109-110 | 头像图片预取与常驻缓存 |
| `uid` | index.tsx:112 | `base.roleId || ""` |
| `handleCopyUid` | index.tsx:114-123 | 剪贴板复制 UID，成功后 `copied=true` 并 1500ms 后复位 |
| `openAccountSelect` | index.tsx:125-133 | 先 `getAccounts()` 刷新列表再打开弹窗 |
| `cardAction` 监听 effect | index.tsx:135-144 | window 事件监听：`detail.cardId === cardId && detail.action === "change-role"` → `openAccountSelect()` |
| `handleRoleConfirm` | index.tsx:146-156 | 选中账号：写 `customRoleId`、关弹窗、`saveCardSettings(cardId, { roleId })` |
| loading 分支 | index.tsx:158-169 | `GlassProgressCircle` 无限旋转占位 |
| 空数据分支 | index.tsx:171-177 | `base` 为 null 时显示 `t("card:no_data")` |
| `stats` | index.tsx:179-184 | 4 项统计：探索等级 / 干员 / 武器 / 档案 |

**渲染内容区块（行号）**

- **186-279** 外层 `<GlassCard>`（`p-2.5`、圆角 10px、纵向 flex）：
  - **191-244** 顶部信息行：`AccountAvatar`（192-197，`size="lg"`）；**199-215** 昵称 + 切换账号按钮（204-214，内联 SVG 211-213，点击 `openAccountSelect`）；**216-218** 苏醒日 `formatDate(base.createTime)`；**221-243** UID 文本（222-224）+ 复制按钮（225-242，成功态对勾 SVG 233-235，否则复制图标 237-240）。
  - **246-267** 中部：**247-256** 主线任务区块（仅 `base.mainMission.description` 存在时渲染）；**257-266** 权限等级区块（`LEVEL {base.level}`）。
  - **269-278** 底部统计条（上边框分隔）：`stats.map`（270-277），值缺失显示 `--`（273）。
- **弹窗结构 281-330**：`CustomModal`（size `md`，281-285）→ `CustomModalHeader`（286-288，标题 `t("card:select_role")`）→ `CustomModalBody`（289-324：空态 291-294；账户列表 296-321，每项含 `AccountAvatar` 302-306、昵称 307-310、`resolveServerLabel(...) · Lv.{level}` 311-313、当前账号标记 315-319）→ `CustomModalFooter`（325-329，取消按钮）。

**数据来源**

- 服务/命令：`roleDataService.getBaseInfo`（67）→ 内部 `queryData(roleId, 'char_detail', ['base'])` 取 `result.base`（`roleDataService.ts:124-132`）→ `invoke('query_role_data')`（`roleDataService.ts:83`）；`getAccounts()`（88、127）→ `invoke('get_accounts')`（`accountService.ts:196`）；`CardConfigService.getCardSettings`（73）→ `invoke("get_card_settings")`（`cardConfigService.ts:20`）；`CardConfigService.saveCardSettings`（150）→ `invoke("save_card_settings")`（`cardConfigService.ts:38`）；图片缓存（109-110）→ `get_image_cache_dir` / `read_image_file` / `download_image`（`imageCacheManager.ts:36、102、137`）。
- settings 字段：`AccountInfoCardSettings.roleId`（`card-settings.ts:37-39`）。来源链：props 初值（57-59）→ `getCardSettings` 覆盖（74-76）→ 切换后 `saveCardSettings` 写入（150-152）。
- 配置键：未使用 `configService`/`getConfig`，无全局配置键读写；仅按 `cardId` 存储的卡片设置。
- i18n：本卡 `locales/zh.json` 11 键（其中 2 键未使用，见下）；另依赖命名空间共享键 `card:no_data`(174)、`card:select_role`(287)、`card:no_accounts`(293)、`card:current`(317)、`common.unknown`(202、309)、`common.cancel`(327)——前四个不在本卡 locales 中。

**备注**

- `invoke`：本文件 **0 个直接调用**；间接命令全集：`query_role_data`、`get_accounts`、`get_card_settings`、`save_card_settings`、`get_image_cache_dir`、`read_image_file`、`download_image`。
- `listen`：**无**（不使用 Tauri 事件监听）。
- window 事件：`addEventListener("cardAction", ...)`（142），卸载时移除（143）。
- 未使用的 locale 键：`account_info_role_id`、`account_info_uid`。

## `src/components/cards/account-info/account-info.meta.json`

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `id` | `"account_info"` | 卡片类型唯一标识，作为 registry 的 key（`loader.ts:81`），也是 `CardSettingsMap.account_info` 的键（`card-settings.ts:77`）；注意与目录名 `account-info` 不同（loader 按目录名定位组件，按 `meta.id` 注册） |
| `name` | `{ zh: "账户信息", en: "Account Info" }` | 卡片选择器显示名（多语言对象，`CardMeta.name`） |
| `description` | `{ zh: "展示账户的基础信息（等级、世界等级、干员/武器数量等）", en: "Display account base info (level, world level, characters/weapons count, etc.)" }` | 卡片描述文案 |
| `icon` | `"user"` | 图标标识（`CardMeta.icon`） |
| `defaultSize` | `{ w: 4, h: 2 }` | 默认网格占位 4 列 × 2 行 |
| `version` | `"1.0.0"` | 卡片版本号 |
| `allowMultiple` | `true` | 允许多实例（每个实例有独立 `cardId` 与 `roleId` 设置） |
| `tags` | 3 项：`account`（账户/Account）、`info`（信息/Info）、`display`（显示/Display） | 多语言标签，用于卡片库搜索筛选（`CardTag`，`types.ts:2-5`） |

## `src/components/cards/account-info/locales/zh.json`

共 11 键（与 `en.json` 键集完全一致）：

| 键 | 中文值 | 使用位置（index.tsx） |
| --- | --- | --- |
| `account_info_role_id` | ID | **未使用** |
| `account_info_uid` | UID | **未使用** |
| `account_info_awaken_day` | 苏醒日 | 217 |
| `account_info_level` | 权限等级 | 260 |
| `account_info_explore_level` | 探索等级 | 180 |
| `account_info_copy` | 复制 | 228（title）、230（aria-label） |
| `account_info_switch_account` | 切换账号 | 207、208 |
| `account_info_main_mission` | 主线任务 | 250 |
| `account_info_char_num` | 干员 | 181 |
| `account_info_weapon_num` | 武器 | 182 |
| `account_info_doc_num` | 档案 | 183 |

## `src/components/cards/account-progress/index.tsx`

**职责**：账户进度卡片——左侧实时理智（体力）数值与两条倒计时（回满、下次回复），右侧日常活跃度/每周事务/通行证等级三条进度条；支持切换绑定账号并持久化 `roleId`。

**导出**：`DungeonData`（interface，21-25）、`ProgressData`（interface，27-32）、`AccountProgressCard`（default，43-353）。
**主要依赖**：`react` hooks；`@/components/ui/glass`（`GlassButton`、`GlassCard`、`GlassMeter`、`GlassProgressCircle`）；`react-i18next`；`../registry/types`；`../base/use-card-data`；`@/utils/roleDataService`；`@/utils/cardConfigService`；`@/utils/accountService`；`@/components/ui/account-avatar`；`@/utils/logger`；`@/types`（`resolveServerLabel`）；`@/components/custom-modal`；`@/types/card-settings`（`AccountProgressCardSettings`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `DungeonData` | index.tsx:21-25 | `curStamina?` / `maxTs?` / `maxStamina?`（字符串型数值） |
| `ProgressData` | index.tsx:27-32 | `dungeon`、`bpSystem{curLevel,maxLevel}`、`dailyMission{dailyActivation,maxDailyActivation}`、`weeklyMission{score,total}` |
| `formatRecoverCountdownFromSec` | index.tsx:34-41 | 模块私有：秒数 → `HH:MM:SS`；≤0 返回 `00:00:00` |
| `AccountProgressCard` | index.tsx:43-353 | 默认导出主组件 |
| `customRoleId` / `isRoleSelectOpen` / `accounts` | index.tsx:49-53 | 角色覆盖 / 弹窗开关 / 账户列表 |
| `effectiveRoleId` | index.tsx:55 | `customRoleId ?? defaultRoleId` |
| `useCardData<ProgressData>` | index.tsx:57-74 | `roleDataService.queryData(effectiveRoleId, "char_detail", ["dungeon","bpSystem","dailyMission","weeklyMission"])`（59-64），结果按键抽取（66-71），空结果返回 `{}` |
| `loadSettings` + effect | index.tsx:76-89 | `getCardSettings<AccountProgressCardSettings>(cardId)` → 覆盖 `roleId` |
| `loadAccounts` + effect | index.tsx:91-102 | `getAccounts()` |
| `openAccountSelect` | index.tsx:104-112 | 刷新列表并打开弹窗 |
| `cardAction` 监听 effect | index.tsx:114-123 | `change-role` → 打开切换弹窗 |
| `handleRoleConfirm` | index.tsx:125-135 | 选中账号 → `saveCardSettings(cardId, { roleId })` |
| `currentAccount` | index.tsx:137-140 | 匹配 `effectiveRoleId` 的账户 |
| `curStamina`/`maxStamina`/`maxTsSec` | index.tsx:142-144 | 从 `dungeon` 解析为数值 |
| `now` 每秒计时器 | index.tsx:146-150 | `setInterval` 1s 刷新，卸载清理 |
| `REFILL_INTERVAL` | index.tsx:152 | 常量 `432` 秒/点（体力回复间隔） |
| `liveStamina`/`refillCountdown`/`recoverCountdown`/`isStaminaFull` | index.tsx:154-178 | useMemo：由 `maxTs` 反推当前理智（163-167）、下次回复倒计时（173-174）、回满倒计时（175-176）；满或数据无效时返回空字符串 |
| `bpCur`/`bpMax` | index.tsx:180-181 | 通行证等级 |
| `dailyCur`/`dailyMax` | index.tsx:183-184 | 日常活跃度 |
| `weeklyCur`/`weeklyMax` | index.tsx:186-187 | 每周事务 |
| `barSections` | index.tsx:189-208 | 3 条进度条的 label/value/suffix/percent（`suffix` 恒为 `""`） |

**渲染内容区块（行号）**

- **210-221** loading 分支：`GlassProgressCircle` 无限旋转（本卡片无 `!data` 空态分支，`{}` 也会正常渲染）。
- **223-352** 主体 fragment：
  - **225-299** `<GlassCard>`：**226-249** 头部（头像 `AccountAvatar` 228-233、昵称 234-236、切换账号按钮 238-248）；**251-298** 主体行——**252-272** 理智列（标签 253、`liveStamina/maxStamina` 254-257、已满态 259-260 或「回满倒计时」263-265 +「下次回复倒计时」266-268）；**274-297** 进度条区（`barSections.map` 275-296：标签 277、`GlassMeter` 278-286、数值 287-289、suffix 290-294）。
  - **301-350** 切换账号弹窗：`CustomModal`(md) → `CustomModalHeader`（306-308）→ `CustomModalBody`（309-344：空态 311-314、列表 316-342，含头像 322-326、昵称 327-330、服务器/等级 331-333、当前标记 335-339）→ `CustomModalFooter`（345-349）。

**数据来源**

- 服务/命令：`roleDataService.queryData(roleId, "char_detail", ["dungeon","bpSystem","dailyMission","weeklyMission"])`（59-64）→ `invoke('query_role_data')`（`roleDataService.ts:83`，带 `queryCache` 去重，64-100）；`getAccounts()`（93、106）→ `invoke('get_accounts')`；`getCardSettings`（78）→ `invoke("get_card_settings")`；`saveCardSettings`（129）→ `invoke("save_card_settings")`。
- settings 字段：`AccountProgressCardSettings.roleId`（`card-settings.ts:44-46`）。props 初值 49-51、`getCardSettings` 覆盖 78-81、保存 129-131。
- 配置键：无全局配置键；理智倒计时为纯前端派生（142-178），依赖 1 秒 tick（146-150）与常量 `REFILL_INTERVAL=432`。
- i18n：本卡 `locales/zh.json` 8 键全部使用；另依赖 `card:select_role`(307)、`card:no_accounts`(313)、`card:current`(337)、`common.unknown`(235、329)、`common.cancel`(347)。

**备注**

- `invoke`：本文件 **0 个直接调用**；间接命令全集：`query_role_data`、`get_accounts`、`get_card_settings`、`save_card_settings`。
- `listen`：**无**。
- window 事件：`addEventListener("cardAction", ...)`（121）。
- 死代码：`barSections` 三项的 `suffix` 均为 `""`（193、199、205），故 290-294 的 suffix 渲染分支不可达。

## `src/components/cards/account-progress/account-progress.meta.json`

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `id` | `"account_progress"` | 卡片唯一标识（registry key，`loader.ts:81`；`CardSettingsMap.account_progress`，`card-settings.ts:78`） |
| `name` | `{ zh: "账户进度", en: "Account Progress" }` | 显示名 |
| `description` | `{ zh: "展示账户的理智、日常活跃度、每周事务、通行证等级进度", en: "Display account stamina, daily activity, weekly affairs, battle pass level progress" }` | 描述文案 |
| `icon` | `"chart"` | 图标标识 |
| `defaultSize` | `{ w: 4, h: 2 }` | 默认 4×2 网格 |
| `version` | `"1.0.0"` | 版本号 |
| `allowMultiple` | `true` | 允许多实例 |
| `tags` | 3 项：`account`（账户）、`progress`（进度）、`display`（显示） | 搜索筛选标签 |

## `src/components/cards/account-progress/locales/zh.json`

共 8 键（与 `en.json` 键集完全一致）：

| 键 | 中文值 | 使用位置（index.tsx） |
| --- | --- | --- |
| `account_progress_stamina` | 理智 | 253 |
| `account_progress_bp` | 通行证等级 | 203 |
| `account_progress_daily` | 日常活跃度 | 191 |
| `account_progress_weekly` | 每周事务 | 197 |
| `account_progress_switch_account` | 切换账号 | 241、242 |
| `account_progress_recover_in` | 回满 | 264 |
| `account_progress_next_refill` | 下次回复 | 267 |
| `account_progress_full` | 已满 | 260 |

## `src/components/cards/achievement/index.tsx`

**职责**：「光荣之路」蚀刻章卡片——以 5×2 蜂窝布局展示至多 10 枚蚀刻章（游戏展示列表或手动挑选），非编辑态点击打开编排弹窗；支持切换账号，并通过 window `cardAction` 响应「选择蚀刻章」与「更换账号」两个外部动作。

**导出**：`AchievementCard`（default，118-359）。注意：`effectiveLevel`、`getMedalIcon` 在本文件内为**模块私有实现**（30-42），与 `medal-browser.tsx` 的同名导出重复。
**主要依赖**：`react` hooks；`@/components/ui/glass`（`GlassButton`、`GlassCard`、`GlassProgressCircle`）；`@/types/charDetail`（`CharDetailData`、`AchieveMedal`）；`@/utils/logger`（`logDebug`、`logError`）；`react-i18next`；`@/utils/roleDataService`；`../registry/types`；`@/utils/cardConfigService`；`@/types/card-settings`（`AchievementCardSettings`）；`../base/use-card-data`；`@/utils/imageLoader`（`Img`）；`@/utils/imageCacheManager`；`./achievement-modal`（`AchievementModal`）；`@/utils/accountService`；`@/types`（`resolveServerLabel`）；`@/components/custom-modal`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `MAX_DISPLAY` | index.tsx:24 | 常量 `10`，卡片与弹窗槽位上限 |
| `HEX_W` / `HEX_H` / `HEX_CLIP` | index.tsx:26-28 | 卡片六边形尺寸 71×82 与 `clip-path` 多边形 |
| `effectiveLevel` | index.tsx:30-32 | 模块私有：`min(initLevel + level - 1, 3)` |
| `getMedalIcon` | index.tsx:34-42 | 模块私有：镀层图标 → lv≥3 `reforge3Icon` → lv≥2 `reforge2Icon` → `initIcon` |
| `HexImg` | index.tsx:44-58 | 内部组件：带 `clip-path` 的图片六边形（`Img` 填充） |
| `EmptyHex` | index.tsx:60-83 | 内部组件：虚线描边空六边形（SVG polygon，74-79） |
| `Honeycomb` | index.tsx:85-116 | 内部组件：5 列 × 2 行蜂窝布局（`GAP=0`、`ROW_Y` 偏移 `HEX_H*0.75` 88-90，`ROW_X` 半格错位 90），槽位索引 `col*2+row`（96），有章渲染 `HexImg`（105-106）否则 `EmptyHex`（108） |
| `AchievementCard` | index.tsx:118-359 | 默认导出主组件 |
| state 组 | index.tsx:125-132 | `selectedMedalIds`、`useDisplayList`、`isModalOpen`、`isRoleSelectOpen`、`accounts`、`customRoleId` |
| `effectiveRoleId` | index.tsx:134 | `customRoleId ?? defaultRoleId` |
| `useCardData<CharDetailData>` | index.tsx:136-139 | `roleDataService.getFullCharDetail(effectiveRoleId)` |
| `allMedals` | index.tsx:141-144 | `charDetail.achieve.achieveMedals` |
| `loadSettings` | index.tsx:146-166 | 读取 `getCardSettings<AchievementCardSettings>(cardId)`：`useDisplayList===true` → 展示列表模式并清空选中（150-152）；否则有 `selectedMedalIds` → 手动模式（153-155）；兜底展示列表模式（156-159）；`roleId` 覆盖（160-162） |
| `loadSettings` effect | index.tsx:168-172 | **仅在 `allMedals.length > 0` 时执行** |
| `displayMedalIds` | index.tsx:174-177 | `Object.values(charDetail.achieve.display)` |
| `displayMedals` | index.tsx:179-194 | 展示列表模式取 `achieve.display` 前 10（182-186）或回退 `allMedals` 前 10（188）；手动模式映射 `selectedMedalIds`（190-193） |
| `iconPaths` + 缓存钩子 | index.tsx:196-201 | 图标预取与 pin |
| `clearLongPressTimers` effect | index.tsx:203-207 | 弹窗打开时派发 window CustomEvent |
| `handleCardAction` + effect | index.tsx:209-225 | 监听 `cardAction`：`select-medals` → 打开编排弹窗（212-213）；`change-role` → `getAccounts()` 后打开切换弹窗（214-219） |
| `handleRoleConfirm` | index.tsx:227-238 | 切换账号 → `saveCardSettings(cardId, { roleId })`（231-233） |
| `handleModalSave` | index.tsx:240-253 | 弹窗保存回调 → `saveCardSettings(cardId, { selectedMedalIds?, useDisplayList?, roleId })`（244-248），非选中字段写 `undefined` |
| loading 分支 | index.tsx:255-266 | `GlassProgressCircle` |
| 无成就数据分支 | index.tsx:268-274 | `t("card:no_data")` |
| `shownMedals` | index.tsx:276 | 恒为 `MAX_DISPLAY`（10） |

**渲染内容区块（行号）**

- **280-288** 主卡片 `<GlassCard isPressable>`：`onPress` 在非编辑态打开弹窗（283）；**285-287** 居中渲染 `<Honeycomb displayMedals shownMedals>`。
- **290-298** `<AchievementModal>`：传入 `medals={allMedals}`、`selectedMedalIds`、`useDisplayList`、`displayMedalIds`、`onSave={handleModalSave}`。
- **弹窗结构 301-356**（切换账号）：`CustomModal`(md) → `CustomModalHeader`（306-308）→ `CustomModalBody`（309-347：空态 311-314、列表 316-345，头像块 322-334 使用 `Img` 或昵称首字母占位，昵称 336-338、服务器/等级 339-341；**无「当前」标记**）→ `CustomModalFooter`（348-355）。

**数据来源**

- 服务/命令：`roleDataService.getFullCharDetail(roleId)`（137）→ `queryData(roleId, 'char_detail', [])` 并取 `result.__full__`（`roleDataService.ts:108-116`）→ `invoke('query_role_data')`（83）；`getAccounts()`（215）→ `invoke('get_accounts')`；`getCardSettings`（148）→ `invoke("get_card_settings")`；`saveCardSettings`（231、244）→ `invoke("save_card_settings")`；图片缓存（200-201）→ `get_image_cache_dir` / `read_image_file` / `download_image`。
- settings 字段：`AchievementCardSettings`（`card-settings.ts:27-32`）——`roleId`（读 160-162、写 231-233、247）、`useDisplayList`（读 150-152、写 246）、`selectedMedalIds`（读 153-155、写 245）；`featuredMedalId` 在类型中声明但**全卡片未使用**。
- 配置键：无全局配置键；数据展示来源为 `charDetail.achieve.display`（游戏内展示列表，174-177、182-186）与 `achieve.achieveMedals`（全部已获得章，141-144）。
- i18n：本卡 `locales/zh.json` 17 键全部使用（`ach_*`）；另依赖 `card:no_data`(271)、`card:select_role`(307)、`card:no_accounts`(313)、`common.unknown`(337)、`common.cancel`(353)。

**备注**

- `invoke`：本文件 **0 个直接调用**；间接命令全集：`query_role_data`、`get_accounts`、`get_card_settings`、`save_card_settings`、`get_image_cache_dir`、`read_image_file`、`download_image`。
- `listen`：**无**（不使用 Tauri 事件监听）。
- window 事件：`addEventListener("cardAction", ...)`（223）；`window.dispatchEvent(new CustomEvent("clearLongPressTimers"))`（205）。
- 其它：`effectiveLevel`/`getMedalIcon` 与 `medal-browser.tsx:12-26` 重复实现；`loadSettings` 依赖 `allMedals.length > 0`（168-172），因此 `roleId` 设置要等数据到达后才生效（会产生一次默认 `roleId` 的首查 + 覆盖后的二次查询）。

## `src/components/cards/achievement/achievement.meta.json`

| 字段 | 值 | 说明 |
| --- | --- | --- |
| `id` | `"achievement"` | 卡片唯一标识（registry key；`CardSettingsMap.achievement`，`card-settings.ts:76`） |
| `name` | `{ zh: "光荣之路", en: "Glory Road" }` | 显示名（与目录名 `achievement`、描述中的「蚀刻章」并存） |
| `description` | `{ zh: "展示已获得的蚀刻章", en: "Display earned achievement medals" }` | 描述文案 |
| `icon` | `"award"` | 图标标识 |
| `defaultSize` | `{ w: 4, h: 2 }` | 默认 4×2 网格 |
| `version` | `"1.0.0"` | 版本号 |
| `allowMultiple` | `true` | 允许多实例（各实例独立选章配置） |
| `tags` | 3 项：`achievement`（成就）、`medal`（蚀刻章）、`display`（显示） | 搜索筛选标签 |

## `src/components/cards/achievement/achievement-modal.tsx`

**职责**：蚀刻章编排弹窗，双视图——`main`：手动选择/使用游戏展示列表的分段切换 + 10 槽位蜂窝 + 备选条带，支持指针拖拽换位、拖入/拖出条带、右键移除槽位；`list`：嵌入 `MedalBrowser` 进行批量勾选。关闭弹窗即把当前编排写回卡片设置。

**导出**：`AchievementModal`（named，236-659）。
**主要依赖**：`react`（`useState/useMemo/useCallback/useEffect/useRef`）；`react-dom`（`createPortal`）；`@/components/ui/glass`（`GlassButton`）；`@/components/ui/app-icon`（`PlusIcon`）；`@/components/custom-modal`（四件套）；`@/types/charDetail`（`AchieveMedal`）；`react-i18next`；`@/utils/imageLoader`（`Img`）；`./medal-browser`（`MedalBrowser`、`effectiveLevel`、`getMedalIcon`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AchievementModalProps` | achievement-modal.tsx:16-24 | `isOpen`、`onClose`、`medals`、`selectedMedalIds`、`useDisplayList`、`displayMedalIds?`、`onSave(selectedIds, useDisplay)` |
| `HEX_CLIP` / `HEX_W` / `HEX_H` | achievement-modal.tsx:26-28 | 槽位六边形 82×95（比卡片内 71×82 大） |
| `STRIP_HEX_W` / `STRIP_HEX_H` | achievement-modal.tsx:29-30 | 条带六边形 72×83 |
| `DRAG_THRESHOLD` | achievement-modal.tsx:31 | `5` px，超过才算拖拽而非点击 |
| `SLOT_COUNT` | achievement-modal.tsx:32 | `10` |
| `DragState` | achievement-modal.tsx:34-41 | 拖拽状态：`medalId`、起止坐标、`icon` |
| `DropTarget` | achievement-modal.tsx:43-46 | `{type:"slot",index}` \| `{type:"strip"}` \| `null` |
| `DroppableHexCell` | achievement-modal.tsx:48-134 | 内部组件：可拖拽/可右键移除的槽位单元；`pointerdown` 启动拖拽（65-69）、`contextmenu` 移除（70-74）、`data-drop-target="slot-N"`（76）、空槽序号（103）、空槽虚线 SVG（106-125）、拖入高亮（126-131） |
| `SlotHoneycomb` | achievement-modal.tsx:136-178 | 内部组件：10 槽蜂窝（`GAP=3` 147、行偏移 `CELL_H*0.75` 150、半格错位 151、5 列 × 2 行 155-156） |
| `StripHex` | achievement-modal.tsx:180-221 | 内部组件：条带中的单枚章，`data-drop-target="strip"`（196），hover 放大（195） |
| `findDropTarget` | achievement-modal.tsx:223-234 | 从 `document.elementFromPoint` 结果向上找 `[data-drop-target]` 并解析为 `DropTarget` |
| `AchievementModal` | achievement-modal.tsx:236-659 | 导出组件，内部状态与交互见下 |
| `view` | achievement-modal.tsx:248 | `"main" \| "list"` 视图切换 |
| `slots` / `strip` | achievement-modal.tsx:250-257 | 10 个槽位 id（不足补 `null`）+ 条带 id 数组（`initialSelectedIds.slice(10)`） |
| `localUseDisplayList` / `listSelectedIds` / `stripSortBy` | achievement-modal.tsx:259-261 | 展示列表模式开关、list 视图勾选集合、条带排序（`default`/`time`/`level`） |
| 拖拽 state/refs | achievement-modal.tsx:263-268 | `drag`、`dragOverTarget`、`dragRef`、`hasDragged`、`dropTargetRef`、`slotsRef` |
| slotsRef 同步 effect | achievement-modal.tsx:270-272 | 保持 ref 与 state 一致（拖拽回调读取） |
| 打开时重置 effect | achievement-modal.tsx:274-285 | 回到 `main` 视图并按 props 重建 `slots`/`strip`/模式/勾选 |
| 禁用右键菜单 effect | achievement-modal.tsx:287-294 | 打开期间 capture 阻止 `contextmenu`（与槽位右键移除配合） |
| `displayMedals` | achievement-modal.tsx:296-300 | `displayMedalIds` → `AchieveMedal` 映射 |
| `cellMedals` | achievement-modal.tsx:302-311 | 展示列表模式取前 10 枚展示章；手动模式按 `slots` 映射 |
| `stripMedals` | achievement-modal.tsx:313-334 | 条带映射 + 排序：`time` 按 `obtainTs` 降序（317-323）、`level` 按 `effectiveLevel` 降序再按时间（324-332） |
| `handleToggle` | achievement-modal.tsx:336-347 | 切换模式；切到手动且槽位/条带全空时用 `displayMedalIds` 初始化 |
| `handleCellDrop` | achievement-modal.tsx:349-391 | 拖放逻辑：放入条带（351-363）、槽位间交换（365-377）、条带拖入槽位并回填被顶替者（378-390） |
| `handleCellRemove` | achievement-modal.tsx:393-407 | 右键清空槽位并把章放回条带 |
| `handleDragStart` | achievement-modal.tsx:409-424 | 记录起点与图标 |
| 拖拽监听 effect | achievement-modal.tsx:426-468 | window `pointermove`（429-448：阈值判定 436-439、命中检测 441-443）、`pointerup`（450-460：落点处理并复位） |
| `handleOpenList` / `handleListCancel` / `handleListSave` | achievement-modal.tsx:470-493 | 进入 list 视图（470-473）、返回（475-477）、把勾选结果回填 slots/strip 后返回（479-493） |
| `handleClose` | achievement-modal.tsx:495-498 | **关闭即保存**：`onSave([...slots, ...strip], localUseDisplayList)` 后 `onClose()` |
| `toggleMedal` | achievement-modal.tsx:500-505 | list 视图勾选/取消 |

**渲染结构（行号）**

- **508** `<CustomModal size={view === "list" ? "xl" : "md"} onClose={handleClose}>`。
- **509-511** `CustomModalHeader`：`main` 视图标题 `card:ach_title`，`list` 视图标题 `card:ach_select_medals`。
- **513-602** `main` 视图 `CustomModalBody`：
  - **516-539** 模式分段控件：「手动选择」按钮（517-527）/「使用游戏展示列表」按钮（528-538），点击走 `handleToggle`。
  - **541-546** `<SlotHoneycomb>`（10 槽位，`dragOverIndex` 来自 `dragOverTarget`）。
  - **548-600** 仅手动模式：**550-577** 排序行（`ach_sort` 标签 552、`default`/`time`/`level` 三个排序按钮 553-570、「选择展示蚀刻章」按钮 573-576 → `handleOpenList`）；**579-598** 备选条带容器（`data-drop-target="strip"` 580，拖入高亮 581，`StripHex` 列表 585-591，空态 593-597）。
- **603-626** `list` 视图：**605-616** `<MedalBrowser>`（`headerLeft` 显示 `ach_selected_count` 已选计数 610-614）；**617-624** `CustomModalFooter`：取消（618-620）/保存（621-623）。
- **628-656** 拖拽幽灵：`createPortal(..., document.body)`，`fixed z-[99999]`，坐标为指针位置减半格（632-633），六边形裁剪显示章图标（645-652）。

**弹窗结构/交互要点**

- 打开：由卡片 `isModalOpen` 控制（index.tsx:290-298）；打开时重置内部状态（274-285）、禁用全局右键（287-294）。
- 拖拽链路：`pointerdown`（65-69 / 190-194）→ `handleDragStart`（409-424）→ window `pointermove`/`pointerup`（462-463）→ `findDropTarget`（223-234）→ `handleCellDrop`（349-391）。
- 右键移除：`DroppableHexCell.onContextMenu`（70-74）→ `handleCellRemove`（393-407）。
- 保存路径：`handleClose`（495-498，任何关闭方式都会触发）→ 卡片 `handleModalSave`（index.tsx:240-253）→ `save_card_settings`；`list` 视图的「保存」按钮仅回写本地 slots/strip（479-493），不直接落库。

**数据来源**

- 本文件**无任何 IPC**：全部数据来自 props（`medals`、`selectedMedalIds`、`useDisplayList`、`displayMedalIds`），持久化由父组件完成。
- settings 字段（间接）：`selectedMedalIds`、`useDisplayList`、`roleId`。
- 配置键：无。
- i18n：`card:ach_title`(510)、`ach_select_medals`(510、575)、`ach_manual_select`(526)、`ach_use_display_list`(537)、`ach_sort`(552)、`ach_default`(565)、`ach_time`(567)、`ach_level_sort`(568)、`ach_no_medals`(595)、`ach_selected_count`(612)、`ach_cancel`(619)、`ach_save`(622)。

**备注**

- `invoke`：**0 个直接调用**（无间接命令）。
- `listen`：**无**。
- window 事件：`addEventListener("contextmenu", ..., true)`（292，capture，打开期间全局屏蔽右键菜单）、`addEventListener("pointermove")`（462）、`addEventListener("pointerup")`（463）。
- 主视图无「取消」按钮：关闭（含点遮罩/ESC）即写入设置。

## `src/components/cards/achievement/medal-browser.tsx`

**职责**：蚀刻章浏览面板——左侧全局搜索（下拉结果可一键定位）与分类列表，右侧等级/镀层/排序筛选器 + 可滚动章列表；当传入 `selectedIds` 时进入多选模式（行末复选框），供编排弹窗的 `list` 视图复用。

**导出**：`effectiveLevel`（12-14）、`getMedalIcon`（16-26）、`formatTimestamp`（28-34）、`MedalBrowser`（54-382）。
**主要依赖**：`react`（`useState/useMemo/useEffect/useRef/useCallback`）；`@/components/ui/app-icon`（`CloseIcon`）；`@/types/charDetail`（`AchieveMedal`）；`react-i18next`；`@/utils/imageLoader`（`Img`）；`@/utils/imageCacheManager`（`useImageRequest`）；`@/components/ui/back-to-top`（`BackToTopFab`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `HEX_CLIP` | medal-browser.tsx:9-10 | 六边形 `clip-path`（列表缩略图用） |
| `effectiveLevel` | medal-browser.tsx:12-14 | 导出：`min(initLevel + level - 1, 3)` |
| `getMedalIcon` | medal-browser.tsx:16-26 | 导出：镀层 → lv3 → lv2 → 初始图标 |
| `formatTimestamp` | medal-browser.tsx:28-34 | 导出：秒级时间戳 → `YYYY-MM-DD` |
| `LEVEL_NAMES` | medal-browser.tsx:36 | 模块常量 `{1:"一级",2:"二级",3:"三级"}`（**硬编码中文**） |
| `ReforgeLevel` | medal-browser.tsx:38-45 | 内部组件：显示 `LEVEL_NAMES[lv]`，否则 `Lv.{lv}` |
| `MedalBrowserProps` | medal-browser.tsx:47-52 | `medals`、`selectedIds?`、`onToggle?`、`headerLeft?` |
| `MedalBrowser` | medal-browser.tsx:54-382 | 导出组件 |
| 筛选 state | medal-browser.tsx:61-66 | `activeCategory`（默认 `"all"`）、`levelFilter`（0=全部）、`platedFilter`（`all`/`plated`/`unplated`）、`sortBy`（默认 `"time"`）、`globalQuery`、`scrollTargetId` |
| `medalListRef` / `getMedalList` | medal-browser.tsx:67-68 | 列表容器 ref（供回到顶部） |
| `categories` | medal-browser.tsx:70-79 | 从 `medals` 聚合 `cate` → `cateName`，首项 `all` |
| `levelOptions` | medal-browser.tsx:81-85 | `[0, 1..3]` 中实际存在的等级 |
| `LEVEL_LABELS` | medal-browser.tsx:87-92 | `0` 用 `t("card:ach_all")`，1/2/3 **硬编码中文** |
| `filteredMedals` | medal-browser.tsx:94-121 | 分类（96-97）→ 等级（98-99）→ 镀层（100-102）→ 排序（103-119：`time` 时间降序优先，`level` 等级降序优先，兜底名称 `localeCompare`） |
| `globalResults` | medal-browser.tsx:123-131 | 名称包含匹配，按名称排序 |
| `handleLocate` | medal-browser.tsx:133-139 | 定位：重置分类为该章分类、清空其余筛选与搜索、设置 `scrollTargetId` |
| 定位滚动 effect | medal-browser.tsx:141-151 | 60ms 后 `scrollIntoView` 到 `[data-medal-id]` |
| 分类切换复位 effect | medal-browser.tsx:154-156 | 切分类后列表回到顶部 |
| `imagePaths` + `useImageRequest` | medal-browser.tsx:158-162 | 当前过滤结果的图标预取 |
| `selectable` | medal-browser.tsx:164 | `selectedIds != null` 决定是否多选模式 |

**渲染内容区块（行号）**

- **166-385** 外层 fragment：
  - **169-228** 左侧栏（宽 176px）：**170-211** 搜索区（输入框 172-178、清除按钮 179-188、下拉结果 190-213，外层 `lg-regular` 宿主 + 内层滚动容器，最多显示 50 条，空结果提示）；**212-227** 分类按钮列表（213-226，选中态高亮 218-221）。
  - **230-380** 右侧：**231-287** 筛选条（等级标签 232-234 与等级按钮 235-248、镀层标签 249-251 与三态按钮 252-269、排序标签 270-272 与两态按钮 273-286）；**289-379** 章列表（外层 `lg-material` 玻璃宿主 292，内层滚动容器 293-296 挂 `medalListRef`；空态；条目：六边形图标、名称、等级 + 镀层标记 + 获得时间、多选复选框）。玻璃宿主与滚动容器分层：`::before` 材质层随滚动容器滚动会被滚走（毛玻璃消失），故不合并。
  - **379** `<BackToTopFab getContainer={getMedalList} />` 回到顶部悬浮按钮。

**数据来源**

- 本文件**无任何 IPC**：数据全部来自 `medals` props（由 `AchievementModal` 透传，源自 `charDetail.achieve.achieveMedals`）。
- 仅图片缓存经 `useImageRequest`（162）间接 `invoke`：`get_image_cache_dir` / `read_image_file` / `download_image`。
- settings 字段：无（纯展示/筛选组件）；配置键：无。
- i18n：`ach_all`(72、88、264)、`ach_search`(176)、`ach_no_medals`(206、295)、`ach_level`(233)、`ach_plated`(250、266、337)、`ach_unplated`(267)、`ach_sort`(271)、`ach_time`(284)、`ach_level_sort`(284)。

**备注**

- `invoke`：**0 个直接调用**；间接命令：`get_image_cache_dir`、`read_image_file`、`download_image`。
- `listen`：**无**。
- window/document 事件：无监听（滚动定位用 `document.querySelector` + `scrollIntoView`，144-147）。
- 与其它文件重复：`effectiveLevel`/`getMedalIcon` 与 `achievement/index.tsx:30-42` 重复；`formatTimestamp` 与 `account-info/index.tsx:40-49` 的 `formatDate` 逻辑重复。

## `src/components/cards/achievement/locales/zh.json`

共 17 键（与 `en.json` 键集完全一致）：

| 键 | 中文值 | 使用位置 |
| --- | --- | --- |
| `ach_title` | 光荣之路 | achievement-modal.tsx:510 |
| `ach_select_medals` | 选择展示蚀刻章 | achievement-modal.tsx:510、575 |
| `ach_use_display_list` | 使用游戏展示列表 | achievement-modal.tsx:537 |
| `ach_manual_select` | 手动选择 | achievement-modal.tsx:526 |
| `ach_save` | 保存 | achievement-modal.tsx:622 |
| `ach_cancel` | 取消 | achievement-modal.tsx:619 |
| `ach_all` | 全部 | medal-browser.tsx:72、88、264 |
| `ach_plated` | 镀层 | medal-browser.tsx:250、266、337 |
| `ach_selected_count` | 已选 `{{count}}`/10 | achievement-modal.tsx:612 |
| `ach_no_medals` | 该分类下没有蚀刻章 | achievement-modal.tsx:595；medal-browser.tsx:206、295 |
| `ach_level` | 等级 | medal-browser.tsx:233 |
| `ach_unplated` | 无镀层 | medal-browser.tsx:267 |
| `ach_sort` | 排序 | achievement-modal.tsx:552；medal-browser.tsx:271 |
| `ach_default` | 默认 | achievement-modal.tsx:565 |
| `ach_time` | 最新 | achievement-modal.tsx:567；medal-browser.tsx:284 |
| `ach_level_sort` | 最高 | achievement-modal.tsx:568；medal-browser.tsx:284 |
| `ach_search` | 搜索蚀刻章名称 | medal-browser.tsx:176 |

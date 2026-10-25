# 签到/领域信息/飞船卡片 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## 卡片总览

| 卡片 id | 目录 | 主组件 | 附属组件 | 数据来源 |
| --- | --- | --- | --- | --- |
| `attendance` | `src/components/cards/attendance/` | `index.tsx` 默认导出 `AttendanceCard` | `attendance-settings-modal.tsx`、`attendance-rewards-modal.tsx`、`attendance-rewards.tsx`、`attendance.meta.json`、`locales/{zh,en}.json` | Tauri `invoke("get_attendance"/"do_attendance")`；`CardConfigService`（`get_card_settings`/`save_card_settings`）；`CardStartupService`（配置键 `card_auto_sign_users`/`card_user_mapping`，底层 `get_config`/`set_config`）；`getAccounts()`（`invoke("get_accounts")`） |
| `domain_info` | `src/components/cards/domain-info/` | `index.tsx` 默认导出 `DomainInfoCard` | 无独立子组件文件；文件内含 3 个内嵌 `CustomModal`；`domain-info.meta.json`、`locales/{zh,en}.json` | `roleDataService.queryData(roleId,"char_detail",["domain"])` → `invoke("query_role_data")`；`CardConfigService`；`getAccounts()` |
| `spaceship` | `src/components/cards/spaceship/` | `index.tsx` 默认导出 `SpaceshipCard` | `spaceship-shared.ts`（与 `/spaceship` 页面共用的类型/工具）、文件内含 2 个内嵌 `CustomModal`；`spaceship.meta.json`、`locales/{zh,en}.json` | `roleDataService.queryData(roleId,"char_detail",["spaceShip"])` 与 `roleDataService.getFullCharDetail()` → `invoke("query_role_data")`；`CardConfigService`；`getAccounts()`；头像预取 `useImageRequest` → `invoke("get_image_cache_dir"/"download_image"/"read_image_file")` |

三张卡片均**不使用** Tauri `listen()`，跨组件通信一律通过 `window` 上的 `CustomEvent("cardAction")`（由 `card-container.tsx` 右键菜单派发）。

---

## `src/components/cards/attendance/index.tsx`

**职责**：每日签到卡片主体。加载卡片设置 → 拉取签到日历数据 → 展示今日/明日奖励与签到进度环（可旋转/打勾动画）→ 发起签到 → 通过设置弹窗选择签到账号与「启动时自动签到」；同时注册为卡片 `startup` 启动任务。

**导出**：`startup(roleId)`（19-23）、`CalendarEntry`（25）、`ResourceInfo`（31）、`AttendanceData`（38）、`parseAttendanceData()`（49）、`AttendanceCard`（默认导出，81）。
**主要依赖**：`GlassButton/GlassCard/GlassProgressCircle`、`useTranslation`、`BaseCardProps`、`CardConfigService`、`CardStartupService`、`AttendanceCardSettings`、`AttendanceSettingsModal`、`AttendanceRewardsModal`、`getAccounts`、`Img`、`invoke`（`@tauri-apps/api/core`）、`logError`、`addMessage`、`resolveServerLabel`（1-15）。

### 符号清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `signedInRoleIds` | 17 | 模块级 `Set`，防止同一 roleId 重复执行启动签到 |
| `startup(roleId)` | 19-23 | 导出的启动钩子；`invoke("do_attendance", { roleId })`，由 `registry/loader.ts` 注册到 `CardStartupService` |
| `CalendarEntry` | 25-29 | `{ awardId, available, done }` |
| `ResourceInfo` | 31-36 | `{ id, count, name, icon }` |
| `AttendanceData` | 38-44 | `{ currentTs, calendar, first, resourceInfoMap, hasToday }` |
| `AttendanceState` / `SignPhase` | 46-47 | 私有联合类型：`loading/signed/unsigned/error`、`idle/spinning/completing/done` |
| `parseAttendanceData(json)` | 49-63 | 校验 `json.data.calendar` 与 `resourceInfoMap`，缺失返回 `null` |
| `findTodayEntry(calendar)` | 65-72 | 取第一个 `available && !done`；否则最后一个 `done`；否则第一项 |
| `findLastIndex(arr, pred)` | 74-79 | 反向查找工具 |
| `AttendanceCard`（组件） | 81-586 | 见下方状态与渲染区块 |
| state 组 | 87-101 | `settings`、`settingsLoaded`、`showSettingsModal`、`isFirstTimeSetup`、`firstTimePrompt`、`autoSignEnabled`、`showRewardsModal`、`attendanceData`、`attendanceState`、`signPhase`、`_signError`、`accountCache`、`completionTimer` |
| `checkAutoSign` | 105-112 | `CardStartupService.isAutoSignEnabled(roleId)` |
| `openFirstTimePrompt` / `openSettings` | 114-117 / 119-123 | 打开设置弹窗（首次设置 vs 普通设置） |
| `openRewardsModal` | 125-128 | 有数据才允许打开奖励弹窗 |
| `loadSettings` | 130-143 | `CardConfigService.getCardSettings<AttendanceCardSettings>(cardId)`；无 `selectedRoleId` 且 `firstTimePrompt` 时弹首次设置 |
| effect（触发 loadSettings） | 145-147 | 挂载执行 |
| `fetchAttendance` | 149-169 | `invoke("get_attendance", { roleId })`（启动 Splash 跟踪期间计入初始任务）→ `parseAttendanceData` → `hasToday ? "signed" : "unsigned"` |
| `loadAccounts` | 171-178 | `getAccounts()` 缓存账号列表 |
| effect（取数入口） | 180-188 | 设置未加载则等待；无 `selectedRoleId` 置 `unsigned`；否则 `fetchAttendance()` + `loadAccounts()` |
| `completeSignIn` | 190-197 | `completing` → 600ms 后 `done`+`signed` 并重新 `fetchAttendance()` |
| `handleSignIn` | 199-218 | `invoke("do_attendance", { roleId })`；成功 `addMessage(info)`，失败 `addMessage(urgent)` 并回到 `idle` |
| effect（清理定时器） | 220-224 | 卸载时 `clearTimeout(completionTimer)` |
| effect（启动任务订阅） | 226-250 | `CardStartupService.getTaskStatus` 置 `spinning`；`subscribe(roleId, …)` 运行中→`spinning`，`done/error`→`fetchAttendance()`；`onAutoSignChanged` 同步 `autoSignEnabled` |
| effect（cardAction） | 252-261 | 监听 `window` `cardAction`，`action === "settings"` 时 `openSettings()` |
| `handleSaveSettings` | 263-296 | 写 `updateCardSetting(cardId,"selectedRoleId",…)`；`updateUserMapping`；角色变更时若旧用户无其它卡片则 `removeAutoSignUser`；新用户按 `autoSign` 执行 `addAutoSignUser`/`removeAutoSignUser` |
| `selectedAccount` | 298-301 | 按 `settings.selectedRoleId` 从 `accountCache` 找账号 |
| `todayReward` / `todayClaimed` | 303-308 / 310-314 | 由 `findTodayEntry` + `resourceInfoMap` 派生 |
| `tomorrowReward` / `tomorrowClaimed` | 316-323 / 325-331 | `calendar[today.index + 1]`，越界返回 `null/false` |
| 加载占位分支 | 333-344 | `!settingsLoaded` 时返回 `GlassProgressCircle` |
| 派生标志 | 346-348 | `showSignButton`、`isSpinning`、`isDone` |
| `R/CIRCUMFERENCE/circleProps` | 350-352 | 进度环几何常量（r=22，圆心 26,26） |
| `renderRewardBox(...)` | 354-388 | 单个奖励格（图标、名称、数量、已领对勾） |
| 主 JSX | 390-585 | 见下 |
| `<style>` 关键帧 | 570-583 | `attendance-spin-arc`、`attendance-ring-in`、`attendance-check-in` |

### 渲染区块（主 JSX 行号）

| 区块 | 行号 | 说明 |
| --- | --- | --- |
| 点击容器（打开奖励弹窗） | 393-396 | `onClick={openRewardsModal}` |
| 左侧状态区（宽 68px） | 397-503 | 四态互斥 |
| ├ 未选账号 | 398-406 | 加号图标 + `attendance_select_account` 按钮 → `openSettings` |
| ├ 错误态 | 407-415 | 警告图标 + `attendance_refresh` 按钮 → `fetchAttendance` |
| ├ 加载弧 | 416-441 | 旋转 25% 圆弧动画 |
| ├ 待签到（画笔图标） | 442-450 | `stopPropagation` 后 `handleSignIn()` |
| └ 旋转/完成态 | 451-502 | `isSpinning` 旋转弧（454-468）；`isDone` 绿环+对勾动画（470-499） |
| 右侧账号行 | 505-544 | 有账号（506-533，头像/昵称/服务器 `resolveServerLabel`/自动签到绿点 528-530）；无账号占位（534-544） |
| 今日/明日奖励行 | 546-550 | `renderRewardBox` × 2，中间分隔线 548 |
| 设置弹窗 | 555-562 | `AttendanceSettingsModal`，`showAutoSign={!isFirstTimeSetup}` |
| 奖励弹窗 | 564-568 | `AttendanceRewardsModal` |

**弹窗结构**：卡片本身挂载两个弹窗组件——`AttendanceSettingsModal`（账号选择 + 自动签到开关，见其独立小节）与 `AttendanceRewardsModal`（标题 `attendance_title`，正文 `AttendanceRewards`）。卡片文件内无内嵌 `CustomModal`。

**数据来源**
- 直接 `invoke`：`get_attendance`（155）、`do_attendance`（22、209），参数均为 `{ roleId }`。
- 服务：`CardConfigService.getCardSettings`（132）、`CardConfigService.updateCardSetting`（268）；`CardStartupService.isAutoSignEnabled`（107）、`getTaskStatus`（230）、`subscribe`（235）、`onAutoSignChanged`（243）、`updateUserMapping`（273）、`getCardIdsByUser`（276、285）、`addAutoSignUser`（283）、`removeAutoSignUser`（278、287）；`getAccounts()`（173）。
- settings 字段：`AttendanceCardSettings.selectedRoleId`（`src/types/card-settings.ts:20-22`）。
- 全局配置键（经 `configService` → `get_config`/`set_config`）：`card_auto_sign_users`、`card_user_mapping`（`src/cards/startup-service.ts:8-9`）。
- i18n key：`attendance_select_account`、`attendance_refresh`、`attendance_error`、`attendance_no_account`、`attendance_today`、`attendance_tomorrow`。
- 事件：`window.addEventListener("cardAction")`（259）。

**备注（本文件出现的全部 invoke 命令）**：`do_attendance`、`get_attendance`。无 `listen()`。

---

## `src/components/cards/attendance/attendance-settings-modal.tsx`

**职责**：签到设置弹窗。加载在线/离线账号列表供单选，可选显示「启动时自动签到」开关，确认后把 `(selectedRoleId, autoSign)` 回传父组件。

**导出**：`AttendanceSettingsModal`（24）。`AttendanceSettingsModalProps`（15-22，未导出）。
**主要依赖**：`GlassButton/GlassProgressCircle/GlassSwitch`、`CustomModal*`、`useTranslation`、`getAccounts`、`Img`、`resolveServerLabel`、`logError`（1-13）。

### 符号清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AttendanceSettingsModalProps` | 15-22 | `isOpen/onClose/selectedRoleId/autoSign/showAutoSign/onSave` |
| state | 33-36 | `accounts`、`loading`、`localSelectedRoleId`、`localAutoSign`（本地草稿） |
| effect（打开时刷新） | 38-58 | 重置草稿 → `getAccounts()` → 过滤 `status === "online" || "offline"` → 无选中则默认第一个（49-51，闭包读到的是旧 state） |
| `sortedAccounts` | 60-70 | 选中项前置排序 |
| `handleConfirm` / `handleClose` | 72-75 / 77-79 | 确认调用 `onSave` 后关闭 |
| JSX | 83-191 | 见下 |

### 渲染区块 / 弹窗结构

| 区块 | 行号 | 说明 |
| --- | --- | --- |
| `CustomModal`（size `sm`） | 84 | 容器 |
| Header（`attendance_settings`） | 85-87 | |
| Body | 88-177 | 加载中 89-97；空列表 98-104（`common.no_data`）；内容 105-176 |
| ├ 自动签到开关 | 107-122 | 仅 `showAutoSign` 为真时渲染；`attendance_auto_sign`/`attendance_auto_sign_desc` + `GlassSwitch` |
| └ 账号列表 | 124-174 | 标题 125-127（`attendance_select_account`）；滚动容器 128；条目 129-172（头像/首字母、昵称、`resolveServerLabel`、`Lv.`、选中对勾） |
| Footer | 178-189 | 取消（`common.cancel`）179-181；确认（`common.confirm`）182-188，`isDisabled={!localSelectedRoleId}` |

**数据来源**：`getAccounts()` → `invoke("get_accounts")`（间接）。不写任何 settings；写入由父组件 `handleSaveSettings` 完成。i18n key：`attendance_settings`、`attendance_auto_sign`、`attendance_auto_sign_desc`、`attendance_select_account`、`common.no_data`、`common.cancel`、`common.confirm`。

**备注（invoke）**：本文件无直接 `invoke`/`listen`；间接命令 `get_accounts`。

---

## `src/components/cards/attendance/attendance-rewards.tsx`

**职责**：奖励内容渲染器（纯展示）。上半部「新手奖励」横排卡片，下半部「月度奖励」7 列网格，已领取项降透明度并叠加对勾。

**导出**：`AttendanceRewards`（5）。
**主要依赖**：`useTranslation`、`Img`、类型 `AttendanceData/ResourceInfo`（来自 `./index`）（1-3）。

### 符号清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AttendanceRewards` | 5-106 | props：`attendanceData`，为 `null` 时返回 `null`（12） |
| `renderRewardIcon(entry, size?)` | 14-41 | 组件内函数：按 `awardId` 查 `resourceInfoMap`，默认 60×60；`done` 时 40% 透明 + 对勾；缺资源显示 `--` |
| 新手奖励区 | 46-70 | 标题 `attendance_first_rewards`（48-50）；`first` 数组 → 84px 卡片（52-67），无 reward 跳过（54） |
| 月度奖励区 | 73-103 | 标题 `attendance_monthly_rewards`（74-76）；`calendar` → `grid-cols-7`（77），格子 81-100：`attendance_day`（88）、图标（90）、名称/数量（91-98） |

**数据来源**：仅父组件传入的 `attendanceData`（来自 `get_attendance`）。i18n key：`attendance_first_rewards`、`attendance_monthly_rewards`、`attendance_day`（`{{day}}`）。

**备注（invoke）**：无 `invoke`、无 `listen`。

---

## `src/components/cards/attendance/attendance-rewards-modal.tsx`

**职责**：签到奖励弹窗外壳，标题 + `AttendanceRewards` 正文，无底部按钮。

**导出**：`AttendanceRewardsModal`（16）。`AttendanceRewardsModalProps`（10-14，未导出）。
**主要依赖**：`CustomModal/CustomModalHeader/CustomModalBody`、`useTranslation`、`AttendanceRewards`、类型 `AttendanceData`（1-8）。

### 符号清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AttendanceRewardsModal` | 16-33 | props：`isOpen/onClose/attendanceData` |
| `CustomModal`（size `md`） | 24 | 弹窗容器 |
| Header | 25-27 | 文案 `attendance_title` |
| Body | 28-30 | 渲染 `<AttendanceRewards attendanceData={…} />`（29） |

**数据来源**：无取数调用，纯受控组件。**备注（invoke）**：无 `invoke`、无 `listen`。

---

## `src/components/cards/attendance/attendance.meta.json`

逐字段说明（共 20 行）：

| 字段 | 行号 | 值 | 说明 |
| --- | --- | --- | --- |
| `id` | 2 | `"attendance"` | 卡片类型唯一标识；`registry/loader.ts` 用它注册并作为 settings 存储键 |
| `name` | 3-6 | `{zh:"每日签到", en:"Daily Attendance"}` | 多语言卡片名 |
| `description` | 7-10 | `{zh:"查看并执行森空岛每日签到，查看今日和明日奖励", en:"…"}` | 多语言描述，卡片库展示用 |
| `icon` | 11 | `"calendar"` | 图标键（`CardIcon`） |
| `defaultSize` | 12 | `{w:3,h:1}` | 默认网格尺寸 3×1 |
| `version` | 13 | `"1.0.0"` | 卡片版本 |
| `allowMultiple` | 14 | `true` | 允许添加多张 |
| `tags` | 15-19 | `attendance`（签到）、`reward`（奖励）、`daily`（每日） | 用于卡片库搜索/筛选，每项 `{id,label:{zh,en}}` |

符合 `CardMeta` 接口（`src/components/cards/registry/types.ts:8-17`）。

## `src/components/cards/attendance/locales/zh.json`

共 28 行、27 个键，扁平结构，由 `registry/loader.ts:21-54` 合并进 i18n 的 **`card` 命名空间**（因此代码里用 `t("card:xxx")`，且同名键会被后扫描的卡片覆盖）。

| 键 | 值 | 使用处 |
| --- | --- | --- |
| `attendance_title` | 每日签到 | 奖励弹窗标题（rewards-modal:26） |
| `attendance_signed` / `attendance_not_signed` | 已签到 / 未签到 | 卡片目录内未引用 |
| `attendance_today` / `attendance_tomorrow` | 今日奖励 / 明日奖励 | index:547/549 |
| `attendance_sign_btn` | 签到 | 未引用 |
| `attendance_sign_success` / `attendance_sign_failed` | 签到成功！/ 签到失败 | 未引用（实际提示由 `addMessage` 硬编码中英文，index:210/214） |
| `attendance_no_account` | 请先选择签到账户 | index:542；`pages/attendance.tsx:97` |
| `attendance_select_account` | 选择签到账户 | index:404、settings-modal:126 |
| `attendance_current_account` | 当前签到账户 | 未引用 |
| `attendance_auto_sign` / `attendance_auto_sign_desc` | 启动时自动签到 / 应用启动后自动执行签到 | settings-modal:110/111 |
| `attendance_day` | 第{{day}}天 | rewards:88 |
| `attendance_settings` | 签到设置 | settings-modal:86 |
| `attendance_refresh` | 刷新 | index:413 |
| `attendance_loading` | 加载中... | 未引用 |
| `attendance_error` | 获取签到数据失败 | index:159；`pages/attendance.tsx:37` |
| `attendance_network_error` | 网络错误，请稍后重试 | 未引用 |
| `attendance_already_signed` | 今日已签到 | 未引用 |
| `attendance_first_rewards` / `attendance_monthly_rewards` | 新手奖励 / 月度奖励 | rewards:49/75 |
| `attendance_no_tomorrow` | 已到末尾 | 未引用 |
| `settings` | 设置 | 供 `card-container` 等共用 `card:settings` |
| `confirm_delete_title` / `confirm_delete_body` | 删除卡片 / 确定要删除该卡片吗？ | `card-container.tsx:271` 使用 `confirm_delete_title` |

---

## `src/components/cards/domain-info/index.tsx`

**职责**：大世界区域（domain）信息卡片。展示当前区域名称/等级、区域货币（谷地/武陵调度卷）余额进度、基建建设点列表；支持切换账号、切换区域、查看建设点详情列表三个弹窗。数据类型与格式化工具抽取到 `domain-shared.ts`，与独立页面 `src/pages/domain.tsx` 共用。

**导出**：`DomainInfoCard`（默认导出）；`DomainData`/`DomainSettlement` 从 `./domain-shared` 再导出（向后兼容）。
**主要依赖**：`GlassButton/GlassCard/GlassProgressCircle`、`useCardData`、`roleDataService`、`CardConfigService`、`getAccounts`、`AccountAvatar`、`Img`、`logError`、`resolveServerLabel`、`CustomModal*`、类型 `Account`/`DomainInfoCardSettings`、`./domain-shared`（`DomainData`/`DomainSettlement`/`formatMoney`/`formatDateTime`/`getMoneyName`）。

### 符号清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `domain-shared.ts` | 独立文件 | `DomainSettlement`/`DomainData` 接口、`formatMoney`（`≥10000` 转 `x.xw`）、`formatDateTime`（秒级时间戳 → `MM-DD HH:mm`）、`DOMAIN_MONEY_NAMES`（`domain_1` 谷地调度卷 / `domain_2` 武陵调度卷）、`getMoneyName(domainId, lang)`——卡片与 `/domain` 页面共用 |
| state | 82-91 | `customRoleId`（初值 `settings.roleId`）、`domainId`（初值 `settings.domainId`）、`isRoleSelectOpen`、`isDomainSelectOpen`、`isListOpen`、`accounts` |
| `effectiveRoleId` | 93 | `customRoleId ?? defaultRoleId` |
| `useCardData<DomainData[]>` | 95-103 | `roleDataService.queryData(effectiveRoleId, "char_detail", ["domain"])`，取 `result["domain"]`；`reloadKey = effectiveRoleId` |
| `domains` / `effectiveDomain` | 105 / 107-110 | 按 `domainId` 匹配，否则第一个 |
| `loadSettings` | 112-120 | `CardConfigService.getCardSettings<DomainInfoCardSettings>(cardId)` 回填 `roleId`/`domainId`（与 82-87 的 props 初值重复） |
| effect | 122-124 | 触发 `loadSettings` |
| `loadAccounts` / effect | 126-133 / 135-137 | `getAccounts()`；`effectiveRoleId` 变化重载 |
| `saveDomain(newDomainId, newRoleId?)` | 139-151 | `CardConfigService.saveCardSettings(cardId, patch)`（合并写入） |
| `openAccountSelect` | 153-161 | 重新拉账号后打开角色弹窗 |
| `openDomainSelect` / `openList` | 163-165 / 167-169 | 打开对应弹窗 |
| effect（cardAction） | 171-185 | `change-role`→账号弹窗；`switch-domain`→区域弹窗；`view-list`→列表弹窗 |
| `handleRoleConfirm` / `handleDomainConfirm` | 187-191 / 193-197 | 关弹窗 + `saveDomain` |
| `currentAccount` / `settlements` | 199-202 / 204 | 派生账号与建设点列表 |
| 加载分支 | 206-217 | `isLoading` → `GlassProgressCircle` |
| 空态分支 | 219-225 | 无 `effectiveDomain` → `domain_info_empty` |

### 渲染区块（主卡片 227-324）

| 区块 | 行号 | 说明 |
| --- | --- | --- |
| 卡片容器 | 229 | `GlassCard` |
| 头部行 | 230-273 | `AccountAvatar`（232-237）；域名 + 多区域时切换按钮（238-256，`openDomainSelect`）；等级（257-259，`domain_info_level`）；右侧切换账号按钮（262-272，`openAccountSelect`） |
| 主体行 | 275-323 | 左：货币列 276-287（货币名 277-280、`count` 282-284、`/ total` 285）；右：建设点列表 289-322（标题 290-292，条目 295-319：头像 301-307、名称 308-310、等级 311-313、`remainMoney/moneyMax` 314-317） |

### 弹窗结构（三个内嵌 `CustomModal`）

| 弹窗 | 行号 | 结构 |
| --- | --- | --- |
| 建设点详情列表（`isListOpen`） | 326-460 | Header 331-334（域名 · `domain_info_settlements`）；Body 335-454：区域等级行 337-342、货币行 343-351、分隔+列表 353-452（空态 357-360；滚动容器 362，条目 363-449：头像/名称/等级/MAX 徽标 377-397，货币进度条 401-419，经验进度条 420-437，上次产出 438-445）；Footer 455-459（`common.close`） |
| 切换区域（`isDomainSelectOpen`） | 462-498 | Header 467-469（`domain_info_switch_domain`）；Body 470-492 列出 `domains`（472-490，当前项显示 `card:current`）；Footer 493-497（`common.cancel`） |
| 切换账号（`isRoleSelectOpen`） | 500-549 | Header 505-507（`card:select_role`）；Body 508-543 空态 510-513（`card:no_accounts`）/账号条目 515-541（头像、昵称、`resolveServerLabel`·`Lv.`、当前标记）；Footer 544-548（`common.cancel`） |

**数据来源**
- 取数：`roleDataService.queryData(roleId, "char_detail", ["domain"])` → `invoke("query_role_data", { roleId, apiName, paths })`（`src/utils/roleDataService.ts:83`）。
- 服务：`CardConfigService.getCardSettings`（114）、`saveCardSettings`（145）；`getAccounts()`（128、155）。
- settings 字段：`DomainInfoCardSettings.roleId`、`DomainInfoCardSettings.domainId`（`src/types/card-settings.ts:51-54`）。
- i18n key（本文件引用）：`domain_info_empty`、`domain_info_switch_domain`、`domain_info_level`、`domain_info_switch_account`、`domain_info_money`、`domain_info_settlements`、`domain_info_settlement_level`、`domain_info_settlement_money`、`domain_info_settlement_exp`、`domain_info_settlement_last_tick`、`card:select_role`、`card:no_accounts`、`card:current`、`common.unknown`、`common.close`、`common.cancel`；`domain_info_view_list` 由 `card-container.tsx:242` 的右键菜单使用。
- 事件：`window` `cardAction`（183）。

**备注（本文件出现的全部 invoke 命令）**：文件内无直接 `invoke`；间接 `query_role_data`、`get_card_settings`、`save_card_settings`、`get_accounts`。无 `listen()`。

---

## `src/components/cards/domain-info/domain-info.meta.json`

| 字段 | 行号 | 值 | 说明 |
| --- | --- | --- | --- |
| `id` | 2 | `"domain_info"` | 卡片类型标识（= settings 键名） |
| `name` | 3-6 | `{zh:"区域信息", en:"Domain Info"}` | 多语言名称 |
| `description` | 7-10 | `{zh:"展示大世界区域信息（等级、货币、基建建设点）", en:"…"}` | 多语言描述 |
| `icon` | 11 | `"map"` | 图标键 |
| `defaultSize` | 12 | `{w:4,h:2}` | 默认 4×2 |
| `version` | 13 | `"1.0.0"` | 版本 |
| `allowMultiple` | 14 | `true` | 允许多实例 |
| `tags` | 15-19 | `account`（账户）、`domain`（区域）、`display`（显示） | 搜索/筛选标签 |

## `src/components/cards/domain-info/locales/zh.json`

共 13 行、12 个键，合并进 `card` 命名空间：

| 键 | 值 | 使用处 |
| --- | --- | --- |
| `domain_info_level` | 区域等级 | index:258、338、481 |
| `domain_info_money` | 货币 | index:279、345（作为 `getMoneyName` 的兜底） |
| `domain_info_settlements` | 基建建设点 | index:291、333、355 |
| `domain_info_settlement_level` | 等级 | index:312、391 |
| `domain_info_settlement_exp` | 经验 | index:423 |
| `domain_info_settlement_money` | 货币 | index:404 |
| `domain_info_settlement_last_tick` | 上次产出 | index:440 |
| `domain_info_switch_account` | 切换账号 | index:265 |
| `domain_info_switch_domain` | 切换区域 | index:247、468 |
| `domain_info_view_list` | 查看列表 | `card-container.tsx:242` |
| `domain_info_empty` | 暂无数据 | index:222、332、359 |

---

## `src/components/cards/spaceship/index.tsx`

**职责**：帝江号（spaceship）卡片。展示各舱室等级与派驻干员头像（心情色环），点开舱室弹窗查看每位干员的心情/信赖进度条；支持切换账号弹窗。总控中枢置顶，未识别舱室类型不展示。数据类型与心情/信赖计算工具抽取到 `spaceship-shared.ts`，与独立页面 `src/pages/spaceship.tsx` 共用。

**导出**：`SpaceshipCard`（默认导出）；`SpaceShipRoomChar`/`SpaceShipRoom` 从 `./spaceship-shared` 再导出（向后兼容）。
**主要依赖**：`Glass*` 组件、`useCardData`、`roleDataService`、`CardConfigService`、`getAccounts`、`AccountAvatar`、`Img`、`logError`、`resolveServerLabel`、`useImageRequest`、`CustomModal*`、`CardIcon`、类型 `Account`/`CharDetailData`/`CharacterItem`/`SpaceshipCardSettings`、`./spaceship-shared`（`SpaceShipRoom`/`SpaceShipRoomChar`/`StationedCharView`/`TRUST_TEXT_CLASS`/`getMoodPercent`/`getTrustPercent`/`getTrustLevel`/`getMoodRingClass`/`getMoodTextClass`/`getRoomMeta`/`collectSpaceshipIds`/`sortSpaceshipRooms`）。

### 符号清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `spaceship-shared.ts` | 独立文件 | `SpaceShipRoomChar`（`charId/physicalStrength(心情)/favorability(信赖)/avatarUrl`）、`SpaceShipRoom`（`id/type/level/chars[]/reports`）、`TrustLevelKey`、常量 `MOOD_MAX=10000`/`TRUST_CLOSE_THRESHOLD=300`/`TRUST_MAX_THRESHOLD=1500`、`ROOM_META`（`0→control(satellite)`、`1→manufacturing(factory)`、`2→growth(sprout)`、`5→reception(bell)`）、`TRUST_TEXT_CLASS`、`clamp`、`getMoodPercent`、`getTrustPercent`（分段取整）、`getTrustLevel`、`getMoodRingClass`/`getMoodTextClass`/`getMoodBarClass`、`getRoomMeta`、`StationedCharView`、`collectSpaceshipIds`、`sortSpaceshipRooms`——卡片与 `/spaceship` 页面共用 |
| state | 136-141 | `customRoleId`（初值 `settings.roleId`）、`isRoleSelectOpen`、`detailRoomIndex`、`accounts` |
| `effectiveRoleId` | 143 | `customRoleId ?? defaultRoleId` |
| `useCardData<SpaceShipRoom[]>` | 145-152 | `queryData(effectiveRoleId, "char_detail", ["spaceShip"])` → `result?.spaceShip?.rooms` |
| `useCardData<CharDetailData>` | 154-157 | `roleDataService.getFullCharDetail(effectiveRoleId)`（用于把 charId 解析成名字/头像） |
| `sortedRooms` | 160-167 | 过滤未知类型，`type === 0`（总控中枢）排前，其余保持接口顺序 |
| `resolveStationedChar` | 169-191 | 用 `collectSpaceshipIds(...).some(id => id.includes(shipCharId))` 匹配已拥有干员，取名字与 `avatarSqUrl/avatarRtUrl`，回退 `roomChar.avatarUrl` |
| `allAvatarPaths` / `useImageRequest` | 193-204 / 206 | 收集去重头像路径并批量预取缓存 |
| `loadSettings` / effect | 208-215 / 217-219 | `getCardSettings<SpaceshipCardSettings>(cardId)` |
| `openAccountSelect` / `loadAccounts` / effect | 221-229 / 231-238 / 240-242 | `getAccounts()` |
| effect（cardAction） | 244-254 | 仅响应 `change-role` → 打开账号弹窗 |
| `handleRoleConfirm` | 256-264 | `CardConfigService.saveCardSettings(cardId, { roleId })` |
| `currentAccount` | 266-269 | 当前账号对象 |
| `renderRoomName(type)` | 271-274 | `t("card:spaceship_room_" + key)`，未知→`spaceship_room_unknown` |
| `detailRoom` / `detailChars` | 276-279 | 由 `detailRoomIndex` 展开的详情数据 |
| 加载分支 / 空态分支 | 281-292 / 294-300 | 转圈 / `spaceship_empty` |

### 渲染区块（主卡片 302-400）

| 区块 | 行号 | 说明 |
| --- | --- | --- |
| 卡片容器 | 304 | `GlassCard` |
| 头部行 | 305-336 | `AccountAvatar`（307-312）；标题 `spaceship_title`（314-316）；副标题：昵称 + `spaceship_rooms_count`（317-322）；右侧切换账号按钮（325-335，`openAccountSelect`） |
| 舱室网格（2 列，可滚动） | 338-399 | 遍历 `sortedRooms`（339-398）；条目点击 → `setDetailRoomIndex(idx)`（346-349，编辑模式 `isEditMode` 时禁用）；标题行 351-361（`CardIcon`、舱室名、`Lv.`）；有派驻 363-390（头像叠放 365-386 + `spaceship_stationed_count` 387-389）；无派驻 391-395（虚线框 `spaceship_no_stationed`） |

### 弹窗结构（两个内嵌 `CustomModal`）

| 弹窗 | 行号 | 结构 |
| --- | --- | --- |
| 舱室详情（`detailRoom !== null`） | 402-508 | Header 407-418（图标 + 舱室名 · `Lv.`）；Body 419-502：空态 420-423（`spaceship_no_stationed`）/ 干员卡片列表 425-500，单卡 427-499（头像带心情色环 432-447，姓名 449-451，信赖档位文字 `spaceship_trust_{level}` 452-454，心情进度条 458-480，信赖进度条 481-496，条宽 `trustPct/200`）；Footer 503-507（`spaceship_close`） |
| 切换账号（`isRoleSelectOpen`） | 510-559 | Header 515-517（`spaceship_select_role`）；Body 518-553：空态 520-523（`spaceship_no_accounts`）/账号条目 525-551（头像、昵称回退 `spaceship_unknown_char`、`resolveServerLabel`·`Lv.`、当前标记 `spaceship_current`）；Footer 554-558（`spaceship_cancel`） |

**数据来源**
- 取数：`queryData(roleId, "char_detail", ["spaceShip"])` 与 `getFullCharDetail(roleId)`，底层均为 `invoke("query_role_data")`；均以 `reloadKey = effectiveRoleId` 触发刷新。
- 服务：`CardConfigService.getCardSettings`（210）、`saveCardSettings`（260）；`getAccounts()`（223、233）；`useImageRequest`（206）→ `invoke("get_image_cache_dir"/"download_image"/"read_image_file")`。
- settings 字段：`SpaceshipCardSettings.roleId`（`src/types/card-settings.ts:59-61`）。
- i18n key：`spaceship_title`、`spaceship_rooms_count`、`spaceship_stationed_count`、`spaceship_no_stationed`、`spaceship_mood`、`spaceship_trust`、`spaceship_trust_friendly/close/trust`、`spaceship_room_control/manufacturing/growth/reception/unknown`、`spaceship_unknown_char`、`spaceship_switch_account`、`spaceship_select_role`、`spaceship_no_accounts`、`spaceship_current`、`spaceship_close`、`spaceship_cancel`、`spaceship_empty`。
- 事件：`window` `cardAction`（252）。

**备注（本文件出现的全部 invoke 命令）**：文件内无直接 `invoke`；间接 `query_role_data`、`get_card_settings`、`save_card_settings`、`get_accounts`、`get_image_cache_dir`、`download_image`、`read_image_file`。无 `listen()`。

---

## `src/components/cards/spaceship/spaceship.meta.json`

| 字段 | 行号 | 值 | 说明 |
| --- | --- | --- | --- |
| `id` | 2 | `"spaceship"` | 卡片类型标识（= settings 键名） |
| `name` | 3-6 | `{zh:"帝江号", en:"Spaceship"}` | 多语言名称 |
| `description` | 7-10 | `{zh:"展示帝江号各舱室等级与派驻干员（心情、信赖）", en:"…"}` | 多语言描述 |
| `icon` | 11 | `"satellite"` | 图标键（也用于总控舱 `ROOM_META[0].icon`） |
| `defaultSize` | 12 | `{w:4,h:3}` | 默认 4×3 |
| `version` | 13 | `"1.0.0"` | 版本 |
| `allowMultiple` | 14 | `true` | 允许多实例 |
| `tags` | 15-19 | `account`（账户）、`base`（基建）、`display`（显示） | 搜索/筛选标签 |

## `src/components/cards/spaceship/locales/zh.json`

共 24 行、23 个键，合并进 `card` 命名空间：

| 键 | 值 | 使用处 |
| --- | --- | --- |
| `spaceship_title` | 帝江号 | index:315 |
| `spaceship_rooms_count` | {{n}} 个舱室 | index:321 |
| `spaceship_stationed_count` | {{n}} 人派驻 | index:388 |
| `spaceship_no_stationed` | 暂无派驻 | index:393、422 |
| `spaceship_mood` | 心情 | index:369（title）、461 |
| `spaceship_trust` | 信赖 | index:483 |
| `spaceship_trust_friendly` / `_close` / `_trust` | 友好 / 亲近 / 信任 | index:453（`spaceship_trust_${trustLevel}` 动态拼接） |
| `spaceship_room_control` / `_manufacturing` / `_growth` / `_reception` | 总控中枢 / 制造舱 / 培养舱 / 会客室 | index:273（`spaceship_room_${meta.key}` 动态拼接） |
| `spaceship_room_unknown` | 未知舱室 | index:273 |
| `spaceship_unknown_char` | 未知干员 | index:369、450、538 |
| `spaceship_switch_account` | 切换账号 | index:328 |
| `spaceship_select_role` | 选择账号 | index:516 |
| `spaceship_no_accounts` | 无可用账户 | index:522 |
| `spaceship_current` | 当前 | index:546 |
| `spaceship_close` / `spaceship_cancel` | 关闭 / 取消 | index:505 / 556 |
| `spaceship_empty` | 暂无舱室数据 | index:297 |

---

## 全部 invoke / listen 汇总

| 类别 | 命令 / 事件 | 出现位置 |
| --- | --- | --- |
| `invoke("do_attendance", { roleId })` | 直接调用 | `attendance/index.tsx:22`、`attendance/index.tsx:209` |
| `invoke("get_attendance", { roleId })` | 直接调用 | `attendance/index.tsx:155` |
| `invoke("get_card_settings" / "save_card_settings" / "remove_card_settings")` | 经 `CardConfigService` | 三张卡片均使用（attendance:132、268；domain-info:114、145；spaceship:210、260） |
| `invoke("get_config" / "set_config")` | 经 `configService` ← `CardStartupService` | 仅 attendance（自动签到名单、用户映射） |
| `invoke("get_accounts")` | 经 `accountService.getAccounts` | 三张卡片（attendance:173；settings-modal:44；domain-info:128、155；spaceship:223、233） |
| `invoke("query_role_data")` | 经 `roleDataService` | domain-info:97；spaceship:147、155 |
| `invoke("get_image_cache_dir" / "download_image" / "read_image_file")` | 经 `imageCacheManager` ← `useImageRequest` | spaceship:206 |
| `listen(...)` | — | **三张卡片均无** |
| `window` `CustomEvent("cardAction")` | 事件监听 | attendance:259（`settings`）；domain-info:183（`change-role`/`switch-domain`/`view-list`）；spaceship:252（`change-role`） |

## 发现的异常

1. `attendance/index.tsx:82-84` — 解构出的 `roleId` 被改名为 `_roleId` 且完全未使用；`isEditMode` 同样未使用（`spaceship` 只在 347 行用到编辑模式屏蔽点击，`domain-info` 则根本未声明该 prop）。
2. `attendance/index.tsx:98` — `_signError` 状态被写入（153、159、167、215）但从未渲染，错误只通过 `addMessage` toast 呈现，属死状态。
3. `attendance/locales/zh.json` 中 `attendance_signed`、`attendance_not_signed`、`attendance_sign_btn`、`attendance_sign_success`、`attendance_sign_failed`、`attendance_current_account`、`attendance_loading`、`attendance_network_error`、`attendance_already_signed`、`attendance_no_tomorrow` 共 10 个键在卡片目录内无任何引用；签到成功/失败提示在 `index.tsx:210/214` 里硬编码了中英文，未走 i18n。
4. `attendance-settings-modal.tsx:49` — effect 内读取 `localSelectedRoleId` 属闭包旧值（effect 依赖仅 `[isOpen]`），「无选中则默认第一个账号」仅在弹窗首次以 undefined 打开时可靠。
5. 所有卡片 locale 被 `registry/loader.ts:42` `Object.assign` 合并进同一 `card` 命名空间，存在跨卡片同名键覆盖风险（如 attendance 与 character-list 都定义了 `confirm_delete_title`）。
6. `attendance/index.tsx` 与 `src/pages/attendance.tsx` 各自独立调用 `get_attendance`/`do_attendance` 并复用 `parseAttendanceData`，签到逻辑存在两处重复实现。
7. 三张卡片均无 Tauri `listen`，卡片间/与容器的联动完全依赖 `window` `CustomEvent`，事件名（`settings`、`change-role`、`switch-domain`、`view-list`）为字符串约定，无类型约束。

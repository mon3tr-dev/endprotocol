# 账户页面 src/pages/account.tsx — 功能参考

> 逐行精读源码生成。行号基于当前工作区版本，仅用于快速定位。文件总计 **4005 行**。

**文件职责**：账户管理页面，负责森空岛主账号与其游戏子角色的展示/绑定/解绑、游戏账户选中与切换，以及通过密码 / 短信验证码 / 扫码三种方式添加登录账户，并处理登出、资料查看、失败重试。账户数据获取频繁失败时展示「账号不可用」并提供**重新登录**（只选方式、不强制输手机号；扫码授权后校验是否为目标账户，不一致则拦截）。

**导出**：`export default function AccountPage()`（account.tsx:470，页面根组件，路由级唯一导出）。

**主要依赖**：
- 项目内：`@/components/ui/glass`（GlassAlert/Button/Card/Checkbox/InputOTP/Label/Link/Skeleton/Spinner）、`@/components/custom-modal`（CustomModal 系列）、`@/components/simple-pagination`（SimplePagination）、`@/components/cards/card-container`（CONTAINER_HEIGHT）、`@/components/ui/status-dot`（StatusDot）、`@/components/ui/status-badge`（StatusBadge / SYNC_STATUS_META）、`@/components/ui/app-icon`（ChevronDownIcon / InfoIcon / LinkIcon / UnlinkIcon）、`@/utils/imageLoader`（Img）、`@/utils/accountService`（全部账户 API 封装与类型，含 `getSklandUserInfoByCred` / `applyApiHealthSnapshot`）、`@/utils/accountAvailability`（`getAccountAvailability` / `loadAccountAvailability` / `clearAccountUnavailable` / `subscribeAccountAvailability` 与类型 `AccountAvailability`）、`@/utils/crashReporting`（类型 `ApiHealthSnapshot`）、`@/utils/roleDetailService`、`@/utils/configService`（getConfig）、`@/utils/logger`（logger / logDebug / logError）、`@/utils/messageStore`（addMessage）、`@/types`（resolveServerLabel）
- 第三方：`react`（useState/useEffect/useRef）、`react-i18next`（useTranslation）、`qrcode`（QRCode.toDataURL）、`@tauri-apps/api/event`（listen / UnlistenFn）、`@tauri-apps/api/core`（`invoke("get_api_health")` / `invoke("reset_api_health")`）

## 内部结构总览

| 区间 | 内容 |
| --- | --- |
| 1-66 行 | import：UI 组件、图标、accountService 的 17 个 API 函数与 6 个类型、roleDetailService、logger、configService、messageStore、resolveServerLabel |
| 79-105 行 | `RoleGroup`：角色分组容器（标题 + 计数 + 空态占位） |
| 107-191 行 | `GameRoleRow`：单条游戏角色行（头像/昵称/等级/服务器 + 设为当前 + 绑定/解绑按钮） |
| 193-424 行 | `SklandProfileDetails`：森空岛用户资料弹窗内容（基本资料、头像挂件、简介、游戏等级、社区数据） |
| 426-479 行 | `QRCodeImage`：用 qrcode 库把 URL 异步渲染成 dataURL 图片，含 loading / 错误态 |
| 481-580 行 | `AccountPage` 状态声明：账户列表、森空岛账号/资料/游戏列表、展开态、当前选中账户、动画、各类 Modal 开关、登录表单、扫码、新设备验证、登出确认、账户不可用状态与重新登录目标 |
| 581-623 行 | 三个 useEffect：卸载时清理扫码轮询与 mounted 标记；同步账户可用状态（订阅 + `loadAccountAvailability` + `get_api_health` 兜底）；进入扫码页且无码时自动生成二维码 |
| 625-636 行 | 角色选择状态（availableRoles/selectedRoles/loginCred/loginToken/loginUserId）与全局 Alert 状态 |
| 638-707 行 | 挂载时并行拉取账户/森空岛账号/选中账户，并监听 Tauri 事件 `accounts-refreshed` |
| 709-766 行 | 账户加载完成后延迟重算 `itemsPerPage`（供已禁用的分页区块使用） |
| 768-832 行 | 监听 window 事件 `accountChanged`：按配置决定是否强刷，并通知后端当前角色 ID |
| 834-856 行 | `getExpectedAccountCount`：从配置 `account_list` 推算骨架屏数量（上限 5，默认 3） |
| 865-901 行 | `refreshData`：手动刷新账户 + 强制刷新森空岛资料/游戏图标，并派发 `manualRefresh` 让侧边栏显示骨架屏 |
| 903-914 行 | `retrySyncAccount`：同步失败账户的重试入口（复用 refreshData） |
| 916-985 行 | 登出：`handleLogout` 记录目标 + `handleConfirmLogout` 执行并给出全局/消息中心提示 |
| 987-1080 行 | `handleViewDetails`、`handleOpenAddModal`、`handleOpenRelogin`、`handleCloseAddModal`（后两者完整重置/预填登录态并设置重新登录目标） |
| 1082-1162 行 | 验证码：`handleSendCodeAndShowOtp`（校验手机号 → 发码 → 60s 倒计时 → 进入 OTP）、`handleVerifyWithCode`、`handleVerifyWithScan` |
| 1164-1270 行 | `handleLogin`：密码登录 / 验证码登录的统一入口，含手机号正则校验与 OTP 拦截；重新登录时把 `reloginTarget.userId` 作为 `expectedUserId` 传给后端 |
| 1272-1429 行 | `processLoginResult`：登录结果状态机（重新登录直接写回凭证 / 成功直接入库 / 需确认森空岛绑定 / 需选角色 / 新设备验证 / `ACCOUNT_MISMATCH` 账户不匹配拦截 / 失败） |
| 1431-1504 行 | 扫码登录：`stopQrPolling`、`handleStartQrLogin`、`startQrPolling`（1s 轮询）、`handleScanSuccess`（带 `expectedUserId`，授权到别的账户会被拦截） |
| 1506-1706 行 | 角色与确认：`handleConfirmRoles`、`loadReloginProfile`（用 cred/token 拉确认页头像）、`finishRelogin`、`handleConfirmSklandAccount`、`saveRoles`、`handleManageSklandRoles` |
| 1708-1764 行 | 森空岛资料按需加载：`ensureSklandUserInfo`、`ensureSklandGames`、`handleOpenSklandProfile` |
| 1766-1854 行 | `handleExpandSklandAccount`（展开时拉角色集）、`handleToggleGameRole`（单角色绑定/解绑） |
| 1856-1916 行 | `handleRoleToggle`、`handleSelectAccount`（切换当前账户、按配置刷新、派发 accountChanged、300ms 动画） |
| 1918-1946 行 | `getSortedAccounts`：ACTIVE > HYTOKEN_EXPIRED > 其余，各类内按 nickname 字典序 |
| 1948-1953 行 | 分页状态与常量：`currentPage`、`itemsPerPage`、`CARD_HEIGHT = 80`、`GAP_SIZE = 5`、`containerRef` |
| 1955-2055 行 | ResizeObserver + window resize 动态计算每页可显示卡片数（顶部预留 250px、分页 60px） |
| 2057-2087 行 | `getCurrentPageAccounts` 切片、`totalPages` 计算、列表变化时重置到第 1 页 |
| 2090-2119 行 | `renderSkeleton`：按 `itemsPerPage`（或刷新期预期数）渲染卡片骨架屏 |
| 2124-2180 行 | 页面骨架：全局浮动 Alert、Header（标题/副标题/刷新/添加按钮）、最近刷新时间 |
| 2182-2450 行 | 森空岛账号列表区：账户不可用提示条（含「重新登录」按钮）+ 可折叠面板 + 展开后的「已绑定/未绑定」角色分组与绑定操作；无已缓存账户时展示整体不可用提示 |
| 2169-2527 行 | **已被 `{false && (...)}` 整体禁用**的账号卡片列表 + 分页（含状态徽章、查看详情、登出按钮） |
| 2529-2679 行 | 账户详情弹窗（EXPIRED / SYNC FAILED / 正常三种分支） |
| 2681-2738 行 | 登出确认弹窗（含「保留设备认证」复选与删除设备警告） |
| 2740-2777 行 | 森空岛资料弹窗（标题取资料昵称，内容为 `SklandProfileDetails`） |
| 2779-3606 行 | 添加账户弹窗（大状态机）：2792-2803 头部与高度/遮罩策略；2804-2822 森空岛绑定确认；2823-2905 角色多选；2906-2989 三种登录方式选择；2990-3157 密码表单（含新设备验证分支）；3158-3383 短信两步（手机号 → 6 位 OTP）；3384-3489 扫码界面；3491-3605 Footer 按钮随状态切换 |
| 3607-3609 行 | 收尾闭合 |

## 组件与函数清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `RoleGroup` | account.tsx:79 | 无状态分组组件：标题 + 数量角标，`count === 0` 时渲染虚线空态 |
| `GameRoleRow` | account.tsx:107 | 角色行：头像/首字母占位、`Lv.x · 服务器`，已绑定时显示「当前 / 设为当前」，右侧绑定或解绑按钮（`isBusy`/`isDisabled` 互斥） |
| `SklandProfileDetails` | account.tsx:193 | 资料详情：loading / 失败重试 / 正常三态；过滤 `level > 0` 的游戏，用 gameId→iconMap 补图标，拼 6 项社区统计数据 |
| `QRCodeImage` | account.tsx:426 | effect 内 `QRCode.toDataURL` 生成二维码，`cancelled` 标志防竞态，失败显示 "QR Error" |
| `AccountPage` | account.tsx:481 | 默认导出的页面根组件，集中持有全部状态、副作用与四个 Modal |
| `LoginMethod`（type） | account.tsx:527 | `"phone" \| "sms" \| "qrcode" \| null` 登录方式字面量联合类型 |
| 挂载加载 effect | account.tsx:638 | `Promise.all(getAccounts/getSklandAccounts/getSelectedAccount)`，补拉缺失昵称头像，订阅 `accounts-refreshed` |
| 每页数量重算 effect | account.tsx:709 | 账户加载后 200ms 延迟重算 `itemsPerPage` |
| `accountChanged` 监听 effect | account.tsx:768 | 侧边栏切换账户时按 `refresh_on_account_switch` 决定强刷或读缓存，并 `roleDetailService.setCurrentRoleId` |
| 卸载清理 effect | account.tsx:581 | 置 `isMountedRef=false` 并清空扫码轮询定时器 |
| 自动出码 effect | account.tsx:606 | 满足条件（弹窗开、qrcode 方式、无码、未在生成/登录、未失败）时调用 `handleStartQrLogin` |
| `getExpectedAccountCount` | account.tsx:834 | 读 `account_list` 配置推算骨架屏条数（≤5），失败兜底 3 |
| `refreshData` | account.tsx:865 | 手动刷新：`refresh_accounts` + 重拉森空岛账号/资料/游戏图标，期间派发 `manualRefresh` |
| `retrySyncAccount` | account.tsx:903 | 同步失败重试，刷新后保持当前选中账户 |
| `handleLogout` | account.tsx:916 | 记录登出目标，默认勾选「保留设备认证」 |
| `handleConfirmLogout` | account.tsx:922 | 调 `logout_account`，成功则移出列表并自动顺位选中，成功/失败均写全局 Alert + `addMessage`，3 秒后清除 |
| `handleViewDetails` | account.tsx:987 | 打开账户详情弹窗（仅被禁用区块调用，实际不可达） |
| `handleOpenAddModal` | account.tsx:993 | 打开添加账户弹窗，重置全部登录/扫码/OTP 状态（不清角色选择态），并清空重新登录目标/不匹配提示/确认页资料 |
| `handleOpenRelogin` | account.tsx:1056 | 打开「重新登录」流程：设置 `reloginTarget`、用该账户记录的 `phone` 预填手机号、重置其它登录状态；不要求用户先输入手机号 |
| 账户可用性 effect | account.tsx:594 | 订阅 `accountAvailability` 变化、`loadAccountAvailability()`，并用 `invoke("get_api_health")` 在挂载时兜底同步后端熔断状态（`applyApiHealthSnapshot`） |
| `loadReloginProfile` | account.tsx:1538 | 用刚登录得到的 cred/token 调 `getSklandUserInfoByCred`，为「确认绑定森空岛账户」页加载头像/昵称；失败不影响确认 |
| `finishRelogin` | account.tsx:1557 | 重新登录完成：`saveSklandAccount` 写回凭证（保留 `roles`），`clearAccountUnavailable` + `reset_api_health`，关闭弹窗并 `refreshData` |
| `handleCloseAddModal` | account.tsx:1019 | 关闭并清空登录、扫码、OTP、角色选择（cred/token/userId）等全部状态 |
| `handleSendCodeAndShowOtp` | account.tsx:1082 | 手机号正则 `^1[3-9]\d{9}$` 校验 → `send_verification_code`(type=2) → 60s 倒计时 → 进入 OTP 步骤 |
| `handleVerifyWithCode` | account.tsx:1148 | 新设备验证改走验证码：切到 `sms` 并立即发码 |
| `handleVerifyWithScan` | account.tsx:1158 | 新设备验证改走扫码：切到 `qrcode` |
| `handleLogin` | account.tsx:1164 | 统一登录入口：密码走 `add_account`，验证码走 `add_account_by_code`；未进 OTP 步骤时先发码 |
| `processLoginResult` | account.tsx:1272 | 登录结果四路分派：直接成功→刷新并选中新账户；需绑定森空岛→确认页；多角色→角色选择（单角色直接 `saveRoles`）；失败→新设备验证 / OTP 无效 / 通用错误 |
| `stopQrPolling` | account.tsx:1431 | 清定时器并关闭轮询标记 |
| `handleStartQrLogin` | account.tsx:1440 | `gen_scan_login` 取 scanId/scanUrl，失败置 `qrGenFailed` 并给 i18n 错误，成功即开轮询 |
| `startQrPolling` | account.tsx:1465 | 1 秒间隔 `scan_status`：status 0 且有 scanCode → 停轮询换码；非 100 → 已扫待确认；100 → 等待扫码 |
| `handleScanSuccess` | account.tsx:1488 | 用 scanCode 调 `add_account_by_scan` 换账户，再交给 `processLoginResult` |
| `handleConfirmRoles` | account.tsx:1506 | 校验至少选一个角色（管理态豁免），取完整角色对象后 `saveRoles` |
| `handleConfirmSklandAccount` | account.tsx:1591 | `save_skland_account` 保存主账号 → 重拉账号列表 → `get_skland_account_roles` 取角色集并预选已绑定项 → 进入角色选择 |
| `saveRoles` | account.tsx:1620 | `save_selected_roles` → 刷新账户/森空岛列表 → 按管理态或 userId 选中优先账户（失败则清空选中）→ 派发 `accountChanged` → 关弹窗 + 成功 Alert |
| `handleManageSklandRoles` | account.tsx:1678 | 从外部进入的「管理游戏角色」入口，拉角色集后打开弹窗（当前无调用点） |
| `ensureSklandUserInfo` | account.tsx:1708 | 带 `Set` 去重与缓存判断拉取 `get_skland_user_info`，错误按 userId 单独记录，失败不阻塞列表 |
| `ensureSklandGames` | account.tsx:1743 | 拉取 `get_skland_games`（后端 12 小时缓存），失败降级文字占位 |
| `handleOpenSklandProfile` | account.tsx:1760 | 记录 `profileSklandId` 并按需补资料与游戏列表 |
| `handleExpandSklandAccount` | account.tsx:1766 | 折叠/展开切换；首次展开时 `get_skland_account_roles` 拉角色集并缓存到 `sklandRoleSets`，错误写 `roleLoadErrors` |
| `handleToggleGameRole` | account.tsx:1801 | 以 `userId:serverId:roleId` 为忙碌键，在已有绑定集合上增删该角色后 `save_selected_roles`；若当前选中账户被解绑则顺位改选并派发事件 |
| `handleRoleToggle` | account.tsx:1856 | 角色多选的增删切换 |
| `handleSelectAccount` | account.tsx:1865 | 切换当前账户：记录上一账户、`set_selected_account`、按 `refresh_on_account_switch` 决定强刷、派发 `accountChanged`、300ms 后复位动画 |
| `getSortedAccounts` | account.tsx:1918 | 排序：当前选中 > `HYTOKEN_EXPIRED` > 其他，组内 `localeCompare(nickname)` |
| `sortedAccounts` | account.tsx:1944 | 排序结果缓存（仅禁用区块消费） |
| `CARD_HEIGHT` / `GAP_SIZE` | account.tsx:1951 / 1952 | 分页布局常量 80px / 5px |
| `containerRef` | account.tsx:1953 | 分页容器引用（ref 仅挂在禁用区块内，导致相关 effect 常年不命中） |
| 每页数量计算 effect | account.tsx:1956 | 窗口 resize + ResizeObserver(父容器) 驱动 `calculateItemsPerPage` |
| `getCurrentPageAccounts` | account.tsx:2058 | 按 `(currentPage-1)*itemsPerPage` 切片（仅禁用区块消费） |
| `totalPages` / `currentPageAccounts` | account.tsx:2081 / 2082 | 分页总数与当页数据 |
| 页码重置 effect | account.tsx:2085 | 列表长度或每页数量变化时回到第 1 页 |
| `renderSkeleton` | account.tsx:2090 | 骨架屏渲染（仅禁用区块调用） |
| 主 JSX | account.tsx:2124 | 返回页面全部结构 |

## 关键业务逻辑

### 数据加载与刷新（account.tsx:595-664、815-851、725-789）
挂载时并行取账户、森空岛账号、当前选中 ID；缺失昵称/头像的森空岛账号异步补资料。手动刷新走 `refresh_accounts` 并强制重拉资料与游戏图标，同时向侧边栏广播 `manualRefresh`。侧边栏切换账户通过 window `accountChanged` 通知本页，按配置 `refresh_on_account_switch` 决定强刷还是读缓存，并用 `set_current_role_id` 通知后端当前角色（懒加载取数用）。后端自动刷新则通过 Tauri 事件 `accounts-refreshed` 推送，直接覆盖列表与刷新时间。

### 登录方式选择（account.tsx:3244-3330）
`loginMethod === null` 时渲染三张卡片：密码（phone）、验证码（sms）、扫码（qrcode），点击仅设置状态；Footer 在该态下不渲染主按钮。重新登录时该页额外显示 `relogin_desc` 警告条与是否已记录手机号的提示，**不要求用户先输入手机号**。

### 密码登录与新设备验证（account.tsx:3332-3499、1164-1270、1148-1162）
手机号 + 密码表单，回车或「登录」触发 `handleLogin` → `add_account`。返回 `NEW_DEVICE_VERIFICATION_REQUIRED` 时进入新设备验证分支：显示警告条 + 手机号输入 + 「验证码登录」「扫码登录」两个按钮，分别转到对应流程；Footer 的返回键此时退回密码输入而非方式选择。

### 验证码登录（account.tsx:1082-1146、1194-1228、3500-3725）
两步式：第一步校验手机号并发码（type=2），成功后 60 秒倒计时并切到 OTP；第二步 `GlassInputOTP` 6 位分两组 3 格，`onComplete` 自动提交 `handle_login` 走 `add_account_by_code`，失败置 `isOtpInvalid` 并显示行内错误。「重新发送」受倒计时限制（内部用原生 `alert` 提示），另有「修改手机号」回退。

### 扫码登录（account.tsx:606-623、1431-1504、3726-3831）
进入 qrcode 方式时自动 `gen_scan_login` 出码并以 1 秒间隔轮询 `scan_status`；`status=100` 等待扫码、其它非 0 表示已扫待确认（二维码上盖遮罩显示「已扫码」）、`status=0` 停轮询并用 scanCode 走 `add_account_by_scan`。支持手动刷新二维码、生成失败重试，弹窗关闭或卸载时统一 `stopQrPolling`。

### 登录结果与角色/森空岛绑定（account.tsx:1272-1706、2878-2991、3833-3878）
`processLoginResult` 分四路：①直接拿到账户→刷新列表、`set_selected_account` 选中新账户、派发 `accountChanged`、5 秒成功提示；②拿到 cred/token/userId→进入「确认绑定森空岛」页（展示 userId，确认后 `save_skland_account` + `get_skland_account_roles`）；③多角色→角色多选卡片（勾选态绿色描边，Footer 显示 `确认 (n)`，未选禁用），单角色直接静默 `saveRoles`；④失败→新设备验证 / OTP 无效 / 通用错误。`saveRoles` 落库 `save_selected_roles` 后刷新并按规则选中优先账户。角色选择期间禁用遮罩点击、角色数 >3 时固定弹窗高度。

### 森空岛账号列表与角色绑定管理（account.tsx:2182-2450、1766-1854）
每个森空岛账号是一张可折叠卡片（账户不可用时顶部追加红色提示条与「重新登录」按钮）：头部显示头像/昵称/userId/已绑定角色数，右侧「资料」按钮（打开资料弹窗）与展开箭头。展开区用 `grid-template-rows 0fr/1fr` 过渡，内部分两栏 `RoleGroup`：已绑定（可「设为当前」或解绑）与未绑定（可绑定）。绑定/解绑统一由 `handleToggleGameRole` 以当前绑定集合增删单个角色后保存，期间以 `userId:serverId:roleId` 为键锁住对应行。

### 森空岛资料弹窗（account.tsx:193-424、1708-1764、2826-2863）
按 userId 惰性拉取 `get_skland_user_info`（带请求去重与错误缓存，可 force 重试）和 `get_skland_games`（后端 12h 缓存）。展示头像 + 挂件（挂件存在时容器放大到 104px 以套住 64px 头像）、昵称/UID/IP 归属地/创作者标识、简介、游戏等级网格（等级 0 不显示，优先用等级图标）、6 宫格社区数据。

### 账户不可用与重新登录（account.tsx:594-622、1056-1080、1272-1429、1538-1590、2182-2450）
账户数据获取频繁失败时应用照常进入：`accountAvailability` 记录 `{reason, message, since}`（`auth` / `network` / `fingerprint` / `unknown`），账户页在每个森空岛账户卡片顶部显示红色提示条与「重新登录」按钮；若连已缓存账户都没有，则在列表区显示整体不可用提示与「重试」。

点「重新登录」后进入与「添加账户」共用的弹窗，但**方式选择页不出现手机号**（只需选择方式）：
- 短信/密码：手机号用首次登录时记录的 `SklandAccount.phone` 自动填充，可修改；
- 扫码：授权成功后由后端用 `expectedUserId` 校验是否为同一森空岛账户，不一致返回 `ACCOUNT_MISMATCH:<实际userId>`，前端清空本次登录结果、回到方式选择并提示，**不保存任何凭证**。

校验通过后 `processLoginResult` 走 `finishRelogin`：`save_skland_account` 只更新 cred/token（保留 `roles` 绑定），随后清除不可用状态、`reset_api_health` 解除熔断并刷新。

### 账户列表渲染与分页（account.tsx:1918-2088、2452-2810）
排序规则为选中置顶、凭证过期次之、其余按昵称字典序；按窗口高度（扣 250px 顶部 + 60px 分页）与 80px 卡片高度动态算每页条数并配 ResizeObserver。卡片展示头像、等级、官服/BiliBili 服、状态 LED 与状态徽章（`HYTOKEN_EXPIRED` / `FAILED` 优先于 ACTIVE/AVAILABLE），并提供「查看详情」「登出」。**注意：该整块被 `{false && (...)}` 永久禁用，当前 UI 实际不渲染账号卡片与分页**（见备注·异常）。

### 账户详情与同步失败重试（account.tsx:2615-2765、903-914）
详情弹窗三分支：`HYTOKEN_EXPIRED` 显示红色 EXPIRED 及 token/cred 原文与重登提示；`FAILED` 显示黄色 SYNC FAILED 与「重试同步」按钮（调 `refreshData`）；正常态显示头像、昵称、ID、等级、服务器。由于详情弹窗只能从禁用区块打开，实际不可达。

### 登出（account.tsx:2767-2824、916-985）
确认弹窗询问是否保留设备认证（`GlassCheckbox` 默认勾选），取消保留时额外显示删除设备的警告；确认后 `logout_account(accountId, keepDeviceToken)`，成功移出列表并自动顺位选中，全局 Alert 与消息中心同步提示。

### 懒加载相关（account.tsx:810-813）
仅在 `accountChanged` 处理中调用 `roleDetailService.setCurrentRoleId(selectedId)`，用于告知后端当前激活角色；本文件**未**调用 `set_lazy_load_enabled` / `is_lazy_load_enabled`（懒加载开关在其他页面/设置中）。

**备注**：

- **调用的全部 invoke 命令名**（页面直接 `invoke("get_api_health")` / `invoke("reset_api_health")`，其余经 utils 封装间接调用）：
  - accountService：`get_accounts`、`get_skland_accounts`、`save_skland_account`、`get_skland_account_roles`、`get_skland_user_info`、`get_skland_user_info_by_cred`、`get_skland_games`、`get_selected_account`、`set_selected_account`、`refresh_accounts`、`logout_account`、`add_account`、`send_verification_code`、`add_account_by_code`、`add_account_by_scan`、`gen_scan_login`、`scan_status`、`save_selected_roles`
  - configService：`get_config`
  - roleDetailService：`set_current_role_id`
  - （accountService 还导出 `batch_logout`、`check_and_refresh_cred`，但本文件未使用，故页面**没有批量登出**功能）
- **涉及的配置键**：`refresh_on_account_switch`（切换账户时是否强制刷新）、`account_list`（推算骨架屏条数）。账户不可用状态存于 `sessionStorage` 键 `account_unavailable_state`（见 `src/utils/accountAvailability.ts`），手机号由后端 `account_token_{userId}.phone` 提供。
- **i18n key 前缀**：`settings.account.*`（主前缀，含 title/subtitle/refresh_data/add_account/skland_*/login/qr_*/logout/close/cancel/confirm/back，以及新增的 `account_unavailable_*` / `relogin*` / `retry_later`）、`common.pagination.*`（分页上一页/下一页，仅禁用区块使用）。另有大量 `i18n.language === "zh" ? 中文 : English` 的硬编码双语文案（未走 `t()`），如提示、错误、服务器名「官服/BiliBili服」、OTP 区文案、`alert()` 提示等。
- **事件**：Tauri 监听 `accounts-refreshed`；window 监听 `accountChanged`；window 派发 `accountChanged`（4 处）与 `manualRefresh`（带 `{count}` detail）；模块级订阅 `accountAvailability` 状态变化。
- **异常/注意点**：
  1. account.tsx:2170 起约 360 行的账号卡片列表被 `{false && (...)}` 永久关闭，导致 `renderSkeleton`、`getCurrentPageAccounts`、`totalPages`、`currentPage/itemsPerPage`、`containerRef` 及 ResizeObserver 逻辑、`StatusDot`/`StatusBadge`/`SYNC_STATUS_META`/`SimplePagination`/`CONTAINER_HEIGHT`、`handleViewDetails`、`handleLogout`、`retrySyncAccount` 与账户详情弹窗（2529-2679）实际不可达/不执行（`containerRef` 的 ref 只挂在该禁用区块内，相关 effect 因此永不命中）。
  2. `handleManageSklandRoles`（account.tsx:1458-1485）定义后全文件无调用点，属死代码。
  3. 验证码倒计时的 `setInterval`（account.tsx:1026、3344）未在组件卸载或弹窗关闭时清理，存在定时器泄漏风险。
  4. `processLoginResult` 第二分支用渲染期闭包中的 `accounts` 预选已绑定角色，可能存在旧状态（stale closure）。
  5. `GameRoleRow` 的忙碌键含 `serverId`，而 `handleToggleGameRole` 的增删集合只按 `roleId` 判断，同 roleId 跨服时可能误判绑定态。
  6. 重发验证码与部分提示使用浏览器原生 `alert()`（约 account.tsx:3587/3602/3619/3624），与全局 Glass 风格不一致。
7. 角色多选卡片原先把滚动容器写成 `pr-2` 且卡片沿用 `GlassCard` 的 `hover:scale-[1.02] hover:shadow-lg`，鼠标悬停时描边/阴影被 `overflow-y-auto` 裁掉；现改为容器 `px-2 py-2` + 卡片 `hover:scale-100 hover:translate-y-0 hover:shadow-none`，选中态用 `border-success` + 内阴影（`boxShadow: inset 0 0 0 2px`，因 `GlassCard` 自带 `overflow-hidden`，外描边 ring 同样会被裁掉）。

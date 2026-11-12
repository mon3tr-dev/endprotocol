# 前端服务与工具（A 组：账户/配置/角色/启动器）— 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 本文件覆盖 16 个服务封装：account / config / proxy / cardConfig / dashboardConfig / theme / backgroundSettings / roleData / roleDetail / tab / tabSnapshot / tabIcons / messageStore / launcher / systemResource / tray。

## `src/utils/accountService.ts`
**职责**：封装森空岛/游戏账户相关的全部 Tauri IPC 调用（登录、登出、刷新、扫码、验证码、选中账户、凭证刷新），并定义账户相关的 TS 类型。是前端访问账户后端的唯一入口层。
**导出**：类型 `GameId`、`Account`、`SklandAccount`、`SklandGameScore`、`SklandPendant`、`SklandBackground`、`SklandUserStats`、`SklandGameInfo`、`SklandUserInfo`、`RoleDisplayInfo`、`LoginRequest`、`LoginResult`、`RefreshResult`、`SendCodeRequest`、`CodeLoginRequest`、`ScanLoginInfo`、`ScanStatus`；函数 `getAccounts`、`getSklandAccounts`、`saveSklandAccount`、`getSklandAccountRoles`、`getSklandUserInfo`、`getSklandUserInfoByCred`、`getSklandGames`、`addAccount`、`logoutAccount`、`batchLogout`、`refreshAccounts`、`sendVerificationCode`、`addAccountByCode`、`genScanLogin`、`scanStatus`、`addAccountByScan`、`saveSelectedRoles`、`getSelectedAccount`、`setSelectedAccount`、`checkAndRefreshCred`、`applyApiHealthSnapshot`；别名常量 `refreshAccountData`、`batchLogoutAccounts`。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`./logger` 的 `logger` / `logError`、`./startupProgress` 的 `trackStartupTask`、`./accountAvailability`（`clearAccountUnavailable` / `setAccountUnavailable` / `reasonFromApiKind`）、`./crashReporting` 的类型 `ApiHealthSnapshot`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `getAccounts` | accountService.ts:211 | invoke `get_accounts`，无参，返回 `Account[]`；启动 Splash 跟踪期间计入初始任务；成功且非空时 `clearAccountUnavailable()`，失败 `logError` + `setAccountUnavailable("unknown")` 后返回 `[]`（**不阻塞进入应用**） |
| `getSklandAccounts` | accountService.ts:223 | invoke `get_skland_accounts`，无参，返回 `SklandAccount[]`；失败返回 `[]` |
| `saveSklandAccount` | accountService.ts:232 | invoke `save_skland_account`，参数 `{cred, token, userId}`，返回 `boolean`；失败返回 `false` |
| `getSklandAccountRoles` | accountService.ts:245 | invoke `get_skland_account_roles`，参数 `{userId}`，返回 `LoginResult`；失败返回 `{success:false, errorMessage:String(error)}` |
| `getSklandUserInfo` | accountService.ts:259 | invoke `get_skland_user_info`，参数 `{userId}`，返回 `SklandUserInfo`；**无 try/catch，错误向上抛** |
| `getSklandUserInfoByCred` | accountService.ts:460 | invoke `get_skland_user_info_by_cred`，参数 `{cred, token}`，返回 `SklandUserInfo \| null`（不读本地配置，用于「确认绑定森空岛账户」页展示头像/昵称）；失败 `logError` 后返回 `null` |
| `getSklandGames` | accountService.ts:269 | invoke `get_skland_games`，参数 `{userId, force}`（`force` 默认 `false`，后端带缓存），返回 `SklandGameInfo[]`；**无 try/catch，错误向上抛** |
| `addAccount` | accountService.ts:281 | invoke `add_account`，参数 `{loginRequest}`（手机号+密码+可选 `expectedUserId`），返回 `LoginResult`；成功时 `clearAccountUnavailable()`；失败返回 `{success:false, errorMessage, account:undefined}` |
| `logoutAccount` | accountService.ts:302 | invoke `logout_account`，参数 `{accountId, keepDeviceToken}`（默认 `true`，保留设备认证跳过新设备验证），返回 `boolean`；失败返回 `false` |
| `batchLogout` | accountService.ts:319 | invoke `batch_logout`，参数 `{accountIds}`，返回 `boolean`；失败返回 `false` |
| `refreshAccounts` | accountService.ts:332 | invoke `refresh_accounts`，无参，返回 `RefreshResult`；成功且非空时 `clearAccountUnavailable()`，失败 `setAccountUnavailable("unknown")` 并返回 `{success:false, errorMessage, accounts:[], refreshTime:当前ISO时间}` |
| `refreshAccountData` | accountService.ts:350 | `refreshAccounts` 的别名导出（旧命名兼容），非独立实现 |
| `batchLogoutAccounts` | accountService.ts:351 | `batchLogout` 的别名导出（旧命名兼容），非独立实现 |
| `sendVerificationCode` | accountService.ts:358 | invoke `send_verification_code`，参数 `{request}`（`SendCodeRequest`），返回 `boolean`；失败返回 `false` |
| `addAccountByCode` | accountService.ts:372 | invoke `add_account_by_code`，参数 `{loginRequest}`（手机号+验证码+可选 `expectedUserId`），返回 `LoginResult`；成功时 `clearAccountUnavailable()`；失败用 `logger.error(..., "AccountService")` 记录并返回 `{success:false, errorMessage}` |
| `genScanLogin` | accountService.ts:391 | invoke `gen_scan_login`，无参，返回 `ScanLoginInfo \| null`；失败返回 `null` |
| `scanStatus` | accountService.ts:405 | invoke `scan_status`，参数 `{scanId}`，返回 `ScanStatus \| null`；失败返回 `null` |
| `addAccountByScan` | accountService.ts:420 | invoke `add_account_by_scan`，参数 `{scanCode, expectedUserId}`（后者为 `null` 时不校验账户），返回 `LoginResult`；成功时 `clearAccountUnavailable()`；失败记录日志并返回 `{success:false, errorMessage}`。**重新登录时传目标 userId：后端校验登录账户是否一致，不一致返回 `ACCOUNT_MISMATCH:<实际userId>` 且不落盘凭证** |
| `applyApiHealthSnapshot` | accountService.ts:447 | `applyApiHealthSnapshot(snapshot)`：`blocked` 时用 `reasonFromApiKind` 把熔断原因写入账户不可用状态（账户页启动时经 `invoke("get_api_health")` 兜底调用） |
| `saveSelectedRoles` | accountService.ts:480 | invoke `save_selected_roles`，参数 `{cred, token, userId, selectedRoles}`，返回 `Account[]`（创建的账户列表）；失败记录日志后**重新 throw** |
| `getSelectedAccount` | accountService.ts:498 | invoke `get_selected_account`，无参，返回 `string \| null`（当前选中账户 ID）；启动 Splash 跟踪期间计入初始任务；失败记录日志并返回 `null` |
| `setSelectedAccount` | accountService.ts:512 | invoke `set_selected_account`，参数 `{accountId}`，返回 `boolean`；失败返回 `false` |
| `checkAndRefreshCred` | accountService.ts:526 | invoke `check_and_refresh_cred`，参数 `{userId}`，返回 `[cred, token] \| null`（`null` 表示无需刷新）；失败记录日志后**重新 throw** |
| `deleteSklandAccount` | accountService.ts（新增） | invoke `delete_skland_account`，参数 `{userId}`，返回 `boolean`（账号不存在为 `false`）；**彻底删除**父账户 + 全部角色 + 全部凭据，与 `logoutAccount`（只解绑单角色）不同 |
| `authorizeRoleU8Token` | accountService.ts（新增） | invoke `authorize_role_u8token`，参数 `{roleId}`，返回 `RoleU8AuthResult`（`status` ∈ `authorized` / `failed`，另有 `message`）；失败返回 `{status:"failed", message}` |
| `revokeRoleU8Token` | accountService.ts（新增） | invoke `revoke_role_u8token`，参数 `{roleId}`，返回 `boolean`（是否确实取消了授权）；失败返回 `false` |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| accountService.ts:1-211 | 全部接口/类型定义（账户、森空岛资料、登录/扫码/验证码请求与结果；`GameId`、`Account.game?`、`SklandAccount.phone`、`RoleDisplayInfo`（含 `game` / `bindingUid` / `channelName` / `u8Authorized`）、`RoleU8AuthStatus` / `RoleU8AuthResult`、`LoginRequest.expectedUserId`、`CodeLoginRequest.expectedUserId`） |
| accountService.ts:203-536 | 各 IPC 包装函数实现（含新增的 `authorizeRoleU8Token` / `revokeRoleU8Token`） |

**备注**：
- 封装的 invoke 命令：`get_accounts`、`get_skland_accounts`、`save_skland_account`、`get_skland_account_roles`、`get_skland_user_info`、`get_skland_user_info_by_cred`、`get_skland_games`、`add_account`、`logout_account`、`delete_skland_account`、`batch_logout`、`refresh_accounts`、`send_verification_code`、`add_account_by_code`、`gen_scan_login`、`scan_status`、`add_account_by_scan`、`save_selected_roles`、`get_selected_account`、`set_selected_account`、`check_and_refresh_cred`、**`authorize_role_u8token`、`revoke_role_u8token`**（共 23 个）。
- **游戏标识**：`GameId = "endfield" | "arknights"`，对应后端 `models::role::GAME_*` 常量。`Account.game?` 与 `RoleDisplayInfo.game?` 都是可选字段，缺失时按终末地处理（后端三处结构体都带 `#[serde(default = "default_game")]`）。明日方舟角色**没有头像**（`avatarUrl` 为空串），也没有终末地那套角色数据接口。
- **抽卡授权**：`authorizeRoleU8Token` / `revokeRoleU8Token` 是唯一入口，前端从不接触令牌明文 —— u8token 不落盘、每次同步由后端现换。官服与 B 服走同一条链路，没有「渠道服不支持」分支。
- 配置键：本文件**不直接**读写任何配置键；选中账户由后端命令 `get_selected_account`/`set_selected_account` 管理（对应后端配置键在 Rust 侧，前端未出现字面量）。
- 缓存策略：无前端缓存，每次调用直接 IPC；森空岛游戏列表的缓存由后端负责（`getSklandGames` 的 `force` 参数控制强制刷新）。
- 错误处理不统一：`getSklandUserInfo`、`getSklandGames` 不捕获错误；`saveSelectedRoles`、`checkAndRefreshCred` 记录日志后 rethrow；其余函数均吞掉错误并返回空值/false。
- 账户可用性：`getAccounts`/`refreshAccounts`/三个登录入口在成功时清除不可用状态，失败时标记（详见 `src/utils/accountAvailability.ts`）。

## `src/utils/configService.ts`
**职责**：通用键值配置读写层，封装 Tauri `get_config`/`set_config`/`remove_config`/`get_all_configs`/`get_secret_storage_status`，并在 Tauri 调用失败时自动降级到浏览器 `localStorage`（开发环境兜底）。
**导出**：`getConfig`、`setConfig`、`removeConfig`、`getAllConfigs`、`getSecretStorageStatus`；类型 `SecretBackend`、`SecretStorageStatus`。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`@/utils/logger` 的 `logger`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `getConfig<T>` | configService.ts:10 | invoke `get_config`，参数 `{key}`，返回 `T \| null`（`undefined` 归一为 `null`）；启动 Splash 跟踪期间会计入初始任务；失败时 `logger.warn` 并读取 localStorage 的 `config_${key}`（JSON.parse）作兜底 |
| `setConfig` | configService.ts:26 | invoke `set_config`，参数 `{key, value}`，返回 `void`；失败时 `logger.warn` 并写入 localStorage `config_${key}`（JSON.stringify）。⚠️ 后端会**拒写机密键**（凭据只存在于 OS 凭据库） |
| `removeConfig` | configService.ts:41 | invoke `remove_config`，参数 `{key}`，返回 `boolean`；失败时 `logger.warn`、移除 localStorage 同名键并**固定返回 `true`** |
| `getAllConfigs` | configService.ts:55 | invoke `get_all_configs`，无参，返回 `Record<string, any>`；**后端会剔除机密字段**；失败时遍历 localStorage，取所有 `config_` 前缀键、去掉前 7 个字符作为配置键并 JSON.parse 后返回 |
| `getSecretStorageStatus` | configService.ts:89 | invoke `get_secret_storage_status`，无参，返回 `SecretStorageStatus \| null`（失败返回 `null`，不抛异常）。`backend` 为 `'credential-store'` / `'encrypted-file'` / `'plaintext'`；`degraded` 表示未使用 OS 凭据库 |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| configService.ts:9-19 | `getConfig`（主 + localStorage 兜底） |
| configService.ts:26-49 | `setConfig` / `removeConfig` |
| configService.ts:55-74 | `getAllConfigs`（含 localStorage 扫描兜底） |
| configService.ts:79-97 | `SecretBackend` / `SecretStorageStatus` 类型与 `getSecretStorageStatus` |

**备注**：
- 封装的 invoke 命令：`get_config`、`set_config`、`remove_config`、`get_all_configs`、`get_secret_storage_status`（共 5 个）。
- 配置键：键名由调用方传入，本文件不硬编码业务键；localStorage 命名空间为 `config_${key}`，`getAllConfigs` 通过 `key.startsWith('config_')` + `substring(7)` 还原。
- 缓存策略：**无缓存**，每次调用都走 IPC；降级路径与主路径可能不一致（Tauri 失败时读 localStorage，而成功写入只进 Tauri）。
- 机密字段的存储与保护见 [`docs/secure_storage.md`](../../../secure_storage.md)。

## `src/utils/proxyService.ts`
**职责**：网络代理配置的前端封装层——读写 `proxy_config`、从系统读取代理、测试代理连通性、自动嗅探本地代理端口，并把后端返回的裸 JSON 收敛成带类型的 `ProxyConfig`。所有函数都返回显式的 `ProxyResult<T>`（`{ok:true,value}` / `{ok:false,error}`），不抛异常。
**导出**：类型 `ProxyType`、`ProxyConfig`、`SystemProxyInfo`、`ProxyTestResult`、`ProxyResult<T>`；常量 `DEFAULT_PROXY_CONFIG`、`DEFAULT_PROXY_PORT`；函数 `normalizeProxyConfig`、`getProxySettings`、`saveProxySettings`、`clearProxySettings`、`readSystemProxy`、`testProxyConnection`、`autoDetectProxy`。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`@/utils/logger`（`logger.warn`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ProxyType`（type） | proxyService.ts:4 | `"http" \| "socks5"` |
| `ProxyConfig`（interface） | proxyService.ts:7-21 | `enabled`/`type`/`host`/`port`/`username?`/`password?`/`remoteDns?`/`exclude?`；`enabled=false` 时其余字段仅作草稿保留 |
| `SystemProxyInfo`（interface） | proxyService.ts:24-35 | `enabled`/`proxy_type`/`host`/`port`/`username`/`password`/`pac_url`/`from_env` |
| `ProxyTestResult`（interface） | proxyService.ts:38-41 | `status`（HTTP 状态码）、`duration_ms` |
| `DEFAULT_PROXY_CONFIG` | proxyService.ts:43-48 | `{enabled:false, type:"http", host:"", port:8080}` |
| `DEFAULT_PROXY_PORT` | proxyService.ts:50-53 | `{http: 8080, socks5: 1080}`，切换协议时用作默认端口 |
| `ProxyResult<T>`（type） | proxyService.ts:56-58 | 显式成功/失败联合类型 |
| `fail<T>(error)`（私有） | proxyService.ts:60-65 | 统一转 `{ok:false,error}` 并 `logger.warn` |
| `normalizeProxyConfig(input)` | proxyService.ts:68-85 | 任意输入 → 合法 `ProxyConfig`：`type` 非法回落 `http`、`host` 去空格、端口夹取 1-65535（非法时按协议默认端口）、`remoteDns` 仅 SOCKS5 生效、`exclude` 去空格 |
| `getProxySettings()` | proxyService.ts:88-95 | invoke `get_proxy_settings` → `normalizeProxyConfig` |
| `saveProxySettings(config)` | proxyService.ts:98-109 | invoke `save_proxy_settings`（参数 `{ config }`），返回保存后的配置（已归一） |
| `clearProxySettings()` | proxyService.ts:112-119 | invoke `clear_proxy_settings`，返回是否确实删除了配置（当前 UI 未使用，重置走保存默认值） |
| `readSystemProxy()` | proxyService.ts:122-140 | invoke `read_system_proxy`，并补齐 `proxy_type`/`username`/`password`/`pac_url` 的缺省值 |
| `testProxyConnection(config?, url?)` | proxyService.ts:143-156 | invoke `test_proxy_connection`（参数 `{config: config ?? null, url: url ?? null}`）；不传 `config` 时后端用已保存配置 |
| `autoDetectProxy()` | proxyService.ts:159-167 | invoke `auto_detect_proxy`（无参），返回嗅探到的可用配置（协议/主机/端口已填好） |

**备注**：
- 封装的 invoke 命令：`get_proxy_settings`、`save_proxy_settings`、`clear_proxy_settings`、`read_system_proxy`、`test_proxy_connection`、`auto_detect_proxy`（共 6 个，全部为代理专用命令）。
- 配置键：`proxy_config`（由后端 `ConfigService` 持久化；保存后后端会同步刷新全局代理缓存并把 `exclude` 写入 `no_proxy`，所有 HTTP 请求即时生效）。
- `exclude` 字段为逗号分隔的主机名列表，经后端写入 `no_proxy` 环境变量后生效（reqwest 读取该变量）。
- 本文件**不**使用 `configService`——代理配置有自己的专用命令，避免和通用键值路径混用。

## `src/utils/cardConfigService.ts`
**职责**：仪表盘卡片实例配置的统一读写服务（静态类），配置最终落在后端 `app_config.json` 的 `card_settings` 对象下，按 `cardId` 隔离。
**导出**：类 `CardConfigService`（静态方法 `getCardSettings`、`saveCardSettings`、`updateCardSetting`、`removeCardSettings`）。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`@/utils/logger` 的 `logDebug`/`logError`、`@/types/card-settings` 的 `BaseCardSettings` 类型。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CardConfigService.getCardSettings<T>` | cardConfigService.ts:16 | invoke `get_card_settings`，参数 `{cardId}`，返回 `T`（后端返回 `null`/`undefined` 时转为 `{}`）；失败 `logError` 并返回 `{} as T`（**不抛**） |
| `CardConfigService.saveCardSettings` | cardConfigService.ts:33 | invoke `save_card_settings`，参数 `{cardId, settings}`（`Partial<BaseCardSettings>`，与现有配置合并），返回 `void`；成功 `logDebug`，失败 `logError` 后**重新 throw** |
| `CardConfigService.updateCardSetting` | cardConfigService.ts:55 | 无独立命令：先 `getCardSettings` 读全量 → 展开合并 `{[key]: value}` → 调 `saveCardSettings` 落盘；返回 `void`；失败 `logError` 后**重新 throw**（读-改-写非原子） |
| `CardConfigService.removeCardSettings` | cardConfigService.ts:82 | invoke `remove_card_settings`，参数 `{cardId}`，返回 `void`；成功 `logDebug`，失败 `logError` 后**重新 throw** |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| cardConfigService.ts:16-26 | `getCardSettings`（读） |
| cardConfigService.ts:33-76 | `saveCardSettings` / `updateCardSetting`（写与单字段更新） |
| cardConfigService.ts:82-90 | `removeCardSettings`（删） |

**备注**：
- 封装的 invoke 命令：`get_card_settings`、`save_card_settings`、`remove_card_settings`（共 3 个）。
- 配置键：不直接使用 `configService` 的键；数据位于后端 `app_config.json` 的 `card_settings` 对象，按 `cardId` 分片（见文件头注释 cardConfigService.ts:5-9）。
- 缓存策略：无前端缓存，每次读都发 IPC；`updateCardSetting` 依赖 `getCardSettings` 结果做合并，存在并发覆盖风险。

## `src/utils/dashboardConfig.ts`
**职责**：单个标签页内卡片集合的增删改与布局计算（新增卡片自动寻位、拖拽换序、尺寸调整），数据实际持久化在标签页对象的 `cards` 字段中（经 `tabService` 存储）。
**导出**：`getDashboardConfig`、`addCard`、`removeCard`、`moveCard`、`updateCardLayout`。
**主要依赖**：`@/types/dashboard` 的 `CardConfig`/`CardTypeId`/`DashboardConfig`/`DashboardTab`、`uuid` 的 `v4`、`@/components/cards/registry/loader` 的 `loadAllCards`、`./cardConfigService` 的 `CardConfigService`、`./tabService` 的 `getAllTabs`/`saveTabs`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `getDashboardConfig` | dashboardConfig.ts:21 | **不直接 invoke**：内部 `getTabById` → `getAllTabs`（→ `getConfig('dashboard_tabs')`）；标签不存在时返回 `{cards:[], lastUpdated:Date.now()}`，否则返回 `{cards, lastUpdated: tab.updatedAt}` |
| `addCard` | dashboardConfig.ts:85 | 读取标签配置 → `loadAllCards()` 取卡片 meta 默认尺寸（`options.w/h` 优先，再 `meta.defaultSize`，最后 3×2）→ `findBestPosition` 找无碰撞坐标 → 生成 `uuid` 卡片对象 push → `saveTabCards`（→ `setConfig('dashboard_tabs')`）；若传 `options.settings` 再调 `CardConfigService.saveCardSettings`；返回新 `cardId`。**不捕获错误** |
| `removeCard` | dashboardConfig.ts:122 | 按 `cardId` 过滤卡片数组并重排 `position`（0..n-1），经 `saveTabCards` 持久化；返回 `void`。卡片不存在时也照常保存；**不捕获错误** |
| `moveCard` | dashboardConfig.ts:131 | 将卡片从原索引 `splice` 出再插入 `newPosition`，重排所有 `position` 后保存；`cardId` 未找到时直接 return（不保存）；**不捕获错误** |
| `updateCardLayout` | dashboardConfig.ts:149 | 更新单卡片 `x/y/w/h` 后保存；卡片不存在时直接 return；**不捕获错误** |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| dashboardConfig.ts:7-19 | 私有辅助 `getTabById`、`saveTabCards`（读/写标签页并刷新 `updatedAt`） |
| dashboardConfig.ts:21-30 | `getDashboardConfig` |
| dashboardConfig.ts:32-83 | 私有 `findBestPosition`：在 `maxX+cardW+2` × `maxY+cardH+2` 范围内扫描无碰撞位置，取 `x+y` 最小者，命中 0 立即返回 |
| dashboardConfig.ts:85-164 | `addCard` / `removeCard` / `moveCard` / `updateCardLayout` |

**备注**：
- 封装的 invoke 命令：**本文件不直接 invoke**；实际 IPC 经由 `tabService` → `configService` 的 `get_config`/`set_config`（键 `dashboard_tabs`），以及 `CardConfigService` 的 `save_card_settings`。
- 配置键：`dashboard_tabs`（间接读写）。文件中**不存在** `dashboard_config_*` 形式的键。
- 缓存策略：无缓存，每次操作都全量读标签数组再整体写回（整对象覆盖式保存）。

## `src/utils/theme.ts`
**职责**：主题系统的单一数据源——预设色板、浅/深色模式与主题色（含用户自定义色）的应用函数。主窗口 `main.tsx`、设置页 `appearance-settings.tsx`、侧栏 `theme-switch.tsx` 与托盘面板入口 `tray-panel.tsx` 共用本模块，避免各入口重复实现（此前托盘窗口因此拿不到自定义主题色）。
**导出**：常量 `DEFAULT_THEME_COLOR`、`PRESET_COLORS`；类型 `ThemeMode`、`ThemeColor`、`AppliedTheme`；函数 `isSystemDark`、`getAllColors`、`findColorByName`、`resolveThemeColor`、`pickForegroundOn`、`applyPrimaryTextColor`、`applyThemeColor`、`applyThemeMode`、`loadTheme`。
**主要依赖**：`@/utils/configService` 的 `getConfig`。

> ⚠️ Liquid Glass 重构移除：`DEFAULT_GLASS_CLARITY` 与 `applyGlassClarity()`（旧「毛玻璃清晰度」0–100 → `--glass-blur` 等运行时变量）已删除，`loadTheme()` 不再读写 `glass_clarity` 配置键。新体系的模糊半径是 `globals.css` 的静态 `--lg-*` 令牌。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ThemeMode`（type） | theme.ts:11 | `"light" \| "dark" \| "system"` |
| `ThemeColor`（interface） | theme.ts:13 | `name`、`label` 与 `colors`（`50`–`900` + `foreground`），供预设与自定义色共用 |
| `DEFAULT_THEME_COLOR` | theme.ts:31 | `"indigo"`，预设首项 |
| `PRESET_COLORS` | theme.ts:35 | 6 套预设色板：indigo / blue / emerald / rose / amber / slate |
| `isSystemDark()` | theme.ts:141 | `prefers-color-scheme: dark` |
| `getAllColors(customColors?)` | theme.ts:146 | 预设 + 自定义色板 |
| `findColorByName(name, customColors?)` | theme.ts:151 | 按名称查找，未命中返回 `undefined` |
| `resolveThemeColor(name, customColors?)` | theme.ts:162 | 自定义 → 预设 → 首项的兜底链，保证永远有可用色板（自定义色被删除后配置可能残留旧名称） |
| `applyThemeColor(colors)` | theme.ts:277 | 把 `--primary-50`…`--primary-900`、`--primary` 写入 `<html>` 内联样式；`--primary-foreground` **不再照抄配色表**，改由 `pickForegroundOn(#色调)` 按亮度自动选黑/白；末尾调用 `applyPrimaryTextColor` 同步算出 `--primary-text` |
| `applyThemeMode(mode)` | theme.ts:305 | 给 `<html>` 切换 `dark` 类（`globals.css` 的 `@custom-variant dark` 依赖它），并在切完后重算 `--primary-text`（达标方向取决于底色深浅） |
| `pickForegroundOn(hex, fallback?)` | theme.ts:252 | 按 WCAG 相对亮度选黑/白。规则是**白字优先**：白字对比度 ≥3:1 就返回 `#ffffff`；否则仅当黑字比白字高 1.4 倍以上才反黑。不再用「黑白取更高者」——它在亮度交叉点会横跳（indigo `#6366f1` 白 4.47 / 黑 4.70 判黑，slate `#64748b` 判白），同一颗主按钮只因主题色微调就黑白翻转，深色界面上近黑字压在紫底上读不出。现在仅 `emerald`/`amber`/`#00FFBC` 这类亮底色才反黑 |
| `applyPrimaryTextColor(primary)` | theme.ts:267 | 计算并写入 `--primary-text`：浅色主题混黑、深色主题混白，逐步逼近直到与底色对比度 ≥4.5:1，只调明度不换色相。`--primary-text` 供 `text-primary-text`（文字）使用，`--primary` 仍供背景/边框 |
| `loadTheme()` | theme.ts:322 | 并行读 `theme_mode`/`theme_color`/`theme_custom_colors`，依次应用并返回 `{ mode, colorName }`；托盘面板入口靠它一次到位 |

**备注**：
- 封装的 invoke 命令：**本文件不直接 invoke**；配置读取经 `configService.getConfig` → `get_config`。**本文件只读不写**，写入仍由 `appearance-settings.tsx` / `theme-switch.tsx` 调 `setConfig` 完成。
- 配置键（只读）：`theme_mode`、`theme_color`、`theme_custom_colors`。
- 与 `appearance-settings.tsx` 的关系：该文件的 `PRESET_COLORS`、`applyThemeColor`、`DEFAULT_THEME_COLOR`、`getAllColors`、`findColorByName`、`pickForegroundOn` 均从本模块导入；只有取色器专用的 `hexToHsl`/`hslToHex`/`hexToRgb`/`rgbToHex`/`hexToHsv`/`hsvToHex`/`generateColorScale` 仍留在设置页（`generateColorScale` 的 `foreground` 字段改调 `pickForegroundOn(hex)`，自定义高亮色不会再配白字）。
- **顺序约束**：切换主题（`appearance-settings.tsx` 的 `handleModeChange`、`theme-switch.tsx` 的 `toggleTheme`）必须先 `applyThemeMode` 再 `dispatchEvent("themeChange")`。反过来广播的话，订阅者（各 ECharts 组件）会在旧 `.dark` 状态下取 `--muted`/`--separator` 颜色，之后没有任何事件再让它们重算，深色主题下坐标轴文字会停在浅色值上。

## `src/utils/backgroundSettings.ts`
**职责**：读取全局背景图设置（路径、透明度、模糊度），把背景图片字节读成 Blob URL 并同步写入 CSS 变量 `--bg-image` / `--bg-image-opacity` / `--bg-blur`。
**导出**：常量 `DEFAULT_BG_IMAGE_OPACITY`、`DEFAULT_BG_BLUR`；接口 `BackgroundSettings`；函数 `loadBackgroundSettings`。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`@/utils/configService` 的 `getConfig`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `DEFAULT_BG_IMAGE_OPACITY` | backgroundSettings.ts:4 | 常量 `0.5`，背景图默认不透明度 |
| `DEFAULT_BG_BLUR` | backgroundSettings.ts:5 | 常量 `16`，默认模糊像素 |
| `loadBackgroundSettings` | backgroundSettings.ts:14 | 并行 `getConfig` 读 `bg_image_path`/`bg_image_opacity`/`bg_blur`（缺省用上述默认值），写入 CSS 变量并把 `--bg-image` 先置为 `none`；若 `imagePath` 存在则 invoke `read_image_file`（参数 `{path}`，返回 `number[]`）转 `Blob(type:image/webp)` → `URL.createObjectURL` → 设为 `--bg-image`；读图**失败静默吞掉**（保持空背景），最终返回 `BackgroundSettings`；本函数自身**不捕获** `getConfig` 抛出的错误 |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| backgroundSettings.ts:4-12 | 默认常量与 `BackgroundSettings` 接口 |
| backgroundSettings.ts:14-42 | `loadBackgroundSettings`（配置读取 → CSS 变量 → 图片字节转 Blob URL） |

**备注**：
- 封装的 invoke 命令：`read_image_file`（参数 `{path}`）；间接经 `getConfig` 使用 `get_config`。
- 配置键：`bg_image_path`、`bg_image_opacity`、`bg_blur`（均通过 `configService.getConfig` 读取，本文件不写入）。
- 缓存策略：无缓存；每次调用都会新建 Blob URL，旧的 `URL.createObjectURL` 未见 `revokeObjectURL` 调用（潜在内存泄漏）。

## `src/utils/roleDataService.ts`
**职责**：角色数据统一查询服务（单例 `RoleDataService`），通过单一 IPC 命令 `query_role_data` 按 JSON 叶节点路径取数，并提供角色详情、干员、Wiki 物品目录等语义化封装；内置按查询键的 Promise 级内存缓存，避免组件重挂载重复 IPC。
**导出**：类型 `QueryResult`、类 `RoleDataService`、单例 `roleDataService`。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`./logger` 的 `logDebug`/`logInfo`/`logError`、`./startupProgress` 的 `trackStartupTask`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `queryData` | roleDataService.ts:65 | invoke `query_role_data`，参数 `{roleId, apiName, paths}`；返回 `QueryResult \| null`（路径不存在为 `null` 值，键为请求路径）。先查 `queryCache`（命中直接返回缓存的 Promise）；启动 Splash 跟踪期间计入初始任务；失败时**从缓存删除该键**、`logError`、返回 `null` |
| `clearCache` | roleDataService.ts:30 | 删除 `queryCache` 中 `roleId\|apiName\|paths.join(",")` 单条记录；返回 `void` |
| `clearAllCache` | roleDataService.ts:37 | `queryCache.clear()` 清空全部缓存；返回 `void` |
| `getFullCharDetail` | roleDataService.ts:108 | 内部 `queryData(roleId,'char_detail',[])`，返回 `result.__full__`；无结果返回 `null` |
| `getBaseInfo` | roleDataService.ts:124 | `queryData(..., ['base'])`，返回 `result.base`；否则 `null` |
| `getRoleName` | roleDataService.ts:140 | `queryData(..., ['base.name'])`，返回该字符串；否则 `null` |
| `getCharacter` | roleDataService.ts:157 | `queryData(..., ['chars.${charIndex}'])`，返回该干员对象；否则 `null` |
| `getAllCharIds` | roleDataService.ts:173 | `queryData(..., ['chars'])`，映射 `char.charData?.id` 并过滤空值；失败返回 `[]` |
| `batchQuery` | roleDataService.ts:192 | `queryData(roleId, 'char_detail', paths)` 的快捷封装，返回 `QueryResult \| null` |
| `getWikiItemDetail` | roleDataService.ts:205 | `queryData(roleId,'char_wiki_detail',[itemId])`，按 `raw.data.item` → `raw.data`(brief) → `raw.item` → `raw` 顺序解包返回；否则 `null` |
| `getItemCatalog` | roleDataService.ts:222 | `queryData(roleId,'wiki_catalog',[])` 取 `__full__`，遍历 `data.catalog[].typeSub[].items[]` 构建 `Map<itemId,{name,cover}>`；无 `__full__` 或 `data.catalog` 非数组返回 `null`；内部用 `console.log` 输出诊断与前 3 条 item 原始结构 |
| `getWikiItemDetails` | roleDataService.ts:274 | 批量版：`queryData(roleId,'char_wiki_detail',itemIds)`，逐 id 按与 `getWikiItemDetail` 相同的优先级解包进 `Record`；`itemIds` 为空或无结果返回 `{}` |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| roleDataService.ts:15-21 | `QueryResult` 类型、模块级 `queryCache`（`Map<string, Promise>`）与 `cacheKey` 拼接函数 |
| roleDataService.ts:30-39 | 缓存管理 `clearCache` / `clearAllCache` |
| roleDataService.ts:64-100 | 核心 `queryData`（缓存命中 + IPC + 失败删缓存） |
| roleDataService.ts:108-194 | 角色详情/基础信息/干员相关便捷方法 |
| roleDataService.ts:196-291 | Wiki 相关方法（`getWikiItemDetail`、`getItemCatalog`、`getWikiItemDetails`） |
| roleDataService.ts:295 | 单例导出 |

**备注**：
- 封装的 invoke 命令：仅 `query_role_data`（`apiName` 取值出现：`char_detail`、`char_wiki_detail`、`wiki_catalog`）。
- 配置键：不读写任何配置键。
- 缓存策略：模块级 `Map<string, Promise<QueryResult|null>>`，键为 `${roleId}|${apiName}|${paths.join(",")}`；**缓存 Promise 本身**（并发去重），失败时删除对应键以便重试；`paths` 顺序不同会生成不同缓存键。注意：成功结果（含 `null` 结果值）会长期驻留，需手动 `clearCache`/`clearAllCache`。
- 异常点：`getItemCatalog` 内使用裸 `console.log`（roleDataService.ts:227、233、257、263），与文件其余部分用 logger 的风格不一致，且遗留调试日志。

## `src/utils/arknightsDataService.ts`
**职责**：《明日方舟》`get_arknights_player_info` 的类型化封装（2026-11 新增，供公开招募/基地数据卡片与 `/recruitment` `/building` `/game-data` 页面共用）。做两件事：**游戏分流**（`resolveRoleGame` 判别，非明日方舟账户直接返回 `null`，调用方渲染空态）与**旧缓存自动迁移**（缓存文件是「解析后的结构体落盘」，`dataVersion < ARKNIGHTS_DATA_VERSION`（当前 =3）说明是更早版本写的旧格式缓存、缺章节进度或训练室 `level` 等字段 —— 自动 `force: true` 联网刷新一次，失败时仍返回旧缓存内容并只记日志）。

**导出**：`ArknightsDataOptions`、`fetchArknightsPlayerInfo({ roleId, force? })`。
**主要依赖**：`@tauri-apps/api/core`（`invoke`）、`@/types/arknights`（`ArknightsPlayerInfo`、`ARKNIGHTS_DATA_VERSION`）、`./roleGame`（`resolveRoleGame`）、`./logger`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `fetchArknightsPlayerInfo` | arknightsDataService.ts:38 | invoke `get_arknights_player_info` → 检测 `info.dataVersion ?? 0 < ARKNIGHTS_DATA_VERSION`（=3）且未强制时**再刷一次 `force: true`**（后端 `refresh_player_info` 会把新格式落盘，之后不再触发）；强制刷新失败返回旧缓存；非 arknights 角色返回 `null` |

**备注**：
- 封装的 invoke 命令：仅 `get_arknights_player_info`。
- 后端标记来源：`ArknightsService::fetch_player_info` 解析成功后填 `data_version`（`models::arknights::ARKNIGHTS_DATA_VERSION`），绑定/刷新/`refresh_accounts` 都会写新格式缓存。
- 类型与后端 `src-tauri/src/models/arknights.rs` 一一对应，见 `src/types/arknights.ts`。

## `src/utils/roleDetailService.ts`
**职责**：角色详情与相关后端开关的轻量服务（单例 `RoleDetailService`），统一通过 `query_role_data` 取完整角色详情，并管理后端懒加载开关与当前激活角色 ID。
**导出**：类 `RoleDetailService`、单例 `roleDetailService`。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`./logger` 的 `logDebug`/`logInfo`/`logError`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `getCharDetail` | roleDetailService.ts:12 | invoke `query_role_data`，参数 `{roleId, apiName:'char_detail', paths:[]}`，返回 `result.__full__ ?? null`；失败 `logError` 并返回 `null` |
| `setLazyLoadEnabled` | roleDetailService.ts:30 | invoke `set_lazy_load_enabled`，参数 `{enabled}`，返回 `void`；失败 `logError` 后**重新 throw** |
| `isLazyLoadEnabled` | roleDetailService.ts:43 | invoke `is_lazy_load_enabled`，无参，返回 `boolean`；失败 `logError` 并**默认返回 `true`** |
| `setCurrentRoleId` | roleDetailService.ts:56 | invoke `set_current_role_id`，参数 `{roleId}`（可为 `null`），返回 `void`；失败仅 `logError`，**不抛** |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| roleDetailService.ts:12-25 | `getCharDetail` |
| roleDetailService.ts:30-63 | 后端开关与激活角色：`setLazyLoadEnabled` / `isLazyLoadEnabled` / `setCurrentRoleId` |
| roleDetailService.ts:67 | 单例导出 |

**备注**：
- 封装的 invoke 命令：`query_role_data`、`set_lazy_load_enabled`、`is_lazy_load_enabled`、`set_current_role_id`（共 4 个）。
- 配置键：不读写前端配置键；懒加载状态与当前角色 ID 由后端保存。
- 缓存策略：**无缓存**（与 `roleDataService` 不同，每次 `getCharDetail` 都发 IPC）；与 `RoleDataService.getFullCharDetail` 功能重叠，但绕过了其 Promise 缓存。

## `src/utils/tabService.ts`
**职责**：仪表盘标签页（Tab）的 CRUD，数据整体存放在配置键 `dashboard_tabs`，当前激活标签存放在 `dashboard_active_tab`。
**导出**：`getAllTabs`、`saveTabs`、`getActiveTabId`、`setActiveTabId`、`addTab`、`removeTab`、`updateTab`。
**主要依赖**：`./configService` 的 `getConfig`/`setConfig`/`removeConfig`、`@/types/dashboard` 的 `DashboardTab`、`uuid` 的 `v4`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `getAllTabs` | tabService.ts:8 | `getConfig<DashboardTab[]>('dashboard_tabs')`（→ invoke `get_config`），无数据返回 `[]`；配置读取失败由 `getConfig` 降级 localStorage |
| `saveTabs` | tabService.ts:13 | `setConfig('dashboard_tabs', tabs)`（→ invoke `set_config`），返回 `void`；失败由 `setConfig` 降级写 localStorage |
| `getActiveTabId` | tabService.ts:17 | `getConfig<string>('dashboard_active_tab')`，无数据返回 `null` |
| `setActiveTabId` | tabService.ts:22 | 传入非空 id 时 `setConfig('dashboard_active_tab', id)`；传 `null` 时 `removeConfig('dashboard_active_tab')`（→ invoke `remove_config`）；返回 `void` |
| `addTab` | tabService.ts:30 | 读全量 tabs → 新建 `{id:uuidv4(), name, icon, tags, cards:[], defaultRoleId, createdAt, updatedAt}`（`tags` 默认 `[]`）→ `saveTabs` → 返回新 `DashboardTab` |
| `removeTab` | tabService.ts:53 | 按 `tabId` 过滤后保存；若被删的是激活标签则 `setActiveTabId(null)` 清除激活态；返回 `void` |
| `updateTab` | tabService.ts:63 | 局部更新 `name`/`icon`/`tags`/`defaultRoleId` 并刷新 `updatedAt`；`tabId` 不存在时直接 return（不保存）；返回 `void` |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| tabService.ts:5-6 | 模块常量 `TABS_KEY = 'dashboard_tabs'`、`ACTIVE_TAB_KEY = 'dashboard_active_tab'`（未导出） |
| tabService.ts:8-28 | 标签读写与激活标签读写 |
| tabService.ts:30-76 | `addTab` / `removeTab` / `updateTab` |

**备注**：
- 封装的 invoke 命令（经 `configService`）：`get_config`、`set_config`、`remove_config`。
- 配置键：`dashboard_tabs`（`DashboardTab[]`，含每个标签的 `cards`）、`dashboard_active_tab`（当前激活标签 id）。
- 缓存策略：无缓存，整数组全量读写；`saveTabs` 是标签相关数据（含卡片布局）的唯一落盘出口。

## `src/utils/tabSnapshotService.ts`
**职责**：仪表盘标签页**快照**——离开当前标签页视图时截取主窗口内容区左上角画面并落盘，主界面卡片用其作缩略图。截图经后端 `save_tab_snapshot`（PrintWindow GDI），文件存 `<app_data>/snapshots/<tabId>-<时间戳>.png`，路径映射写配置键 `dashboard_tab_snapshots`。
**导出**：`registerDashboardLeaveHandler`、`runDashboardLeaveHandler`、`captureTabSnapshot`、`getSnapshotPaths`、`deleteTabSnapshotFile`。
**主要依赖**：`@tauri-apps/api/core`（`invoke`）、`./configService`、`./platform`（`isWindowsPlatform`）、`./logger`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SNAPSHOT_CONFIG_KEY` | tabSnapshotService.ts:7 | 配置键 `"dashboard_tab_snapshots"`（`{ [tabId]: PNG 路径 }`） |
| `SNAPSHOT_CSS_WIDTH` / `SNAPSHOT_CSS_HEIGHT` | :10 / :11 | 截取区域 CSS 尺寸上限 640×420（乘以 devicePixelRatio 得物理像素，与后端 8192 上限一致） |
| `inflight` | :14 | `Map<tabId, Promise>`：同标签页截图进行中去重 |
| `registerDashboardLeaveHandler` | :22 | DashboardPage 挂载时注册 / 卸载时置 `null` 的「离开仪表盘」钩子 |
| `runDashboardLeaveHandler` | :28 | 侧栏导航守卫点击前 await 该函数，钩子不在时为空操作 |
| `captureTabSnapshot` | :46 | 核心：非 Windows / 无 tabId 直接 resolve；截图前把内容区滚回顶部（`closest("main").scrollTop=0` + 等两帧 rAF）；以 `#dashboard-main` 的视口矩形 × dpr 计算 `(x,y,width,height)`（宽/高钳到 640×420）；`invoke("save_tab_snapshot", { tabId, x, y, width, height })` 取回路径写入映射并 `setConfig`；失败仅 `logError`（静默降级，不阻塞导航） |
| `getSnapshotPaths` | :104 | 读映射（模块级 `snapshotMap` 缓存，首次从 config 加载） |
| `deleteTabSnapshotFile` | :109 | `invoke("delete_tab_snapshot")` + 从映射中移除该 tabId |

**备注**：
- **invoke 命令**：`save_tab_snapshot`（tabSnapshotService.ts:78，参数 `{ tabId, x, y, width, height }`）、`delete_tab_snapshot`（:111，参数 `{ tabId }`）；配置读写经 `get_config`/`set_config`。
- 时序契约：所有调用点都保证「窗口画面仍是该标签页」时截图——DashboardPage 的 `loadDashboard` 开头、`handleBackToSelector`、`dashboardOpenSelector` 事件，以及侧栏 `handleNavClick`/父节点点击（`preventDefault` 后 await 再 `navigate`，否则 Link 默认导航先于截图完成）。
- 文件命名带时间戳 + 写新删旧：`imageCacheManager`/浏览器均按路径缓存图片，路径变化保证读到最新画面。
- 非 Windows 平台后端返回不支持，`captureTabSnapshot` 内部先行 `isWindowsPlatform()` 短路，主界面显示占位。

## `src/utils/tabIcons.tsx`
**职责**：标签页图标键到 React 图标组件的映射表，以及中英文图标名称表，提供按 key 取组件/取文案的工具函数。
**导出**：`TAB_ICON_MAP`、`ICON_LABELS`、`getTabIcon`、`getIconLabel`。
**主要依赖**：`react`、`@/components/icons`（`HomeIcon`、`ChartIcon`、`UsersIcon`、`StarIcon`、`HeartIcon`、`BookmarkIcon`、`TagIcon`、`FolderIcon`、`CalendarIcon`、`BellIcon`、`SettingsIcon`、`AccountIcon`、`SearchIcon`、`DeveloperIcon`、`ProjectsIcon`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TAB_ICON_MAP` | tabIcons.tsx:20 | `Record<string, ComponentType>`，15 个图标键：`home`、`chart`、`users`、`star`、`heart`、`bookmark`、`tag`、`folder`、`calendar`、`bell`、`settings`、`account`、`search`、`developer`、`projects` |
| `ICON_LABELS` | tabIcons.tsx:38 | 与 `TAB_ICON_MAP` 同 key 的 `{zh, en}` 双语名称表 |
| `getTabIcon` | tabIcons.tsx:56 | 按 `iconKey` 取组件，**未命中回退 `HomeIcon`**；无 IPC、无异常路径 |
| `getIconLabel` | tabIcons.tsx:60 | 按 `iconKey` + `lang`（`'zh' \| 'en'`）取文案，未命中回退显示 `iconKey` 本身；无异常路径 |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| tabIcons.tsx:1-18 | import 图标组件 |
| tabIcons.tsx:20-54 | 两个静态映射表 |
| tabIcons.tsx:56-62 | 两个取值辅助函数 |

**备注**：
- 封装的 invoke 命令：无。
- 配置键：无（图标 key 由 `DashboardTab.icon` 字段携带，最终存于 `dashboard_tabs`）。
- 缓存策略：静态模块常量，无缓存逻辑。注意 `getIconLabel` 的 `lang` 参数未做合法性校验，非 `zh`/`en` 会走回退分支。

## `src/utils/messageStore.ts`
**职责**：全局应用内消息（通知中心）的内存状态仓库，提供订阅式增删改查、未读统计、按 tag 去重与 `sessionStorage` 持久化，通过 `messagesChanged` 自定义事件 + listener 双通道通知 UI。
**导出**：类型 `MessageType`、`AppMessageAction`、`AppMessage`；函数 `getMessages`、`getUnreadCount`、`hasUrgentUnread`、`addMessage`、`updateMessage`、`markRead`、`markAllRead`、`clearMessages`、`removeMessage`、`removeMessagesByTag`、`subscribeMessages`。
**主要依赖**：无外部依赖（仅浏览器 `sessionStorage`、`crypto.randomUUID`、`window.dispatchEvent`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `getMessages` | messageStore.ts:59 | 返回内存消息数组；为空时先 `load()` 从 `sessionStorage['app_messages']` 惰性加载；无异常路径 |
| `getUnreadCount` | messageStore.ts:64 | 统计 `read === false` 的条数 |
| `hasUrgentUnread` | messageStore.ts:68 | 是否存在未读且 `type === 'urgent'` 的消息 |
| `addMessage` | messageStore.ts:72 | 补齐 `id=crypto.randomUUID()`、`timestamp=Date.now()`、`read` 默认 `false`、`dismissable` 默认 `true`；若有 `tag` 先移除同 tag 旧消息（去重），插入队首并截断到 `MAX_MESSAGES=80`，随后 `persist()` + `emit()`，返回新条目 |
| `updateMessage` | messageStore.ts:92 | 按 `id` 局部更新 `title`/`body`/`type`/`actions`/`progress`，持久化并通知；`id` 不存在则无变化 |
| `markRead` | messageStore.ts:101 | 按 `id` 置 `read=true`，持久化并通知 |
| `markAllRead` | messageStore.ts:107 | 全部置 `read=true`，持久化并通知 |
| `clearMessages` | messageStore.ts:113 | 清空全部消息，持久化并通知 |
| `removeMessage` | messageStore.ts:119 | 按 `id` 删除，持久化并通知 |
| `removeMessagesByTag` | messageStore.ts:125 | 按 `tag` 删除同标签消息，持久化并通知 |
| `subscribeMessages` | messageStore.ts:131 | 注册回调到 `listeners`，返回取消订阅函数（从数组移除该 fn）；`emit()` 时逐个调用并额外派发 `window` 事件 `messagesChanged` |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| messageStore.ts:1-21 | 类型定义（`MessageType` 仅 `info`/`warn`/`urgent`） |
| messageStore.ts:23-27 | 模块常量 `STORAGE_KEY='app_messages'`、`MAX_MESSAGES=80` 与内存状态 `messages`/`listeners` |
| messageStore.ts:29-57 | 私有 `emit()`、`persist()`（截断到 80 条写 sessionStorage）、`load()`（含旧类型迁移：发现 `success`/`error`/`warning` 即**丢弃整份数据**并移除键） |
| messageStore.ts:59-136 | 全部导出查询/变更/订阅函数 |

**备注**：
- 封装的 invoke 命令：无（纯前端状态库）。
- 配置键/存储键：`sessionStorage` 键 `app_messages`（非 `configService` 命名空间）。
- 缓存策略：单例内存数组 `messages`，读时惰性加载；每次变更同步写 sessionStorage。
- 异常点：`load()` 对含 legacy 类型的消息采取「整表作废」而非仅迁移；`persist()` 的 `JSON.stringify` 异常被空 `catch` 吞掉。

## `src/utils/launcherService.ts`
**职责**：游戏启动器（安装/更新/校验修复/预下载/渠道切换/启动/进程控制/公告背景资源）的全部 Tauri IPC 封装 + 三个进度事件监听 + 渠道/阶段标签与字节格式化工具。
**导出**：类型 `GameChannel`、`GameId`、`GameStatus`、`ActiveOperation`、`RemotePackage`、`DownloadProgress`、`BackgroundMedia`、`LauncherResult`、`PayloadState`、`BannerItem`、`AnnouncementItem`、`LauncherNoticeContent`、`SidebarItem`、`FileScanResult`、`DiskSpace`、`GamePlaytime`、`LaunchExportOptions`、`SteamShortcutOptions`、`SteamShortcutDefaults`、`AddSteamShortcutResult`、`LauncherGame`；函数 `checkGameStatus`、`installOrUpdate`、`verifyAndRepair`、`getProcessReadBytes`、`getRemoteVersion`、`getPayloadState`、`cancelDownload`、`preloadDownload`、`installPreload`、`resetDownloadCancel`、`hasDownloadCache`、`getBanners`、`getAnnouncements`、`getNoticeContent`、`getBackgroundImage`、`startGame`、`syncSilentLaunchConfig`、`restoreLaunchConfig`、`getGameLaunchCommand`、`createGameShortcut`、`getSteamShortcutDefaults`、`pickSteamIcon`、`pickSteamIconSource`、`extractSteamIcon`、`addSteamShortcut`、`browseFolder`、`checkExecutable`、`checkGameRunning`、`killGame`、`getGamePlaytime`、`detectChannel`、`scanInstallDir`、`getDiskSpace`、`switchChannel`、`cancelSwitch`、`cancelAll`、`onLauncherProgress`、`onProgress`、`onSwitchProgress`、`formatBytes`、`switchableChannels`、`gameConfigKey`、`gameOfChannel`、`readGameInstallPath`、`readGameChannel`、`persistDetectedInstall`、`persistInstallPath`；常量 `CHANNEL_LABELS`、`CHANNEL_SHORT`、`CHANNEL_GAME`、`GAME_CHANNELS`、`GAME_ORDER`、`ALL_CHANNELS`、`DEFAULT_CHANNEL`、`STAGE_LABELS`、`LAUNCH_TOKEN_KEYS`、`LAUNCH_WARNING_TITLE_KEYS`、`KILL_TOKEN_KEYS`；函数 `splitLaunchToken`（解析 `<token>: <detail>` 契约串）。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`@tauri-apps/api/event` 的 `listen` / 类型 `UnlistenFn`。

**类型备注**：`RemotePackage`（launcherService.ts:38）除 `version` / `resource_base_url` 外还带补丁与预下载信息：`has_patch`、`patch_total_bytes`、`has_patch_whole`、`patch_is_delta`、`preload_total_bytes`（后端 `RemotePackage` 另含 `preload_parts` / `patch_parts`，前端未用）。解密密钥 `cd_key` 只存在后端，不下发前端。

**按游戏分区（配置键）**：安装路径 / 渠道 / DX11 每个游戏各存一份——终末地沿用 `launcher_install_path` / `launcher_channel` / `launcher_dx11`，明日方舟用同名 `_arknights` 后缀键。`gameConfigKey(base, game)` 统一拼键名，`readGameInstallPath` / `readGameChannel` 负责带头默认值地读取；`startGame` / `syncSilentLaunchConfig` / `restoreLaunchConfig` 都按游戏逐个读写，后端 `commands/startup.rs::LauncherGame` 用同一套规则。当前选中的游戏保存在 `stores/launcherGame.ts`（键 `launcher_game`，带订阅）。

**目录与渠道必须同属一个游戏**：分区里存的是「安装路径 + 渠道」一对，两者必须指向同一个游戏，否则后端 `check_status` 会拿错渠道去拼 exe 名（`Endfield.exe` / `Arknights.exe`），`is_installed` 恒为 false，界面一直要求下载游戏。三条约束把住这个不变量：

- `persistDetectedInstall(installPath, detected)` — 识别出渠道后统一落盘。按**渠道的归属游戏**写 `launcher_install_path[_arknights]` 与 `launcher_channel[_arknights]`，并清掉另一个分区里指向同一目录的旧路径与那个「不属于自己」的渠道（识别错游戏时写歪的残留）。localStorage 与后端 config（`app_config.json`）同时写——后端那一份是静默启动 / 快捷方式的真正依据，只改 localStorage 会被下次启动的 `restoreLaunchConfig` 搬回旧值。返回该渠道所属的游戏，供调用方同步 `launcherGame`。
- `persistInstallPath(installPath, game)` — 只记目录、不动渠道，用于「目录已选好但还没识别出渠道」（游戏还没装）的情况；同样两边都写。
- `syncSilentLaunchConfig` / `restoreLaunchConfig` — 同步与回灌时都校验「渠道属于该游戏」，不匹配就跳过，避免把外来渠道带进分区。

**渠道分组**：`GameChannel` 同时承载两个游戏——`official` / `bilibili` / `global` / `google_play` 属《明日方舟：终末地》，`arknights` / `arknights_bilibili` 属《明日方舟》。`GAME_CHANNELS`（按游戏分组）、`GAME_ORDER`（展示顺序）、`CHANNEL_GAME`（渠道 → 游戏）、`CHANNEL_SHORT`（圆形徽标文字）供界面分组渲染；`switchableChannels(from)` 返回同游戏内除当前渠道外的全部候选（两个游戏都支持换服：实测 2026-11-08，渠道差异都完整落在各自清单里，明日方舟官↔B 约 706 MB diff）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `checkGameStatus` | launcherService.ts:109 | invoke `launcher_check_status`，参数 `{channel, installPath}`，返回 `GameStatus`；无本地错误处理（错误上抛） |
| `installOrUpdate` | launcherService.ts:155 | invoke `launcher_install_or_update`，参数 `{channel, installPath, maxConcurrent ?? null, resume ?? true}`，返回 `LauncherResult`；无本地错误处理 |
| `verifyAndRepair` | launcherService.ts:169 | invoke `launcher_verify_and_repair`，参数 `{channel, installPath, maxConcurrent ?? null, quick ?? false, resume ?? true}`；**若 `result.success === false` 则 `throw result.message`**（抛字符串），否则返回 `LauncherResult` |
| `getProcessReadBytes` | launcherService.ts:144 | invoke `launcher_get_process_read_bytes`，无参，返回 `number`（进程已读字节） |
| `getRemoteVersion` | launcherService.ts:148 | invoke `launcher_get_remote_version`，参数 `{channel}`，返回 `RemotePackage` |
| `getPayloadState` | launcherService.ts:154 | invoke `launcher_get_payload_state`，参数 `{channel}`，返回 `PayloadState \| null` |
| `cancelDownload` | launcherService.ts:160 | invoke `launcher_cancel_download`，参数 `{installPath ?? null}`，返回 `void` |
| `preloadDownload` | launcherService.ts:209 | invoke `launcher_preload_download`，参数 `{channel, installPath, maxConcurrent ?? null, resume ?? true}`，返回 `LauncherResult` |
| `installPreload` | launcherService.ts:223 | invoke `launcher_install_preload`，参数 `{channel, installPath, maxConcurrent ?? null, resume ?? true}`，返回 `LauncherResult` |
| `resetDownloadCancel` | launcherService.ts:176 | invoke `launcher_reset_download_cancel`，无参，返回 `void` |
| `hasDownloadCache` | launcherService.ts:180 | invoke `launcher_has_download_cache`，参数 `{installPath}`，返回 `boolean` |
| `getBanners` | launcherService.ts:184 | invoke `launcher_get_banners`，参数 `{channel}`，返回 `BannerItem[]` |
| `getAnnouncements` | launcherService.ts:190 | invoke `launcher_get_announcements`，参数 `{channel}`，返回 `AnnouncementItem[]` |
| `getNoticeContent` | launcherService.ts:196 | invoke `launcher_get_notice_content`，参数 `{channel}`，返回 `LauncherNoticeContent`（横幅 + 公告 + 右侧栏 `sidebars` 合并结构） |
| `getBackgroundImage` | launcherService.ts:204 | invoke `launcher_get_background_image`，参数 `{channel}`，返回 `BackgroundMedia \| null` |
| `startGame` | launcherService.ts:280 | invoke `launcher_start_game`，参数 `{installPath, channel, dx11?}`，返回 `LauncherResult`；`dx11` 为 true 时后端给游戏进程追加 `-force-d3d11`，省略时后端读取配置 `launcher_dx11`；失败时 `message` 为 `<token>: <detail>`（token 见 `LAUNCH_TOKEN_KEYS`），回退直接启动或 Steam 未提权时的提示在 `warning` 字段（标题见 `LAUNCH_WARNING_TITLE_KEYS`） |
| `syncSilentLaunchConfig` | launcherService.ts:297 | 从 localStorage 将 `launcher_install_path`、`launcher_channel`、`launcher_dx11` 通过 `set_config` 写入 app config |
| `restoreLaunchConfig` | launcherService.ts:318 | **反向同步**：invoke `get_config` 读取 app config 中非空的 `launcher_install_path`、`launcher_channel` 与布尔 `launcher_dx11` 回写 localStorage；后端不可用时静默保留 localStorage 现状。修复静默命令行启动后打开完整版时游戏面板因 localStorage 缺失而显示「定位游戏」的问题 |
| `getGameLaunchCommand` | launcherService.ts:343 | invoke `get_game_launch_command`，返回包含 exe 路径与 `--silent --launch-game` 的完整命令（`--dx11` 由前端按开关追加展示） |
| `createGameShortcut` | launcherService.ts:351 | invoke `create_game_shortcut`，参数 `LaunchExportOptions {dx11?}`（缺省读后端配置 `launcher_dx11`）；弹出用户选定保存位置的对话框，返回 `.lnk` 路径或 `null`（取消）。**不再接受 `closeAfterLaunch`** |
| `getSteamShortcutDefaults` | launcherService.ts:387 | invoke `steam_shortcut_defaults`，无参，返回 `SteamShortcutDefaults`（名字、默认 `.ico`、是否提取成功、游戏是否存在、DX11、两项 Overlay 选项、开始菜单快捷方式数量、当前是否已提权） |
| `pickSteamIcon` | launcherService.ts:391 | invoke `pick_steam_icon`，无参，返回图标路径或 `null`（取消） |
| `pickSteamIconSource` | launcherService.ts:395 | invoke `pick_steam_icon_source`，无参，返回用于提取图标的 exe 路径或 `null` |
| `extractSteamIcon` | launcherService.ts:399 | invoke `extract_steam_icon`，参数 `{exePath}`，返回生成的 `.ico` 路径 |
| `addSteamShortcut` | launcherService.ts:403 | invoke `add_steam_shortcut`，参数 `{options: SteamShortcutOptions}`（`name`/`icon_path`/`dx11`/`create_admin_shortcut`/`elevate_start_menu`，调用处把 camelCase 转成后端字段名）；返回 `AddSteamShortcutResult {shortcuts_path, admin_shortcut, elevated_start_menu}`。**允许 Steam 运行中写入**，成功后需重启 Steam 才可见 |
| `browseFolder` | launcherService.ts:363 | invoke `launcher_browse_folder`，无参，返回 `string \| null`（用户选择的目录） |
| `checkExecutable` | launcherService.ts:226 | invoke `launcher_check_executable`，参数 `{installPath, channel}`，返回 `boolean` |
| `checkGameRunning` | launcherService.ts:236 | invoke `launcher_check_game_running`，参数 `{channel}`，返回 `boolean` |
| `killGame` | launcherService.ts:456 | invoke `launcher_kill_game`，参数 `{channel}`，返回 `boolean`（`true` = 已结束，`false` = 本来就没有进程）。**失败时 reject**，错误串为 `<token>: <detail>`（token 为 `cancelled` / `kill_failed` / `unknown`，文案见 `KILL_TOKEN_KEYS`（:81））；后端在未提权时会经 UAC 以管理员权限终止进程（`process::terminate_processes`），因此这里可能弹出提权确认；就地终止判定为 `AccessDenied` 时才弹，响应几乎即时 |
| `getGamePlaytime` | launcherService.ts:365 | invoke `launcher_get_game_playtime`，无参，返回 `GamePlaytime {total_seconds, session_seconds, running}`（累计总时长 + 当前会话 + 运行态） |
| `detectChannel` | launcherService.ts:252 | invoke `launcher_detect_channel`，参数 `{installPath}`，返回 `GameChannel \| null` |
| `scanInstallDir` | launcherService.ts:258 | invoke `launcher_scan_install_dir`，参数 `{channel, installPath}`，返回 `FileScanResult`（损坏/缺失文件清单与字节统计） |
| `getDiskSpace` | launcherService.ts:268 | invoke `launcher_get_disk_space`，参数 `{path}`，返回 `DiskSpace {total, free}` |
| `switchChannel` | launcherService.ts:272 | invoke `launcher_switch_channel`，参数 `{fromChannel, toChannel, installPath}`，返回 `string`（结果消息） |
| `cancelSwitch` | launcherService.ts:284 | invoke `launcher_cancel_switch`，无参，返回 `void` |
| `cancelAll` | launcherService.ts:288 | invoke `launcher_cancel_all`，无参，返回 `void` |
| `onLauncherProgress` | launcherService.ts:294 | `listen<DownloadProgress>('launcher-progress', ...)`，参数为回调，返回 `Promise<UnlistenFn>`；**事件名为 `launcher-progress`（无 `://`）** |
| `onProgress` | launcherService.ts:302 | `listen<ActiveOperation>('launcher://progress', ...)`，返回 `Promise<UnlistenFn>` |
| `onSwitchProgress` | launcherService.ts:310 | `listen<DownloadProgress>('launcher://switch-progress', ...)`，返回 `Promise<UnlistenFn>` |
| `formatBytes` | launcherService.ts:486 | 纯函数：1024 进制格式化为 `B/KB/MB/GB/TB`（保留 2 位小数），`0` 返回 `"0 B"` |
| `LAUNCH_TOKEN_KEYS` | launcherService.ts:60 | 启动结果 `<token>` → i18n 文案键的映射；新增 `overlay_unavailable` → `launcher.launch_overlay_unavailable` |
| `LAUNCH_WARNING_TITLE_KEYS` | launcherService.ts:72 | `warning` 的标题映射：`fallback` → `launcher.launch_fallback_title`、`overlay_unavailable` → `launcher.launch_overlay_title`；缺省沿用 `fallback` 标题 |
| `splitLaunchToken` | launcherService.ts:77 | 按第一个 `:` 拆成 `{token, detail}`；无冒号时 `token=""`、`detail=原文` |
| `persistDetectedInstall` | launcherService.ts:733 | 识别出渠道后统一落盘（**async**）：按**渠道的归属游戏**写 `launcher_install_path[_arknights]` 与 `launcher_channel[_arknights]`（localStorage + 后端 `set_config` 双写），并清掉另一个分区里指向同一目录的旧路径与那个「不属于自己」的渠道。返回该渠道所属的 `LauncherGame`，供调用方同步 `launcherGame` store。**目录与渠道必须同属一个游戏**，否则 `check_status` 会拿错 exe 名判安装、`is_installed` 恒为 false |
| `persistInstallPath` | launcherService.ts:781 | 只记安装目录、不动渠道（**async**，localStorage + 后端 `set_config` 双写）：用于「目录已选好但还没识别出渠道」（游戏还没装）的情况，路径留在当前游戏的分区里，渠道留给用户选 |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| launcherService.ts:8-105 | 全部类型定义（渠道、状态、进度、包信息、公告、扫描结果、磁盘空间） |
| launcherService.ts:109-290 | IPC 封装函数（27 个命令包装） |
| launcherService.ts:294-316 | 三个事件监听器 |
| launcherService.ts:320-351 | 常量 `CHANNEL_LABELS`（4 渠道中英标签）、`ALL_CHANNELS`、`formatBytes`、`STAGE_LABELS`（8 个阶段中英标签） |

**备注**：
- 封装的 invoke 命令：`launcher_check_status`、`launcher_install_or_update`、`launcher_verify_and_repair`、`launcher_get_process_read_bytes`、`launcher_get_remote_version`、`launcher_get_payload_state`、`launcher_cancel_download`、`launcher_preload_download`、`launcher_install_preload`、`launcher_reset_download_cancel`、`launcher_has_download_cache`、`launcher_get_banners`、`launcher_get_announcements`、`launcher_get_notice_content`、`launcher_get_background_image`、`launcher_start_game`、`launcher_browse_folder`、`launcher_check_executable`、`launcher_check_game_running`、`launcher_kill_game`、`launcher_get_game_playtime`、`launcher_detect_channel`、`launcher_scan_install_dir`、`launcher_get_disk_space`、`launcher_switch_channel`、`launcher_cancel_switch`、`launcher_cancel_all`（共 27 个）。
- 监听的 Tauri 事件：`launcher-progress`、`launcher://progress`、`launcher://switch-progress`（注意前两者命名风格不一致，属两套事件源）。
- 配置键：本文件不读写任何 `configService` 配置键（安装路径、渠道等由调用方传入）。
- 缓存策略：无前端缓存；远程版本/资源的缓存由后端负责。除 `verifyAndRepair` 外所有函数都**不捕获错误**，异常直接上抛给调用方；`verifyAndRepair` 在业务失败时抛出的是字符串 `result.message` 而非 `Error` 对象。

## `src/utils/systemResourceService.ts`
**职责**：系统资源采集命令的封装，以及全局「系统资源卡片」默认值的读写。
**导出**：`SystemResourceService`（静态类）、`SnapshotResult`（interface）、`getSystemResourceDefaults()`、`setSystemResourceDefaults(patch)`，并再导出类型 `SystemSnapshot`。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`@/utils/logger`、`@/utils/configService`（`getConfig`/`setConfig`）、`@/types/system-resource`。

| 符号 | 说明 |
| --- | --- |
| `SystemResourceService.getSnapshot()` | `invoke("get_system_snapshot")`，返回 `{ok:true,data}`；异常转 `{ok:false,error}`（记录 `logWarn`），调用方据此渲染友好提示 |
| `SystemResourceService.safeSnapshot()` | 仅返回数据或 `null`，供历史曲线等非关键路径使用 |
| `getSystemResourceDefaults()` | 读配置键 `system_resource_defaults`，与 `DEFAULT_SYSTEM_RESOURCE_DEFAULTS` 合并；首次读取时按 `system_resource_defaults_version` 做一次性迁移（v2：`showSparklines` 默认改为 `true`）并写回 |
| `setSystemResourceDefaults(patch)` | 读-改-写合并保存 |

**备注**：封装的 invoke 命令：`get_system_snapshot`；配置键：`system_resource_defaults`、`system_resource_defaults_version`（另经 `configService` 间接使用 `get_config`/`set_config`）。

## `src/utils/trayService.ts`
**职责**：托盘悬浮面板数据的唯一组装点——拉 `char_detail` + 账号列表 → 拼 `TrayUserInfo` → `update_tray_user_data` 写入配置键 `tray_user_info` 并触发 `tray-user-info-updated` 广播。抽出来是为了让 `main.tsx`（启动 5 秒后刷新）与 `pages/settings.tsx`（切换托盘显示角色）共用同一份字段映射，避免两处各写一遍漏字段。
**导出**：`TrayUserInfo`（interface）、`refreshTrayUserData(roleId)`、`setTrayUser(roleId)`、`isTrayAvailable()`。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`@/utils/logger`、`@/utils/roleDataService`、`@/utils/accountService`（`getAccounts`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TrayUserInfo`（interface） | :18 | 与后端 `crate::tray::TrayUserInfo`（camelCase，字段均 `Option`）一一对应；`nickname`/`avatar` 允许 `null`；`accountLevel`（:23）= 游戏账号等级，`bpCurLevel`/`bpMaxLevel` = 通行证等级。`components/tray-panel.tsx` 复用该类型，不再各自声明 |
| `TrayQueryResult`（私有 interface） | :39 | `query_role_data` 返回的是**「路径字符串 → 值」的扁平映射**，所以叶子路径写作 `"base.level"` 键（`result["base.level"]`），不是嵌套对象；`dungeon` 的数值是字符串，统一 `Number(...) \|\| 0` 兜底 |
| `refreshTrayUserData(roleId)` | :53 | 查询 `char_detail` 的 `base.level`/`dungeon`/`bpSystem`/`dailyMission`/`weeklyMission` → `getAccounts()` 取昵称头像 → `invoke("update_tray_user_data")`。`accountLevel` 优先取 `base.level`，取不到回退账号列表缓存的 `level`。空 `roleId` 直接返回 `false`；异常仅 `logger.error` 后返回 `false`，不上抛 |
| `setTrayUser(roleId)` | :108 | `invoke("set_tray_user")`（失败忽略）+ `refreshTrayUserData(roleId)`；设置页切换托盘账号用 |
| `isTrayAvailable()` | :125 | `invoke<boolean>("tray_available")` 并缓存结果；查询失败按 `true` 处理（后端 `minimize_to_tray` 自身仍有无托盘兜底）。Linux 无 StatusNotifier 宿主时为 `false`，标题栏、内嵌浏览器与设置页据此禁用「最小化到托盘」 |

**备注**：
- 封装的 invoke 命令：`update_tray_user_data`、`set_tray_user`、`tray_available`；配置键：`tray_user_info`（写入侧），`tray_user_role_id`（由调用方读取后传入）。
- **右上角「等级」徽标显示 `accountLevel`（游戏账号等级），不是 `bpCurLevel`**；通行证等级只在面板的「通行证」`MetricRow` 里显示。改字段时三处需同步：本文件、`crate::tray::TrayUserInfo`、面板组件。




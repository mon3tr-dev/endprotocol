# 前端服务与工具（A 组：账户/配置/角色/启动器）— 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 本文件覆盖 12 个服务封装：account / config / proxy / cardConfig / dashboardConfig / backgroundSettings / roleData / roleDetail / tab / tabIcons / messageStore / launcher / systemResource。

## `src/utils/accountService.ts`
**职责**：封装森空岛/游戏账户相关的全部 Tauri IPC 调用（登录、登出、刷新、扫码、验证码、选中账户、凭证刷新），并定义账户相关的 TS 类型。是前端访问账户后端的唯一入口层。
**导出**：类型 `Account`、`SklandAccount`、`SklandGameScore`、`SklandPendant`、`SklandBackground`、`SklandUserStats`、`SklandGameInfo`、`SklandUserInfo`、`RoleDisplayInfo`、`LoginRequest`、`LoginResult`、`RefreshResult`、`SendCodeRequest`、`CodeLoginRequest`、`ScanLoginInfo`、`ScanStatus`；函数 `getAccounts`、`getSklandAccounts`、`saveSklandAccount`、`getSklandAccountRoles`、`getSklandUserInfo`、`getSklandUserInfoByCred`、`getSklandGames`、`addAccount`、`logoutAccount`、`batchLogout`、`refreshAccounts`、`sendVerificationCode`、`addAccountByCode`、`genScanLogin`、`scanStatus`、`addAccountByScan`、`saveSelectedRoles`、`getSelectedAccount`、`setSelectedAccount`、`checkAndRefreshCred`、`applyApiHealthSnapshot`；别名常量 `refreshAccountData`、`batchLogoutAccounts`。
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

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| accountService.ts:1-211 | 全部接口/类型定义（账户、森空岛资料、登录/扫码/验证码请求与结果；`SklandAccount.phone`、`LoginRequest.expectedUserId`、`CodeLoginRequest.expectedUserId`） |
| accountService.ts:203-536 | 各 IPC 包装函数实现 |

**备注**：
- 封装的 invoke 命令：`get_accounts`、`get_skland_accounts`、`save_skland_account`、`get_skland_account_roles`、`get_skland_user_info`、`get_skland_user_info_by_cred`、`get_skland_games`、`add_account`、`logout_account`、`batch_logout`、`refresh_accounts`、`send_verification_code`、`add_account_by_code`、`gen_scan_login`、`scan_status`、`add_account_by_scan`、`save_selected_roles`、`get_selected_account`、`set_selected_account`、`check_and_refresh_cred`（共 20 个）。
- 配置键：本文件**不直接**读写任何配置键；选中账户由后端命令 `get_selected_account`/`set_selected_account` 管理（对应后端配置键在 Rust 侧，前端未出现字面量）。
- 缓存策略：无前端缓存，每次调用直接 IPC；森空岛游戏列表的缓存由后端负责（`getSklandGames` 的 `force` 参数控制强制刷新）。
- 错误处理不统一：`getSklandUserInfo`、`getSklandGames` 不捕获错误；`saveSelectedRoles`、`checkAndRefreshCred` 记录日志后 rethrow；其余函数均吞掉错误并返回空值/false。
- 账户可用性：`getAccounts`/`refreshAccounts`/三个登录入口在成功时清除不可用状态，失败时标记（详见 `src/utils/accountAvailability.ts`）。

## `src/utils/configService.ts`
**职责**：通用键值配置读写层，封装 Tauri `get_config`/`set_config`/`remove_config`/`get_all_configs`，并在 Tauri 调用失败时自动降级到浏览器 `localStorage`（开发环境兜底）。
**导出**：`getConfig`、`setConfig`、`removeConfig`、`getAllConfigs`。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`@/utils/logger` 的 `logger`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `getConfig<T>` | configService.ts:10 | invoke `get_config`，参数 `{key}`，返回 `T \| null`（`undefined` 归一为 `null`）；启动 Splash 跟踪期间会计入初始任务；失败时 `logger.warn` 并读取 localStorage 的 `config_${key}`（JSON.parse）作兜底 |
| `setConfig` | configService.ts:26 | invoke `set_config`，参数 `{key, value}`，返回 `void`；失败时 `logger.warn` 并写入 localStorage `config_${key}`（JSON.stringify） |
| `removeConfig` | configService.ts:41 | invoke `remove_config`，参数 `{key}`，返回 `boolean`；失败时 `logger.warn`、移除 localStorage 同名键并**固定返回 `true`** |
| `getAllConfigs` | configService.ts:55 | invoke `get_all_configs`，无参，返回 `Record<string, any>`；失败时遍历 localStorage，取所有 `config_` 前缀键、去掉前 7 个字符作为配置键并 JSON.parse 后返回 |

**内部结构**：

| 区间 | 内容 |
| --- | --- |
| configService.ts:9-19 | `getConfig`（主 + localStorage 兜底） |
| configService.ts:26-49 | `setConfig` / `removeConfig` |
| configService.ts:55-74 | `getAllConfigs`（含 localStorage 扫描兜底） |

**备注**：
- 封装的 invoke 命令：`get_config`、`set_config`、`remove_config`、`get_all_configs`（共 4 个）。
- 配置键：键名由调用方传入，本文件不硬编码业务键；localStorage 命名空间为 `config_${key}`，`getAllConfigs` 通过 `key.startsWith('config_')` + `substring(7)` 还原。
- 缓存策略：**无缓存**，每次调用都走 IPC；降级路径与主路径可能不一致（Tauri 失败时读 localStorage，而成功写入只进 Tauri）。

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
**导出**：类型 `GameChannel`、`GameStatus`、`ActiveOperation`、`RemotePackage`、`DownloadProgress`、`BackgroundMedia`、`LauncherResult`、`PayloadState`、`BannerItem`、`AnnouncementItem`、`LauncherNoticeContent`、`FileScanResult`、`DiskSpace`、`GamePlaytime`、`LaunchExportOptions`、`SteamShortcutOptions`、`SteamShortcutDefaults`、`AddSteamShortcutResult`；函数 `checkGameStatus`、`installOrUpdate`、`verifyAndRepair`、`getProcessReadBytes`、`getRemoteVersion`、`getPayloadState`、`cancelDownload`、`preloadDownload`、`installPreload`、`resetDownloadCancel`、`hasDownloadCache`、`getBanners`、`getAnnouncements`、`getNoticeContent`、`getBackgroundImage`、`startGame`、`syncSilentLaunchConfig`、`restoreLaunchConfig`、`getGameLaunchCommand`、`createGameShortcut`、`getSteamShortcutDefaults`、`pickSteamIcon`、`pickSteamIconSource`、`extractSteamIcon`、`addSteamShortcut`、`browseFolder`、`checkExecutable`、`checkGameRunning`、`killGame`、`getGamePlaytime`、`detectChannel`、`scanInstallDir`、`getDiskSpace`、`switchChannel`、`cancelSwitch`、`cancelAll`、`onLauncherProgress`、`onProgress`、`onSwitchProgress`、`formatBytes`；常量 `CHANNEL_LABELS`、`ALL_CHANNELS`、`STAGE_LABELS`、`LAUNCH_TOKEN_KEYS`、`LAUNCH_WARNING_TITLE_KEYS`、`KILL_TOKEN_KEYS`；函数 `splitLaunchToken`（解析 `<token>: <detail>` 契约串）。
**主要依赖**：`@tauri-apps/api/core` 的 `invoke`、`@tauri-apps/api/event` 的 `listen` / 类型 `UnlistenFn`。

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
| `getNoticeContent` | launcherService.ts:196 | invoke `launcher_get_notice_content`，参数 `{channel}`，返回 `LauncherNoticeContent`（横幅+公告合并结构） |
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
| `killGame` | launcherService.ts:456 | invoke `launcher_kill_game`，参数 `{channel}`，返回 `boolean`（`true` = 已结束，`false` = 本来就没有进程）。**失败时 reject**，错误串为 `<token>: <detail>`（token 为 `cancelled` / `kill_failed` / `unknown`，文案见 `KILL_TOKEN_KEYS`（:81））；后端在未提权时会经 UAC 以管理员权限执行 `taskkill`，因此这里可能弹出提权确认 |
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




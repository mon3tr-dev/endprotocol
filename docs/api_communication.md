# API 通信与数据流规范

> 定位具体命令/实现请直接查：[ipc_index.md](reference/ipc_index.md)（114 个命令 ↔ 定义位置 ↔ 前端调用方）、
> [commands.md](reference/backend/commands.md)（每个命令的参数、返回值、内部调用链）。

## 1. 通信机制

前端与后端通过 Tauri 的 IPC (Inter-Process Communication) 进行通信。

- **前端调用**：`import { invoke } from '@tauri-apps/api/core';`
- **前端封装层**：页面/组件不直接散落 `invoke`，而是调用 `src/utils/*Service.ts` 中的封装函数（见 [utils_services_a.md](reference/frontend/utils_services_a.md)、[utils_services_b.md](reference/frontend/utils_services_b.md)）
- **后端响应**：所有 Command 必须返回 `Result<T, AppError>`（`AppError` 见 `src-tauri/src/utils/error.rs`，详见 [utils.md](reference/backend/utils.md)），确保错误能被前端正确捕获
- **状态事件**：后端向前端推送用 `app_handle.emit(...)`，前端用 `listen(...)`；卡片之间用 `window.dispatchEvent(new CustomEvent("cardAction", ...))`（见 [cards_core.md](reference/frontend/cards_core.md)）

## 2. 命名规范

- **Command 命名**：采用 `snake_case`，并以动词开头（如 `get_accounts`、`add_account`、`sync_gacha_records`）。
- **注册位置**：所有命令必须在 `src-tauri/src/lib.rs` 的 `generate_handler!` 中注册（当前 99 个，完整清单见 [bootstrap.md](reference/backend/bootstrap.md)）。

### 2.1 模块划分（`src-tauri/src/commands/`）

| 文件 | 职责 | 详情 |
| --- | --- | --- |
| `account.rs` | 账户登录（密码/验证码/扫码）、登出、刷新、选中账户、角色数据查询 | [commands.md](reference/backend/commands.md) |
| `attendance.rs` | 查询/执行每日签到 | 同上 |
| `card_config.rs` | 卡片配置读写（`card_settings.{cardId}`） | 同上、[card_configuration.md](card_configuration.md) |
| `config.rs` | 通用键值配置 `get/set/remove/get_all` | 同上 |
| `gacha.rs` | 抽卡记录同步、统计、头像映射 | 同上 |
| `launcher.rs` | 启动器：安装/校验/下载/切服/进程管理 | 同上 |
| `updater.rs` | 应用自更新（下载、写文件、执行安装器） | 同上 |
| `image.rs` | 图片读取、缓存目录、下载、背景图管理 | 同上 |
| `tray.rs` | 托盘用户数据与托盘面板显隐 | 同上 |
| `window.rs` | 窗口最小化、最大化、关闭、托盘化 | 同上 |
| `capture.rs` / `color_picker.rs` | 网络抓包会话、屏幕取色 | 同上 |
| `logs.rs` | 读取后端日志（开发者页） | 同上 |

## 3. 数据流说明

### 3.1 账户登录流程

命令：`add_account`（手机号+密码）、`add_account_by_code`（验证码）、`add_account_by_scan`（扫码）；验证码下发用 `send_verification_code`，扫码轮询用 `gen_scan_login` + `scan_status`。

1. **前端**：`src/pages/account.tsx` 收集手机号/密码 → 调用 `src/utils/accountService.ts` 的 `addAccount` / `addAccountByCode` / `addAccountByScan`。
2. **后端**：`commands/account.rs` 转发到 `AccountService`（`services/account_service.rs`）：
   - 生成设备标识（`dId`，逻辑在 `services/skland_service.rs` 的 `fetch_new_did`，见 [services_skland.md](reference/backend/services_skland.md)）
   - 发送验证码 → 提交登录请求 → 获取 `token` 与 `cred`
   - 写入内存状态（`AccountService`）并按 `account_token_{user_id}` 持久化到配置
3. **持久化**：登录成功后由配置服务 `ConfigService` 写入本地 `app_config.json`（机密字段实际进 OS 凭据库）；选中账户存在键 `selected_account_id`。

> **绑定不再要求新设备验证**：扫码/验证码/密码任何方式都能完成绑定，缺 `device_token` 也会照样保存 cred/token/hytoken，只是该账号暂时无法获取抽卡令牌。唯一例外是密码接口自身拒绝新设备（此时尚未拿到 hytoken），前端引导改用验证码或扫码。

### 3.1.1 抽卡令牌（u8token）：不落盘，每次现换

u8token 不参与森空岛签名，只用于 webview 抽卡接口（终末地 `ef-webview` / 明日方舟 `ak-webview`），并且**生命周期很短**，因此不做任何持久化。

**获取链**（鹰角通行证侧，一条 hytoken 覆盖该通行证下所有已绑定渠道）：

```
hytoken
  └─(A1) POST https://as.hypergryph.com/user/oauth2/v2/grant
           body { type:1, appCode:"be36d44aa36bfb5b", token }        → data.token（L2）
       └─(A2) POST https://binding-api-account-prod.hypergryph.com
                  /account/binding/v1/u8_token_by_uid
                  body { uid:<渠道绑定 uid>, token:L2 }               → data.token（u8token）
```

> **两个游戏用的是同一把钥匙，但开的不是同一扇门。** A1/A2 完全一样（同一域名、同一 appCode、同一份 hytoken），
> 差异只在 A2 的 `uid`；拿到 u8token **之后**才分道扬镳 —— 见 §3.1.2。

**官服与 B 服走的是同一条链**：同域名、同 appCode、同一份 hytoken，唯一差异是 A2 里的 `uid`。换出的两把 token 值不同、互不通用 —— 所以「一个账号存一把 token」不可能同时覆盖两个渠道。前提是该通行证绑定了对应渠道（未绑定时 `binding_list` 不返回那条记录）。

**授权 = 一个开关**：

1. 绑定角色后，账户页弹窗进入「授权抽卡数据」步骤，也可直接跳过。
2. 点授权 → `authorize_role_u8token` → 后端用该角色的 `bindingUid` **现换一次令牌做校验**（令牌用完即弃）→ 成功则把 `roles[].u8Authorized = true` 落盘。
3. `revoke_role_u8token` 只清掉这个开关 —— 没有任何凭据需要删除。
4. 抽卡同步（`sync_gacha_records` 等）前检查开关，再 `fetch_role_u8token` 现换令牌；未授权角色直接报错提示去账号页授权。

> **u8token 的作用域是渠道绑定 uid，不是游戏。** 同一把 `uid=45235032` 换出的 token
> 打明日方舟接口正常、打终末地接口被拒（`40100 Token is invalid`）；反过来终末地 token
> 打明日方舟接口拿到的是 `code=0` + **空列表**。因此「这是不是 u8token」不能靠长度或前缀判断
> —— 抓包值 404 字符 / 302 字节，现换值 176~184 字符，**两者能读同一份数据**（已逐条比对 210 条记录完全一致）。
>
> ⚠️ `be36d44aa36bfb5b` 是鹰角前端硬编码的 appCode，存在轮换风险；失效时 A1 会报 `Gacha OAuth grant failed`。

### 3.1.2 抽卡记录接口：终末地与明日方舟是两套 API

两者**只有 u8token 鉴权是共用的**，其余全部不同。命令层是唯一分流点：
`commands/gacha.rs::lookup_role_owner` 读 `roles[].app` 得到 `RoleOwner.game`，
每个命令据此决定走哪条链路（详见 [services_others.md](reference/backend/services_others.md)）。

| | 终末地（`GachaService`） | 明日方舟（`ArknightsGachaService`） |
| --- | --- | --- |
| 域名 | `ef-webview.hypergryph.com` | `ak-webview.hypergryph.com` |
| token 参数名 | `token` | **`code`** |
| 卡池枚举 | `GET /api/record/char/meta` → `tabs[]` | `GET /api/gacha/cate` → 分类 `[{id,name,active?}]` |
| 记录接口 | `GET /api/record/char` | `GET /api/gacha/history` |
| 卡池定位 | `pool_type` + `pool_id`（joint 类） | **`category`**（分类 id，**不是** poolId） |
| 翻页游标 | `seq_id`（上一页末条，单值） | **`gachaTs` + `pos`（复合游标）** |
| `server_id` | 必填恒 `"1"` | **不传**（渠道由 uid 决定） |
| 稀有度 | 就是星数（`6` = 六星） | **星数减一**（`5` = 六星，入库时 +1 归一化） |
| 无效 token | `code=40100 Token is invalid` | **`code=0` + 空列表（静默失败）** |
| 记录有效期 | 全量 | **仅 90 天** |
| 武器寻访 / 赠送十连 | 有 | **都没有** |

要点：

1. **明日方舟的失败是静默的**。它对任何无效 token 都返回 `{"code":0,"data":[]}` —— 既不是 4xx 也不改 `code`。
   `ArknightsGachaService::get_categories` **必须**把空数组转成 `AuthError`，否则用户会看到「同步成功，0 条记录」。
2. **`seqId` 是后端合成的**。明日方舟接口没有 seqId，用 `{poolId}|{gachaTs}|{pos}` 构造稳定唯一键
   （已验证 210 条真实记录里无重复，跨分类也无重复）；`rarity +1` 后与终末地形状一致，
   因此**前端统计、图表、筛选完全不需要区分游戏**。
3. **本地存档分文件规则不同**。终末地 `gacha_records_{userId}_{serverId}.json`；明日方舟
   `arknights_gacha_records_{uid}.json`（**只按 uid**）—— 官服明日方舟角色与终末地角色
   `serverId` 都是 `1`，若沿用同一命名会互相覆盖。
4. **头像来源不同**。终末地要查 `wiki_catalog` 补图并缓存进 `gacha_avatar_map.json`；明日方舟
   按固定 CDN 规则直拼 `web.hycdn.cn/arknights/game/assets/char/avatar/{charId}.png`，
   不联网、不读终末地的目录（那里没有明日方舟干员）。

> 前端调用方、返回值与失败兜底策略见 [utils_services_a.md](reference/frontend/utils_services_a.md#srcutilsaccountservicets)。

### 3.2 角色数据懒加载流程
统一命令：**`query_role_data`**（参数 `role_id` / `api_name` / `paths`，由 `AccountService::query_role_data` 落到 `CharDetailService` 等服务）。

1. **前端**：`src/utils/roleDataService.ts`（带模块级 Promise 缓存）与 `src/utils/roleDetailService.ts`（无缓存，直接 IPC）调用 `invoke('query_role_data', ...)`。
2. **懒加载开关**：`set_lazy_load_enabled` / `is_lazy_load_enabled` / `set_current_role_id` 控制是否只拉取当前角色。
3. **后端**：`AccountService` 检查内存缓存 → 未命中则经 `SklandService::call_skland_api` 请求森空岛 → 解析为 `models/char_detail.rs` 中的结构体 → 写入内存并同步本地缓存。
4. **数据返回**：返回 `serde_json::Value`，前端更新 UI 并缓存。

> 详见 [utils_services_a.md](reference/frontend/utils_services_a.md)、[services_account.md](reference/backend/services_account.md)。

### 3.2.1 《明日方舟》数据流程（与终末地平行、完全独立）

终末地与明日方舟**共用同一个森空岛账户和同一套凭据**，但数据链路完全不同：

| | 终末地 | 明日方舟 |
| --- | --- | --- |
| 寻址 | `roleId + serverId + userId` | **渠道绑定 uid**（`roles[].bindingUid`） |
| 端点 | `/api/v1/game/endfield/card/detail` | `/api/v1/game/player/info`、`/cultivate/player`、`/attendance` |
| 粒度 | 一次一个角色 | 一次整个账号（干员+基建+任务+剿灭+保全+公招） |
| 额外头 | `sk-game-role: 3_{roleId}_{serverId}` | 无（签到把 `gameId`+`uid` 放 body） |
| 入口命令 | `query_role_data` | `get_arknights_player_info` 等 4 个 |

链路（**不需要任何新登录流程**，现成的 hytoken/cred/token 就够）：

```
account_token_{userId}.{cred, token, hytoken}
        ↓  AccountService::arknights_credentials（按需走 check_and_refresh_user_cred）
roles[].bindingUid  ────────→  uid
        ↓
ArknightsService::fetch_player_info   GET /api/v1/game/player/info?uid=
ArknightsService::fetch_cultivate     GET /api/v1/game/cultivate/player?uid=
ArknightsService::attendance_status   GET /api/v1/game/attendance?uid=
ArknightsService::do_attendance       POST /api/v1/game/attendance {gameId:1, uid}
        ↓  解析为 models/arknights.rs 结构体
        ↓  头像转 base64 + 写内存 + 写文件
<app_data>/arknights/player_info_{uid}.json         （解析后的完整数据）
<app_data>/arknights/raw_{kind}_{uid}.json          （原始响应留档）
```

**为什么缓存独立成文件**：单账号 `player/info` 实测几百 KB（B 服 242 名干员约 600 KB），
放进 `app_config.json` 会让每次配置读写都搬运它。这与抽卡记录（`gacha_records/`）是同一套做法。

**绑定账户时就开始拉**：`AccountService::fetch_game_roles` 在绑定明日方舟角色时会调一次
`refresh_player_info` —— 因为**明日方舟的头像只能从 `player/info` 的 `status.avatar` 拿到**
（终末地的 `base.avatarUrl` 对它无效），同时把解析结果落盘，供后续展示直接读取。

> ⚠️ 三个真实结构陷阱（已在 `models/arknights.rs` 兜住）：
> ① `building.hire` / `building.training` 可能是 `null`（未建办公室 / 无进行中专精）；
> ② 基建设施**对象与数组混用**（`control`/`meeting` 是对象，`powers`/`tradings` 是数组）；
> ③ `training.speed` / `training.remainPoint` / 设施 `speed` 可能是**浮点**
>   （B 服实测 `1.35` / `0.45`，官服恰好整数）。**用整型会让整个 `player/info` 解析失败**，
>   而接口仍返回 `code=0` —— 表现为「等级 0、没有头像」，最难查。
>
> ⚠️ **绑定接口的角色层级差异（最容易踩的坑）**：`/api/v1/game/player/binding` 里
> **终末地的角色在 `bindingList[].roles[]`，而明日方舟的 `roles` 是空数组** —— 角色信息
> 直接躺在 `bindingList` 这一层（`uid` / `nickName` / `channelMasterId`）。只遍历 `roles`
> 会**完全漏掉明日方舟角色**，前端表现为「添加账户后只能找到终末地的角色」。
> 明日方舟没有 roleId，`SklandService::extract_game_roles` 用 **uid 当角色标识**
> （已用真实账号验证 `player/info.status.uid == 绑定 uid`）。
>
> 详见 [services_others.md](reference/backend/services_others.md)（`arknights_service.rs`）、
> [models.md](reference/backend/models.md)（`arknights.rs`）、[commands.md](reference/backend/commands.md)（`commands/arknights.rs`）。

### 3.3 仪表板配置同步（多标签页）

当前实现**没有独立的 `save_dashboard_config` 命令**，仪表板数据走通用配置键：

1. **前端**：拖拽/增删卡片后调用 `src/utils/dashboardConfig.ts` 的 `addCard` / `removeCard` / `moveCard` / `updateCardLayout`。
2. **落盘**：`src/utils/tabService.ts` 的 `saveTabs` → `set_config`（配置键 `dashboard_tabs`、`dashboard_active_tab`）→ 后端 `ConfigService` 写 `app_config.json`。
3. **卡片内部设置**：单独走 `save_card_settings`（键 `card_settings.{cardId}`），见 [card_configuration.md](card_configuration.md)。

> 页面入口 `src/pages/dashboard.tsx:422` 通过 `CardContainer` 渲染，详见 [pages_core.md](reference/frontend/pages_core.md)、[cards_core.md](reference/frontend/cards_core.md)。

### 3.4 森空岛账户资料获取

账号管理页展示森空岛账户昵称、头像与游戏等级，数据来自用户资料接口。

- **接口**：`GET https://zonai.skland.com/web/v1/user`
- **查询参数 / 请求体**：无
- **请求头**：`cred`、`timestamp`、`sign`、`vName`、`dId`、`platform` 等由 `SklandService::call_skland_api`（`services/skland_service.rs:505`）统一注入
  （签名算法见 `calculate_sign`（同文件 `:422`）：`HMAC-SHA256(token, path + body + timestamp + header_json)` 后取 MD5）
- **返回体**：`data.user` 为资料主体（昵称、头像、`scoreInfoList` 游戏等级/积分），
  `data.userRts` 为社区互动数据，`data.pendant` / `data.background` 为挂件与主页背景
- **游戏图标**：`GET https://zonai.skland.com/web/v1/game` 的 `data.list[].game`
  （`gameId` / `name` / `iconUrl`）与 `scoreInfoList` 按 `gameId` 关联；
  该接口与账户无关，结果缓存在配置项 `skland_games_cache`（12 小时有效期，刷新失败时退回旧缓存）

流程：

1. **前端**：账户列表加载后，对缺少昵称/头像缓存的账户补齐资料；打开资料 Modal 时按需拉取资料与游戏列表；点击「刷新数据」时强制刷新两者。
2. **后端**：`AccountService::get_skland_user_info` 先检查并按需刷新 `cred`（`check_and_refresh_user_cred`），再通过 `SklandService::get_user_info`（`:630`）请求接口并解析为 `SklandUserInfo`；游戏列表由 `SklandService::get_game_list`（`:687`）解析为 `Vec<SklandGameInfo>`。
3. **缓存**：用户资料写入配置项 `account_token_{user_id}.user_info`，`get_skland_accounts` 会带出其中的昵称与头像，避免每次进入页面都重新请求。
4. **展示**：前端将昵称/头像渲染在森空岛账户行；资料 Modal 中头像外叠加挂件（头像框），游戏等级卡片使用游戏图标，`level` 为 0 的游戏不展示。

> 结构体定义见 [models.md](reference/backend/models.md)；相关命令 `get_skland_user_info` / `get_skland_games` 见 [ipc_index.md](reference/ipc_index.md)。

## 4. 错误处理规范

- **统一错误类型**：后端使用 `src-tauri/src/utils/error.rs` 的 `AppError`（变体清单见 [utils.md](reference/backend/utils.md)）；部分老命令仍返回 `Result<T, String>`。
- **前端反馈**：捕获错误后，通过 UI 组件（如 Toast 或 Modal）向用户展示友好的错误提示；多数 `src/utils/*Service.ts` 封装会吞掉异常并返回空值/`false`（各自的兜底策略见对应 reference 文档）。
- **日志追踪**：后端用 `tracing`/`log_*` 宏（`src-tauri/src/utils/logger.rs`），前端用 `src/utils/logger.ts`（禁止裸 `console.log`）。

## 5. 安全性要求

- **敏感数据**：严禁在日志中打印明文密码或完整的 Token。
- **输入校验**：后端必须对所有传入参数进行合法性校验。
- **权限控制**：涉及系统级操作（如文件读写）需在 `tauri.conf.json` 和 `capabilities/` 中严格限制（现状见 [bootstrap.md](reference/backend/bootstrap.md)）。

## 6. 相关 reference 文档

| 想查 | 打开 |
| --- | --- |
| 命令在哪定义、前端谁调用 | [reference/ipc_index.md](reference/ipc_index.md) |
| 命令参数/返回值/调用链 | [reference/backend/commands.md](reference/backend/commands.md) |
| 登录与角色数据的后端实现 | [reference/backend/services_account.md](reference/backend/services_account.md) |
| 森空岛 HTTP 端点与签名 | [reference/backend/services_skland.md](reference/backend/services_skland.md) |
| 前端服务封装层 | [reference/frontend/utils_services_a.md](reference/frontend/utils_services_a.md) |

# SklandService（森空岛 API 客户端）— 功能参考

> 逐行精读源码生成。行号基于当前工作区版本，仅用于快速定位。

**源文件**：`src-tauri/src/services/skland_service.rs`（1397 行）

**文件职责**：封装森空岛（zonai.skland.com）与 Hypergryph 账号体系的全部 HTTP 调用，包括设备指纹 dId 申请、HMAC+MD5 签名、cred/token 换取与刷新，以及用户资料、游戏列表、角色绑定、角色详情等业务数据的拉取与解析。

**状态注册方式**：不直接 `app.manage`。在 `src-tauri/src/lib.rs:182` 用 `Arc::new(SklandService::new(config_service.clone()))` 构造，随后注入 `NetworkService`（lib.rs:193-196）与 `AccountService`（lib.rs:199-205，后者再被 `app.manage` 为 `Arc<Mutex<AccountService>>`，lib.rs:208）；`NetworkService::new` 又把它传给 `CharDetailService`（network_service.rs:25）与 `CharWikiDetailService`（network_service.rs:26）。命令层通过 `AccountService::skland_service()`（account_service.rs:343）间接取得。

**主要依赖**：`aes` / `des` / `rsa` / `hmac`+`sha2` / `md5` / `base64` / `flate2`（gzip）/ `uuid` / `chrono` / `serde_json` / `reqwest`；crate 内的 `crate::utils::{capture, http_client, AppError}`、`crate::services::config_service::ConfigService`、`crate::models::{account, char_detail, role}` 以及 `log_debug!/info!/warn!/error!` 宏。

## 内部结构总览

| 区间 | 内容 |
| --- | --- |
| 1-17 | 密码学与工具 import、`type HmacSha256 = Hmac<Sha256>` |
| 24-25 | 常量 `ORG = "UWXspnCCJN4sfYlNfqps"`、`PUB_KEY_DER`（数美接口 RSA 公钥） |
| 28-36 | `pub struct SklandService { config_service: Arc<Mutex<ConfigService>> }` 与 `new` |
| 38-70 | dId 缓存读写：`get_or_refresh_did` |
| 72-98 | `fetch_new_did`：熔断检查 + 数美失败按 `api_health::ApiFailureKind::DeviceFingerprint` 计数 |
| 100-409 | `fetch_new_did_inner`：1:1 复刻 Python 的数美设备指纹申请（RSA → DES 混淆 → gzip → AES-CBC → POST） |
| 396-424 | `calculate_sign`：森空岛签名算法 |
| 426-477 | `build_skland_request`：统一请求头注入 |
| 479-601 | `call_skland_api`：统一 API 调用入口（2 次重试 + code 校验） |
| 603-658 | `get_user_info` + `parse_user_info_response`（`/web/v1/user`） |
| 660-692 | `get_game_list` + `parse_game_list_response`（`/web/v1/game`） |
| 694-713 | `get_player_binding`（`/api/v1/game/player/binding`） |
| 715-742 | `get_role_detail`（`/api/v1/game/endfield/card/detail`） |
| 744-786 | `check_cred`（`/api/v1/user/check`，仅带 cred 头） |
| 788-908 | `refresh_cred_by_hytoken`（grant → generate_cred_by_code；**不再顺带取 u8token**） |
| 980-1120 | 抽卡令牌新链路：`get_u8_token_by_uid`、`u8_oauth_token`、`u8_token_by_uid` |
| 1150-1210 | 私有 `oauth_grant_to_sk_code`（换 skland cred 用，appCode `4ca99fa6b56cc2ba` / type 0） |
| 1219-1301 | `extract_game_roles`（纯数据提取，返回含渠道 uid + 游戏标识的 `GameRoleBinding` 列表；两个游戏的角色在不同层级，见方法表） |
| 1240-1270 | 自由函数 `des_encrypt_3des`（单 DES ECB + Zero Padding + Base64） |
| 1270-1470 | `mod tests`：dId 格式测试、用户资料/游戏列表解析测试（内嵌抓包样本 JSON） |

## 方法清单（必须完整）

| 方法 | 位置 | 说明（输入 → 端点 → 处理 → 输出） |
| --- | --- | --- |
| `new(config_service)` pub | 33-36 | 持有 `Arc<Mutex<ConfigService>>` → 无网络 → 构造自身 |
| `get_or_refresh_did(&self)` 私有 async | 38-70 | 读配置键 `did_cache` → 命中直接返回；未命中 → `fetch_new_did` → 写回 `did_cache` → `Ok(String)` |
| `fetch_new_did(&self)` 私有 async | 72-98 | 先 `api_health::ensure_available()`；调用 `fetch_new_did_inner`，失败时按 `ApiFailureKind::DeviceFingerprint` 记一次失败（阈值 3），达到后熔断并通知前端「重启电脑 + 同步时区」 |
| `fetch_new_did_inner(&self)` 私有 async | 100-409 | 无入参 → `POST https://fp-it.portal101.cn/deviceprofile/v4`（payload 316-324）→ 构造指纹 JSON、DES 混淆、gzip、AES-128-CBC → 从 `detail/data/顶层` 的 `deviceId|device_id` 取值 → `Ok("B"+deviceId)` |
| `calculate_sign(&self, path, body, ts, did, token)` 私有 | 396-424 | 5 个字符串 → 无网络 → header JSON + HMAC-SHA256 + MD5 → 32 位小写 hex |
| `build_skland_request(&self, client, method, url, cred, did, sign, ts)` 私有 | 426-457 | GET/POST 分支（436-440）→ 注入 11 个请求头（442-456）→ `reqwest::RequestBuilder` |
| `call_skland_api(&self, method, path, query, body, cred, token, extra_headers)` pub async | `call_skland_api` | 通用入口；**每轮先 `api_health::ensure_available()` 熔断检查**（若已有具体错误则优先返回那条错误）；最多 3 轮：第 0 轮用缓存 dId + 原 cred，之后**只在签名/时钟类失败时** `rotate_did()`（并把新 dId **写回 `did_cache`**），会话失效时换新 cred 后重试 → `https://zonai.skland.com{path}[?query]` → 从响应头 `Date` 计算本地时钟偏差 → 签名/发包/解析，`code==0` 才返回并 `record_success`；`is_benign_business_error`（如 `code=10001, message=请勿重复签到！`）命中时同样 `record_success` 并原样返回 `Ok(json)`（不重试）；**`is_session_invalid` 命中时经 `cred_recovery::refresh_for_cred` 就地换 cred 并重试一次**（成功后 `clear_after_repair` 解除熔断）；其余业务码分类 `record_failure` 后累计 `last_err` 返回（会话失效的错误带 `SESSION_INVALID` 标记） |
| `rotate_did(&self)` 私有 async | `rotate_did` | 清 `did_cache` → `fetch_new_did` → **写回 `did_cache`** → `Ok(String)`。旧实现只换本次请求的 dId 不写回，导致一次 401 之后每次请求都要重新申请指纹、dId 永不稳定 |
| `get_user_info(&self, cred, token)` pub async | 603-623 | cred+token → `GET /web/v1/user` → `parse_user_info_response` → `SklandUserInfo` |
| `parse_user_info_response(json)` pub | 625-658 | 响应 JSON → 无网络 → `data.user` 反序列化为 `SklandUserInfo`（634-637），`userRts`→`stats`、`background` 解析失败非致命（640-645），顶层 `pendant` 覆盖 `user.pendant`（647-652）→ `SklandUserInfo` |
| `get_game_list(&self, cred, token)` pub async | 660-673 | cred+token → `GET /web/v1/game` → `parse_game_list_response` → `Vec<SklandGameInfo>` |
| `parse_game_list_response(json)` pub | 675-692 | 响应 JSON → 无网络 → 取 `data.list[]`，逐项取 `game` 并反序列化（过滤失败项）→ `Vec<SklandGameInfo>`；缺 `data.list` 报错 |
| `get_player_binding(&self, cred, token)` pub async | 694-713 | cred+token → `GET /api/v1/game/player/binding` → 整体反序列化为 `BindingResponse`（704-707）→ `response.data.list: Vec<GameBinding>` |
| `get_role_detail(&self, cred, token, role_id, server_id, user_id)` pub async | 715-742 | 3 个 id → `GET /api/v1/game/endfield/card/detail?roleId=&serverId=&userId=`（723-727）→ 反序列化 `CharDetailResponse`（731-734）→ `CharDetailResponse` |
| `check_cred(&self, cred)` pub async | `check_cred` | cred → `GET https://zonai.skland.com/api/v1/user/check`（仅 cred + Content-Type，无 sign）→ `code==0` 判定 → `bool`。**不调 `ensure_available()`**：它是身份探针，熔断往往正是它要诊断的对象。⚠️ 返回 `true` 仅代表「cred 还能通过身份校验」，**不代表数据接口可用** |
| `refresh_cred_by_hytoken(&self, hytoken, device_token)` pub async | `refresh_cred_by_hytoken` | hytoken(+device_token) → ①`oauth_grant_to_sk_code` ②`POST generate_cred_by_code`，payload `{kind:1, code}`，校验 `code==0`，取 `cred`/`token`/`userId` → `(cred, token, user_id)` 三元组。**u8 分支（原 Step 1.5）已移除**：换 cred 不再顺带取 u8token。**不调 `ensure_available()`** —— 这条链路是熔断的解药（只依赖 hytoken），拦它会把恢复链锁死 |
| `get_u8_token_by_uid(&self, hytoken, binding_uid)` pub async | 980-1000 | hytoken + 渠道绑定 uid → `u8_oauth_token` + `u8_token_by_uid` 两步 → `String`。**不需要 device token，也没有渠道参数** |
| `u8_oauth_token(&self, hytoken)` pub async | 1002-1060 | `POST https://as.hypergryph.com/user/oauth2/v2/grant`，payload `{type:1, appCode:"be36d44aa36bfb5b", token}`，取 `data.token`（L2） |
| `u8_token_by_uid(&self, oauth_token, binding_uid)` pub async | 1062-1120 | `POST https://binding-api-account-prod.hypergryph.com/account/binding/v1/u8_token_by_uid`，payload `{uid, token:L2}`，取 `data.token`（u8 token） |
| `u8_grant_to_sk_code(&self, hytoken, device_token)` 私有 async | **已删除** | 旧链路（`dd7b852d5f1dd9da` + deviceToken → channel code）随 `get_u8_token_by_channel` 一并移除 |
| `oauth_grant_to_sk_code(&self, hytoken)` 私有 async | 1150-1210 | hytoken → 同一 grant 端点，payload `{token, appCode:"4ca99fa6b56cc2ba", type:0}` → `data.code`（换 skland cred 用） |
| `extract_game_roles(bindings)` pub（无 `self`） | 1219-1301 | `&[GameBinding]` → 无网络 → 只保留 `app_code` 为 `endfield` / `arknights` 的游戏（其余应用跳过并 debug 日志），跳过 `is_delete` 的渠道绑定 → `Vec<GameRoleBinding>`（含 `game` / `binding_uid` / `channel_master_id` / `channel_name` / `server_id` / `server_name` / `role_id` / `nickname` / `level`）。<br>⚠️ **两个游戏的角色在不同层级**：终末地在 `bindingList[].roles[]`（走通用分支，`role_id` 取 `roles[].roleId`）；**明日方舟的 `roles` 是空数组**，角色在 `bindingList` 这一层 —— `uid` 即角色标识（`roleId = uid`）、`nickName` 是昵称、`channelMasterId` 当 `server_id`（1=官服 2=B服）、`level` 给 0 由 `player/info` 补。<br>**只遍历 `roles` 会完全漏掉明日方舟角色**（前端表现为「找不到可绑定的明日方舟角色」） |
| `des_encrypt_3des(key, data)` 自由函数 | 1240-1270 | 8 字节 Zero Padding → 单 DES 加密每个 8 字节块 → Base64 字符串 |

合计：impl 内 20 个方法（pub 13）+ 1 个自由加密函数 = 21 个可调用项；另有 5 个测试函数（1201、1312、1342、1382、1399）与 2 个测试常量（1221、1348）。

## API 端点总表（重点）

| 方法/路径 | 用途 | 调用的方法 | 位置 |
| --- | --- | --- | --- |
| `POST https://fp-it.portal101.cn/deviceprofile/v4` | 数美设备指纹，换取 dId | `fetch_new_did_inner` | 332（payload 317-325，日志 328） |
| `ANY https://zonai.skland.com{path}[?query]` | 所有签名业务 API 的统一出口 | `call_skland_api` | 525-529 |
| `GET /web/v1/user` | 用户资料（昵称、头像、积分、挂件、背景、社区数据） | `get_user_info` | 606 |
| `GET /web/v1/game` | 森空岛游戏列表（图标等） | `get_game_list` | 667 |
| `GET /api/v1/game/player/binding` | 账号绑定的角色列表 | `get_player_binding` | 699 |
| `GET /api/v1/game/endfield/card/detail?roleId=&serverId=&userId=` | 终末地角色详情 | `get_role_detail` | 723-727 |
| `GET /api/v1/game/player/info?uid=` | **《明日方舟》玩家全量数据**（干员养成/基建/任务/剿灭/保全/公招/头像） | 不经本文件，见 `services/arknights_service.rs::fetch_player_info` | — |
| `GET /api/v1/game/cultivate/player?uid=` | **《明日方舟》养成 + 仓库** | 同上（`fetch_cultivate`） | — |
| `GET /api/v1/game/attendance?uid=` | **《明日方舟》签到状态** | 同上（`attendance_status`） | — |
| `POST /api/v1/game/attendance`（body `{gameId:1, uid}`） | **《明日方舟》执行签到** | 同上（`do_attendance`） | — |
| `GET https://zonai.skland.com/api/v1/user/check` | 校验 cred 是否有效 | `check_cred` | 756 |
| `POST https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code` | sk_code → cred / token / userId | `refresh_cred_by_hytoken` | 843（payload 833-836） |
| `POST https://binding-api-account-prod.hypergryph.com/account/binding/v1/u8_token_by_uid` | L2 + 渠道 uid → u8token | `u8_token_by_uid` | 约 1075（payload `{uid, token}`） |
| `POST https://as.hypergryph.com/user/oauth2/v2/grant` | hytoken → code（skland 场景 appCode=`4ca99fa6b56cc2ba`） | `oauth_grant_to_sk_code` | 1097（payload 1086-1090） |
| `POST https://as.hypergryph.com/user/oauth2/v2/grant` | hytoken → 抽卡域 L2（appCode=`be36d44aa36bfb5b`, type=1） | `u8_oauth_token` | 约 1013（payload `{type:1, appCode, token}`） |

非端点 URL（仅作数据）：`https://www.skland.com/` 为指纹 target 的 `url` 字段（143）；`https://game.skland.com` 为 Origin/Referer 头（450-451）；测试样本中的 bbs.hycdn.cn 图片（1215-1389）。

> **明日方舟的四个端点为什么不在本文件**：它们的寻址方式与终末地完全不同（用**渠道绑定 uid**、不发 `sk-game-role` 头、签到把 `gameId`+`uid` 放 body），因此单独落在 `services/arknights_service.rs`。两者共用同一个 `call_skland_api`（签名/dId/重试/熔断），**共用同一套 HTTP 栈，但数据模型与服务完全分开**。
>
> **响应是明文**：`/api/v1/game/player/*` 不做响应加密。本文件的 AES/3DES 代码只用于**生成 dId**（数美指纹请求体加密）。这一点已用真实账号在 `tests/arknights_live.rs` 中验证（三个接口 `code=0` 且字段可直接读取）。

## 签名与加密流程

### 1. `calculate_sign`（396-424）

```
输入: path, body_or_query, ts(秒级时间戳字符串), did, token
# L398-401 固定键序构造 header JSON（紧凑格式，无空格）
h_ca = '{"platform":"1","timestamp":"' + ts + '","dId":"' + did + '","vName":"1.45.1"}'
# L404 拼接顺序: path → body → ts → h_ca
raw  = path + body_or_query + ts + h_ca
# L411-413 HMAC-SHA256，key = token 的 UTF-8 字节，输出 hex 小写
hmac_hex = hex( HMAC_SHA256(key = token, msg = raw) )
# L418-419 对上一步的 hex "文本" 的 ASCII 字节再做 MD5
sign = md5_hex( hmac_hex.as_bytes() )      # 32 位小写 hex
返回 sign
```

`body_or_query` 取值见 `call_skland_api`：`sign_input = query.unwrap_or(&body_str)`（522）——GET 用 query string，POST 用 JSON body 字符串；无 query/body 时为空串。

### 2. 请求头注入清单（`build_skland_request`，442-456）

| Header | 值 | 行号 |
| --- | --- | --- |
| `cred` | 调用方 cred | 443 |
| `dId` | 设备指纹（`B...`） | 444 |
| `sign` | `calculate_sign` 结果 | 445 |
| `timestamp` | 秒级时间戳字符串（520 生成） | 446 |
| `platform` | 固定 `"1"` | 447 |
| `vName` | 固定 `"1.45.1"`（须与签名内一致） | 448 |
| `Content-Type` | `application/json` | 449 |
| `Origin` | `https://game.skland.com` | 450 |
| `Referer` | `https://game.skland.com/` | 451 |
| `X-Requested-With` | `com.hypergryph.skland` | 452-452 |
| `User-Agent` | Android SKLand/1.54.0 长串 | 453-456 |

`call_skland_api` 额外追加：JSON body（535-537）、`extra_headers`（538-540，如签到用的 `sk-game-role`、`token`）。

### 3. token / cred 的分工

- **cred**：身份凭证，放 `cred` 头；`check_cred` 仅凭它即可校验有效性；`refresh_cred_by_hytoken` 返回的第一个值。
- **token**：仅作签名 HMAC 的密钥（411），不直接出现在头里；`refresh_cred_by_hytoken` 返回的第二个值。签到场景会额外把它作为 `token` 头透传（attendance.rs:96、222）。
- **dId**：设备指纹，参与 header JSON 与签名；缓存在配置键 `did_cache`，失败时清缓存重取（约 503-510）。
- **hytoken**：Hypergryph 账号 token，只能通过 grant 换 code，再换 cred/token，本身不用于签名。
- **u8token**：抽卡接口（`ef-webview.hypergryph.com`）的令牌，**不参与森空岛签名**，也**不落盘**（每次同步现换）。
  获取链（一条 hytoken 可为通行证下每个已绑定渠道 uid 各换一把）：

  ```
  hytoken
    └─(A1) POST https://as.hypergryph.com/user/oauth2/v2/grant
             body {type:1, appCode:"be36d44aa36bfb5b", token}      → data.token = L2
         └─(A2) POST https://binding-api-account-prod.hypergryph.com
                    /account/binding/v1/u8_token_by_uid
                    body {uid:<渠道绑定 uid>, token:L2}            → data.token = u8token
  ```

  - **官服与 B 服走完全相同的一条链**：同域名、同 appCode、同一份 hytoken，
    唯一差异是 A2 里的 `uid`（官服 uid / B 服 uid）。换出的两把 token 值不同，
    各自只能读自己 uid 的记录 —— 所以「一把 token 覆盖全账号」是不成立的。
  - **不需要 device token**：旧的 `token_by_channel_token` 链路（需 `channelMasterId`、
    写死官服）已彻底删除。
  - 前提是通行证已绑定该渠道：[user.hypergryph.com/bindCharacters?game=endfield](https://user.hypergryph.com/bindCharacters?game=endfield)。
    未绑定时 `binding_list` 不返回那条记录，表现为「只出现官服角色」而不是报错。
  - ⚠️ `be36d44aa36bfb5b` 是鹰角前端硬编码值，存在轮换风险；失效时 A1 会直接报
    `Gacha OAuth grant failed`（`appCode` 失效与 token 过期都会命中这里）。
  - 代码位置：`U8_GRANT_APP_CODE` / `BINDING_API_HOST` 常量 + `u8_oauth_token` / `u8_token_by_uid` / `get_u8_token_by_uid`。

### 4. dId（数美指纹）生成链（`fetch_new_did`，72-393）

1. `uid = uuid_v4`（74）；`pri_id = hex(MD5(uid))[..16]`（76，用作 AES key）。
2. `ep = base64(RSA-PKCS1v15-PublicEncrypt(PUB_KEY_DER, uid))`（81-98）。
3. 指纹素材：`curr_ms`、`smid = %Y%m%d%H%M%S + hex(MD5(uuid)) + "00"`、`vpw`、`trees`（105-109）。
4. `target` 含 14 个字段，严格按 `field_order`（174-189）排列：ua/platform/url/os/rtype/smid/vpw/svm/trees/pm_f/appId/organization/protocol/version（118-132）。
5. 按 `des_rules`（135-161）对每字段做**单 DES(ECB, Zero Padding, Base64)**（1166-1189），并改名为混淆键（`ua→bj`、`platform→gm`…）；`protocol`、`version` 的 key 为空则原样保留（194-223）。
6. 手工按 `field_order` 拼 JSON 字符串以固定键序（229-238）。
7. `GzBuilder::mtime(0)` + `Compression::best()` gzip → base64（249-254）。
8. AES-128-CBC：先追加 `0x00`，再补零到 16 倍数（263-268）；key=`pri_id` 字节、iv=`"0102030405060708"`，手写 CBC 循环（277-294）→ hex（296）。
9. `POST /deviceprofile/v4`，payload `{appId:"default", compress:2, data, encode:5, ep, organization:ORG, os:"web"}`（300-308）。
10. 解析：仅当**完全没有** `deviceId|device_id`（`detail`/`data`/顶层三种结构，349-362）时才检查 `code` 并报错（364-371）；取到值后返回 `format!("B{}", device_id)`（392）。

**备注**

- **缓存键**：`did_cache`（`get_or_refresh_did` 读/写、`rotate_did` 删后重写），存于 `ConfigService`；全文件仅此一个缓存键。**轮换必须写回**：否则一次 401 之后每次请求都会重新申请指纹，dId 永不稳定，还会反复消耗数美接口。
- **错误处理**：统一 `AppError`——`ConfigError`（锁失败）与 `AuthError`（其余全部：网络、JSON 解析、密码学、业务 code）。`call_skland_api` 内部失败不立即返回，而是累计 `last_err` 并进入下一轮，轮次耗尽后返回最后一条错误。每次失败都会上报 `utils::api_health::record_failure`（HTTP→Network、JSON→Parse、业务 code→按 sign/auth/server 分类），任一成功响应则 `record_success` 清零连续计数；`is_benign_business_error` 命中的「请勿重复签到」等幂等结果按成功处理，不计失败/不重试（否则自动签到会把熔断计数刷满并弹出虚假告警）；连续失败或服务器时间偏差 ≥180 秒会触发全局熔断（`app:api-health` 事件），后续 `call_skland_api` 立即返回「API requests are paused」，避免前端一直等待。`refresh_cred_by_hytoken` 中 u8 token 分支的任何失败都只 `log_warn` 且返回 `None`，不阻断主流程。日志中 dId/cred/token 不打印明文（cred 只打 `cred=***`）。
- **会话失效自愈（`code=10000 请求异常`）**：服务端轮换会话后，数据接口（`player/info`、`card/detail`、`attendance`）返回 `HTTP 401 + code=10000`，而 `/api/v1/user/check` **同一时刻仍返回 `code=0`**。因此 `check_and_refresh_user_cred` 永远判定「cred 有效」、永不刷新，随后每个角色都撞 401 → 连续失败浇满熔断计数 → **所有账号一起**显示「账号不可用」，用户唯一出路是重新登录（只有那条路径真的重走了 `hytoken → generate_cred_by_code`）。`call_skland_api` 现在就地补上这一步：`is_session_invalid` 命中时经 `services/cred_recovery.rs::refresh_for_cred` 用该账号的 hytoken 换一把新 cred、写回配置，然后重试一次。**只做一次**（`cred_refreshed` 标志），避免一次故障换出一堆凭据。
- **熔断不得挡住修复路径**：`check_cred`、`refresh_cred_by_hytoken` 都不调 `ensure_available()`。熔断是「结果」，换 cred 是「解药」；若解药也被熔断拦住，恢复链就永远无法启动。
- **被哪些 command 调用**（间接）：`commands/attendance.rs`（`get_attendance` / `do_attendance`）**直接**调用 `call_skland_api`（path `/web/v1/game/endfield/attendance`）；`commands/account.rs` 的账户类命令经 `AccountService` 走到 `get_role_detail`、`get_player_binding`、`get_user_info`、`get_game_list`、`check_cred`、`refresh_cred_by_hytoken`、`get_u8_token_by_uid`（后者仅由 `authorize_role_u8token` 与抽卡同步前的 `fetch_role_u8token` 触发）。
- **跨服务复用 `call_skland_api`**：`network_service.rs:103/111/119/127`、`char_detail_service.rs:503`、`char_wiki_detail_service.rs:93`、`account_service.rs:877/960`。
- **发现的异常**：① 旧链路已删除，此项不再适用；② `get_user_info` 文档注释称请求头为 `platform: 3`（~600），实际实现写死 `platform: 1`（447）；③ `des_encrypt_3des` 名称/注释为 3DES，实际使用 `des::Des` 单密钥 DES（1178）；④ `check_cred` 不带 sign/timestamp，与其余 zonai 接口的鉴权方式不一致（756-759）；⑤ AES/DES 的 `if pad_len < N` 判断（263-268、1172-1175）在长度恰为块倍数时不补零，依赖上游 Python 同样行为。
- **已清除的死代码**：`fetch_new_did_with_retry`（原 76-95，全仓无调用方）已删除；顶部未使用的 `aes::cipher::{BlockEncryptMut, KeyIvInit}` 与 `flate2::{Compression, GzBuilder}`、`std::io::Write` 导入，以及 `fetch_new_did` 内的重复 `use` 已删除。

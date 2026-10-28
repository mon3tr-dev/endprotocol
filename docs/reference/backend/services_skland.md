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
| 788-908 | `refresh_cred_by_hytoken`（grant → 可选 u8 → generate_cred_by_code） |
| 910-1013 | `get_u8_token_by_channel`、`get_u8_token_by_hytoken` |
| 1015-1140 | 私有 `u8_grant_to_sk_code`、`oauth_grant_to_sk_code`（同一个 as.hypergryph grant 端点） |
| 1142-1164 | `extract_endfield_roles`（纯数据提取，无网络） |
| 1166-1189 | 自由函数 `des_encrypt_3des`（单 DES ECB + Zero Padding + Base64） |
| 1191-1397 | `mod tests`：dId 格式测试、用户资料/游戏列表解析测试（内嵌抓包样本 JSON） |

## 方法清单（必须完整）

| 方法 | 位置 | 说明（输入 → 端点 → 处理 → 输出） |
| --- | --- | --- |
| `new(config_service)` pub | 33-36 | 持有 `Arc<Mutex<ConfigService>>` → 无网络 → 构造自身 |
| `get_or_refresh_did(&self)` 私有 async | 38-70 | 读配置键 `did_cache` → 命中直接返回；未命中 → `fetch_new_did` → 写回 `did_cache` → `Ok(String)` |
| `fetch_new_did(&self)` 私有 async | 72-98 | 先 `api_health::ensure_available()`；调用 `fetch_new_did_inner`，失败时按 `ApiFailureKind::DeviceFingerprint` 记一次失败（阈值 3），达到后熔断并通知前端「重启电脑 + 同步时区」 |
| `fetch_new_did_inner(&self)` 私有 async | 100-409 | 无入参 → `POST https://fp-it.portal101.cn/deviceprofile/v4`（payload 316-324）→ 构造指纹 JSON、DES 混淆、gzip、AES-128-CBC → 从 `detail/data/顶层` 的 `deviceId|device_id` 取值 → `Ok("B"+deviceId)` |
| `calculate_sign(&self, path, body, ts, did, token)` 私有 | 396-424 | 5 个字符串 → 无网络 → header JSON + HMAC-SHA256 + MD5 → 32 位小写 hex |
| `build_skland_request(&self, client, method, url, cred, did, sign, ts)` 私有 | 426-457 | GET/POST 分支（436-440）→ 注入 11 个请求头（442-456）→ `reqwest::RequestBuilder` |
| `call_skland_api(&self, method, path, query, body, cred, token, extra_headers)` pub async | 493-651 | 通用入口；**先 `api_health::ensure_available()` 熔断检查**；最多 2 轮，第 1 轮用缓存 dId、第 2 轮清缓存重取 → `https://zonai.skland.com{path}[?query]` → 从响应头 `Date` 计算本地时钟偏差 → 签名/发包/解析，`code==0` 才返回并 `record_success`；`is_benign_business_error`（如 `code=10001, message=请勿重复签到！`）命中时同样 `record_success` 并原样返回 `Ok(json)`（不重试）；其余业务码分类 `record_failure` 后累计 `last_err` 返回 |
| `get_user_info(&self, cred, token)` pub async | 603-623 | cred+token → `GET /web/v1/user` → `parse_user_info_response` → `SklandUserInfo` |
| `parse_user_info_response(json)` pub | 625-658 | 响应 JSON → 无网络 → `data.user` 反序列化为 `SklandUserInfo`（634-637），`userRts`→`stats`、`background` 解析失败非致命（640-645），顶层 `pendant` 覆盖 `user.pendant`（647-652）→ `SklandUserInfo` |
| `get_game_list(&self, cred, token)` pub async | 660-673 | cred+token → `GET /web/v1/game` → `parse_game_list_response` → `Vec<SklandGameInfo>` |
| `parse_game_list_response(json)` pub | 675-692 | 响应 JSON → 无网络 → 取 `data.list[]`，逐项取 `game` 并反序列化（过滤失败项）→ `Vec<SklandGameInfo>`；缺 `data.list` 报错 |
| `get_player_binding(&self, cred, token)` pub async | 694-713 | cred+token → `GET /api/v1/game/player/binding` → 整体反序列化为 `BindingResponse`（704-707）→ `response.data.list: Vec<GameBinding>` |
| `get_role_detail(&self, cred, token, role_id, server_id, user_id)` pub async | 715-742 | 3 个 id → `GET /api/v1/game/endfield/card/detail?roleId=&serverId=&userId=`（723-727）→ 反序列化 `CharDetailResponse`（731-734）→ `CharDetailResponse` |
| `check_cred(&self, cred)` pub async | 744-786 | cred → `GET https://zonai.skland.com/api/v1/user/check`（仅 cred + Content-Type，无 sign）→ `code==0` 判定（784）→ `bool` |
| `refresh_cred_by_hytoken(&self, hytoken, device_token)` pub async | 788-908 | hytoken(+device_token) → ①`oauth_grant_to_sk_code`（795）②可选 `u8_grant_to_sk_code`+`get_u8_token_by_channel`，失败仅告警不阻断（798-828）③`POST generate_cred_by_code`，payload `{kind:1, code}`（833-836），校验 `code==0`（869-877），取 `cred`/`token`/`userId`（883-905）→ `(cred, token, Option<u8_token>, user_id)` |
| `get_u8_token_by_channel(&self, sk_code)` pub async | 910-1002 | sk_code → `POST https://u8.hypergryph.com/u8/user/auth/v2/token_by_channel_token`（payload 922-928，Unity UA 939-945）→ 校验 `status==0`（971），取 `data.token`（985-991）与 `data.uid`（993，用 `Value::to_string()`）→ `(token, uid)` |
| `get_u8_token_by_hytoken(&self, hytoken, device_token)` pub async | 1004-1013 | hytoken+device_token → `u8_grant_to_sk_code` → `get_u8_token_by_channel` → 丢弃 uid → `Ok(u8_token)` |
| `u8_grant_to_sk_code(&self, hytoken, device_token)` 私有 async | 1015-1079 | hytoken+device_token → `POST https://as.hypergryph.com/user/oauth2/v2/grant`，payload `{appCode:"dd7b852d5f1dd9da", deviceToken, token, type:0}`（1024-1029）→ `status==0` 校验（1062）→ `data.code` |
| `oauth_grant_to_sk_code(&self, hytoken)` 私有 async | 1081-1140 | hytoken → 同一 grant 端点，payload `{token, appCode:"4ca99fa6b56cc2ba", type:0}`（1086-1090）→ `status==0` 校验（1123）→ `data.code` |
| `extract_endfield_roles(bindings)` pub（无 `self`） | 1142-1164 | `&[GameBinding]` → 无网络 → 过滤 `app_code=="endfield"`，展平 `binding_list[].roles[]` → `Vec<(uid, server_id, role_id)>` |
| `des_encrypt_3des(key, data)` 自由函数 | 1166-1189 | 8 字节 Zero Padding（1172-1175）→ 单 DES 加密每个 8 字节块（1178-1186）→ Base64 字符串 |

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
| `GET https://zonai.skland.com/api/v1/user/check` | 校验 cred 是否有效 | `check_cred` | 756 |
| `POST https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code` | sk_code → cred / token / userId | `refresh_cred_by_hytoken` | 843（payload 833-836） |
| `POST https://u8.hypergryph.com/u8/user/auth/v2/token_by_channel_token` | channel code → u8 渠道登录 token | `get_u8_token_by_channel` | 937（payload 922-928） |
| `POST https://as.hypergryph.com/user/oauth2/v2/grant` | hytoken → code（skland 场景 appCode=`4ca99fa6b56cc2ba`） | `oauth_grant_to_sk_code` | 1097（payload 1086-1090） |
| `POST https://as.hypergryph.com/user/oauth2/v2/grant` | hytoken+deviceToken → u8 channel code（appCode=`dd7b852d5f1dd9da`） | `u8_grant_to_sk_code` | 1036（payload 1024-1029） |

非端点 URL（仅作数据）：`https://www.skland.com/` 为指纹 target 的 `url` 字段（143）；`https://game.skland.com` 为 Origin/Referer 头（450-451）；测试样本中的 bbs.hycdn.cn 图片（1215-1389）。

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
- **token**：仅作签名 HMAC 的密钥（411），不直接出现在头里；`refresh_cred_by_hytoken` 返回的第二个值。签到场景会额外把它作为 `token` 头透传（attendance.rs:95、217）。
- **dId**：设备指纹，参与 header JSON 与签名；缓存在配置键 `did_cache`，失败时清缓存重取（503-510）。
- **hytoken**：Hypergryph 账号 token，只能通过 grant 换 code，再换 cred/token/u8 token，本身不用于签名。

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

- **缓存键**：`did_cache`（写 65、读 47、删 509），存于 `ConfigService`；全文件仅此一个缓存键。
- **错误处理**：统一 `AppError`——`ConfigError`（锁失败）与 `AuthError`（其余全部：网络、JSON 解析、密码学、业务 code）。`call_skland_api` 内部失败不立即返回，而是累计 `last_err` 并进入第 2 次尝试，两次耗尽后返回最后一条错误。每次失败都会上报 `utils::api_health::record_failure`（HTTP→Network、JSON→Parse、业务 code→按 sign/auth/server 分类），任一成功响应则 `record_success` 清零连续计数；`is_benign_business_error` 命中的「请勿重复签到」等幂等结果按成功处理，不计失败/不重试（否则自动签到会把熔断计数刷满并弹出虚假告警）；连续失败或服务器时间偏差 ≥180 秒会触发全局熔断（`app:api-health` 事件），后续 `call_skland_api` 立即返回「API requests are paused」，避免前端一直等待。`refresh_cred_by_hytoken` 中 u8 token 分支的任何失败都只 `log_warn` 且返回 `None`，不阻断主流程。日志中 dId/cred/token 不打印明文（cred 只打 `cred=***`）。
- **被哪些 command 调用**（间接）：`commands/attendance.rs:88-107`（`get_attendance`）与 `:210-230`（`do_attendance`）**直接**调用 `call_skland_api`（path `/web/v1/game/endfield/attendance`）；`commands/account.rs` 的 `get_accounts`/`get_skland_account_roles`/`get_skland_user_info`/`get_skland_games`/`refresh_accounts`/`check_and_refresh_cred`/`query_role_data` 经 `AccountService` 走到 `get_role_detail`、`get_player_binding`、`get_user_info`、`get_game_list`、`check_cred`、`refresh_cred_by_hytoken`、`get_u8_token_by_hytoken`。
- **跨服务复用 `call_skland_api`**：`network_service.rs:103/111/119/127`、`char_detail_service.rs:503`、`char_wiki_detail_service.rs:93`、`account_service.rs:877/960`。
- **发现的异常**：① `get_u8_token_by_channel` 的 uid 用 `Value::to_string()`（993），JSON 字符串会带引号，且两处调用方（805、1011）均以 `_` 丢弃该返回值；② `get_user_info` 文档注释称请求头为 `platform: 3`（~600），实际实现写死 `platform: 1`（447）；③ `des_encrypt_3des` 名称/注释为 3DES，实际使用 `des::Des` 单密钥 DES（1178）；④ `check_cred` 不带 sign/timestamp，与其余 zonai 接口的鉴权方式不一致（756-759）；⑤ AES/DES 的 `if pad_len < N` 判断（263-268、1172-1175）在长度恰为块倍数时不补零，依赖上游 Python 同样行为。
- **已清除的死代码**：`fetch_new_did_with_retry`（原 76-95，全仓无调用方）已删除；顶部未使用的 `aes::cipher::{BlockEncryptMut, KeyIvInit}` 与 `flate2::{Compression, GzBuilder}`、`std::io::Write` 导入，以及 `fetch_new_did` 内的重复 `use` 已删除。

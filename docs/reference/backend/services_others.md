# 后端服务层（其他服务）— 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 覆盖 `src-tauri/src/services/` 下除 `account_service.rs` / `skland_service.rs` / `game_launcher_service.rs` 外的全部文件。

## `src-tauri/src/services/mod.rs`
**职责**：服务层的模块声明清单，11 行，把 11 个服务模块公开为 `pub mod`。

**导出**：`account_service`、`avatar_cache_service`、`char_detail_service`、`char_wiki_detail_service`、`config_service`、`data_query`、`game_launcher_service`、`gacha_service`、`network_service`、`skland_service`、`system_resource_service`（全部为模块，无类型/方法）。

**状态**：不注册任何 Tauri State，仅提供命名空间。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `pub mod account_service` | mod.rs:1 | 账户服务（其他文档负责） |
| `pub mod avatar_cache_service` | mod.rs:2 | 图片/头像本地缓存服务 |
| `pub mod char_detail_service` | mod.rs:3 | 角色详情获取与图片懒加载处理 |
| `pub mod char_wiki_detail_service` | mod.rs:4 | Wiki 物品详情批量/按需缓存 |
| `pub mod config_service` | mod.rs:5 | JSON 配置读写（app_config.json） |
| `pub mod data_query` | mod.rs:6 | 数据路径解析与 API 名枚举 |
| `pub mod game_launcher_service` | mod.rs:7 | 游戏启动器（其他文档负责） |
| `pub mod gacha_service` | mod.rs:8 | 抽卡记录抓取与本地存储 |
| `pub mod network_service` | mod.rs:9 | 统一数据查询入口（聚合子服务） |
| `pub mod skland_service` | mod.rs:10 | 森兰 API 底层调用（其他文档负责） |

**备注**：无 HTTP 端点、无配置键、无文件路径。`data_query` 是纯函数模块（含单元测试），不属于「服务实例」。

---

## `src-tauri/src/services/config_service.rs`
**职责**：以 `HashMap<String, Value>` 为内存缓存的 JSON 配置读写服务，读写 `app_config.json`，每次写操作同步落盘（pretty JSON）。

**导出**：
- `pub struct ConfigService { config_path: PathBuf, cache: Mutex<HashMap<String, Value>> }`
- `pub fn new() -> Result<Self, AppError>`
- `pub fn get<T: DeserializeOwned>(&self, key) -> Option<T>`
- `pub fn set(&mut self, key: String, value: Value) -> Result<(), AppError>`
- `pub fn remove(&mut self, key: &str) -> bool`
- `pub fn get_all(&self) -> HashMap<String, Value>`
- `fn save(&self)`（私有）

**状态**：在 `lib.rs:311-315` 创建为 `Arc<std::sync::Mutex<ConfigService>>` 并 `app.manage(...)`；完整/静默模式均使用该配置状态。完整模式还注入 `SklandService`、`AccountService` 和托盘。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ConfigService::new` | config_service.rs:18 | 创建 `app_data_dir()`（`%LOCALAPPDATA%\cn.msk-network.endprotocol`）并 `create_dir_all`；`config_path = paths::config_file_path()`；若文件存在则读入并 `serde_json::from_str::<HashMap<..>>`（解析失败回退空 map）。 |
| `ConfigService::get` | config_service.rs:44 | 输入 `key: &str`；锁 cache 后 `serde_json::from_value` 反序列化为 `T`，失败或 key 不存在返回 `None`。无磁盘读取。 |
| `ConfigService::set` | config_service.rs:55 | 输入 key/value；插入 cache 后立即 `save()` 写盘。锁失败转 `AppError::ConfigError`。 |
| `ConfigService::remove` | config_service.rs:67 | 删除 key，返回是否真的存在；删除成功才 `save()`（失败被忽略）。 |
| `ConfigService::get_all` | config_service.rs:79 | 克隆整份 cache 返回（`unwrap()` 可能 panic）。 |
| `ConfigService::save` | config_service.rs:85 | `serde_json::to_string_pretty` 后 `fs::write(config_path)`。 |

**备注**：
- 文件路径：`%LOCALAPPDATA%\cn.msk-network.endprotocol\app_config.json`（`utils/paths.rs:34`）。
- 已知配置键（散布于调用方）：`main_exe_path`（startup.rs:8）、`launcher_install_path` / `launcher_channel`（startup.rs:9-10）、`capture_autostart`、`close_action`、`tray_user_info`、`lazy_load_enabled`、`account_list`、`account_token_{id}` / skland token 键、`did_cache`、`skland_games_cache`。
- 调用方：`commands/account.rs:28`、`commands/attendance.rs:19`、`commands/gacha.rs:25`（`get_all()`）；`set/remove` 全部由 `account_service.rs`、`skland_service.rs`、`tray.rs` 调用。

---

## `src-tauri/src/services/avatar_cache_service.rs`
**职责**：远程图片（头像/图标/立绘等）的本地磁盘缓存服务：按图片类型分子目录存储、命中即返回本地路径、未命中则带 `Referer` 下载；另维护「URL → 子目录」全局注册表供前端按需下载时定位目录。

**导出**：
- 自由函数 `pub fn register_url_subdir(url, subdir)`、`pub fn resolve_url_subdir(url) -> Option<String>`、`pub fn all_sub_dir_names() -> &'static [&'static str]`
- `pub enum ImageType { Avatar, SkillIcon, WeaponIcon, EquipIcon, Illustration, AttendanceIcon, GemIcon, ItemIcon, AchievementIcon }` 与 `impl ImageType { pub fn dir_name(&self) -> &str }`
- `pub struct ImageCacheService { cache_dir: PathBuf }`，方法：`new`、`cache_dir`、`local_path_if_cached`、`get_or_download_image`、`get_or_download_avatar`
- `pub type AvatarCacheService = ImageCacheService;`（向后兼容别名，avatar_cache_service.rs:214）

**状态**：在 `lib.rs:185-186` 创建为 `Arc<AvatarCacheService>`，**未** `app.manage`，而是注入 `NetworkService::new`（network_service.rs:23）与 `AccountService::new`（lib.rs:202），经 `AccountService::avatar_cache_service()` 取用。`char_detail_service.rs:226` 每次处理图片时另建临时实例。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `register_url_subdir` | avatar_cache_service.rs:14 | 输入 URL 与子目录名，写入 `OnceLock<Mutex<HashMap<String,String>>>` 全局注册表（空 URL 跳过）。由 `char_detail_service::localize_or_keep`（char_detail_service.rs:18）调用。 |
| `resolve_url_subdir` | avatar_cache_service.rs:25 | 按 URL 查询子目录名；被 `commands/image.rs:63`（`download_image` 的空 `sub_dir` 分支）调用。 |
| `all_sub_dir_names` | avatar_cache_service.rs:34 | 返回 10 个子目录：`avatars`、`skill_icons`、`weapon_icons`、`equip_icons`、`illustrations`、`attendance`、`gem_icons`、`item_icons`、`achv_icons`、`misc`。被 `local_path_if_cached`（:135）与 `commands/image.rs:70` 调用。 |
| `ImageType::dir_name` | avatar_cache_service.rs:65 | 枚举 → 子目录名（无 `misc`，`misc` 仅为下载兜底目录）。 |
| `ImageCacheService::new` | avatar_cache_service.rs:86 | 数据来源：`paths::image_cache_dir()` = `%LOCALAPPDATA%\cn.msk-network.endprotocol\image_cache`；创建主目录及 9 个类型子目录。 |
| `ImageCacheService::cache_dir` | avatar_cache_service.rs:113 | 返回缓存根目录；被 `char_detail_service.rs:483/643` 用于拼 `gem_icons` 路径。 |
| `extract_filename_from_url` | avatar_cache_service.rs:118 | 私有；取 URL 最后一个 `/` 段作为文件名（不剥离 query，与 `commands/image.rs:208` 的实现不同）。 |
| `local_path_if_cached` | avatar_cache_service.rs:130 | 输入 URL；`file://`、`http://asset.localhost` 直接原样返回；否则遍历 10 个子目录找同名文件，命中返回绝对路径，否则 `None`。不触发下载。被 `char_detail_service.rs:19` 调用。 |
| `get_or_download_image` | avatar_cache_service.rs:145 | 输入 URL + `ImageType`。本地/asset URL 直接返回；已有文件返回路径；否则 `GET {url}`，请求头 `Referer: https://game.skland.com/`（经 `capture::send` 走录制通道），日志记录请求/响应，`fs::write` 到 `image_cache/{dir_name}/{filename}`，返回本地路径。输出 `Result<String, AppError>`。调用方：`commands/attendance.rs:151`（`get_attendance`，`ImageType::AttendanceIcon`）、`char_detail_service.rs:671`（`ImageType::GemIcon`）。 |
| `get_or_download_avatar` | avatar_cache_service.rs:208 | `get_or_download_image(url, ImageType::Avatar)` 的别名。调用方：`account_service.rs:1169/1281/1667/1764/2412/2773`（角色头像落盘）。 |

**备注**：
- HTTP 端点：任意图片 URL，`GET`，唯一请求头 `Referer: https://game.skland.com/`。
- 文件路径：`%LOCALAPPDATA%\cn.msk-network.endprotocol\image_cache\{avatars|skill_icons|weapon_icons|equip_icons|illustrations|attendance|gem_icons|item_icons|achv_icons|misc}\{filename}`。
- 被命令调用：`commands/image.rs::download_image`（用到 `resolve_url_subdir`/`all_sub_dir_names`，但不经过本服务实例）、`commands/attendance.rs::get_attendance`（`get_or_download_image`）。

---

## `src-tauri/src/services/data_query.rs`
**职责**：纯函数工具模块——定义可被字符串解析的「数据 API 名」枚举，以及点分 JSON 路径（含数组索引）的解析与取值，供 `NetworkService::query_role_data` 做字段级抽取。

**导出**：
- `pub enum DataApi { CharDetail, WikiCatalog, WikiCatalogChar, WikiCatalogWeapon, WikiCatalogNoOnline, CharWikiDetail }`（`Display` + `FromStr`）
- `pub enum PathSegment { Field(String), Index(usize) }`（`Display`）
- `pub fn parse_path(path: &str) -> Vec<PathSegment>`
- `pub fn get_value_by_path(value: &Value, segments: &[PathSegment]) -> Option<Value>`
- 私有测试模块 `mod tests`（:129-199）

**状态**：不注册 State，无实例，无 I/O。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `DataApi` | data_query.rs:6 | 6 个变体；字符串形式见 `Display`（data_query.rs:21）与 `FromStr`（data_query.rs:34）：`char_detail`、`wiki_catalog`、`wiki_catalog_char`、`wiki_catalog_weapon`、`wiki_catalog_no_online`、`char_wiki_detail`。未知串返回 `Err(String)`。 |
| `PathSegment` | data_query.rs:52 | 字段名 `Field` 渲染为 `name`，索引 `Index` 渲染为 `[n]`。 |
| `parse_path` | data_query.rs:70 | 输入如 `base.name`、`chars.0.charData.id`、`chars.[0].name`；按 `.` 切分，`[n]` 或纯数字解析为 `Index`，否则 `Field`；空串返回空 vec，空段跳过。 |
| `get_value_by_path` | data_query.rs:105 | 空 segments 返回整值克隆；对象取 `Field`、数组取 `Index`，类型不匹配或缺键返回 `None`。 |

**备注**：仅被 `network_service.rs:7/100/174/175` 使用；`WikiCatalogNoOnline` 为调试用 API 名。无 HTTP、无缓存、无配置键。

---

## `src-tauri/src/services/network_service.rs`
**职责**：统一数据查询入口（聚合器）：持有 `SklandService` / `CharDetailService` / `CharWikiDetailService` 与当前角色 ID，把 `query_role_data` 的 API 名分发到对应子服务，再按点分路径抽取字段返回 `HashMap<path, Value>`。

**导出**：
- `pub use crate::services::char_detail_service::PreloadRoleInfo;`（向后兼容重导出，:13）
- `pub struct NetworkService { skland_service: Arc<SklandService>, char_detail_service: CharDetailService, char_wiki_detail_service: Arc<CharWikiDetailService>, current_role_id: Arc<Mutex<Option<String>>> }`
- 方法：`new`、`char_detail_service()`、`get_current_role_id`、`set_current_role_id`、`retain_only_char_detail`、`preload_all_char_details`、`query_role_data`

**状态**：**不**直接 `app.manage`；在 `lib.rs:193-196` 创建为 `Arc<NetworkService>` 并注入 `AccountService::new`（lib.rs:203），经 `AccountService` 的 `network_service` 字段访问（原 `get_network_service()` / `network_service()` 访问器为死代码，已删除）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `NetworkService::new` | network_service.rs:23 | 仅输入 `Arc<SklandService>`；内部构造 `CharDetailService` 与 `Arc<CharWikiDetailService>`（均只依赖 skland），`current_role_id` 初始化为 `None`。 |
| `char_detail_service` | network_service.rs:32 | 只读访问器。 |
| `get_current_role_id` | network_service.rs:36 | 读 `current_role_id`；调用方 `account_service.rs:415`。 |
| `set_current_role_id` | network_service.rs:40 | 输入 `(Option<String>, lazy_load_enabled)`；更新当前角色；若启用懒加载且角色发生变化，调用 `char_detail_service.remove(&old_id)` 释放旧角色缓存。调用链：`commands/account.rs::set_current_role_id`(:318) → `account_service.rs:495` → 本方法。 |
| `retain_only_char_detail` | network_service.rs:55 | 输入 `Option<String>`，仅保留该角色的两份缓存，其余清空。调用方 `account_service.rs:416`。 |
| `preload_all_char_details` | network_service.rs:60 | 输入 `&[PreloadRoleInfo]`，转调 `char_detail_service.preload_all`。调用方 `account_service.rs:482`。 |
| `query_role_data` | network_service.rs:68 | 输入 `role_id, api_name, paths, cred, token, server_id, user_id`；`api_name.parse::<DataApi>()` 后分发：<br>· `char_detail` → `CharDetailService::get_processed`<br>· `wiki_catalog` → `GET https://zonai.skland.com/web/v1/wiki/item/catalog?typeMainId=1&onlyOnline=true`<br>· `wiki_catalog_char` → 同路径 `?typeMainId=1&typeSubId=1`<br>· `wiki_catalog_weapon` → 同路径 `?typeMainId=1&typeSubId=2`<br>· `wiki_catalog_no_online` → 同路径 `?typeMainId=1`<br>· `char_wiki_detail` → 遍历 `paths`（当作 itemId）逐个 `CharWikiDetailService::get_item`，单条失败写入 `Null`，**直接返回**不走路径抽取<br>其余分支：`paths` 为空返回 `{"__full__": 整值}`，否则逐路径 `parse_path`+`get_value_by_path`，缺值填 `Null`。返回 `HashMap<String, Value>`。 |

**备注**：
- HTTP：全部经 `SklandService::call_skland_api`，基址 `https://zonai.skland.com`；请求头 `cred`、`dId`、`sign`、`timestamp`、`platform: 1`、`vName: 1.45.1`、`Content-Type: application/json`、`Origin/Referer: https://game.skland.com`（签名计算见 skland_service.rs:549，签名输入为 query 串）。角色详情数据源为 `GET https://zonai.skland.com/api/v1/game/endfield/card/detail?roleId=&serverId=&userId=`（skland_service.rs:742 起）。
- 调用方命令：`commands/account.rs::query_role_data`（:341，经 `account_service.rs:3076`）、`commands/account.rs::set_current_role_id`（:318）；`commands/gacha.rs:479` 经 `account.query_role_data(..., "wiki_catalog", &[])` 间接调用。
- 无自有缓存文件；缓存全部下沉到 `CharDetailService`（内存）与 `CharWikiDetailService`（内存+磁盘）。

---

## `src-tauri/src/services/char_detail_service.rs`
**职责**：角色（干员）详情的获取 + 双层内存缓存（原始 `CharDetailData` 与处理后 JSON），并对详情内所有图片 URL 做「已缓存替换为本地路径 / 未缓存保留远程 URL + 登记子目录」的懒加载处理（含基质图标按 Wiki 目录反查下载）。

**导出**：
- `pub struct PreloadRoleInfo { role_id, server_id, user_id, cred, token }`（:25）
- `pub struct CharDetailService { skland_service: Arc<SklandService>, cache: Arc<Mutex<HashMap<String, CharDetailData>>>, processed_cache: Arc<Mutex<HashMap<String, Value>>> }`
- 方法：`new`、`get_with_cache`、`preload_all`、`retain_only`、`remove`、`get_processed`（`process_images`、`cache_equip_icon`、`cache_gem_icon`、`cache_domain_avatars`、`cache_achieve_icons` 为私有）

**状态**：**不**单独注册；作为 `NetworkService` 的内联字段（network_service.rs:17，非 Arc 包裹），仅能通过 `NetworkService::char_detail_service()` 访问；其内部两个 `Arc<Mutex<..>>` 缓存可跨实例共享。

**内部结构**

| 区间 | 内容 |
| --- | --- |
| 1-22 | `localize_or_keep` 懒加载辅助：登记 URL 子目录 + 本地命中则替换路径 |
| 24-31 | `PreloadRoleInfo` 定义 |
| 33-47 | 结构体与 `new` |
| 49-84 | `get_with_cache`（原始详情缓存） |
| 86-126 | `preload_all`（批量预取） |
| 128-166 | `retain_only` / `remove`（缓存裁剪） |
| 168-215 | `get_processed`（处理后 JSON 缓存） |
| 217-357 | `process_images`（遍历角色/技能/天赋/装备/成就/秘境） |
| 359-384 | `cache_equip_icon`（weaponData/equipData/tacticalItemData 的 iconUrl） |
| 386-667 | `cache_gem_icon`（Wiki 目录反查基质图标并下载） |
| 669-706 | `cache_domain_avatars`（秘境结算 officerCharAvatar） |
| 708-747 | `cache_achieve_icons`（成就 4 个 icon 字段） |
| 749-765 | `update_gem_icon_path` 自由函数（写回 `weapon.gem.gemData.icon`） |

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `localize_or_keep` | char_detail_service.rs:14 | 输入 `&mut String` URL、`ImageCacheService`、`ImageType`；空或 `http://asset.localhost` 跳过；否则 `register_url_subdir` + 本地命中则覆写为本地路径。 |
| `CharDetailService::new` | char_detail_service.rs:40 | 注入 `Arc<SklandService>`，两份空 `HashMap` 缓存。 |
| `get_with_cache` | char_detail_service.rs:49 | 输入 `role_id, cred, token, server_id, user_id`；命中 `cache` 直接返回；否则 `SklandService::get_role_detail`（`GET https://zonai.skland.com/api/v1/game/endfield/card/detail?roleId=..&serverId=..&userId=..`，`cred`/`sign` 等头）取 `data.detail` 写入缓存。返回 `Option<CharDetailData>`。 |
| `preload_all` | char_detail_service.rs:87 | 输入 `&[PreloadRoleInfo]`，逐个跳过已缓存者并请求，单个失败仅告警（不中断）。调用方 `NetworkService::preload_all_char_details`。 |
| `retain_only` | char_detail_service.rs:129 | 保留指定 role 的两份缓存条目、清空其余；`None` 全清。 |
| `remove` | char_detail_service.rs:154 | 从两份缓存中删除该 role。由 `NetworkService::set_current_role_id` 懒加载分支调用。 |
| `get_processed` | char_detail_service.rs:169 | 先查 `processed_cache`；未命中则 `get_with_cache` → `process_images` → `serde_json::to_value` → 写入 `processed_cache`。返回 `Value`。被 `NetworkService::query_role_data` 的 `char_detail` 分支调用（最终来自 `commands/account.rs::query_role_data`）。 |
| `process_images` | char_detail_service.rs:218 | 新建 `ImageCacheService`；对每个角色处理 `avatar_sq_url`/`avatar_rt_url`（Avatar）、`illustration_url`（Illustration）、技能与 skill form 图标、`ability_talents`/`combat_talents`/`cultivation_talents` 的 `icon_url`+`locked_icon_url`（SkillIcon）、6 处装备图标（`weaponData`→WeaponIcon，`equipData`/`tacticalItemData`→EquipIcon）、基质图标、成就图标、秘境结算头像。 |
| `cache_equip_icon` | char_detail_service.rs:360 | 输入 `&mut Option<Value>`、`data_key`、`image_type`；在 `{data_key}.iconUrl` 上调用 `localize_or_keep`。 |
| `cache_gem_icon` | char_detail_service.rs:387 | 从 `weapon.gem.gemData` 取 `icon`/`name`/`templateId`（rarity = 去掉 `item_gem_rarity_` 前缀）；①本地 `image_cache/gem_icons/{原URL文件名}` 命中即回写；②否则 `GET https://zonai.skland.com/web/v1/wiki/item/catalog?typeMainId=1&typeSubId=7`（`call_skland_api`，带 cred/sign 头）取 `data.catalog[0].typeSub[0].items`，按名称首 2/末 2 字符 + `tagIds` 以 `000{rarity}` 结尾匹配，取 `brief.cover`；③`GET {cover_url}`（`Referer: https://game.skland.com/`）下载写入 `gem_icons/{原URL文件名}` 并回写路径。失败均仅告警。 |
| `cache_domain_avatars` | char_detail_service.rs:670 | 遍历 `domain[].settlements[].officerCharAvatar`，`localize_or_keep(.., Avatar)`。 |
| `cache_achieve_icons` | char_detail_service.rs:709 | 遍历 `achieve.achieveMedals[].achievementData` 的 `initIcon`/`reforge2Icon`/`reforge3Icon`/`platedIcon`，`localize_or_keep(.., AchievementIcon)`。 |
| `update_gem_icon_path` | char_detail_service.rs:750 | 自由函数；把本地路径写回 `weapon.gem.gemData.icon`。 |

**备注**：
- HTTP 端点：`https://zonai.skland.com/api/v1/game/endfield/card/detail`（带 cred/dId/sign/timestamp 头）、`https://zonai.skland.com/web/v1/wiki/item/catalog?typeMainId=1&typeSubId=7`、任意 `cover_url`（`Referer: https://game.skland.com/`）。
- 缓存路径：`%LOCALAPPDATA%\cn.msk-network.endprotocol\image_cache\gem_icons\{filename}`（本服务直接写盘处）；其他图片按类型落在 `image_cache/{dir_name}/`。
- 无配置键；缓存均为进程内 `HashMap`，生命周期随 `NetworkService`。
- 被调用：`NetworkService`（query_role_data / preload_all_char_details / retain_only_char_detail / set_current_role_id），间接触发命令 `commands/account.rs::query_role_data`、`set_current_role_id`，以及 `commands/gacha.rs:479`（`wiki_catalog` 不走本服务，仅同属 query_role_data）。

---

## `src-tauri/src/services/char_wiki_detail_service.rs`
**职责**：Wiki 物品详情按需缓存服务：逐个 `itemId` 拉取详情（`GET /web/v1/wiki/item/info`）并按「内存 → 磁盘 JSON → API」三级读取，磁盘命中后回填内存。

**导出**：
- `pub struct CharWikiDetailService { skland_service, cache, merged, cache_dir }`
- 方法：`new`、`get_item`（`disk_cache_path`、`save_to_disk`、`load_from_disk`、`fetch_item` 为私有）

**状态**：在 `NetworkService::new`（network_service.rs:26）中创建为 `Arc<CharWikiDetailService>` 并作为字段持有；**未** `app.manage`，仅经 `NetworkService` 内部使用。

**内部结构**

| 区间 | 内容 |
| --- | --- |
| 13-17 | 结构体定义 |
| 19-31 | `new`（含 cache_dir 解析） |
| 33-81 | 磁盘缓存读写（`disk_cache_path`/`save_to_disk`/`load_from_disk`） |
| 83-109 | `fetch_item` |
| 111-137 | `get_item`（三级查找） |

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CharWikiDetailService::new` | char_wiki_detail_service.rs:19 | `cache_dir = paths::wiki_detail_cache_dir()`（失败回退相对路径 `wiki_detail_cache`）；初始化 `cache`/`merged` 空结构。 |
| `disk_cache_path` | char_wiki_detail_service.rs:33 | `{cache_dir}/{itemId}.json`。 |
| `save_to_disk` | char_wiki_detail_service.rs:37 | 建目录后 `serde_json::to_string` 写 `{itemId}.json`，失败仅告警。 |
| `load_from_disk` | char_wiki_detail_service.rs:61 | 读并解析 `{itemId}.json`，存在但解析失败返回 `None`。 |
| `fetch_item` | char_wiki_detail_service.rs:83 | `GET https://zonai.skland.com/web/v1/wiki/item/info?id={itemId}`（经 `call_skland_api`，cred/dId/sign/timestamp 头）；写盘 + 写 `cache` + 写 `merged`。 |
| `get_item` | char_wiki_detail_service.rs:111 | 三级查找：内存 `cache` → 磁盘（命中则回填两层缓存）→ `fetch_item`。被 `NetworkService::query_role_data` 的 `char_wiki_detail` 分支调用（命令 `commands/account.rs::query_role_data`，api_name = `char_wiki_detail`）。 |

**备注**：
- HTTP 端点：`GET https://zonai.skland.com/web/v1/wiki/item/info?id={itemId}`；请求头同 `call_skland_api`（`cred`/`dId`/`sign`/`timestamp`/`platform: 1`/`vName: 1.45.1`/`Origin+Referer: https://game.skland.com`）。
- 磁盘缓存路径：`%LOCALAPPDATA%\cn.msk-network.endprotocol\wiki_detail_cache\{itemId}.json`（`utils/paths.rs:24`）。
- 无配置键。原先的批量预加载（`PreloadProgress`、`initialize`/`preload_all`/`clear`/`get_processed`/`fetch_all`/`extract_item_ids` 及 `initialized`/`preload_epoch`/`preload_in_progress`/`preload_progress` 状态）为死代码，已删除。

---

## `src-tauri/src/services/gacha_service.rs`
**职责**：抽卡（寻访）记录服务：调用 ef-webview 抽卡 API 分页抓取角色/武器寻访记录，按 `seqId` 增量同步与去重合并，落盘到 `gacha_records/` 目录，并管理角色头像映射与全量 Wiki 目录缓存；同步进度通过 Tauri 事件推送给前端。

**导出**：
- `pub const GACHA_SYNC_PROGRESS_EVENT: &str = "gacha-sync-progress";`（:22）
- `pub struct GachaService { app_handle: Option<AppHandle> }`
- 方法：`new`、`get_pool_meta`、`get_records_page`、`get_weapon_records_page`、`records_file_path`、`load_records`、`load_records_or_empty`、`save_records`、`weapon_records_file_path`、`load_weapon_records`、`load_weapon_records_or_empty`、`save_weapon_records`、`avatar_map_file_path`、`load_avatar_map`、`save_avatar_map`、`total_catalog_file_path`、`load_total_catalog`、`save_total_catalog`、`total_catalog_is_stale`、`sync_records`、`sync_weapon_records`、`merge_weapon_records`、`build_weapon_pools_map`、`merge_records`、`build_pools_map`、`pool_type_of_pool_id`、`group_records_by_pool`、`count_by_rarity`、`count_by_char`（`fetch_pool_records_until_overlap`、`read_records_file`、`now_ms`、`emit_progress`、`get_api` 为私有）

**状态**：`lib.rs:189-190` 创建为 `Arc<GachaService>` 并 `app.manage(...)`；命令以 `State<'_, Arc<GachaService>>` 注入。字段 `app_handle` 用于 `emit` 进度事件。

**内部结构**

| 区间 | 内容 |
| --- | --- |
| 16-23 | 常量：`EF_WEBVIEW_BASE`、`GACHA_USER_AGENT`、`GACHA_SYNC_PROGRESS_EVENT` |
| 25-35 | 结构体与 `new` |
| 37-141 | API 层：`get_pool_meta`、`get_records_page`、`get_weapon_records_page`、`fetch_pool_records_until_overlap` |
| 143-214 | 角色抽卡记录本地读写（含 legacy 路径回退） |
| 216-277 | 武器寻访记录本地读写 |
| 279-311 | 角色 id → 头像映射读写 |
| 313-379 | 全量 Wiki 目录 `total.json` 读写 + 缓存过期判断 |
| 381-484 | `sync_records`（角色增量同步主流程） |
| 485-625 | `sync_weapon_records` + 武器合并/池映射 |
| 627-736 | 工具方法（合并、分组、统计、`now_ms`） |
| 738-742 | `emit_progress`（进度事件） |
| 744-797 | `get_api`（统一 GET + code==0 校验） |

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GachaService::new` | gacha_service.rs:31 | 仅保存 `AppHandle`。 |
| `get_pool_meta` | gacha_service.rs:40 | 输入 `u8token, server_id`；`GET https://ef-webview.hypergryph.com/api/record/char/meta?lang=zh-cn&token={u8token}&server_id={server_id}`；返回 `GachaMetaData`（Tab 列表）。被 `commands/gacha.rs::get_gacha_pool_meta`(:84) 调用。 |
| `get_records_page` | gacha_service.rs:51 | 输入 `u8token, server_id, pool_type, pool_id?, seq_id?`；`GET https://ef-webview.hypergryph.com/api/record/char` + `pool_type`/`pool_id`（joint 池需要）/`seq_id`（上一页末条）；返回 `GachaRecordData { list, has_more }`。被内部翻页调用（:123），无直接命令调用。 |
| `get_weapon_records_page` | gacha_service.rs:72 | 输入 `u8token, server_id, seq_id?`；`GET https://ef-webview.hypergryph.com/api/record/weapon?..&seq_id=`；返回 `GachaWeaponRecordData`。被 `sync_weapon_records`(:545) 调用。 |
| `fetch_pool_records_until_overlap` | gacha_service.rs:89 | 私有；循环 `get_records_page`，逐条比对本地 `saved_seq_ids` 命中即停（该条不入库），`has_more=false` 或空页停止；每页更新 `GachaSyncProgress` 并 `emit_progress`；下一页 `seq_id` = 本页最后一条。 |
| `records_file_path` | gacha_service.rs:143 | 委托 `paths::gacha_records_file_path` = `%LOCALAPPDATA%\cn.msk-network.endprotocol\gacha_records\gacha_records_{userId}_{serverId}.json`。 |
| `load_records` | gacha_service.rs:150 | 读上述文件；不存在时回退旧路径 `gacha_records_{userId}_{serverId}.json`（与 app_config.json 同级，`paths.rs:70`）；都没有返回 `None`。 |
| `read_records_file` | gacha_service.rs:177 | 私有；读文件 + `serde_json::from_str`。 |
| `load_records_or_empty` | gacha_service.rs:184 | 不存在则返回空 `SavedGachaData`（`last_sync_time=None`）。调用：`commands/gacha.rs::get_saved_gacha_records`(:164)、`resolve_gacha_avatar_map`(:375)、`get_gacha_record_stats`(:534)。 |
| `save_records` | gacha_service.rs:201 | 建父目录后 pretty JSON 写盘。调用：`sync_records`(:475)。 |
| `weapon_records_file_path` | gacha_service.rs:219 | `gacha_records\gacha_weapon_records_{userId}_{serverId}.json`（`paths.rs:52`）。 |
| `load_weapon_records` / `load_weapon_records_or_empty` | gacha_service.rs:232/247 | 同角色逻辑，无 legacy 回退。调用：`commands/gacha.rs::get_saved_weapon_gacha_records`(:234)、`resolve_gacha_avatar_map`(:381)。 |
| `save_weapon_records` | gacha_service.rs:264 | pretty JSON 写盘。调用：`sync_weapon_records`(:580)。 |
| `avatar_map_file_path` | gacha_service.rs:282 | `%LOCALAPPDATA%\cn.msk-network.endprotocol\gacha_avatar_map.json`（`paths.rs:78`）。 |
| `load_avatar_map` | gacha_service.rs:289 | 读 charId → 头像 URL 映射，任何失败回空 map。调用：`commands/gacha.rs::resolve_gacha_avatar_map`(:443)。 |
| `save_avatar_map` | gacha_service.rs:300 | 空 map 不写盘；否则 pretty JSON。调用：同命令 :506。 |
| `total_catalog_file_path` | gacha_service.rs:316 | `gacha_records\total.json`（全局共用，`paths.rs:65`）。 |
| `load_total_catalog` | gacha_service.rs:324 | 读全量 Wiki 目录缓存；文件缺失/解析失败/`data.catalog[].typeSub[].items` 全为空（早期误用产生的无效数据）时返回 `None`。调用：`resolve_gacha_avatar_map`(:462)。 |
| `save_total_catalog` | gacha_service.rs:359 | 紧凑 JSON 写盘。调用：同命令 :482。 |
| `total_catalog_is_stale` | gacha_service.rs:371 | 输入 `ttl: Duration`；全量 Wiki 目录缓存文件缺失、无法读取修改时间或修改时间早于 `ttl` 之前时返回 `true`。调用：`resolve_gacha_avatar_map`(:477)，用于判断缓存未覆盖全部缺失头像时是否值得重新拉取目录。 |
| `sync_records` | gacha_service.rs:387 | 输入 `user_id, server_id, u8token`。①读本地 `saved_seq_ids`；②`get_pool_meta` 取全部 Tab；③每个 Tab `fetch_pool_records_until_overlap` 增量拉取（每页推送 `gacha-sync-progress`）；④`merge_records` 去重合并 + `build_pools_map` 重建池信息 + 写 `last_sync_time`；⑤`save_records`；⑥`progress.done=true` 再推一次。返回 `GachaSyncResult { user_id, server_id, synced_at, new_records, total_records, per_tab_new }`。被 `commands/gacha.rs::sync_gacha_records`(:116) 调用。 |
| `sync_weapon_records` | gacha_service.rs:485 | 同上但无 meta：直接从最新按 `seq_id` 翻 `/api/record/weapon` 直到命中已存 `seqId`；`progress.tab_key="weapon"`、`tab_count=1`；合并用 `merge_weapon_records` + `build_weapon_pools_map`；`per_tab_new = {"weapon": n}`。被 `commands/gacha.rs::sync_weapon_gacha_records`(:179) 调用。 |
| `merge_weapon_records` | gacha_service.rs:587 | 按 `seqId` 去重（新在前），再按 `(seq_id 数值, gacha_ts_ms)` 降序排序，保证全局从新到旧。 |
| `build_weapon_pools_map` | gacha_service.rs:614 | 从记录提取 `poolId → GachaPoolInfo`，`pool_type` 固定 `E_WeaponGachaPoolType`。 |
| `merge_records` | gacha_service.rs:630 | 同 `merge_weapon_records` 的角色版（`GachaRecord`）。 |
| `build_pools_map` | gacha_service.rs:653 | 合并 meta Tab 提供的池（`label` → `pool_name`）与记录中出现的池。 |
| `pool_type_of_pool_id` | gacha_service.rs:681 | `joint_*` → `E_CharacterGachaPoolType_Joint`；`standard*` → `..._Standard`；其余 → `..._Special`。 |
| `group_records_by_pool` | gacha_service.rs:692 | 按 `pool_id` 分组（保持原顺序，即从新到旧）。调用：`commands/gacha.rs::get_gacha_record_stats`(:545)。 |
| `count_by_rarity` | gacha_service.rs:703 | 仅 `is_draw()` 记录，`rarity → count`。调用：同命令 :558。 |
| `count_by_char` | gacha_service.rs:717 | 仅 `is_draw()` 记录，`char_id → count`。调用：同命令 :559。 |
| `now_ms` | gacha_service.rs:730 | Unix 毫秒时间戳。 |
| `emit_progress` | gacha_service.rs:738 | `AppHandle::emit(GACHA_SYNC_PROGRESS_EVENT, progress)`，事件名 `gacha-sync-progress`。 |
| `get_api` | gacha_service.rs:746 | 私有统一 GET：URL = `{EF_WEBVIEW_BASE}{endpoint}`，`query_pairs_mut` 追加 `lang=zh-cn`、`token={u8token}`、`server_id` 及业务参数（URL 编码，避免 u8token 中 `+`/`/` 被误解析）；请求头 `User-Agent: GACHA_USER_AGENT`（抓包同款 QtWebEngine/Chrome UA，:20）、`Referer: https://ef-webview.hypergryph.com/page/gacha_char?u8_token={enc}&channel=1&lang=zh-cn&platform=Windows&server={enc}&subChannel=1`、`Accept: application/json, text/plain, */*`；`error_for_status` 后反序列化 `GachaApiResponse<T>`，`code != 0` 抛 `AppError::ApiError`，`data` 为 `None` 抛 `"empty data"`。 |

**备注**：
- HTTP 端点（基址 `https://ef-webview.hypergryph.com`）：
  - `GET /api/record/char/meta`
  - `GET /api/record/char`
  - `GET /api/record/weapon`
  - 公共 query：`lang=zh-cn`、`token`（u8token）、`server_id`；请求头：`User-Agent`（常量 `GACHA_USER_AGENT`）、`Referer`（gacha_char 页面带 u8_token/channel/platform/server/subChannel）、`Accept`。无签名。
- 文件/缓存路径（根目录均为 `%LOCALAPPDATA%\cn.msk-network.endprotocol`）：
  - `gacha_records\gacha_records_{userId}_{serverId}.json`（旧版：根目录同名文件，仅读兼容）
  - `gacha_records\gacha_weapon_records_{userId}_{serverId}.json`
  - `gacha_records\total.json`（全量 Wiki 目录缓存，全局共用）
  - `gacha_avatar_map.json`
- `total.json` 是历史快照：`commands/gacha.rs::resolve_gacha_avatar_map` 在缓存未能补齐全部缺失头像、且缓存超过 6 小时冷却期时会重新拉取目录并覆盖。目录中「预览」条目（`brief.associate == null`）按所属 `typeSub.id`（`"1"`=干员、`"2"`=武器）归类，名称取 `brief.name`，避免新干员/武器因尚未生成 `associate` 而缺头像。
- 事件：`gacha-sync-progress`（`GachaSyncProgress`：user_id、server_id、tab_index、tab_count、tab_key、page、tab_fetched、total_fetched、done）。
- 被命令调用：`commands/gacha.rs` 中 `get_gacha_pool_meta`、`sync_gacha_records`、`get_saved_gacha_records`、`sync_weapon_gacha_records`、`get_saved_weapon_gacha_records`、`resolve_gacha_avatar_map`、`get_gacha_record_stats`（全部以 `State<'_, Arc<GachaService>>` 注入）。u8token 来自同文件 `lookup_u8token` / `ensure_fresh_u8token`（读 `ConfigService` 并按需刷新 cred）。

## `src-tauri/src/services/system_resource_service.rs`
**职责**：本机系统资源采集（CPU / 内存 / GPU / 磁盘 / 网络），由 `commands/system_resource.rs::get_system_snapshot` 调用。基于 `sysinfo`，GPU 通过 `nvidia-smi` 尽力采集；所有子项失败都降级为「空数据 + `errors` 文案」，不 panic。

**导出（类型）**：`SystemResourceService`、`SystemSnapshot`，以及快照子结构 `CpuInfo`、`CpuCoreInfo`、`TemperatureReading`、`MemoryInfo`、`GpuInfo`、`DiskInfo`、`NetworkInfo`（全部 `serde(rename_all = "camelCase")`，与前端 `types/system-resource.ts` 对应）。

**主要依赖**：`sysinfo`（`System`/`Disks`/`Networks`/`Components`，默认 feature 含 `system/disk/network/component/user`）、`std::process::Command`（nvidia-smi）、`windows-sys`（`Win32_System_Performance` 的 PDH 用于实测 CPU 频率）、`crate::log_debug` / `log_warn`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SystemResourceService` | 结构体 | 有状态采集器：持有 `System`/`Disks`/`Networks`/`Components` 与 `last_tick`，用于计算速率与限制温度/GPU 采集频率 |
| `SystemResourceService::new()` | `new` | 初始化系统（仅 `refresh_cpu_list` + `refresh_memory`，不枚举进程）、磁盘/网卡列表；`Components::new()` 留待首次采集 |
| `SystemResourceService::snapshot()` | `snapshot` | 刷新 CPU/内存/磁盘/网卡，计算 `elapsed_secs` 后得到速率，返回 `SystemSnapshot`（含 `errors`） |
| `collect_cpu` / `collect_temperatures` | 私有 | CPU 总体/单核使用率、品牌、实测频率（见下）；温度传感器每 3s 刷新一次，优先标签含 `cpu/package/tctl/tdie` 的读数 |
| `spawn_cpu_performance_thread` | 私有（Windows） | 后台线程（每秒）用 PDH 读取 `\Processor Information(_Total)\% Processor Performance`，写入 `Arc<Mutex<Option<f64>>>`；`collect_cpu` 用它 × 标称频率得到**实际频率**（含睿频，>100% 即超过基准），无法读取时回退标称频率并置 `frequency_is_actual=false` |
| `collect_memory` | 私有 | total/used/available/free/cached(≈available-free)/usage，Swap total/used/usage |
| `collect_disks` | 私有 | 每分区容量、使用率、读写速率与累计读写（`DiskUsage` 的 `read_bytes`/`written_bytes` ÷ elapsed） |
| `collect_networks` | 私有 | 每网卡上下行速率（`received()`/`transmitted()` ÷ elapsed）与累计流量，按活跃度排序 |
| `collect_gpus` | 私有 | 每 2s 调用一次 `probe_nvidia_smi` 并缓存；无 NVIDIA 驱动/GPU 时返回空并记录 `gpu_unavailable` |
| `probe_nvidia_smi` | 私有 | `nvidia-smi --query-gpu=index,name,utilization.gpu,memory.total,memory.used,temperature.gpu,power.draw,fan.speed --format=csv,noheader,nounits`，`[N/A]` 解析为 `None` |

**备注**：
- 首次快照的 CPU 使用率可能为 0（sysinfo 需要两次间隔 ≥ `MINIMUM_CPU_UPDATE_INTERVAL` 的刷新），前端轮询 ≥500ms，第二次起数值正常。
- **CPU 频率**：Windows 上 `sysinfo`/`PROCESSOR_POWER_INFORMATION` 返回的是标称频率（如 3201 MHz），无法反映睿频；本服务改用 PDH `% Processor Performance`（睿频时 >100）× 标称频率得到实测值（实测对应机器 130.5% × 3201 ≈ 4176 MHz）。PDH 句柄非 `Send`，因此整个查询生命周期都放在专属后台线程内，`snapshot()` 只读取缓存值，不阻塞。
- 速率为「上次刷新以来的字节数 / 间隔秒数」，因此刷新频率会直接影响速率精度；前端默认 1s。
- 被命令调用：`commands/system_resource.rs::get_system_snapshot`（`State<Arc<std::sync::Mutex<SystemResourceService>>>`，`spawn_blocking` 内执行）。

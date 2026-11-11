use std::collections::HashMap;
use std::sync::{Arc, Mutex as SyncMutex};
use std::time::Duration;
use tauri::State;
use tokio::sync::Mutex;

use crate::models::role::GAME_ARKNIGHTS;
use crate::services::account_service::AccountService;
use crate::services::arknights_gacha_service::ArknightsGachaService;
use crate::services::config_service::ConfigService;
use crate::services::gacha_service::GachaService;
use crate::utils::AppError;
use crate::{log_error, log_info, log_warn};

/// 全量 Wiki 目录缓存的最小刷新间隔：缓存新于该时长时不再重复请求，避免个别
/// 无法匹配的名称导致每次打开抽卡页都重新拉取整份目录。
const TOTAL_CATALOG_REFRESH_COOLDOWN: Duration = Duration::from_secs(6 * 60 * 60);

/// 一个角色在抽卡侧的归属信息
struct RoleOwner {
    user_id: String,
    /// 渠道绑定 uid —— 换 u8token 的键（官服 / B 服各一个）
    binding_uid: String,
    #[allow(dead_code)]
    channel_master_id: String,
    server_id: String,
    /// 用户是否在账号页为这个角色打开了抽卡授权
    authorized: bool,
    /// 角色所属游戏：`endfield` / `arknights`。
    ///
    /// 两个游戏的抽卡接口**完全不同**（端点、token 参数名、卡池枚举、翻页游标、
    /// 稀有度基准），因此这个字段决定走哪条链路 —— 详见
    /// [`crate::services::arknights_gacha_service`] 的模块文档。
    game: String,
}

impl RoleOwner {
    /// 该角色是否属于《明日方舟》
    fn is_arknights(&self) -> bool {
        self.game == GAME_ARKNIGHTS
    }
}

/// 根据 roleId 找到它所属的账号、渠道绑定 uid 与服务器
///
/// 授权改成 `roles[].u8Authorized` 开关后，这里**只查归属、不查令牌**（令牌不落盘）。
fn lookup_role_owner(
    config_service: &Arc<SyncMutex<ConfigService>>,
    role_id: &str,
) -> Result<RoleOwner, AppError> {
    let config = config_service.lock().map_err(|e| AppError::ConfigError {
        message: format!("Lock failed: {}", e),
    })?;

    for (key, value) in config.get_all() {
        if !key.starts_with("account_token_") {
            continue;
        }
        let Some(roles) = value.get("roles").and_then(|v| v.as_array()) else {
            continue;
        };
        for role in roles {
            if role.get("roleId").and_then(|v| v.as_str()) != Some(role_id) {
                continue;
            }
            let read = |field: &str| {
                role.get(field)
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string()
            };
            return Ok(RoleOwner {
                user_id: key.trim_start_matches("account_token_").to_string(),
                binding_uid: read("bindingUid"),
                channel_master_id: read("channelMasterId"),
                server_id: read("serverId"),
                authorized: role
                    .get("u8Authorized")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                // 老数据（绑定时还没有 app 字段）默认终末地，与 models::role 的 default_game 一致
                game: {
                    let g = read("app");
                    if g.is_empty() {
                        crate::models::role::GAME_ENDFIELD.to_string()
                    } else {
                        g
                    }
                },
            });
        }
    }

    Err(AppError::AuthError {
        message: format!("No account found for roleId: {}. Please re-login.", role_id),
    })
}

/// 同步前现换一个 u8token（**不缓存、不落盘**）。
///
/// 未授权角色直接报错，提示用户去账号页授权 —— 不会因为一次同步就替用户把授权装回去。
/// 令牌生命周期很短，因此每次同步都换新的，也不做「失败回退旧值」——旧值多半已经失效，
/// 拿着它继续请求只会得到更难理解的错误。
async fn fresh_u8token(
    account_service: &AccountService,
    owner: &RoleOwner,
    role_id: &str,
) -> Result<String, AppError> {
    if !owner.authorized {
        return Err(AppError::AuthError {
            message: format!(
                "u8token not authorized for roleId: {}. Please authorize it on the account page.",
                role_id
            ),
        });
    }

    match account_service
        .check_and_refresh_user_cred(&owner.user_id)
        .await
    {
        Ok(_) => {}
        Err(e) => {
            log_warn!(
                "gacha: cred refresh failed (non-fatal) for user {}: {}",
                owner.user_id,
                e
            );
        }
    }

    account_service
        .fetch_role_u8token(&owner.user_id, &owner.binding_uid)
        .await
        .map_err(|e| {
            log_error!("gacha: fetch u8token failed for role {}: {}", role_id, e);
            e
        })
}

/// 获取可用卡池 Tab（meta），供前端展示卡池切换
///
/// ⚠️ **仅终末地**：明日方舟没有 meta 接口，卡池枚举是 `/api/gacha/cate` 的**分类**，
/// 由 [`get_arknights_gacha_categories`] 提供。对明日方舟角色调用本命令会直接报错，
/// 避免前端误以为两个游戏的"卡池"是同一个概念。
#[tauri::command]
pub async fn get_gacha_pool_meta(
    account_state: State<'_, Arc<Mutex<AccountService>>>,
    gacha_state: State<'_, Arc<GachaService>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    log_info!("get_gacha_pool_meta: START for role_id={}", role_id);
    let account = account_state.lock().await;
    let config_service = account.get_config_service().clone();

    let owner = lookup_role_owner(&config_service, &role_id)
        .map_err(|e| {
            log_error!("get_gacha_pool_meta: prepare failed: {}", e);
            e.to_string()
        })?;

    if owner.is_arknights() {
        // 明日方舟走 /api/gacha/cate，返回结构与 GachaMetaData 完全不同
        return Err(
            "This role belongs to Arknights. Use get_arknights_gacha_categories instead.".to_string(),
        );
    }

    let u8token = fresh_u8token(&account, &owner, &role_id).await.map_err(|e| {
        log_error!("get_gacha_pool_meta: prepare failed: {}", e);
        e.to_string()
    })?;

    let meta = gacha_state
        .get_pool_meta(&u8token, &owner.server_id)
        .await
        .map_err(|e| {
            log_error!("get_gacha_pool_meta: FAILED for role_id={}: {}", role_id, e);
            e.to_string()
        })?;

    log_info!("get_gacha_pool_meta: SUCCESS for role_id={}", role_id);
    serde_json::to_value(meta).map_err(|e| e.to_string())
}

/// 手动触发抽卡记录增量同步（从最新读到上次保存的最后一条为止，与旧记录合并）
///
/// 按角色所属游戏**自动分流**：
/// - 终末地 → `ef-webview` 的 `/api/record/char`（`seq_id` 单值游标）
/// - 明日方舟 → `ak-webview` 的 `/api/gacha/history`（`gachaTs`+`pos` 复合游标）
///
/// 前端只调这一个命令，不需要知道自己在同步哪个游戏。
#[tauri::command]
pub async fn sync_gacha_records(
    account_state: State<'_, Arc<Mutex<AccountService>>>,
    gacha_state: State<'_, Arc<GachaService>>,
    arknights_gacha_state: State<'_, Arc<ArknightsGachaService>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    log_info!("sync_gacha_records: START for role_id={}", role_id);
    let account = account_state.lock().await;
    let config_service = account.get_config_service().clone();

    let owner = lookup_role_owner(&config_service, &role_id).map_err(|e| {
        log_error!("sync_gacha_records: prepare failed: {}", e);
        e.to_string()
    })?;

    let is_arknights = owner.is_arknights();
    let u8token = fresh_u8token(&account, &owner, &role_id).await.map_err(|e| {
        log_error!("sync_gacha_records: prepare failed: {}", e);
        e.to_string()
    })?;

    let result = if is_arknights {
        // 明日方舟按**渠道绑定 uid** 存盘（接口不吃 server_id，同一 uid 就是一条流水）
        arknights_gacha_state
            .sync_records(&owner.binding_uid, &u8token)
            .await
    } else {
        gacha_state
            .sync_records(&owner.user_id, &owner.server_id, &u8token)
            .await
    }
    .map_err(|e| {
        log_error!("sync_gacha_records: FAILED for role_id={}: {}", role_id, e);
        e.to_string()
    })?;

    log_info!("sync_gacha_records: SUCCESS for role_id={}", role_id);
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// 读取本地保存的抽卡记录（不请求网络）
#[tauri::command]
pub async fn get_saved_gacha_records(
    account_state: State<'_, Arc<Mutex<AccountService>>>,
    gacha_state: State<'_, Arc<GachaService>>,
    arknights_gacha_state: State<'_, Arc<ArknightsGachaService>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    log_info!("get_saved_gacha_records: START for role_id={}", role_id);
    let account = account_state.lock().await;
    let config_service = account.get_config_service().clone();

    let owner = lookup_role_owner(&config_service, &role_id).map_err(|e| {
        log_error!("get_saved_gacha_records: lookup failed: {}", e);
        e.to_string()
    })?;

    let data = if owner.is_arknights() {
        arknights_gacha_state.load_records_or_empty(&owner.binding_uid)
    } else {
        gacha_state.load_records_or_empty(&owner.user_id, &owner.server_id)
    }
    .map_err(|e| {
        log_error!(
            "get_saved_gacha_records: FAILED for role_id={}: {}",
            role_id,
            e
        );
        e.to_string()
    })?;

    log_info!("get_saved_gacha_records: SUCCESS for role_id={}", role_id);
    serde_json::to_value(data).map_err(|e| e.to_string())
}

/// 手动触发武器寻访记录增量同步（从最新读到上次保存的最后一条为止，与旧记录合并）
///
/// ⚠️ **仅终末地**：《明日方舟》没有武器寻访，对明日方舟角色调用会返回空结果
/// （`new_records = 0`），而不是报错 —— 前端的"同步全部记录"会同时调角色与武器，
/// 明日方舟侧武器恒为空，让整条链路保持可复用。
#[tauri::command]
pub async fn sync_weapon_gacha_records(
    account_state: State<'_, Arc<Mutex<AccountService>>>,
    gacha_state: State<'_, Arc<GachaService>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    log_info!("sync_weapon_gacha_records: START for role_id={}", role_id);
    let account = account_state.lock().await;
    let config_service = account.get_config_service().clone();

    let owner = lookup_role_owner(&config_service, &role_id).map_err(|e| {
        log_error!("sync_weapon_gacha_records: prepare failed: {}", e);
        e.to_string()
    })?;

    // 明日方舟没有武器寻访：直接返回空结果，不发请求、不落盘
    if owner.is_arknights() {
        log_info!(
            "sync_weapon_gacha_records: role {} is Arknights, no weapon gacha — returning empty",
            role_id
        );
        let empty = crate::models::gacha::GachaSyncResult {
            user_id: owner.binding_uid.clone(),
            server_id: owner.server_id.clone(),
            synced_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
            new_records: 0,
            total_records: 0,
            per_tab_new: HashMap::new(),
        };
        return serde_json::to_value(empty).map_err(|e| e.to_string());
    }

    let u8token = fresh_u8token(&account, &owner, &role_id).await.map_err(|e| {
        log_error!("sync_weapon_gacha_records: prepare failed: {}", e);
        e.to_string()
    })?;

    let result = gacha_state
        .sync_weapon_records(&owner.user_id, &owner.server_id, &u8token)
        .await
        .map_err(|e| {
            log_error!(
                "sync_weapon_gacha_records: FAILED for role_id={}: {}",
                role_id,
                e
            );
            e.to_string()
        })?;

    log_info!("sync_weapon_gacha_records: SUCCESS for role_id={}", role_id);
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// 读取本地保存的武器寻访记录（不请求网络）
///
/// ⚠️ **仅终末地**：明日方舟恒返回空结构（武器分类在页面上自动隐藏）。
#[tauri::command]
pub async fn get_saved_weapon_gacha_records(
    account_state: State<'_, Arc<Mutex<AccountService>>>,
    gacha_state: State<'_, Arc<GachaService>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    log_info!(
        "get_saved_weapon_gacha_records: START for role_id={}",
        role_id
    );
    let account = account_state.lock().await;
    let config_service = account.get_config_service().clone();

    let owner = lookup_role_owner(&config_service, &role_id).map_err(|e| {
        log_error!("get_saved_weapon_gacha_records: lookup failed: {}", e);
        e.to_string()
    })?;

    // 明日方舟没有武器寻访：返回空结构，前端据此隐藏「武器」分类
    if owner.is_arknights() {
        let empty = crate::models::gacha::SavedWeaponGachaData {
            user_id: owner.binding_uid,
            server_id: owner.server_id,
            last_sync_time: None,
            pools: HashMap::new(),
            records: Vec::new(),
        };
        log_info!(
            "get_saved_weapon_gacha_records: role {} is Arknights, returning empty",
            role_id
        );
        return serde_json::to_value(empty).map_err(|e| e.to_string());
    }

    let (user_id, server_id) = (owner.user_id, owner.server_id);

    let data = gacha_state
        .load_weapon_records_or_empty(&user_id, &server_id)
        .map_err(|e| {
            log_error!(
                "get_saved_weapon_gacha_records: FAILED for role_id={}: {}",
                role_id,
                e
            );
            e.to_string()
        })?;

    log_info!(
        "get_saved_weapon_gacha_records: SUCCESS for role_id={}",
        role_id
    );
    serde_json::to_value(data).map_err(|e| e.to_string())
}

/// 获取《明日方舟》寻访卡池分类列表（`GET /api/gacha/cate`）
///
/// 这是明日方舟版的「卡池枚举」—— 与终末地的 `get_gacha_pool_meta` 平级，
/// 但返回的是**分类**（限定寻访·庆典 / 中坚寻访 …），不是 Tab。
///
/// ⚠️ 明日方舟对无效 token 返回 `code=0` + 空列表，后端已把它转成鉴权错误，
/// 前端拿到的 `Err` 说明"token 失效/不匹配"，而不是"没抽过卡"。
#[tauri::command]
pub async fn get_arknights_gacha_categories(
    account_state: State<'_, Arc<Mutex<AccountService>>>,
    arknights_gacha_state: State<'_, Arc<ArknightsGachaService>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    log_info!(
        "get_arknights_gacha_categories: START for role_id={}",
        role_id
    );
    let account = account_state.lock().await;
    let config_service = account.get_config_service().clone();

    let owner = lookup_role_owner(&config_service, &role_id).map_err(|e| {
        log_error!("get_arknights_gacha_categories: lookup failed: {}", e);
        e.to_string()
    })?;

    if !owner.is_arknights() {
        return Err(
            "This role belongs to Endfield. Use get_gacha_pool_meta instead.".to_string(),
        );
    }

    let u8token = fresh_u8token(&account, &owner, &role_id).await.map_err(|e| {
        log_error!("get_arknights_gacha_categories: prepare failed: {}", e);
        e.to_string()
    })?;

    let categories = arknights_gacha_state
        .get_categories(&u8token)
        .await
        .map_err(|e| {
            log_error!(
                "get_arknights_gacha_categories: FAILED for role_id={}: {}",
                role_id,
                e
            );
            e.to_string()
        })?;

    log_info!(
        "get_arknights_gacha_categories: SUCCESS for role_id={} ({} categories)",
        role_id,
        categories.len()
    );
    serde_json::to_value(categories).map_err(|e| e.to_string())
}

/// 从全量 Wiki 目录中按显示名补齐头像映射，返回本次新解析出的数量，
/// 并把仍未匹配的 id 保留在 `unresolved` 中。
///
/// 目录条目优先按 `brief.associate.type`（`char`/`weapon`）归类；新干员/武器在目录中
/// 可能仍是「预览」条目（`brief.associate` 为 `null`），此时按所属 typeSub 归类
/// （typeSub `id == "1"` 为干员、`"2"` 为武器），名称回退到 `brief.name` / `item.name`。
fn resolve_missing_from_catalog(
    catalog: &serde_json::Value,
    needed: &HashMap<String, String>,
    unresolved: &mut Vec<String>,
    map: &mut HashMap<String, String>,
) -> usize {
    let Some(catalog_arr) = catalog
        .get("data")
        .and_then(|d| d.get("catalog"))
        .and_then(|c| c.as_array())
    else {
        return 0;
    };

    // 构建 显示名 -> 图标 映射（角色/武器条目）
    let mut name_to_icon: HashMap<String, String> = HashMap::new();
    let mut char_count = 0usize;
    let mut weapon_count = 0usize;
    for entry in catalog_arr {
        let Some(type_subs) = entry.get("typeSub").and_then(|ts| ts.as_array()) else {
            continue;
        };
        for sub in type_subs {
            let sub_kind = match sub.get("id").and_then(|i| i.as_str()) {
                Some("1") => Some("char"),
                Some("2") => Some("weapon"),
                _ => None,
            };
            let Some(items) = sub.get("items").and_then(|i| i.as_array()) else {
                continue;
            };
            for item in items {
                let brief = item.get("brief");
                let associate = brief
                    .and_then(|b| b.get("associate"))
                    .and_then(|a| a.as_object());
                let kind = associate
                    .and_then(|a| a.get("type"))
                    .and_then(|t| t.as_str())
                    .filter(|k| *k == "char" || *k == "weapon")
                    .or(sub_kind);
                let Some(kind) = kind else {
                    continue;
                };
                let Some(cover) = brief.and_then(|b| b.get("cover")).and_then(|c| c.as_str())
                else {
                    continue;
                };
                let name = associate
                    .and_then(|a| a.get("name"))
                    .and_then(|n| n.as_str())
                    .or_else(|| brief.and_then(|b| b.get("name")).and_then(|n| n.as_str()))
                    .or_else(|| item.get("name").and_then(|n| n.as_str()));
                let Some(name) = name else {
                    continue;
                };
                let name = name.trim();
                let cover = cover.trim();
                if name.is_empty() || cover.is_empty() {
                    continue;
                }
                if kind == "char" {
                    char_count += 1;
                } else {
                    weapon_count += 1;
                }
                name_to_icon.insert(name.to_string(), cover.to_string());
            }
        }
    }
    log_info!(
        "resolve_gacha_avatar_map: catalog chars={} weapons={}",
        char_count,
        weapon_count
    );

    let mut resolved = 0usize;
    unresolved.retain(|id| {
        let Some(display_name) = needed.get(id) else {
            return false;
        };
        if display_name.is_empty() {
            return false;
        }
        if let Some(icon) = name_to_icon.get(display_name) {
            map.insert(id.clone(), icon.clone());
            resolved += 1;
            false
        } else {
            true
        }
    });
    resolved
}

/// 解析抽卡记录六星角色/武器的图标：
/// 1. 优先读取本地映射文件（gacha_avatar_map.json，与 app_config.json 同级）
/// 2. 缺失的先在本地 total.json 目录缓存中按名称匹配；缓存未覆盖全部缺失项且已过冷却期时，
///    重新拉取 /web/v1/wiki/item/catalog（typeMainId=1&onlyOnline=true）并覆盖缓存
/// 3. 目录条目按 brief.associate.type（char/weapon）归类，预览条目（associate 为 null）
///    则按 typeSub（id 1=干员、2=武器）归类，名称回退 brief.name / item.name，图标取 brief.cover
/// 4. 写回映射文件并返回完整映射
///
/// ⚠️ 《明日方舟》走**完全不同**的取图方式：它的 charId（`char_4109_baslin`）虽然也出现在
/// 明日方舟的 `charInfoMap` 里，但那份数据**没有图标地址**；而 `wiki_catalog`
/// （`/web/v1/wiki/item/catalog`）是终末地的 Wiki 目录，里面根本没有明日方舟干员。
/// 因此明日方舟直接按确定的 CDN 规则拼地址：
///
/// ```text
/// https://web.hycdn.cn/arknights/game/assets/char/avatar/{charId}.png
/// ```
///
/// 该地址已用真实干员验证（HTTP 200 + `image/png` + `Access-Control-Allow-Origin: *`），
/// 且是**幂等的纯函数**，不需要联网探测，因此明日方舟分支不发起任何请求。
#[tauri::command]
pub async fn resolve_gacha_avatar_map(
    account_state: State<'_, Arc<Mutex<AccountService>>>,
    gacha_state: State<'_, Arc<GachaService>>,
    arknights_gacha_state: State<'_, Arc<ArknightsGachaService>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    log_info!("resolve_gacha_avatar_map: START for role_id={}", role_id);
    let account = account_state.lock().await;
    let config_service = account.get_config_service().clone();

    let owner = lookup_role_owner(&config_service, &role_id).map_err(|e| {
        log_error!("resolve_gacha_avatar_map: lookup failed: {}", e);
        e.to_string()
    })?;

    // ---- 明日方舟：CDN 地址可直拼，无需联网 ----
    if owner.is_arknights() {
        let saved = arknights_gacha_state
            .load_records_or_empty(&owner.binding_uid)
            .map_err(|e| {
                log_error!("resolve_gacha_avatar_map: load records failed: {}", e);
                e.to_string()
            })?;

        let mut map: HashMap<String, String> = HashMap::new();
        for rec in &saved.records {
            // 六星 = rarity 6（已归一化为星数）
            if rec.is_draw() && rec.rarity == Some(6) {
                if let Some(cid) = &rec.char_id {
                    if cid.is_empty() {
                        continue;
                    }
                    map.entry(cid.clone())
                        .or_insert_with(|| arknights_avatar_url(cid));
                }
            }
        }
        log_info!(
            "resolve_gacha_avatar_map: arknights role {} -> {} six-star icons",
            role_id,
            map.len()
        );
        return serde_json::to_value(map).map_err(|e| e.to_string());
    }

    let (user_id, server_id) = (owner.user_id, owner.server_id);

    let saved = gacha_state
        .load_records_or_empty(&user_id, &server_id)
        .map_err(|e| {
            log_error!("resolve_gacha_avatar_map: load records failed: {}", e);
            e.to_string()
        })?;
    let weapon_saved = gacha_state
        .load_weapon_records_or_empty(&user_id, &server_id)
        .map_err(|e| {
            log_error!(
                "resolve_gacha_avatar_map: load weapon records failed: {}",
                e
            );
            e.to_string()
        })?;

    // 收集所有六星记录的角色/武器 id（id -> 显示名，用于匹配）
    let mut needed: HashMap<String, String> = HashMap::new();
    for rec in &saved.records {
        if rec.is_draw() && rec.rarity == Some(6) {
            if let Some(cid) = &rec.char_id {
                if cid.is_empty() {
                    continue;
                }
                let name = rec
                    .char_name
                    .clone()
                    .map(|n| n.trim().to_string())
                    .filter(|n| !n.is_empty())
                    .or_else(|| {
                        let n = rec.name_text.trim();
                        if n.is_empty() {
                            None
                        } else {
                            Some(n.to_string())
                        }
                    });
                needed
                    .entry(cid.clone())
                    .or_insert_with(|| name.unwrap_or_default());
            }
        }
    }
    for rec in &weapon_saved.records {
        if rec.is_draw() && rec.rarity == Some(6) {
            if let Some(wid) = &rec.weapon_id {
                if wid.is_empty() {
                    continue;
                }
                let name = rec
                    .weapon_name
                    .clone()
                    .map(|n| n.trim().to_string())
                    .filter(|n| !n.is_empty())
                    .or_else(|| {
                        let n = rec.name_text.trim();
                        if n.is_empty() {
                            None
                        } else {
                            Some(n.to_string())
                        }
                    });
                needed
                    .entry(wid.clone())
                    .or_insert_with(|| name.unwrap_or_default());
            }
        }
    }

    let mut map = gacha_state.load_avatar_map();

    let missing: Vec<String> = needed
        .keys()
        .filter(|cid| !map.contains_key(*cid))
        .cloned()
        .collect();

    if !missing.is_empty() {
        // 非致命：先尝试刷新 cred，保证 wiki catalog 请求可用
        if let Err(e) = account.check_and_refresh_user_cred(&user_id).await {
            log_warn!(
                "resolve_gacha_avatar_map: cred refresh failed (non-fatal) for user {}: {}",
                user_id,
                e
            );
        }

        // 全量 Wiki 目录（wiki_catalog：typeMainId=1&onlyOnline=true，含干员/武器等全部 typeSub 及 items）；
        // 优先本地 total.json 缓存（无效缓存会被 load_total_catalog 判空）解析，
        // 仍未覆盖的缺失项才按冷却期重新拉取并写盘。
        let catalog = gacha_state.load_total_catalog();
        let mut unresolved = missing.clone();
        let mut resolved = match &catalog {
            Some(cached) => {
                resolve_missing_from_catalog(cached, &needed, &mut unresolved, &mut map)
            }
            None => 0,
        };

        // 目录缓存是历史快照：新干员/武器可能在其后才加入（或在目录中仍是预览条目），
        // 因此缓存未能补齐全部缺失项时刷新一次；冷却期内不重复请求。
        if !unresolved.is_empty()
            && (catalog.is_none()
                || gacha_state.total_catalog_is_stale(TOTAL_CATALOG_REFRESH_COOLDOWN))
        {
            match account.query_role_data(&role_id, "wiki_catalog", &[]).await {
                Ok(result) => {
                    if let Some(raw) = result.get("__full__") {
                        if let Err(e) = gacha_state.save_total_catalog(raw) {
                            log_warn!("resolve_gacha_avatar_map: save total catalog failed: {}", e);
                        }
                        resolved +=
                            resolve_missing_from_catalog(raw, &needed, &mut unresolved, &mut map);
                    }
                }
                Err(e) => {
                    log_warn!(
                        "resolve_gacha_avatar_map: wiki_catalog query failed (non-fatal): {}",
                        e
                    );
                }
            }
        }

        log_info!(
            "resolve_gacha_avatar_map: missing={} resolved={} total_map={}",
            missing.len(),
            resolved,
            map.len()
        );

        if resolved > 0 {
            if let Err(e) = gacha_state.save_avatar_map(&map) {
                log_warn!("resolve_gacha_avatar_map: save map failed: {}", e);
            }
        }
    } else {
        log_info!("resolve_gacha_avatar_map: all avatars already mapped");
    }

    serde_json::to_value(map).map_err(|e| e.to_string())
}

/// 获取本地抽卡记录统计（总数/按卡池/按稀有度/按角色）
///
/// 按角色所属游戏分流读档；统计口径一致（`rarity` 已经是星数）。
#[tauri::command]
pub async fn get_gacha_record_stats(
    account_state: State<'_, Arc<Mutex<AccountService>>>,
    gacha_state: State<'_, Arc<GachaService>>,
    arknights_gacha_state: State<'_, Arc<ArknightsGachaService>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    log_info!("get_gacha_record_stats: START for role_id={}", role_id);
    let account = account_state.lock().await;
    let config_service = account.get_config_service().clone();

    let owner = lookup_role_owner(&config_service, &role_id).map_err(|e| {
        log_error!("get_gacha_record_stats: lookup failed: {}", e);
        e.to_string()
    })?;

    let saved = if owner.is_arknights() {
        arknights_gacha_state.load_records_or_empty(&owner.binding_uid)
    } else {
        gacha_state.load_records_or_empty(&owner.user_id, &owner.server_id)
    }
    .map_err(|e| {
        log_error!(
            "get_gacha_record_stats: FAILED for role_id={}: {}",
            role_id,
            e
        );
        e.to_string()
    })?;
    let records = &saved.records;

    let by_pool: HashMap<String, usize> = GachaService::group_records_by_pool(records)
        .into_iter()
        .map(|(k, v)| (k, v.len()))
        .collect();

    let stats = serde_json::json!({
        "user_id": saved.user_id,
        "server_id": saved.server_id,
        "last_sync_time": saved.last_sync_time,
        "total_records": records.len(),
        "total_draws": records.iter().filter(|r| r.is_draw()).count(),
        "total_gifts": records.iter().filter(|r| r.is_gift()).count(),
        "by_pool": by_pool,
        "by_rarity": GachaService::count_by_rarity(records),
        "by_char": GachaService::count_by_char(records),
    });

    log_info!("get_gacha_record_stats: SUCCESS for role_id={}", role_id);
    Ok(stats)
}

/// 《明日方舟》干员头像 CDN 地址
///
/// 规则固定、无需探测：`{AK_ASSET_BASE}/char/avatar/{charId}.png`。
/// 干员 id 形如 `char_4109_baslin`，与游戏内资源命名一致。
fn arknights_avatar_url(char_id: &str) -> String {
    format!(
        "https://web.hycdn.cn/arknights/game/assets/char/avatar/{}.png",
        char_id
    )
}

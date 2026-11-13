use std::path::PathBuf;
use std::sync::OnceLock;

/// 桌面数据目录的子目录名。移动端不用它：Tauri 的 `app_data_dir()` 已把
/// bundle identifier 拼进返回路径，直接作为覆盖值使用。
#[cfg(not(mobile))]
const APP_DIR: &str = "cn.msk-network.endprotocol";

/// 移动端（Android/iOS）数据目录覆盖值。
///
/// Android 应用进程没有 `$HOME`，XDG 相关目录全部缺失，`dirs` 系列一律返回
/// `None`，[app_data_dir] 会失败并导致配置/日志/机密/缓存全部不可用。因此应用
/// 启动时（`lib.rs` setup 最早一步）用 Tauri 路径解析器（`app.path().app_data_dir()`，
/// Android 上解析为 `{filesDir}/{bundle_identifier}`）注入真实目录，之后所有
/// `paths::*` 调用点无需改动。桌面端永远不设置此值，行为保持不变。
static DATA_DIR_OVERRIDE: OnceLock<PathBuf> = OnceLock::new();

/// 注入移动端应用数据目录（仅移动端由 `lib.rs` setup 调用；重复注入以首次为准）。
pub fn set_app_data_dir_override(dir: PathBuf) {
    let _ = DATA_DIR_OVERRIDE.set(dir);
}

/// 返回应用根数据目录
/// 桌面（统一使用 Local，不同步到 Roaming）：Windows `%LOCALAPPDATA%\cn.msk-network.endprotocol`
/// 移动端：Tauri 路径解析器注入的 `{filesDir}/cn.msk-network.endprotocol`
pub fn app_data_dir() -> Result<PathBuf, &'static str> {
    if let Some(dir) = DATA_DIR_OVERRIDE.get() {
        return Ok(dir.clone());
    }
    #[cfg(mobile)]
    {
        // 覆盖值尚未注入（仅可能发生在 Tauri setup 之前的极早期调用）。
        Err("Mobile app data directory is not initialized yet")
    }
    #[cfg(not(mobile))]
    {
        dirs::data_local_dir()
            .map(|d| d.join(APP_DIR))
            .ok_or("Failed to get local app data directory")
    }
}

/// 图片缓存目录
pub fn image_cache_dir() -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join("image_cache"))
}

/// 背景图片目录
pub fn backgrounds_dir() -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join("backgrounds"))
}

/// Wiki 详情缓存目录
pub fn wiki_detail_cache_dir() -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join("wiki_detail_cache"))
}

/// 日志目录
pub fn log_dir() -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join("logs"))
}

/// 配置文件路径
pub fn config_file_path() -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join("app_config.json"))
}

/// 机密数据降级存储路径（AES-256-GCM 加密文件，仅在 OS 凭据库不可用时使用）
pub fn secret_file_path() -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join("secrets.enc"))
}

/// 网络请求录制目录
pub fn capture_dir() -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join("network_capture"))
}

/// 抽卡记录文件路径（gacha_records 子目录，按 userId+serverId 区分）
pub fn gacha_records_file_path(user_id: &str, server_id: &str) -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| {
        d.join("gacha_records")
            .join(format!("gacha_records_{}_{}.json", user_id, server_id))
    })
}

/// 武器寻访记录文件路径（gacha_records 子目录，按 userId+serverId 区分）
pub fn gacha_weapon_records_file_path(
    user_id: &str,
    server_id: &str,
) -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| {
        d.join("gacha_records").join(format!(
            "gacha_weapon_records_{}_{}.json",
            user_id, server_id
        ))
    })
}

/// 全量 Wiki 目录（total.json）缓存路径（gacha_records 子目录，全局共用）
pub fn gacha_total_catalog_file_path() -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join("gacha_records").join("total.json"))
}

/// 《明日方舟》寻访记录文件路径（gacha_records 子目录）
///
/// **只按渠道绑定 uid 分文件**，不带 serverId —— 与终末地（`{userId}_{serverId}.json`）
/// 刻意不同：明日方舟的 `/api/gacha/history` 不接受 `server_id`，同一把 u8token
/// （= 同一个 uid）下就是一条连续流水，官服/B服不会混在一起，因为它们的 uid 本来就不同。
///
/// 另起文件名前缀还有个原因：官服的明日方舟角色与终末地角色的 `serverId` 都是 `1`，
/// 若沿用 `gacha_records_{userId}_{serverId}.json` 会**互相覆盖**。
pub fn arknights_gacha_records_file_path(uid: &str) -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| {
        d.join("gacha_records")
            .join(format!("arknights_gacha_records_{}.json", uid))
    })
}

/// 旧版抽卡记录文件路径（与 app_config.json 同级），仅用于存量数据兼容读取
pub fn gacha_records_file_path_legacy(
    user_id: &str,
    server_id: &str,
) -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join(format!("gacha_records_{}_{}.json", user_id, server_id)))
}

/// 抽卡记录角色 id -> 头像映射文件路径（与 app_config.json 同级）
pub fn gacha_avatar_map_file_path() -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join("gacha_avatar_map.json"))
}

/// 《明日方舟》数据缓存目录
///
/// `player/info` 单账号就有几百 KB（实测 B 服账号 242 名干员约 600 KB），
/// 塞进 `app_config.json` 会让每次配置读写都搬运这份数据，因此**独立成文件**——
/// 与抽卡记录（`gacha_records/`）同一套做法。
/// 目录内的文件名由 [`crate::services::arknights_service::ArknightsService`] 决定。
pub fn arknights_cache_dir() -> Result<PathBuf, &'static str> {
    app_data_dir().map(|d| d.join("arknights"))
}

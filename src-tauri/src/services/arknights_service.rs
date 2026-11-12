//! 《明日方舟》数据服务 —— 森空岛 player/info、cultivate、attendance 的拉取、解析与缓存。
//!
//! # 与终末地的差异
//!
//! | | 终末地 | 明日方舟 |
//! | --- | --- | --- |
//! | 寻址 | `roleId + serverId + userId` | **渠道绑定 uid**（`?uid=`） |
//! | 端点 | `/api/v1/game/endfield/card/detail` | `/api/v1/game/player/info`、`/cultivate/player` |
//! | 粒度 | 一次一个角色 | 一次整个账号（干员+基建+任务+剿灭+保全） |
//! | 额外头 | `sk-game-role: 3_{roleId}_{serverId}` | 无 |
//!
//! 签名完全复用 [`SklandService::call_skland_api`]（dId + HMAC-SHA256 + MD5 + 重试 + 熔断），
//! 不需要第二套 HTTP 栈。
//!
//! # 响应是明文
//!
//! 森空岛所有数据接口返回明文 JSON。仓库里的 AES/3DES 代码（`skland-api/api/sm.py`）
//! 只用于**生成 dId**（数美设备指纹的请求体加密），与响应无关 —— 这一点已用真实账号验证：
//! `player/info`、`cultivate`、`attendance` 三个接口全部 `code=0` 且字段可直接读取。
//!
//! # 缓存
//!
//! 持久化到 **独立文件** 而不是 `app_config.json`：
//! `<app_data>/arknights/player_info_{uid}.json`（结构见 [`ArknightsCacheEntry`]）。
//! 理由：单账号 `player/info` 实测就有几百 KB（B 服 242 名干员约 600 KB），
//! 放进 `app_config.json` 会让每次配置读写都搬运它。这与抽卡记录
//! （`gacha_records/` 子目录）是同一套做法。
//!
//! 另外还有两层：
//! - **内存缓存**（`memory`）：命中即返回，避免反复读文件 + 反序列化
//! - **原始响应留档**：`<app_data>/arknights/raw_{kind}_{uid}.json`，
//!   接口字段变更时可以直接比对，不影响正常读取路径

use std::sync::{Arc, Mutex};

use super::avatar_cache_service::{register_url_subdir, AvatarCacheService, ImageType};
use super::skland_service::SklandService;
use crate::models::arknights::{
    ArknightsAttendance, ArknightsAttendanceResult, ArknightsCultivate, ArknightsPlayerInfo,
};
use crate::utils::{paths, AppError};
use crate::{log_debug, log_info, log_warn};

/// 缓存里保存的一条记录
#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ArknightsCacheEntry<T> {
    /// 写入时间（Unix 秒）
    pub cached_at: i64,
    /// 森空岛侧的数据生成时间（`player/info` 的 `status.storeTs`）
    pub store_ts: i64,
    /// 解析后的数据
    pub data: T,
}

/// 明日方舟数据服务
#[derive(Clone)]
pub struct ArknightsService {
    skland: Arc<SklandService>,
    avatar_cache_service: Arc<AvatarCacheService>,
    /// 缓存目录（默认 `<app_data>/arknights`，测试可注入临时目录）
    cache_dir: Arc<std::path::PathBuf>,
    /// 内存缓存：uid → 解析后的 player/info
    memory: Arc<Mutex<std::collections::HashMap<String, ArknightsPlayerInfo>>>,
}

fn now_unix_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

impl ArknightsService {
    pub fn new(skland: Arc<SklandService>, avatar_cache_service: Arc<AvatarCacheService>) -> Self {
        let cache_dir = paths::arknights_cache_dir()
            .unwrap_or_else(|_| std::path::PathBuf::from("arknights"));
        Self::with_cache_dir(skland, avatar_cache_service, cache_dir)
    }

    /// 指定缓存目录（测试用，避免污染真实用户数据目录）
    pub fn with_cache_dir(
        skland: Arc<SklandService>,
        avatar_cache_service: Arc<AvatarCacheService>,
        cache_dir: std::path::PathBuf,
    ) -> Self {
        Self {
            skland,
            avatar_cache_service,
            cache_dir: Arc::new(cache_dir),
            memory: Arc::new(Mutex::new(std::collections::HashMap::new())),
        }
    }

    /// 解析后的 player/info 缓存文件路径
    fn player_info_path(&self, uid: &str) -> std::path::PathBuf {
        self.cache_dir.join(format!("player_info_{}.json", uid))
    }

    /// 原始响应留档路径
    fn raw_path(&self, kind: &str, uid: &str) -> std::path::PathBuf {
        self.cache_dir.join(format!("raw_{}_{}.json", kind, uid))
    }

    // ---------------- 缓存读写 ----------------

    /// 只读磁盘缓存（不查内存）。文件缺失或损坏都返回 `None`。
    pub fn read_cache_file(&self, uid: &str) -> Option<ArknightsPlayerInfo> {
        let path = self.player_info_path(uid);
        if !path.exists() {
            return None;
        }

        let content = match std::fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) => {
                log_warn!("arknights cache read failed ({}): {}", path.display(), error);
                return None;
            }
        };

        match serde_json::from_str::<ArknightsCacheEntry<ArknightsPlayerInfo>>(&content) {
            Ok(entry) => {
                log_debug!(
                    "arknights cache read: uid={}, cached_at={}, storeTs={}",
                    uid,
                    entry.cached_at,
                    entry.store_ts
                );
                Some(entry.data)
            }
            Err(error) => {
                // 文件损坏（例如上次写到一半）：删掉它，下次重新拉
                log_warn!(
                    "arknights cache parse failed for uid={} ({}): {}",
                    uid,
                    path.display(),
                    error
                );
                let _ = std::fs::remove_file(&path);
                None
            }
        }
    }

    /// 只写磁盘缓存（不碰内存、不下载头像）
    pub fn write_cache_file(
        &self,
        uid: &str,
        info: &ArknightsPlayerInfo,
    ) -> Result<(), AppError> {
        std::fs::create_dir_all(self.cache_dir.as_ref())?;
        let entry = ArknightsCacheEntry {
            cached_at: now_unix_secs(),
            store_ts: info.status.store_ts,
            data: info.clone(),
        };
        let content = serde_json::to_string_pretty(&entry).map_err(|error| {
            AppError::ConfigError {
                message: format!("Failed to serialize arknights player info: {}", error),
            }
        })?;
        std::fs::write(self.player_info_path(uid), content)?;
        Ok(())
    }

    /// 读缓存：内存优先，未命中读磁盘（读到的会回填内存）
    pub fn get_cached_player_info(&self, uid: &str) -> Option<ArknightsPlayerInfo> {
        if let Some(cached) = self.memory.lock().unwrap().get(uid) {
            return Some(cached.clone());
        }

        let info = self.read_cache_file(uid)?;
        self.memory
            .lock()
            .unwrap()
            .insert(uid.to_string(), info.clone());
        Some(info)
    }

    /// 把解析后的 player/info 写入内存 + 磁盘
    ///
    /// 头像在这里就转成 base64 一起存（与终末地 `save_selected_roles` 的做法一致），
    /// 这样账户列表直接能用，不必再发请求。
    pub async fn cache_player_info(
        &self,
        uid: &str,
        info: &ArknightsPlayerInfo,
    ) -> Result<(), AppError> {
        let mut info = info.clone();

        // 头像落盘为 base64（明日方舟头像只在 player/info 里，终末地的 base.avatarUrl 对它无效）
        if let Some(avatar) = info.status.avatar.as_mut() {
            if !avatar.url.is_empty() {
                register_url_subdir(&avatar.url, ImageType::Avatar.dir_name());
                match self
                    .avatar_cache_service
                    .get_or_download_avatar(&avatar.url)
                    .await
                {
                    Ok(base64) => {
                        log_debug!(
                            "arknights avatar cached for uid={} (base64 len={})",
                            uid,
                            base64.len()
                        );
                        avatar.base64 = Some(base64);
                    }
                    Err(error) => {
                        log_warn!("arknights avatar download failed for uid={}: {}", uid, error);
                    }
                }
            }
        }

        self.memory
            .lock()
            .unwrap()
            .insert(uid.to_string(), info.clone());
        self.write_cache_file(uid, &info)?;

        log_info!(
            "arknights player info cached for uid={} (storeTs={}, file={})",
            uid,
            info.status.store_ts,
            self.player_info_path(uid).display()
        );
        Ok(())
    }

    /// 原始响应留档（排查用：接口字段变更时可直接比对）
    fn cache_raw(&self, uid: &str, kind: &str, value: &serde_json::Value) {
        let path = self.raw_path(kind, uid);
        if let Some(parent) = path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                log_warn!("arknights raw cache mkdir failed: {}", error);
                return;
            }
        }
        match serde_json::to_string_pretty(value) {
            Ok(content) => {
                if let Err(error) = std::fs::write(&path, content) {
                    log_warn!(
                        "arknights raw cache write failed ({}): {}",
                        path.display(),
                        error
                    );
                }
            }
            Err(error) => {
                log_warn!("arknights raw cache serialize failed: {}", error);
            }
        }
    }

    // ---------------- 网络 ----------------
    /// 拉取玩家全量数据（干员养成 + 基建 + 任务 + 剿灭 + 保全 + 公招）
    ///
    /// `GET /api/v1/game/player/info?uid={uid}`
    ///
    /// `uid` 是**渠道绑定 uid**（`roles[].bindingUid`），不是 roleId、不是森空岛 userId。
    /// 官服与 B 服各有自己的 uid，同一个通行证下互不通用（实测也不会碰撞）。
    pub async fn fetch_player_info(
        &self,
        cred: &str,
        token: &str,
        uid: &str,
    ) -> Result<ArknightsPlayerInfo, AppError> {
        if uid.trim().is_empty() {
            return Err(AppError::AuthError {
                message: "arknights player/info requires a binding uid".to_string(),
            });
        }

        let path = "/api/v1/game/player/info";
        let query = format!("uid={}", uid);
        let json = self
            .skland
            .call_skland_api("GET", path, Some(&query), None, cred, token, vec![])
            .await?;

        // 原始响应留档
        self.cache_raw(uid, "player_info", &json);

        let data = json.get("data").ok_or_else(|| AppError::AuthError {
            message: "data not found in arknights player/info response".to_string(),
        })?;

        let mut info: ArknightsPlayerInfo =
            serde_json::from_value(data.clone()).map_err(|error| AppError::AuthError {
                message: format!("Failed to parse ArknightsPlayerInfo: {}", error),
            })?;

        // 打上结构版本标记：前端据此判断缓存是否为旧格式（缺失章节进度等新字段）
        info.data_version = crate::models::arknights::ARKNIGHTS_DATA_VERSION;

        log_info!(
            "arknights player/info: name={}, level={}, chars={}, storeTs={}",
            info.status.name,
            info.status.level,
            info.chars.len(),
            info.status.store_ts
        );
        Ok(info)
    }

    /// 拉取并按 uid 缓存（绑定账户、刷新账户时用这个）
    pub async fn refresh_player_info(
        &self,
        cred: &str,
        token: &str,
        uid: &str,
    ) -> Result<ArknightsPlayerInfo, AppError> {
        let info = self.fetch_player_info(cred, token, uid).await?;
        self.cache_player_info(uid, &info).await?;
        Ok(info)
    }

    /// 拉取养成数据（干员 + 仓库）
    ///
    /// `GET /api/v1/game/cultivate/player?uid={uid}`
    ///
    /// 注意：干员养成 [`Self::fetch_player_info`] 已经全给了（还多了信赖/皮肤），
    /// 这个接口的**唯一增量是仓库 `items`**。只想要仓库时才调它。
    pub async fn fetch_cultivate(
        &self,
        cred: &str,
        token: &str,
        uid: &str,
    ) -> Result<ArknightsCultivate, AppError> {
        let path = "/api/v1/game/cultivate/player";
        let query = format!("uid={}", uid);
        let json = self
            .skland
            .call_skland_api("GET", path, Some(&query), None, cred, token, vec![])
            .await?;

        self.cache_raw(uid, "cultivate", &json);

        let data = json.get("data").ok_or_else(|| AppError::AuthError {
            message: "data not found in arknights cultivate response".to_string(),
        })?;

        let cultivate: ArknightsCultivate =
            serde_json::from_value(data.clone()).map_err(|error| AppError::AuthError {
                message: format!("Failed to parse ArknightsCultivate: {}", error),
            })?;

        log_info!(
            "arknights cultivate: chars={}, items={}",
            cultivate.characters.len(),
            cultivate.items.len()
        );
        Ok(cultivate)
    }

    /// 查询签到状态与本月签到日历
    ///
    /// `GET /api/v1/game/attendance?gameId=1&uid={uid}`
    ///
    /// ⚠️ 抓包（2026-11-11 22:03）确认官方客户端带 `gameId=1`，且它排在 `uid` **之前**。
    /// 参数顺序会影响 `sign`（GET 的签名输入就是整条 query string），所以顺序照抄。
    ///
    /// 响应 `data` = `{currentTs, calendar[30], first, records, resourceInfoMap}`。
    /// `resourceInfoMap` **不含 `icon`**，这里按 `resourceId` 拼好 CDN 地址；
    /// 同时算出 `hasToday` / `todayIndex` / `tomorrowIndex` 一并下发，
    /// 免得前端再自己推（早先前端用「今天几号」去索引日历，是错的）。
    pub async fn attendance_status(
        &self,
        cred: &str,
        token: &str,
        uid: &str,
    ) -> Result<ArknightsAttendance, AppError> {
        let path = "/api/v1/game/attendance";
        let query = format!("gameId=1&uid={}", uid);
        let json = self
            .skland
            .call_skland_api("GET", path, Some(&query), None, cred, token, vec![])
            .await?;

        self.cache_raw(uid, "attendance", &json);

        let data = json.get("data").ok_or_else(|| AppError::AuthError {
            message: "data not found in arknights attendance response".to_string(),
        })?;

        let mut attendance: ArknightsAttendance =
            serde_json::from_value(data.clone()).map_err(|error| AppError::AuthError {
                message: format!("Failed to parse ArknightsAttendance: {}", error),
            })?;

        // 图标按 resourceId 补；派生字段（hasToday / todayIndex / tomorrowIndex）算好
        attendance.fill_resource_icons();
        attendance.fill_derived();

        log_info!(
            "arknights attendance: records={}, calendar={}, hasToday={}, todayIndex={:?}, tomorrowIndex={:?}",
            attendance.records.len(),
            attendance.calendar.len(),
            attendance.has_today,
            attendance.today_index,
            attendance.tomorrow_index
        );
        Ok(attendance)
    }

    /// 执行签到
    ///
    /// `POST /api/v1/game/attendance`，body `{ "gameId": 1, "uid": "<uid>" }`
    ///
    /// 与终末地的 `/web/v1/game/endfield/attendance`（靠 `sk-game-role` 头寻址）完全不同：
    /// 明日方舟把 `gameId` + `uid` 放在 **body** 里。
    ///
    /// 若今天已签到，接口返回「请勿重复签到」类业务码（`10001`），
    /// [`SklandService::call_skland_api`] 把它当幂等成功原样返回；这里折成
    /// `alreadySigned = true` + 空 `awards`，让前端能区分「真签到」与「今天已经签过」。
    pub async fn do_attendance(
        &self,
        cred: &str,
        token: &str,
        uid: &str,
    ) -> Result<ArknightsAttendanceResult, AppError> {
        let path = "/api/v1/game/attendance";
        let body = serde_json::json!({
            "gameId": 1,
            "uid": uid,
        });

        let json = self
            .skland
            .call_skland_api("POST", path, None, Some(body), cred, token, vec![])
            .await?;

        let code = json.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        let message = json
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or_default()
            .to_string();

        // 非 0（「请勿重复签到」）→ 幂等成功，没有真实奖励
        if code != 0 {
            log_info!(
                "arknights do_attendance: benign result for uid={} (code={}, message={})",
                uid,
                code,
                message
            );
            return Ok(ArknightsAttendanceResult {
                already_signed: true,
                code,
                message,
                ..Default::default()
            });
        }

        let data = json.get("data").cloned().unwrap_or(serde_json::Value::Null);
        let mut result: ArknightsAttendanceResult =
            serde_json::from_value(data).unwrap_or_default();
        result.code = code;
        result.message = message;
        result.already_signed = false;

        // 奖励图标同样按 resourceId 拼 CDN 地址
        let mut awards = std::mem::take(&mut result.awards);
        for award in &mut awards {
            award.fill_icon();
        }
        result.awards = awards;
        let mut tomorrow = std::mem::take(&mut result.tomorrow_awards);
        for award in &mut tomorrow {
            award.fill_icon();
        }
        result.tomorrow_awards = tomorrow;

        log_info!(
            "arknights do_attendance: uid={} awards={}, tomorrow={}",
            uid,
            result.awards.len(),
            result.tomorrow_awards.len()
        );
        Ok(result)
    }

    /// 清空某个 uid 的全部缓存（解绑角色 / 删除账户时调用）
    pub fn clear_cache(&self, uid: &str) {
        self.memory.lock().unwrap().remove(uid);

        let mut removed = 0usize;
        for kind in ["player_info", "cultivate", "attendance"] {
            let path = self.raw_path(kind, uid);
            if path.exists() && std::fs::remove_file(&path).is_ok() {
                removed += 1;
            }
        }
        let path = self.player_info_path(uid);
        if path.exists() && std::fs::remove_file(&path).is_ok() {
            removed += 1;
        }

        log_info!(
            "arknights cache cleared for uid={} ({} file(s) removed)",
            uid,
            removed
        );
    }
}

// ---------------------------------------------------------------------------
// 缓存层测试（不联网：只验证文件的写入 / 读取 / 清理）
// ---------------------------------------------------------------------------
//
// 「把解析好的 info 保存下来，以后要用的地方直接取」是这套缓存的核心诉求，
// 因此这里覆盖：写入后能读回同样内容、内存未命中时能回退到磁盘、
// 文件损坏不会崩而是自愈、clear 之后彻底消失。
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::arknights::ArknightsPlayerInfo;

    const PLAYER_INFO: &str = include_str!("../../tests/fixtures/arknights/player_info.json");

    fn fixture_info() -> ArknightsPlayerInfo {
        let root: serde_json::Value = serde_json::from_str(PLAYER_INFO).unwrap();
        serde_json::from_value(root.get("data").unwrap().clone()).unwrap()
    }

    /// 造一个指向**独占临时目录**的服务（`avatar_cache_service` 不会被这些测试用到）
    ///
    /// 目录名必须每个测试都唯一：只靠 `process::id()` + 秒级时间戳的话，
    /// 并行跑时多个测试会共用同一个目录，其中一个的 `remove_dir_all` 会把
    /// 另一个正在用的文件删掉（表现为「单独跑通过、一起跑失败」）。
    fn temp_service() -> (ArknightsService, std::path::PathBuf) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);

        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!(
            "endprotocol-ak-test-{}-{}-{}",
            std::process::id(),
            nanos,
            unique
        ));
        std::fs::create_dir_all(&dir).unwrap();

        let config = crate::services::config_service::ConfigService::new().unwrap();
        let skland = Arc::new(SklandService::new(Arc::new(Mutex::new(config))));
        let avatar = Arc::new(AvatarCacheService::new().unwrap());

        (
            ArknightsService::with_cache_dir(skland, avatar, dir.clone()),
            dir,
        )
    }

    #[test]
    fn write_then_read_round_trips() {
        let (service, dir) = temp_service();
        let info = fixture_info();

        service.write_cache_file("700000001", &info).unwrap();

        // 文件真的落盘了
        let path = dir.join("player_info_700000001.json");
        assert!(path.exists(), "缓存文件没写出来: {}", path.display());

        // 只读文件路径（不查内存）也要能拿到
        let from_disk = service
            .read_cache_file("700000001")
            .expect("read_cache_file 返回 None");
        assert_eq!(from_disk.status.name, info.status.name);
        assert_eq!(from_disk.status.level, info.status.level);
        assert_eq!(from_disk.chars.len(), info.chars.len());
        assert_eq!(
            from_disk.status.avatar.as_ref().map(|a| a.url.clone()),
            info.status.avatar.as_ref().map(|a| a.url.clone())
        );
        // 关键回归点也要能穿过文件层：夹具取自 B 服账号，
        // hire/training 是对象且含浮点（speed=1.35 / remainPoint=0.45）。
        // 浮点字段如果被声明成整型，这里就会读成 None。
        assert!(
            from_disk.building.hire.is_some(),
            "hire 在文件往返后丢了"
        );
        let training = from_disk
            .building
            .training
            .expect("training 在文件往返后丢了");
        assert!(
            (training.speed - 1.35).abs() < 1e-9,
            "浮点 speed 穿过文件层后失真: {}",
            training.speed
        );

        service.clear_cache("700000001");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn get_cached_falls_back_to_disk_and_fills_memory() {
        let (service, dir) = temp_service();

        // 先只写文件，不经过内存
        service.write_cache_file("123", &fixture_info()).unwrap();
        assert!(
            service.memory.lock().unwrap().get("123").is_none(),
            "write_cache_file 不该碰内存"
        );

        // 第一次读：走磁盘并回填内存
        let first = service.get_cached_player_info("123").expect("磁盘命中失败");
        // 夹具取自 B 服账号（等级 85）
        assert_eq!(first.status.level, 85);
        assert!(
            service.memory.lock().unwrap().contains_key("123"),
            "读磁盘后应回填内存"
        );

        // 未写过的 uid：返回 None 而不是报错
        assert!(service.get_cached_player_info("no-such-uid").is_none());

        service.clear_cache("123");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_cache_file_is_removed_and_returns_none() {
        let (service, dir) = temp_service();
        let path = dir.join("player_info_broken.json");
        std::fs::write(&path, "{ this is not json").unwrap();

        // 损坏文件不应 panic，也不应返回半截数据
        assert!(service.read_cache_file("broken").is_none());
        // 并且会被自愈删掉，避免下次继续踩
        assert!(!path.exists(), "损坏的缓存文件应被删除");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn clear_cache_removes_file_and_memory() {
        let (service, dir) = temp_service();
        service.write_cache_file("999", &fixture_info()).unwrap();
        // 让它进内存
        let _ = service.get_cached_player_info("999");
        assert!(service.memory.lock().unwrap().contains_key("999"));

        service.clear_cache("999");

        assert!(!service.memory.lock().unwrap().contains_key("999"));
        assert!(!dir.join("player_info_999.json").exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn raw_dump_is_written_next_to_cache() {        let (service, dir) = temp_service();
        service.cache_raw("555", "player_info", &serde_json::json!({"code": 0}));

        let path = dir.join("raw_player_info_555.json");
        assert!(path.exists(), "原始响应留档没写出来: {}", path.display());

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("\"code\""));

        service.clear_cache("555");
        assert!(!path.exists(), "clear_cache 应连带清掉留档");

        let _ = std::fs::remove_dir_all(&dir);
    }
}

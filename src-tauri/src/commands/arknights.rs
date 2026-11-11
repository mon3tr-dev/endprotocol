//! 《明日方舟》数据命令
//!
//! 这一组命令与终末地的 `query_role_data` 平行：终末地按 `roleId + serverId`
//! 走 `/api/v1/game/endfield/card/detail`，明日方舟按**渠道绑定 uid** 走
//! `/api/v1/game/player/info`、`/cultivate/player`、`/attendance`。
//!
//! 全部以 `role_id` 作入口（前端只认角色的 roleId），由 `AccountService` 内部
//! 反查出该角色所属的森空岛账户与渠道绑定 uid。

use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::services::account_service::AccountService;
use crate::{log_error, log_info};

/// 获取《明日方舟》玩家全量数据
///
/// 返回 `ArknightsPlayerInfo` 的 JSON：`status`（昵称/等级/理智/头像）、
/// `chars[]`（干员养成）、`building`（基建，`hire`/`training` 可能为 null）、
/// `routine`（任务）、`campaign`（剿灭）、`tower`（保全）、`recruit`（公招）。
///
/// `force = true` 强制联网刷新；默认先用缓存（绑定账户时已拉过一次）。
#[tauri::command]
pub async fn get_arknights_player_info(
    state: State<'_, Arc<Mutex<AccountService>>>,
    role_id: String,
    force: Option<bool>,
) -> Result<serde_json::Value, String> {
    let service = state.lock().await;
    service
        .get_arknights_player_info(role_id, force.unwrap_or(false))
        .await
        .map_err(|error| error.to_string())
}

/// 获取《明日方舟》养成数据（干员 + 仓库）
///
/// 干员养成 `player/info` 已经全给了，这个接口的**唯一增量是仓库 `items`**。
#[tauri::command]
pub async fn get_arknights_cultivate(
    state: State<'_, Arc<Mutex<AccountService>>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    let service = state.lock().await;
    service
        .get_arknights_cultivate(role_id)
        .await
        .map_err(|error| error.to_string())
}

/// 获取《明日方舟》签到状态（含本月日历、已签到记录与派生标记）
///
/// 返回值在接口原始字段之外还带三项**后端计算好的**字段，前端直接可用：
/// - `hasToday`：今天是否已签到（等价终末地的 `hasToday`）
/// - `todayIndex` / `tomorrowIndex`：今日 / 明日奖励在 `calendar` 里的下标
///
/// ⚠️ `calendar` 是**累计 30 格领取轨道**，下标与「几号」无关（11 号 ≠ 下标 10）。
/// 判「今天签没签」只能看「有没有 `available && !done` 的格子」。
#[tauri::command]
pub async fn get_arknights_attendance(
    state: State<'_, Arc<Mutex<AccountService>>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    let service = state.lock().await;
    service
        .get_arknights_attendance(role_id)
        .await
        .map_err(|error| error.to_string())
}

/// 执行《明日方舟》签到
///
/// 返回 `ArknightsAttendanceResult`：
/// - 真签到：`code = 0`、`alreadySigned = false`，`awards[]` 为本次奖励，
///   `tomorrowAwards` 为明日奖励（接口给单对象）
/// - 今天已签过：`alreadySigned = true`、`awards` 为空（幂等成功，不是错误）
///
/// 所有奖励的 `resource.icon` 已由后端按 `resourceId` 补成
/// `https://web.hycdn.cn/arknights/game/assets/item/{id}.png`。
#[tauri::command]
pub async fn do_arknights_attendance(
    state: State<'_, Arc<Mutex<AccountService>>>,
    role_id: String,
) -> Result<serde_json::Value, String> {
    let service = state.lock().await;
    service
        .do_arknights_attendance(role_id)
        .await
        .map_err(|error| error.to_string())
}

/// 单个角色的签到结果（批量签到用）
///
/// **不让一个角色失败打断整批**：每个角色独立返回 `ok`，前端据此逐行展示
/// 「成功 / 已签到 / 失败原因」，而不是整批报错或静默部分成功。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAttendanceItem {
    /// 角色（账户）id
    pub role_id: String,
    /// 是否成功（含「今天已签过」这种幂等成功）
    pub ok: bool,
    /// 是否属于「今天已经签过」的幂等结果
    pub already_signed: bool,
    /// 失败原因（`ok == false` 时才有意义）
    pub error: Option<String>,
}

/// 批量签到：对给定的角色列表逐个执行签到
///
/// 两个游戏**混在一起也能处理** —— 每个角色由 `AccountService` 内部按 `app`
/// 字段自行分流（明日方舟走 `POST /api/v1/game/attendance`，
/// 终末地走 `/web/v1/game/endfield/attendance`），前端无需先分组。
///
/// 串行执行：森空岛的签名/设备指纹链路对并发较敏感，且批量场景下用户对
/// 总耗时并不敏感，稳定性优先。
#[tauri::command]
pub async fn do_batch_attendance(
    state: State<'_, Arc<Mutex<AccountService>>>,
    role_ids: Vec<String>,
) -> Result<Vec<BatchAttendanceItem>, String> {
    log_info!("do_batch_attendance: START, {} role(s)", role_ids.len());

    let mut results = Vec::with_capacity(role_ids.len());
    for role_id in role_ids {
        // 每个角色单独持锁：签到要发网络请求，长时间占着全局锁会把整个账户服务卡住
        let outcome = {
            let service = state.lock().await;
            service.do_attendance_for_role(&role_id).await
        };

        match outcome {
            Ok(()) => {
                log_info!("do_batch_attendance: role {} signed (or already signed)", role_id);
                results.push(BatchAttendanceItem {
                    role_id,
                    ok: true,
                    already_signed: false,
                    error: None,
                });
            }
            Err(error) => {
                let message = error.to_string();
                log_error!("do_batch_attendance: role {} FAILED: {}", role_id, message);
                results.push(BatchAttendanceItem {
                    role_id,
                    ok: false,
                    already_signed: false,
                    error: Some(message),
                });
            }
        }
    }

    log_info!(
        "do_batch_attendance: DONE, {} ok / {} total",
        results.iter().filter(|item| item.ok).count(),
        results.len()
    );
    Ok(results)
}

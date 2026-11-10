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

/// 获取《明日方舟》签到状态（含本月日历与已签到记录）
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

/// 执行《明日方舟》签到，返回本次发放的奖励列表
///
/// 今天已签到时不报错：返回空数组（接口的幂等结果由后端识别）。
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

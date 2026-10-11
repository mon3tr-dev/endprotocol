use std::sync::{Arc, Mutex};
use tauri::State;

use crate::services::system_resource_service::{SystemResourceService, SystemSnapshot};

/// 采集一次本机系统资源快照（CPU / 内存 / GPU / 磁盘 / 网络）。
///
/// 采集是同步且开销可控的，但仍放到 blocking 线程池执行，避免高频轮询阻塞 UI 相关的异步任务。
#[tauri::command]
pub async fn get_system_snapshot(
    state: State<'_, Arc<Mutex<SystemResourceService>>>,
) -> Result<SystemSnapshot, String> {
    let service = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = service.lock().map_err(|e| e.to_string())?;
        Ok::<SystemSnapshot, String>(guard.snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}

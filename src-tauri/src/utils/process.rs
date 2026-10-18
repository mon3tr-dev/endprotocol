//! 进程探测辅助。
//!
//! 供 `launcher_check_game_running` 命令与游戏运行时长统计共用。

/// 查询指定进程名当前是否在运行。
///
/// Windows 下使用 `tasklist` 过滤镜像名；其它平台始终返回 `false`（游戏仅支持 Windows）。
pub async fn is_process_running(process_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        let mut command = tokio::process::Command::new("tasklist");
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        match command
            .args(["/FI", &format!("IMAGENAME eq {process_name}"), "/NH"])
            .output()
            .await
        {
            Ok(output) => String::from_utf8_lossy(&output.stdout).contains(process_name),
            Err(error) => {
                tracing::debug!("[process] tasklist failed for {process_name}: {error}");
                false
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = process_name;
        false
    }
}

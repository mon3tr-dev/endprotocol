//! 进程探测与结束辅助。
//!
//! 供 `launcher_check_game_running` / `launcher_kill_game` 命令、驻守等待与游戏运行时长
//! 统计共用。

/// 查询指定进程名当前是否真的在运行。
///
/// Windows 下先用 `tasklist` 枚举同名进程，再要求进程满足以下任一条件：
/// - 拥有至少一个顶层窗口（正常游戏进程）；
/// - 进程创建时间在启动宽限期内（仍在启动、尚未创建窗口）。
///
/// 崩溃或挂起后残留的无窗口进程（例如 Application Hang 后仍保持 `STILL_ACTIVE` 的
/// 游戏进程）会被排除，避免界面与时长统计误报「游戏中」。
pub async fn is_process_running(process_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        match list_process_ids_async(process_name).await {
            Some(pids) if !pids.is_empty() => pids
                .into_iter()
                .any(|pid| has_top_level_window(pid) || process_is_starting(pid)),
            Some(_) => false,
            None => false,
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = process_name;
        false
    }
}

/// 进程创建后多久内即使没有窗口也视为「正在启动」。
#[cfg(target_os = "windows")]
const STARTUP_GRACE_SECONDS: u64 = 90;

#[cfg(target_os = "windows")]
async fn list_process_ids_async(process_name: &str) -> Option<Vec<u32>> {
    let mut command = tokio::process::Command::new("tasklist");
    command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
    let output = command
        .args([
            "/FI",
            &format!("IMAGENAME eq {process_name}"),
            "/FO",
            "CSV",
            "/NH",
        ])
        .output()
        .await
        .map_err(|error| {
            tracing::debug!("[process] tasklist failed for {process_name}: {error}");
        })
        .ok()?;

    Some(parse_tasklist_pids(
        &String::from_utf8_lossy(&output.stdout),
        process_name,
    ))
}

/// 解析 `tasklist /FO CSV /NH` 的输出，只保留进程名与目标完全一致的行。
///
/// CSV 行形如 `"Endfield.exe","61552","Console","1","24 K"`。
#[cfg(target_os = "windows")]
fn parse_tasklist_pids(stdout: &str, process_name: &str) -> Vec<u32> {
    let mut pids = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if !line.starts_with('"') {
            continue;
        }
        let fields: Vec<&str> = line.split("\",\"").collect();
        if fields.len() < 2 {
            continue;
        }
        if !fields[0]
            .trim_start_matches('"')
            .eq_ignore_ascii_case(process_name)
        {
            continue;
        }
        if let Ok(pid) = fields[1].trim().parse::<u32>() {
            pids.push(pid);
        }
    }
    pids
}

/// 同步查询同名进程的 PID（供 `spawn_blocking` / helper 进程内使用）。
///
/// 与 [`is_process_running`] 不同，这里**不做**窗口/启动宽限过滤：`taskkill` 需要的是
/// 「还有哪些同名进程活着」，包括那些已经失去窗口、界面判定为「未运行」的残留。
pub fn list_process_ids(process_name: &str) -> Vec<u32> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let mut command = std::process::Command::new("tasklist");
        command.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        match command
            .args([
                "/FI",
                &format!("IMAGENAME eq {process_name}"),
                "/FO",
                "CSV",
                "/NH",
            ])
            .output()
        {
            Ok(output) => {
                parse_tasklist_pids(&String::from_utf8_lossy(&output.stdout), process_name)
            }
            Err(error) => {
                tracing::debug!("[process] tasklist failed for {process_name}: {error}");
                Vec::new()
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = process_name;
        Vec::new()
    }
}

/// 同步结束指定进程名（含子进程树）。
///
/// Windows 下隐藏窗口执行 `taskkill /T /F /IM`，再按 PID 逐个 `taskkill /F /PID` 兜底
/// （进程按名匹配不到时仍可结束）。返回 `bool` = 结束时命令行是否成功；调用方再结合
/// [`has_processes`] 判断是否真有残留（失败通常意味着需要管理员权限）。
pub fn terminate_processes(process_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        let mut by_name = std::process::Command::new("taskkill");
        by_name.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
        let succeeded = by_name
            .args(["/T", "/F", "/IM", process_name])
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);

        for pid in list_process_ids(process_name) {
            let mut by_pid = std::process::Command::new("taskkill");
            by_pid.creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW);
            let _ = by_pid.args(["/F", "/PID", &pid.to_string()]).output();
            tracing::debug!("[process] taskkill /F /PID {pid} ({process_name})");
        }

        succeeded
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = process_name;
        false
    }
}

/// 是否仍有同名进程存活（同步，最多等待约 3 秒让刚发出的终止请求生效）。
pub fn has_processes(process_name: &str) -> bool {
    for attempt in 0..6 {
        if list_process_ids(process_name).is_empty() {
            return false;
        }
        if attempt < 5 {
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    }
    true
}

#[cfg(target_os = "windows")]
fn has_top_level_window(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId};

    struct Search {
        pid: u32,
        found: bool,
    }

    unsafe extern "system" fn callback(window: HWND, lparam: LPARAM) -> i32 {
        let search = &mut *(lparam as *mut Search);
        let mut window_pid = 0u32;
        GetWindowThreadProcessId(window, &mut window_pid);
        if window_pid == search.pid {
            search.found = true;
            0 // 找到后停止枚举
        } else {
            1
        }
    }

    let mut search = Search { pid, found: false };
    unsafe {
        EnumWindows(Some(callback), &mut search as *mut Search as LPARAM);
    }
    search.found
}

#[cfg(target_os = "windows")]
fn process_is_starting(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
    use windows_sys::Win32::System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        return false;
    }

    let mut creation = unsafe { std::mem::zeroed::<FILETIME>() };
    let mut exit = unsafe { std::mem::zeroed::<FILETIME>() };
    let mut kernel = unsafe { std::mem::zeroed::<FILETIME>() };
    let mut user = unsafe { std::mem::zeroed::<FILETIME>() };
    let ok = unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) };
    unsafe { CloseHandle(handle) };
    if ok == 0 {
        return false;
    }

    let created = ((creation.dwHighDateTime as u64) << 32) | creation.dwLowDateTime as u64;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0);
    // FILETIME 为自 1601-01-01 起的 100ns 计数；UNIX 纪元偏移 11644473600 秒。
    let now_filetime = (now + 11_644_473_600) * 10_000_000;
    now_filetime.saturating_sub(created) < STARTUP_GRACE_SECONDS * 10_000_000
}

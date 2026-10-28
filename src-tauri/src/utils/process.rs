//! 进程探测与结束辅助。
//!
//! 供 `launcher_check_game_running` / `launcher_kill_game` 命令、启动前清理、驻守等待与游戏
//! 运行时长统计共用：「进程是否真的在运行」查询（排除崩溃/挂起后残留的无窗口进程）与
//! 「结束同名进程（含子进程树）」的执行原语。
//!
//! 全部走 Win32 进程快照（`CreateToolhelp32Snapshot`）+ `TerminateProcess`，**不再起
//! `tasklist` / `taskkill` 子进程**：本机实测一个 `tasklist` 要 340–390 ms，旧实现里
//! 「先就地试一次」前后各有一轮 6 × 500 ms 的轮询，点「停止」到 UAC 弹出因此慢到 10 秒
//! 开外；一次原生快照只要 1–2 ms，且 `OpenProcess` 直接返回 `ERROR_ACCESS_DENIED`，
//! 「需要管理员权限」这个结论可以立刻得出而无须等待。

use std::time::Duration;

/// 结束动作的结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminateOutcome {
    /// 本来就没有同名进程，无需结束。
    Nothing,
    /// 已发出终止并确认同名进程消失。
    Terminated,
    /// 至少一个同名进程拒绝当前权限结束（`ERROR_ACCESS_DENIED`）：需要管理员权限。
    AccessDenied,
    /// 已发出终止，但短等待后同名进程仍存活（反作弊驱动保护，或立刻又派生了新的同名进程）。
    StillRunning,
}

/// 发出终止后等待同名进程消失的上限与轮询间隔。
#[cfg(target_os = "windows")]
const TERMINATE_WAIT: Duration = Duration::from_millis(1500);
#[cfg(target_os = "windows")]
const TERMINATE_POLL: Duration = Duration::from_millis(50);

/// 进程创建后多久内即使没有窗口也视为「正在启动」。
#[cfg(target_os = "windows")]
const STARTUP_GRACE_SECONDS: u64 = 90;

/// 查询指定进程名当前是否真的在运行。
///
/// Windows 下用进程快照取得同名 PID，再要求进程满足以下任一条件：
/// - 拥有至少一个顶层窗口（正常游戏进程）；
/// - 进程创建时间在启动宽限期内（仍在启动、尚未创建窗口）。
///
/// 崩溃或挂起后残留的无窗口进程（例如 Application Hang 后仍保持 `STILL_ACTIVE` 的
/// 游戏进程）会被排除，避免界面与时长统计误报「游戏中」。
pub async fn is_process_running(process_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        let name = process_name.to_string();
        // 快照与窗口/创建时间查询都是原生调用（毫秒级），放到阻塞线程里以免占用
        // tokio 工作线程，调用点（轮询循环）保持不变。
        match tokio::task::spawn_blocking(move || running_pids(&name)).await {
            Ok(found) => found,
            Err(error) => {
                tracing::debug!("[process] running check failed for {process_name}: {error}");
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

/// 快照中是否存在「真正在运行」的同名进程（窗口或启动宽限过滤后）。
#[cfg(target_os = "windows")]
fn running_pids(process_name: &str) -> bool {
    snapshot_processes()
        .into_iter()
        .filter(|entry| entry.name.eq_ignore_ascii_case(process_name))
        .any(|entry| has_top_level_window(entry.pid) || process_is_starting(entry.pid))
}

/// 同名进程是否仍然存在（单次快照判定，不轮询）。
///
/// 与 [`is_process_running`] 不同，这里**不做**窗口/启动宽限过滤：结束流程要的是
/// 「还有哪些同名进程活着」，包括那些已经失去窗口、界面判定为「未运行」的残留。
pub fn exists_once(process_name: &str) -> bool {
    #[cfg(target_os = "windows")]
    {
        snapshot_processes()
            .iter()
            .any(|entry| entry.name.eq_ignore_ascii_case(process_name))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = process_name;
        false
    }
}

/// 等待同名进程消失；消失返回 `true`，超时仍存活返回 `false`。一消失就立刻返回。
pub fn wait_until_gone(process_name: &str, timeout: Duration) -> bool {
    #[cfg(target_os = "windows")]
    {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if !exists_once(process_name) {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(TERMINATE_POLL);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (process_name, timeout);
        true
    }
}

/// 结束指定进程名（含每个同名进程的子进程树，与 `taskkill /T /IM` 同语义）。
///
/// 先对快照里的目标 PID 逐个 `OpenProcess(PROCESS_TERMINATE)` + `TerminateProcess`：
/// 打不开且错误为 `ERROR_ACCESS_DENIED` 记为「需要提权」，其余失败（进程刚好已退出等）
/// 忽略。发出终止后短暂等待同名进程消失，再据结果与拒绝情况给出 [`TerminateOutcome`]，
/// 调用方据此决定是直接返回、走提权，还是报告结束失败。
pub fn terminate_processes(process_name: &str) -> TerminateOutcome {
    #[cfg(target_os = "windows")]
    {
        let all = snapshot_processes();
        let roots: Vec<u32> = all
            .iter()
            .filter(|entry| entry.name.eq_ignore_ascii_case(process_name))
            .map(|entry| entry.pid)
            .collect();
        if roots.is_empty() {
            return TerminateOutcome::Nothing;
        }

        let targets = descendants_of(&all, &roots);
        let mut denied = false;
        for pid in &targets {
            match terminate_one(*pid) {
                TerminateOne::Killed => {
                    tracing::debug!("[process] TerminateProcess({pid}) ok ({process_name})");
                }
                TerminateOne::AccessDenied => {
                    tracing::debug!("[process] TerminateProcess({pid}) access denied");
                    denied = true;
                }
                // 进程在快照之后已经自己退出：不是失败。
                TerminateOne::Gone(code) => {
                    tracing::debug!("[process] pid {pid} already gone ({code})");
                }
            }
        }

        if wait_until_gone(process_name, TERMINATE_WAIT) {
            return TerminateOutcome::Terminated;
        }
        if denied {
            return TerminateOutcome::AccessDenied;
        }
        TerminateOutcome::StillRunning
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = process_name;
        TerminateOutcome::Nothing
    }
}

/// 单个 PID 的终止结果。
#[cfg(target_os = "windows")]
enum TerminateOne {
    Killed,
    AccessDenied,
    /// 进程已不存在（含快照后自然退出）。携带 Win32 错误码便于排查。
    Gone(u32),
}

#[cfg(target_os = "windows")]
fn terminate_one(pid: u32) -> TerminateOne {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED};
    use windows_sys::Win32::System::Threading::{
        OpenProcess, TerminateProcess, PROCESS_TERMINATE,
    };

    let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
    if handle.is_null() {
        let code = unsafe { GetLastError() };
        // 已退出的 PID 会以「找不到对象」的形式失败。
        return if code == ERROR_ACCESS_DENIED {
            TerminateOne::AccessDenied
        } else {
            TerminateOne::Gone(code)
        };
    }

    let terminated = unsafe { TerminateProcess(handle, 0) };
    let code = if terminated == 0 {
        unsafe { GetLastError() }
    } else {
        0
    };
    unsafe { CloseHandle(handle) };

    if terminated != 0 {
        TerminateOne::Killed
    } else if code == ERROR_ACCESS_DENIED {
        TerminateOne::AccessDenied
    } else {
        // 其它失败（进程刚好退出、句柄失效等）交给上层「是否仍存活」判定。
        TerminateOne::Gone(code)
    }
}

/// 快照里的一条进程记录。
#[cfg(target_os = "windows")]
struct ProcEntry {
    pid: u32,
    parent: u32,
    name: String,
}

/// 一次进程快照（全表）。约 1–2 ms；失败返回空表，调用方据此得到「无同名进程」的保守结论。
#[cfg(target_os = "windows")]
fn snapshot_processes() -> Vec<ProcEntry> {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        tracing::debug!(
            "[process] CreateToolhelp32Snapshot failed: {}",
            std::io::Error::last_os_error()
        );
        return Vec::new();
    }

    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut entries = Vec::new();

    if unsafe { Process32FirstW(snapshot, &mut entry) } != 0 {
        loop {
            entries.push(ProcEntry {
                pid: entry.th32ProcessID,
                parent: entry.th32ParentProcessID,
                name: exe_name_from_wide(&entry.szExeFile),
            });
            if unsafe { Process32NextW(snapshot, &mut entry) } == 0 {
                break;
            }
        }
    }

    unsafe { CloseHandle(snapshot) };
    entries
}

/// `PROCESSENTRY32W::szExeFile` 是 NUL 结尾的宽字符镜像名。
#[cfg(target_os = "windows")]
fn exe_name_from_wide(raw: &[u16]) -> String {
    let end = raw.iter().position(|ch| *ch == 0).unwrap_or(raw.len());
    String::from_utf16_lossy(&raw[..end])
}

/// 从 `roots` 出发，收集它们的全部后代 PID（含 `roots` 自身）。
///
/// 与 `taskkill /T` 一致：按名命中的进程以及由它们派生的子进程（例如反作弊的辅助进程）
/// 一并结束；父进程与兄弟进程不受影响。
#[cfg(target_os = "windows")]
fn descendants_of(all: &[ProcEntry], roots: &[u32]) -> Vec<u32> {
    let mut targets: Vec<u32> = roots.to_vec();
    let mut changed = true;
    while changed {
        changed = false;
        for entry in all {
            if !targets.contains(&entry.pid) && targets.contains(&entry.parent) {
                targets.push(entry.pid);
                changed = true;
            }
        }
    }
    targets
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

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    fn entry(pid: u32, parent: u32, name: &str) -> ProcEntry {
        ProcEntry {
            pid,
            parent,
            name: name.to_string(),
        }
    }

    #[test]
    fn descendants_include_roots_and_whole_subtree() {
        let all = vec![
            entry(1, 0, "Idle.exe"),
            entry(10, 1, "Endfield.exe"),
            entry(11, 10, "EasyAntiCheat.exe"),
            entry(12, 11, "Helper.exe"),
            entry(20, 1, "Unrelated.exe"),
        ];
        let mut targets = descendants_of(&all, &[10]);
        targets.sort_unstable();
        assert_eq!(targets, vec![10, 11, 12]);
    }

    #[test]
    fn descendants_do_not_follow_parent_or_reused_pids() {
        // 父进程绝不能被收集：游戏由提权 helper 创建，杀父会结束自己。
        let all = vec![entry(5, 9, "Endfield.exe"), entry(9, 4, "EndProtocol.exe")];
        assert_eq!(descendants_of(&all, &[5]), vec![5]);
    }

    #[test]
    fn exe_name_from_wide_stops_at_nul() {
        let raw = [b'E' as u16, b'x' as u16, 0, b'X' as u16];
        assert_eq!(exe_name_from_wide(&raw), "Ex");
    }

    #[test]
    fn snapshot_finds_a_known_system_process() {
        // 真机烟囱测试：快照能枚举到必然存在的进程，且名字非空。
        assert!(exists_once("svchost.exe"));
        assert!(!exists_once("definitely-not-a-real-process-xyz.exe"));
    }

    #[test]
    fn nothing_to_do_when_the_name_is_absent() {
        // 无残留时立刻返回 Nothing，不进入等待。
        let started = std::time::Instant::now();
        assert_eq!(
            terminate_processes("definitely-not-a-real-process-xyz.exe"),
            TerminateOutcome::Nothing
        );
        assert!(started.elapsed() < Duration::from_millis(500));
    }

    #[test]
    fn terminate_processes_kills_a_real_process_and_its_subtree() {
        // 端到端：把 cmd.exe 复制成一个唯一名字（避免误伤机器上其它 cmd，也保证按名匹配
        // 只命中我们自己），启动它跑一条长命令（ping 子进程用来验证「后代进程树」被一并
        // 终止），再按名结束并确认整棵树消失。
        use std::os::windows::process::CommandExt;

        let tag = format!("eptest{}.exe", std::process::id());
        let source = std::path::Path::new(&std::env::var("SystemRoot").expect("SystemRoot"))
            .join("System32")
            .join("cmd.exe");
        let copy = std::env::temp_dir().join(&tag);
        std::fs::copy(&source, &copy).expect("copy cmd.exe to a unique name");

        let spawned = std::process::Command::new(&copy)
            .args(["/c", "ping -n 30 127.0.0.1 >nul"])
            .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
            .spawn();
        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                let _ = std::fs::remove_file(&copy);
                panic!("could not start helper process: {error}");
            }
        };

        assert!(
            exists_once(&tag),
            "the copied executable should be running before terminate"
        );

        // 最多等 2 秒让 ping 子进程出现；即便没出现，也照常验证根进程被终止。
        let mut tree = vec![child.id()];
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while std::time::Instant::now() < deadline {
            let found = descendants_of(&snapshot_processes(), &[child.id()]);
            if found.len() > 1 {
                tree = found;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        let outcome = terminate_processes(&tag);
        let _ = child.wait();
        let _ = std::fs::remove_file(&copy);

        assert_eq!(outcome, TerminateOutcome::Terminated);
        assert!(!exists_once(&tag), "同名进程不应存活");
        // 后代的终止是异步的：最多再等 2 秒确认整棵树从快照里消失。
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        let mut alive: Vec<u32> = tree.clone();
        while !alive.is_empty() && std::time::Instant::now() < deadline {
            let pids: Vec<u32> = snapshot_processes().iter().map(|e| e.pid).collect();
            alive.retain(|pid| pids.contains(pid));
            if !alive.is_empty() {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        assert!(alive.is_empty(), "pids {alive:?} should have been terminated with their tree");
    }
}

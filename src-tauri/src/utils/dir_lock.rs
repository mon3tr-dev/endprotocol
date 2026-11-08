//! 安装目录占用检测与持有锁。
//!
//! 「写安装目录」的长任务（安装/更新、校验修复、预下载、切服）开始前要回答两个问题：
//! 1. **现在**有没有进程正锁着目录里的文件？（游戏本体、杀软扫描、Everything 索引…）
//!    有的话任务要么直接失败（os error 32），要么写到一半才炸——必须在开始前拦住，
//!    并且告诉用户**是谁**锁的，而不是甩一个 `The process cannot access the file`。
//! 2. 任务进行中怎么保证**不会有人中途来锁**？——由我们自己先把关键文件打开成
//!    独占句柄并持有到任务结束（[`DirLock`]），后来者（用户又点开游戏、另一个
//!    启动器）会拿不到句柄而自己报错，而不是把我们正在写的文件踩掉。
//!
//! 占用检测用 **Restart Manager API**（`rstrtmgr`）：资源监视器「哪个进程锁住了
//! 这个文件」同款实现，一次会话能报出锁定某个文件的全部进程（PID + 进程名），
//! 不需要 `handle.exe` 这类外部工具。核心文件取渠道可执行文件与数据目录里
//! 抽样的几个 DLL——锁住目录里**任何一个**被任务要写的文件都算占用。

use serde::Serialize;

/// 锁住文件的进程信息（给前端 message 显示用）。
#[derive(Debug, Clone, Serialize)]
pub struct LockingProcess {
    pub pid: u32,
    pub name: String,
    /// 进程的可执行文件完整路径（拿不到时为空串）。
    #[serde(default)]
    pub path: String,
}

/// 检测结果：`locked = false` 表示抽样的关键文件全部无人占用。
#[derive(Debug, Clone, Serialize)]
pub struct DirOccupancy {
    pub locked: bool,
    pub processes: Vec<LockingProcess>,
}

#[cfg(target_os = "windows")]
mod imp {
    use super::{DirOccupancy, LockingProcess};
    use std::path::Path;

    // windows-sys 需要 Win32_System_RestartManager feature（Cargo.toml 已加）。
    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_MORE_DATA, NO_ERROR};
    use windows_sys::Win32::System::RestartManager::{
        RmEndSession, RmGetList, RmRegisterResources, RmStartSession, CCH_RM_SESSION_KEY,
        RM_PROCESS_INFO,
    };

    /// 会话里登记的文件上限。安装目录关键文件抽样就几个；给足余量。
    const MAX_FILES: usize = 32;
    /// `RmGetList` 首次调用探测出的进程数上限再放大一档的余量。
    const MAX_PROCESSES: u32 = 64;

    /// 检测哪些进程锁住了 `files` 里的任一文件。
    ///
    /// 返回的进程列表按 PID 去重。会话创建失败（极少数系统状态）返回空结果并记日志——
    /// 调用方对「检测不出来」的兜底是任务开始后真的写失败时再报 os error 32。
    pub fn check_files(files: &[&Path]) -> DirOccupancy {
        if files.is_empty() {
            return DirOccupancy {
                locked: false,
                processes: Vec::new(),
            };
        }

        let mut processes = match query_locking_processes(files) {
            Ok(list) => list,
            Err(error) => {
                tracing::warn!("[dirlock] Restart Manager query failed: {error}");
                Vec::new()
            }
        };
        processes.sort_by(|a, b| a.pid.cmp(&b.pid).then(a.name.cmp(&b.name)));
        processes.dedup_by(|a, b| a.pid == b.pid);
        DirOccupancy {
            locked: !processes.is_empty(),
            processes,
        }
    }

    fn query_locking_processes(files: &[&Path]) -> Result<Vec<LockingProcess>, String> {
        // 1. 开会话
        let mut session: u32 = 0;
        let mut key = [0u16; CCH_RM_SESSION_KEY as usize + 1];
        let status = unsafe { RmStartSession(&mut session, 0, key.as_mut_ptr()) };
        if status != NO_ERROR {
            return Err(format!("RmStartSession: {status}"));
        }

        // 无论后面成败都要收尾关会话
        let result = (|| -> Result<Vec<LockingProcess>, String> {
            // 2. 登记要查的文件（UTF-16、NUL 结尾）
            let wide: Vec<Vec<u16>> = files
                .iter()
                .map(|p| os_str_to_wide_null(p.as_os_str()))
                .collect();
            let ptrs: Vec<*const u16> = wide.iter().map(|w| w.as_ptr()).collect();
            let status = unsafe {
                RmRegisterResources(
                    session,
                    ptrs.len() as u32,
                    ptrs.as_ptr(),
                    0,
                    std::ptr::null(),
                    0,
                    std::ptr::null_mut(),
                )
            };
            if status != NO_ERROR {
                return Err(format!("RmRegisterResources: {status}"));
            }

            // 3. 取列表：先按 MAX_PROCESSES 要，不够就按返回值放大再要一次
            let mut needed: u32 = MAX_PROCESSES;
            loop {
                let mut buffer = vec![
                    unsafe { std::mem::zeroed::<RM_PROCESS_INFO>() };
                    needed as usize
                ];
                let mut count = needed;
                let mut reboot_reasons: u32 = 0;
                let status = unsafe {
                    RmGetList(
                        session,
                        &mut needed,
                        &mut count,
                        buffer.as_mut_ptr(),
                        &mut reboot_reasons,
                    )
                };
                if status == ERROR_MORE_DATA {
                    needed = needed.saturating_mul(2);
                    continue;
                }
                if status != NO_ERROR {
                    return Err(format!("RmGetList: {status}"));
                }
                buffer.truncate(count as usize);
                return Ok(buffer
                    .iter()
                    .map(|info| {
                        let name = wide_string(&info.strAppName);
                        let path = image_path_of(info.Process.dwProcessId)
                            .unwrap_or_default();
                        LockingProcess {
                            pid: info.Process.dwProcessId,
                            name,
                            path,
                        }
                    })
                    .collect());
            }
        })();

        unsafe { RmEndSession(session) };
        result
    }

    fn wide_string(raw: &[u16]) -> String {
        let end = raw.iter().position(|ch| *ch == 0).unwrap_or(raw.len());
        String::from_utf16_lossy(&raw[..end])
    }

    /// `OsStr` → UTF-16 NUL 结尾（std 的 `to_wide_null` 在稳定版不可用，手写等价物）。
    fn os_str_to_wide_null(s: &std::ffi::OsStr) -> Vec<u16> {
        use std::os::windows::ffi::OsStrExt;
        let mut wide: Vec<u16> = s.encode_wide().collect();
        wide.push(0);
        wide
    }

    /// QueryFullProcessImageNameW：PID → exe 完整路径。失败（权限/已退出）返回 None。
    fn image_path_of(pid: u32) -> Option<String> {
        use windows_sys::Win32::System::Threading::{
            OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows_sys::Win32::Foundation::CloseHandle;

        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return None;
        }
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        // K32GetProcessImageFileNameW 也可，但 QueryFullProcessImageNameW 给的是
        // Win32 路径（\Device\... 已归一化为 C:\...），直接可展示。
        let ok = unsafe {
            windows_sys::Win32::System::Threading::QueryFullProcessImageNameW(
                handle,
                0,
                buffer.as_mut_ptr(),
                &mut len,
            )
        };
        unsafe { CloseHandle(handle) };
        if ok == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&buffer[..len as usize]))
    }

    /// 给目录上「写锁」：把抽样关键文件逐一打开成**独占**句柄并持有。
    ///
    /// `CreateFileW(dwShareMode = 0)`——不共享读也不共享写，任何后来者（游戏本体、
    /// 另一个启动器、杀软重扫描）对这些文件的打开都会失败，从而在我们写目录期间
    /// 无法再创建新的占用。句柄存在 [`DirLock`] 里，drop 时释放。
    pub fn acquire_lock(files: &[&Path]) -> Result<DirLock, String> {
        use windows_sys::Win32::Foundation::{CloseHandle, GENERIC_READ};
        use windows_sys::Win32::Storage::FileSystem::{
            CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_SHARE_MODE, OPEN_EXISTING,
        };
        let mut handles: Vec<core::ptr::NonNull<core::ffi::c_void>> =
            Vec::with_capacity(files.len());
        for file in files {
            let wide = os_str_to_wide_null(file.as_os_str());
            let handle = unsafe {
                CreateFileW(
                    wide.as_ptr(),
                    GENERIC_READ,
                    // 不共享读也不共享写：任何后来者对这些文件的打开都会失败
                    0 as FILE_SHARE_MODE,
                    std::ptr::null(),
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    std::ptr::null_mut(),
                )
            };
            if handle as isize == -1 {
                // 目录里该文件可能不存在（未安装/精简目录）——跳过，不算失败。
                // 但如果存在却打不开，就如实报错（多半是别人已经先占了）。
                if file.exists() {
                    for h in handles {
                        unsafe { CloseHandle(h.as_ptr()) };
                    }
                    let error = std::io::Error::last_os_error();
                    return Err(format!("Lock {}: {}", file.display(), error));
                }
                continue;
            }
            handles.push(core::ptr::NonNull::new(handle).expect("CreateFileW returned non-null handle"));
        }
        Ok(DirLock { handles })
    }

    /// 持有中的目录锁。drop 时全部关闭句柄，恢复共享。
    pub struct DirLock {
        handles: Vec<core::ptr::NonNull<core::ffi::c_void>>,
    }

    impl DirLock {
        /// 无句柄的空锁（目录还没装出关键文件时占位用，drop 无操作）。
        pub fn acquire_empty() -> Self {
            DirLock { handles: Vec::new() }
        }
    }

    // 句柄是本函数自己 CreateFileW 拿到的、无借用的 owned 值，跨线程转移
    // （spawn_blocking → async 上下文）与 CloseHandle 都安全；HANDLE 本身
    // 没有线程亲和性（与 HWND 不同）。
    unsafe impl Send for DirLock {}

    impl Drop for DirLock {
        fn drop(&mut self) {
            for handle in self.handles.drain(..) {
                unsafe { CloseHandle(handle.as_ptr()) };
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{acquire_lock, check_files, DirLock};

#[cfg(not(target_os = "windows"))]
mod imp_nonwin {
    use super::{DirOccupancy, LockingProcess};
    use std::path::Path;

    pub fn check_files(_files: &[&Path]) -> DirOccupancy {
        DirOccupancy {
            locked: false,
            processes: Vec::new(),
        }
    }

    /// 非 Windows 平台没有独占打开的统一语义，锁退化为空对象。
    pub struct DirLock;

    impl DirLock {
        pub fn acquire_empty() -> Self {
            DirLock
        }
    }

    pub fn acquire_lock(_files: &[&Path]) -> Result<DirLock, String> {
        Ok(DirLock)
    }
}

#[cfg(not(target_os = "windows"))]
pub use imp_nonwin::{acquire_lock, check_files, DirLock};

/// 抽样出「代表整个安装目录」的关键文件：可执行文件 + 数据目录里几个大 DLL。
///
/// 写任务会覆盖目录里**几百上千**个文件，逐个检测不现实；游戏运行/杀软扫描锁住的
/// 几乎总是主程序或核心运行时，抽这几个命中率足够高。返回存在的文件路径。
pub fn sample_critical_files(install_path: &str, exe_name: &str, data_dir_name: &str) -> Vec<std::path::PathBuf> {
    let root = std::path::Path::new(install_path);
    let mut candidates = vec![root.join(exe_name)];

    // 数据目录下最常被游戏/杀软长期持有的运行时
    for rel in [
        "Plugins/x86_64/xlua.dll",
        "globalgamemanagers",
        "boot.config",
    ] {
        candidates.push(root.join(data_dir_name).join(rel));
    }
    // 渠道 SDK 与下载组件
    for name in ["hgdownloadsdk.dll", "U8SDK.dll", "hgsdk.dll"] {
        candidates.push(root.join(name));
    }

    candidates
        .into_iter()
        .filter(|p| p.exists())
        .collect()
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    #[test]
    fn detects_a_locking_process_by_name() {
        // 端到端：启动一个长跑进程并让它独占打开一个临时文件，
        // Restart Manager 应当能报出这个进程的名字。
        use std::os::windows::process::CommandExt;
        use std::io::Write;

        let dir = std::env::temp_dir().join(format!("eptest_dirlock_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("locked.dat");
        std::fs::File::create(&target).unwrap().write_all(b"x").unwrap();

        // PowerShell 打开独占句柄并持有 20 秒
        let script = format!(
            "$f=[System.IO.File]::Open('{}','Open','Read','None'); Start-Sleep -Seconds 20; $f.Close()",
            target.display()
        );
        let mut child = std::process::Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .expect("spawn locker");

        // 等它真正拿到句柄
        std::thread::sleep(std::time::Duration::from_millis(2500));

        let occupancy = check_files(&[target.as_path()]);
        assert!(occupancy.locked, "the file should be reported as locked");
        // RM 报的是进程友好名（如 "Windows PowerShell 5.1"），不是 exe 文件名；
        // 路径字段才是可执行的完整路径，用它做幂断言。
        assert!(
            occupancy
                .processes
                .iter()
                .any(|p| p.path.to_lowercase().contains("powershell")),
            "locking process should be powershell, got {:?}",
            occupancy.processes
        );

        // 被占用时 acquire 必须失败（错误里带文件路径）
        let blocked = acquire_lock(&[target.as_path()]);
        let blocked_err = match blocked {
            Ok(_) => panic!("acquire must fail while the file is locked"),
            Err(e) => e,
        };
        assert!(
            blocked_err.contains("locked.dat"),
            "error should name the locked file: {blocked_err}"
        );

        // 释放后 acquire 成功
        let _ = child.kill();
        let _ = child.wait();
        std::thread::sleep(std::time::Duration::from_millis(500));
        let _lock = acquire_lock(&[target.as_path()]).expect("acquire after release");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unlockable_file_reports_not_locked() {
        let dir = std::env::temp_dir().join(format!("eptest_dirlock_free_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("free.dat");
        std::fs::File::create(&target).unwrap();

        let occupancy = check_files(&[target.as_path()]);
        assert!(!occupancy.locked);
        assert!(acquire_lock(&[target.as_path()]).is_ok());

        let _ = std::fs::remove_dir_all(&dir);
    }
}

//! 官方启动器父进程伪造 —— 不打开官方鹰角启动器界面启动《明日方舟：终末地》。
//!
//! `Endfield.exe` 会校验自己的**直接父进程**：父进程文件必须名为 `Games.exe`、带可信的
//! Authenticode 签名、且签名者组织为官方发行方。直接运行 `Endfield.exe` 会因该校验失败。
//! 本模块在**不注入代码、不修改任何游戏文件**的前提下满足它：
//!
//! 1. 查找并校验官方 `Games.exe`（`hypergryphlauncher*` 注册表协议、卸载项、默认安装位置）；
//! 2. 以 `CREATE_SUSPENDED | CREATE_NO_WINDOW` 创建它，主线程**永不恢复** —— 启动器一行
//!    代码都不会执行（没有界面、没有更新、没有遥测），只有它的映像与签名存在；
//! 3. 用 `PROC_THREAD_ATTRIBUTE_PARENT_PROCESS` 创建游戏进程，使挂起的启动器成为游戏的
//!    直接父进程。内核在创建时写入父子关系，事后与真实父子关系无法区分；
//! 4. 等游戏退出，然后终止这套流程自己创建的挂起父进程，并把游戏的退出码原样转发。
//!
//! ## 提权：helper 模式
//!
//! 游戏与官方启动器都要求管理员权限，未提权的进程创建它们会得到 Win32 740，因此本模块分
//! 两个阶段工作，全程**恰好一次 UAC**：
//!
//! - 未提权的一侧（[`launch_via_official_parent`]，由 `launcher_start_game` 命令调用）先做
//!   「查找 + 验签」。失败时不需要弹 UAC 就能给出结论（调用方据此回退到直接启动）；成功则
//!   用 `ShellExecuteExW("runas")` 带 [`HELPER_FLAG`] 重新启动自身，并以 `SW_HIDE` 启动。
//! - 提权后的**同一个 exe** 在 [`crate::run`] 最开始就被 [`try_run_helper`] 截获（早于
//!   logger/Tauri/窗口初始化），执行完整流程后以游戏退出码退出。所以提权进程没有任何界面。
//!
//! 签名句柄无法跨越提权边界，所以 helper 里会**重新验签**并自己保持 `FILE_SHARE_READ`
//! 句柄直到进程创建完成；未提权那一侧的前置校验只是「不想让用户白弹一次 UAC」的 UX 过滤。
//!
//! ## 退出码（与 EndfieldNoLauncher 的约定一致）
//!
//! `2` 参数无效 · `4` 创建进程失败 · `7` 未找到签名有效的官方启动器 · `8` 等待游戏失败 ·
//! 其它值 = 游戏自身的退出码，原样转发。helper 创建游戏成功后会写一个状态文件，使调用方
//! 能区分「helper 在启动阶段就失败了」与「游戏很快退出并带着自己的退出码」。
//!
//! ## 移植来源与许可
//!
//! 本文件逐函数移植自 EndfieldNoLauncher 的 `src/launch.cpp`（AGPL-3.0），后者逐字复制了
//! [Better Endfield Next](https://github.com/Dr-hydra/Better-Endfield) 的
//! `native/loaders/shared/official_launcher.cpp`（commit `514f6d6`，作者 Dr-hydra 及贡献者）。
//! 函数名与结构刻意与 C++ 版本一一对应，便于与上游比对。本仓库同为 AGPL-3.0。
//!
//! 与上游一致的两处**有意为之**的取舍：验签使用 `WTD_CACHE_ONLY_URL_RETRIEVAL |
//! WTD_REVOCATION_CHECK_NONE`（不联网、不查吊销，因此离线可用）；并且只比对签名者证书的
//! 组织名（`O`），不比指纹。

use std::path::{Path, PathBuf};

// ============================ 常量与公共类型 ============================

/// 提权重启自身时使用的私有首参数。helper 模式下本进程不初始化 Tauri。
pub const HELPER_FLAG: &str = "--endfield-launch-helper";

/// 官方发行方组织名，对应签名者证书的 `O` 字段（2.5.4.10）。
const PUBLISHER: &str = "Shanghai Hypergryph Network Technology Co., Ltd.";

/// helper 的进程退出码（与上游 `launch.cpp` / README 一致）。
pub mod exit_code {
    /// 命令行无效。
    pub const INVALID_ARGUMENTS: i32 = 2;
    /// 启动器父进程或游戏进程创建失败。
    pub const CREATE_FAILED: i32 = 4;
    /// 未找到签名有效的官方启动器。
    pub const NO_VALID_LAUNCHER: i32 = 7;
    /// 等待游戏退出或读取其退出码失败。
    pub const WAIT_FAILED: i32 = 8;
}

/// 失败原因的机器可读标记。前端按它挑 i18n 文案，后端只提供 `token` 与技术细节。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchToken {
    /// 游戏可执行文件不存在。
    NotFound,
    /// 未找到（或校验不通过）官方启动器；调用方应回退到直接启动。
    NoLauncher,
    /// 用户在 UAC 提示上点了「否」。
    Cancelled,
    /// 创建启动器父进程或游戏进程失败。
    Create,
    /// 等待游戏退出失败。
    WaitFailed,
    /// 回退到直接启动（不是失败，是提示）。
    Fallback,
    /// 其它。
    Unknown,
}

impl LaunchToken {
    pub fn as_str(self) -> &'static str {
        match self {
            LaunchToken::NotFound => "not_found",
            LaunchToken::NoLauncher => "no_launcher",
            LaunchToken::Cancelled => "cancelled",
            LaunchToken::Create => "create",
            LaunchToken::WaitFailed => "wait_failed",
            LaunchToken::Fallback => "fallback",
            LaunchToken::Unknown => "unknown",
        }
    }
}

/// 启动失败。`message()` 的 `"<token>: <detail>"` 形式是给前端的契约。
#[derive(Debug, Clone)]
pub struct LaunchError {
    pub token: LaunchToken,
    pub detail: String,
}

impl LaunchError {
    pub fn new(token: LaunchToken, detail: impl Into<String>) -> Self {
        Self {
            token,
            detail: detail.into(),
        }
    }

    /// 给前端的契约字符串：`token` 供前端选文案，`detail` 是技术细节（英文诊断）。
    pub fn message(&self) -> String {
        format!("{}: {}", self.token.as_str(), self.detail)
    }

    /// helper 以哪个退出码结束（见模块文档的退出码表）。
    fn exit_code(&self) -> i32 {
        match self.token {
            LaunchToken::NotFound => exit_code::INVALID_ARGUMENTS,
            LaunchToken::NoLauncher => exit_code::NO_VALID_LAUNCHER,
            LaunchToken::WaitFailed => exit_code::WAIT_FAILED,
            LaunchToken::Create
            | LaunchToken::Cancelled
            | LaunchToken::Fallback
            | LaunchToken::Unknown => exit_code::CREATE_FAILED,
        }
    }
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message())
    }
}

impl std::error::Error for LaunchError {}

/// 提权 helper 已经建立并接管后续流程。
#[derive(Debug, Clone, Copy)]
pub struct ElevatedLaunch {
    /// helper 进程 pid（0 表示系统未回传句柄、pid 未知）。
    pub helper_pid: u32,
}

// ============================ 可移植的纯逻辑 ============================
// 以下函数不依赖 Win32（只在需要时把字符串编码成 UTF-16），因此任何平台都能编译与单测。

/// 把字符串编码成以 NUL 结尾的 UTF-16，供 Win32 W 系列 API 使用。
pub(crate) fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

/// 复刻 `launch.cpp` 的 `QuoteArgument`：按 `CreateProcessW` / `CommandLineToArgvW` 的规则
/// 给单个参数加引号。反斜杠只在「引号之前」与「参数结尾」需要翻倍，其余原样保留。
pub fn quote_argument(value: &str, out: &mut Vec<u16>) {
    const BACKSLASH: u16 = b'\\' as u16;
    const QUOTE: u16 = b'"' as u16;

    out.push(QUOTE);
    let mut slashes = 0usize;
    for character in value.encode_utf16() {
        if character == BACKSLASH {
            slashes += 1;
            continue;
        }
        let count = if character == QUOTE {
            slashes * 2 + 1
        } else {
            slashes
        };
        for _ in 0..count {
            out.push(BACKSLASH);
        }
        out.push(character);
        slashes = 0;
    }
    // 结尾的反斜杠会转义后面的闭引号，必须翻倍。
    for _ in 0..slashes * 2 {
        out.push(BACKSLASH);
    }
    out.push(QUOTE);
}

/// 把「可执行文件 + 参数」拼成一条完整命令行（可变缓冲，`CreateProcessW` 要求可写）。
pub fn quote_command_line(executable: &str, arguments: &[String]) -> Vec<u16> {
    let mut out = Vec::with_capacity(64 + arguments.len() * 16);
    quote_argument(executable, &mut out);
    for argument in arguments {
        out.push(b' ' as u16);
        quote_argument(argument, &mut out);
    }
    out
}

/// 签名者证书的组织名是否为官方发行方（`_wcsicmp` 的等价物：忽略大小写）。
pub fn is_official_publisher(organization: &str) -> bool {
    organization.eq_ignore_ascii_case(PUBLISHER)
}

/// 复刻 `launch.cpp` 的 `Version()`：解析 `…\1.6.0\Games.exe` 这类候选的**父目录名**。
///
/// 返回空 `Vec` 表示「不是点分数字版本目录」，排序时最低（与上游的空 vector 语义一致）。
pub fn version_key(path: &Path) -> Vec<u64> {
    let name = match path.parent().and_then(|parent| parent.file_name()) {
        Some(name) => name.to_string_lossy().into_owned(),
        None => return Vec::new(),
    };
    if name.is_empty() || name.chars().any(|c| !c.is_ascii_digit() && c != '.') {
        return Vec::new();
    }
    // 上游用 stoul 逐段解析并容忍结尾的点（"1.2." → [1, 2]）。
    let trimmed = name.strip_suffix('.').unwrap_or(&name);
    let mut result = Vec::new();
    for part in trimmed.split('.') {
        match part.parse::<u64>() {
            Ok(value) => result.push(value),
            Err(_) => return Vec::new(),
        }
    }
    result
}

/// helper 模式的命令行参数。
#[derive(Debug, Default, Clone)]
pub struct HelperOptions {
    /// `--game`：游戏 `Endfield.exe` 的完整路径。
    pub game: PathBuf,
    /// `--parent`：官方 `Games.exe`；省略时自动查找。
    pub parent: Option<PathBuf>,
    /// `--status`：创建游戏成功后写入 pid 的状态文件（供调用方区分失败与「游戏很快退出」）。
    pub status_file: Option<PathBuf>,
    /// `--` 之后的参数，原样转发给游戏。
    pub arguments: Vec<String>,
    /// `--help` / `-h` / `/?`。
    pub help: bool,
}

/// 说明文本（`--help`）。
pub fn usage() -> String {
    format!(
        "{HELPER_FLAG} --game <Endfield.exe> [--parent <Games.exe>] [--status <file>] [-- <args>]\n\
         由 EndProtocol 内部使用：以官方启动器为父进程启动游戏。不直接调用。\n"
    )
}

/// 解析 helper 的命令行。规则与上游 `ParseOptions` 一致：取值选项只能出现一次，
/// 未知选项报错，`--` 之后的参数原样转发。
pub fn parse_helper_options(args: &[String]) -> Result<HelperOptions, String> {
    let mut options = HelperOptions::default();
    let mut game_arguments = false;
    let mut index = 0usize;
    while index < args.len() {
        let option = args[index].as_str();
        if game_arguments {
            options.arguments.push(args[index].clone());
            index += 1;
            continue;
        }
        match option {
            "--help" | "-h" | "/?" => {
                options.help = true;
                return Ok(options);
            }
            "--" => game_arguments = true,
            "--game" if index + 1 < args.len() && options.game.as_os_str().is_empty() => {
                index += 1;
                options.game = PathBuf::from(&args[index]);
            }
            "--parent" if index + 1 < args.len() && options.parent.is_none() => {
                index += 1;
                options.parent = Some(PathBuf::from(&args[index]));
            }
            "--status" if index + 1 < args.len() && options.status_file.is_none() => {
                index += 1;
                options.status_file = Some(PathBuf::from(&args[index]));
            }
            other => return Err(format!("invalid launch option: {other}")),
        }
        index += 1;
    }

    // 只做纯字符串校验，不查文件系统 —— 这样本函数在任何平台都能单测。
    // 「文件是否存在」由 run_helper 在解析之后检查（与上游的退出码一致）。
    let file_name = options
        .game
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    if !file_name.eq_ignore_ascii_case("Endfield.exe") {
        return Err("specify --game <Endfield.exe>".to_string());
    }
    options.game = absolute(&options.game);
    options.parent = options.parent.as_deref().map(absolute);
    options.status_file = options.status_file.as_deref().map(absolute);
    Ok(options)
}

/// 词法绝对化（不解析符号链接），等价于上游的 `absolute().lexically_normal()`。
pub(crate) fn absolute(path: &Path) -> PathBuf {
    std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf())
}

// ============================ Windows 实现 ============================

#[cfg(target_os = "windows")]
mod win {
    use super::*;

    use std::ffi::c_void;
    use std::fs::File;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use std::ptr;
    use std::time::Duration;

    use windows_sys::core::{GUID, PCWSTR, PWSTR};
    use windows_sys::Win32::Foundation::{
        CloseHandle, GetLastError, LocalFree, ERROR_CANCELLED, ERROR_NO_MORE_ITEMS, ERROR_SUCCESS,
        HANDLE, INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
    };
    use windows_sys::Win32::Security::Cryptography::{
        szOID_ORGANIZATION_NAME, CertGetNameStringW, CERT_NAME_ATTR_TYPE,
    };
    use windows_sys::Win32::Security::WinTrust::{
        WTHelperGetProvSignerFromChain, WTHelperProvDataFromStateData, WinVerifyTrust,
        CRYPT_PROVIDER_SGNR, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_FILE_INFO,
        WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE, WTD_REVOCATION_CHECK_NONE, WTD_REVOKE_NONE,
        WTD_STATEACTION_CLOSE, WTD_STATEACTION_VERIFY, WTD_UI_NONE,
    };
    use windows_sys::Win32::System::Console::GetConsoleWindow;
    use windows_sys::Win32::System::Diagnostics::Debug::{
        FormatMessageW, FORMAT_MESSAGE_ALLOCATE_BUFFER, FORMAT_MESSAGE_FROM_SYSTEM,
        FORMAT_MESSAGE_IGNORE_INSERTS,
    };
    use windows_sys::Win32::System::Environment::{
        ExpandEnvironmentStringsW, GetEnvironmentVariableW,
    };
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CLASSES_ROOT,
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_ENUMERATE_SUB_KEYS, KEY_QUERY_VALUE,
        KEY_WOW64_32KEY, KEY_WOW64_64KEY, REG_EXPAND_SZ, REG_SZ,
    };
    use windows_sys::Win32::System::Threading::{
        CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess, GetProcessId,
        InitializeProcThreadAttributeList, TerminateProcess, UpdateProcThreadAttribute,
        WaitForSingleObject, CREATE_NO_WINDOW, CREATE_SUSPENDED, EXTENDED_STARTUPINFO_PRESENT,
        INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST, PROCESS_INFORMATION,
        PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, STARTF_USESHOWWINDOW, STARTUPINFOEXW, STARTUPINFOW,
    };
    use windows_sys::Win32::UI::Shell::{
        CommandLineToArgvW, ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC,
        SEE_MASK_NOCLOSEPROCESS, SEE_MASK_NO_CONSOLE, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE, SW_SHOWNORMAL};

    /// `FILE_SHARE_READ`：只允许别人读。没有 WRITE/DELETE 共享，所以该文件在本句柄存活
    /// 期间无法被写入、改名或替换 —— 这正是「验签 → 创建进程」窗口期需要的 TOCTOU 保护。
    const FILE_SHARE_READ: u32 = 0x0000_0001;

    /// 等待 helper 确认「已创建游戏进程」的宽限期。helper 若在此窗口内就退出，说明它没走
    /// 到等待游戏那一步（启动阶段失败），据此把失败原因回传给界面。正常启动耗时远低于此值。
    const HELPER_GRACE: Duration = Duration::from_millis(2500);

    // ---------------------------- 句柄与错误文本 ----------------------------

    /// 拥有一个内核句柄，Drop 时关闭。null 与 `INVALID_HANDLE_VALUE` 视为「无句柄」。
    struct OwnedHandle(HANDLE);

    impl OwnedHandle {
        fn new(value: HANDLE) -> Self {
            Self(value)
        }

        fn get(&self) -> HANDLE {
            self.0
        }

        fn is_valid(&self) -> bool {
            !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE
        }

        /// 取走句柄（调用方负责关闭），使 Drop 不再重复关闭。
        fn take(&mut self) -> HANDLE {
            std::mem::replace(&mut self.0, ptr::null_mut())
        }
    }

    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            if self.is_valid() {
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    /// 复刻 `WindowsError`：`<操作> (Win32 <码>)` + 系统本地化文本（740 额外给出提权提示）。
    fn windows_error(operation: &str, code: u32) -> String {
        let mut result = format!("{operation} (Win32 {code})");
        let mut message: PWSTR = ptr::null_mut();
        let length = unsafe {
            FormatMessageW(
                FORMAT_MESSAGE_ALLOCATE_BUFFER
                    | FORMAT_MESSAGE_FROM_SYSTEM
                    | FORMAT_MESSAGE_IGNORE_INSERTS,
                ptr::null(),
                code,
                0,
                // 带 ALLOCATE_BUFFER 时该参数是「指向缓冲指针的指针」，类型上看仍是 PWSTR。
                &mut message as *mut PWSTR as PWSTR,
                0,
                ptr::null(),
            )
        };
        if length > 0 && !message.is_null() {
            let text = unsafe { std::slice::from_raw_parts(message, length as usize) };
            let text = String::from_utf16_lossy(text);
            result.push_str(": ");
            result.push_str(text.trim());
            unsafe { LocalFree(message as *mut c_void) };
        }
        if code == windows_sys::Win32::Foundation::ERROR_ELEVATION_REQUIRED {
            result
                .push_str(" — administrator privileges are required; allow the Windows UAC prompt");
        }
        result
    }

    fn last_error() -> u32 {
        unsafe { GetLastError() }
    }

    /// 隐藏控制台窗口（而不是 `FreeConsole`）。
    ///
    /// release 构建是 windows 子系统，本就没有控制台；debug 构建是控制台子系统，跨提权边界
    /// 启动时系统会新建一个控制台。隐藏它即可 —— 不能 `FreeConsole`，因为 `utils::logger`
    /// 每条日志都会 `eprintln!`，而 std 在写标准流失败时会 panic。
    fn ensure_console_hidden() {
        unsafe {
            let window = GetConsoleWindow();
            if !window.is_null() {
                ShowWindow(window, SW_HIDE);
            }
        }
    }

    // ---------------------------- 注册表（发现安装位置） ----------------------------

    /// 拥有一个注册表键，Drop 时关闭。
    struct RegistryKey(HKEY);

    impl Drop for RegistryKey {
        fn drop(&mut self) {
            unsafe { RegCloseKey(self.0) };
        }
    }

    fn open_key(root: HKEY, path: &str, access: u32) -> Option<RegistryKey> {
        let path = wide(path);
        let mut key: HKEY = ptr::null_mut();
        let status = unsafe { RegOpenKeyExW(root, path.as_ptr(), 0, access, &mut key) };
        if status != ERROR_SUCCESS {
            return None;
        }
        Some(RegistryKey(key))
    }

    /// 复刻 `ReadRegistry`：只接受 `REG_SZ` / `REG_EXPAND_SZ`，单次读取上限 64 KiB，
    /// 且对 `REG_EXPAND_SZ` 做环境变量展开（上限 32 KiB）。
    fn read_registry(root: HKEY, path: &str, name: Option<&str>, view: u32) -> Option<String> {
        let key = open_key(root, path, KEY_QUERY_VALUE | view)?;
        let name_wide = name.map(wide);
        let name_ptr: PCWSTR = name_wide.as_ref().map_or(ptr::null(), |name| name.as_ptr());

        let mut kind = 0u32;
        let mut bytes = 0u32;
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                name_ptr,
                ptr::null(),
                &mut kind,
                ptr::null_mut(),
                &mut bytes,
            )
        };
        if status != ERROR_SUCCESS
            || (kind != REG_SZ && kind != REG_EXPAND_SZ)
            || bytes > 65536
            || bytes == 0
        {
            return None;
        }

        let mut buffer = vec![0u16; bytes as usize / 2 + 1];
        let status = unsafe {
            RegQueryValueExW(
                key.0,
                name_ptr,
                ptr::null(),
                ptr::null_mut(),
                buffer.as_mut_ptr() as *mut u8,
                &mut bytes,
            )
        };
        if status != ERROR_SUCCESS {
            return None;
        }
        let text = trim_at_nul(&buffer);

        if kind != REG_EXPAND_SZ {
            return Some(text);
        }
        let source = wide(&text);
        let required = unsafe { ExpandEnvironmentStringsW(source.as_ptr(), ptr::null_mut(), 0) };
        if required == 0 || required > 32768 {
            return None;
        }
        let mut expanded = vec![0u16; required as usize];
        if unsafe { ExpandEnvironmentStringsW(source.as_ptr(), expanded.as_mut_ptr(), required) }
            == 0
        {
            return None;
        }
        Some(trim_at_nul(&expanded))
    }

    /// 复刻 `Subkeys`：枚举子键名。
    fn subkeys(root: HKEY, path: &str, view: u32) -> Vec<String> {
        let mut names = Vec::new();
        let Some(key) = open_key(root, path, KEY_ENUMERATE_SUB_KEYS | view) else {
            return names;
        };
        for index in 0u32.. {
            let mut name = [0u16; 256];
            let mut size = name.len() as u32;
            let status = unsafe {
                RegEnumKeyExW(
                    key.0,
                    index,
                    name.as_mut_ptr(),
                    &mut size,
                    ptr::null(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                    ptr::null_mut(),
                )
            };
            if status == ERROR_NO_MORE_ITEMS {
                break;
            }
            if status == ERROR_SUCCESS {
                names.push(String::from_utf16_lossy(&name[..size as usize]));
            }
        }
        names
    }

    fn trim_at_nul(buffer: &[u16]) -> String {
        let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        String::from_utf16_lossy(&buffer[..end])
    }

    // ---------------------------- 启动器发现 ----------------------------

    fn add_root(roots: &mut Vec<PathBuf>, path: &Path) {
        if path.as_os_str().is_empty() {
            return;
        }
        let mut root = path.to_path_buf();
        if root
            .extension()
            .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("exe"))
        {
            root = root.parent().map(Path::to_path_buf).unwrap_or(root);
        }
        let duplicate = roots.iter().any(|existing| {
            existing
                .to_string_lossy()
                .eq_ignore_ascii_case(&root.to_string_lossy())
        });
        if !duplicate {
            roots.push(root);
        }
    }

    /// 复刻 `InstalledRoots`：安装根目录来自「启动器的 URL 协议注册」「卸载项」「默认安装
    /// 位置」三类来源，全部都要试 —— 只有协议键能报告那个**装 Games.exe 的版本目录**。
    fn installed_roots() -> Vec<PathBuf> {
        let mut roots = Vec::new();

        for protocol in subkeys(HKEY_CLASSES_ROOT, "", 0) {
            if !protocol
                .to_ascii_lowercase()
                .starts_with("hypergryphlauncher")
            {
                continue;
            }
            let command_path = format!("{protocol}\\shell\\open\\command");
            let Some(command) = read_registry(HKEY_CLASSES_ROOT, &command_path, None, 0) else {
                continue;
            };
            let command = wide(&command);
            let mut count = 0i32;
            let arguments = unsafe { CommandLineToArgvW(command.as_ptr(), &mut count) };
            if !arguments.is_null() {
                if count > 0 {
                    let first = unsafe { *arguments };
                    if !first.is_null() {
                        let mut length = 0usize;
                        while unsafe { *first.add(length) } != 0 {
                            length += 1;
                        }
                        let text = String::from_utf16_lossy(unsafe {
                            std::slice::from_raw_parts(first, length)
                        });
                        let file_name = Path::new(&text)
                            .file_name()
                            .map(|name| name.to_string_lossy().into_owned())
                            .unwrap_or_default();
                        if file_name.eq_ignore_ascii_case("Launcher.exe") {
                            add_root(&mut roots, Path::new(&text));
                        }
                    }
                }
                unsafe { LocalFree(arguments as *mut c_void) };
            }
        }

        const UNINSTALL: &str = "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall";
        for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
            for view in [KEY_WOW64_64KEY, KEY_WOW64_32KEY] {
                for child in subkeys(hive, UNINSTALL, view) {
                    let key = format!("{UNINSTALL}\\{child}");
                    let name = read_registry(hive, &key, Some("DisplayName"), view);
                    let is_launcher = name.is_some_and(|name| {
                        name == "鹰角启动器" || name.eq_ignore_ascii_case("Hypergryph Launcher")
                    });
                    if !is_launcher {
                        continue;
                    }
                    if let Some(location) = read_registry(hive, &key, Some("InstallLocation"), view)
                    {
                        add_root(&mut roots, Path::new(&location));
                    }
                }
            }
        }

        for variable in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            let name = wide(variable);
            let mut value = vec![0u16; 32768];
            let length =
                unsafe { GetEnvironmentVariableW(name.as_ptr(), value.as_mut_ptr(), 32768) };
            if length > 0 && (length as usize) < value.len() {
                let base = trim_at_nul(&value[..length as usize]);
                add_root(&mut roots, &Path::new(&base).join("Hypergryph Launcher"));
            }
        }

        roots
    }

    // ---------------------------- 签名校验 ----------------------------

    /// WinTrust 校验状态。Drop 时用 `WTD_STATEACTION_CLOSE` 释放 provider 状态 ——
    /// 漏掉这一步会泄漏状态，是 `WinVerifyTrust` 的常见误用。
    struct TrustState {
        policy: GUID,
        data: WINTRUST_DATA,
    }

    impl Drop for TrustState {
        fn drop(&mut self) {
            self.data.dwStateAction = WTD_STATEACTION_CLOSE;
            unsafe {
                WinVerifyTrust(
                    ptr::null_mut(),
                    &mut self.policy,
                    &mut self.data as *mut WINTRUST_DATA as *mut c_void,
                );
            }
        }
    }

    /// 已通过校验的官方启动器；`file` 保持打开直到调用方显式释放。
    struct VerifiedLauncher {
        executable: PathBuf,
        file: Option<File>,
    }

    /// 复刻 `VerifyOfficialLauncher`：文件必须名为 `Games.exe`；用**独占只读**句柄交给
    /// WinTrust（校验的就是将要启动的那份字节），再确认签名者组织为官方发行方。
    fn verify_official_launcher(input: &Path) -> Result<VerifiedLauncher, LaunchError> {
        let file_name = input
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
        if !file_name.eq_ignore_ascii_case("Games.exe") {
            return Err(LaunchError::new(
                LaunchToken::NoLauncher,
                "the official parent must be Games.exe",
            ));
        }

        let path = absolute(input);
        let file = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(FILE_SHARE_READ)
            .open(&path)
            .map_err(|error| {
                LaunchError::new(
                    LaunchToken::NoLauncher,
                    format!("cannot read official launcher {}: {error}", path.display()),
                )
            })?;

        let path_wide = wide(&path.to_string_lossy());
        let mut info = WINTRUST_FILE_INFO::default();
        info.cbStruct = std::mem::size_of::<WINTRUST_FILE_INFO>() as u32;
        info.pcwszFilePath = path_wide.as_ptr();
        // 给句柄而不是只给路径：WinTrust 校验的是这个句柄指向的文件对象。
        info.hFile = file.as_raw_handle() as HANDLE;

        let mut data = WINTRUST_DATA::default();
        data.cbStruct = std::mem::size_of::<WINTRUST_DATA>() as u32;
        data.dwUIChoice = WTD_UI_NONE;
        data.fdwRevocationChecks = WTD_REVOKE_NONE;
        data.dwUnionChoice = WTD_CHOICE_FILE;
        data.Anonymous.pFile = &mut info;
        data.dwStateAction = WTD_STATEACTION_VERIFY;
        data.dwProvFlags = WTD_CACHE_ONLY_URL_RETRIEVAL | WTD_REVOCATION_CHECK_NONE;

        let mut trust = TrustState {
            policy: WINTRUST_ACTION_GENERIC_VERIFY_V2,
            data,
        };
        let status = unsafe {
            WinVerifyTrust(
                ptr::null_mut(),
                &mut trust.policy,
                &mut trust.data as *mut WINTRUST_DATA as *mut c_void,
            )
        };
        if status != ERROR_SUCCESS as i32 {
            return Err(LaunchError::new(
                LaunchToken::NoLauncher,
                format!(
                    "signature verification failed for {} (WinTrust 0x{:08x}); repair the official launcher installation",
                    path.display(),
                    status
                ),
            ));
        }

        // 验签通过只说明「文件没被改、证书链可信」；发行者身份必须另外钉死，
        // 否则任何持有受信任代码签名证书的人签一个叫 Games.exe 的文件都能过关。
        let organization = unsafe { signer_organization(trust.data.hWVTStateData) };
        if !is_official_publisher(&organization) {
            return Err(LaunchError::new(
                LaunchToken::NoLauncher,
                format!(
                    "launcher signer is not the official publisher (organization: \"{organization}\")"
                ),
            ));
        }

        Ok(VerifiedLauncher {
            executable: path,
            file: Some(file),
        })
    }

    /// 从校验状态里取第 0 个签名者（非副署签名者）证书链的**末端实体证书**，读它的 `O` 字段。
    /// 必须在 `TrustState` 存活期间调用 —— 证书内存属于 provider 状态。
    unsafe fn signer_organization(state: HANDLE) -> String {
        if state.is_null() || state == INVALID_HANDLE_VALUE {
            return String::new();
        }
        let provider = WTHelperProvDataFromStateData(state);
        if provider.is_null() {
            return String::new();
        }
        let signer: *mut CRYPT_PROVIDER_SGNR = WTHelperGetProvSignerFromChain(provider, 0, 0, 0);
        if signer.is_null() {
            return String::new();
        }
        let signer = &*signer;
        if signer.csCertChain == 0 || signer.pasCertChain.is_null() {
            return String::new();
        }
        let certificate = (*signer.pasCertChain).pCert;
        if certificate.is_null() {
            return String::new();
        }
        let parameter = szOID_ORGANIZATION_NAME as *const c_void;
        let length = CertGetNameStringW(
            certificate,
            CERT_NAME_ATTR_TYPE,
            0,
            parameter,
            ptr::null_mut(),
            0,
        );
        if length <= 1 {
            return String::new();
        }
        let mut buffer = vec![0u16; length as usize];
        CertGetNameStringW(
            certificate,
            CERT_NAME_ATTR_TYPE,
            0,
            parameter,
            buffer.as_mut_ptr(),
            length,
        );
        buffer.truncate(length as usize - 1); // 去掉结尾 NUL，与上游 resize(length - 1) 一致
        String::from_utf16_lossy(&buffer)
    }

    /// 复刻 `FindOfficialLauncher`：给了 `--parent` 就只校验它，否则枚举候选并按版本降序
    /// （最新优先）逐个校验，返回第一个通过的。
    fn find_official_launcher(requested: Option<&Path>) -> Result<VerifiedLauncher, LaunchError> {
        if let Some(requested) = requested {
            return verify_official_launcher(requested);
        }

        let mut candidates: Vec<PathBuf> = Vec::new();
        for root in installed_roots() {
            let direct = root.join("Games.exe");
            if direct.is_file() {
                candidates.push(direct);
            }
            let Ok(entries) = std::fs::read_dir(&root) else {
                continue;
            };
            for entry in entries.flatten() {
                let candidate = entry.path().join("Games.exe");
                if !version_key(&candidate).is_empty() && candidate.is_file() {
                    candidates.push(candidate);
                }
            }
        }
        // 稳定降序：版本目录名解析失败（空 key）的候选排最后。
        candidates.sort_by(|left, right| version_key(right).cmp(&version_key(left)));

        let mut last: Option<LaunchError> = None;
        for candidate in candidates {
            match verify_official_launcher(&candidate) {
                Ok(launcher) => return Ok(launcher),
                Err(error) => last = Some(error),
            }
        }
        Err(LaunchError::new(
            LaunchToken::NoLauncher,
            last.map(|error| error.detail).unwrap_or_else(|| {
                "no installed official Hypergryph launcher was found".to_string()
            }),
        ))
    }

    // ---------------------------- 挂起的官方父进程 ----------------------------

    /// 拥有那个**挂起的**官方启动器进程，并负责收尾。
    struct OfficialParent {
        process: OwnedHandle,
        pid: u32,
    }

    impl OfficialParent {
        /// 复刻 `OfficialParent::Start`。要求校验时打开的独占句柄仍然有效 ——
        /// 它保证「验签」与「创建进程」之间那个 exe 不可能被替换。
        fn start(launcher: &VerifiedLauncher) -> Result<Self, String> {
            if launcher.file.is_none() {
                return Err(
                    "invalid verified launcher state: file handle released before process creation"
                        .to_string(),
                );
            }
            let executable = launcher.executable.to_string_lossy().into_owned();
            let executable_wide = wide(&executable);
            let mut command = Vec::new();
            quote_argument(&executable, &mut command);
            let directory = launcher
                .executable
                .parent()
                .map(|parent| parent.to_string_lossy().into_owned())
                .unwrap_or_default();
            let directory_wide = wide(&directory);

            let mut startup = STARTUPINFOW::default();
            startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
            startup.dwFlags = STARTF_USESHOWWINDOW;
            startup.wShowWindow = SW_HIDE as u16;

            let mut process = PROCESS_INFORMATION::default();
            // CREATE_SUSPENDED 让启动器的主线程永久挂起：它永远不会执行，因此没有界面、
            // 没有启动器逻辑；只有映像与签名留在那里供游戏的父进程检查读取。
            let created = unsafe {
                CreateProcessW(
                    executable_wide.as_ptr(),
                    command.as_mut_ptr(),
                    ptr::null(),
                    ptr::null(),
                    0,
                    CREATE_SUSPENDED | CREATE_NO_WINDOW,
                    ptr::null(),
                    directory_wide.as_ptr(),
                    &startup,
                    &mut process,
                )
            };
            if created == 0 {
                return Err(windows_error(
                    "Create official launcher parent",
                    last_error(),
                ));
            }

            // 线程句柄立即关闭：线程对象由进程持有，没有任何地方会 ResumeThread，
            // 所以主线程依旧永久挂起（关句柄不等于结束线程）。
            unsafe { CloseHandle(process.hThread) };
            Ok(Self {
                process: OwnedHandle::new(process.hProcess),
                pid: process.dwProcessId,
            })
        }

        /// 复刻 `OfficialParent::CreateGame`：用属性列表把挂起的启动器指定为游戏进程的父进程。
        fn create_game(
            &self,
            game: &Path,
            arguments: &[String],
        ) -> Result<(OwnedHandle, u32), String> {
            // 两段式：先问需要多大，再按指针宽度对齐分配，最后初始化。
            let mut size = 0usize;
            unsafe { InitializeProcThreadAttributeList(ptr::null_mut(), 1, 0, &mut size) };
            if size == 0 {
                return Err(windows_error("Prepare parent attributes", last_error()));
            }
            let mut storage = vec![0usize; size.div_ceil(std::mem::size_of::<usize>())];
            let list = storage.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
            let mut actual = size;
            if unsafe { InitializeProcThreadAttributeList(list, 1, 0, &mut actual) } == 0 {
                return Err(windows_error("Initialize parent attributes", last_error()));
            }

            // 无论从哪条路径返回都会删除属性列表。
            struct AttributeList(LPPROC_THREAD_ATTRIBUTE_LIST);
            impl Drop for AttributeList {
                fn drop(&mut self) {
                    unsafe { DeleteProcThreadAttributeList(self.0) };
                }
            }
            let _attributes = AttributeList(list);
            // `parent` 必须活到 CreateProcessW 返回：属性只保存指向它的指针。
            let parent = self.process.get();
            if unsafe {
                UpdateProcThreadAttribute(
                    list,
                    0,
                    PROC_THREAD_ATTRIBUTE_PARENT_PROCESS as usize,
                    &parent as *const HANDLE as *const c_void,
                    std::mem::size_of::<HANDLE>(),
                    ptr::null_mut(),
                    ptr::null(),
                )
            } == 0
            {
                return Err(windows_error("Set official parent", last_error()));
            }

            let mut startup = STARTUPINFOEXW::default();
            // 用属性列表时 cb 必须是 STARTUPINFOEX 的大小，且要传 &StartupInfo。
            startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
            startup.lpAttributeList = list;

            let executable = game.to_string_lossy().into_owned();
            let executable_wide = wide(&executable);
            let mut command = quote_command_line(&executable, arguments);
            let directory = game
                .parent()
                .map(|parent| parent.to_string_lossy().into_owned())
                .unwrap_or_default();
            let directory_wide = wide(&directory);

            let mut process = PROCESS_INFORMATION::default();
            // 游戏自身不挂起：没有任何东西要注入，它拿到官方父进程后就该跑起来。
            let created = unsafe {
                CreateProcessW(
                    executable_wide.as_ptr(),
                    command.as_mut_ptr(),
                    ptr::null(),
                    ptr::null(),
                    0,
                    EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
                    ptr::null(),
                    directory_wide.as_ptr(),
                    &startup.StartupInfo,
                    &mut process,
                )
            };
            if created == 0 {
                return Err(windows_error("Create game process", last_error()));
            }

            unsafe { CloseHandle(process.hThread) };
            Ok((OwnedHandle::new(process.hProcess), process.dwProcessId))
        }
    }

    impl Drop for OfficialParent {
        fn drop(&mut self) {
            // 只终止本进程创建的启动器，并等它真正消失（上游 ~OfficialParent）。
            if !self.process.is_valid() {
                return;
            }
            let handle = self.process.get();
            unsafe {
                if WaitForSingleObject(handle, 0) == WAIT_TIMEOUT
                    && TerminateProcess(handle, 0) == 0
                {
                    tracing::error!(
                        "[launcher] {}",
                        windows_error("Clean up owned launcher parent", last_error())
                    );
                    return;
                }
                WaitForSingleObject(handle, 5000);
            }
        }
    }

    fn wait_for_game(process: HANDLE) -> Result<u32, String> {
        unsafe {
            if WaitForSingleObject(process, INFINITE) != WAIT_OBJECT_0 {
                return Err(windows_error("Wait for game exit", last_error()));
            }
            let mut code = 0u32;
            if GetExitCodeProcess(process, &mut code) == 0 {
                return Err(windows_error("Read game exit status", last_error()));
            }
            Ok(code)
        }
    }

    /// 创建游戏成功后写入 pid。调用方用它区分「helper 启动阶段失败」与「游戏很快退出」。
    fn write_status_file(path: &Path, game_pid: u32) {
        if let Err(error) = std::fs::write(path, format!("pid={game_pid}\n")) {
            tracing::warn!(
                "[launcher] could not write status file {}: {error}",
                path.display()
            );
        }
    }

    // ---------------------------- helper：完整启动流程 ----------------------------

    /// 当前进程是否由 `launcher_start_game` 以提权 helper 身份启动；是则跑完整个流程并
    /// 返回应使用的退出码。`lib.rs::run()` 必须在任何日志/Tauri 初始化之前调用它。
    pub fn try_run_helper() -> Option<i32> {
        let arguments: Vec<String> = std::env::args_os()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect();
        if arguments.get(1).map(String::as_str) != Some(HELPER_FLAG) {
            return None;
        }
        // 注意：本函数必须先把所有 RAII 对象析构完再返回，外层再 std::process::exit。
        // process::exit 不跑析构函数，若在持有挂起父进程句柄时退出，那个 Games.exe 会永远残留。
        Some(run_helper(&arguments[2..]))
    }

    fn run_helper(arguments: &[String]) -> i32 {
        ensure_console_hidden();
        // 日志失败不致命，但此时**不能**安装 tracing 桥接层：它每条事件都会取全局
        // Logger，而 Logger 未初始化时 `get_logger()` 会 panic（那样游戏就起不来了）。
        // 不装订阅者时所有 tracing 调用天然成为空操作。
        if crate::utils::logger::init_logger().is_ok() {
            crate::utils::logger::init_tracing_subscriber();
            tracing::info!("[launcher] helper: {}", arguments.join(" "));
        }

        let options = match parse_helper_options(arguments) {
            Ok(options) => options,
            Err(error) => {
                tracing::error!("[launcher] invalid arguments: {error}");
                return exit_code::INVALID_ARGUMENTS;
            }
        };
        if options.help {
            tracing::info!("[launcher] {}", usage());
            return 0;
        }
        if !options.game.is_file() {
            tracing::error!(
                "[launcher] game executable not found: {}",
                options.game.display()
            );
            return exit_code::INVALID_ARGUMENTS;
        }

        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| launch(&options)));
        match outcome {
            Ok(Ok(code)) => code,
            Ok(Err(error)) => {
                tracing::error!("[launcher] {}", error.message());
                tracing::error!("[launcher] helper exiting with code {}", error.exit_code());
                error.exit_code()
            }
            Err(_) => {
                tracing::error!("[launcher] helper panicked; exiting");
                exit_code::CREATE_FAILED
            }
        }
    }

    /// 全部 RAII 对象都活在本函数作用域内：返回值先算出来，析构（终止挂起的启动器）
    /// 完成之后调用方才退出进程。
    fn launch(options: &HelperOptions) -> Result<i32, LaunchError> {
        let mut launcher = find_official_launcher(options.parent.as_deref())?;
        tracing::info!(
            "[launcher] official launcher: {}",
            launcher.executable.display()
        );

        let parent = OfficialParent::start(&launcher)
            .map_err(|error| LaunchError::new(LaunchToken::Create, error))?;
        tracing::info!(
            "[launcher] suspended official parent created, pid {}",
            parent.pid
        );
        // 映像已映射、签名已读；释放文件句柄，好让官方更新器能在游戏运行期间替换启动器。
        launcher.file = None;

        let (game, game_pid) = parent
            .create_game(&options.game, &options.arguments)
            .map_err(|error| LaunchError::new(LaunchToken::Create, error))?;
        tracing::info!("[launcher] game process created, pid {game_pid}");
        if let Some(status_file) = &options.status_file {
            write_status_file(status_file, game_pid);
        }

        let code = wait_for_game(game.get())
            .map_err(|error| LaunchError::new(LaunchToken::WaitFailed, error))?;
        tracing::info!("[launcher] game exited with code {code}; cleaning up suspended parent");
        // 作用域结束：OfficialParent 的 Drop 终止挂起的启动器并等待它消失。
        Ok(code as i32)
    }

    // ---------------------------- 未提权一侧：发现 + 提权重启自身 ----------------------------

    /// `ShellExecuteExW` 返回的 helper 进程句柄（唯一能观察提权进程的通道）。
    pub struct HelperProcess {
        handle: Option<OwnedHandle>,
        pid: u32,
    }

    impl HelperProcess {
        pub fn pid(&self) -> u32 {
            self.pid
        }

        /// 宽限期内探测 helper 是否已经退出；`Some(code)` 表示它在启动阶段就结束了。
        fn wait_early_exit(&self, timeout: Duration) -> Option<u32> {
            let handle = self.handle.as_ref()?;
            let milliseconds = timeout.as_millis().min(u32::MAX as u128) as u32;
            unsafe {
                if WaitForSingleObject(handle.get(), milliseconds) != WAIT_OBJECT_0 {
                    return None;
                }
                let mut code = 0u32;
                if GetExitCodeProcess(handle.get(), &mut code) == 0 {
                    return None;
                }
                Some(code)
            }
        }

        /// 把句柄交给一个分离线程，等 helper 结束（= 游戏退出）后记录退出码并关闭它。
        /// 这样句柄不会在整个游戏运行期间泄漏，也不必让 Tauri 命令一直挂着。
        fn watch_to_completion(mut self) {
            let raw = self
                .handle
                .as_mut()
                .map(OwnedHandle::take)
                .unwrap_or(ptr::null_mut());
            if raw.is_null() || raw == INVALID_HANDLE_VALUE {
                return;
            }
            // 内核句柄是进程级的，跨线程传递安全；这里转成 usize 以免引入 unsafe impl Send。
            let bits = raw as usize;
            std::thread::spawn(move || {
                let handle = bits as HANDLE;
                unsafe {
                    WaitForSingleObject(handle, INFINITE);
                    let mut code = 0u32;
                    if GetExitCodeProcess(handle, &mut code) != 0 {
                        tracing::info!("[launcher] elevated helper exited with code {code}");
                    }
                    CloseHandle(handle);
                }
            });
        }
    }

    fn helper_exit_message(code: u32) -> LaunchError {
        let token = match code as i32 {
            exit_code::INVALID_ARGUMENTS => LaunchToken::Create,
            exit_code::NO_VALID_LAUNCHER => LaunchToken::NoLauncher,
            exit_code::WAIT_FAILED => LaunchToken::WaitFailed,
            _ => LaunchToken::Unknown,
        };
        LaunchError::new(
            token,
            format!("elevated launch helper exited early with code {code}"),
        )
    }

    fn shell_execute_elevated(
        executable: &Path,
        parameters: &str,
    ) -> Result<HelperProcess, LaunchError> {
        let verb = wide("runas");
        let file = wide(&executable.to_string_lossy());
        let parameters_wide = wide(parameters);

        let mut info = SHELLEXECUTEINFOW::default();
        info.cbSize = std::mem::size_of::<SHELLEXECUTEINFOW>() as u32;
        info.fMask =
            SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI | SEE_MASK_NO_CONSOLE;
        info.lpVerb = verb.as_ptr();
        info.lpFile = file.as_ptr();
        info.lpParameters = parameters_wide.as_ptr();
        info.nShow = SW_HIDE; // helper 不显示任何界面

        let started = unsafe { ShellExecuteExW(&mut info) };
        if started == 0 {
            let code = last_error();
            let token = if code == ERROR_CANCELLED {
                LaunchToken::Cancelled
            } else {
                LaunchToken::Create
            };
            return Err(LaunchError::new(
                token,
                windows_error("Elevate launcher helper", code),
            ));
        }

        // 提权场景下系统允许 hProcess 为 NULL；此时没有观察通道，只能乐观认为已启动。
        let handle = if info.hProcess.is_null() || info.hProcess == INVALID_HANDLE_VALUE {
            tracing::warn!("[launcher] ShellExecuteExW returned no process handle");
            None
        } else {
            Some(OwnedHandle::new(info.hProcess))
        };
        let pid = handle
            .as_ref()
            .map(|handle| unsafe { GetProcessId(handle.get()) })
            .unwrap_or(0);
        Ok(HelperProcess { handle, pid })
    }

    /// 拼接 helper 的命令行。每个取值都用 [`quote_argument`] 转义，路径含空格也安全。
    fn helper_parameters(
        game: &Path,
        parent: &Path,
        arguments: &[String],
        status_file: Option<&Path>,
    ) -> String {
        let mut parts: Vec<String> = vec![
            HELPER_FLAG.to_string(),
            "--game".to_string(),
            game.to_string_lossy().into_owned(),
            "--parent".to_string(),
            parent.to_string_lossy().into_owned(),
        ];
        if let Some(status_file) = status_file {
            parts.push("--status".to_string());
            parts.push(status_file.to_string_lossy().into_owned());
        }
        if !arguments.is_empty() {
            parts.push("--".to_string());
            parts.extend(arguments.iter().cloned());
        }

        let mut wide_line: Vec<u16> = Vec::new();
        for (index, part) in parts.iter().enumerate() {
            if index > 0 {
                wide_line.push(b' ' as u16);
            }
            quote_argument(part, &mut wide_line);
        }
        // 只可能来自本函数拼接的 ASCII + 路径，回损失败时退回原始串。
        String::from_utf16(&wide_line).unwrap_or_else(|_| parts.join(" "))
    }

    /// 未提权一侧的入口：先校验官方启动器（失败即 [`LaunchToken::NoLauncher`]，调用方据此
    /// 回退到直接启动），再以提权 helper 完成真正的创建。
    pub fn launch_via_official_parent(
        game: &Path,
        parent: Option<&Path>,
        arguments: &[String],
        status_file: Option<&Path>,
    ) -> Result<ElevatedLaunch, LaunchError> {
        let launcher = find_official_launcher(parent)?;
        tracing::info!(
            "[launcher] official launcher verified: {}",
            launcher.executable.display()
        );
        let launcher_path = launcher.executable.clone();
        // 句柄不能跨越提权边界；helper 会重新验签并保持自己的独占只读句柄。
        drop(launcher);

        if let Some(status_file) = status_file {
            // 上一次运行的状态文件必须先删掉，否则无法区分「这次的 helper 创建成功」。
            let _ = std::fs::remove_file(status_file);
        }

        let executable = std::env::current_exe().map_err(|error| {
            LaunchError::new(
                LaunchToken::Unknown,
                format!("cannot resolve own executable: {error}"),
            )
        })?;
        let parameters = helper_parameters(game, &launcher_path, arguments, status_file);
        let helper = shell_execute_elevated(&executable, &parameters)?;
        tracing::info!("[launcher] elevated helper started, pid {}", helper.pid());

        let helper_pid = helper.pid();
        if let Some(code) = helper.wait_early_exit(HELPER_GRACE) {
            let created = status_file.is_some_and(Path::exists);
            if created {
                // 状态文件在 ⇒ 游戏进程确实创建过，这个码是游戏自己的退出码（很快就退出了）。
                tracing::warn!(
                    "[launcher] helper exited with code {code} after creating the game process"
                );
                return Ok(ElevatedLaunch { helper_pid });
            }
            return Err(helper_exit_message(code));
        }

        helper.watch_to_completion();
        Ok(ElevatedLaunch { helper_pid })
    }

    /// 直接以 `ShellExecuteW` 启动游戏（回退路径，与旧实现一致：靠 shell 自动提权）。
    pub fn shell_execute_game(game: &Path) -> Result<(), String> {
        let executable = wide(&game.to_string_lossy());
        let directory = game
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned())
            .unwrap_or_default();
        let directory = wide(&directory);
        let result = unsafe {
            windows_sys::Win32::UI::Shell::ShellExecuteW(
                ptr::null_mut(),
                ptr::null(),
                executable.as_ptr(),
                ptr::null(),
                directory.as_ptr(),
                SW_SHOWNORMAL,
            )
        };
        if result as isize <= 32 {
            Err(windows_error("Launch game directly", result as u32))
        } else {
            Ok(())
        }
    }
}

#[cfg(target_os = "windows")]
pub use win::{launch_via_official_parent, shell_execute_game, try_run_helper};

// ============================ 非 Windows 桩 ============================
// 本模块只在 Windows 上有意义；其它平台（CI 也会构建 macOS / Linux）保持可编译。

#[cfg(not(target_os = "windows"))]
pub fn launch_via_official_parent(
    _game: &Path,
    _parent: Option<&Path>,
    _arguments: &[String],
    _status_file: Option<&Path>,
) -> Result<ElevatedLaunch, LaunchError> {
    Err(LaunchError::new(
        LaunchToken::Unknown,
        "the official launcher parent trick is Windows-only",
    ))
}

#[cfg(not(target_os = "windows"))]
pub fn shell_execute_game(_game: &Path) -> Result<(), String> {
    Err("the official launcher parent trick is Windows-only".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn try_run_helper() -> Option<i32> {
    None
}

// ============================ 单元测试 ============================

#[cfg(test)]
mod tests {
    use super::*;

    fn quoted(value: &str) -> String {
        let mut buffer = Vec::new();
        quote_argument(value, &mut buffer);
        String::from_utf16(&buffer).unwrap()
    }

    #[test]
    fn quotes_plain_arguments() {
        assert_eq!(
            quoted(r"C:\Games\Endfield.exe"),
            r#""C:\Games\Endfield.exe""#
        );
    }

    #[test]
    fn doubles_trailing_backslashes() {
        // 结尾反斜杠会转义闭引号，必须翻倍（否则路径会把引号吃掉）。
        assert_eq!(quoted(r"C:\dir with space\"), r#""C:\dir with space\\""#);
    }

    #[test]
    fn escapes_embedded_quotes() {
        assert_eq!(quoted(r#"say "hi""#), r#""say \"hi\"""#);
        // 反斜杠紧邻引号：反斜杠翻倍 + 引号转义。
        assert_eq!(quoted(r#"a\"#), r#""a\\""#);
    }

    #[test]
    fn accepts_only_official_publisher() {
        assert!(is_official_publisher(
            "Shanghai Hypergryph Network Technology Co., Ltd."
        ));
        assert!(is_official_publisher(
            "shanghai hypergryph network technology co., ltd."
        ));
        assert!(!is_official_publisher("Some Other Company"));
        assert!(!is_official_publisher(""));
    }

    #[test]
    fn parses_version_directories() {
        assert_eq!(
            version_key(Path::new(r"C:\L\1.6.0\Games.exe")),
            vec![1, 6, 0]
        );
        assert_eq!(version_key(Path::new(r"C:\L\1.2.\Games.exe")), vec![1, 2]);
        // 非版本目录名（含字母）与畸形名字一律最低。
        assert!(version_key(Path::new(r"C:\Hypergryph Launcher\Games.exe")).is_empty());
        assert!(version_key(Path::new(r"C:\L\1..2\Games.exe")).is_empty());
        assert!(version_key(Path::new(r"C:\L\Games.exe")).is_empty());
    }

    #[test]
    fn compares_versions_numerically() {
        // 1.10 必须新于 1.6（字典序比较会错，逐段数值比较才对）。
        let newer = version_key(Path::new(r"C:\L\1.10.0\Games.exe"));
        let older = version_key(Path::new(r"C:\L\1.6.0\Games.exe"));
        assert!(newer > older);
    }

    #[test]
    fn parses_helper_options() {
        let options = parse_helper_options(&[
            "--game".into(),
            r"C:\G\Endfield.exe".into(),
            "--parent".into(),
            r"C:\P\Games.exe".into(),
            "--status".into(),
            r"C:\S\status".into(),
            "--".into(),
            "-logFile".into(),
            r"D:\my log.txt".into(),
        ])
        .expect("parse");
        assert!(options.game.is_absolute());
        assert!(options.game.to_string_lossy().ends_with(r"G\Endfield.exe"));
        assert_eq!(options.parent, Some(PathBuf::from(r"C:\P\Games.exe")));
        assert_eq!(options.status_file, Some(PathBuf::from(r"C:\S\status")));
        // `--` 之后的参数原样保留（含空格、以 - 开头的参数）。
        assert_eq!(options.arguments, vec!["-logFile", r"D:\my log.txt"]);
    }

    #[test]
    fn rejects_repeated_value_options() {
        // 取值选项只能出现一次（与上游 ParseOptions 一致）。
        assert!(parse_helper_options(&[
            "--game".into(),
            r"C:\G\Endfield.exe".into(),
            "--game".into(),
            r"C:\G\Endfield.exe".into(),
        ])
        .is_err());
    }

    #[test]
    fn treats_everything_after_dashdash_as_game_arguments() {
        let options = parse_helper_options(&[
            "--game".into(),
            r"C:\G\Endfield.exe".into(),
            "--".into(),
            "--hide-console".into(),
        ])
        .expect("parse");
        assert_eq!(options.arguments, vec!["--hide-console"]);
    }

    #[test]
    fn rejects_invalid_helper_options() {
        assert!(parse_helper_options(&["--nope".into()]).is_err());
        assert!(parse_helper_options(&["--game".into()]).is_err()); // 缺少取值
        assert!(parse_helper_options(&["--game".into(), r"C:\G\NotEndfield.exe".into()]).is_err());
        assert!(parse_helper_options(&[]).is_err());
    }

    #[test]
    fn help_short_circuits() {
        assert!(parse_helper_options(&["--help".into()]).unwrap().help);
        assert!(parse_helper_options(&["-h".into()]).unwrap().help);
    }

    #[test]
    fn builds_quoted_command_line() {
        let line = quote_command_line(
            r"C:\Program Files\Games\Endfield.exe",
            &[r"-logFile".to_string(), r"D:\my log.txt".to_string()],
        );
        assert_eq!(
            String::from_utf16(&line).unwrap(),
            r#""C:\Program Files\Games\Endfield.exe" "-logFile" "D:\my log.txt""#
        );
    }
}

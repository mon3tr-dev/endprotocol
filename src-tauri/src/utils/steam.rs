//! Steam 第三方游戏（非 Steam 快捷方式）注入。
//!
//! Steam 将「添加非 Steam 游戏」的结果保存在
//! `userdata/<accountId>/config/shortcuts.vdf`（二进制 VDF）中。
//! 本模块直接读写该文件：按显示名匹配已有条目，命中则更新，否则追加一条。
//! 快捷方式目标为 EndProtocol 主程序，启动选项、图标与显示名由调用方传入。
//!
//! 另外提供 Overlay 相关的两件事：
//! - 为 `.lnk` 写入「以管理员身份运行」（RunAsAdmin）标志；
//! - 把「开始」菜单里的 Steam 快捷方式也提升为管理员运行。
//!
//! 允许 Steam 运行中写入：Steam 退出时会用内存中的列表覆盖 `shortcuts.vdf`，
//! 因此写完后提示用户「先完全退出 Steam 再重启」是调用方（UI）的责任。

use std::fs;
use std::path::{Path, PathBuf};
#[cfg(target_os = "windows")]
use std::time::{SystemTime, UNIX_EPOCH};

pub const TYPE_OBJECT: u8 = 0x00;
const TYPE_STRING: u8 = 0x01;
const TYPE_INT32: u8 = 0x02;
const TYPE_FLOAT: u8 = 0x03;
const TYPE_POINTER: u8 = 0x04;
const TYPE_WSTRING: u8 = 0x05;
const TYPE_COLOR: u8 = 0x06;
const TYPE_UINT64: u8 = 0x07;
const TYPE_END: u8 = 0x08;

#[derive(Debug, Clone)]
enum VdfValue {
    Object(Vec<(String, VdfValue)>),
    String(String),
    Int32(i32),
    Float(f32),
    Pointer(u32),
    WideString(Vec<u16>),
    Color(u32),
    UInt64(u64),
}

struct ShortcutsFile {
    root_key: String,
    entries: Vec<(String, VdfValue)>,
    trailing_end_bytes: usize,
}

/// Steam 库条目的全部可配置字段。
pub struct SteamShortcut<'a> {
    /// Steam 库中显示的条目名（同时用于去重：同名条目会被更新而不是重复追加）。
    pub name: &'a str,
    /// 启动目标 exe（写入 VDF 时加引号）。
    pub exe_path: &'a Path,
    /// 启动选项，例如 `--silent --launch-game --dx11`。
    pub launch_options: &'a str,
    /// 图标文件路径；`None` 时回退为 exe 自身路径。
    pub icon_path: Option<&'a Path>,
}

/// 将第三方游戏条目写入当前 Steam 账户的快捷方式，返回 `shortcuts.vdf` 路径。
pub fn add_shortcut(shortcut: &SteamShortcut<'_>) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let steam_root = find_steam_root().ok_or_else(|| {
            "Steam installation was not found. Make sure Steam is installed.".to_string()
        })?;
        let shortcuts_path = find_shortcuts_file(&steam_root)?;

        let bytes = match fs::read(&shortcuts_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => {
                return Err(format!(
                    "Could not read {}: {error}",
                    shortcuts_path.display()
                ));
            }
        };

        let mut file = parse_shortcuts(&bytes)?;
        upsert_shortcut(&mut file, shortcut);
        write_atomically(&shortcuts_path, &encode_shortcuts(&file))?;
        Ok(shortcuts_path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = shortcut;
        Err("Steam shortcuts can only be added on Windows.".to_string())
    }
}

/// 定位 Steam 安装目录（注册表优先，其次 `Program Files`）。
#[cfg(target_os = "windows")]
pub fn steam_root() -> Result<PathBuf, String> {
    find_steam_root().ok_or_else(|| {
        "Steam installation was not found. Make sure Steam is installed.".to_string()
    })
}

#[cfg(not(target_os = "windows"))]
pub fn steam_root() -> Result<PathBuf, String> {
    Err("Steam is only supported on Windows.".to_string())
}

/// 在解析后的 shortcuts 列表中更新或追加一条快捷方式。
fn upsert_shortcut(file: &mut ShortcutsFile, shortcut: &SteamShortcut<'_>) {
    let exe = format!("\"{}\"", shortcut.exe_path.display());
    let start_dir = shortcut
        .exe_path
        .parent()
        .map(|dir| format!("\"{}\"", dir.display()))
        .unwrap_or_default();
    let icon = shortcut
        .icon_path
        .unwrap_or(shortcut.exe_path)
        .display()
        .to_string();
    let app_id = steam_app_id(&exe, shortcut.name) as i32;

    let existing = file.entries.iter_mut().find_map(|(_, value)| match value {
        VdfValue::Object(fields) if field_string(fields, "AppName") == Some(shortcut.name) => {
            Some(fields)
        }
        _ => None,
    });

    if let Some(fields) = existing {
        set_string(fields, "Exe", exe);
        set_string(fields, "StartDir", start_dir);
        set_string(fields, "icon", icon);
        set_string(
            fields,
            "LaunchOptions",
            shortcut.launch_options.to_string(),
        );
        set_i32(fields, "appid", app_id);
        return;
    }

    let fields = vec![
        ("appid".to_string(), VdfValue::Int32(app_id)),
        (
            "AppName".to_string(),
            VdfValue::String(shortcut.name.to_string()),
        ),
        ("Exe".to_string(), VdfValue::String(exe)),
        ("StartDir".to_string(), VdfValue::String(start_dir)),
        ("icon".to_string(), VdfValue::String(icon)),
        ("ShortcutPath".to_string(), VdfValue::String(String::new())),
        (
            "LaunchOptions".to_string(),
            VdfValue::String(shortcut.launch_options.to_string()),
        ),
        ("IsHidden".to_string(), VdfValue::Int32(0)),
        ("AllowDesktopConfig".to_string(), VdfValue::Int32(1)),
        ("AllowOverlay".to_string(), VdfValue::Int32(1)),
        ("OpenVR".to_string(), VdfValue::Int32(0)),
        ("LastPlayTime".to_string(), VdfValue::Int32(0)),
        ("tags".to_string(), VdfValue::Object(Vec::new())),
    ];

    let index = next_entry_index(&file.entries);
    file.entries.push((index, VdfValue::Object(fields)));
}

fn field_string<'a>(fields: &'a [(String, VdfValue)], key: &str) -> Option<&'a str> {
    fields
        .iter()
        .find(|(field_key, _)| field_key == key)
        .and_then(|(_, value)| match value {
            VdfValue::String(text) => Some(text.as_str()),
            _ => None,
        })
}

fn set_string(fields: &mut Vec<(String, VdfValue)>, key: &str, value: String) {
    match fields.iter_mut().find(|(field_key, _)| field_key == key) {
        Some((_, slot)) => *slot = VdfValue::String(value),
        None => fields.push((key.to_string(), VdfValue::String(value))),
    }
}

fn set_i32(fields: &mut Vec<(String, VdfValue)>, key: &str, value: i32) {
    match fields.iter_mut().find(|(field_key, _)| field_key == key) {
        Some((_, slot)) => *slot = VdfValue::Int32(value),
        None => fields.push((key.to_string(), VdfValue::Int32(value))),
    }
}

fn next_entry_index(entries: &[(String, VdfValue)]) -> String {
    entries
        .iter()
        .filter_map(|(key, _)| key.parse::<u64>().ok())
        .max()
        .map(|max| max.saturating_add(1).to_string())
        .unwrap_or_else(|| "0".to_string())
}

/// Steam 为非 Steam 快捷方式生成的 AppID：CRC32(Exe + AppName) | 0x80000000。
fn steam_app_id(exe: &str, name: &str) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for byte in exe.bytes().chain(name.bytes()) {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xEDB8_8320
            } else {
                crc >> 1
            };
        }
    }
    (!crc) | 0x8000_0000
}

fn parse_shortcuts(bytes: &[u8]) -> Result<ShortcutsFile, String> {
    if bytes.is_empty() {
        return Ok(ShortcutsFile {
            root_key: "shortcuts".to_string(),
            entries: Vec::new(),
            trailing_end_bytes: 0,
        });
    }

    let mut parser = Parser::new(bytes);
    if parser.byte()? != TYPE_OBJECT {
        return Err("shortcuts.vdf does not start with an object.".to_string());
    }
    let root_key = parser.cstring()?;
    if !root_key.eq_ignore_ascii_case("shortcuts") {
        return Err("shortcuts.vdf has an unexpected root key.".to_string());
    }
    let entries = parser.entries()?;
    let trailing = &bytes[parser.pos..];
    if trailing.iter().any(|byte| *byte != TYPE_END) {
        return Err("shortcuts.vdf contains unexpected trailing data.".to_string());
    }

    Ok(ShortcutsFile {
        root_key,
        entries,
        trailing_end_bytes: trailing.len(),
    })
}

fn encode_shortcuts(file: &ShortcutsFile) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(TYPE_OBJECT);
    write_cstring(&mut out, &file.root_key);
    for (key, value) in &file.entries {
        write_value(&mut out, key, value);
    }
    out.push(TYPE_END);
    out.extend(std::iter::repeat(TYPE_END).take(file.trailing_end_bytes));
    out
}

fn write_value(out: &mut Vec<u8>, key: &str, value: &VdfValue) {
    match value {
        VdfValue::Object(entries) => {
            out.push(TYPE_OBJECT);
            write_cstring(out, key);
            for (child_key, child_value) in entries {
                write_value(out, child_key, child_value);
            }
            out.push(TYPE_END);
        }
        VdfValue::String(text) => {
            out.push(TYPE_STRING);
            write_cstring(out, key);
            write_cstring(out, text);
        }
        VdfValue::Int32(value) => {
            out.push(TYPE_INT32);
            write_cstring(out, key);
            out.extend_from_slice(&value.to_le_bytes());
        }
        VdfValue::Float(value) => {
            out.push(TYPE_FLOAT);
            write_cstring(out, key);
            out.extend_from_slice(&value.to_le_bytes());
        }
        VdfValue::Pointer(value) => {
            out.push(TYPE_POINTER);
            write_cstring(out, key);
            out.extend_from_slice(&value.to_le_bytes());
        }
        VdfValue::WideString(units) => {
            out.push(TYPE_WSTRING);
            write_cstring(out, key);
            for unit in units {
                out.extend_from_slice(&unit.to_le_bytes());
            }
            out.extend_from_slice(&[0, 0]);
        }
        VdfValue::Color(value) => {
            out.push(TYPE_COLOR);
            write_cstring(out, key);
            out.extend_from_slice(&value.to_le_bytes());
        }
        VdfValue::UInt64(value) => {
            out.push(TYPE_UINT64);
            write_cstring(out, key);
            out.extend_from_slice(&value.to_le_bytes());
        }
    }
}

fn write_cstring(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(value.as_bytes());
    out.push(0);
}

struct Parser<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn byte(&mut self) -> Result<u8, String> {
        let byte = self
            .data
            .get(self.pos)
            .copied()
            .ok_or_else(|| "Unexpected end of shortcuts.vdf.".to_string())?;
        self.pos += 1;
        Ok(byte)
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self
            .pos
            .checked_add(length)
            .ok_or_else(|| "Invalid shortcuts.vdf offset.".to_string())?;
        if end > self.data.len() {
            return Err("Unexpected end of shortcuts.vdf.".to_string());
        }
        let slice = &self.data[self.pos..end];
        self.pos = end;
        Ok(slice)
    }

    fn cstring(&mut self) -> Result<String, String> {
        let rest = &self.data[self.pos..];
        let length = rest
            .iter()
            .position(|byte| *byte == 0)
            .ok_or_else(|| "Unterminated string in shortcuts.vdf.".to_string())?;
        let value = String::from_utf8_lossy(&rest[..length]).into_owned();
        self.pos += length + 1;
        Ok(value)
    }

    fn entries(&mut self) -> Result<Vec<(String, VdfValue)>, String> {
        let mut entries = Vec::new();
        loop {
            let kind = self.byte()?;
            if kind == TYPE_END {
                return Ok(entries);
            }
            let key = self.cstring()?;
            let value = match kind {
                TYPE_OBJECT => VdfValue::Object(self.entries()?),
                TYPE_STRING => VdfValue::String(self.cstring()?),
                TYPE_INT32 => VdfValue::Int32(i32::from_le_bytes(self.bytes4()?)),
                TYPE_FLOAT => VdfValue::Float(f32::from_le_bytes(self.bytes4()?)),
                TYPE_POINTER => VdfValue::Pointer(u32::from_le_bytes(self.bytes4()?)),
                TYPE_WSTRING => VdfValue::WideString(self.wstring()?),
                TYPE_COLOR => VdfValue::Color(u32::from_le_bytes(self.bytes4()?)),
                TYPE_UINT64 => {
                    let bytes: [u8; 8] = self
                        .take(8)?
                        .try_into()
                        .map_err(|_| "Invalid 64-bit value in shortcuts.vdf.".to_string())?;
                    VdfValue::UInt64(u64::from_le_bytes(bytes))
                }
                other => {
                    return Err(format!(
                        "Unsupported value type 0x{other:02x} in shortcuts.vdf."
                    ));
                }
            };
            entries.push((key, value));
        }
    }

    fn bytes4(&mut self) -> Result<[u8; 4], String> {
        self.take(4)?
            .try_into()
            .map_err(|_| "Invalid 32-bit value in shortcuts.vdf.".to_string())
    }

    fn wstring(&mut self) -> Result<Vec<u16>, String> {
        let mut units = Vec::new();
        loop {
            let pair = self.take(2)?;
            let unit = u16::from_le_bytes([pair[0], pair[1]]);
            if unit == 0 {
                return Ok(units);
            }
            units.push(unit);
        }
    }
}

fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
    }

    let temp_path = path.with_extension("vdf.tmp");
    fs::write(&temp_path, bytes)
        .map_err(|error| format!("Could not write {}: {error}", temp_path.display()))?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!("Could not replace {}: {error}", path.display())
    })
}

// ---------------------------------------------------------------------------
// 「以管理员身份运行」快捷方式
// ---------------------------------------------------------------------------

/// 创建一个「以管理员身份运行」的 `.lnk` 快捷方式。
///
/// 先用 `WScript.Shell` 写出目标和启动参数，再用 `Shell.Application` 的
/// `StartIn`/`IsAdmin` 能力（Windows Vista 起对 `.lnk` 提供 `RunAsAdmin` 标志）。
///
/// # 参数
/// - `shortcut_path`：`.lnk` 的保存路径（缺扩展名时自动补 `.lnk`）
/// - `target`：要启动的 exe
/// - `arguments`：命令行参数
/// - `icon`：图标路径（`None` 时不设置）
/// - `description`：快捷方式备注
///
/// 返回创建好的 `.lnk` 路径。
#[cfg(target_os = "windows")]
pub fn create_elevated_shortcut(
    shortcut_path: &Path,
    target: &Path,
    arguments: &str,
    icon: Option<&Path>,
    description: &str,
) -> Result<PathBuf, String> {
    let mut shortcut_path = shortcut_path.to_path_buf();
    if !shortcut_path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
    {
        shortcut_path.set_extension("lnk");
    }

    let work_dir = target
        .parent()
        .ok_or_else(|| "Could not determine the application directory.".to_string())?;

    let icon_assignment = icon
        .map(|icon| {
            format!(
                "$shortcut.IconLocation = '{}'; ",
                powershell_literal(&format!("{},0", icon.display()))
            )
        })
        .unwrap_or_default();

    // RunAsAdmin 只能通过快捷方式的 “Verb”/属性页写入；`WScript.Shell.Save()` 之后
    // 用 Shell.Application 找到该 .lnk 的 “以管理员身份运行” 动词并执行 `DoIt()`，
    // 等价于在属性页里勾选并保存，随后的写入只影响该快捷方式自身。
    let script = format!(
        "$ErrorActionPreference = 'Stop'; \
         $shell = New-Object -ComObject WScript.Shell; \
         $shortcut = $shell.CreateShortcut('{shortcut}'); \
         $shortcut.TargetPath = '{target}'; \
         $shortcut.Arguments = '{arguments}'; \
         $shortcut.WorkingDirectory = '{work_dir}'; \
         $shortcut.Description = '{description}'; \
         {icon_assignment}\
         $shortcut.Save(); \
         $path = '{shortcut}'; \
         $item = (New-Object -ComObject Shell.Application).Namespace((Split-Path $path)).ParseName((Split-Path $path -Leaf)); \
         $verb = $item.Verbs() | Where-Object {{ $_.Name -match 'admin|管理员' }} | Select-Object -First 1; \
         if ($verb) {{ $verb.DoIt() }} else {{ throw 'RunAsAdmin verb is unavailable for this shortcut.' }}",
        shortcut = powershell_literal(&shortcut_path.to_string_lossy()),
        target = powershell_literal(&target.to_string_lossy()),
        arguments = powershell_literal(arguments),
        work_dir = powershell_literal(&work_dir.to_string_lossy()),
        description = powershell_literal(description),
    );

    run_powershell(&script)?;
    Ok(shortcut_path)
}

#[cfg(not(target_os = "windows"))]
pub fn create_elevated_shortcut(
    _shortcut_path: &Path,
    _target: &Path,
    _arguments: &str,
    _icon: Option<&Path>,
    _description: &str,
) -> Result<PathBuf, String> {
    Err("Windows shortcuts can only be created on Windows.".to_string())
}

/// 「开始」菜单里指向 Steam 的快捷方式（用户级 + 公共级）。
///
/// 只返回真实存在的 `.lnk`；`steam_url.lnk`（`steam://` 协议）不在其中，
/// 它无法承载「以管理员身份运行」标志。
#[cfg(target_os = "windows")]
pub fn find_start_menu_steam_shortcuts() -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut roots = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        roots.push(
            PathBuf::from(appdata)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }
    if let Some(program_data) = std::env::var_os("PROGRAMDATA") {
        roots.push(
            PathBuf::from(program_data)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs"),
        );
    }

    for root in roots {
        collect_steam_shortcuts(&root, &mut found, 0);
    }
    found
}

#[cfg(not(target_os = "windows"))]
pub fn find_start_menu_steam_shortcuts() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn collect_steam_shortcuts(dir: &Path, found: &mut Vec<PathBuf>, depth: usize) {
    // 「开始」菜单通常只有两三层嵌套，限制深度避免跟随异常目录结构。
    const MAX_DEPTH: usize = 4;

    if depth > MAX_DEPTH {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_steam_shortcuts(&path, found, depth + 1);
            continue;
        }
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
        {
            continue;
        }
        let name = path
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if name != "steam" {
            continue;
        }
        found.push(path);
    }
}

/// 把已有快捷方式标记为「以管理员身份运行」，返回处理过的路径列表。
///
/// 已经是管理员运行的快捷方式会被跳过（幂等）。
#[cfg(target_os = "windows")]
pub fn elevate_shortcuts(paths: &[PathBuf]) -> Vec<PathBuf> {
    let mut updated = Vec::new();
    for path in paths {
        match mark_shortcut_as_admin(path) {
            Ok(true) => updated.push(path.clone()),
            Ok(false) => {}
            Err(error) => {
                tracing::warn!(
                    "[steam] could not mark {} as administrator: {error}",
                    path.display()
                );
            }
        }
    }
    updated
}

#[cfg(not(target_os = "windows"))]
pub fn elevate_shortcuts(_paths: &[PathBuf]) -> Vec<PathBuf> {
    Vec::new()
}

/// 通过快捷方式的 “以管理员身份运行” 动词设置 RunAsAdmin；已经设置时返回 `Ok(false)`。
#[cfg(target_os = "windows")]
fn mark_shortcut_as_admin(path: &Path) -> Result<bool, String> {
    // `Verbs()` 里出现该动词即表示当前未勾选；勾选后动词消失，因此查不到时视为已完成。
    let script = format!(
        "$ErrorActionPreference = 'Stop'; \
         $path = '{}'; \
         $item = (New-Object -ComObject Shell.Application).Namespace((Split-Path $path)).ParseName((Split-Path $path -Leaf)); \
         $verb = $item.Verbs() | Where-Object {{ $_.Name -match 'admin|管理员' }} | Select-Object -First 1; \
         if (-not $verb) {{ Write-Output 'unchanged'; exit 0 }} \
         $verb.DoIt(); \
         Write-Output 'updated'",
        powershell_literal(&path.to_string_lossy())
    );

    let output = run_powershell(&script)?;
    Ok(output.trim().eq_ignore_ascii_case("updated"))
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str) -> Result<String, String> {
    use base64::Engine;
    use std::os::windows::process::CommandExt;

    let encoded_script = {
        let bytes = script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>();
        base64::engine::general_purpose::STANDARD.encode(bytes)
    };

    let output = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-STA",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-EncodedCommand",
            &encoded_script,
        ])
        .creation_flags(windows_sys::Win32::System::Threading::CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("Could not start PowerShell: {error}"))?;

    if !output.status.success() {
        let detail = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stderr),
            String::from_utf8_lossy(&output.stdout)
        );
        let detail = detail.trim();
        return Err(if detail.is_empty() {
            format!("PowerShell exited with status {}.", output.status)
        } else {
            detail.to_string()
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

#[cfg(target_os = "windows")]
fn powershell_literal(value: &str) -> String {
    value.replace('\'', "''")
}

// ---------------------------------------------------------------------------
// Steam 安装发现
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn find_steam_root() -> Option<PathBuf> {
    use windows_sys::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    let registry_candidates = [
        read_registry_string(HKEY_CURRENT_USER, r"Software\Valve\Steam", "SteamPath"),
        read_registry_string(
            HKEY_LOCAL_MACHINE,
            r"SOFTWARE\WOW6432Node\Valve\Steam",
            "InstallPath",
        ),
        read_registry_string(HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam", "InstallPath"),
    ];

    for candidate in registry_candidates.into_iter().flatten() {
        let path = PathBuf::from(candidate.trim().trim_matches('"'));
        if path.join("userdata").is_dir() {
            return Some(path);
        }
    }

    for variable in ["ProgramFiles(x86)", "ProgramFiles"] {
        if let Some(base) = std::env::var_os(variable) {
            let path = PathBuf::from(base).join("Steam");
            if path.join("userdata").is_dir() {
                return Some(path);
            }
        }
    }

    None
}

#[cfg(target_os = "windows")]
fn read_registry_string(
    root: windows_sys::Win32::System::Registry::HKEY,
    path: &str,
    name: &str,
) -> Option<String> {
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, KEY_QUERY_VALUE, REG_EXPAND_SZ, REG_SZ,
    };

    let path = wide(path);
    let mut key = std::ptr::null_mut();
    let status = unsafe { RegOpenKeyExW(root, path.as_ptr(), 0, KEY_QUERY_VALUE, &mut key) };
    if status != ERROR_SUCCESS {
        return None;
    }

    let name = wide(name);
    let mut kind = 0u32;
    let mut bytes = 0u32;
    let status = unsafe {
        RegQueryValueExW(
            key,
            name.as_ptr(),
            std::ptr::null(),
            &mut kind,
            std::ptr::null_mut(),
            &mut bytes,
        )
    };
    if status != ERROR_SUCCESS
        || (kind != REG_SZ && kind != REG_EXPAND_SZ)
        || bytes == 0
        || bytes > 65536
    {
        unsafe { RegCloseKey(key) };
        return None;
    }

    let mut buffer = vec![0u16; bytes as usize / 2 + 1];
    let status = unsafe {
        RegQueryValueExW(
            key,
            name.as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
            buffer.as_mut_ptr() as *mut u8,
            &mut bytes,
        )
    };
    unsafe { RegCloseKey(key) };
    if status != ERROR_SUCCESS {
        return None;
    }

    let length = buffer
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..length]))
}

#[cfg(target_os = "windows")]
fn wide(value: &str) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    std::ffi::OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
fn find_shortcuts_file(steam_root: &Path) -> Result<PathBuf, String> {
    let userdata = steam_root.join("userdata");
    if !userdata.is_dir() {
        return Err("Steam user data was not found. Sign in to Steam at least once.".to_string());
    }

    let mut existing_files: Vec<(SystemTime, PathBuf)> = Vec::new();
    let mut config_dirs: Vec<(SystemTime, PathBuf)> = Vec::new();

    let entries = fs::read_dir(&userdata)
        .map_err(|error| format!("Could not read {}: {error}", userdata.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Could not read Steam user data: {error}"))?;
        let account_dir = entry.path();
        if !account_dir.is_dir() {
            continue;
        }
        let is_account_id = account_dir
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| !name.is_empty() && name.chars().all(|ch| ch.is_ascii_digit()))
            .unwrap_or(false);
        if !is_account_id {
            continue;
        }

        let config_dir = account_dir.join("config");
        if !config_dir.is_dir() {
            continue;
        }

        let shortcuts = config_dir.join("shortcuts.vdf");
        if shortcuts.is_file() {
            existing_files.push((modified_time(&shortcuts), shortcuts));
        }
        config_dirs.push((modified_time(&config_dir), config_dir));
    }

    if let Some((_, path)) = existing_files.into_iter().max_by_key(|(time, _)| *time) {
        return Ok(path);
    }
    if let Some((_, config_dir)) = config_dirs.into_iter().max_by_key(|(time, _)| *time) {
        return Ok(config_dir.join("shortcuts.vdf"));
    }

    Err("No Steam account data was found. Sign in to Steam at least once.".to_string())
}

#[cfg(target_os = "windows")]
fn modified_time(path: &Path) -> SystemTime {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .unwrap_or(UNIX_EPOCH)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_file() -> ShortcutsFile {
        ShortcutsFile {
            root_key: "shortcuts".to_string(),
            entries: vec![(
                "0".to_string(),
                VdfValue::Object(vec![
                    ("appid".to_string(), VdfValue::Int32(-42)),
                    ("AppName".to_string(), VdfValue::String("Other".to_string())),
                    (
                        "Exe".to_string(),
                        VdfValue::String("\"C:\\Games\\other.exe\"".to_string()),
                    ),
                    ("tags".to_string(), VdfValue::Object(Vec::new())),
                ]),
            )],
            trailing_end_bytes: 2,
        }
    }

    #[test]
    fn round_trips_binary_vdf() {
        let file = sample_file();
        let encoded = encode_shortcuts(&file);
        let parsed = parse_shortcuts(&encoded).expect("parse");
        assert_eq!(parsed.root_key, "shortcuts");
        assert_eq!(parsed.entries.len(), 1);
        assert_eq!(parsed.trailing_end_bytes, 2);
        assert_eq!(
            field_string(
                match &parsed.entries[0].1 {
                    VdfValue::Object(fields) => fields,
                    _ => panic!("expected object"),
                },
                "AppName"
            ),
            Some("Other")
        );
    }

    #[test]
    fn appends_new_shortcut_with_custom_name_and_icon() {
        let mut file = sample_file();
        upsert_shortcut(
            &mut file,
            &SteamShortcut {
                name: "明日方舟：终末地",
                exe_path: Path::new(r"C:\Apps\EndProtocol.exe"),
                launch_options: "--silent --launch-game --dx11",
                icon_path: Some(Path::new(r"C:\Icons\endfield.ico")),
            },
        );
        assert_eq!(file.entries.len(), 2);
        let encoded = encode_shortcuts(&file);
        let parsed = parse_shortcuts(&encoded).expect("parse");
        let fields = match &parsed.entries[1].1 {
            VdfValue::Object(fields) => fields,
            _ => panic!("expected object"),
        };
        assert_eq!(field_string(fields, "AppName"), Some("明日方舟：终末地"));
        assert_eq!(
            field_string(fields, "Exe"),
            Some("\"C:\\Apps\\EndProtocol.exe\"")
        );
        assert_eq!(
            field_string(fields, "icon"),
            Some("C:\\Icons\\endfield.ico")
        );
        assert_eq!(
            field_string(fields, "LaunchOptions"),
            Some("--silent --launch-game --dx11")
        );
        assert_eq!(parsed.entries[1].0, "1");
        let app_id = match fields.iter().find(|(key, _)| key == "appid") {
            Some((_, VdfValue::Int32(value))) => *value,
            _ => panic!("missing appid"),
        };
        assert_eq!(
            app_id,
            steam_app_id(
                "\"C:\\Apps\\EndProtocol.exe\"",
                "明日方舟：终末地"
            ) as i32
        );
    }

    #[test]
    fn updates_existing_shortcut_by_name() {
        let mut file = sample_file();
        file.entries.push((
            "1".to_string(),
            VdfValue::Object(vec![(
                "AppName".to_string(),
                VdfValue::String("明日方舟：终末地".to_string()),
            )]),
        ));
        upsert_shortcut(
            &mut file,
            &SteamShortcut {
                name: "明日方舟：终末地",
                exe_path: Path::new(r"C:\Apps\EndProtocol.exe"),
                launch_options: "--silent --launch-game",
                icon_path: None,
            },
        );
        assert_eq!(file.entries.len(), 2);
        let fields = match &file.entries[1].1 {
            VdfValue::Object(fields) => fields,
            _ => panic!("expected object"),
        };
        assert_eq!(
            field_string(fields, "LaunchOptions"),
            Some("--silent --launch-game")
        );
        // 未提供图标时回退为 exe 自身路径。
        assert_eq!(
            field_string(fields, "icon"),
            Some("C:\\Apps\\EndProtocol.exe")
        );
    }
}

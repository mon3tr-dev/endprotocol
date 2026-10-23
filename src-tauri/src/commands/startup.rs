use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::services::config_service::ConfigService;

const MAIN_EXE_KEY: &str = "main_exe_path";
const INSTALL_PATH_KEY: &str = "launcher_install_path";
const CHANNEL_KEY: &str = "launcher_channel";
const DX11_CONFIG_KEY: &str = "launcher_dx11";
const STEAM_SHORTCUT_NAME_KEY: &str = "steam_shortcut_name";
const STEAM_SHORTCUT_ICON_KEY: &str = "steam_shortcut_icon";
const STEAM_CREATE_ADMIN_SHORTCUT_KEY: &str = "steam_create_admin_shortcut";
const STEAM_ELEVATE_START_MENU_KEY: &str = "steam_elevate_start_menu";

const LAUNCH_ARGS: &str = "--silent --launch-game";
const DX11_ARG: &str = "--dx11";
/// Steam 条目默认显示名。
const DEFAULT_STEAM_NAME: &str = "明日方舟：终末地";
/// 管理员 Steam 快捷方式的启动参数（跳过好友界面，减少启动时的额外窗口）。
const STEAM_ADMIN_ARGS: &str = "-nofriendsui -allfriendsui";

pub(crate) fn launch_args(dx11: bool) -> String {
    let mut args = LAUNCH_ARGS.to_string();
    if dx11 {
        args.push(' ');
        args.push_str(DX11_ARG);
    }
    args
}

/// Steam 第三方游戏条目的可编辑参数。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamShortcutOptions {
    /// 显示名；缺省值见 [`steam_shortcut_defaults`]。
    pub name: String,
    /// `icon` 字段的图片路径；缺省为从 `Endfield.exe` 提取的 `.ico` 副本。
    pub icon_path: Option<String>,
    /// 启动选项是否附带 `--dx11`（缺省读应用设置）。
    pub dx11: Option<bool>,
    /// 是否创建「以管理员身份运行」的 Steam 快捷方式。
    #[serde(default)]
    pub create_admin_shortcut: bool,
    /// 是否把「开始」菜单中的 Steam 快捷方式提升为管理员运行。
    #[serde(default)]
    pub elevate_start_menu: bool,
}

/// Steam 弹窗打开时的默认值。
#[derive(Debug, Clone, Serialize)]
pub struct SteamShortcutDefaults {
    pub name: String,
    /// 默认图标（已从 `Endfield.exe` 提取的 `.ico`；提取失败时为 `Endfield.exe` 自身）。
    pub icon_path: String,
    /// `icon_path` 是否为从游戏 exe 提取出的图标文件。
    pub icon_extracted: bool,
    /// 游戏 exe 是否存在；不存在时 UI 允许用户自行选择图标。
    pub game_exe_found: bool,
    pub dx11: bool,
    /// 上次保存的「创建管理员 Steam 快捷方式」选项。
    pub create_admin_shortcut: bool,
    /// 上次保存的「提升开始菜单 Steam 快捷方式」选项。
    pub elevate_start_menu: bool,
    /// 「开始」菜单中检测到的 Steam 快捷方式数量。
    pub start_menu_shortcut_count: usize,
    pub is_elevated: bool,
}

/// `add_steam_shortcut` 的返回值。
#[derive(Debug, Clone, Serialize)]
pub struct AddSteamShortcutResult {
    /// 写入的 `shortcuts.vdf` 路径。
    pub shortcuts_path: String,
    /// 新建的管理员 Steam 快捷方式路径（未勾选时为 `None`）。
    pub admin_shortcut: Option<String>,
    /// 本次被提升为管理员运行的「开始」菜单快捷方式。
    pub elevated_start_menu: Vec<String>,
}

fn normalize_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy().into_owned();
    let normalized = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = text.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        text
    };
    PathBuf::from(normalized)
}

fn ensure_main_exe_path(config_service: &Arc<Mutex<ConfigService>>) -> Result<PathBuf, String> {
    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let current_exe = normalize_path(current_exe.canonicalize().unwrap_or(current_exe));
    let current_exe_string = current_exe.to_string_lossy().into_owned();

    let mut config = config_service.lock().map_err(|error| error.to_string())?;
    let stored_path = config.get::<String>(MAIN_EXE_KEY);
    let stored_path_is_valid = stored_path
        .as_deref()
        .map(PathBuf::from)
        .map(|path| path.is_file())
        .unwrap_or(false);

    if !stored_path_is_valid || stored_path.as_deref() != Some(&current_exe_string) {
        config
            .set(
                MAIN_EXE_KEY.to_string(),
                serde_json::Value::String(current_exe_string),
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(current_exe)
}

pub fn refresh_main_exe_path(config_service: &Arc<Mutex<ConfigService>>) -> Result<(), String> {
    ensure_main_exe_path(config_service).map(|_| ())
}

/// 读取游戏安装目录与渠道，校验可用后返回（游戏 exe 路径一并给出）。
fn resolve_install(config_service: &Arc<Mutex<ConfigService>>) -> Result<PathBuf, String> {
    let install_path = config_service
        .lock()
        .map_err(|error| error.to_string())?
        .get::<String>(INSTALL_PATH_KEY)
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| "Game installation path is not configured.".to_string())?;

    if !PathBuf::from(&install_path).is_dir() {
        return Err(format!(
            "Game installation directory does not exist: {install_path}"
        ));
    }

    let channel = config_service
        .lock()
        .map_err(|error| error.to_string())?
        .get::<String>(CHANNEL_KEY)
        .filter(|channel| !channel.trim().is_empty())
        .ok_or_else(|| "Game channel is not configured.".to_string())?;
    if !matches!(
        channel.to_ascii_lowercase().as_str(),
        "official" | "bilibili" | "global" | "google_play"
    ) {
        return Err(format!("Unsupported game channel: {channel}"));
    }

    Ok(
        PathBuf::from(&install_path)
            .join(crate::models::game::GameChannel::Official.executable_name()),
    )
}

/// 图标缓存路径：`%LOCALAPPDATA%\<app>\steam\endfield.ico`。
fn steam_icon_path() -> Result<PathBuf, String> {
    crate::utils::paths::app_data_dir()
        .map(|dir| dir.join("steam").join("endfield.ico"))
        .map_err(|error| error.to_string())
}

/// 提取游戏图标到缓存目录；失败时回退到游戏 exe 自身（Steam 也能直接用 exe 图标）。
fn default_icon(game_exe: &PathBuf) -> (String, bool, bool) {
    if !game_exe.is_file() {
        return (String::new(), false, false);
    }

    match steam_icon_path() {
        Ok(target) => match crate::utils::game_icon::extract_icon(game_exe, &target) {
            Ok(path) => (path.to_string_lossy().into_owned(), true, true),
            Err(error) => {
                tracing::warn!("[steam] icon extraction failed: {error}");
                (game_exe.to_string_lossy().into_owned(), false, true)
            }
        },
        Err(error) => {
            tracing::warn!("[steam] could not resolve icon cache path: {error}");
            (game_exe.to_string_lossy().into_owned(), false, true)
        }
    }
}

#[tauri::command]
pub fn get_game_launch_command(
    config_service: State<'_, Arc<Mutex<ConfigService>>>,
) -> Result<String, String> {
    let exe_path = ensure_main_exe_path(config_service.inner())?;
    Ok(format!("\"{}\" {LAUNCH_ARGS}", exe_path.display()))
}

/// Steam 弹窗默认值：名字、`Endfield.exe` 提取的图标、DX11 与上次勾选的 Overlay 选项。
#[tauri::command]
pub fn steam_shortcut_defaults(
    config_service: State<'_, Arc<Mutex<ConfigService>>>,
) -> Result<SteamShortcutDefaults, String> {
    let stored = {
        let config = config_service.lock().map_err(|error| error.to_string())?;
        (
            config.get::<String>(STEAM_SHORTCUT_NAME_KEY),
            config.get::<String>(STEAM_SHORTCUT_ICON_KEY),
            config.get::<bool>(DX11_CONFIG_KEY).unwrap_or(false),
            config
                .get::<bool>(STEAM_CREATE_ADMIN_SHORTCUT_KEY)
                .unwrap_or(false),
            config
                .get::<bool>(STEAM_ELEVATE_START_MENU_KEY)
                .unwrap_or(false),
        )
    };
    let (stored_name, stored_icon, dx11, create_admin_shortcut, elevate_start_menu) = stored;

    let game_exe = resolve_install(config_service.inner()).ok();
    let (extracted_icon, icon_extracted, game_exe_found) = match game_exe.as_ref() {
        Some(path) => default_icon(path),
        None => (String::new(), false, false),
    };

    // 上次保存的自定义图标仍然有效时优先使用。
    let icon_path = stored_icon
        .filter(|path| !path.trim().is_empty() && PathBuf::from(path).is_file())
        .unwrap_or(extracted_icon);

    let name = stored_name
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_STEAM_NAME.to_string());

    Ok(SteamShortcutDefaults {
        name,
        icon_path,
        icon_extracted,
        game_exe_found,
        dx11,
        create_admin_shortcut,
        elevate_start_menu,
        start_menu_shortcut_count: crate::utils::steam::find_start_menu_steam_shortcuts().len(),
        is_elevated: crate::utils::official_launcher::process_is_elevated(),
    })
}

/// 选择图标图片（`.ico` / `.png` / `.exe`）。取消返回 `None`。
#[tauri::command]
pub fn pick_steam_icon() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Choose Steam shortcut icon")
        .add_filter("Icon or executable", &["ico", "png", "exe"])
        .pick_file()
        .map(|path| path.to_string_lossy().into_owned()))
}

/// 选择游戏 exe（图标提取源）。取消返回 `None`。
#[tauri::command]
pub fn pick_steam_icon_source() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Choose the executable to extract the icon from")
        .add_filter("Windows executable", &["exe"])
        .pick_file()
        .map(|path| path.to_string_lossy().into_owned()))
}

/// 从指定 exe 提取图标，写出到缓存目录并返回 `.ico` 路径。
///
/// 用于用户手动指定「从哪个 exe 提取图标」（默认是游戏目录下的 `Endfield.exe`）。
#[tauri::command]
pub fn extract_steam_icon(exe_path: String) -> Result<String, String> {
    let target = steam_icon_path()?;
    crate::utils::game_icon::extract_icon(&PathBuf::from(exe_path), &target)
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn create_game_shortcut(
    config_service: State<'_, Arc<Mutex<ConfigService>>>,
    dx11: Option<bool>,
) -> Result<Option<String>, String> {
    let exe_path = ensure_main_exe_path(config_service.inner())?;
    let stored_dx11 = config_service
        .lock()
        .map_err(|error| error.to_string())?
        .get::<bool>(DX11_CONFIG_KEY)
        .unwrap_or(false);
    let use_dx11 = dx11.unwrap_or(stored_dx11);
    let game_exe = resolve_install(config_service.inner()).ok();

    #[cfg(target_os = "windows")]
    {
        let Some(mut shortcut_path) = rfd::FileDialog::new()
            .set_title("Save game launch shortcut")
            .set_file_name("EndProtocol - Start Game.lnk")
            .add_filter("Windows Shortcut", &["lnk"])
            .save_file()
        else {
            return Ok(None);
        };

        if !shortcut_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("lnk"))
        {
            shortcut_path.set_extension("lnk");
        }

        let work_dir = exe_path
            .parent()
            .ok_or_else(|| "Could not determine the application directory.".to_string())?;

        let icon_assignment = match game_exe.filter(|path| path.is_file()) {
            Some(game_exe) => format!(
                "$shortcut.IconLocation = '{}'; ",
                powershell_literal(&format!("{},0", game_exe.display()))
            ),
            None => String::new(),
        };

        let script = format!(
            "$shell = New-Object -ComObject WScript.Shell; \
             $shortcut = $shell.CreateShortcut('{}'); \
             $shortcut.TargetPath = '{}'; \
             $shortcut.Arguments = '{}'; \
             $shortcut.WorkingDirectory = '{}'; \
             {icon_assignment}\
             $shortcut.Save()",
            powershell_literal(&shortcut_path.to_string_lossy()),
            powershell_literal(&exe_path.to_string_lossy()),
            powershell_literal(&launch_args(use_dx11)),
            powershell_literal(&work_dir.to_string_lossy()),
        );

        run_powershell(&script)?;
        Ok(Some(shortcut_path.to_string_lossy().into_owned()))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (exe_path, use_dx11, game_exe);
        Err("Windows shortcuts can only be created on Windows.".to_string())
    }
}

/// 将第三方游戏条目写入当前 Steam 账户的「非 Steam 游戏」列表。
///
/// 允许 Steam 运行中写入：写完后需要用户重启 Steam 才能看到条目（UI 负责提示）。
/// 同时按用户勾选创建管理员 Steam 快捷方式 / 提升开始菜单中的 Steam 快捷方式。
#[tauri::command]
pub async fn add_steam_shortcut(
    config_service: State<'_, Arc<Mutex<ConfigService>>>,
    options: SteamShortcutOptions,
) -> Result<AddSteamShortcutResult, String> {
    let exe_path = ensure_main_exe_path(config_service.inner())?;
    let stored_dx11 = config_service
        .lock()
        .map_err(|error| error.to_string())?
        .get::<bool>(DX11_CONFIG_KEY)
        .unwrap_or(false);
    let use_dx11 = options.dx11.unwrap_or(stored_dx11);

    let name = options.name.trim();
    if name.is_empty() {
        return Err("The Steam shortcut name cannot be empty.".to_string());
    }

    let icon = options
        .icon_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from);

    #[cfg(target_os = "windows")]
    {
        let shortcuts_path = crate::utils::steam::add_shortcut(
            &crate::utils::steam::SteamShortcut {
                name,
                exe_path: &exe_path,
                launch_options: &launch_args(use_dx11),
                icon_path: icon.as_deref(),
            },
        )?;

        // 记住弹窗里的选择，下次打开时作为默认值。
        {
            let mut config = config_service.lock().map_err(|error| error.to_string())?;
            config
                .set(
                    STEAM_SHORTCUT_NAME_KEY.to_string(),
                    serde_json::Value::String(name.to_string()),
                )
                .map_err(|error| error.to_string())?;
            config
                .set(
                    STEAM_SHORTCUT_ICON_KEY.to_string(),
                    serde_json::Value::String(
                        icon.as_ref()
                            .map(|path| path.to_string_lossy().into_owned())
                            .unwrap_or_default(),
                    ),
                )
                .map_err(|error| error.to_string())?;
            config
                .set(
                    STEAM_CREATE_ADMIN_SHORTCUT_KEY.to_string(),
                    serde_json::Value::Bool(options.create_admin_shortcut),
                )
                .map_err(|error| error.to_string())?;
            config
                .set(
                    STEAM_ELEVATE_START_MENU_KEY.to_string(),
                    serde_json::Value::Bool(options.elevate_start_menu),
                )
                .map_err(|error| error.to_string())?;
        }

        let mut admin_shortcut: Option<String> = None;
        if options.create_admin_shortcut {
            let steam_root = crate::utils::steam::steam_root()?;
            let target = steam_root.join("steam.exe");
            if !target.is_file() {
                return Err(format!(
                    "steam.exe was not found in {}.",
                    steam_root.display()
                ));
            }

            // 用户先选路径，再写快捷方式；取消则整次添加视为失败（已写入的 Steam 条目保留）。
            let Some(save_path) = rfd::FileDialog::new()
                .set_title("Save the administrator Steam shortcut")
                .set_file_name("Steam (Administrator).lnk")
                .add_filter("Windows Shortcut", &["lnk"])
                .save_file()
            else {
                return Err("Cancelled while choosing the shortcut location.".to_string());
            };

            let created = crate::utils::steam::create_elevated_shortcut(
                &save_path,
                &target,
                STEAM_ADMIN_ARGS,
                Some(&target),
                "Steam (run as administrator)",
            )?;
            admin_shortcut = Some(created.to_string_lossy().into_owned());
        }

        let mut elevated_start_menu: Vec<String> = Vec::new();
        if options.elevate_start_menu {
            let shortcuts = crate::utils::steam::find_start_menu_steam_shortcuts();
            elevated_start_menu = crate::utils::steam::elevate_shortcuts(&shortcuts)
                .into_iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect();
        }

        Ok(AddSteamShortcutResult {
            shortcuts_path: shortcuts_path.to_string_lossy().into_owned(),
            admin_shortcut,
            elevated_start_menu,
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (exe_path, name, icon, use_dx11);
        Err("Steam shortcuts can only be added on Windows.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn powershell_literal(value: &str) -> String {
    value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    let encoded_script = {
        use base64::Engine;

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

    if output.status.success() {
        return Ok(());
    }

    let detail = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    let detail = detail.trim();
    Err(if detail.is_empty() {
        format!("PowerShell exited with status {}.", output.status)
    } else {
        detail.to_string()
    })
}

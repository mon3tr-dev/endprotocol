use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::State;

use crate::services::config_service::ConfigService;

const MAIN_EXE_KEY: &str = "main_exe_path";
const INSTALL_PATH_KEY: &str = "launcher_install_path";
const CHANNEL_KEY: &str = "launcher_channel";
const LAUNCH_ARGS: &str = "--silent --launch-game";

pub(crate) fn launch_args(close_after_launch: bool) -> String {
    if close_after_launch {
        format!("{LAUNCH_ARGS} {}", crate::CLOSE_AFTER_LAUNCH_ARG)
    } else {
        LAUNCH_ARGS.to_string()
    }
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

#[tauri::command]
pub fn get_game_launch_command(
    config_service: State<'_, Arc<Mutex<ConfigService>>>,
) -> Result<String, String> {
    let exe_path = ensure_main_exe_path(config_service.inner())?;
    Ok(format!("\"{}\" {LAUNCH_ARGS}", exe_path.display()))
}

#[tauri::command]
pub fn create_game_shortcut(
    config_service: State<'_, Arc<Mutex<ConfigService>>>,
    close_after_launch: Option<bool>,
) -> Result<Option<String>, String> {
    let exit_after_start = close_after_launch.unwrap_or(false);
    let exe_path = ensure_main_exe_path(config_service.inner())?;
    let (install_path, channel) = {
        let config = config_service.lock().map_err(|error| error.to_string())?;
        (
            config.get::<String>(INSTALL_PATH_KEY),
            config.get::<String>(CHANNEL_KEY),
        )
    };

    let install_path = install_path
        .filter(|path| !path.trim().is_empty())
        .ok_or_else(|| "Game installation path is not configured.".to_string())?;
    let channel = channel
        .filter(|channel| !channel.trim().is_empty())
        .ok_or_else(|| "Game channel is not configured.".to_string())?;
    if !PathBuf::from(&install_path).is_dir() {
        return Err(format!(
            "Game installation directory does not exist: {install_path}"
        ));
    }
    if !matches!(
        channel.to_ascii_lowercase().as_str(),
        "official" | "bilibili" | "global" | "google_play"
    ) {
        return Err(format!("Unsupported game channel: {channel}"));
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

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

        let game_exe = PathBuf::from(&install_path)
            .join(crate::models::game::GameChannel::Official.executable_name());
        let icon_assignment = if game_exe.is_file() {
            format!(
                "$shortcut.IconLocation = '{}'; \
                 ",
                format!("{},0", powershell_literal(&game_exe.to_string_lossy()))
            )
        } else {
            String::new()
        };

        let launch_arguments = launch_args(exit_after_start);
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
            powershell_literal(&launch_arguments),
            powershell_literal(&work_dir.to_string_lossy()),
        );
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

        let _ = (install_path, channel);
        Ok(Some(shortcut_path.to_string_lossy().into_owned()))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (exe_path, install_path, channel);
        Err("Windows shortcuts can only be created on Windows.".to_string())
    }
}

#[cfg(target_os = "windows")]
fn powershell_literal(value: &str) -> String {
    value.replace('\'', "''")
}

#[tauri::command]
pub fn create_launch_bat(
    config_service: State<'_, Arc<Mutex<ConfigService>>>,
    close_after_launch: Option<bool>,
) -> Result<Option<String>, String> {
    let exit_after_start = close_after_launch.unwrap_or(false);

    #[cfg(target_os = "windows")]
    {
        let exe_path = ensure_main_exe_path(config_service.inner())?;

        let Some(mut bat_path) = rfd::FileDialog::new()
            .set_title("Save game launch script")
            .set_file_name("EndProtocol - Start Game.bat")
            .add_filter("Batch File", &["bat"])
            .save_file()
        else {
            return Ok(None);
        };

        if !bat_path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("bat"))
        {
            bat_path.set_extension("bat");
        }

        let content = format!(
            "@echo off\r\nchcp 65001>nul\r\nstart \"\" \"{}\" {}\r\n",
            exe_path.display(),
            launch_args(exit_after_start)
        );
        std::fs::write(&bat_path, content)
            .map_err(|error| format!("Could not write batch file: {error}"))?;

        Ok(Some(bat_path.to_string_lossy().into_owned()))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (config_service, exit_after_start);
        Err("Windows batch files can only be created on Windows.".to_string())
    }
}

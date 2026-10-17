use std::sync::Arc;
use tauri::{Emitter, Manager, Runtime, State};

use crate::services::config_service::ConfigService;
use crate::tray::{update_tray_menu, TrayUserInfo};

/// Get the tray user info from config
#[tauri::command]
pub fn get_tray_user_info(
    config_service: State<'_, Arc<std::sync::Mutex<ConfigService>>>,
) -> Result<TrayUserInfo, String> {
    let config = config_service.lock().map_err(|e| e.to_string())?;
    Ok(config
        .get::<TrayUserInfo>("tray_user_info")
        .unwrap_or_default())
}

/// Set the selected user ID for tray display (role_id only)
#[tauri::command]
pub fn set_tray_user<R: Runtime>(
    app: tauri::AppHandle<R>,
    config_service: State<'_, Arc<std::sync::Mutex<ConfigService>>>,
    role_id: String,
) -> Result<(), String> {
    let user_info = {
        let mut config = config_service.lock().map_err(|e| e.to_string())?;
        let mut info = config
            .get::<TrayUserInfo>("tray_user_info")
            .unwrap_or_default();
        info.role_id = Some(role_id);
        config
            .set(
                "tray_user_info".to_string(),
                serde_json::to_value(&info).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        info
    };

    update_tray_menu(&app, &user_info).map_err(|e| e.to_string())?;
    Ok(())
}

/// Update the tray user data (called after fetching fresh data from API)
#[tauri::command]
pub fn update_tray_user_data<R: Runtime>(
    app: tauri::AppHandle<R>,
    config_service: State<'_, Arc<std::sync::Mutex<ConfigService>>>,
    user_info: TrayUserInfo,
) -> Result<(), String> {
    {
        let mut config = config_service.lock().map_err(|e| e.to_string())?;
        config
            .set(
                "tray_user_info".to_string(),
                serde_json::to_value(&user_info).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
    }

    update_tray_menu(&app, &user_info).map_err(|e| e.to_string())?;
    Ok(())
}

/// Show the tray panel window
#[tauri::command]
pub fn show_tray_panel<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    crate::tray::show_tray_panel(&app)
}

/// Hide the tray panel window
#[tauri::command]
pub fn hide_tray_panel<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    crate::tray::hide_tray_panel(&app)
}

/// Show the main window (from tray panel)
#[tauri::command]
pub fn show_main_window<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    crate::tray::show_main_window_focus(&app);
    // Hide tray panel
    let _ = crate::tray::hide_tray_panel(&app);
    Ok(())
}

/// Quit the application (from tray panel)
#[tauri::command]
pub fn app_quit<R: Runtime>(app: tauri::AppHandle<R>) {
    app.exit(0);
}

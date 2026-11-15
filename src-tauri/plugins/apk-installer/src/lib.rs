use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::{
    plugin::{PluginApi, PluginHandle},
    Manager,
};
#[cfg(target_os = "android")]
use serde::Serialize;

#[cfg(target_os = "android")]
struct ApkInstaller<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallApkArgs {
    path: String,
}

#[tauri::command]
async fn install_apk<R: Runtime>(app: AppHandle<R>, path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let installer = app.state::<ApkInstaller<R>>();
        installer
            .0
            .run_mobile_plugin::<serde_json::Value>("installApk", InstallApkArgs { path })
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path);
        Err("APK installation is only available on Android".to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("apk-installer")
        .invoke_handler(tauri::generate_handler![install_apk])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let installer = init_android(api)?;
                app.manage(installer);
            }

            #[cfg(not(target_os = "android"))]
            let _ = (app, api);

            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
fn init_android<R: Runtime, C: serde::de::DeserializeOwned>(
    api: PluginApi<R, C>,
) -> tauri::Result<ApkInstaller<R>> {
    api.register_android_plugin("com.endprotocol.apk_installer", "ApkInstallerPlugin")
        .map(ApkInstaller)
}

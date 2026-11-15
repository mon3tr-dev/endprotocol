use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::{
    plugin::{PluginApi, PluginHandle},
    Manager,
};
use serde::Serialize;

#[cfg(target_os = "android")]
struct ApkInstaller<R: Runtime>(PluginHandle<R>);

#[cfg(target_os = "android")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallApkArgs {
    path: String,
}

/// Outcome of an `install_apk` request.
///
/// `opened` means Android's package installer UI was launched and the user still has
/// to confirm. `permissionRequired` means the app may not install packages yet: the
/// plugin opened the "install unknown apps" settings screen and the caller should keep
/// the downloaded APK and retry instead of downloading it again.
#[cfg(target_os = "android")]
#[derive(Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallApkResult {
    status: String,
}

/// Outcome of an `install_apk` request, serialized as `{ "status": ... }`.
///
/// `opened` means Android's package installer UI was launched and the user still has
/// to confirm. `permission_required` means the app may not install packages yet: the
/// plugin opened the "install unknown apps" settings screen and the caller should keep
/// the downloaded APK and retry instead of downloading it again.
///
/// Modelled as a struct (not an enum) so the wire shape matches both the Kotlin
/// `JSObject` and the frontend's `{ status }` contract — a plain enum would serialize
/// to a bare string and `status` would read back as `undefined`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallApkOutcome {
    status: &'static str,
}

impl InstallApkOutcome {
    const OPENED: &'static str = "opened";
    const PERMISSION_REQUIRED: &'static str = "permissionRequired";

    fn opened() -> Self {
        Self {
            status: Self::OPENED,
        }
    }

    fn permission_required() -> Self {
        Self {
            status: Self::PERMISSION_REQUIRED,
        }
    }
}

#[tauri::command]
async fn install_apk<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<InstallApkOutcome, String> {
    #[cfg(target_os = "android")]
    {
        let installer = app.state::<ApkInstaller<R>>();
        let result = installer
            .0
            .run_mobile_plugin::<InstallApkResult>("installApk", InstallApkArgs { path })
            .map_err(|error| error.to_string())?;

        match result.status.as_str() {
            InstallApkOutcome::OPENED => Ok(InstallApkOutcome::opened()),
            InstallApkOutcome::PERMISSION_REQUIRED => Ok(InstallApkOutcome::permission_required()),
            other => Err(format!("Unknown APK installer status: {other}")),
        }
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
    // register_android_plugin returns PluginInvokeError; `?` converts it via
    // tauri::Error::PluginInvoke. A bare .map() would leak the foreign error type
    // and fail to compile against the declared tauri::Result.
    let handle =
        api.register_android_plugin("com.endprotocol.apk_installer", "ApkInstallerPlugin")?;
    Ok(ApkInstaller(handle))
}

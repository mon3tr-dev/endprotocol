use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::{
    plugin::{PluginApi, PluginHandle},
    Manager,
};
use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
struct SafeArea<R: Runtime>(PluginHandle<R>);

/// System-bar insets, in **CSS pixels**.
///
/// `top` / `bottom` are the heights of the status bar and the gesture/navigation
/// bar respectively; `left` / `right` are the widths of the display cutout in
/// landscape. All four are `0` on platforms that do not report them.
///
/// `Deserialize` is required because the Android side hands the values back
/// through `run_mobile_plugin`, which deserializes into this type.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SafeAreaInsets {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
}

/// Read the system-bar insets for the current window.
///
/// # Why this exists
///
/// Android 15 (API 35) forces edge-to-edge for apps targeting SDK 35+: the
/// WebView is laid out **behind** the status and navigation bars. The web
/// platform's `env(safe-area-inset-*)` is the intended way for a page to learn
/// about that, but it only works when the WebView itself is told about the
/// insets — and wry's Android WebView does not do that (wry 0.57 has no
/// safe-area plumbing at all, and `WryActivity` never calls
/// `setDecorFitsSystemWindows(false)`).
///
/// The practical result on Android is that `env(safe-area-inset-top)` resolves
/// to `0px` **while the status bar is visibly overlapping the page**. Any layout
/// that relies on `env()` to clear the status bar therefore does not clear it
/// at all.
///
/// This command reads the insets from the platform instead and hands them to
/// the frontend, which writes them into CSS custom properties
/// (`--safe-area-top` and friends). The frontend keeps using the same
/// variables, so the desktop/iOS path — where `env()` genuinely works — is
/// unchanged.
///
/// Returns zeroes on every non-Android platform: there the `env()` fallback in
/// the frontend already reports the real insets.
#[tauri::command]
async fn get_safe_area_insets<R: Runtime>(
    app: AppHandle<R>,
) -> Result<SafeAreaInsets, String> {
    #[cfg(target_os = "android")]
    {
        let plugin = app.state::<SafeArea<R>>();
        let result = plugin
            .0
            .run_mobile_plugin::<SafeAreaInsets>("getSafeAreaInsets", ())
            .map_err(|error| error.to_string())?;
        Ok(result)
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(SafeAreaInsets::default())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("safe-area")
        .invoke_handler(tauri::generate_handler![get_safe_area_insets])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let plugin = init_android(api)?;
                app.manage(plugin);
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
) -> tauri::Result<SafeArea<R>> {
    let handle =
        api.register_android_plugin("com.endprotocol.safe_area", "SafeAreaPlugin")?;
    Ok(SafeArea(handle))
}

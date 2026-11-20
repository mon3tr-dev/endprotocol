fn main() {
    tauri_plugin::Builder::new(&["get_safe_area_insets"])
        .android_path("android")
        .build();
}

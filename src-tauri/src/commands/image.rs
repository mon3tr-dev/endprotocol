use crate::services::avatar_cache_service::{all_sub_dir_names, resolve_url_subdir};
use crate::utils::{capture, paths};
use crate::{log_info, log_warn};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use std::fs;
use std::path::PathBuf;

/// 读取本地图片文件，返回字节数组
#[tauri::command]
pub fn read_image_file(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read image file '{}': {}", path, e))
}

/// 获取图片缓存目录路径
#[tauri::command]
pub fn get_image_cache_dir() -> Result<String, String> {
    let result = paths::image_cache_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string());
    log_info!("[image_cache] get_image_cache_dir: {:?}", result);
    result
}

/// 下载图片到本地缓存目录，返回本地文件路径
/// 如果已缓存则直接返回路径
/// sub_dir 可为空：此时根据 URL 注册表确定子目录，未命中则扫描所有子目录，
/// 仍未命中时下载到默认子目录。
#[tauri::command]
pub async fn download_image(
    url: String,
    cache_dir: String,
    sub_dir: String,
) -> Result<String, String> {
    log_info!(
        "[download_image] url={}, cache_dir={}, sub_dir={}",
        url,
        cache_dir,
        sub_dir
    );

    if url.is_empty() {
        log_warn!("[download_image] Empty URL");
        return Err("Empty URL".to_string());
    }

    // 如果已经是本地路径，直接返回
    if url.starts_with("file://") || url.starts_with("http://asset.localhost") {
        log_info!("[download_image] Already local path: {}", url);
        return Ok(url);
    }

    // 从URL提取文件名
    let filename = extract_filename_from_url(&url).ok_or_else(|| {
        let msg = format!("Invalid image URL: {}", url);
        log_warn!("[download_image] {}", msg);
        msg
    })?;
    log_info!("[download_image] Extracted filename: {}", filename);

    // 空 sub_dir：解析图片类型
    let sub_dir = if sub_dir.is_empty() {
        match resolve_url_subdir(&url) {
            Some(sd) => {
                log_info!("[download_image] Resolved sub_dir from registry: {}", sd);
                sd
            }
            None => {
                // 扫描所有子目录，命中已缓存文件则直接返回
                for name in all_sub_dir_names() {
                    let p = PathBuf::from(&cache_dir).join(name).join(&filename);
                    if p.exists() {
                        log_info!("[download_image] Cache hit in {}: {}", name, p.display());
                        return Ok(p.to_string_lossy().to_string());
                    }
                }
                log_warn!("[download_image] No registry entry, falling back to default sub_dir");
                "misc".to_string()
            }
        }
    } else {
        sub_dir
    };

    // 构建本地路径
    let type_dir = PathBuf::from(&cache_dir).join(&sub_dir);
    log_info!("[download_image] Creating dir: {}", type_dir.display());
    fs::create_dir_all(&type_dir).map_err(|e| {
        let msg = format!("Failed to create cache dir '{}': {}", type_dir.display(), e);
        log_warn!("[download_image] {}", msg);
        msg
    })?;

    let file_path = type_dir.join(&filename);

    // 已缓存则直接返回
    if file_path.exists() {
        log_info!("[download_image] Cache hit: {}", file_path.display());
        return Ok(file_path.to_string_lossy().to_string());
    }

    // 下载图片
    log_info!("[download_image] Downloading from: {}", url);
    let client = crate::utils::http_client::create_client();
    let response = capture::send(
        &client,
        client
            .get(&url)
            .header("Referer", "https://game.skland.com/"),
    )
    .await
    .map_err(|e| {
        let msg = format!("Failed to download image '{}': {}", url, e);
        log_warn!("[download_image] {}", msg);
        msg
    })?;

    let status = response.status();
    log_info!("[download_image] Response status: {}", status);

    let bytes = response.bytes().await.map_err(|e| {
        let msg = format!("Failed to read response body: {}", e);
        log_warn!("[download_image] {}", msg);
        msg
    })?;

    log_info!("[download_image] Downloaded {} bytes", bytes.len());

    // 保存到本地
    fs::write(&file_path, &bytes).map_err(|e| {
        let msg = format!("Failed to save image to '{}': {}", file_path.display(), e);
        log_warn!("[download_image] {}", msg);
        msg
    })?;

    log_info!("[download_image] Saved to: {}", file_path.display());
    Ok(file_path.to_string_lossy().to_string())
}

/// 获取背景图片目录路径
#[tauri::command]
pub fn get_backgrounds_dir() -> Result<String, String> {
    let result = paths::backgrounds_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string());
    log_info!("[background] get_backgrounds_dir: {:?}", result);
    result
}

/// 保存背景图片（base64 WebP 数据）到缓存目录
/// 返回保存后的文件路径
#[tauri::command]
pub fn save_background_image(data: String) -> Result<String, String> {
    let dir = paths::backgrounds_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create backgrounds dir: {}", e))?;

    // 清除旧的背景图片
    if dir.exists() {
        for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read dir: {}", e))? {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_file() {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }

    // 解码 base64 数据
    let base64_data = if data.starts_with("data:") {
        data.split(',').nth(1).unwrap_or(&data)
    } else {
        &data
    };

    let bytes = BASE64
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // 保存为 WebP 文件
    let file_path = dir.join("bg.webp");
    fs::write(&file_path, &bytes).map_err(|e| format!("Failed to save background: {}", e))?;

    let path_str = file_path.to_string_lossy().to_string();
    log_info!("[background] Saved to: {}", path_str);
    Ok(path_str)
}

/// 删除背景图片
#[tauri::command]
pub fn delete_background_image() -> Result<(), String> {
    let dir = paths::backgrounds_dir().map_err(|e| e.to_string())?;
    if dir.exists() {
        for entry in fs::read_dir(&dir).map_err(|e| format!("Failed to read dir: {}", e))? {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.is_file() {
                    fs::remove_file(&path).map_err(|e| format!("Failed to delete: {}", e))?;
                }
            }
        }
    }
    log_info!("[background] Deleted background image");
    Ok(())
}

/// 从URL提取文件名
fn extract_filename_from_url(url: &str) -> Option<String> {
    // 移除查询参数
    let url_without_query = url.split('?').next()?;
    // 获取路径最后一部分作为文件名
    let filename = url_without_query.rsplit('/').next()?;
    if filename.is_empty() {
        return None;
    }
    Some(filename.to_string())
}

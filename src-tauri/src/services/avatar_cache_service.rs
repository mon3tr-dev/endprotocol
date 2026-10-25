use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use crate::utils::{capture, paths, AppError};
use crate::{log_debug, log_info};

/// URL → 缓存子目录的注册表，供按需下载（download_image 空 sub_dir 时）确定图片类型。
/// process_images 在遍历时登记每个 URL 所属的 ImageType。
static URL_SUBDIR_REGISTRY: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();

/// 登记 URL 对应的缓存子目录
pub fn register_url_subdir(url: &str, subdir: &str) {
    if url.is_empty() {
        return;
    }
    let map = URL_SUBDIR_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(mut guard) = map.lock() {
        guard.insert(url.to_string(), subdir.to_string());
    }
}

/// 查询 URL 对应的缓存子目录
pub fn resolve_url_subdir(url: &str) -> Option<String> {
    let map = URL_SUBDIR_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = map.lock() {
        return guard.get(url).cloned();
    }
    None
}

/// 所有图片类型的缓存子目录名（含下载兜底目录 misc）
pub fn all_sub_dir_names() -> &'static [&'static str] {
    &[
        "avatars",
        "skill_icons",
        "weapon_icons",
        "equip_icons",
        "illustrations",
        "attendance",
        "gem_icons",
        "item_icons",
        "achv_icons",
        "misc",
    ]
}

/// 图片缓存类型
#[derive(Debug, Clone, Copy)]
pub enum ImageType {
    Avatar,          // 角色头像
    SkillIcon,       // 技能图标
    WeaponIcon,      // 武器图标
    EquipIcon,       // 装备图标
    Illustration,    // 角色立绘
    AttendanceIcon,  // 签到奖励图标
    GemIcon,         // 基质图标
    ItemIcon,        // 物品/材料图标
    AchievementIcon, // 蚀刻章图标
}

impl ImageType {
    /// 获取缓存子目录名称
    pub fn dir_name(&self) -> &str {
        match self {
            ImageType::Avatar => "avatars",
            ImageType::SkillIcon => "skill_icons",
            ImageType::WeaponIcon => "weapon_icons",
            ImageType::EquipIcon => "equip_icons",
            ImageType::Illustration => "illustrations",
            ImageType::AttendanceIcon => "attendance",
            ImageType::GemIcon => "gem_icons",
            ImageType::ItemIcon => "item_icons",
            ImageType::AchievementIcon => "achv_icons",
        }
    }
}

/// 图片缓存服务
pub struct ImageCacheService {
    cache_dir: PathBuf,
}

impl ImageCacheService {
    pub fn new() -> Result<Self, AppError> {
        let cache_dir = paths::image_cache_dir().map_err(|e| AppError::ConfigError {
            message: e.to_string(),
        })?;

        // 确保主目录存在
        fs::create_dir_all(&cache_dir)?;

        // 创建所有子目录
        for image_type in [
            ImageType::Avatar,
            ImageType::SkillIcon,
            ImageType::WeaponIcon,
            ImageType::EquipIcon,
            ImageType::Illustration,
            ImageType::AttendanceIcon,
            ImageType::GemIcon,
            ImageType::ItemIcon,
            ImageType::AchievementIcon,
        ] {
            let type_dir = cache_dir.join(image_type.dir_name());
            fs::create_dir_all(&type_dir)?;
        }

        Ok(Self { cache_dir })
    }

    pub fn cache_dir(&self) -> &PathBuf {
        &self.cache_dir
    }

    /// 从 URL 中提取文件名
    fn extract_filename_from_url(&self, url: &str) -> Option<String> {
        url.split('/').last().and_then(|s| {
            if s.is_empty() {
                None
            } else {
                Some(s.to_string())
            }
        })
    }

    /// 仅当图片已缓存在本地时返回其路径，不触发下载。
    /// 扫描所有已知子目录，命中任一即返回。
    pub fn local_path_if_cached(&self, url: &str) -> Option<String> {
        if url.starts_with("file://") || url.starts_with("http://asset.localhost") {
            return Some(url.to_string());
        }
        let filename = self.extract_filename_from_url(url)?;
        for sub_dir in all_sub_dir_names() {
            let file_path = self.cache_dir.join(sub_dir).join(&filename);
            if file_path.exists() {
                return Some(file_path.to_string_lossy().to_string());
            }
        }
        None
    }

    /// 获取或下载图片，返回本地文件路径
    pub async fn get_or_download_image(
        &self,
        url: &str,
        image_type: ImageType,
    ) -> Result<String, AppError> {
        if url.starts_with("file://") || url.starts_with("http://asset.localhost") {
            return Ok(url.to_string());
        }

        let filename =
            self.extract_filename_from_url(url)
                .ok_or_else(|| AppError::ConfigError {
                    message: "Invalid image URL".to_string(),
                })?;

        let type_dir = self.cache_dir.join(image_type.dir_name());
        let file_path = type_dir.join(&filename);

        // 已缓存 → 返回路径
        if file_path.exists() {
            return Ok(file_path.to_string_lossy().to_string());
        }

        // 下载图片
        let client = crate::utils::http_client::create_client();

        let start_time = std::time::Instant::now();
        log_info!("=== HTTP REQUEST: 下载图片 ({:?}) ===", image_type);
        log_info!("Method: GET");
        log_info!("URL: {}", url);

        let response = capture::send(
            &client,
            client
                .get(url)
                .header("Referer", "https://game.skland.com/"),
        )
        .await?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let bytes = response.bytes().await?;

        log_info!("=== HTTP RESPONSE: 下载图片 ({:?}) ===", image_type);
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }
        log_debug!("Response Body: <binary data, {} bytes>", bytes.len());

        // 保存到本地
        fs::write(&file_path, &bytes)?;

        Ok(file_path.to_string_lossy().to_string())
    }

    /// 获取或下载头像，返回本地路径
    pub async fn get_or_download_avatar(&self, url: &str) -> Result<String, AppError> {
        self.get_or_download_image(url, ImageType::Avatar).await
    }
}

// 为了向后兼容，保留旧的类型别名
pub type AvatarCacheService = ImageCacheService;

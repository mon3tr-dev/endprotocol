use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::models::char_detail::CharDetailData;
use crate::services::avatar_cache_service::{
    register_url_subdir, ImageCacheService, ImageType,
};
use crate::services::skland_service::SklandService;
use crate::utils::{capture, AppError};
use crate::{log_debug, log_error, log_info, log_warn};

/// 懒加载本地化：登记 URL 对应的缓存类型；若图片已缓存在本地则替换为本地路径，
/// 否则保留远程 URL（由前端按需下载）。
fn localize_or_keep(url: &mut String, image_cache: &ImageCacheService, image_type: ImageType) {
    if url.is_empty() || url.starts_with("http://asset.localhost") {
        return;
    }
    register_url_subdir(url, image_type.dir_name());
    if let Some(p) = image_cache.local_path_if_cached(url) {
        *url = p;
    }
}

/// 用于预加载的角色信息
pub struct PreloadRoleInfo {
    pub role_id: String,
    pub server_id: String,
    pub user_id: String,
    pub cred: String,
    pub token: String,
}

pub struct CharDetailService {
    skland_service: Arc<SklandService>,
    cache: Arc<Mutex<HashMap<String, CharDetailData>>>,
    processed_cache: Arc<Mutex<HashMap<String, serde_json::Value>>>,
}

impl CharDetailService {
    pub fn new(skland_service: Arc<SklandService>) -> Self {
        Self {
            skland_service,
            cache: Arc::new(Mutex::new(HashMap::new())),
            processed_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 获取角色详情（带缓存）
    pub async fn get_with_cache(
        &self,
        role_id: &str,
        cred: &str,
        token: &str,
        server_id: &str,
        user_id: &str,
    ) -> Result<Option<CharDetailData>, AppError> {
        {
            let cache = self.cache.lock().unwrap();
            if let Some(detail) = cache.get(role_id) {
                log_debug!("Cache hit for role detail: {}", role_id);
                return Ok(Some(detail.clone()));
            }
        }

        log_info!("Loading char detail from API: {}", role_id);

        match self
            .skland_service
            .get_role_detail(cred, token, role_id, server_id, user_id)
            .await
        {
            Ok(response) => {
                let detail = response.data.detail;
                let mut cache = self.cache.lock().unwrap();
                cache.insert(role_id.to_string(), detail.clone());
                log_info!("Cached char detail for role: {}", role_id);
                Ok(Some(detail))
            }
            Err(e) => {
                log_error!("Failed to fetch char detail: {}", e);
                Err(e)
            }
        }
    }

    /// 预加载所有角色详情
    pub async fn preload_all(&self, role_infos: &[PreloadRoleInfo]) -> Result<(), AppError> {
        log_info!("Preloading all character details...");

        for info in role_infos {
            {
                let cache = self.cache.lock().unwrap();
                if cache.contains_key(&info.role_id) {
                    continue;
                }
            }

            match self
                .skland_service
                .get_role_detail(
                    &info.cred,
                    &info.token,
                    &info.role_id,
                    &info.server_id,
                    &info.user_id,
                )
                .await
            {
                Ok(response) => {
                    let detail = response.data.detail;
                    let mut cache = self.cache.lock().unwrap();
                    cache.insert(info.role_id.clone(), detail);
                    log_debug!("Preloaded char detail for: {}", info.role_id);
                }
                Err(e) => {
                    log_warn!("Failed to preload char detail for {}: {}", info.role_id, e);
                }
            }
        }

        log_info!(
            "Preload completed, cached {} roles",
            self.cache.lock().unwrap().len()
        );
        Ok(())
    }

    /// 保留指定角色的详情缓存，清除其他所有
    pub fn retain_only(&self, role_id: Option<String>) {
        let mut cache = self.cache.lock().unwrap();
        let mut processed = self.processed_cache.lock().unwrap();
        if let Some(ref id) = role_id {
            let retained = cache.remove(id);
            cache.clear();
            if let Some(detail) = retained {
                cache.insert(id.clone(), detail);
            }
            let retained_proc = processed.remove(id);
            processed.clear();
            if let Some(v) = retained_proc {
                processed.insert(id.clone(), v);
            }
        } else {
            cache.clear();
            processed.clear();
        }
        log_info!(
            "Cleared char detail cache (lazy load enabled), remaining: {}",
            cache.len()
        );
    }

    /// 移除指定角色的缓存
    pub fn remove(&self, role_id: &str) {
        {
            let mut cache = self.cache.lock().unwrap();
            cache.remove(role_id);
        }
        {
            let mut processed = self.processed_cache.lock().unwrap();
            processed.remove(role_id);
        }
        log_debug!("Released char detail cache for role: {}", role_id);
    }

    /// 获取处理后的角色详情（包含图片本地缓存替换）
    ///
    /// 处理后的结果会被缓存到 processed_cache，后续调用跳过图片处理和序列化。
    pub async fn get_processed(
        &self,
        role_id: &str,
        cred: &str,
        token: &str,
        server_id: &str,
        user_id: &str,
    ) -> Result<serde_json::Value, AppError> {
        log_debug!("get_char_detail_processed: role_id={}", role_id);

        {
            let processed = self.processed_cache.lock().unwrap();
            if let Some(cached) = processed.get(role_id) {
                log_debug!("Processed cache hit for role: {}", role_id);
                return Ok(cached.clone());
            }
        }

        let detail = match self
            .get_with_cache(role_id, cred, token, server_id, user_id)
            .await?
        {
            Some(d) => d,
            None => {
                log_warn!("No detail found for role_id={}", role_id);
                return Err(AppError::ConfigError {
                    message: format!("Character detail not found for role_id: {}", role_id),
                });
            }
        };

        let mut detail = detail.clone();
        self.process_images(&mut detail, cred, token).await?;

        let json_value = serde_json::to_value(&detail).map_err(|e| {
            log_error!("Failed to serialize: {}", e);
            AppError::ConfigError {
                message: format!("Failed to serialize character detail: {}", e),
            }
        })?;

        let mut processed = self.processed_cache.lock().unwrap();
        processed.insert(role_id.to_string(), json_value.clone());

        Ok(json_value)
    }

    /// 处理角色详情中的所有图片URL：
    /// 已缓存的替换为本地路径，未缓存的保留远程URL由前端按需下载（懒加载）。
    async fn process_images(
        &self,
        detail: &mut CharDetailData,
        cred: &str,
        token: &str,
    ) -> Result<(), AppError> {
        log_debug!("Processing images for {} chars", detail.chars.len());

        let image_cache = ImageCacheService::new().map_err(|e| {
            log_error!("Failed to create image cache: {}", e);
            AppError::ConfigError {
                message: format!("Failed to create image cache: {}", e),
            }
        })?;

        for char in detail.chars.iter_mut() {
            if let Some(char_data) = &mut char.char_data {
                let char_name = char_data.name.as_deref().unwrap_or("unknown");

                if let Some(ref mut url) = char_data.avatar_sq_url {
                    localize_or_keep(url, &image_cache, ImageType::Avatar);
                }
                if let Some(ref mut url) = char_data.avatar_rt_url {
                    localize_or_keep(url, &image_cache, ImageType::Avatar);
                }
                if let Some(ref mut url) = char_data.illustration_url {
                    localize_or_keep(url, &image_cache, ImageType::Illustration);
                }

                if let Some(ref mut skills) = char_data.skills {
                    for skill in skills.iter_mut() {
                        localize_or_keep(&mut skill.icon_url, &image_cache, ImageType::SkillIcon);
                        for form in skill.forms.iter_mut() {
                            localize_or_keep(
                                &mut form.icon_url,
                                &image_cache,
                                ImageType::SkillIcon,
                            );
                        }
                    }
                }

                for talents in [
                    &mut char_data.ability_talents,
                    &mut char_data.combat_talents,
                ] {
                    if let Some(ref mut list) = talents {
                        for t in list.iter_mut() {
                            localize_or_keep(&mut t.icon_url, &image_cache, ImageType::SkillIcon);
                            localize_or_keep(
                                &mut t.locked_icon_url,
                                &image_cache,
                                ImageType::SkillIcon,
                            );
                        }
                    }
                }

                if let Some(ref mut list) = char_data.cultivation_talents {
                    for t in list.iter_mut() {
                        localize_or_keep(&mut t.icon_url, &image_cache, ImageType::SkillIcon);
                        localize_or_keep(
                            &mut t.locked_icon_url,
                            &image_cache,
                            ImageType::SkillIcon,
                        );
                    }
                }

                // Process equipment icon URLs
                Self::cache_equip_icon(
                    &image_cache,
                    &mut char.weapon,
                    "weaponData",
                    char_name,
                    ImageType::WeaponIcon,
                )
                .await;
                Self::cache_equip_icon(
                    &image_cache,
                    &mut char.body_equip,
                    "equipData",
                    char_name,
                    ImageType::EquipIcon,
                )
                .await;
                Self::cache_equip_icon(
                    &image_cache,
                    &mut char.arm_equip,
                    "equipData",
                    char_name,
                    ImageType::EquipIcon,
                )
                .await;
                Self::cache_equip_icon(
                    &image_cache,
                    &mut char.first_accessory,
                    "equipData",
                    char_name,
                    ImageType::EquipIcon,
                )
                .await;
                Self::cache_equip_icon(
                    &image_cache,
                    &mut char.second_accessory,
                    "equipData",
                    char_name,
                    ImageType::EquipIcon,
                )
                .await;
                Self::cache_equip_icon(
                    &image_cache,
                    &mut char.tactical_item,
                    "tacticalItemData",
                    char_name,
                    ImageType::EquipIcon,
                )
                .await;
                // Cache gem icon from weapon (保持现有目录解析机制)
                Self::cache_gem_icon(
                    &image_cache,
                    &self.skland_service,
                    &mut char.weapon,
                    char_name,
                    cred,
                    token,
                )
                .await;
            }
        }

        // Cache achievement medal icons
        Self::cache_achieve_icons(&image_cache, &mut detail.achieve).await;

        // Cache domain settlement officer avatars
        Self::cache_domain_avatars(&image_cache, &mut detail.domain).await;

        log_debug!("Completed image processing");
        Ok(())
    }

    /// Process icon URL for an equipment item (nested inside weaponData/equipData/tacticalItemData)
    async fn cache_equip_icon(
        image_cache: &ImageCacheService,
        equip: &mut Option<serde_json::Value>,
        data_key: &str,
        char_name: &str,
        image_type: ImageType,
    ) {
        let _ = char_name;
        if let Some(ref mut value) = equip {
            if let Some(obj) = value.as_object_mut() {
                if let Some(data) = obj.get_mut(data_key) {
                    if let Some(data_obj) = data.as_object_mut() {
                        if let Some(serde_json::Value::String(url)) = data_obj.get("iconUrl") {
                            let mut url_mut = url.clone();
                            localize_or_keep(&mut url_mut, image_cache, image_type);
                            data_obj
                                .insert("iconUrl".to_string(), serde_json::Value::String(url_mut));
                        }
                    }
                }
            }
        }
    }

    /// Cache gem icon from weapon.
    /// Uses the wiki catalog to find the correct cover and saves it
    /// with the original URL's filename so subsequent runs hit local cache.
    async fn cache_gem_icon(
        image_cache: &ImageCacheService,
        skland_service: &SklandService,
        weapon: &mut Option<serde_json::Value>,
        char_name: &str,
        cred: &str,
        token: &str,
    ) {
        let (original_url, gem_name, gem_rarity) = {
            let value = match weapon {
                Some(ref v) => v,
                None => {
                    log_warn!("  weapon is None");
                    return;
                }
            };
            let obj = match value.as_object() {
                Some(o) => o,
                None => {
                    log_warn!("  weapon is not an object: {:?}", value);
                    return;
                }
            };
            let gem = match obj.get("gem") {
                Some(g) => g,
                None => {
                    log_warn!(
                        "  no gem field in weapon object, keys: {:?}",
                        obj.keys().collect::<Vec<_>>()
                    );
                    return;
                }
            };
            let gem_obj = match gem.as_object() {
                Some(o) => o,
                None => {
                    log_warn!("  gem is not an object: {:?}", gem);
                    return;
                }
            };
            let gem_data = match gem_obj.get("gemData") {
                Some(d) => d,
                None => {
                    log_warn!(
                        "  no gemData in gem, keys: {:?}",
                        gem_obj.keys().collect::<Vec<_>>()
                    );
                    return;
                }
            };
            let gem_data_obj = match gem_data.as_object() {
                Some(o) => o,
                None => {
                    log_warn!("  gemData is not an object: {:?}", gem_data);
                    return;
                }
            };
            let url = match gem_data_obj.get("icon") {
                Some(serde_json::Value::String(u)) => u.clone(),
                _ => {
                    log_warn!(
                        "  no icon string in gemData, keys: {:?}",
                        gem_data_obj.keys().collect::<Vec<_>>()
                    );
                    return;
                }
            };
            if url.is_empty() || url.starts_with("http://asset.localhost") {
                log_warn!("  icon is empty or asset.localhost: {}", url);
                return;
            }
            let name = gem_data_obj
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let template_id = gem_data_obj
                .get("templateId")
                .and_then(|t| t.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let rarity = template_id.replace("item_gem_rarity_", "");
            (url, name, rarity)
        };

        let filename = original_url
            .split('/')
            .last()
            .or_else(|| original_url.split('\\').last())
            .unwrap_or("")
            .to_string();

        // 1) Check if the file already exists in cache (named by original URL filename)
        if !filename.is_empty() {
            let cached_path = image_cache.cache_dir().join("gem_icons").join(&filename);
            if cached_path.exists() {
                update_gem_icon_path(weapon, cached_path.to_string_lossy().to_string());
                return;
            }
        }

        // 2) No cache hit — fetch wiki catalog to find the correct gem icon
        if gem_name.is_empty() || gem_rarity.is_empty() {
            log_warn!(
                "Gem name or rarity missing for {}, cannot resolve via catalog",
                char_name
            );
            return;
        }

        let path = "/web/v1/wiki/item/catalog";
        let query = "typeMainId=1&typeSubId=7".to_string();

        let catalog = match skland_service
            .call_skland_api("GET", path, Some(&query), None, cred, token, vec![])
            .await
        {
            Ok(j) => j,
            Err(e) => {
                log_warn!("Failed to fetch gem catalog for {}: {}", char_name, e);
                return;
            }
        };

        // Navigate: response.data.catalog[0].typeSub[?].items
        let items: &Vec<serde_json::Value> = {
            let catalog_array = match catalog
                .get("data")
                .and_then(|d| d.get("catalog"))
                .and_then(|c| c.as_array())
            {
                Some(arr) => arr,
                None => {
                    log_warn!(
                        "No data.catalog array in gem catalog response for {}",
                        char_name
                    );
                    return;
                }
            };
            let first_entry = match catalog_array
                .first()
                .and_then(|e| e.get("typeSub"))
                .and_then(|ts| ts.as_array())
            {
                Some(arr) => arr,
                None => {
                    log_warn!(
                        "No catalog[0].typeSub array in gem catalog response for {}",
                        char_name
                    );
                    return;
                }
            };
            let items_arr = match first_entry
                .first()
                .and_then(|s| s.get("items"))
                .and_then(|i| i.as_array())
            {
                Some(arr) => arr,
                None => {
                    log_warn!(
                        "No typeSub[0].items array in gem catalog response for {}",
                        char_name
                    );
                    return;
                }
            };
            items_arr
        };

        let tag_suffix = format!("000{}", gem_rarity);
        let gem_chars: Vec<char> = gem_name.chars().collect();

        let matched = items.iter().find(|item| {
            let raw_name = match item.get("name").and_then(|n| n.as_str()) {
                Some(n) => n.trim(),
                None => return false,
            };
            let item_chars: Vec<char> = raw_name.chars().collect();
            if gem_chars.len() < 4 || item_chars.len() < 4 {
                return false;
            }
            let prefix_match = gem_chars[0..2] == item_chars[0..2];
            let suffix_match =
                gem_chars[gem_chars.len() - 2..] == item_chars[item_chars.len() - 2..];
            if !prefix_match || !suffix_match {
                return false;
            }
            let tag_match = if let Some(tags) = item.get("tagIds").and_then(|t| t.as_array()) {
                tags.iter().any(|t| {
                    t.as_str()
                        .map(|v| v.ends_with(&tag_suffix))
                        .unwrap_or(false)
                })
            } else {
                false
            };
            tag_match
        });

        let cover_url = match matched {
            Some(item) => item
                .get("brief")
                .and_then(|b| b.get("cover"))
                .and_then(|c| c.as_str())
                .map(|s| s.to_string()),
            None => {
                log_warn!(
                    "No matching gem found in catalog for {} (name={}, rarity={})",
                    char_name,
                    gem_name,
                    gem_rarity
                );
                return;
            }
        };

        let cover_url = match cover_url {
            Some(u) => u,
            None => {
                log_warn!("Matched gem has no cover for {}", char_name);
                return;
            }
        };

        // 3) Download the matched cover and save with the original filename
        if !filename.is_empty() {
            let client = reqwest::Client::new();
            let resp = match capture::send(
                &client,
                client
                    .get(&cover_url)
                    .header("Referer", "https://game.skland.com/"),
            )
            .await
            {
                Ok(r) => r,
                Err(e) => {
                    log_warn!("Failed to download gem cover for {}: {}", char_name, e);
                    return;
                }
            };
            let bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    log_warn!(
                        "Failed to read bytes from gem cover for {}: {}",
                        char_name,
                        e
                    );
                    return;
                }
            };
            let save_path = image_cache.cache_dir().join("gem_icons").join(&filename);
            if let Some(parent) = save_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            match std::fs::write(&save_path, &bytes) {
                Ok(_) => {
                    log_info!("Cached gem icon for {} at {:?}", char_name, save_path);
                    update_gem_icon_path(weapon, save_path.to_string_lossy().to_string());
                }
                Err(e) => {
                    log_warn!("Failed to write gem icon for {}: {}", char_name, e);
                }
            }
        } else {
            match image_cache
                .get_or_download_image(&cover_url, ImageType::GemIcon)
                .await
            {
                Ok(p) => update_gem_icon_path(weapon, p),
                Err(e) => {
                    log_warn!("Failed to cache gem cover for {}: {}", char_name, e);
                }
            }
        }
    }

    /// Cache domain settlement officer avatars (officerCharAvatar) - 懒加载
    async fn cache_domain_avatars(
        image_cache: &ImageCacheService,
        domain: &mut Option<serde_json::Value>,
    ) {
        let domains = match domain {
            Some(serde_json::Value::Array(arr)) => arr,
            _ => return,
        };

        for domain_item in domains.iter_mut() {
            let domain_obj = match domain_item.as_object_mut() {
                Some(obj) => obj,
                None => continue,
            };
            let settlements = match domain_obj.get_mut("settlements") {
                Some(serde_json::Value::Array(arr)) => arr,
                _ => continue,
            };

            for settlement in settlements.iter_mut() {
                let settlement_obj = match settlement.as_object_mut() {
                    Some(obj) => obj,
                    None => continue,
                };
                if let Some(serde_json::Value::String(url)) =
                    settlement_obj.get("officerCharAvatar")
                {
                    let mut url_mut = url.clone();
                    localize_or_keep(&mut url_mut, image_cache, ImageType::Avatar);
                    settlement_obj.insert(
                        "officerCharAvatar".to_string(),
                        serde_json::Value::String(url_mut),
                    );
                }
            }
        }
    }

    /// Cache achievement medal icons (initIcon, reforge2Icon, reforge3Icon, platedIcon) - 懒加载
    async fn cache_achieve_icons(
        image_cache: &ImageCacheService,
        achieve: &mut Option<serde_json::Value>,
    ) {
        let achieve_obj = match achieve {
            Some(ref mut v) => v.as_object_mut(),
            None => return,
        };
        let achieve_obj = match achieve_obj {
            Some(obj) => obj,
            None => return,
        };
        let medals = match achieve_obj.get_mut("achieveMedals") {
            Some(serde_json::Value::Array(arr)) => arr,
            _ => return,
        };

        let icon_fields = ["initIcon", "reforge2Icon", "reforge3Icon", "platedIcon"];

        for medal in medals.iter_mut() {
            let achievement_data = match medal.get_mut("achievementData") {
                Some(d) => d,
                None => continue,
            };
            let data_obj = match achievement_data.as_object_mut() {
                Some(obj) => obj,
                None => continue,
            };

            for field in &icon_fields {
                if let Some(serde_json::Value::String(url)) = data_obj.get(*field) {
                    let mut url_mut = url.clone();
                    localize_or_keep(&mut url_mut, image_cache, ImageType::AchievementIcon);
                    data_obj.insert((*field).to_string(), serde_json::Value::String(url_mut));
                }
            }
        }
    }
}

/// Helper: update the weapon.gem.gemData.icon field
fn update_gem_icon_path(weapon: &mut Option<serde_json::Value>, path: String) {
    if let Some(ref mut value) = weapon {
        if let Some(obj) = value.as_object_mut() {
            if let Some(gem) = obj.get_mut("gem") {
                if let Some(gem_obj) = gem.as_object_mut() {
                    if let Some(gem_data) = gem_obj.get_mut("gemData") {
                        if let Some(gem_data_obj) = gem_data.as_object_mut() {
                            gem_data_obj
                                .insert("icon".to_string(), serde_json::Value::String(path));
                        }
                    }
                }
            }
        }
    }
}

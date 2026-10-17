use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::services::skland_service::SklandService;
use crate::utils::{paths, AppError};
use crate::{log_info, log_warn};

/// Wiki 物品详情缓存，按需拉取并缓存单个 item 的详情。
pub struct CharWikiDetailService {
    skland_service: Arc<SklandService>,
    cache: Arc<Mutex<HashMap<String, serde_json::Value>>>,
    merged: Arc<Mutex<serde_json::Value>>,
    cache_dir: PathBuf,
}

impl CharWikiDetailService {
    pub fn new(skland_service: Arc<SklandService>) -> Self {
        let cache_dir =
            paths::wiki_detail_cache_dir().unwrap_or_else(|_| PathBuf::from("wiki_detail_cache"));
        log_info!("[wiki_detail_cache] Cache dir: {}", cache_dir.display());
        Self {
            skland_service,
            cache: Arc::new(Mutex::new(HashMap::new())),
            merged: Arc::new(Mutex::new(
                serde_json::Value::Object(serde_json::Map::new()),
            )),
            cache_dir,
        }
    }

    fn disk_cache_path(&self, item_id: &str) -> PathBuf {
        self.cache_dir.join(format!("{}.json", item_id))
    }

    fn save_to_disk(&self, item_id: &str, data: &serde_json::Value) {
        let cache_dir_str = self.cache_dir.display();
        if let Err(e) = fs::create_dir_all(&self.cache_dir) {
            log_warn!(
                "[wiki_detail_cache] Failed to create dir '{}': {}",
                cache_dir_str,
                e
            );
            return;
        }
        let path = self.disk_cache_path(item_id);
        match serde_json::to_string(data) {
            Ok(json) => match fs::write(&path, &json) {
                Ok(_) => log_info!(
                    "[wiki_detail_cache] Saved {} -> {}",
                    item_id,
                    path.display()
                ),
                Err(e) => log_warn!("[wiki_detail_cache] Failed to write {}: {}", item_id, e),
            },
            Err(e) => log_warn!("[wiki_detail_cache] Failed to serialize {}: {}", item_id, e),
        }
    }

    fn load_from_disk(&self, item_id: &str) -> Option<serde_json::Value> {
        let path = self.disk_cache_path(item_id);
        if path.exists() {
            let result = fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok());
            if result.is_some() {
                log_info!("[wiki_detail_cache] Hit {} -> {}", item_id, path.display());
            } else {
                log_warn!(
                    "[wiki_detail_cache] Found but failed to parse {}",
                    path.display()
                );
            }
            result
        } else {
            None
        }
    }

    /// 按需获取单个 item 的 wiki 详情。
    /// 如已缓存则直接返回，否则调用 API 获取并同时更新 cache 和 merged。
    async fn fetch_item(
        &self,
        item_id: &str,
        cred: &str,
        token: &str,
    ) -> Result<serde_json::Value, AppError> {
        let path = "/web/v1/wiki/item/info";
        let query = format!("id={}", item_id);
        let json = self
            .skland_service
            .call_skland_api("GET", path, Some(&query), None, cred, token, vec![])
            .await?;

        self.save_to_disk(item_id, &json);

        let mut cache = self.cache.lock().unwrap();
        cache.insert(item_id.to_string(), json.clone());
        drop(cache);

        let mut guard = self.merged.lock().unwrap();
        if let serde_json::Value::Object(ref mut map) = *guard {
            map.insert(item_id.to_string(), json.clone());
        }

        Ok(json)
    }

    /// 获取指定 itemId 的详情。优先使用内存缓存，其次本地磁盘缓存，最后请求 API。
    pub async fn get_item(
        &self,
        item_id: &str,
        cred: &str,
        token: &str,
    ) -> Result<serde_json::Value, AppError> {
        {
            let cache = self.cache.lock().unwrap();
            if let Some(data) = cache.get(item_id) {
                return Ok(data.clone());
            }
        }

        if let Some(data) = self.load_from_disk(item_id) {
            let mut cache = self.cache.lock().unwrap();
            cache.insert(item_id.to_string(), data.clone());
            drop(cache);
            let mut guard = self.merged.lock().unwrap();
            if let serde_json::Value::Object(ref mut map) = *guard {
                map.insert(item_id.to_string(), data.clone());
            }
            return Ok(data);
        }

        self.fetch_item(item_id, cred, token).await
    }
}

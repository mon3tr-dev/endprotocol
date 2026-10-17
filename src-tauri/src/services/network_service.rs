use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::services::char_detail_service::CharDetailService;
use crate::services::char_wiki_detail_service::CharWikiDetailService;
use crate::services::data_query::{self, DataApi};
use crate::services::skland_service::SklandService;
use crate::utils::AppError;
use crate::{log_debug, log_error};

// 重新导出，保持向后兼容
pub use crate::services::char_detail_service::PreloadRoleInfo;

/// 网络数据服务 —— 统一数据查询入口，持有各子服务
pub struct NetworkService {
    skland_service: Arc<SklandService>,
    char_detail_service: CharDetailService,
    char_wiki_detail_service: Arc<CharWikiDetailService>,
    current_role_id: Arc<Mutex<Option<String>>>,
}

impl NetworkService {
    pub fn new(skland_service: Arc<SklandService>) -> Self {
        Self {
            char_detail_service: CharDetailService::new(skland_service.clone()),
            char_wiki_detail_service: Arc::new(CharWikiDetailService::new(skland_service.clone())),
            skland_service,
            current_role_id: Arc::new(Mutex::new(None)),
        }
    }

    pub fn char_detail_service(&self) -> &CharDetailService {
        &self.char_detail_service
    }

    pub fn get_current_role_id(&self) -> Option<String> {
        self.current_role_id.lock().unwrap().clone()
    }

    pub async fn set_current_role_id(&self, role_id: Option<String>, lazy_load_enabled: bool) {
        let mut current = self.current_role_id.lock().unwrap();
        let old_role_id = current.clone();
        *current = role_id.clone();

        if lazy_load_enabled {
            if let (Some(old_id), Some(new_id)) = (old_role_id, role_id) {
                if old_id != new_id {
                    self.char_detail_service.remove(&old_id);
                }
            }
        }
    }

    /// 保留指定角色的详情缓存，清除其他所有
    pub fn retain_only_char_detail(&self, role_id: Option<String>) {
        self.char_detail_service.retain_only(role_id);
    }

    /// 预加载所有角色详情
    pub async fn preload_all_char_details(
        &self,
        role_infos: &[PreloadRoleInfo],
    ) -> Result<(), AppError> {
        self.char_detail_service.preload_all(role_infos).await
    }

    /// 统一数据查询入口
    pub async fn query_role_data(
        &self,
        role_id: &str,
        api_name: &str,
        paths: &[String],
        cred: &str,
        token: &str,
        server_id: &str,
        user_id: &str,
    ) -> Result<HashMap<String, serde_json::Value>, AppError> {
        log_debug!(
            "query_role_data: role_id={}, api_name={}, paths_count={}",
            role_id,
            api_name,
            paths.len()
        );

        let api = api_name.parse::<DataApi>().map_err(|e| {
            log_error!("Invalid API name '{}': {}", api_name, e);
            AppError::ConfigError {
                message: format!("Invalid API name: {}", e),
            }
        })?;

        let data_value = match api {
            DataApi::CharDetail => {
                self.char_detail_service
                    .get_processed(role_id, cred, token, server_id, user_id)
                    .await?
            }
            DataApi::WikiCatalog => {
                // 统一目录（不指定 typeSubId 时返回全部 typeSub，但 items 为空）
                let path = "/web/v1/wiki/item/catalog";
                let query = "typeMainId=1&onlyOnline=true".to_string();
                self.skland_service
                    .call_skland_api("GET", path, Some(&query), None, cred, token, vec![])
                    .await?
            }
            DataApi::WikiCatalogChar => {
                // 干员子目录（指定 typeSubId 时才返回 items）
                let path = "/web/v1/wiki/item/catalog";
                let query = "typeMainId=1&typeSubId=1".to_string();
                self.skland_service
                    .call_skland_api("GET", path, Some(&query), None, cred, token, vec![])
                    .await?
            }
            DataApi::WikiCatalogWeapon => {
                // 武器子目录（指定 typeSubId 时才返回 items）
                let path = "/web/v1/wiki/item/catalog";
                let query = "typeMainId=1&typeSubId=2".to_string();
                self.skland_service
                    .call_skland_api("GET", path, Some(&query), None, cred, token, vec![])
                    .await?
            }
            DataApi::WikiCatalogNoOnline => {
                // 无 onlyOnline 的目录（调试用：验证 onlyOnline 是否导致 items 为空）
                let path = "/web/v1/wiki/item/catalog";
                let query = "typeMainId=1".to_string();
                self.skland_service
                    .call_skland_api("GET", path, Some(&query), None, cred, token, vec![])
                    .await?
            }
            DataApi::CharWikiDetail => {
                let mut result = HashMap::new();
                for item_id in paths {
                    match self
                        .char_wiki_detail_service
                        .get_item(item_id, cred, token)
                        .await
                    {
                        Ok(val) => {
                            result.insert(item_id.clone(), val);
                        }
                        Err(e) => {
                            log_error!("Failed to fetch wiki detail for item {}: {}", item_id, e);
                            result.insert(item_id.clone(), serde_json::Value::Null);
                        }
                    }
                }
                return Ok(result);
            }
        };

        if paths.is_empty() {
            let mut result = HashMap::new();
            result.insert("__full__".to_string(), data_value);
            return Ok(result);
        }

        let mut result = HashMap::new();
        for path in paths {
            let segments = data_query::parse_path(path);
            let value = data_query::get_value_by_path(&data_value, &segments);
            result.insert(path.clone(), value.unwrap_or(serde_json::Value::Null));
        }

        Ok(result)
    }
}

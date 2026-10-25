use serde::de::DeserializeOwned;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::utils::{paths, AppError};

/// 配置存储服务
pub struct ConfigService {
    config_path: PathBuf,
    cache: Mutex<HashMap<String, Value>>,
}

impl ConfigService {
    /// 创建新的配置服务实例
    pub fn new() -> Result<Self, AppError> {
        let app_data_dir = paths::app_data_dir().map_err(|e| AppError::ConfigError {
            message: e.to_string(),
        })?;

        fs::create_dir_all(&app_data_dir)?;

        let config_path = paths::config_file_path().map_err(|e| AppError::ConfigError {
            message: e.to_string(),
        })?;

        // 加载现有配置
        let cache = if config_path.exists() {
            let content = fs::read_to_string(&config_path)?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        };

        Ok(Self {
            config_path,
            cache: Mutex::new(cache),
        })
    }

    /// 获取配置值（泛型）
    pub fn get<T>(&self, key: &str) -> Option<T>
    where
        T: DeserializeOwned,
    {
        let cache = self.cache.lock().ok()?;
        cache
            .get(key)
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }

    /// 设置配置值并持久化
    pub fn set(&mut self, key: String, value: Value) -> Result<(), AppError> {
        {
            let mut cache = self.cache.lock().map_err(|e| AppError::ConfigError {
                message: format!("Lock failed: {}", e),
            })?;
            cache.insert(key, value);
        }
        self.save()?;
        Ok(())
    }

    /// 删除配置项
    pub fn remove(&mut self, key: &str) -> bool {
        let removed = {
            let mut cache = self.cache.lock().unwrap();
            cache.remove(key).is_some()
        };
        if removed {
            let _ = self.save();
        }
        removed
    }

    /// 获取所有配置
    pub fn get_all(&self) -> HashMap<String, Value> {
        let cache = self.cache.lock().unwrap();
        cache.clone()
    }

    /// 获取代理配置
    pub fn get_proxy_config(&self) -> Option<Value> {
        self.get("proxy_config")
    }

    /// 设置代理配置
    pub fn set_proxy_config(&mut self, config: Value) -> Result<(), AppError> {
        {
            let mut cache = self.cache.lock().map_err(|e| AppError::ConfigError {
                message: format!("Lock failed: {}", e),
            })?;
            cache.insert("proxy_config".to_string(), config);
        }
        self.save()?;
        Ok(())
    }

    /// 删除代理配置
    pub fn remove_proxy_config(&mut self) -> bool {
        self.remove("proxy_config")
    }

    /// 保存配置到文件
    fn save(&self) -> Result<(), AppError> {
        let cache = self.cache.lock().map_err(|e| AppError::ConfigError {
            message: format!("Lock failed: {}", e),
        })?;
        let content = serde_json::to_string_pretty(&*cache)?;
        fs::write(&self.config_path, content)?;
        Ok(())
    }
}

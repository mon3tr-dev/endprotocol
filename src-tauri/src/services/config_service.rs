use serde::de::DeserializeOwned;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::services::secret_registry;
use crate::services::secret_store::SecretStore;
use crate::utils::{paths, AppError};

/// 配置文件的 schema 版本。
///
/// - v1：全部明文（历史格式）
/// - v2：机密字段移入 OS 凭据库，`app_config.json` 只保留非机密配置
pub const SCHEMA_VERSION: u32 = 2;

/// 配置存储服务
///
/// # 机密字段处理
///
/// 配置分为两类，由 [`secret_registry`] 判定：
///
/// - **机密（A 类）**：如 `account_token_*` 的 `cred` / `token` / `hytoken` / `u8token` /
///   `device_token` / `phone`，以及 `proxy_config` 的代理凭据。这些字段在**内存中保留
///   明文**（业务代码零侵入），在**磁盘上不落盘** —— 实际存进操作系统凭据库
///   （Windows Credential Manager / macOS Keychain / Linux Secret Service）。
/// - **非机密（B/C 类）**：留在 `app_config.json` 明文。
///
/// 对外的 `get` / `set` / `remove` / `get_all` 签名与行为不变，调用方无需感知。
pub struct ConfigService {
    config_path: PathBuf,
    /// 内存缓存：完整明文视图（含机密字段，供后端内部使用）
    cache: Mutex<HashMap<String, Value>>,
    /// 机密存储后端
    secrets: SecretStore,
}

impl ConfigService {
    /// 创建新的配置服务实例
    ///
    /// 启动流程：
    /// 1. 读 `app_config.json`（不存在则空）
    /// 2. 若为 v1 格式，执行迁移：把机密字段写入凭据库，重建不含机密的配置文件
    /// 3. 从凭据库把机密字段灌回内存缓存
    pub fn new() -> Result<Self, AppError> {
        let app_data_dir = paths::app_data_dir().map_err(|e| AppError::ConfigError {
            message: e.to_string(),
        })?;

        fs::create_dir_all(&app_data_dir)?;

        let config_path = paths::config_file_path().map_err(|e| AppError::ConfigError {
            message: e.to_string(),
        })?;

        let secrets = SecretStore::new().map_err(|e| AppError::ConfigError {
            message: format!("secret store init failed: {e}"),
        })?;

        Self::new_with_paths(config_path, secrets)
    }

    /// 用指定的配置路径与机密存储后端创建服务。
    ///
    /// 供集成测试使用（测试需要指向临时目录而非真实用户数据目录）。
    pub fn new_with_paths(config_path: PathBuf, secrets: SecretStore) -> Result<Self, AppError> {
        if secrets.is_degraded() {
            crate::log_warn!(
                "[config] OS credential store unavailable, using degraded backend: {}",
                secrets.backend().as_str()
            );
        }

        // 加载现有配置
        let raw: HashMap<String, Value> = if config_path.exists() {
            let content = fs::read_to_string(&config_path)?;
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            HashMap::new()
        };

        let mut service = Self {
            config_path,
            cache: Mutex::new(raw),
            secrets,
        };

        service.migrate_if_needed()?;
        service.load_secrets_into_cache();

        Ok(service)
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
    ///
    /// 机密字段会被拆出来写入凭据库，配置文件里只保留非机密部分。
    pub fn set(&mut self, key: String, value: Value) -> Result<(), AppError> {
        self.write_secret_fields(&key, &value)?;

        {
            let mut cache = self.cache.lock().map_err(|e| AppError::ConfigError {
                message: format!("Lock failed: {}", e),
            })?;
            cache.insert(key.clone(), value);
        }
        self.save()?;
        Ok(())
    }

    /// 删除配置项
    pub fn remove(&mut self, key: &str) -> bool {
        // 同时清理凭据库里的机密字段
        if secret_registry::has_secret_fields(key) {
            if let Err(e) = self.secrets.remove_key(key) {
                crate::log_warn!("[config] failed to remove secrets for {key}: {e}");
            }
        }

        let removed = {
            let mut cache = self.cache.lock().unwrap();
            cache.remove(key).is_some()
        };
        if removed {
            let _ = self.save();
        }
        removed
    }

    /// 删除某个配置键下的**单个**机密字段（配置值里的同名子字段由调用方自行移除）。
    ///
    /// 只把子字段从配置值里删掉是不够的：凭据条目仍留在系统凭据库里，而且下次启动
    /// `reload_secrets` 还会把它读回内存缓存。迁移废弃字段时必须同时调这个。
    pub fn remove_secret_field(&mut self, key: &str, field: &str) {
        if let Err(e) = self.secrets.remove(key, field) {
            crate::log_warn!("[config] failed to remove secret {key}.{field}: {e}");
        }
    }

    /// 获取所有配置（**含机密字段明文**）
    ///
    /// ⚠️ 仅供后端内部使用。暴露给前端的请用 [`ConfigService::get_all_public`]。
    pub fn get_all(&self) -> HashMap<String, Value> {
        let cache = self.cache.lock().unwrap();
        cache.clone()
    }

    /// 获取所有**非机密**配置（可安全暴露给前端）
    ///
    /// 机密字段被逐字段剔除 —— 调用方拿到的是一份不含任何凭据的视图。
    /// 注意 `account_token_*` 这类混合键：只有机密子字段被剔除，
    /// `user_info` / `roles` 等非机密子字段保留。
    pub fn get_all_public(&self) -> HashMap<String, Value> {
        let cache = self.cache.lock().unwrap();
        cache
            .iter()
            .map(|(key, value)| (key.clone(), secret_registry::strip_secret_fields(key, value)))
            .collect()
    }

    /// 获取代理配置（机密字段已还原为明文）
    pub fn get_proxy_config(&self) -> Option<Value> {
        self.get("proxy_config")
    }

    /// 设置代理配置
    pub fn set_proxy_config(&mut self, config: Value) -> Result<(), AppError> {
        self.set("proxy_config".to_string(), config)
    }

    /// 删除代理配置
    pub fn remove_proxy_config(&mut self) -> bool {
        self.remove("proxy_config")
    }

    /// 机密存储后端（供 UI 展示当前保护等级）。
    pub fn secret_backend(&self) -> crate::services::secret_store::Backend {
        self.secrets.backend()
    }

    /// 是否处于降级状态（未使用 OS 凭据库）。
    pub fn secrets_degraded(&self) -> bool {
        self.secrets.is_degraded()
    }

    /// 把值里的机密子字段拆出来写入凭据库。
    ///
    /// 非机密子字段原样保留在传入的 Value 里（调用方会写进内存缓存与配置文件）。
    fn write_secret_fields(&self, key: &str, value: &Value) -> Result<(), AppError> {
        if !secret_registry::has_secret_fields(key) {
            return Ok(());
        }

        let Some(obj) = value.as_object() else {
            return Ok(());
        };

        for field in secret_registry::secret_fields_of(key) {
            let Some(field_value) = obj.get(field) else {
                continue;
            };
            // null 值不写入凭据库（视为"该字段不存在"）
            if field_value.is_null() {
                continue;
            }
            let bytes = serde_json::to_vec(field_value).map_err(|e| AppError::ConfigError {
                message: format!("serialize secret field {key}.{field} failed: {e}"),
            })?;
            self.secrets
                .set(key, field, &bytes)
                .map_err(|e| AppError::ConfigError {
                    message: format!("write secret {key}.{field} failed: {e}"),
                })?;
        }
        Ok(())
    }

    /// 从凭据库把机密字段读回内存缓存。
    fn load_secrets_into_cache(&mut self) {
        self.reload_secrets()
    }

    /// 从凭据库把机密字段读回内存缓存（公开供集成测试调用）。
    ///
    /// 凭据库条目缺失（首次运行 / 用户清理过凭据 / 换了机器）时保持字段缺失，
    /// 不写入空值 —— 业务层会据此提示重新登录。
    pub fn reload_secrets(&mut self) {
        let keys: Vec<String> = {
            let cache = self.cache.lock().unwrap();
            cache
                .keys()
                .filter(|k| secret_registry::has_secret_fields(k))
                .cloned()
                .collect()
        };

        for key in keys {
            for field in secret_registry::secret_fields_of(&key) {
                let Ok(bytes) = self.secrets.get(&key, field) else {
                    continue;
                };
                let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                    crate::log_warn!("[config] failed to parse secret {key}.{field}");
                    continue;
                };
                let mut cache = self.cache.lock().unwrap();
                if let Some(obj) = cache.get_mut(&key).and_then(|v| v.as_object_mut()) {
                    obj.insert(field.to_string(), value);
                }
            }
        }
    }

    fn migrate_if_needed(&mut self) -> Result<(), AppError> {
        self.migrate_to_v2()
    }

    /// v1 → v2 迁移：把明文机密字段移入凭据库。
    ///
    /// 流程（崩溃安全）：
    /// 1. 备份当前配置到 `app_config.json.bak`
    /// 2. 把所有机密字段写入凭据库（幂等：同名条目覆盖写）
    /// 3. 原子重建配置文件（只含非机密字段 + schema_version）
    /// 4. 删除备份
    ///
    /// 任一步崩溃，下次启动会重跑迁移（凭据库写入幂等）。
    pub fn migrate_to_v2(&mut self) -> Result<(), AppError> {
        let version = {
            let cache = self.cache.lock().unwrap();
            cache
                .get("schema_version")
                .and_then(|v| v.as_u64())
                .unwrap_or(1) as u32
        };

        if version >= SCHEMA_VERSION {
            return Ok(());
        }

        crate::log_info!("[config] migrating config schema v{version} -> v{SCHEMA_VERSION}");

        // 1. 备份
        let backup_path = self.config_path.with_extension("json.bak");
        if self.config_path.exists() {
            fs::copy(&self.config_path, &backup_path).map_err(|e| AppError::ConfigError {
                message: format!("backup config failed: {e}"),
            })?;
        }

        // 2. 机密字段写入凭据库
        let secret_keys: Vec<(String, Vec<(String, Value)>)> = {
            type SecretKeyEntry = (String, Vec<(String, Value)>);
            let cache = self.cache.lock().unwrap();
            cache
                .iter()
                .filter(|(k, _)| secret_registry::has_secret_fields(k))
                .map(|(k, v)| {
                    let fields: Vec<(String, Value)> = secret_registry::secret_fields_of(k.as_str())
                        .into_iter()
                        .filter_map(|f| {
                            v.get(f).filter(|val| !val.is_null()).map(|val| (f.to_string(), val.clone()))
                        })
                        .collect();
                    (k.clone(), fields)
                })
                .filter(|(_, fields)| !fields.is_empty())
                .collect::<Vec<SecretKeyEntry>>()
        };

        for (key, fields) in &secret_keys {
            for (field, value) in fields {
                let bytes = serde_json::to_vec(value).map_err(|e| AppError::ConfigError {
                    message: format!("serialize secret {key}.{field} failed: {e}"),
                })?;
                if let Err(e) = self.secrets.set(key, field, &bytes) {
                    // 凭据库不可用时不能让迁移半途失败 —— 保留明文配置并明确告警
                    crate::log_error!("[config] failed to write secret {key}.{field}: {e}");
                    crate::log_error!(
                        "[config] migration aborted, keeping plaintext config (degraded mode)"
                    );
                    return Ok(());
                }
            }
        }

        // 3. 原子重建配置文件（剥离机密字段）
        self.save()?;

        // 4. 删除备份（迁移成功后明文副本不再需要）
        if backup_path.exists() {
            if let Err(e) = fs::remove_file(&backup_path) {
                crate::log_warn!("[config] failed to remove backup {backup_path:?}: {e}");
            }
        }

        crate::log_info!("[config] migration completed");
        Ok(())
    }

    /// 保存配置到文件
    ///
    /// 只写非机密字段；机密字段已存进凭据库。写入采用「临时文件 + rename」保证原子性。
    fn save(&self) -> Result<(), AppError> {
        let content = {
            let cache = self.cache.lock().map_err(|e| AppError::ConfigError {
                message: format!("Lock failed: {}", e),
            })?;

            // 逐键剥离机密子字段
            let mut plain: HashMap<String, Value> = cache
                .iter()
                .map(|(k, v)| (k.clone(), secret_registry::strip_secret_fields(k, v)))
                .collect();

            // schema 版本标记
            plain.insert(
                "schema_version".to_string(),
                Value::from(SCHEMA_VERSION),
            );

            serde_json::to_string_pretty(&plain)?
        };

        // 原子写：先写 .tmp 再 rename，避免写一半崩溃导致配置全丢
        let tmp_path = self.config_path.with_extension("json.tmp");
        fs::write(&tmp_path, content)?;
        fs::rename(&tmp_path, &self.config_path)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 构造一个不依赖真实用户目录的 ConfigService（测试用）。
    ///
    /// 用**内存后端** —— OS 凭据库是机器全局的，单元测试写进去的条目会留在
    /// 用户真实凭据库里造成污染。端到端验证真实凭据库请用
    /// `src-tauri/tests/secret_storage.rs`。
    fn test_service(dir: &std::path::Path, tag: &str) -> ConfigService {
        let config_path = dir.join("app_config.json");
        let _ = tag;
        ConfigService {
            config_path,
            cache: Mutex::new(HashMap::new()),
            secrets: SecretStore::in_memory(),
        }
    }

    #[test]
    fn secret_fields_are_written_to_store_not_disk() {
        let dir = std::env::temp_dir().join(format!("ep_cfg_test_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);

        // 唯一键名：凭据条目是全局的，测试并行时不能共用
        let key = format!("account_token_t{}", std::process::id());

        let mut svc = test_service(&dir, "basic");
        svc.set(
            key.clone(),
            json!({
                "cred": "SECRET_CRED_VALUE",
                "token": "SECRET_TOKEN_VALUE",
                "hytoken": "SECRET_HYTOKEN",
                "u8token": "SECRET_U8TOKEN",
                "device_token": "SECRET_DEVICE",
                "phone": "13800000000",
                "roles": [{"roleId": "r1"}],
                "user_info": {"nickname": "n"},
            }),
        )
        .expect("set");

        // 1. 磁盘文件里不应出现任何机密值
        let raw = fs::read_to_string(dir.join("app_config.json")).expect("read");
        for secret in [
            "SECRET_CRED_VALUE",
            "SECRET_TOKEN_VALUE",
            "SECRET_HYTOKEN",
            "SECRET_U8TOKEN",
            "SECRET_DEVICE",
            "13800000000",
        ] {
            assert!(!raw.contains(secret), "disk leaked {secret}");
        }

        // 2. 非机密字段仍在磁盘上
        assert!(raw.contains("r1"));
        assert!(raw.contains("\"nickname\""));

        // 3. 内存里仍是完整明文（业务代码零侵入）
        let cached = svc.get::<Value>(&key).expect("get");
        assert_eq!(cached["cred"], json!("SECRET_CRED_VALUE"));
        assert_eq!(cached["u8token"], json!("SECRET_U8TOKEN"));

        // 4. 凭据库里能读回
        let stored = svc.secrets.get(&key, "u8token").expect("store read");
        let value: Value = serde_json::from_slice(&stored).expect("parse");
        assert_eq!(value, json!("SECRET_U8TOKEN"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn public_view_excludes_secret_fields() {
        let dir = std::env::temp_dir().join(format!("ep_cfg_pub_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);

        let key = format!("account_token_p{}", std::process::id());

        let mut svc = test_service(&dir, "pub");
        svc.set(
            key.clone(),
            json!({"cred": "SECRET_CRED", "roles": [{"roleId": "r1"}]}),
        )
        .expect("set");

        let public = svc.get_all_public();
        let entry = public.get(&key).expect("entry");
        assert!(entry.get("cred").is_none(), "cred leaked in public view");
        assert!(entry.get("roles").is_some(), "roles should stay in public view");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn remove_clears_secret_store() {
        let dir = std::env::temp_dir().join(format!("ep_cfg_rm_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);

        // 用唯一键名，避免与其它测试并行时共用同一条凭据条目
        let key = format!("account_token_rm_{}", std::process::id());

        let mut svc = test_service(&dir, "rm");
        svc.set(key.clone(), json!({"cred": "SECRET_CRED"}))
            .expect("set");
        assert!(svc.secrets.get(&key, "cred").is_ok());

        assert!(svc.remove(&key));
        assert!(svc.secrets.get(&key, "cred").is_err());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn schema_version_is_persisted() {
        let dir = std::env::temp_dir().join(format!("ep_cfg_ver_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);

        let mut svc = test_service(&dir, "ver");
        svc.set("theme_mode".to_string(), json!("dark")).expect("set");

        let raw = fs::read_to_string(dir.join("app_config.json")).expect("read");
        let parsed: Value = serde_json::from_str(&raw).expect("parse");
        assert_eq!(parsed["schema_version"], json!(SCHEMA_VERSION));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn migration_moves_secrets_to_store_and_removes_backup() {
        let dir = std::env::temp_dir().join(format!("ep_cfg_mig_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);

        let key = format!("account_token_m{}", std::process::id());
        let config_path = dir.join("app_config.json");

        // 模拟 v1 格式：全部明文，且无 schema_version
        let v1 = json!({
            "theme_mode": "dark",
            key.clone(): {
                "cred": "MIG_SECRET_CRED",
                "u8token": "MIG_SECRET_U8",
                "roles": [{"roleId": "r1"}],
            },
        });
        fs::write(&config_path, serde_json::to_string_pretty(&v1).unwrap()).expect("write v1");

        // 构造服务并触发迁移
        let mut svc = test_service(&dir, "mig");
        svc.cache = Mutex::new(
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap(),
        );
        svc.migrate_to_v2().expect("migrate");

        // 1. 配置文件里不再有机密值
        let raw = fs::read_to_string(&config_path).expect("read");
        assert!(!raw.contains("MIG_SECRET_CRED"), "cred leaked after migration");
        assert!(!raw.contains("MIG_SECRET_U8"), "u8token leaked after migration");
        // 非机密内容保留
        assert!(raw.contains("r1"));
        assert!(raw.contains("dark"));
        assert!(raw.contains(&format!("\"schema_version\": {}", SCHEMA_VERSION)));

        // 2. 备份已删除
        let backup = dir.join("app_config.json.bak");
        assert!(!backup.exists(), "backup should be removed after migration");

        // 3. 凭据库里有值，且能读回内存
        svc.reload_secrets();
        let cached = svc.get::<Value>(&key).expect("get");
        assert_eq!(cached["cred"], json!("MIG_SECRET_CRED"));
        assert_eq!(cached["u8token"], json!("MIG_SECRET_U8"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn migration_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("ep_cfg_mig2_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);

        let key = format!("account_token_i{}", std::process::id());
        let config_path = dir.join("app_config.json");

        let v1 = json!({ key.clone(): { "cred": "IDEM_SECRET" } });
        fs::write(&config_path, serde_json::to_string_pretty(&v1).unwrap()).expect("write v1");

        let mut svc = test_service(&dir, "idem");
        svc.cache = Mutex::new(
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap(),
        );
        svc.migrate_to_v2().expect("migrate 1");
        // 第二次：schema_version 已就位，应直接返回
        svc.migrate_to_v2().expect("migrate 2");

        let raw = fs::read_to_string(&config_path).expect("read");
        assert!(!raw.contains("IDEM_SECRET"));

        let _ = fs::remove_dir_all(&dir);
    }
}

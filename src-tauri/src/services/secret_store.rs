//! 机密存储后端。
//!
//! # 目标
//!
//! 需求是「应用能随时访问机密数据，但别人不行（或者不能轻易访问）」。
//! 这不是「把文件加密一下」能解决的 —— 加密文件的密钥只要也在磁盘上或用户能交互，
//! 就等于没加密。
//!
//! 真正的做法是**把数据放进操作系统用用户凭据保护的存储里**：
//!
//! | 平台 | 存储 | 保护边界 |
//! |---|---|---|
//! | Windows | Credential Manager（`CRED_TYPE_GENERIC`） | DPAPI 用户密钥，同用户 + 同机器才能解密 |
//! | macOS | Keychain（generic password） | Keychain ACL，需用户授权 |
//! | Linux | Secret Service | D-Bus 会话密钥环 |
//!
//! # 降级链
//!
//! 1. **OS 凭据库**（首选）。Windows / macOS 上凭据库必然可用，失败即报错。
//! 2. **加密文件**（降级）。Linux AppImage 常无 Secret Service daemon，此时用
//!    AES-256-GCM 加密到 `secrets.enc`。密钥来源见 [`file_backend`]。
//! 3. **明文**（最后兜底）。仅在前两者都不可用时启用，会记 warning 日志，
//!    并且 `SecretStore::is_degraded()` 返回 true，UI 可据此提示用户。
//!
//! # 条目命名
//!
//! 一个机密字段 = 一条凭据条目。**不能**把整个 `account_token_*` 对象塞进一条：
//! Windows 凭据 blob 上限是 2560 字节（`CRED_MAX_CREDENTIAL_BLOB_SIZE`），
//! 而 `u8token` 单字段就有 584 字节。
//!
//! 命名规则：`service = "cn.msk-network.endprotocol"`，`username = "{键}::{子字段}"`，
//! 例如 `account_token_4718764::u8token`。

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;

use crate::services::secret_registry;
use crate::utils::{paths, AppError};

/// 凭据条目使用的 service 名（Windows 上会成为 TargetName 的一部分）。
pub const SERVICE_NAME: &str = "cn.msk-network.endprotocol";

/// 机密存储的可用后端。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backend {
    /// OS 凭据库（Windows Credential Manager / macOS Keychain / Linux Secret Service）。
    CredentialStore,
    /// AES-256-GCM 加密文件（OS 凭据库不可用时的降级方案）。
    EncryptedFile,
    /// 明文兜底（最后手段，仅记警告）。
    Plaintext,
    /// 纯内存（**仅供单元测试**）：不碰任何持久化存储。
    Memory,
}

impl Backend {
    /// 后端名称（用于日志与 UI 展示）。
    pub fn as_str(&self) -> &'static str {
        match self {
            Backend::CredentialStore => "credential-store",
            Backend::EncryptedFile => "encrypted-file",
            Backend::Plaintext => "plaintext",
            Backend::Memory => "memory",
        }
    }
}

/// 机密存储错误。
#[derive(Debug)]
pub enum SecretError {
    /// 凭据库不可用。
    StoreUnavailable(String),
    /// 条目不存在。
    NotFound,
    /// 操作失败。
    Failed(String),
}

impl std::fmt::Display for SecretError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SecretError::StoreUnavailable(m) => write!(f, "credential store unavailable: {m}"),
            SecretError::NotFound => write!(f, "secret entry not found"),
            SecretError::Failed(m) => write!(f, "secret operation failed: {m}"),
        }
    }
}

impl std::error::Error for SecretError {}

impl From<SecretError> for AppError {
    fn from(e: SecretError) -> Self {
        AppError::ConfigError {
            message: e.to_string(),
        }
    }
}

/// 机密存储服务。
///
/// 负责机密字段与操作系统受保护存储之间的读写。**调用方应在启动时把所有机密
/// 字段一次性读入内存**（见 `ConfigService::new`），运行时从内存取值 —— 避免
/// 每次读都同步阻塞在凭据库调用上（Linux 上走 D-Bus 尤其慢）。
pub struct SecretStore {
    backend: Backend,
    /// 凭据条目的 service 名。生产环境固定为 [`SERVICE_NAME`]；
    /// 测试用独立名称，避免污染用户真实的凭据库。
    service: String,
    /// 降级后端：加密文件的密钥。
    file_key: Option<[u8; 32]>,
    /// 降级后端：加密文件路径。
    file_path: PathBuf,
    /// 降级后端的密文条目缓存（key = `{键}::{子字段}`）。
    file_cache: Mutex<HashMap<String, Vec<u8>>>,
}

impl SecretStore {
    /// 创建机密存储服务，按降级链挑选可用后端。
    ///
    /// Windows / macOS 上凭据库必然可用；Linux 上 Secret Service 可能不存在
    /// （无桌面环境的 AppImage 常见），此时降级到加密文件。
    pub fn new() -> Result<Self, SecretError> {
        Self::with_service(SERVICE_NAME.to_string())
    }

    /// 用指定的 service 名创建机密存储服务。
    ///
    /// ⚠️ 仅供测试使用 —— 不同 service 名在 OS 凭据库中是独立的命名空间。
    pub fn with_service(service: String) -> Result<Self, SecretError> {
        let file_path = paths::secret_file_path()
            .map_err(|e| SecretError::StoreUnavailable(e.to_string()))?;

        // 1. 尝试 OS 凭据库
        if keyring::v1::Entry::store_status().is_ok() {
            return Ok(Self {
                backend: Backend::CredentialStore,
                service,
                file_key: None,
                file_path,
                file_cache: Mutex::new(HashMap::new()),
            });
        }

        // 2. 降级：加密文件
        let (key, cache) = file_backend::load_or_init(&file_path)
            .map_err(|e| SecretError::StoreUnavailable(e))?;

        // 3. 若连加密文件都建不起来（例如目录不可写），退到明文。
        //    注意：此时机密字段仍不进 app_config.json，而是留在内存里，
        //    重启后需要重新登录 —— 不会退回明文落盘。
        Ok(Self {
            backend: Backend::EncryptedFile,
            service,
            file_key: Some(key),
            file_path,
            file_cache: Mutex::new(cache),
        })
    }

    /// 创建纯内存的机密存储（**仅供单元测试**）。
    ///
    /// 不触碰任何持久化存储 —— OS 凭据库是机器全局的，单元测试写进去的条目
    /// 会留在用户真实凭据库里造成污染。端到端测试应改用
    /// [`SecretStore::with_service`] 并自行清理。
    pub fn in_memory() -> Self {
        Self {
            backend: Backend::Memory,
            service: String::new(),
            file_key: None,
            file_path: PathBuf::new(),
            file_cache: Mutex::new(HashMap::new()),
        }
    }

    /// 当前使用的后端。
    pub fn backend(&self) -> Backend {
        self.backend
    }

    /// 是否处于降级状态（非 OS 凭据库）。
    pub fn is_degraded(&self) -> bool {
        !matches!(self.backend, Backend::CredentialStore | Backend::Memory)
    }

    /// 写入一个机密字段。
    ///
    /// `value` 为该字段的 JSON 序列化字节。
    pub fn set(&self, key: &str, field: &str, value: &[u8]) -> Result<(), SecretError> {
        match self.backend {
            Backend::CredentialStore => {
                let entry = keyring::v1::Entry::new(&self.service, &entry_name(key, field))
                    .map_err(|e| SecretError::StoreUnavailable(e.to_string()))?;
                // 用 set_secret 而非 set_password：后者会把内容编码成 UTF-16（字节 ×2），
                // 白白吃掉一半容量上限。
                entry
                    .set_secret(value)
                    .map_err(|e| SecretError::Failed(e.to_string()))
            }
            Backend::EncryptedFile => {
                let mut cache = self.file_cache.lock().map_err(|e| {
                    SecretError::Failed(format!("file cache lock failed: {e}"))
                })?;
                cache.insert(entry_name(key, field), value.to_vec());
                file_backend::persist(&self.file_path, self.file_key.as_ref(), &cache)
                    .map_err(SecretError::Failed)
            }
            Backend::Plaintext => Err(SecretError::Failed(
                "plaintext backend does not support secrets".to_string(),
            )),
            Backend::Memory => {
                let mut cache = self
                    .file_cache
                    .lock()
                    .map_err(|e| SecretError::Failed(format!("memory cache lock failed: {e}")))?;
                cache.insert(entry_name(key, field), value.to_vec());
                Ok(())
            }
        }
    }

    /// 读取一个机密字段。
    pub fn get(&self, key: &str, field: &str) -> Result<Vec<u8>, SecretError> {
        match self.backend {
            Backend::CredentialStore => {
                let entry = keyring::v1::Entry::new(&self.service, &entry_name(key, field))
                    .map_err(|e| SecretError::StoreUnavailable(e.to_string()))?;
                entry
                    .get_secret()
                    .map_err(|e| match e {
                        keyring::v1::Error::NoEntry => SecretError::NotFound,
                        other => SecretError::Failed(other.to_string()),
                    })
            }
            Backend::EncryptedFile => {
                let cache = self.file_cache.lock().map_err(|e| {
                    SecretError::Failed(format!("file cache lock failed: {e}"))
                })?;
                cache
                    .get(&entry_name(key, field))
                    .cloned()
                    .ok_or(SecretError::NotFound)
            }
            Backend::Plaintext => Err(SecretError::NotFound),
            Backend::Memory => {
                let cache = self
                    .file_cache
                    .lock()
                    .map_err(|e| SecretError::Failed(format!("memory cache lock failed: {e}")))?;
                cache
                    .get(&entry_name(key, field))
                    .cloned()
                    .ok_or(SecretError::NotFound)
            }
        }
    }

    /// 删除一个机密字段。条目不存在不算错误。
    pub fn remove(&self, key: &str, field: &str) -> Result<(), SecretError> {
        match self.backend {
            Backend::CredentialStore => {
                let entry = keyring::v1::Entry::new(&self.service, &entry_name(key, field))
                    .map_err(|e| SecretError::StoreUnavailable(e.to_string()))?;
                match entry.delete_credential() {
                    Ok(()) => Ok(()),
                    // 条目本来就不存在 —— 视为成功
                    Err(keyring::v1::Error::NoEntry) => Ok(()),
                    Err(e) => Err(SecretError::Failed(e.to_string())),
                }
            }
            Backend::EncryptedFile => {
                let mut cache = self.file_cache.lock().map_err(|e| {
                    SecretError::Failed(format!("file cache lock failed: {e}"))
                })?;
                if cache.remove(&entry_name(key, field)).is_some() {
                    file_backend::persist(&self.file_path, self.file_key.as_ref(), &cache)
                        .map_err(SecretError::Failed)?;
                }
                Ok(())
            }
            Backend::Plaintext => Ok(()),
            Backend::Memory => {
                let mut cache = self
                    .file_cache
                    .lock()
                    .map_err(|e| SecretError::Failed(format!("memory cache lock failed: {e}")))?;
                cache.remove(&entry_name(key, field));
                Ok(())
            }
        }
    }

    /// 删除某个配置键下的**全部**机密字段。
    pub fn remove_key(&self, key: &str) -> Result<(), SecretError> {
        for field in secret_registry::secret_fields_of(key) {
            self.remove(key, field)?;
        }
        Ok(())
    }

    /// 列出某个配置键下实际已存在的机密字段。
    pub fn existing_fields(&self, key: &str) -> Vec<&'static str> {
        secret_registry::secret_fields_of(key)
            .into_iter()
            .filter(|f| self.get(key, f).is_ok())
            .collect()
    }
}

/// 凭据条目名：`{键}::{子字段}`。
///
/// `::` 分隔避免与键名里的 `_` 混淆，且不会出现在配置键或字段名中。
fn entry_name(key: &str, field: &str) -> String {
    format!("{}::{}", key, field)
}

/// 降级后端：AES-256-GCM 加密文件。
///
/// 密钥保存在 `secrets.key`（权限收紧到当前用户可读），密文在 `secrets.enc`。
/// 这比明文安全得多，但**弱于** OS 凭据库 —— 文件与密钥同处一个用户目录，
/// 能读取该目录的进程同样能解密。所以它只是 Linux 无凭据库时的退路。
pub mod file_backend {
    use super::*;

    use aes_gcm::aead::{Aead, KeyInit};
    use aes_gcm::{Aes256Gcm, Nonce};

    /// 密钥文件路径。
    fn key_path(file_path: &PathBuf) -> PathBuf {
        let mut p = file_path.clone();
        p.set_extension("key");
        p
    }

    /// 载入或初始化密钥与密文条目。
    pub fn load_or_init(file_path: &PathBuf) -> Result<([u8; 32], HashMap<String, Vec<u8>>), String> {
        if let Some(dir) = file_path.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("create dir failed: {e}"))?;
        }

        let kp = key_path(file_path);
        let key = if kp.exists() {
            let raw = fs::read(&kp).map_err(|e| format!("read key failed: {e}"))?;
            let raw_text = String::from_utf8(raw).map_err(|e| format!("key is not utf-8: {e}"))?;
            let decoded = BASE64
                .decode(raw_text.trim().as_bytes())
                .map_err(|e| format!("decode key failed: {e}"))?;
            if decoded.len() != 32 {
                return Err("secret key has wrong length".to_string());
            }
            let mut k = [0u8; 32];
            k.copy_from_slice(&decoded);
            k
        } else {
            let mut k = [0u8; 32];
            getrandom(&mut k);
            let encoded = BASE64.encode(k);
            fs::write(&kp, encoded.as_bytes()).map_err(|e| format!("write key failed: {e}"))?;
            restrict_permissions(&kp);
            k
        };

        let cache = if file_path.exists() {
            let raw = fs::read(file_path).map_err(|e| format!("read secrets failed: {e}"))?;
            decrypt_blob(&key, &raw)?
        } else {
            HashMap::new()
        };

        Ok((key, cache))
    }

    /// 把密文条目写回磁盘（原子写）。
    pub fn persist(
        file_path: &PathBuf,
        key: Option<&[u8; 32]>,
        cache: &HashMap<String, Vec<u8>>,
    ) -> Result<(), String> {
        let key = key.ok_or_else(|| "missing encryption key".to_string())?;
        let plain = serde_json::to_vec(cache).map_err(|e| format!("serialize failed: {e}"))?;
        let blob = encrypt_blob(key, &plain)?;

        let tmp = file_path.with_extension("enc.tmp");
        fs::write(&tmp, &blob).map_err(|e| format!("write temp failed: {e}"))?;
        fs::rename(&tmp, file_path).map_err(|e| format!("rename failed: {e}"))?;
        restrict_permissions(file_path);
        Ok(())
    }

    /// 加密：nonce(12) || ciphertext || tag(16)。
    fn encrypt_blob(key: &[u8; 32], plain: &[u8]) -> Result<Vec<u8>, String> {
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
        // 随机 12 字节 nonce（GCM 标准长度）。用 OsRng 直接填充，
        // 避免依赖 aead 的 `Generate` trait（需要额外 rand_core feature）。
        let mut nonce_bytes = [0u8; 12];
        getrandom(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ct = cipher
            .encrypt(&nonce, plain)
            .map_err(|e| format!("encrypt failed: {e}"))?;
        let mut out = nonce_bytes.to_vec();
        out.extend_from_slice(&ct);
        Ok(out)
    }

    /// 解密（带完整性校验，失败即报错）。
    fn decrypt_blob(key: &[u8; 32], blob: &[u8]) -> Result<HashMap<String, Vec<u8>>, String> {
        if blob.len() < 28 {
            return Err("secret file is truncated".to_string());
        }
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
        let nonce = Nonce::from_slice(&blob[..12]);
        let plain = cipher
            .decrypt(nonce, &blob[12..])
            .map_err(|_| "secret file failed integrity check (wrong key or corrupted)".to_string())?;
        serde_json::from_slice(&plain).map_err(|e| format!("deserialize failed: {e}"))
    }

    /// 生成随机字节。
    fn getrandom(buf: &mut [u8]) {
        use rand::RngCore;
        rand::rngs::OsRng.fill_bytes(buf);
    }

    /// 把文件权限收紧到当前用户（Unix）。Windows 上跳过。
    #[cfg(unix)]
    fn restrict_permissions(path: &PathBuf) {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }

    /// Windows 上跳过（NTFS 权限由用户目录 ACL 保证）。
    #[cfg(not(unix))]
    fn restrict_permissions(_path: &PathBuf) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_name_format() {
        assert_eq!(
            entry_name("account_token_1", "u8token"),
            "account_token_1::u8token"
        );
    }

    #[test]
    fn encrypted_file_roundtrip() {
        let dir = std::env::temp_dir().join(format!("ep_secret_test_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("secrets.enc");

        let (key, cache) = file_backend::load_or_init(&path).expect("init");
        let mut cache = cache;
        cache.insert("account_token_1::cred".to_string(), b"secret-value".to_vec());

        file_backend::persist(&path, Some(&key), &cache).expect("persist");

        let (key2, cache2) = file_backend::load_or_init(&path).expect("reload");
        assert_eq!(key, key2);
        assert_eq!(
            cache2.get("account_token_1::cred").map(|v| v.as_slice()),
            Some(&b"secret-value"[..])
        );

        // 密文文件里不应出现明文
        let raw = fs::read(&path).unwrap();
        assert!(!raw.windows(11).any(|w| w == b"secret-value"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn encrypted_file_detects_tampering() {
        let dir = std::env::temp_dir().join(format!("ep_secret_tamper_{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("secrets.enc");

        let (key, mut cache) = file_backend::load_or_init(&path).expect("init");
        cache.insert("k::f".to_string(), b"v".to_vec());
        file_backend::persist(&path, Some(&key), &cache).expect("persist");

        let mut raw = fs::read(&path).unwrap();
        let last = raw.len() - 1;
        raw[last] ^= 0xff;
        fs::write(&path, &raw).unwrap();

        let result = file_backend::load_or_init(&path);
        assert!(result.is_err(), "tampered file must fail to load");

        let _ = fs::remove_dir_all(&dir);
    }
}

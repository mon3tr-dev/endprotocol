//! 机密存储的端到端集成测试。
//!
//! 覆盖真实的 OS 凭据库（Windows Credential Manager / macOS Keychain /
//! Linux Secret Service）读写，以及配置文件与凭据库之间的分工。
//!
//! ⚠️ OS 凭据库是机器全局的 —— 测试用独立的 service 名，并在结束时清理自己
//! 创建的条目，避免污染用户真实凭据库。

use endprotocol_lib::services::config_service::ConfigService;
use endprotocol_lib::services::secret_store::SecretStore;
use serde_json::{json, Value};

/// 测试用的凭据 service 名（与生产环境的 `cn.msk-network.endprotocol` 隔离）。
fn test_service_name(tag: &str) -> String {
    format!("cn.msk-network.endprotocol.test-{}-{}", tag, std::process::id())
}

/// 构造一个指向临时目录的配置服务。
fn test_service(dir: &std::path::Path, tag: &str) -> ConfigService {
    let secrets = SecretStore::with_service(test_service_name(tag)).expect("secret store");
    ConfigService::new_with_paths(dir.join("app_config.json"), secrets).expect("config service")
}

/// 清理测试写入的凭据条目与临时目录。
fn cleanup(dir: &std::path::Path, tag: &str, key: &str) {
    if let Ok(secrets) = SecretStore::with_service(test_service_name(tag)) {
        let _ = secrets.remove_key(key);
    }
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn secrets_never_touch_the_config_file() {
    let tag = "basic";
    let dir = std::env::temp_dir().join(format!("ep_it_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);

    let key = format!("account_token_it{}", std::process::id());
    let mut svc = test_service(&dir, tag);

    svc.set(
        key.clone(),
        json!({
            "cred": "IT_SECRET_CRED",
            "token": "IT_SECRET_TOKEN",
            "hytoken": "IT_SECRET_HYTOKEN",
            "u8token": "IT_SECRET_U8TOKEN",
            "device_token": "IT_SECRET_DEVICE",
            "phone": "13900000000",
            "roles": [{"roleId": "r1"}],
            "user_info": {"nickname": "n"},
        }),
    )
    .expect("set");

    // 配置文件里不应出现任何机密值
    let raw = std::fs::read_to_string(dir.join("app_config.json")).expect("read config");
    for secret in [
        "IT_SECRET_CRED",
        "IT_SECRET_TOKEN",
        "IT_SECRET_HYTOKEN",
        "IT_SECRET_U8TOKEN",
        "IT_SECRET_DEVICE",
        "13900000000",
    ] {
        assert!(!raw.contains(secret), "config file leaked {secret}");
    }

    // 非机密内容保留
    assert!(raw.contains("r1"), "roles should stay in config file");
    assert!(raw.contains("nickname"), "user_info should stay in config file");

    // 内存视图仍是完整明文
    let cached: Value = svc.get(&key).expect("get");
    assert_eq!(cached["cred"], json!("IT_SECRET_CRED"));
    assert_eq!(cached["u8token"], json!("IT_SECRET_U8TOKEN"));

    // 对外视图不含机密字段
    let public = svc.get_all_public();
    let entry = public.get(&key).expect("entry");
    assert!(entry.get("cred").is_none(), "cred leaked via public view");
    assert!(entry.get("u8token").is_none(), "u8token leaked via public view");
    assert!(entry.get("roles").is_some(), "roles should remain in public view");

    cleanup(&dir, tag, &key);
}

#[test]
fn migration_from_plaintext_config() {
    let tag = "migrate";
    let dir = std::env::temp_dir().join(format!("ep_it_mig_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);

    let key = format!("account_token_itm{}", std::process::id());
    let config_path = dir.join("app_config.json");

    // v1 格式：全明文、无 schema_version
    let v1 = json!({
        "theme_mode": "dark",
        key.clone(): {
            "cred": "MIG_IT_CRED",
            "u8token": "MIG_IT_U8TOKEN",
            "roles": [{"roleId": "r9"}],
        },
    });
    std::fs::write(&config_path, serde_json::to_string_pretty(&v1).unwrap()).unwrap();

    let mut svc = test_service(&dir, tag);
    svc.migrate_to_v2().expect("migrate");

    let raw = std::fs::read_to_string(&config_path).unwrap();
    assert!(!raw.contains("MIG_IT_CRED"), "cred leaked after migration");
    assert!(!raw.contains("MIG_IT_U8TOKEN"), "u8token leaked after migration");
    assert!(raw.contains("r9"), "roles lost during migration");
    assert!(raw.contains("dark"), "other settings lost during migration");

    // 备份已删除
    assert!(
        !dir.join("app_config.json.bak").exists(),
        "plaintext backup must be removed after migration"
    );

    // 机密字段从凭据库读回
    svc.reload_secrets();
    let cached: Value = svc.get(&key).expect("get");
    assert_eq!(cached["cred"], json!("MIG_IT_CRED"));
    assert_eq!(cached["u8token"], json!("MIG_IT_U8TOKEN"));

    cleanup(&dir, tag, &key);
}

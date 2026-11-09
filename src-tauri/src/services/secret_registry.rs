//! 机密字段登记表。
//!
//! # 为什么需要这张表
//!
//! 应用配置（`app_config.json`）里混着两类东西：普通偏好设置与**可用的账户凭据**。
//! 凭据一旦明文落盘，任何能读取用户目录的进程 / 备份软件 / 同步盘都能拿到。
//!
//! 本模块是**唯一**的机密判定来源。判定规则显式写死在这里，代码里不出现散落的
//! `if key == "account_token_..."` 判断。
//!
//! # 新增机密字段的流程
//!
//! 1. 在 [`SECRET_FIELDS`] 中登记该字段（键名 + 子字段名）；
//! 2. 在 [`docs/secure_storage.md`](../../../../../docs/secure_storage.md) 的表格里补一行；
//! 3. 补一条单元测试。
//!
//! 未登记的字段一律视为**非机密**，保持明文存储 —— 这是白名单策略：宁可漏判也不
//! 误伤（误伤会让卡片配置变成不可读的密文，反而制造排查困难）。
//!
//! # 分级
//!
//! - **机密（A 类）**：移入操作系统凭据库，明文不落盘。见 [`crate::services::secret_store`]。
//! - **非机密（B/C 类）**：留在 `app_config.json` 明文。

/// 单个机密字段的登记项。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SecretField {
    /// 配置键（如 `account_token_4718764`）。
    pub key: &'static str,
    /// 键内的子字段名（如 `cred`）。为空表示整个键都是机密。
    pub field: &'static str,
}

/// `account_token_*` 的键前缀。
pub const ACCOUNT_TOKEN_PREFIX: &str = "account_token_";

/// 代理配置的键名。
pub const PROXY_CONFIG_KEY: &str = "proxy_config";

/// 旧版本按角色存放 u8token 的键前缀。
///
/// **已废弃**：u8token 现在完全不做持久化（每次同步现换），授权只是 `roles[].u8Authorized`
/// 开关。这个常量仅用于启动时清理遗留的 `role_u8token_*` 键与凭据库条目。
pub const ROLE_U8TOKEN_PREFIX: &str = "role_u8token_";

/// 机密字段登记表。
///
/// 按 `(键, 子字段)` 二元组登记。`key` 支持两种形态：
/// - 精确键名（如 `proxy_config`）
/// - 前缀通配（以 `*` 结尾，如 `account_token_*`）
///
/// 登记项当前全部是 A 类（机密），B 类按用户决定保持明文。
///
/// ⚠️ 机密值必须是**对象里的子字段**：`write_secret_fields` 对非对象值直接跳过，
/// `strip_secret_fields` 按字段名剥离。所以「整个键都是机密」的写法（`field: ""`）
/// 目前不生效 —— 新增机密一律用「键 + 固定子字段名」的形式。
pub const SECRET_FIELDS: &[SecretField] = &[
    // ---- 森空岛 / 鹰角账户凭据 ----
    SecretField {
        key: "account_token_*",
        field: "cred",
    },
    SecretField {
        key: "account_token_*",
        field: "token",
    },
    SecretField {
        key: "account_token_*",
        field: "hytoken",
    },
    // ⚠️ 账号级 u8token 已废弃 —— 保留登记**只为了清理**：升级时凭据库里可能还留着
    // 旧值，`migrate_legacy_u8token` 会把它连同字段一起删除。代码里不再写入该字段。
    SecretField {
        key: "account_token_*",
        field: "u8token",
    },
    SecretField {
        key: "account_token_*",
        field: "device_token",
    },
    SecretField {
        key: "account_token_*",
        field: "phone",
    },
    // ⚠️ 按角色的 u8token 也已废弃：令牌不落盘（每次同步现换），授权只是
    // `roles[].u8Authorized` 开关。保留登记同样只为清理遗留凭据。
    SecretField {
        key: "role_u8token_*",
        field: "token",
    },
    // ---- 网络代理凭据 ----
    SecretField {
        key: "proxy_config",
        field: "username",
    },
    SecretField {
        key: "proxy_config",
        field: "password",
    },
    SecretField {
        key: "proxy_config",
        field: "host",
    },
    SecretField {
        key: "proxy_config",
        field: "port",
    },
];

/// 判断某个配置键是否命中登记表的**键**部分（含前缀通配）。
///
/// 用于快速筛掉绝大多数与机密无关的键。
pub fn matches_secret_key(key: &str) -> bool {
    SECRET_FIELDS.iter().any(|f| key_matches(f.key, key))
}

/// 判断某个配置键下的某个子字段是否为机密。
///
/// `key` 命中登记表的键部分、且 `field` 命中对应的子字段名时返回 true。
pub fn is_secret_field(key: &str, field: &str) -> bool {
    SECRET_FIELDS
        .iter()
        .any(|f| key_matches(f.key, key) && f.field == field)
}

/// 判断某个配置键下是否存在机密子字段。
pub fn has_secret_fields(key: &str) -> bool {
    SECRET_FIELDS.iter().any(|f| key_matches(f.key, key))
}

/// 返回某个配置键下登记的全部机密子字段名。
pub fn secret_fields_of(key: &str) -> Vec<&'static str> {
    SECRET_FIELDS
        .iter()
        .filter(|f| key_matches(f.key, key))
        .map(|f| f.field)
        .collect()
}

/// 键匹配：支持 `*` 结尾的前缀通配。
fn key_matches(pattern: &str, key: &str) -> bool {
    match pattern.strip_suffix('*') {
        Some(prefix) => key.starts_with(prefix),
        None => pattern == key,
    }
}

/// 从一个配置值里剔除机密子字段，返回可安全落盘/外发的副本。
///
/// 注意：`account_token_*` 这类键**同时**包含机密（A 类）与非机密（B 类）字段，
/// 所以不能整键剔除 —— 必须按子字段剥离，否则 `user_info` / `roles` 会被误删。
///
/// 非机密键原样返回。
pub fn strip_secret_fields(key: &str, value: &serde_json::Value) -> serde_json::Value {
    let fields = secret_fields_of(key);
    if fields.is_empty() {
        return value.clone();
    }

    let Some(obj) = value.as_object() else {
        return value.clone();
    };

    let mut stripped = obj.clone();
    for field in fields {
        stripped.remove(field);
    }
    serde_json::Value::Object(stripped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_token_prefix_matches() {
        assert!(matches_secret_key("account_token_4718764"));
        assert!(matches_secret_key("account_token_123"));
        assert!(!matches_secret_key("account_list"));
        assert!(!matches_secret_key("card_settings.abc"));
    }

    #[test]
    fn proxy_key_matches() {
        assert!(matches_secret_key("proxy_config"));
    }

    #[test]
    fn credential_subfields_are_secret() {
        for f in ["cred", "token", "hytoken", "u8token", "device_token", "phone"] {
            assert!(
                is_secret_field("account_token_4718764", f),
                "expected {f} to be secret"
            );
        }
    }

    #[test]
    fn non_credential_subfields_are_not_secret() {
        // B 类按用户决定保持明文
        for f in ["user_info", "roles", "skland_account_bound"] {
            assert!(
                !is_secret_field("account_token_4718764", f),
                "expected {f} to stay plaintext"
            );
        }
    }

    #[test]
    fn proxy_subfields_are_secret() {
        for f in ["username", "password", "host", "port"] {
            assert!(is_secret_field("proxy_config", f), "expected {f} to be secret");
        }
        // 代理的非凭据字段保持明文
        assert!(!is_secret_field("proxy_config", "enabled"));
        assert!(!is_secret_field("proxy_config", "type"));
        assert!(!is_secret_field("proxy_config", "exclude"));
        assert!(!is_secret_field("proxy_config", "remoteDns"));
    }

    #[test]
    fn unrelated_keys_have_no_secret_fields() {
        assert!(!has_secret_fields("theme_mode"));
        assert!(!has_secret_fields("card_settings.abc"));
        assert!(!has_secret_fields("dashboard_tabs"));
    }

    #[test]
    fn role_u8token_is_secret() {
        assert!(matches_secret_key("role_u8token_123456"));
        assert!(is_secret_field("role_u8token_123456", "token"));
        // 同键下的非机密子字段（渠道 / 授权时间）保持明文，便于界面展示状态
        for f in ["serverId", "channelMasterId", "authorizedAt"] {
            assert!(
                !is_secret_field("role_u8token_123456", f),
                "expected {f} to stay plaintext"
            );
        }
        // 角色令牌的配置键不属于账号键，两者不要互相串味
        assert!(!matches_secret_key("account_role_u8token"));
    }

    #[test]
    fn secret_fields_of_lists_all() {
        let fields = secret_fields_of("account_token_1");
        assert_eq!(fields.len(), 6);
        assert!(fields.contains(&"u8token"));
    }
}

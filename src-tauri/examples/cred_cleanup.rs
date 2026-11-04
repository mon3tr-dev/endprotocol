//! 凭据库清理工具。
//!
//! 用途：删除本应用在 OS 凭据库里留下的**非真实账户**条目 —— 例如测试残留、
//! 或已登出账户的孤儿条目。
//!
//! 真实账户的判定：`account_token_<6 位以上数字>`（真实的 userId 是数字串）。
//! 其余 `cn.msk-network.endprotocol*` service 下的条目都会被清理。
//!
//! 用法：
//! ```text
//! cargo run --example cred_cleanup -- --dry-run   # 只列出，不删除
//! cargo run --example cred_cleanup                # 直接删除
//! ```

use std::collections::HashMap;

use keyring_core::{Entry, Result, set_default_store};
use windows_native_keyring_store::Store;

/// 本应用的 service 名前缀。
const SERVICE_PREFIX: &str = "cn.msk-network.endprotocol";

fn main() -> Result<()> {
    let dry_run = std::env::args().any(|a| a == "--dry-run");

    set_default_store(Store::new()?);

    let candidates = Entry::search(&HashMap::from([("pattern", SERVICE_PREFIX)]))?;

    let mut deleted = 0usize;
    let mut kept = 0usize;

    for entry in candidates {
        let Some((_service, user)) = entry.get_specifiers() else {
            continue;
        };

        // target 形如 `<user-part>::<field>.cn.msk-network.endprotocol`
        // （service 名里的 `.` 会被 Windows 的分隔符切开，所以从 user 段还原）
        let Some(idx) = user.find("::") else {
            continue;
        };
        let account = &user[..idx];

        // 真实账户：account_token_<6 位以上数字>
        let is_real_account = account
            .strip_prefix("account_token_")
            .map(|id| id.len() >= 6 && id.chars().all(|c| c.is_ascii_digit()))
            .unwrap_or(false);

        if is_real_account {
            kept += 1;
            continue;
        }

        if dry_run {
            println!("[dry-run] would delete: {account}");
            continue;
        }

        match entry.delete_credential() {
            Ok(()) => {
                deleted += 1;
                println!("deleted: {account}");
            }
            Err(e) => println!("failed to delete {account}: {e}"),
        }
    }

    println!("--- deleted {deleted}, kept {kept} real account entries ---");
    Ok(())
}

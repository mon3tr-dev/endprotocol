//! 凭证自愈钩子：把「数据接口拒绝当前 cred」的请求接回 `hytoken` 刷新链路。
//!
//! # 为什么需要这一层
//!
//! 森空岛的数据接口（`/api/v1/game/player/info`、`/api/v1/game/endfield/card/detail`、
//! `/web/v1/game/endfield/attendance` …）在服务端轮换会话后会返回
//! `HTTP 401 + {"code":10000,"message":"请求异常"}`，而**同一个时刻**
//! `/api/v1/user/check` 仍然返回 `code=0`（凭据「有效」）。
//!
//! 于是 `check_and_refresh_user_cred` 认定 cred 无需刷新 → 后续每个角色都撞 401 →
//! 连续失败把熔断计数打满 → 账户页所有账号一起显示「账号不可用」。
//! 用户唯一的出路是**重新登录**，因为重新登录会重新走一遍
//! `hytoken → generate_cred_by_code` 拿到新 cred（并顺手 `reset_api_health`）。
//!
//! 本模块把这条「重新登录才做到」的动作下放到 HTTP 层：任何一次请求被判定为
//! 会话失效时，就地用该账号已保存的 `hytoken` 换一把新 cred、写回配置，然后
//! 让调用方用新凭据重试。这样故障窗口从「数分钟 + 全账号不可用」收敛成
//! 「一次额外请求」。
//!
//! # 为什么用回调而不是直接调用 AccountService
//!
//! [`crate::services::skland_service::SklandService`] 被 `AccountService` 持有，
//! 反向依赖会成环。钩子在 `AccountService::new` 里注册一次，`SklandService`
//! 只保留一个 `Arc<dyn Fn>`，两者仍然单向依赖。

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, OnceLock};

/// 一次「换新凭据」的结果：`(新 cred, 新 token)`。
pub type RefreshedCred = (String, String);

/// 恢复回调：入参是**旧的 cred**，成功时返回新的一对凭据。
///
/// 用旧 cred 反查账号（而不是传 user_id）是刻意的：`call_skland_api` 手里只有
/// cred，而配置里 `account_token_{user_id}.cred` 正好是它的索引。
pub type RecoveryFuture = Pin<Box<dyn Future<Output = Option<RefreshedCred>> + Send>>;
pub type RecoveryHook = Arc<dyn Fn(String) -> RecoveryFuture + Send + Sync>;

static HOOK: OnceLock<RecoveryHook> = OnceLock::new();

/// 注册恢复回调（幂等：只有第一次生效）。
pub fn install(hook: RecoveryHook) {
    let _ = HOOK.set(hook);
}

/// 依据失效的 cred 换一把新凭据。未注册钩子时返回 `None`。
pub async fn refresh_for_cred(cred: &str) -> Option<RefreshedCred> {
    let hook = HOOK.get()?;
    hook(cred.to_string()).await
}

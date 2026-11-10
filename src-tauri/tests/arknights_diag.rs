//! 《明日方舟》**逐 uid 全量解析**的联网回归测试。
//!
//! 为什么单独有这一个：`arknights_live.rs` 里的断言是拿 `serde_json::Value`
//! 看字段路径，**并没有真正跑 `ArknightsPlayerInfo` 的反序列化**。于是出现过这样的
//! 漏网：B 服账号的 `building.training.remainPoint` 是 `0.45`（浮点），而模型声明成
//! `i64`，整个 `player/info` 解析失败 —— 接口 `code=0`、字段看着都对，但服务层拿到
//! 的是 `Err`，前端表现为「等级 0、没有头像」。官服账号恰好给整数，所以只测官服发现不了。
//!
//! 这个测试对**每一个**明日方舟 uid 都走真实的 `ArknightsService::fetch_player_info`
//! （即绑定/刷新时实际执行的路径），并要求解析成功且关键字段有值。
//!
//! ```powershell
//! $env:AK_PHONE="..."; $env:AK_PASSWORD="..."
//! cargo test --test arknights_diag -- --nocapture --test-threads=1
//! ```

use std::env;
use std::sync::{Arc, Mutex};

use endprotocol_lib::services::arknights_service::ArknightsService;
use endprotocol_lib::services::avatar_cache_service::AvatarCacheService;
use endprotocol_lib::services::config_service::ConfigService;
use endprotocol_lib::services::skland_service::SklandService;
use serde_json::{json, Value};

fn make_skland() -> Arc<SklandService> {
    let config = ConfigService::new().expect("ConfigService::new");
    Arc::new(SklandService::new(Arc::new(Mutex::new(config))))
}

async fn creds() -> Option<(String, String)> {
    let phone = env::var("AK_PHONE").ok()?;
    let password = env::var("AK_PASSWORD").ok()?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .ok()?;

    let v: Value = client
        .post("https://as.hypergryph.com/user/auth/v1/token_by_phone_password")
        .json(&json!({ "phone": phone, "password": password }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let hytoken = v.get("data")?.get("token")?.as_str()?.to_string();

    let v: Value = client
        .post("https://as.hypergryph.com/user/oauth2/v2/grant")
        .json(&json!({ "token": hytoken, "appCode": "4ca99fa6b56cc2ba", "type": 0 }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let code = v.get("data")?.get("code")?.as_str()?.to_string();

    let v: Value = client
        .post("https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code")
        .json(&json!({ "kind": 1, "code": code }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    let d = v.get("data")?;
    Some((
        d.get("cred")?.as_str()?.to_string(),
        d.get("token")?.as_str()?.to_string(),
    ))
}

#[tokio::test]
async fn every_arknights_uid_parses_through_real_service() {
    let Some((cred, token)) = creds().await else {
        eprintln!("跳过：未设置 AK_PHONE / AK_PASSWORD");
        return;
    };
    let skland = make_skland();

    let bindings = skland
        .get_player_binding(&cred, &token)
        .await
        .expect("get_player_binding");
    let roles = SklandService::extract_game_roles(&bindings);
    let ak_roles: Vec<_> = roles.iter().filter(|r| r.game == "arknights").collect();

    assert!(
        !ak_roles.is_empty(),
        "该通行证下没有明日方舟绑定，无法验证（或用错账号了）"
    );
    eprintln!("共 {} 个明日方舟角色待验证", ak_roles.len());

    let avatar = Arc::new(AvatarCacheService::new().expect("avatar cache"));
    let cache_dir = env::temp_dir().join(format!(
        "endprotocol-ak-diag-{}",
        std::process::id()
    ));
    let service =
        ArknightsService::with_cache_dir(skland.clone(), avatar, cache_dir.clone());

    for role in ak_roles {
        let uid = &role.binding_uid;
        eprintln!(
            "\n=== uid={} channel={} channelMasterId={} ===",
            uid, role.channel_name, role.channel_master_id
        );

        // 先看裸响应：接口本身是不是真的给了数据（区分「接口没给」和「我们解析不了」）
        let raw = skland
            .call_skland_api(
                "GET",
                "/api/v1/game/player/info",
                Some(&format!("uid={}", uid)),
                None,
                &cred,
                &token,
                vec![],
            )
            .await
            .expect("player/info");
        assert_eq!(
            raw.get("code").and_then(|c| c.as_i64()),
            Some(0),
            "uid={} 接口业务码非 0",
            uid
        );
        let raw_level = raw["data"]["status"]["level"].as_i64().unwrap_or(0);
        eprintln!(
            "  接口原始: name={:?} level={} chars={}",
            raw["data"]["status"]["name"],
            raw_level,
            raw["data"]["chars"].as_array().map(|a| a.len()).unwrap_or(0)
        );
        assert!(raw_level > 0, "uid={} 接口本身就返回 level=0", uid);

        // ★ 走真实服务：这一步就是绑定/刷新时执行的路径。
        // 之前 B 服就是因为 training.remainPoint 是浮点而在这里 Err。
        let info = service
            .fetch_player_info(&cred, &token, uid)
            .await
            .unwrap_or_else(|error| {
                panic!(
                    "uid={} 走真实服务解析失败（接口 code=0 说明数据是好的，\
                     是我们模型字段类型对不上）: {}",
                    uid, error
                )
            });

        eprintln!(
            "  ✅ 解析: name={:?} level={} chars={} avatar={:?}",
            info.status.name,
            info.status.level,
            info.chars.len(),
            info.status.avatar.as_ref().map(|a| a.url.clone())
        );

        // 解析出来的值必须与接口原始值一致（不能因为某字段解析失败而静默降级为 0）
        assert_eq!(
            info.status.level as i64, raw_level,
            "uid={} 解析后 level 与接口原始值不一致",
            uid
        );
        assert!(!info.status.name.is_empty(), "uid={} 昵称解析为空", uid);
        assert!(
            info.status.avatar.is_some(),
            "uid={} 头像解析为空（明日方舟头像只能在 status.avatar）",
            uid
        );
        assert!(
            !info.chars.is_empty(),
            "uid={} 干员列表解析为空",
            uid
        );

        // 基建：hire / training 有空/非空两种形态，两种都必须能解析
        eprintln!(
            "  基建: labor={} hire={} training={} (training.speed/trainee 常有浮点)",
            info.building.labor.is_some(),
            info.building.hire.is_some(),
            info.building.training.as_ref().map(|t| format!(
                "speed={} remainPoint={} remainSecs={} trainee={}",
                t.speed,
                t.remain_point,
                t.remain_secs,
                t.trainee.is_some()
            )).unwrap_or_else(|| "null".to_string())
        );
    }

    let _ = std::fs::remove_dir_all(&cache_dir);
}

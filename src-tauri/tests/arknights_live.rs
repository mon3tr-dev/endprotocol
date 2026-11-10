//! 《明日方舟》数据链路的**真实联网**集成测试。
//!
//! 默认跳过：只有在设置了以下环境变量时才运行（凭据**绝不写进仓库**）。
//!
//! ```powershell
//! $env:AK_PHONE="..."; $env:AK_PASSWORD="..."   # 或
//! $env:AK_CRED="..."; $env:AK_TOKEN="..."       # 跳过登录，直接给 cred/token
//! cargo test --test arknights_live -- --nocapture --test-threads=1
//! ```
//!
//! 验证目标是「真实数据能拉下来、字段路径与我们的模型完全对齐」：
//! 1. 登录链路（hytoken → grant → generate_cred_by_code）能拿到 cred/token
//! 2. `player/binding` 里能识别出 `appCode == arknights` 的绑定，且其 `roles[]` 为空
//!    （**明日方舟的角色信息在 bindingList 这一层，不在 roles 里**）
//! 3. `player/info` 的关键字段路径全部存在且类型正确
//! 4. `cultivate` / `attendance` 的字段路径同样正确
//! 5. **关键回归点**：`building.hire` / `building.training` 允许为 null
//!    （skland-api 在 `recruit.py:38` 就是因为没判空而崩）
//!
//! 这里刻意用 `serde_json::Value` 而不是 crate 内部模型类型：`models` 模块是私有的，
//! 而这些断言本质上是在**校验字段路径**，用 Value 反而更直白。

use std::env;
use std::sync::{Arc, Mutex};

use endprotocol_lib::services::config_service::ConfigService;
use endprotocol_lib::services::skland_service::SklandService;
use serde_json::{json, Value};

/// 构造一个可用的 SklandService（dId 需要 ConfigService 缓存）
fn make_skland() -> Arc<SklandService> {
    let config = ConfigService::new().expect("ConfigService::new");
    Arc::new(SklandService::new(Arc::new(Mutex::new(config))))
}

/// 取凭据：优先 cred/token，其次手机号密码走完整登录链。
///
/// 登录链与 app 内 `AccountService::complete_login_from_token` 完全一致：
/// `token_by_phone_password` → `oauth2/v2/grant`(appCode 4ca99fa6b56cc2ba, type 0)
/// → `generate_cred_by_code`(kind 1)。
async fn obtain_credentials() -> Option<(String, String)> {
    if let (Ok(cred), Ok(token)) = (env::var("AK_CRED"), env::var("AK_TOKEN")) {
        if !cred.is_empty() && !token.is_empty() {
            eprintln!("使用环境变量 AK_CRED / AK_TOKEN");
            return Some((cred, token));
        }
    }

    let phone = env::var("AK_PHONE").ok()?;
    let password = env::var("AK_PASSWORD").ok()?;
    if phone.is_empty() || password.is_empty() {
        return None;
    }
    eprintln!("使用环境变量 AK_PHONE / AK_PASSWORD 登录");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .ok()?;

    // Step 1: 密码 → hytoken
    let v: Value = client
        .post("https://as.hypergryph.com/user/auth/v1/token_by_phone_password")
        .json(&json!({ "phone": phone, "password": password }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    assert_eq!(
        v.get("status").and_then(|s| s.as_i64()),
        Some(0),
        "密码登录失败: {}",
        v
    );
    let hytoken = v.get("data")?.get("token")?.as_str()?.to_string();

    // Step 2: hytoken → code
    let v: Value = client
        .post("https://as.hypergryph.com/user/oauth2/v2/grant")
        .json(&json!({ "token": hytoken, "appCode": "4ca99fa6b56cc2ba", "type": 0 }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    assert_eq!(
        v.get("status").and_then(|s| s.as_i64()),
        Some(0),
        "OAuth grant 失败: {}",
        v
    );
    let code = v.get("data")?.get("code")?.as_str()?.to_string();

    // Step 3: code → cred + token
    let v: Value = client
        .post("https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code")
        .json(&json!({ "kind": 1, "code": code }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    assert_eq!(
        v.get("code").and_then(|s| s.as_i64()),
        Some(0),
        "generate_cred_by_code 失败: {}",
        v
    );
    let data = v.get("data")?;
    Some((
        data.get("cred")?.as_str()?.to_string(),
        data.get("token")?.as_str()?.to_string(),
    ))
}

/// 取一个可用的明日方舟绑定 uid，并**端到端验证角色识别**。
///
/// 这里的关键回归点：明日方舟的 `bindingList[].roles` 是**空数组**，角色信息在
/// `bindingList` 这一层。早先只遍历 `roles` 的抽取逻辑会完全漏掉明日方舟角色
/// （前端表现为「找不到可绑定的明日方舟角色」），所以必须断言
/// `extract_game_roles` 真的产出了明日方舟角色。
async fn first_arknights_uid(
    skland: &SklandService,
    cred: &str,
    token: &str,
) -> Option<(String, String)> {
    let bindings = skland
        .get_player_binding(cred, token)
        .await
        .expect("get_player_binding");

    // ★ 端到端：走真实的抽取函数，而不是在这里手写一份平行逻辑
    let extracted = SklandService::extract_game_roles(&bindings);
    let ak_roles: Vec<_> = extracted
        .iter()
        .filter(|r| r.game == "arknights")
        .collect();

    for role in &ak_roles {
        eprintln!(
            "    [{}] uid={} roleId={} nickName={:?} serverId={}",
            role.channel_name,
            role.binding_uid,
            role.role_id,
            role.nickname,
            role.server_id
        );
    }

    assert!(
        !ak_roles.is_empty(),
        "extract_game_roles 没有识别出任何明日方舟角色 —— \
         说明抽取逻辑又只看了 roles[]（明日方舟的 roles 是空的，角色在 bindingList 层）"
    );

    // 明日方舟没有 roleId，我们用 uid 当角色标识（已由 status.uid 断言背书）
    for role in &ak_roles {
        assert_eq!(
            role.role_id, role.binding_uid,
            "明日方舟角色标识应当是 uid"
        );
        assert!(
            !role.nickname.is_empty(),
            "明日方舟角色昵称（bindingList[].nickName）为空"
        );
        assert!(
            role.server_id == "1" || role.server_id == "2",
            "server_id 应取自 channelMasterId（1=官服 2=B服），实际 {:?}",
            role.server_id
        );
    }

    ak_roles
        .first()
        .map(|role| (role.binding_uid.clone(), role.channel_name.clone()))
}

#[tokio::test]
async fn arknights_player_info_fields_match_models() {
    let skland = make_skland();
    let Some((cred, token)) = obtain_credentials().await else {
        eprintln!("跳过：未设置 AK_CRED/AK_TOKEN 或 AK_PHONE/AK_PASSWORD");
        return;
    };

    let Some((uid, channel)) = first_arknights_uid(&skland, &cred, &token).await else {
        panic!("该通行证下没有明日方舟绑定（appCode == arknights）");
    };

    let json = skland
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
        .unwrap_or_else(|e| panic!("player/info 请求失败 (uid={}): {}", uid, e));
    assert_eq!(
        json.get("code").and_then(|c| c.as_i64()),
        Some(0),
        "player/info 业务码非 0: {}",
        json
    );

    let data = json.get("data").expect("response.data");

    // ---- data 顶层字段 ----
    for key in [
        "status", "chars", "charInfoMap", "recruit", "routine", "campaign", "tower", "building",
    ] {
        assert!(
            data.get(key).is_some(),
            "data.{} 缺失，模型中该字段可能需要调整",
            key
        );
    }

    // ★ 关键不变量：`player/info` 的 `status.uid` 必须等于绑定列表里的 uid。
    // 明日方舟没有 roleId，我们把 **uid 当作角色标识**（`roles[].roleId`），
    // 这个等式不成立的话整套寻址与角色匹配都会错位。
    assert_eq!(
        data["status"]["uid"].as_str(),
        Some(uid.as_str()),
        "player/info 的 status.uid 与绑定 uid 不一致（uid={}）",
        uid
    );

    // ---- status：昵称/等级/理智/头像 ----
    let status = &data["status"];
    let name = status["name"].as_str().expect("status.name 应为字符串");
    let level = status["level"].as_i64().expect("status.level 应为数字");
    assert!(!name.is_empty(), "status.name 为空");
    assert!(level > 0, "status.level 为 0");

    let ap_current = status["ap"]["current"].as_i64().expect("status.ap.current");
    let ap_max = status["ap"]["max"].as_i64().expect("status.ap.max");
    assert!(ap_max > 0, "status.ap.max 为 0");
    assert!(
        status["ap"]["lastApAddTime"].is_i64(),
        "status.ap.lastApAddTime 应为数字"
    );
    assert!(
        status["ap"]["completeRecoveryTime"].is_i64(),
        "status.ap.completeRecoveryTime 应为数字"
    );

    // 头像：明日方舟头像只能从这里拿（终末地的 base.avatarUrl 对它无效）
    let avatar_url = status["avatar"]["url"].as_str().expect("status.avatar.url");
    assert!(
        avatar_url.starts_with("http"),
        "status.avatar.url 不是 http: {}",
        avatar_url
    );
    assert!(status["avatar"]["type"].is_string(), "status.avatar.type");

    eprintln!(
        "[{}] uid={} 昵称={:?} 等级={} 干员={} 理智={}/{} 主线={:?}",
        channel,
        uid,
        name,
        level,
        data["chars"].as_array().map(|a| a.len()).unwrap_or(0),
        ap_current,
        ap_max,
        status["mainStageProgress"].as_str().unwrap_or("")
    );
    eprintln!("    头像: {} ({})", avatar_url, status["avatar"]["type"]);

    // ---- chars[]：干员养成 ----
    let chars = data["chars"].as_array().expect("chars 应为数组");
    if let Some(first) = chars.first() {
        for key in [
            "charId",
            "level",
            "evolvePhase",
            "potentialRank",
            "mainSkillLvl",
            "favorPercent",
            "skills",
        ] {
            assert!(first.get(key).is_some(), "chars[].{{}} 缺失: {}", key);
        }
        let skills = first["skills"].as_array().expect("chars[].skills 应为数组");
        if let Some(skill) = skills.first() {
            assert!(skill.get("id").is_some(), "skills[].id 缺失");
            // ⚠️ player/info 里专精字段名是 specializeLevel（cultivate 里才叫 level）
            assert!(
                skill.get("specializeLevel").is_some(),
                "skills[].specializeLevel 缺失（player/info 的专精字段名）"
            );
        }
        eprintln!("    首个干员: {}", first["charId"].as_str().unwrap_or(""));
    }

    // ---- charInfoMap：charId → 静态信息 ----
    let char_info_map = data["charInfoMap"].as_object().expect("charInfoMap 应为对象");
    if let Some((id, value)) = char_info_map.iter().next() {
        assert!(value.get("name").is_some(), "charInfoMap[].name 缺失");
        assert!(value.get("rarity").is_some(), "charInfoMap[].rarity 缺失");
        eprintln!(
            "    干员表样例: {} => {} (rarity={})",
            id,
            value["name"].as_str().unwrap_or(""),
            value["rarity"]
        );
    }

    // ---- routine / campaign / tower / recruit ----
    assert!(
        data["routine"]["daily"]["total"].as_i64().unwrap_or(0) > 0,
        "routine.daily.total 为 0，结构可能不对"
    );
    assert!(
        data["routine"]["weekly"]["total"].as_i64().unwrap_or(0) > 0,
        "routine.weekly.total 为 0"
    );
    assert!(
        data["campaign"]["reward"]["total"].as_i64().unwrap_or(0) > 0,
        "campaign.reward.total 为 0"
    );
    assert!(
        data["tower"]["reward"]["higherItem"]["total"]
            .as_i64()
            .unwrap_or(0)
            > 0,
        "tower.reward.higherItem.total 为 0"
    );
    assert!(data["recruit"].is_array(), "recruit 应为数组");
    for slot in data["recruit"].as_array().unwrap() {
        assert!(slot.get("state").is_some(), "recruit[].state 缺失");
        assert!(slot.get("finishTs").is_some(), "recruit[].finishTs 缺失");
    }

    eprintln!(
        "    任务: 每日 {}/{} 每周 {}/{}  剿灭 {}/{}  保全 {}/{}  公招栏位={}",
        data["routine"]["daily"]["current"],
        data["routine"]["daily"]["total"],
        data["routine"]["weekly"]["current"],
        data["routine"]["weekly"]["total"],
        data["campaign"]["reward"]["current"],
        data["campaign"]["reward"]["total"],
        data["tower"]["reward"]["higherItem"]["current"],
        data["tower"]["reward"]["higherItem"]["total"],
        data["recruit"].as_array().unwrap().len(),
    );

    // ---- building：★ hire / training 允许为 null（核心回归点）----
    let building = &data["building"];
    eprintln!(
        "    基建: 无人机={} 办公室={} 训练室={} 疲劳干员={}",
        if building["labor"].is_null() { "null" } else { "ok" },
        if building["hire"].is_null() { "null" } else { "ok" },
        if building["training"].is_null() { "null" } else { "ok" },
        building["tiredChars"]
            .as_array()
            .map(|a| a.len())
            .unwrap_or(0)
    );

    // 这两个字段**必须允许为 null**：实测官服账号两者都是 null，
    // skland-api 就是在这里（recruit.py:38）直接下标而崩。
    // 下面断言的是「它们要么是 null，要么结构正确」，而不是「必须有值」。
    if let Some(hire) = building.get("hire").filter(|v| !v.is_null()) {
        assert!(hire.get("refreshCount").is_some(), "hire.refreshCount 缺失");
        assert!(
            hire.get("completeWorkTime").is_some(),
            "hire.completeWorkTime 缺失"
        );
    } else {
        eprintln!("      → hire 为 null（办公室未建造），我们的模型用 Option 接住了");
    }

    if let Some(training) = building.get("training").filter(|v| !v.is_null()) {
        assert!(training.get("speed").is_some(), "training.speed 缺失");
        assert!(
            training.get("remainPoint").is_some(),
            "training.remainPoint 缺失"
        );
        assert!(training.get("remainSecs").is_some(), "training.remainSecs 缺失");
    } else {
        eprintln!("      → training 为 null（无进行中专精），我们的模型用 Option 接住了");
    }

    // 无人机与疲劳干员是固定结构
    let labor = &building["labor"];
    assert!(labor["value"].is_i64(), "building.labor.value");
    assert!(labor["maxValue"].is_i64(), "building.labor.maxValue");
    assert!(labor["remainSecs"].is_i64(), "building.labor.remainSecs");

    for (facility, key) in [
        ("控制中枢", "control"),
        ("发电站", "powers"),
        ("贸易站", "tradings"),
        ("制造站", "manufactures"),
        ("宿舍", "dormitories"),
        ("会客室", "meeting"),
    ] {
        let value = &building[key];
        assert!(
            value.is_array() || value.is_object(),
            "building.{} 既不是数组也不是对象（{})",
            key,
            facility
        );
    }
}

#[tokio::test]
async fn arknights_cultivate_and_attendance_fields_match_models() {
    let skland = make_skland();
    let Some((cred, token)) = obtain_credentials().await else {
        eprintln!("跳过：未设置凭据");
        return;
    };
    let Some((uid, channel)) = first_arknights_uid(&skland, &cred, &token).await else {
        panic!("没有可用的明日方舟 uid");
    };

    // ---- cultivate：干员 + 仓库 ----
    let json = skland
        .call_skland_api(
            "GET",
            "/api/v1/game/cultivate/player",
            Some(&format!("uid={}", uid)),
            None,
            &cred,
            &token,
            vec![],
        )
        .await
        .expect("cultivate 请求");
    assert_eq!(
        json.get("code").and_then(|c| c.as_i64()),
        Some(0),
        "cultivate 业务码非 0: {}",
        json
    );
    let data = &json["data"];
    assert!(data["characters"].is_array(), "cultivate.characters 应为数组");
    let items = data["items"].as_array().expect("cultivate.items 应为数组");

    if let Some(item) = items.first() {
        // count 是**字符串**（"56"），别改成数字
        let count = item["count"].as_str().expect("items[].count 应为字符串");
        assert!(
            count.parse::<i64>().is_ok(),
            "items[].count 应为可解析的字符串，实际 {:?}",
            count
        );
        assert!(item["id"].is_string(), "items[].id 应为字符串");
        eprintln!("    首个仓库物品: id={} count={}", item["id"], count);
    }

    // cultivate 的专精字段名是 level（与 player/info 的 specializeLevel 不同）
    if let Some(char) = data["characters"].as_array().and_then(|a| a.first()) {
        if let Some(skill) = char["skills"].as_array().and_then(|a| a.first()) {
            assert!(
                skill.get("level").is_some(),
                "cultivate skills[].level 缺失（该接口用 level，不是 specializeLevel）"
            );
        }
        eprintln!(
            "    cultivate 首个干员: {} lv={} 精英={}",
            char["id"].as_str().unwrap_or(""),
            char["level"],
            char["evolvePhase"]
        );
    }
    eprintln!(
        "cultivate [{}]: 干员={} 仓库条目={}",
        channel,
        data["characters"].as_array().map(|a| a.len()).unwrap_or(0),
        items.len()
    );

    // ---- attendance：签到状态 ----
    let json = skland
        .call_skland_api(
            "GET",
            "/api/v1/game/attendance",
            Some(&format!("uid={}", uid)),
            None,
            &cred,
            &token,
            vec![],
        )
        .await
        .expect("attendance 请求");
    assert_eq!(
        json.get("code").and_then(|c| c.as_i64()),
        Some(0),
        "attendance 业务码非 0: {}",
        json
    );
    let data = &json["data"];
    let calendar = data["calendar"].as_array().expect("attendance.calendar");
    assert!(!calendar.is_empty(), "签到日历为空，结构可能不对");
    for entry in calendar {
        assert!(entry["resourceId"].is_string(), "calendar[].resourceId");
        assert!(entry["done"].is_boolean(), "calendar[].done");
        assert!(entry["available"].is_boolean(), "calendar[].available");
    }

    if let Some(record) = data["records"].as_array().and_then(|a| a.last()) {
        // ts 是字符串时间戳
        let ts = record["ts"].as_str().expect("records[].ts 应为字符串");
        assert!(ts.parse::<i64>().is_ok(), "records[].ts 应可解析为整数");
        eprintln!("    最近签到: ts={} 物品={}", ts, record["resourceId"]);
    }

    // resourceInfoMap：物品 id → 名称（签到奖励展示要用）
    let resource_map = data["resourceInfoMap"]
        .as_object()
        .expect("attendance.resourceInfoMap 应为对象");
    if let Some((id, value)) = resource_map.iter().next() {
        let name = value["name"].as_str().unwrap_or("");
        assert!(!name.is_empty(), "resourceInfoMap 里的物品缺少 name");
        eprintln!("    物品表样例: {} => {}", id, name);
    }

    eprintln!(
        "attendance [{}]: 日历={} 已签到记录={} 物品表={}",
        channel,
        calendar.len(),
        data["records"].as_array().map(|a| a.len()).unwrap_or(0),
        resource_map.len()
    );
}

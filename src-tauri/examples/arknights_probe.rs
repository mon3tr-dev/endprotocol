//! 明日方舟数据探针（一次性调试工具，不参与 app 运行）
//!
//! 用途：拿到 `GET /api/v1/game/player/info?uid=` 的**真实**返回，确认字段结构后再建模。
//!
//! 用法（凭据只从命令行/环境变量读，绝不落盘）：
//! ```powershell
//! $env:AK_PHONE="..."; $env:AK_PASSWORD="..."
//! cargo run --example arknights_probe -- --out F:\ak_player_info.json
//! ```
//!
//! 也可以直接给 cred/token/uid 跳过登录：
//! ```powershell
//! cargo run --example arknights_probe -- --cred XXX --token YYY --uid 123 --out out.json
//! ```
//!
//! 走的是与 app 完全相同的链路：密码登录 → OAuth grant → generate_cred_by_code →
//! player/binding → player/info + cultivate。签名头与 `SklandService` 保持一致
//! （platform=1 / vName=1.45.1 / SKLand UA）。

use std::env;
use std::fs;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use hex;
use hmac::{Hmac, KeyInit as _, Mac};
use md5::{Digest, Md5};
use serde_json::{json, Value};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const ORG: &str = "UWXspnCCJN4sfYlNfqps";
const PUB_KEY_DER: &str = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCmxMNr7n8ZeT0tE1R9j/mPixoinPkeM+k4VGIn/s0k7N5rJAfnZ0eMER+QhwFvshzo0LNmeUkpR8uIlU/GEVr8mN28sKmwd2gpygqj0ePnBmOW4v0ZVwbSYK+izkhVFk2V/doLoMbWy6b+UnA8mkjvg0iYWRByfRsK2gdl7llqCwIDAQAB";

/// Skland 签名：MD5(HMAC-SHA256(token, path + payload + ts + header_json))
fn calculate_sign(path: &str, payload: &str, ts: &str, did: &str, token: &str) -> String {
    let header = format!(
        "{{\"platform\":\"1\",\"timestamp\":\"{}\",\"dId\":\"{}\",\"vName\":\"1.45.1\"}}",
        ts, did
    );
    let raw = format!("{}{}{}{}", path, payload, ts, header);
    let mut mac = HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC key");
    mac.update(raw.as_bytes());
    let hmac_hex = hex::encode(mac.finalize().into_bytes());
    hex::encode(Md5::digest(hmac_hex.as_bytes()))
}

fn des_encrypt_3des(key: &str, data: &str) -> String {
    use des::cipher::{BlockCipherEncrypt, KeyInit};
    use des::Des;

    let mut data_bytes = data.as_bytes().to_vec();
    let pad_len = 8 - (data_bytes.len() % 8);
    if pad_len < 8 {
        data_bytes.extend(vec![0u8; pad_len]);
    }
    let cipher = Des::new_from_slice(key.as_bytes()).expect("DES key");
    let mut out = vec![0u8; data_bytes.len()];
    for i in (0..data_bytes.len()).step_by(8) {
        let in_block: &[u8; 8] = (&data_bytes[i..i + 8]).try_into().expect("block");
        let out_block: &mut [u8; 8] = (&mut out[i..i + 8]).try_into().expect("block");
        cipher.encrypt_block_b2b(in_block.into(), out_block.into());
    }
    BASE64.encode(out)
}

/// 数美 dId（与 `SklandService::fetch_new_did` 同算法，这里简化只取 deviceId）
async fn fetch_did() -> Result<String, Box<dyn std::error::Error>> {
    use aes::cipher::{BlockCipherEncrypt, KeyInit};
    use flate2::{Compression, GzBuilder};
    use std::io::Write;

    let uid = uuid::Uuid::new_v4().to_string();
    let pri_id = &Md5::digest(uid.as_bytes());
    let pri_id_hex = hex::encode(pri_id);
    let pri_id16 = &pri_id_hex[..16];

    // RSA 加密 uuid
    use rsa::pkcs8::DecodePublicKey;
    use rsa::{Pkcs1v15Encrypt, RsaPublicKey};
    let pk = RsaPublicKey::from_public_key_der(&BASE64.decode(PUB_KEY_DER)?)?;
    // rsa 0.9 绑 rand_core 0.6，与 rand 0.10 的 ThreadRng 不互通；用它自带的 OsRng
    let mut rng = rsa::rand_core::OsRng;
    let ep = BASE64.encode(pk.encrypt(&mut rng, Pkcs1v15Encrypt, uid.as_bytes())?);

    let now_ms = chrono::Utc::now().timestamp_millis();
    let des_rules: Vec<(&str, &str, &str)> = vec![
        ("ua", "k92crp1t", "bj"),
        ("platform", "pakxhcd2", "gm"),
        ("url", "y95hjkoo", "cf"),
        ("os", "je6vk6t4", "pj"),
        ("rtype", "x8o2h2bl", "lo"),
        ("vpw", "r9924ab5", "ca"),
        ("svm", "fzj3kaeh", "qr"),
        ("trees", "acfs0xo4", "pi"),
        ("appId", "uy7mzc4h", "xx"),
        ("organization", "78moqjfc", "dp"),
    ];
    let rules: std::collections::HashMap<&str, (&str, &str)> = des_rules
        .into_iter()
        .map(|(f, k, o)| (f, (k, o)))
        .collect();

    let target = json!({
        "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
        "platform": "Win32",
        "url": "https://www.skland.com/",
        "os": "web",
        "rtype": "all",
        "smid": "",
        "vpw": uuid::Uuid::new_v4().to_string(),
        "svm": now_ms.to_string(),
        "trees": uuid::Uuid::new_v4().to_string(),
        "appId": "default",
        "organization": ORG,
        "protocol": 102,
        "version": "3.0.0",
    });

    let field_order = [
        "ua",
        "platform",
        "url",
        "os",
        "rtype",
        "vpw",
        "svm",
        "trees",
        "appId",
        "organization",
        "protocol",
        "version",
    ];
    let mut parts: Vec<String> = Vec::new();
    for &f in &field_order {
        if let Some((key, obf)) = rules.get(f) {
            if let Some(v) = target.get(f) {
                let s = if v.is_string() {
                    v.as_str().unwrap().to_string()
                } else {
                    v.to_string()
                };
                parts.push(format!("\"{}\":\"{}\"", obf, des_encrypt_3des(key, &s)));
            }
        } else if let Some(v) = target.get(f) {
            parts.push(format!("\"{}\":{}", f, v));
        }
    }
    let obf_json = format!("{{{}}}", parts.join(","));

    let mut enc = GzBuilder::new()
        .mtime(0)
        .write(Vec::new(), Compression::best());
    enc.write_all(obf_json.as_bytes())?;
    let gz = enc.finish()?;
    let b64 = BASE64.encode(&gz);

    let mut data = b64.into_bytes();
    data.push(0x00);
    let pad = 16 - (data.len() % 16);
    if pad < 16 {
        data.extend(vec![0u8; pad]);
    }

    let cipher = aes::Aes128::new_from_slice(pri_id16.as_bytes())?;
    let iv = b"0102030405060708";
    let mut prev = *iv;
    let mut out = Vec::new();
    for chunk in data.chunks(16) {
        let mut block = [0u8; 16];
        block.copy_from_slice(chunk);
        for i in 0..16 {
            block[i] ^= prev[i];
        }
        let mut enc_block: aes::cipher::array::Array<u8, _> = block.into();
        cipher.encrypt_block(&mut enc_block);
        out.extend_from_slice(&enc_block);
        prev = enc_block.into();
    }

    let payload = json!({
        "appId": "default",
        "compress": 2,
        "data": hex::encode(out),
        "encode": 5,
        "ep": ep,
        "organization": ORG,
        "os": "web"
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://fp-it.portal101.cn/deviceprofile/v4")
        .json(&payload)
        .timeout(std::time::Duration::from_secs(20))
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(format!("fingerprint http {}: {}", status, text).into());
    }
    let v: Value = serde_json::from_str(&text)?;
    if v.get("code").and_then(|c| c.as_i64()) != Some(1100) {
        return Err(format!("fingerprint code != 1100: {}", text).into());
    }
    let dev = v
        .get("detail")
        .and_then(|d| d.get("deviceId"))
        .and_then(|d| d.as_str())
        .ok_or("no deviceId")?;
    Ok(format!("B{}", dev))
}

/// 带签名访问森空岛 API
async fn skland_get(
    client: &reqwest::Client,
    path: &str,
    query: &str,
    cred: &str,
    token: &str,
    did: &str,
) -> Result<Value, Box<dyn std::error::Error>> {
    let ts = chrono::Utc::now().timestamp().to_string();
    let sign = calculate_sign(path, query, &ts, did, token);
    let url = if query.is_empty() {
        format!("https://zonai.skland.com{}", path)
    } else {
        format!("https://zonai.skland.com{}?{}", path, query)
    };

    let resp = client
        .get(&url)
        .header("cred", cred)
        .header("dId", did)
        .header("sign", sign)
        .header("timestamp", &ts)
        .header("platform", "1")
        .header("vName", "1.45.1")
        .header("Content-Type", "application/json")
        .header("Origin", "https://game.skland.com")
        .header("Referer", "https://game.skland.com/")
        .header("X-Requested-With", "com.hypergryph.skland")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Linux; Android 12; PHY110 Build/V417IR; wv) AppleWebKit/537.36 \
             (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Safari/537.36; SKLand/1.54.0",
        )
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await?;

    let status = resp.status();
    let text = resp.text().await?;
    let v: Value = serde_json::from_str(&text).map_err(|_| {
        format!(
            "[{}] non-json (http {}): {}",
            path,
            status,
            &text[..text.len().min(300)]
        )
    })?;
    Ok(v)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let get_arg = |name: &str| -> Option<String> {
        args.iter()
            .position(|a| a == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };

    let out_path = get_arg("--out").unwrap_or_else(|| "arknights_probe.json".to_string());
    let out_dir = get_arg("--out-dir");

    let phone = get_arg("--phone").or_else(|| env::var("AK_PHONE").ok());
    let password = get_arg("--password").or_else(|| env::var("AK_PASSWORD").ok());
    let mut cred = get_arg("--cred").or_else(|| env::var("AK_CRED").ok());
    let mut token = get_arg("--token").or_else(|| env::var("AK_TOKEN").ok());
    let only_uid = get_arg("--uid");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    // ---- 阶段 1：拿 hytoken ----
    if cred.is_none() || token.is_none() {
        let (p, pw) = match (phone.as_ref(), password.as_ref()) {
            (Some(p), Some(pw)) => (p.clone(), pw.clone()),
            _ => {
                return Err("需要 (--cred + --token) 或 (--phone + --password)，或设 AK_PHONE/AK_PASSWORD".into())
            }
        };
        eprintln!("[1/5] 密码登录 ...");
        let v: Value = client
            .post("https://as.hypergryph.com/user/auth/v1/token_by_phone_password")
            .json(&json!({ "phone": p, "password": pw }))
            .send()
            .await?
            .json()
            .await?;
        if v.get("status").and_then(|s| s.as_i64()) != Some(0) {
            return Err(format!("password login failed: {}", v).into());
        }
        let hy = v
            .get("data")
            .and_then(|d| d.get("token"))
            .and_then(|t| t.as_str())
            .ok_or("no token in login response")?
            .to_string();
        eprintln!("[1/5] OK (hytoken len={})", hy.len());

        // ---- 阶段 2：OAuth grant（注意 appCode 用 4ca99fa6b56cc2ba / type 0）----
        eprintln!("[2/5] OAuth grant -> code ...");
        let v: Value = client
            .post("https://as.hypergryph.com/user/oauth2/v2/grant")
            .json(&json!({ "token": hy, "appCode": "4ca99fa6b56cc2ba", "type": 0 }))
            .send()
            .await?
            .json()
            .await?;
        if v.get("status").and_then(|s| s.as_i64()) != Some(0) {
            return Err(format!("grant failed: {}", v).into());
        }
        let code = v
            .get("data")
            .and_then(|d| d.get("code"))
            .and_then(|c| c.as_str())
            .ok_or("no code in grant response")?
            .to_string();

        // ---- 阶段 3：code -> cred/token/userId ----
        eprintln!("[3/5] generate_cred_by_code ...");
        let v: Value = client
            .post("https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code")
            .json(&json!({ "kind": 1, "code": code }))
            .send()
            .await?
            .json()
            .await?;
        if v.get("code").and_then(|c| c.as_i64()) != Some(0) {
            return Err(format!("generate_cred failed: {}", v).into());
        }
        let d = v.get("data").ok_or("no data")?;
        cred = d.get("cred").and_then(|c| c.as_str()).map(str::to_string);
        token = d.get("token").and_then(|c| c.as_str()).map(str::to_string);
        eprintln!(
            "[3/5] OK cred_len={} token_len={} userId={:?}",
            cred.as_ref().map(|s| s.len()).unwrap_or(0),
            token.as_ref().map(|s| s.len()).unwrap_or(0),
            d.get("userId").and_then(|u| u.as_str())
        );
    }

    let cred = cred.ok_or("missing cred")?;
    let token = token.ok_or("missing token")?;

    let did = fetch_did().await?;
    eprintln!("[4/5] dId OK (len={})", did.len());

    // ---- 阶段 4：绑定列表 ----
    let binding = skland_get(
        &client,
        "/api/v1/game/player/binding",
        "",
        &cred,
        &token,
        &did,
    )
    .await?;
    eprintln!("[5/5] binding OK");

    if out_dir.is_some() {
        fs::create_dir_all(out_dir.as_ref().unwrap())?;
        fs::write(
            format!("{}/binding.json", out_dir.as_ref().unwrap()),
            serde_json::to_string_pretty(&binding)?,
        )?;
    }

    // 找出所有明日方舟角色
    //
    // ⚠️ 明日方舟与终末地的结构不一样：它的 `bindingList[].roles` 是**空数组**，
    // 角色信息（uid/nickName）只存在于 bindingList 这一层。终末地才把角色放进 roles[]。
    let mut ak_uids: Vec<(String, String, String, String)> = Vec::new(); // (uid, serverId, roleId, nickname)
    if let Some(list) = binding.get("data").and_then(|d| d.get("list")).and_then(|l| l.as_array()) {
        for game in list {
            let app_code = game.get("appCode").and_then(|c| c.as_str()).unwrap_or("");
            let app_name = game.get("appName").and_then(|c| c.as_str()).unwrap_or("");
            eprintln!("  game: appCode={} appName={}", app_code, app_name);
            if app_code != "arknights" {
                continue;
            }
            if let Some(bl) = game.get("bindingList").and_then(|b| b.as_array()) {
                for b in bl {
                    let uid = b.get("uid").and_then(|u| u.as_str()).unwrap_or("").to_string();
                    let deleted = b.get("isDelete").and_then(|d| d.as_bool()).unwrap_or(false);
                    if deleted || uid.is_empty() {
                        continue;
                    }
                    let channel = b.get("channelName").and_then(|c| c.as_str()).unwrap_or("");
                    let channel_id = b
                        .get("channelMasterId")
                        .and_then(|c| c.as_str())
                        .unwrap_or("")
                        .to_string();
                    let nick = b.get("nickName").and_then(|s| s.as_str()).unwrap_or("");
                    eprintln!(
                        "    [{}] uid={} channelMasterId={} nickName={} roles_len={}",
                        channel,
                        uid,
                        channel_id,
                        nick,
                        b.get("roles").and_then(|r| r.as_array()).map(|r| r.len()).unwrap_or(0)
                    );
                    // 明日方舟：一个 uid = 一个角色，roles[] 为空，用 binding 层信息
                    ak_uids.push((uid.clone(), channel_id, String::new(), nick.to_string()));
                }
            }
        }
    }

    if ak_uids.is_empty() {
        return Err("该通行证下没有绑定明日方舟角色".into());
    }

    // ---- 阶段 5：拉 player/info + cultivate ----
    let mut results = serde_json::Map::new();
    for (uid, channel_id, role_id, nickname) in &ak_uids {
        if let Some(only) = &only_uid {
            if only != uid {
                continue;
            }
        }
        eprintln!(
            "\n=== uid={} channelMasterId={} nickname={} roleId={} ===",
            uid, channel_id, nickname, role_id
        );

        let info = skland_get(
            &client,
            "/api/v1/game/player/info",
            &format!("uid={}", uid),
            &cred,
            &token,
            &did,
        )
        .await?;
        let code = info.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        let msg = info.get("message").and_then(|m| m.as_str()).unwrap_or("");
        eprintln!("  player/info: code={} message={}", code, msg);
        if code != 0 {
            eprintln!("  !! player/info failed, raw head: {}", &info.to_string()[..info.to_string().len().min(300)]);
        }

        let cult = skland_get(
            &client,
            "/api/v1/game/cultivate/player",
            &format!("uid={}", uid),
            &cred,
            &token,
            &did,
        )
        .await?;
        let ccode = cult.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
        eprintln!(
            "  cultivate: code={} message={}",
            ccode,
            cult.get("message").and_then(|m| m.as_str()).unwrap_or("")
        );

        // 附带签到状态
        let att = skland_get(
            &client,
            "/api/v1/game/attendance",
            &format!("uid={}", uid),
            &cred,
            &token,
            &did,
        )
        .await?;
        eprintln!(
            "  attendance: code={} message={}",
            att.get("code").and_then(|c| c.as_i64()).unwrap_or(-1),
            att.get("message").and_then(|m| m.as_str()).unwrap_or("")
        );

        results.insert(
            uid.clone(),
            json!({
                "channelMasterId": channel_id,
                "nickname": nickname,
                "roleId": role_id,
                "playerInfo": info,
                "cultivate": cult,
                "attendance": att,
            }),
        );

        if let Some(dir) = &out_dir {
            fs::create_dir_all(dir)?;
            fs::write(
                format!("{}/player_info_{}.json", dir, uid),
                serde_json::to_string_pretty(&info)?,
            )?;
            fs::write(
                format!("{}/cultivate_{}.json", dir, uid),
                serde_json::to_string_pretty(&cult)?,
            )?;
            fs::write(
                format!("{}/attendance_{}.json", dir, uid),
                serde_json::to_string_pretty(&att)?,
            )?;
        }
    }

    let full = json!({
        "fetchedAt": chrono::Utc::now().to_rfc3339(),
        "results": results,
    });
    fs::write(&out_path, serde_json::to_string_pretty(&full)?)?;
    eprintln!("\n=== 已写入 {} ===", out_path);
    Ok(())
}

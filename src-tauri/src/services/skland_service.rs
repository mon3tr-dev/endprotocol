use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use digest::Digest;
use hmac::{Hmac, Mac};
use md5::Md5;
use rsa::pkcs8::DecodePublicKey;
use rsa::{Pkcs1v15Encrypt, RsaPublicKey};
use serde_json::json;
use sha2::Sha256;
use uuid::Uuid;

use crate::models::account::{
    SklandBackground, SklandGameInfo, SklandPendant, SklandUserInfo, SklandUserStats,
};
use crate::models::char_detail::CharDetailResponse;
use crate::models::role::{
    BindingResponse, GameBinding, GameRoleBinding, GAME_ARKNIGHTS, GAME_ENDFIELD,
};
use crate::services::config_service::ConfigService;
use crate::utils::{api_health, capture, http_client, AppError, SESSION_INVALID_MARKER};
use crate::{log_debug, log_error, log_info, log_warn};

type HmacSha256 = Hmac<Sha256>;

/// è§£æž HTTP `Date` å“åº”å¤´ï¼ˆRFC 7231 ä½¿ç”¨ GMT æ ¼å¼ï¼‰ã€‚
fn parse_http_date(value: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc2822(value)
        .map(|time| time.with_timezone(&Utc))
        .or_else(|_| {
            chrono::DateTime::parse_from_str(value, "%a, %d %b %Y %H:%M:%S GMT")
                .map(|time| time.with_timezone(&Utc))
        })
        .ok()
}

const ORG: &str = "UWXspnCCJN4sfYlNfqps";

/// æŠ½å¡åŸŸ OAuth grant çš„ appCodeï¼ˆ`type: 1`ï¼‰ã€‚ä¸Žæ¢ skland cred çš„ `4ca99fa6b56cc2ba`
/// ï¼ˆ`type: 0`ï¼‰ä¸æ˜¯åŒä¸€ä¸ªï¼Œæ··ç”¨ä¼šç›´æŽ¥æ‹¿ä¸åˆ° tokenã€‚
const U8_GRANT_APP_CODE: &str = "be36d44aa36bfb5b";

/// è´¦å·ç»‘å®šåŸŸåï¼ˆ`binding_list` / `u8_token_by_uid`ï¼‰ã€‚
const BINDING_API_HOST: &str = "binding-api-account-prod.hypergryph.com";
const PUB_KEY_DER: &str = "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCmxMNr7n8ZeT0tE1R9j/mPixoinPkeM+k4VGIn/s0k7N5rJAfnZ0eMER+QhwFvshzo0LNmeUkpR8uIlU/GEVr8mN28sKmwd2gpygqj0ePnBmOW4v0ZVwbSYK+izkhVFk2V/doLoMbWy6b+UnA8mkjvg0iYWRByfRsK2gdl7llqCwIDAQAB";

/// Skland æœåŠ¡
pub struct SklandService {
    config_service: std::sync::Arc<std::sync::Mutex<ConfigService>>,
}

impl SklandService {
    pub fn new(config_service: std::sync::Arc<std::sync::Mutex<ConfigService>>) -> Self {
        Self { config_service }
    }

    /// èŽ·å–æˆ–ç¼“å­˜çš„ dId
    async fn get_or_refresh_did(&self) -> Result<String, AppError> {
        // å°è¯•ä»Žé…ç½®ä¸­èŽ·å–ç¼“å­˜çš„ dId
        let cached_did: Option<String> = {
            let config = self
                .config_service
                .lock()
                .map_err(|e| AppError::ConfigError {
                    message: format!("Lock failed: {}", e),
                })?;
            config.get("did_cache")
        };

        if let Some(did) = cached_did {
            return Ok(did);
        }

        // ç¼“å­˜ä¸å­˜åœ¨ï¼ŒèŽ·å–æ–°çš„ dId
        let new_did = self.fetch_new_did().await?;

        // ä¿å­˜åˆ°é…ç½®
        {
            let mut config = self
                .config_service
                .lock()
                .map_err(|e| AppError::ConfigError {
                    message: format!("Lock failed: {}", e),
                })?;
            config.set("did_cache".to_string(), json!(new_did))?;
        }

        Ok(new_did)
    }

    /// èŽ·å–æ–°çš„ dId - 1:1 å¤åˆ» Python è„šæœ¬
    ///
    /// æ•°ç¾Žè®¾å¤‡æŒ‡çº¹æŽ¥å£ï¼ˆ`fp-it.portal101.cn`ï¼‰å¤±è´¥æ—¶ä¼šæŒ‰
    /// [`api_health::ApiFailureKind::DeviceFingerprint`] è®¡æ•°ï¼šè¿žç»­å¤±è´¥è¾¾åˆ°é˜ˆå€¼åŽ
    /// åˆ¤å®šä¸ºè®¾å¤‡æŒ‡çº¹çŽ¯å¢ƒå¼‚å¸¸ï¼Œå‰ç«¯æ®æ­¤æç¤ºç”¨æˆ·é‡å¯ç”µè„‘å¹¶åŒæ­¥æ—¶åŒºã€‚
    async fn fetch_new_did(&self) -> Result<String, AppError> {
        api_health::ensure_available()?;
        let result = self.fetch_new_did_inner().await;
        if let Err(error) = &result {
            api_health::record_failure(
                api_health::ApiFailureKind::DeviceFingerprint,
                &format!("æ•°ç¾Žè®¾å¤‡æŒ‡çº¹æŽ¥å£è¯·æ±‚å¤±è´¥: {}", error),
                None,
            );
        }
        result
    }

    async fn fetch_new_did_inner(&self) -> Result<String, AppError> {
        // ç”Ÿæˆ uid å’Œ pri_id
        let uid = Uuid::new_v4().to_string();
        let uid_bytes = uid.as_bytes();
        let pri_id = hex::encode(md5::Md5::digest(uid_bytes))[..16].to_string();

        let client = crate::utils::http_client::default_client();

        // RSA åŠ å¯† uid å¾—åˆ° ep
        let pub_key_bytes = BASE64
            .decode(PUB_KEY_DER)
            .map_err(|e| AppError::AuthError {
                message: format!("Failed to decode public key: {}", e),
            })?;
        let rsa_pub_key =
            RsaPublicKey::from_public_key_der(&pub_key_bytes).map_err(|e| AppError::AuthError {
                message: format!("Failed to parse public key: {}", e),
            })?;
        let ep = {
            // rsa 0.9 ä»ç»‘ rand_core 0.6ï¼›rand 0.10 çš„ ThreadRng å®žçŽ°çš„æ˜¯ rand_core
            // 0.10 çš„ traitï¼Œä¸¤è€…ç±»åž‹ä¸äº’é€šã€‚è¿™é‡Œç”¨ rsa è‡ªå¸¦ `rand_core::OsRng`
            //ï¼ˆç³»ç»Ÿç†µæºï¼Œè¯­ä¹‰ä¸ŽåŽŸ thread_rng ä¸€è‡´ï¼‰ã€‚
            let mut rng = rsa::rand_core::OsRng;
            let ep_bytes = rsa_pub_key
                .encrypt(&mut rng, Pkcs1v15Encrypt, uid.as_bytes())
                .map_err(|e| AppError::AuthError {
                    message: format!("RSA encryption failed: {}", e),
                })?;
            BASE64.encode(ep_bytes)
        };

        log_debug!("=== STEP 2: RSA Encryption ===");
        log_debug!("EP_BASE64: {}", ep);
        log_debug!("EP_LENGTH: {}", ep.len());

        // æž„é€ æŒ‡çº¹æ•°æ®ï¼ˆä¸Ž Python å®Œå…¨ä¸€è‡´ï¼‰
        let curr_ms = Utc::now().timestamp_millis();
        let smid_hash = hex::encode(md5::Md5::digest(Uuid::new_v4().to_string().as_bytes()));
        let smid = format!("{}{}00", Utc::now().format("%Y%m%d%H%M%S"), smid_hash);
        let vpw = Uuid::new_v4().to_string();
        let trees = Uuid::new_v4().to_string();

        log_debug!("=== STEP 3: Target Data ===");
        log_debug!("  curr_ms: {}", curr_ms);
        log_debug!("  smid: {}", smid);
        log_debug!("  vpw: {}", vpw);
        log_debug!("  trees: {}", trees);

        // æ‰€æœ‰éœ€è¦æ··æ·†çš„å­—æ®µ
        let mut target = serde_json::Map::new();
        target.insert("ua".to_string(), json!("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0"));
        target.insert("platform".to_string(), json!("Win32"));
        target.insert("url".to_string(), json!("https://www.skland.com/"));
        target.insert("os".to_string(), json!("web"));
        target.insert("rtype".to_string(), json!("all"));
        target.insert("smid".to_string(), json!(smid));
        target.insert("vpw".to_string(), json!(vpw));
        target.insert("svm".to_string(), json!(curr_ms));
        target.insert("trees".to_string(), json!(trees));
        target.insert("pm_f".to_string(), json!(curr_ms));
        target.insert("appId".to_string(), json!("default"));
        target.insert("organization".to_string(), json!(ORG));
        target.insert("protocol".to_string(), json!(102));
        target.insert("version".to_string(), json!("3.0.0"));

        // DES åŠ å¯†è§„åˆ™ï¼ˆä»Ž Python ä»£ç æå–ï¼‰
        let des_rules = vec![
            ("appId", "uy7mzc4h", "xx"),
            ("box", "", "jf"),
            ("canvas", "snrn887t", "yk"),
            ("clientSize", "cpmjjgsu", "zx"),
            ("organization", "78moqjfc", "dp"),
            ("os", "je6vk6t4", "pj"),
            ("platform", "pakxhcd2", "gm"),
            ("plugins", "v51m3pzl", "kq"),
            ("pmf", "2mdeslu3", "vw"),
            ("protocol", "", "protocol"),
            ("referer", "y7bmrjlc", "ab"),
            ("res", "whxqm2a7", "hf"),
            ("rtype", "x8o2h2bl", "lo"),
            ("sdkver", "9q3dcxp2", "sc"),
            ("status", "2jbrxxw4", "an"),
            ("subVersion", "eo3i2puh", "ns"),
            ("svm", "fzj3kaeh", "qr"),
            ("time", "q2t3odsk", "nb"),
            ("timezone", "1uv05lj5", "as"),
            ("tn", "x9nzj1bp", "py"),
            ("trees", "acfs0xo4", "pi"),
            ("ua", "k92crp1t", "bj"),
            ("url", "y95hjkoo", "cf"),
            ("version", "", "version"),
            ("vpw", "r9924ab5", "ca"),
        ];

        // å¯¹æ¯ä¸ªå­—æ®µè¿›è¡Œ DES åŠ å¯†æˆ–ä¿æŒåŽŸæ ·
        let mut obfuscated = serde_json::Map::new();
        log_debug!("=== STEP 4: DES Obfuscation Details ===");

        // åˆ›å»º des_rules çš„æŸ¥æ‰¾è¡¨
        let des_rules_map: std::collections::HashMap<&str, (&str, &str)> = des_rules
            .iter()
            .map(|(field, key, obf)| (*field, (*key, *obf)))
            .collect();

        // æ˜Žç¡®æŒ‰ç…§ Python target çš„å­—æ®µé¡ºåºæ’å…¥ï¼Œä»¥ä¿è¯ JSON é”®é¡ºåºä¸€è‡´
        let field_order = [
            "ua",
            "platform",
            "url",
            "os",
            "rtype",
            "smid",
            "vpw",
            "svm",
            "trees",
            "pm_f",
            "appId",
            "organization",
            "protocol",
            "version",
        ];

        for &field_name in &field_order {
            if let Some(value) = target.get(field_name) {
                if let Some(&(key, obf_name)) = des_rules_map.get(field_name) {
                    if !key.is_empty() {
                        // éœ€è¦ DES åŠ å¯†ï¼Œè½¬æ¢ä¸ºå­—ç¬¦ä¸²åŽåŠ å¯†
                        let value_str = if value.is_string() {
                            value.as_str().unwrap().to_string()
                        } else {
                            value.to_string()
                        };

                        let enc = des_encrypt_3des(key, &value_str)?;
                        log_debug!(
                            "DES Encrypt - Field: {}, Key: {}, ObfName: {}",
                            field_name,
                            key,
                            obf_name
                        );
                        log_debug!("  Original: {}", value_str);
                        log_debug!("  Encrypted: {}", enc);

                        obfuscated.insert(obf_name.to_string(), serde_json::Value::String(enc));
                    } else {
                        // ä¸éœ€è¦åŠ å¯†ï¼Œä¿æŒåŽŸå§‹ç±»åž‹
                        log_debug!(
                            "Keep Original - Field: {}, ObfName: {}, Value: {}",
                            field_name,
                            obf_name,
                            value
                        );

                        obfuscated.insert(obf_name.to_string(), value.clone());
                    }
                }
            }
        }

        // æ‰‹åŠ¨æ ¹æ® field_order æž„å»º JSON å­—ç¬¦ä¸²ä»¥ç¡®ä¿é”®é¡ºåºä¸Ž Python å®Œå…¨ä¸€è‡´
        let mut parts: Vec<String> = Vec::new();
        for &field_name in &field_order {
            if let Some(&(_key, obf_name)) = des_rules_map.get(field_name) {
                if let Some(val) = obfuscated.get(obf_name) {
                    let val_json = serde_json::to_string(val)?;
                    parts.push(format!("\"{}\":{}", obf_name, val_json));
                }
            }
        }
        let obfuscated_json = format!("{{{}}}", parts.join(","));

        log_debug!("=== STEP 5: JSON Serialization ===");
        log_debug!("JSON_LENGTH: {}", obfuscated_json.len());
        log_debug!("JSON_HEX: {}", hex::encode(obfuscated_json.as_bytes()));

        // Gzip åŽ‹ç¼©ï¼Œä½¿ç”¨ GzBuilder å¹¶å›ºå®š mtime=0ï¼ŒåŒ¹é… Python gzip.compress(..., mtime=0)
        use flate2::Compression;
        use flate2::GzBuilder;
        use std::io::Write;

        let mut encoder = GzBuilder::new()
            .mtime(0)
            .write(Vec::new(), Compression::best());
        encoder.write_all(obfuscated_json.as_bytes())?;
        let compressed = encoder.finish()?;
        let base64_gzip = BASE64.encode(&compressed);

        log_debug!("=== STEP 6: Gzip Compression ===");
        log_debug!("GZIP_LENGTH: {}", compressed.len());
        log_debug!("GZIP_BASE64_LENGTH: {}", base64_gzip.len());

        // AES-128-CBC åŠ å¯†ï¼ˆç‰¹æ®Šå¡«å……ï¼šå…ˆåŠ  \x00ï¼Œå†è¡¥åˆ°16å­—èŠ‚å€æ•°ï¼‰
        // cipher 0.5ï¼š`BlockEncrypt` æ›´å `BlockCipherEncrypt`ï¼›`generic_array`
        // æ¨¡å—æ›´å `array`ï¼ˆhybrid-arrayï¼Œ`Array` ç±»åž‹ + `From<&[u8; N]>`ï¼‰ã€‚
        use aes::cipher::{BlockCipherEncrypt, KeyInit};

        let mut data = base64_gzip.as_bytes().to_vec();
        data.push(0x00); // å…³é”®ç‚¹ï¼šå…ˆæ·»åŠ ä¸€ä¸ª \x00
        let pad_len = 16 - (data.len() % 16);
        if pad_len < 16 {
            data.extend(vec![0u8; pad_len]);
        }

        let aes_key = pri_id.as_bytes();
        let iv = b"0102030405060708";
        let cipher = aes::Aes128::new_from_slice(aes_key).map_err(|e| AppError::AuthError {
            message: format!("AES key error: {}", e),
        })?;

        // æ‰‹åŠ¨å®žçŽ° CBC æ¨¡å¼ï¼ˆä¸Ž Python å’Œæµ‹è¯•ä»£ç ä¸€è‡´ï¼‰
        let mut prev_block = *iv;
        let mut result = Vec::new();

        for chunk in data.chunks(16) {
            let mut block = [0u8; 16];
            block.copy_from_slice(chunk);

            // XOR with previous ciphertext
            for i in 0..16 {
                block[i] ^= prev_block[i];
            }

            let mut encrypted: aes::cipher::array::Array<u8, _> =
                block.into();
            cipher.encrypt_block(&mut encrypted);

            result.extend_from_slice(&encrypted);
            prev_block = encrypted.into();
        }

        let aes_data = hex::encode(result);
        log_debug!("AES data length: {}", aes_data.len());

        // è¯·æ±‚æ•°ç¾ŽæŽ¥å£
        let payload = json!({
            "appId": "default",
            "compress": 2,
            "data": aes_data,
            "encode": 5,
            "ep": ep,
            "organization": ORG,
            "os": "web"
        });

        log_info!("=== HTTP REQUEST: æ•°ç¾Žè®¾å¤‡æŒ‡çº¹ ===");
        log_info!("Method: POST");
        log_info!("URL: https://fp-it.portal101.cn/deviceprofile/v4");

        let start_time = std::time::Instant::now();
        let resp = capture::send(
            &client,
            client
                .post("https://fp-it.portal101.cn/deviceprofile/v4")
                .json(&payload),
        )
        .await?;
        let elapsed = start_time.elapsed();

        let status = resp.status();
        let resp_headers = resp.headers().clone();
        let resp_text = resp.text().await?;

        log_info!("=== HTTP RESPONSE: æ•°ç¾Žè®¾å¤‡æŒ‡çº¹ ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }
        log_debug!("Response Body: {}", resp_text);

        let resp_json: serde_json::Value =
            serde_json::from_str(&resp_text).map_err(|e| AppError::AuthError {
                message: format!("Failed to parse response as JSON: {}", e),
            })?;

        // æ‰“å°å®Œæ•´çš„å“åº”ç”¨äºŽè°ƒè¯•
        log_debug!("æ•°ç¾ŽæŽ¥å£å®Œæ•´å“åº”: {}", resp_text);

        // æ£€æŸ¥æ˜¯å¦æœ‰é”™è¯¯ç ï¼ˆæ³¨æ„ï¼šæ•°ç¾ŽæŽ¥å£æŸäº›éž0ç ä¹Ÿå¯èƒ½æˆåŠŸï¼Œå¦‚1100ï¼‰
        // åªæœ‰å½“æ²¡æœ‰deviceIdå­—æ®µæ—¶æ‰è®¤ä¸ºå¤±è´¥
        let has_device_id = resp_json
            .get("detail")
            .and_then(|d| d.get("deviceId").or_else(|| d.get("device_id")))
            .or_else(|| {
                resp_json
                    .get("data")
                    .and_then(|d| d.get("deviceId").or_else(|| d.get("device_id")))
            })
            .or_else(|| {
                resp_json
                    .get("deviceId")
                    .or_else(|| resp_json.get("device_id"))
            })
            .is_some();

        if !has_device_id {
            // å¦‚æžœæ²¡æœ‰deviceIdï¼Œæ‰æ£€æŸ¥é”™è¯¯ç 
            if let Some(code) = resp_json.get("code").and_then(|c| c.as_i64()) {
                return Err(AppError::AuthError {
                    message: format!("æ•°ç¾ŽæŽ¥å£è¿”å›žé”™è¯¯ç  {}: {}", code, resp_text),
                });
            }
        }

        // å°è¯•å¤šç§å¯èƒ½çš„å“åº”ç»“æž„
        let device_id = resp_json
            .get("detail")
            .and_then(|d| d.get("deviceId").or_else(|| d.get("device_id")))
            .or_else(|| {
                resp_json
                    .get("data")
                    .and_then(|d| d.get("deviceId").or_else(|| d.get("device_id")))
            })
            .or_else(|| {
                resp_json
                    .get("deviceId")
                    .or_else(|| resp_json.get("device_id"))
            })
            .and_then(|id| id.as_str())
            .ok_or_else(|| AppError::AuthError {
                message: format!("deviceId not found in response. Response: {}", resp_text),
            })?;

        Ok(format!("B{}", device_id))
    }

    /// è®¡ç®—æ£®ç©ºå²›ç‰¹å®šçš„ Sign
    fn calculate_sign(&self, path: &str, body: &str, ts: &str, did: &str, token: &str) -> String {
        // æž„é€  header JSON å­—ç¬¦ä¸²ï¼ˆæŒ‰ Python çš„é”®é¡ºåºå’Œç´§å‡‘æ ¼å¼ï¼‰
        let h_ca_str = format!(
            "{{\"platform\":\"1\",\"timestamp\":\"{}\",\"dId\":\"{}\",\"vName\":\"1.45.1\"}}",
            ts, did
        );

        // 1. æ‹¼æŽ¥åŽŸå§‹å­—ç¬¦ä¸²: path + body + ts + header_json
        let raw_data = format!("{}{}{}{}", path, body, ts, h_ca_str);

        // Debug: print the exact inputs used to compute the sign
        log_debug!("calculate_sign header_json: {}", h_ca_str);
        log_debug!("calculate_sign raw: {}", raw_data);

        // 2. HMAC-SHA256ï¼ˆdigest 0.11ï¼š`KeyInit` éœ€æ˜¾å¼å¯¼å…¥ï¼‰
        use hmac::KeyInit as _;
        let mut mac = HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC key error");
        mac.update(raw_data.as_bytes());
        let hmac_res = hex::encode(mac.finalize().into_bytes());

        log_debug!("calculate_sign hex_hmac: {}", hmac_res);

        // 3. MD5ï¼ˆdigest 0.11 çš„è¾“å‡ºä¸º hybrid-arrayï¼Œä¸å®žçŽ° LowerHexï¼Œæ”¹ç”¨ hex::encodeï¼‰
        let digest = Md5::digest(hmac_res.as_bytes());
        let md5_hex = hex::encode(digest);
        log_debug!("calculate_sign md5: {}", md5_hex);

        md5_hex
    }

    /// æž„å»ºé€šç”¨çš„ Skland HTTP è¯·æ±‚
    fn build_skland_request(
        &self,
        client: &reqwest::Client,
        method: &str,
        url: &str,
        cred: &str,
        did: &str,
        sign: &str,
        ts: &str,
    ) -> reqwest::RequestBuilder {
        let request = if method == "GET" {
            client.get(url)
        } else {
            client.post(url)
        };

        request
            .header("cred", cred)
            .header("dId", did)
            .header("sign", sign)
            .header("timestamp", ts)
            .header("platform", "1")
            .header("vName", "1.45.1")
            .header("Content-Type", "application/json")
            .header("Origin", "https://game.skland.com")
            .header("Referer", "https://game.skland.com/")
            .header("X-Requested-With", "com.hypergryph.skland")
            .header(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 12; PHY110 Build/V417IR; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.154 Safari/537.36; SKLand/1.54.0",
            )
    }

    /// é‡æ–°ç”³è¯· dId å¹¶**å†™å›žç¼“å­˜**ã€‚
    ///
    /// æ—§å®žçŽ°ï¼ˆ`config.remove("did_cache")` + `fetch_new_did`ï¼‰åªæ¢äº†æœ¬æ¬¡è¯·æ±‚ç”¨çš„
    /// dIdï¼Œå´æ²¡æœ‰å†™å›žç¼“å­˜ â€”â€” äºŽæ˜¯ä¸‹ä¸€æ¬¡è°ƒç”¨åˆè¯»ä¸åˆ°ç¼“å­˜ã€åˆåŽ»æ•°ç¾Žæ¢ä¸€æŠŠæ–°çš„ã€‚
    /// ç»“æžœæ˜¯ä¸€æ¬¡ 401 ä¹‹åŽ**æ¯æ¬¡è¯·æ±‚éƒ½è¦å¤šä»˜ä¸€æ¬¡æŒ‡çº¹ç”³è¯·**ï¼Œä¸” dId æ°¸ä¸ç¨³å®šã€‚
    async fn rotate_did(&self) -> Result<String, AppError> {
        {
            let mut config = self.config_service.lock().map_err(|e| AppError::ConfigError {
                message: format!("Lock failed: {}", e),
            })?;
            config.remove("did_cache");
        }
        let new_did = self.fetch_new_did().await?;
        {
            let mut config = self.config_service.lock().map_err(|e| AppError::ConfigError {
                message: format!("Lock failed: {}", e),
            })?;
            config.set("did_cache".to_string(), json!(new_did))?;
        }
        Ok(new_did)
    }

    /// ç»Ÿä¸€çš„ Skland API è°ƒç”¨å…¥å£
    ///
    /// è‡ªåŠ¨å¤„ç†ï¼š
    /// - dId èŽ·å–/ç¼“å­˜/å¤±æ•ˆè½®æ¢ï¼ˆ**è½®æ¢åŽå†™å›žç¼“å­˜**ï¼Œé¿å…æ¯æ¬¡è¯·æ±‚éƒ½é‡ç”³è¯·æŒ‡çº¹ï¼‰
    /// - timestamp ç”Ÿæˆ
    /// - sign è®¡ç®—ï¼ˆHMAC-SHA256 + MD5ï¼‰
    /// - è®¤è¯ header æ³¨å…¥ï¼ˆcredã€dIdã€signã€timestampã€User-Agent ç­‰ï¼‰
    /// - è¯·æ±‚æ—¥å¿—è®°å½•
    /// - JSON è§£æž + code != 0 é”™è¯¯æ£€æŸ¥ï¼ˆå·²çŸ¥å¹‚ç­‰ç»“æžœå¦‚ã€Œè¯·å‹¿é‡å¤ç­¾åˆ°ã€é™¤å¤–ï¼‰
    /// - **ä¼šè¯å¤±æ•ˆè‡ªæ„ˆ**ï¼šæ•°æ®æŽ¥å£è¿”å›ž `code=10000 è¯·æ±‚å¼‚å¸¸` æ—¶ï¼Œå°±åœ°ç”¨è¯¥è´¦å·çš„
    ///   `hytoken` æ¢ä¸€æŠŠæ–° credï¼ˆè§ [`crate::services::cred_recovery`]ï¼‰å†é‡è¯•ä¸€æ¬¡
    ///
    /// # ä¸ºä»€ä¹ˆéœ€è¦ä¼šè¯è‡ªæ„ˆ
    ///
    /// æœåŠ¡ç«¯è½®æ¢ä¼šè¯åŽï¼Œ`/api/v1/user/check` ä¾æ—§è¿”å›ž `code=0`ï¼Œåªæœ‰æ•°æ®æŽ¥å£æ‹’ç»ã€‚
    /// å› æ­¤ `check_and_refresh_user_cred` æ°¸è¿œåˆ¤å®šã€Œcred æœ‰æ•ˆã€ã€æ°¸ä¸åˆ·æ–°ï¼›éšåŽæ¯ä¸ª
    /// è§’è‰²éƒ½æ’ž 401 â†’ è¿žç»­å¤±è´¥æµ‡æ»¡ç†”æ–­è®¡æ•° â†’ æ‰€æœ‰è´¦å·ä¸€èµ·å˜ã€Œè´¦å·ä¸å¯ç”¨ã€ã€‚
    /// ç”¨æˆ·å”¯æœ‰é‡æ–°ç™»å½•æ‰èƒ½æ¢å¤ï¼Œå› ä¸ºåªæœ‰é‚£æ¡è·¯å¾„çœŸçš„é‡èµ°äº†
    /// `hytoken â†’ generate_cred_by_code`ã€‚è¿™é‡ŒæŠŠåŒä¸€ä¸ªåŠ¨ä½œåšè¿›è¯·æ±‚å±‚ï¼Œæ•…éšœçª—å£
    /// ä»Žã€Œå¿…é¡»é‡æ–°ç™»å½•ã€æ”¶æ•›æˆã€Œä¸€æ¬¡é¢å¤–è¯·æ±‚ã€ã€‚
    ///
    /// # å‚æ•°
    /// - `method` - "GET" æˆ– "POST"
    /// - `path` - API è·¯å¾„ï¼ˆå¦‚ `/api/v1/game/endfield/card/detail`ï¼‰
    /// - `query` - GET è¯·æ±‚çš„ query stringï¼ˆå¦‚ `"roleId=xxx&serverId=yyy"`ï¼‰ï¼ŒPOST ä¼  `None`
    /// - `body` - POST è¯·æ±‚çš„ JSON bodyï¼ŒGET ä¼  `None`
    /// - `cred` - è®¤è¯å‡­è¯
    /// - `token` - ç­¾å token
    ///
    /// # è¿”å›ž
    /// è§£æžåŽçš„å®Œæ•´ JSON å“åº”ï¼ˆ`code == 0`ï¼›æˆ– [`api_health::is_benign_business_error`]
    /// åˆ¤å®šä¸ºå¹‚ç­‰æˆåŠŸçš„ä¸šåŠ¡ç ï¼Œæ­¤æ—¶è°ƒç”¨æ–¹éœ€è‡ªè¡Œè¯†åˆ« `code`ï¼‰
    pub async fn call_skland_api(
        &self,
        method: &str,
        path: &str,
        query: Option<&str>,
        body: Option<serde_json::Value>,
        cred: &str,
        token: &str,
        extra_headers: Vec<(String, String)>,
    ) -> Result<serde_json::Value, AppError> {
        let client = http_client::create_client();
        let mut last_err: Option<AppError> = None;

        // æœ¬æ¬¡è°ƒç”¨å®žé™…ä½¿ç”¨çš„å‡­æ®ï¼šä¼šè¯å¤±æ•ˆæ—¶ä¼šå°±åœ°æ¢æˆæ–°çš„ä¸€å¯¹ã€‚
        let mut cred = cred.to_string();
        let mut token = token.to_string();
        // å·²ç»ç”¨è¿‡ã€Œæ¢ credã€è¿™æ¡ä¿®å¤è·¯å¾„ï¼Œä¸å†é‡å¤è§¦å‘ï¼ˆé¿å…æ¢å‡ºä¸€å †å‡­æ®ï¼‰ã€‚
        let mut cred_refreshed = false;
        // æ˜¯å¦è½®æ¢ dIdã€‚**åªåœ¨ä¸Žè®¾å¤‡æŒ‡çº¹/ç­¾åç›¸å…³çš„å¤±è´¥åŽè½®æ¢**ï¼š
        // ä¼šè¯å¤±æ•ˆä¸Ž dId æ— å…³ï¼Œä¸ºå®ƒå¤šç”³è¯·ä¸€æ¬¡æŒ‡çº¹æ¯«æ— æ„ä¹‰ï¼Œè¿˜ä¼šç™½ç™½æ¶ˆè€—æ•°ç¾ŽæŽ¥å£
        // ï¼ˆé‚£æ¡é“¾è·¯æœ‰è‡ªå·±çš„ç†”æ–­é˜ˆå€¼ 3ï¼‰ã€‚
        let mut need_did_rotation = false;

        // æœ€å¤š 3 è½®ï¼š
        // 0) ç¼“å­˜ dId + åŽŸ cred â€”â€” æ­£å¸¸è·¯å¾„
        // 1) è½®æ¢ dId â€”â€” dId è¢«æœåŠ¡å™¨åˆ¤æ— æ•ˆ
        // 2) ä¼šè¯å·²å¤±æ•ˆæ—¶å·²æ¢æˆæ–° cred â€”â€” ç”¨æ–°å‡­æ®å†è¯•ä¸€æ¬¡
        for attempt in 0..3 {
            // ç†”æ–­å®ˆå«ï¼šè‹¥æœ¬æ¬¡è°ƒç”¨å·²ç»æ‹¿åˆ°è¿‡å…·ä½“é”™è¯¯ï¼ˆä¾‹å¦‚åˆšåˆšæ¢ cred å¤±è´¥åŽçš„
            // SESSION_INVALIDï¼‰ï¼Œä¼˜å…ˆæŠŠé‚£ä¸ªåŽŸå› è¿”å›žç»™ä¸Šå±‚ â€”â€” å¦åˆ™æ¢å¤å¤±è´¥çš„çœŸæ­£
            // åŽŸå› ä¼šè¢« "API requests are paused" è¦†ç›–ï¼Œæ—¥å¿—é‡Œåªå‰©ä¸‹ä¸€å¥ç¬¼ç»Ÿçš„ç†”æ–­ã€‚
            if let Err(paused) = api_health::ensure_available() {
                return Err(last_err.unwrap_or(paused));
            }

            let did = if attempt == 0 {
                match self.get_or_refresh_did().await {
                    Ok(d) => d,
                    Err(e) => {
                        // æ•°ç¾Žè®¾å¤‡æŒ‡çº¹å¤±è´¥å·²åœ¨ fetch_new_did å†…æŒ‰ DeviceFingerprint è®¡æ•°ï¼Œ
                        // è¿™é‡Œä¸å†é‡å¤è®¡å…¥ Networkã€‚
                        last_err = Some(e);
                        continue;
                    }
                }
            } else if need_did_rotation {
                need_did_rotation = false;
                match self.rotate_did().await {
                    Ok(d) => d,
                    Err(e) => {
                        last_err = Some(e);
                        continue;
                    }
                }
            } else {
                // ä¼šè¯å¤±æ•ˆé‡è¯•ï¼šdId æ²¡åï¼Œç»§ç»­ç”¨ç¼“å­˜é‚£æŠŠï¼ˆå–ä¸åˆ°æ‰çŽ°ç”³è¯·ï¼‰ã€‚
                match self.get_or_refresh_did().await {
                    Ok(d) => d,
                    Err(e) => {
                        last_err = Some(e);
                        continue;
                    }
                }
            };

            let ts = Utc::now().timestamp().to_string();
            let body_str = body.as_ref().map(|b| b.to_string()).unwrap_or_default();
            let sign_input = query.unwrap_or(&body_str);
            let sign = self.calculate_sign(path, sign_input, &ts, &did, &token);

            let url = if let Some(q) = query {
                format!("https://zonai.skland.com{}?{}", path, q)
            } else {
                format!("https://zonai.skland.com{}", path)
            };

            log_info!("=== Skland API Request (attempt {}) ===", attempt + 1);
            log_info!(
                "Method: {}, URL: {}",
                method,
                crate::utils::redact::redact_url(&url)
            );

            let mut req =
                self.build_skland_request(&client, method, &url, &cred, &did, &sign, &ts);
            if let Some(ref b) = body {
                req = req.json(b);
            }
            for (key, value) in &extra_headers {
                // æ¢è¿‡ cred æ—¶ `token` å¤´å¿…é¡»è·Ÿç€æ¢ â€”â€” å®ƒå’Œ cred æ˜¯ä¸€å¯¹ï¼Œ
                // æ²¿ç”¨æ—§ token ä¼šè®©é‡è¯•ç»§ç»­è¢«åˆ¤ä¼šè¯å¤±æ•ˆã€‚
                if key.eq_ignore_ascii_case("token") {
                    req = req.header(key.as_str(), token.as_str());
                } else {
                    req = req.header(key.as_str(), value.as_str());
                }
            }

            let start_time = std::time::Instant::now();
            let response = match capture::send(&client, req).await {
                Ok(r) => r,
                Err(e) => {
                    let message = format!("HTTP request failed: {}", e);
                    api_health::record_failure(
                        api_health::ApiFailureKind::Network,
                        &message,
                        None,
                    );
                    last_err = Some(AppError::AuthError { message });
                    continue;
                }
            };

            let elapsed = start_time.elapsed();
            let status = response.status();
            let clock_skew_seconds = response
                .headers()
                .get(reqwest::header::DATE)
                .and_then(|value| value.to_str().ok())
                .and_then(parse_http_date)
                .map(|server_time| Utc::now().signed_duration_since(server_time).num_seconds());
            if let Some(skew) = clock_skew_seconds {
                if skew.abs() >= api_health::CLOCK_SKEW_THRESHOLD_SECONDS {
                    log_warn!(
                        "Local clock differs from server time by {} seconds; signed requests may be rejected",
                        skew
                    );
                }
            }
            let resp_text = match response.text().await {
                Ok(text) => text,
                Err(e) => {
                    let message = format!("Failed to read response text: {}", e);
                    api_health::record_failure(
                        api_health::ApiFailureKind::Parse,
                        &message,
                        clock_skew_seconds,
                    );
                    last_err = Some(AppError::AuthError { message });
                    continue;
                }
            };

            log_info!("=== Skland API Response ===");
            log_info!("Status: {}, Time: {:?}", status, elapsed);

            match serde_json::from_str::<serde_json::Value>(&resp_text) {
                Ok(json) => {
                    let code = json.get("code").and_then(|c| c.as_i64()).unwrap_or(-1);
                    if code == 0 {
                        api_health::record_success();
                        return Ok(json);
                    }
                    let api_message = json
                        .get("message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("unknown");
                    // ã€Œè¯·å‹¿é‡å¤ç­¾åˆ°ã€ç­‰å¯é¢„æœŸç»“æžœè¡¨ç¤ºç›®æ ‡çŠ¶æ€å·²è¾¾æˆï¼Œå±žäºŽæ­£å¸¸å“åº”ï¼š
                    // æ—¢ä¸è®¡å…¥ API å¤±è´¥ã€ä¹Ÿä¸é‡è¯•ï¼ŒåŽŸæ ·è¿”å›žç”±è°ƒç”¨æ–¹æŒ‰å¹‚ç­‰æˆåŠŸå¤„ç†ã€‚
                    if api_health::is_benign_business_error(code, api_message) {
                        api_health::record_success();
                        log_info!(
                            "Skland API benign business result: code={}, message={}",
                            code,
                            api_message
                        );
                        return Ok(json);
                    }
                    let message = format!("API error: code={}, message={}", code, api_message);
                    let kind = api_health::classify_error(
                        code,
                        api_message,
                        clock_skew_seconds,
                    );

                    // ç­¾å/æ—¶é—´ç±»å¤±è´¥æ‰å€¼å¾—æ¢ dIdï¼šdId å‚ä¸Žç­¾åçš„ header JSONï¼Œ
                    // ä¸€æ—¦è¢«æœåŠ¡å™¨åˆ¤ä¸ºæ— æ•ˆï¼Œæ¢æ–° dId æ˜¯å”¯ä¸€å¯èƒ½çš„ä¿®å¤åŠ¨ä½œã€‚
                    if matches!(
                        kind,
                        api_health::ApiFailureKind::Signature
                            | api_health::ApiFailureKind::ClockSkew
                    ) {
                        need_did_rotation = true;
                    }

                    // ---- ä¼šè¯å¤±æ•ˆè‡ªæ„ˆï¼ˆæœ¬æ–‡ä»¶æœ€å…³é”®çš„ä¿®å¤ç‚¹ï¼‰----
                    //
                    // æœåŠ¡ç«¯è½®æ¢ä¼šè¯åŽï¼Œæ•°æ®æŽ¥å£å›ž `401 code=10000 è¯·æ±‚å¼‚å¸¸`ï¼Œè€Œ
                    // `/api/v1/user/check` ä¾æ—§ `code=0`ï¼Œæ‰€ä»¥ä¸Šå±‚æ°¸è¿œè®¤ä¸ºã€Œcred æœ‰æ•ˆã€ã€
                    // æ°¸ä¸åˆ·æ–°ï¼›éšåŽæ¯ä¸ªè§’è‰²éƒ½æ’ž 401ï¼Œè¿žç»­å¤±è´¥æŠŠç†”æ–­æ‰“æ»¡ï¼Œ**æ‰€æœ‰è´¦å·ä¸€èµ·**
                    // å˜ã€Œè´¦å·ä¸å¯ç”¨ã€ï¼Œåªæœ‰é‡æ–°ç™»å½•æ‰èƒ½æ¢å¤ã€‚
                    //
                    // è¿™é‡Œå°±åœ°è¡¥ä¸Šã€Œé‡æ–°ç™»å½•ã€åšè¿‡çš„é‚£ä¸€æ­¥ï¼šç”¨è¯¥è´¦å·çš„ hytoken æ¢ä¸€æŠŠ
                    // æ–° credï¼Œç„¶åŽç»§ç»­ä¸‹ä¸€è½®é‡è¯•ã€‚åªåšä¸€æ¬¡ï¼Œä¸”å¤±è´¥æ—¶ä¸åžæŽ‰åŽŸå› ã€‚
                    if api_health::is_session_invalid(code, api_message) && !cred_refreshed {
                        cred_refreshed = true;
                        log_warn!(
                            "Skland API session invalid (code={}); attempting credential recovery: {}",
                            code,
                            crate::utils::redact::redact_url(path)
                        );
                        match crate::services::cred_recovery::refresh_for_cred(&cred).await {
                            Some((new_cred, new_token)) => {
                                log_info!(
                                    "Credential recovery succeeded for {} (new_cred_len={}), retrying",
                                    crate::utils::redact::redact_url(path),
                                    new_cred.len()
                                );
                                cred = new_cred;
                                token = new_token;
                                // ä¿®å¤æˆåŠŸï¼šè§£é™¤ç†”æ–­ï¼Œå¦åˆ™ä¸‹ä¸€è½®ä¼šè¢« ensure_available ç›´æŽ¥æ‹’æŽ‰
                                api_health::clear_after_repair("credential rotated after session-invalid");
                                last_err = Some(AppError::AuthError { message });
                                continue;
                            }
                            None => {
                                log_warn!(
                                    "Credential recovery unavailable (no hytoken or refresh failed) for {}",
                                    crate::utils::redact::redact_url(path)
                                );
                            }
                        }
                    }

                    if api_health::is_session_invalid(code, api_message) {
                        // æ‰“ä¸Šå›ºå®šæ ‡è®°ï¼Œè®©ä¸Šå±‚ï¼ˆAccountService / å‰ç«¯ï¼‰èƒ½è¯†åˆ«å‡º
                        // ã€Œè¯¥èµ°åˆ·æ–°æˆ–é‡æ–°ç™»å½•ã€è€Œä¸æ˜¯ã€Œè¯¥é‡è¯•ç½‘ç»œã€ã€‚
                        last_err = Some(AppError::AuthError {
                            message: format!("{SESSION_INVALID_MARKER} {message}"),
                        });
                    } else {
                        last_err = Some(AppError::AuthError {
                            message: message.clone(),
                        });
                    }
                    api_health::record_failure(kind, &message, clock_skew_seconds);
                    continue;
                }
                Err(e) => {
                    let message =
                        format!("Failed to parse JSON: {}. Response: {}", e, resp_text);
                    api_health::record_failure(
                        api_health::ApiFailureKind::Parse,
                        &message,
                        clock_skew_seconds,
                    );
                    last_err = Some(AppError::AuthError { message });
                    continue;
                }
            }
        }

        Err(last_err.unwrap_or(AppError::AuthError {
            message: "Unknown error in call_skland_api".to_string(),
        }))
    }

    /// èŽ·å–æ£®ç©ºå²›ç”¨æˆ·èµ„æ–™ï¼ˆæ˜µç§°ã€å¤´åƒã€å„æ¸¸æˆç­‰çº§/ç§¯åˆ†ã€ç¤¾åŒºäº’åŠ¨æ•°æ®ï¼‰
    ///
    /// å¯¹åº”æŠ“åŒ…è¯·æ±‚ï¼š
    /// ```text
    /// GET /web/v1/user HTTP/2
    /// host: zonai.skland.com
    /// cred / timestamp / sign / vName / dId / platform: 3 ...
    /// ```
    /// æ— æŸ¥è¯¢å‚æ•°ä¸Žè¯·æ±‚ä½“ï¼Œè®¤è¯ header ç”± [`Self::call_skland_api`] ç»Ÿä¸€æ³¨å…¥
    /// ï¼ˆcredã€dIdã€signã€timestampã€platformã€vNameï¼‰ï¼Œç­¾åç®—æ³•ä¸Žå…¶ä½™æŽ¥å£ä¸€è‡´ã€‚
    pub async fn get_user_info(&self, cred: &str, token: &str) -> Result<SklandUserInfo, AppError> {
        let path = "/web/v1/user";
        let json = self
            .call_skland_api("GET", path, None, None, cred, token, vec![])
            .await?;

        let info = Self::parse_user_info_response(&json)?;

        log_info!(
            "Skland user info loaded: id={}, nickname={}, games={}",
            info.id,
            info.nickname,
            info.score_info_list.len()
        );
        Ok(info)
    }

    /// è§£æž `GET /web/v1/user` çš„å“åº”ä½“
    ///
    /// - `data.user` â†’ [`SklandUserInfo`] ä¸»ä½“
    /// - `data.userRts` / `data.background` â†’ ç¤¾åŒºäº’åŠ¨æ•°æ®ä¸Žä¸»é¡µèƒŒæ™¯ï¼ˆè§£æžå¤±è´¥éžè‡´å‘½ï¼‰
    /// - `data.pendant` ä¼˜å…ˆäºŽ `data.user.pendant`
    pub fn parse_user_info_response(json: &serde_json::Value) -> Result<SklandUserInfo, AppError> {
        let data = json.get("data").ok_or_else(|| AppError::AuthError {
            message: "data not found in user info response".to_string(),
        })?;
        let user = data.get("user").ok_or_else(|| AppError::AuthError {
            message: "data.user not found in user info response".to_string(),
        })?;

        let mut info: SklandUserInfo =
            serde_json::from_value(user.clone()).map_err(|e| AppError::AuthError {
                message: format!("Failed to parse SklandUserInfo: {}", e),
            })?;

        // data.userRts / data.background ä¸Ž user åŒçº§ï¼Œè§£æžå¤±è´¥æ—¶ä¿æŒä¸ºç©ºï¼ˆéžè‡´å‘½ï¼‰
        info.stats = data
            .get("userRts")
            .and_then(|value| serde_json::from_value::<SklandUserStats>(value.clone()).ok());
        info.background = data
            .get("background")
            .and_then(|value| serde_json::from_value::<SklandBackground>(value.clone()).ok());
        // é¡¶å±‚ pendant ä¼˜å…ˆï¼Œç¼ºå¤±æ—¶æ²¿ç”¨ user.pendant
        if let Some(pendant) = data
            .get("pendant")
            .and_then(|value| serde_json::from_value::<SklandPendant>(value.clone()).ok())
        {
            info.pendant = Some(pendant);
        }

        Ok(info)
    }

    /// èŽ·å–æ£®ç©ºå²›æ¸¸æˆåˆ—è¡¨ï¼ˆç”¨äºŽè´¦å·èµ„æ–™ä¸­çš„æ¸¸æˆå›¾æ ‡ï¼‰
    ///
    /// å¯¹åº”æŠ“åŒ…è¯·æ±‚ `GET /web/v1/game`ï¼ˆhost: zonai.skland.comï¼‰ï¼Œ
    /// æ— æŸ¥è¯¢å‚æ•°ä¸Žè¯·æ±‚ä½“ï¼Œheader ä¸Žç­¾ååŒæ ·ç”± [`Self::call_skland_api`] å¤„ç†ã€‚
    pub async fn get_game_list(
        &self,
        cred: &str,
        token: &str,
    ) -> Result<Vec<SklandGameInfo>, AppError> {
        let path = "/web/v1/game";
        let json = self
            .call_skland_api("GET", path, None, None, cred, token, vec![])
            .await?;
        let games = Self::parse_game_list_response(&json)?;
        log_info!("Skland game list loaded: {} games", games.len());
        Ok(games)
    }

    /// è§£æž `GET /web/v1/game` çš„å“åº”ä½“ï¼Œæå– `data.list[].game`
    pub fn parse_game_list_response(
        json: &serde_json::Value,
    ) -> Result<Vec<SklandGameInfo>, AppError> {
        let list = json
            .get("data")
            .and_then(|data| data.get("list"))
            .and_then(|list| list.as_array())
            .ok_or_else(|| AppError::AuthError {
                message: "data.list not found in game list response".to_string(),
            })?;

        Ok(list
            .iter()
            .filter_map(|entry| entry.get("game"))
            .filter_map(|game| serde_json::from_value::<SklandGameInfo>(game.clone()).ok())
            .collect())
    }

    /// èŽ·å–çŽ©å®¶ç»‘å®šåˆ—è¡¨
    pub async fn get_player_binding(
        &self,
        cred: &str,
        token: &str,
    ) -> Result<Vec<GameBinding>, AppError> {
        let path = "/api/v1/game/player/binding";
        let json = self
            .call_skland_api("GET", path, None, None, cred, token, vec![])
            .await?;
        let response: BindingResponse =
            serde_json::from_value(json).map_err(|e| AppError::AuthError {
                message: format!("Failed to parse BindingResponse: {}", e),
            })?;
        log_info!(
            "Binding list parsed, returning {} games",
            response.data.list.len()
        );
        Ok(response.data.list)
    }

    /// èŽ·å–è§’è‰²è¯¦æƒ…
    pub async fn get_role_detail(
        &self,
        cred: &str,
        token: &str,
        role_id: &str,
        server_id: &str,
        user_id: &str,
    ) -> Result<CharDetailResponse, AppError> {
        let path = "/api/v1/game/endfield/card/detail";
        let query = format!(
            "roleId={}&serverId={}&userId={}",
            role_id, server_id, user_id
        );
        let json = self
            .call_skland_api("GET", path, Some(&query), None, cred, token, vec![])
            .await?;
        let response: CharDetailResponse =
            serde_json::from_value(json).map_err(|e| AppError::AuthError {
                message: format!("Failed to parse CharDetailResponse: {}", e),
            })?;
        log_info!(
            "Char detail loaded: name={}, level={}",
            response.data.detail.base.name,
            response.data.detail.base.level
        );
        Ok(response)
    }

    /// æ£€æŸ¥ cred æ˜¯å¦æœ‰æ•ˆ
    ///
    /// âš ï¸ **åªä»£è¡¨ã€Œè¿™ä¸ª cred è¿˜èƒ½é€šè¿‡èº«ä»½æ ¡éªŒã€ï¼Œä¸ä»£è¡¨æ•°æ®æŽ¥å£å¯ç”¨ã€‚**
    /// æœåŠ¡ç«¯è½®æ¢ä¼šè¯åŽæœ¬æŽ¥å£ä»è¿”å›ž `code=0`ï¼Œè€Œæ•°æ®æŽ¥å£å·²ç» 401 + `code=10000`ï¼›
    /// å› æ­¤è°ƒç”¨æ–¹ä¸èƒ½åªå‡­ `Ok(true)` å°±è®¤å®šä¼šè¯å¥åº· â€”â€” æ•°æ®æŽ¥å£çš„ä¼šè¯å¤±æ•ˆç”±
    /// [`Self::call_skland_api`] å†…çš„è‡ªæ„ˆé€»è¾‘å•ç‹¬å¤„ç†ã€‚
    pub async fn check_cred(&self, cred: &str) -> Result<bool, AppError> {
        // æ³¨æ„ï¼šè¿™é‡Œåˆ»æ„**ä¸**è°ƒ `ensure_available()`ã€‚æœ¬æŽ¥å£æ˜¯èº«ä»½æ ¡éªŒæŽ¢é’ˆï¼Œ
        // è€Œç†”æ–­å¾€å¾€æ­£æ˜¯ç”±ã€Œæ•°æ®æŽ¥å£ 10000ã€é€ æˆçš„è¯¯åˆ¤ â€”â€” è®©æŽ¢é’ˆä¹Ÿè¢«è‡ªå·±æŒ¡ä½ï¼Œ
        // å°±ä¼šæŠŠã€Œèƒ½ä¸èƒ½è‡ªæˆ‘ä¿®å¤ã€ä¹Ÿä¸€å¹¶æŒ¡æŽ‰ï¼ˆåŽŸå…ˆçš„æ—¥å¿—å°±æ˜¯
        // `check_cred API call failed: API requests are paused ...`ï¼‰ã€‚
        let client = http_client::create_client();

        let start_time = std::time::Instant::now();
        log_info!("=== HTTP REQUEST: æ£€æŸ¥Cred ===");
        log_info!("Method: GET");
        log_info!("URL: https://zonai.skland.com/api/v1/user/check");
        log_debug!("Request Headers: cred=***");

        let response = capture::send(
            &client,
            client
                .get("https://zonai.skland.com/api/v1/user/check")
                .header("cred", cred)
                .header("Content-Type", "application/json"),
        )
        .await
        .map_err(|e| AppError::AuthError {
            message: format!("HTTP request failed: {}", e),
        })?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await.map_err(|e| AppError::AuthError {
            message: format!("Failed to parse response: {}", e),
        })?;

        log_info!("=== HTTP RESPONSE: æ£€æŸ¥Cred ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }
        // code ä¸º 0 è¡¨ç¤º cred æœ‰æ•ˆ
        let is_valid = json.get("code").and_then(|c| c.as_i64()) == Some(0);
        Ok(is_valid)
    }

    /// ä½¿ç”¨ hytoken é‡æ–°æ¢å– cred ä¸Ž token
    ///
    /// åªæ¢æ£®ç©ºå²›å‡­æ®ï¼Œ**ä¸ç¢° u8token** â€”â€” æŠ½å¡ä»¤ç‰ŒæŒ‰è§’è‰²å•ç‹¬æŽˆæƒï¼Œ
    /// å…¥å£æ˜¯ [`crate::services::account_service::AccountService::authorize_role_u8token`]ã€‚
    ///
    /// âš ï¸ **ä¸ç»è¿‡ç†”æ–­å®ˆå«**ï¼šè¿™æ¡é“¾è·¯æ˜¯ç†”æ–­çš„ã€Œè§£è¯ã€è€Œä¸æ˜¯ã€Œç—…å› ã€ã€‚å®ƒæ—¢ä¸ä¾èµ–
    /// dId/ç­¾åï¼Œä¹Ÿä¸ä¾èµ–é‚£æŠŠå·²ç»å¤±æ•ˆçš„ credï¼ˆåªä¾èµ– hytokenï¼‰ã€‚æ—§å®žçŽ°åœ¨è¿™é‡Œè°ƒ
    /// `ensure_available()`ï¼ŒäºŽæ˜¯ç†”æ–­ä¸€æ—¦è§¦å‘ï¼Œå”¯ä¸€çš„ä¿®å¤è·¯å¾„ä¹Ÿè¢«è‡ªå·±é”æ­» â€”â€”
    /// è¿™æ­£æ˜¯ã€Œå¿…é¡»æ‰‹åŠ¨é‡æ–°ç™»å½•æ‰èƒ½æ¢å¤ã€çš„æœºåˆ¶æ€§æ ¹å› ï¼ˆé‡æ–°ç™»å½•ä¹‹æ‰€ä»¥æœ‰æ•ˆï¼Œæ˜¯å› ä¸º
    /// å®ƒèµ°çš„æ˜¯ç™»å½•é“¾è·¯ï¼Œå¹¶é¡ºæ‰‹ `reset_api_health`ï¼‰ã€‚
    pub async fn refresh_cred_by_hytoken(
        &self,
        hytoken: &str,
        _device_token: Option<&str>,
    ) -> Result<(String, String, String), AppError> {
        // Step 1: OAuth grantï¼ˆhytoken â†’ skland sk_codeï¼‰
        let sk_code = self.oauth_grant_to_sk_code(hytoken).await?;

        // æ³¨æ„ï¼šè¿™é‡Œ**ä¸å†**é¡ºå¸¦èŽ·å– u8tokenã€‚u8token å·²æ”¹ä¸ºæŒ‰è§’è‰²å•ç‹¬æŽˆæƒ
        // ï¼ˆè§ AccountService::authorize_role_u8tokenï¼‰ï¼Œä»¤ç‰Œç”±ç”¨æˆ·æ˜¾å¼æŽˆæƒæ‰èŽ·å–ï¼Œ
        // é¿å…ã€Œåˆ·æ–°ä¸€æ¬¡ cred å°±æŠŠç”¨æˆ·åˆšå–æ¶ˆçš„æŽˆæƒåˆæ‚„æ‚„è£…å›žåŽ»ã€ã€‚
        // `device_token` å½¢å‚ä¿ç•™æ˜¯ä¸ºäº†ä¸åŠ¨è°ƒç”¨æ–¹ç­¾åï¼Œæ¢ cred æœ¬èº«ä¸éœ€è¦å®ƒã€‚

        // Step 2: ä½¿ç”¨ sk_code æ¢å–æ–°çš„ cred å’Œ token
        let client = http_client::create_client();
        let start_time = std::time::Instant::now();
        let payload2 = serde_json::json!({
            "kind": 1,
            "code": sk_code
        });
        log_info!("=== HTTP REQUEST: Generate Cred (Step 2) ===");
        log_info!("Method: POST");
        log_info!("URL: https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code");

        let response = capture::send(
            &client,
            client
                .post("https://zonai.skland.com/api/v1/user/auth/generate_cred_by_code")
                .json(&payload2),
        )
        .await
        .map_err(|e| AppError::AuthError {
            message: format!("Step 2 (generate cred) failed: {}", e),
        })?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await.map_err(|e| AppError::AuthError {
            message: format!("Failed to parse cred response: {}", e),
        })?;

        log_info!("=== HTTP RESPONSE: Generate Cred (Step 2) ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }
        if json.get("code").and_then(|v| v.as_i64()) != Some(0) {
            let msg = json
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return Err(AppError::AuthError {
                message: format!("Generate cred failed: {}", msg),
            });
        }

        let data = json.get("data").ok_or_else(|| AppError::AuthError {
            message: "Data not found in cred response".to_string(),
        })?;

        let cred = data
            .get("cred")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::AuthError {
                message: "Cred not found".to_string(),
            })?
            .to_string();

        let token = data
            .get("token")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::AuthError {
                message: "Token not found".to_string(),
            })?
            .to_string();

        let user_id = data
            .get("userId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| AppError::AuthError {
                message: "UserId not found".to_string(),
            })?
            .to_string();

        Ok((cred, token, user_id))
    }

    /// æ¢å–æŠ½å¡æŽ¥å£ï¼ˆ`ef-webview`ï¼‰ä½¿ç”¨çš„ u8 tokenã€‚
    ///
    /// èµ°é¹°è§’é€šè¡Œè¯é“¾è·¯ï¼Œä¸€æ¡ hytoken å¯ä¸ºè¯¥é€šè¡Œè¯ä¸‹**æ¯ä¸€ä¸ªå·²ç»‘å®šçš„æ¸ é“ uid** å„æ¢ä¸€æŠŠï¼š
    ///
    /// 1. `POST https://as.hypergryph.com/user/oauth2/v2/grant`
    ///    body `{ type: 1, appCode: "be36d44aa36bfb5b", token: hytoken }` â†’ `data.token`ï¼ˆL2ï¼‰
    /// 2. `POST https://binding-api-account-prod.hypergryph.com/account/binding/v1/u8_token_by_uid`
    ///    body `{ uid, token: L2 }` â†’ `data.token`ï¼ˆu8 tokenï¼‰
    ///
    /// **ä¸éœ€è¦ device token**ï¼Œä¹Ÿ**ä¸éœ€è¦æ¸ é“å‚æ•°**ï¼šå®˜æœä¸Ž B æœçš„å·®å¼‚å®Œå…¨è½åœ¨ `uid` ä¸Š
    /// ï¼ˆåŒä¸€ä¸ªé€šè¡Œè¯æ¢å‡ºçš„å¤šæŠŠ token å€¼ä¸åŒï¼Œå„è‡ªåªèƒ½è¯»è‡ªå·±é‚£ä¸ª uid çš„è®°å½•ï¼‰ã€‚
    /// u8 token ç”Ÿå‘½å‘¨æœŸå¾ˆçŸ­ï¼Œè°ƒç”¨æ–¹ä¸åº”æŒä¹…åŒ–ï¼Œæ¯æ¬¡åŒæ­¥çŽ°æ¢ã€‚
    pub async fn get_u8_token_by_uid(
        &self,
        hytoken: &str,
        binding_uid: &str,
    ) -> Result<String, AppError> {
        let oauth_token = self.u8_oauth_token(hytoken).await?;
        self.u8_token_by_uid(&oauth_token, binding_uid).await
    }

    /// ä¸€æ­¥ï¼šhytoken â†’ æŠ½å¡åŸŸ OAuth tokenï¼ˆtype=1ï¼Œä¸Žæ¢ cred çš„ type=0 ä¸åŒï¼‰
    pub async fn u8_oauth_token(&self, hytoken: &str) -> Result<String, AppError> {
        let client = http_client::create_client();
        let payload = serde_json::json!({
            "type": 1,
            "appCode": U8_GRANT_APP_CODE,
            "token": hytoken,
        });

        log_info!("=== HTTP REQUEST: æŠ½å¡ OAuth Grant (type=1) ===");
        let response = capture::send(
            &client,
            client
                .post("https://as.hypergryph.com/user/oauth2/v2/grant")
                .json(&payload),
        )
        .await
        .map_err(|e| AppError::AuthError {
            message: format!("Gacha OAuth grant failed: {}", e),
        })?;

        let json: serde_json::Value = response.json().await.map_err(|e| AppError::AuthError {
            message: format!("Failed to parse gacha OAuth response: {}", e),
        })?;

        if json.get("status").and_then(|v| v.as_i64()) != Some(0) {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            // appCode å¤±æ•ˆä¸Ž token è¿‡æœŸéƒ½ä¼šèµ°åˆ°è¿™é‡Œï¼Œæ—¥å¿—é‡Œä¿ç•™åŽŸå§‹ msg ä¾¿äºŽæŽ’æŸ¥
            log_error!("u8_oauth_token: grant rejected: {}", msg);
            return Err(AppError::AuthError {
                message: format!("Gacha OAuth grant failed: {}", msg),
            });
        }

        json.get("data")
            .and_then(|d| d.get("token"))
            .and_then(|c| c.as_str())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .ok_or_else(|| AppError::AuthError {
                message: "OAuth token not found in grant response".to_string(),
            })
    }

    /// äºŒæ­¥ï¼šOAuth token + ç»‘å®š uid â†’ u8 token
    ///
    /// å®˜æœä¸Ž B æœå„ç”¨è‡ªå·±çš„ `uid` æ¢ï¼Œæ¢å‡ºæ¥çš„å€¼ä¸åŒã€äº’ä¸é€šç”¨ â€”â€” è¿™æ˜¯å›½æœå¤šæ¸ é“çš„
    /// å”¯ä¸€å·®å¼‚ç‚¹ï¼Œå› æ­¤è¿™é‡Œ**ä¸æŽ¥å—ä»»ä½•æ¸ é“å‚æ•°**ã€‚
    pub async fn u8_token_by_uid(
        &self,
        oauth_token: &str,
        binding_uid: &str,
    ) -> Result<String, AppError> {
        let client = http_client::create_client();
        let payload = serde_json::json!({
            "uid": binding_uid,
            "token": oauth_token,
        });

        log_info!(
            "=== HTTP REQUEST: u8_token_by_uid (uid_len={}) ===",
            binding_uid.len()
        );
        let response = capture::send(
            &client,
            client
                .post(format!(
                    "https://{}/account/binding/v1/u8_token_by_uid",
                    BINDING_API_HOST
                ))
                .json(&payload),
        )
        .await
        .map_err(|e| AppError::AuthError {
            message: format!("u8_token_by_uid request failed: {}", e),
        })?;

        let json: serde_json::Value = response.json().await.map_err(|e| AppError::AuthError {
            message: format!("Failed to parse u8_token_by_uid response: {}", e),
        })?;

        let token = json
            .get("data")
            .and_then(|d| d.get("token"))
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                let msg = json
                    .get("msg")
                    .and_then(|v| v.as_str())
                    .unwrap_or("no token in response");
                log_error!(
                    "u8_token_by_uid: no token for uid (len={}), msg={}",
                    binding_uid.len(),
                    msg
                );
                AppError::AuthError {
                    message: format!(
                        "u8_token_by_uid failed for binding uid ({}). The account may not be bound \
                         to this channel: {}",
                        binding_uid, msg
                    ),
                }
            })?;

        log_debug!(
            "u8_token_by_uid: SUCCESS (token_len={})",
            token.len()
        );
        Ok(token.to_string())
    }

    /// OAuth grantï¼šhytoken â†’ sk_code
    async fn oauth_grant_to_sk_code(&self, hytoken: &str) -> Result<String, AppError> {
        let client = http_client::create_client();

        let start_time = std::time::Instant::now();
        let payload = serde_json::json!({
            "token": hytoken,
            "appCode": "4ca99fa6b56cc2ba",
            "type": 0
        });
        log_info!("=== HTTP REQUEST: OAuth Grant (Step 1) ===");
        log_info!("Method: POST");
        log_info!("URL: https://as.hypergryph.com/user/oauth2/v2/grant");

        let response = capture::send(
            &client,
            client
                .post("https://as.hypergryph.com/user/oauth2/v2/grant")
                .json(&payload),
        )
        .await
        .map_err(|e| AppError::AuthError {
            message: format!("Step 1 (OAuth grant) failed: {}", e),
        })?;

        let elapsed = start_time.elapsed();
        let status = response.status();
        let resp_headers = response.headers().clone();

        let json: serde_json::Value = response.json().await.map_err(|e| AppError::AuthError {
            message: format!("Failed to parse OAuth response: {}", e),
        })?;

        log_info!("=== HTTP RESPONSE: OAuth Grant (Step 1) ===");
        log_info!("Status: {}", status);
        log_info!("Time: {:?}", elapsed);
        log_debug!("Response Headers:");
        for (name, value) in resp_headers.iter() {
            if let Ok(value_str) = value.to_str() {
                log_debug!("  {}: {}", name, value_str);
            }
        }
        if json.get("status").and_then(|v| v.as_i64()) != Some(0) {
            let msg = json
                .get("msg")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error");
            return Err(AppError::AuthError {
                message: format!("OAuth grant failed: {}", msg),
            });
        }

        json.get("data")
            .and_then(|d| d.get("code"))
            .and_then(|c| c.as_str())
            .ok_or_else(|| AppError::AuthError {
                message: "Code not found in OAuth response".to_string(),
            })
            .map(|s| s.to_string())
    }

    /// å±•å¹³ç»‘å®šåˆ—è¡¨é‡Œçš„æ¸¸æˆè§’è‰²ï¼ˆç»ˆæœ«åœ° + æ˜Žæ—¥æ–¹èˆŸï¼‰
    ///
    /// è¿”å›ž [`GameRoleBinding`]ï¼ˆå« `game` / æ¸ é“ uid / æœåŠ¡å™¨ / æ˜µç§° / ç­‰çº§ï¼‰ã€‚
    /// ç¬¬ä¸€æ¡è®°å½•çš„ `binding_uid` æ˜¯**æ¢ u8token å¿…é¡»çš„é”®** â€”â€” åŒä¸€ä¸ªé€šè¡Œè¯ä¸‹å®˜æœä¸Ž
    /// B æœå„æœ‰ä¸€æ¡ç»‘å®šè®°å½•ã€å„æœ‰ä¸€ä¸ª uidï¼Œç»ä¸èƒ½ä¸¢ã€‚
    ///
    /// åªä¿ç•™ `app_code` èƒ½è¯†åˆ«çš„æ¸¸æˆï¼š`endfield`ï¼ˆç»ˆæœ«åœ°ï¼‰ä¸Ž `arknights`ï¼ˆæ˜Žæ—¥æ–¹èˆŸï¼‰ã€‚
    /// å…¶ä½™åº”ç”¨ï¼ˆæœªçŸ¥ `app_code`ï¼‰ç›´æŽ¥è·³è¿‡ï¼Œé¿å…æŠŠä¸è®¤è¯†çš„è§’è‰²æ··è¿›åˆ—è¡¨ã€‚
    ///
    /// # âš ï¸ ä¸¤ä¸ªæ¸¸æˆçš„è§’è‰²èººåœ¨ä¸åŒå±‚çº§
    ///
    /// - **ç»ˆæœ«åœ°**ï¼šè§’è‰²åœ¨ `bindingList[].roles[]` é‡Œï¼ˆæ¯é¡¹æœ‰è‡ªå·±çš„ `roleId` / `serverId`ï¼‰
    /// - **æ˜Žæ—¥æ–¹èˆŸ**ï¼š`bindingList[].roles` æ˜¯**ç©ºæ•°ç»„**ï¼è§’è‰²ä¿¡æ¯å°±åœ¨ `bindingList`
    ///   è¿™ä¸€å±‚ â€”â€” `uid` å³è§’è‰²æ ‡è¯†ï¼ˆä¸€ä¸ª uid = ä¸€ä¸ªè§’è‰²ï¼Œå®žæµ‹å®˜æœ/Bæœå„æœ‰ç‹¬ç«‹ uid
    ///   ä¸”ä¸ä¼šç¢°æ’žï¼‰ï¼Œ`nickName` æ˜¯æ˜µç§°ï¼Œ`channelMasterId` å¯¹åº”æœåŠ¡å™¨ï¼ˆ1=å®˜æœ 2=Bæœï¼‰
    ///
    /// æ—©å…ˆåªéåŽ† `roles` çš„å†™æ³•ä¼š**å®Œå…¨æ¼æŽ‰æ˜Žæ—¥æ–¹èˆŸè§’è‰²**ï¼ˆå‰ç«¯è¡¨çŽ°ä¸ºã€Œæ‰¾ä¸åˆ°å¯ç»‘å®šçš„
    /// æ˜Žæ—¥æ–¹èˆŸè§’è‰²ã€ï¼‰ï¼Œå› æ­¤è¿™é‡Œå¯¹æ˜Žæ—¥æ–¹èˆŸèµ°å•ç‹¬åˆ†æ”¯ï¼š`roles` éžç©ºå°±ç…§å¸¸å±•å¼€ï¼Œ
    /// ä¸ºç©ºåˆ™ç”¨ç»‘å®šæ¡ç›®æœ¬èº«åˆæˆä¸€æ¡ã€‚
    pub fn extract_game_roles(bindings: &[GameBinding]) -> Vec<GameRoleBinding> {
        let mut roles = Vec::new();

        for binding in bindings {
            let game = match binding.app_code.as_str() {
                GAME_ENDFIELD => GAME_ENDFIELD,
                GAME_ARKNIGHTS => GAME_ARKNIGHTS,
                other => {
                    log_debug!("extract_game_roles: skip unknown app_code '{}'", other);
                    continue;
                }
            };

            for role_info in &binding.binding_list {
                // å·²è¢«åˆ é™¤çš„æ¸ é“ç»‘å®šä¸å†æä¾›è§’è‰²
                if role_info.is_delete {
                    log_debug!(
                        "extract_game_roles: skip deleted binding for game={}, uid_len={}",
                        game,
                        role_info.uid.len()
                    );
                    continue;
                }

                // ---- æ˜Žæ—¥æ–¹èˆŸï¼šroles[] ä¸ºç©ºï¼Œç”¨ç»‘å®šæ¡ç›®æœ¬èº«å½“è§’è‰² ----
                if game == GAME_ARKNIGHTS && role_info.roles.is_empty() {
                    if role_info.uid.is_empty() {
                        log_debug!("extract_game_roles: skip arknights binding without uid");
                        continue;
                    }
                    log_debug!(
                        "extract_game_roles: arknights binding uid={}, channel={}, nickname={:?}",
                        role_info.uid,
                        role_info.channel_name,
                        role_info.nick_name
                    );
                    roles.push(GameRoleBinding {
                        game: game.to_string(),
                        binding_uid: role_info.uid.clone(),
                        channel_master_id: role_info.channel_master_id.clone(),
                        channel_name: role_info.channel_name.clone(),
                        // æ¸ é“ä¸» ID åŒæ—¶å°±æ˜¯æœåŠ¡å™¨æ ‡è¯†ï¼š`resolveServerLabel` è®¤ "1"=å®˜æœ / "2"=Bæœ
                        server_id: role_info.channel_master_id.clone(),
                        server_name: role_info.channel_name.clone(),
                        // â˜… æ˜Žæ—¥æ–¹èˆŸæ²¡æœ‰ roleIdï¼Œ**uid å³è§’è‰²æ ‡è¯†**ã€‚
                        // å·²ç”¨çœŸå®žè´¦å·éªŒè¯ `player/info.status.uid == ç»‘å®š uid`ã€‚
                        role_id: role_info.uid.clone(),
                        nickname: role_info.nick_name.clone(),
                        // ç­‰çº§åªèƒ½ä»Ž `player/info.status.level` æ‹¿ï¼ˆç»‘å®šæŽ¥å£ä¸ç»™ï¼‰
                        level: 0,
                    });
                    continue;
                }

                for role in &role_info.roles {
                    roles.push(GameRoleBinding {
                        game: game.to_string(),
                        binding_uid: role_info.uid.clone(),
                        channel_master_id: role_info.channel_master_id.clone(),
                        channel_name: role_info.channel_name.clone(),
                        server_id: role.server_id.clone(),
                        server_name: role.server_name.clone(),
                        role_id: role.role_id.clone(),
                        nickname: role.nickname.clone(),
                        level: role.level,
                    });
                }
            }
        }

        roles
    }
}

/// DES 3DES åŠ å¯†å‡½æ•°ï¼ˆECB æ¨¡å¼ï¼ŒZero Paddingï¼‰
fn des_encrypt_3des(key: &str, data: &str) -> Result<String, AppError> {
    // cipher 0.5ï¼š`BlockEncrypt` æ›´å `BlockCipherEncrypt`ï¼Œ`encrypt_block_b2b`
    // ç”± trait æ–¹æ³•å˜ä¸ºå›ºæœ‰æ–¹æ³•ï¼ˆè§ des 0.9ï¼‰ã€‚
    use des::cipher::{BlockCipherEncrypt, KeyInit};
    use des::Des;

    let mut data_bytes = data.as_bytes().to_vec();

    // Zero Padding: å¡«å……åˆ°8å­—èŠ‚çš„å€æ•°
    let pad_len = 8 - (data_bytes.len() % 8);
    if pad_len < 8 {
        data_bytes.extend(vec![0u8; pad_len]);
    }

    // ä½¿ç”¨å• DESï¼ˆä¸Ž Python è¡Œä¸ºä¸€è‡´ï¼‰
    let cipher = Des::new_from_slice(key.as_bytes()).map_err(|e| AppError::AuthError {
        message: format!("DES key error: {}", e),
    })?;

    let mut out = vec![0u8; data_bytes.len()];

    for i in (0..data_bytes.len()).step_by(8) {
        // cipher 0.5 çš„ Block æ˜¯ hybrid-arrayï¼š&[u8] ä¸å†ç›´æŽ¥ Intoï¼Œéœ€å®šé•¿åˆ‡ç‰‡ã€‚
        let in_block: &[u8; 8] = (&data_bytes[i..i + 8]).try_into().expect("DES block size");
        let out_block: &mut [u8; 8] = (&mut out[i..i + 8]).try_into().expect("DES block size");
        cipher.encrypt_block_b2b(in_block.into(), out_block.into());
    }

    Ok(BASE64.encode(out))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_fetch_did_format() {
        // åˆ›å»ºä¸€ä¸ªä¸´æ—¶çš„ ConfigService
        let config_service =
            std::sync::Arc::new(std::sync::Mutex::new(ConfigService::new().unwrap()));
        let service = SklandService::new(config_service);

        // èŽ·å– dId
        let did = service.fetch_new_did().await.unwrap();

        // éªŒè¯ dId æ ¼å¼
        assert!(did.starts_with("B"), "dId should start with 'B'");
        println!("Generated dId: {}", did);
        println!("dId length: {}", did.len());
        println!("dId ends with '==': {}", did.ends_with("=="));

        // dId åº”è¯¥æ˜¯ä»¥ == ç»“å°¾çš„ Base64 å­—ç¬¦ä¸²
        assert!(did.ends_with("=="), "dId should end with '=='");
    }

    /// æŠ“åŒ…æ ·æœ¬ï¼š`GET /web/v1/user` å“åº”ä½“ï¼ˆèŠ‚é€‰è‡ªçœŸå®žè¿”å›žï¼‰
    const USER_INFO_RESPONSE: &str = r#"{
      "code": 0,
      "message": "OK",
      "timestamp": "1790924989",
      "data": {
        "user": {
          "id": "7345042541775",
          "nickname": "sciencekill",
          "profile": "",
          "avatarCode": 200092,
          "avatar": "https://bbs.hycdn.cn/image/2025/04/07/9638ca2e1ff259e6a9d39f856645e41e.png",
          "backgroundCode": 1,
          "isCreator": false,
          "status": 1,
          "operationStatus": 30,
          "identity": 1,
          "kind": 1,
          "latestIpLocation": "ä¸­å›½",
          "moderatorStatus": 4,
          "moderatorChangeTime": 0,
          "gender": 0,
          "birthday": "1267891200",
          "hgId": "1333697894290",
          "creatorIdentifiers": [],
          "scoreInfoList": [
            {
              "gameId": 1,
              "level": 1,
              "iconUrl": "https://bbs.hycdn.cn/asset/score/level-icon/Lv1.webp",
              "darkModeIconUrl": "",
              "checkedDays": 0,
              "score": 14,
              "gameName": "æ˜Žæ—¥æ–¹èˆŸ",
              "levelUrl": "https://bbs.hycdn.cn/asset/score/level-name-thin/Lv1.webp"
            },
            {
              "gameId": 3,
              "level": 1,
              "iconUrl": "https://bbs.hycdn.cn/asset/score/level-icon/Lv1.webp",
              "darkModeIconUrl": "",
              "checkedDays": 0,
              "score": 138,
              "gameName": "æ˜Žæ—¥æ–¹èˆŸï¼šç»ˆæœ«åœ°",
              "levelUrl": "https://bbs.hycdn.cn/asset/score/level-name-thin/Lv1.webp"
            }
          ],
          "pendant": {
            "id": 60,
            "iconUrl": "https://bbs.hycdn.cn/image/2026/01/14/f8123f455ec880c750efc0b93bdf5e00.webp",
            "title": "ä½©ä¸½å¡ä¸»é¢˜",
            "description": "å‚ä¸Žæ£®ç©ºå²›æ˜Žæ—¥æ–¹èˆŸï¼šç»ˆæœ«åœ°å…¨çƒå…¬æµ‹å¼€å¯æ´»åŠ¨èŽ·å–"
          },
          "showId": "7345042541775"
        },
        "userRts": {
          "liked": "0",
          "collect": "0",
          "comment": "1",
          "follow": "3",
          "fans": "0",
          "black": "0",
          "pub": "0"
        },
        "moderator": {
          "isModerator": false,
          "operations": [],
          "role": "ROLE_UNSPECIFIED",
          "since": "0",
          "status": 0,
          "gameOperations": {}
        },
        "pendant": {
          "id": 60,
          "iconUrl": "https://bbs.hycdn.cn/image/2026/01/14/f8123f455ec880c750efc0b93bdf5e00.webp",
          "title": "ä½©ä¸½å¡ä¸»é¢˜",
          "description": "å‚ä¸Žæ£®ç©ºå²›æ˜Žæ—¥æ–¹èˆŸï¼šç»ˆæœ«åœ°å…¨çƒå…¬æµ‹å¼€å¯æ´»åŠ¨èŽ·å–"
        },
        "background": {
          "id": 3,
          "url": "https://bbs.hycdn.cn/image/2024/12/27/f087e6b13b2d28815c70d8de0b004e1c.png",
          "resourceKind": 1
        },
        "userSanctionList": [],
        "userInfoApply": {
          "nickname": "",
          "profile": ""
        }
      }
    }"#;

    #[test]
    fn test_parse_user_info_response() {
        let json: serde_json::Value = serde_json::from_str(USER_INFO_RESPONSE).unwrap();
        let info = SklandService::parse_user_info_response(&json).unwrap();

        assert_eq!(info.id, "7345042541775");
        assert_eq!(info.nickname, "sciencekill");
        assert_eq!(info.show_id, "7345042541775");
        assert_eq!(info.avatar_code, 200092);
        assert_eq!(info.latest_ip_location, "ä¸­å›½");
        assert!(!info.is_creator);
        assert_eq!(info.score_info_list.len(), 2);
        assert_eq!(info.score_info_list[0].game_name, "æ˜Žæ—¥æ–¹èˆŸ");
        assert_eq!(info.score_info_list[1].level, 1);
        assert_eq!(info.score_info_list[1].score, 138);
        assert_eq!(
            info.pendant.as_ref().map(|p| p.title.as_str()),
            Some("ä½©ä¸½å¡ä¸»é¢˜")
        );

        let stats = info.stats.expect("userRts should be parsed");
        assert_eq!(stats.follow, "3");
        assert_eq!(stats.comment, "1");
        assert_eq!(stats.published, "0");

        let background = info.background.expect("background should be parsed");
        assert_eq!(background.id, 3);
        assert_eq!(background.resource_kind, 1);
    }

    #[test]
    fn test_parse_user_info_response_requires_data_user() {
        let json: serde_json::Value = serde_json::json!({ "code": 0, "message": "OK" });
        assert!(SklandService::parse_user_info_response(&json).is_err());
    }

    /// æŠ“åŒ…æ ·æœ¬ï¼š`GET /web/v1/game` å“åº”ä½“ï¼ˆèŠ‚é€‰è‡ªçœŸå®žè¿”å›žï¼‰
    const GAME_LIST_RESPONSE: &str = r#"{
      "code": 0,
      "message": "OK",
      "data": {
        "list": [
          {
            "game": {
              "gameId": 1,
              "name": "æ˜Žæ—¥æ–¹èˆŸ",
              "iconUrl": "https://bbs.hycdn.cn/asset/rhodes_island.png",
              "backgroundUrl": "https://bbs.hycdn.cn/asset/arknights_bg.png",
              "pcIconUrl": "https://bbs.hycdn.cn/asset/rhodes_island.png",
              "backgroundStyle": 1,
              "description": "æ˜Žæ—¥æ–¹èˆŸæ¸¸æˆç›¸å…³è®¨è®ºåŒº",
              "checkinIcon": { "key": "gameId1" }
            },
            "cates": [{ "id": 14, "gameId": 1, "name": "æŽ¨è" }]
          },
          {
            "game": {
              "gameId": 3,
              "name": "æ˜Žæ—¥æ–¹èˆŸï¼šç»ˆæœ«åœ°",
              "iconUrl": "https://bbs.hycdn.cn/asset/endfield.png",
              "backgroundUrl": "https://bbs.hycdn.cn/asset/endfield_bg.png",
              "backgroundStyle": 1
            },
            "cates": []
          }
        ],
        "homeTabs": [{ "name": "å…³æ³¨", "kind": "FOLLOW" }]
      }
    }"#;

    #[test]
    fn test_parse_game_list_response() {
        let json: serde_json::Value = serde_json::from_str(GAME_LIST_RESPONSE).unwrap();
        let games = SklandService::parse_game_list_response(&json).unwrap();

        assert_eq!(games.len(), 2);
        assert_eq!(games[0].game_id, 1);
        assert_eq!(games[0].name, "æ˜Žæ—¥æ–¹èˆŸ");
        assert_eq!(
            games[0].icon_url,
            "https://bbs.hycdn.cn/asset/rhodes_island.png"
        );
        assert_eq!(games[1].game_id, 3);
        assert_eq!(games[1].name, "æ˜Žæ—¥æ–¹èˆŸï¼šç»ˆæœ«åœ°");
        assert_eq!(games[1].icon_url, "https://bbs.hycdn.cn/asset/endfield.png");
    }

    #[test]
    fn test_parse_game_list_response_requires_data_list() {
        let json: serde_json::Value = serde_json::json!({ "code": 0, "data": {} });
        assert!(SklandService::parse_game_list_response(&json).is_err());
    }

    /// ç»‘å®šåˆ—è¡¨æ ·æœ¬ï¼ˆ**ç»“æž„ç…§çœŸå®žè¿”å›ž**ï¼‰ï¼šä¸€ä¸ªé€šè¡Œè¯åŒæ—¶ç»‘å®šäº†ç»ˆæœ«åœ°ä¸Žæ˜Žæ—¥æ–¹èˆŸã€‚
    ///
    /// âš ï¸ å…³é”®å·®å¼‚ï¼š**æ˜Žæ—¥æ–¹èˆŸçš„ `roles` æ˜¯ç©ºæ•°ç»„**ï¼Œè§’è‰²ä¿¡æ¯åœ¨ `bindingList` è¿™ä¸€å±‚
    /// ï¼ˆ`uid` / `nickName` / `channelMasterId`ï¼‰ï¼›ç»ˆæœ«åœ°æ‰æŠŠè§’è‰²æ”¾è¿› `roles[]`ã€‚
    const BINDING_RESPONSE: &str = r#"{
      "code": 0,
      "message": "OK",
      "timestamp": "1790924989",
      "data": {
        "list": [
          {
            "appCode": "arknights",
            "appName": "æ˜Žæ—¥æ–¹èˆŸ",
            "bindingList": [
              {
                "uid": "700000011",
                "isOfficial": false,
                "isDefault": true,
                "channelMasterId": "2",
                "channelName": "bilibiliæœ",
                "nickName": "Doctor#1234",
                "isDelete": false,
                "gameName": "æ˜Žæ—¥æ–¹èˆŸ",
                "gameId": 1,
                "roles": [],
                "defaultRole": null
              },
              {
                "uid": "700000022",
                "isOfficial": true,
                "isDefault": false,
                "channelMasterId": "1",
                "channelName": "å®˜æœ",
                "nickName": "Doctor#1234",
                "isDelete": false,
                "gameName": "æ˜Žæ—¥æ–¹èˆŸ",
                "gameId": 1,
                "roles": [],
                "defaultRole": null
              },
              {
                "uid": "700000033",
                "isOfficial": false,
                "isDefault": false,
                "channelMasterId": "2",
                "channelName": "bilibiliæœ",
                "nickName": "Doctor#1234",
                "isDelete": true,
                "gameName": "æ˜Žæ—¥æ–¹èˆŸ",
                "gameId": 1,
                "roles": [],
                "defaultRole": null
              }
            ],
            "defaultUid": "700000022"
          },
          {
            "appCode": "endfield",
            "appName": "æ˜Žæ—¥æ–¹èˆŸï¼šç»ˆæœ«åœ°",
            "bindingList": [
              {
                "uid": "3000000000000000",
                "isOfficial": true,
                "isDefault": true,
                "channelMasterId": "1",
                "channelName": "å®˜æœ",
                "nickName": "",
                "isDelete": false,
                "gameName": "æ˜Žæ—¥æ–¹èˆŸï¼šç»ˆæœ«åœ°",
                "gameId": 3,
                "roles": [
                  {
                    "serverId": "1",
                    "roleId": "20000000001",
                    "nickname": "ç®¡ç†å‘˜",
                    "level": 42,
                    "isDefault": true,
                    "isBanned": false,
                    "serverType": "cn",
                    "serverName": "å›½æœ"
                  }
                ],
                "defaultRole": null
              }
            ],
            "defaultUid": "3000000000000000"
          }
        ],
        "serverDefaultBinding": {}
      }
    }"#;

    #[test]
    fn test_extract_game_roles_covers_both_games() {
        let bindings: crate::models::role::BindingResponse =
            serde_json::from_str(BINDING_RESPONSE).unwrap();
        let roles = SklandService::extract_game_roles(&bindings.data.list);

        // ç»ˆæœ«åœ° 1 ä¸ªï¼ˆèµ° roles[]ï¼‰+ æ˜Žæ—¥æ–¹èˆŸ 2 ä¸ªï¼ˆèµ° bindingList å±‚ï¼Œå·²åˆ æ¸ é“è¢«è·³è¿‡ï¼‰
        assert_eq!(roles.len(), 3, "roles={:?}", roles);

        // ---- ç»ˆæœ«åœ°ï¼šè§’è‰²æ¥è‡ª roles[] ----
        let endfield = roles.iter().find(|r| r.game == GAME_ENDFIELD).unwrap();
        assert_eq!(endfield.role_id, "20000000001");
        assert_eq!(endfield.nickname, "ç®¡ç†å‘˜");
        assert_eq!(endfield.level, 42);
        assert_eq!(endfield.server_id, "1");
        assert_eq!(endfield.binding_uid, "3000000000000000");

        // ---- æ˜Žæ—¥æ–¹èˆŸï¼šroles ä¸ºç©ºï¼Œè§’è‰²æ ‡è¯†å°±æ˜¯ uid ----
        let ak_roles: Vec<_> = roles.iter().filter(|r| r.game == GAME_ARKNIGHTS).collect();
        assert_eq!(ak_roles.len(), 2, "æ˜Žæ—¥æ–¹èˆŸè§’è‰²æ²¡è¢«è¯†åˆ«å‡ºæ¥: {:?}", ak_roles);

        let official = ak_roles
            .iter()
            .find(|r| r.channel_master_id == "1")
            .expect("ç¼ºå°‘å®˜æœè§’è‰²");
        assert_eq!(official.binding_uid, "700000022");
        // â˜… æ²¡æœ‰ roleIdï¼Œuid å³è§’è‰²æ ‡è¯†ï¼ˆ`player/info` é å®ƒå¯»å€ï¼‰
        assert_eq!(official.role_id, "700000022");
        assert_eq!(official.nickname, "Doctor#1234");
        // ç­‰çº§åªèƒ½ç”± player/info è¡¥ï¼Œç»‘å®šæŽ¥å£ä¸ç»™
        assert_eq!(official.level, 0);
        // æ¸ é“ä¸» ID åŒæ—¶ä½œä¸º server_idï¼Œå‰ç«¯ resolveServerLabel è®¤ "1"=å®˜æœ
        assert_eq!(official.server_id, "1");
        assert_eq!(official.server_name, "å®˜æœ");

        let bilibili = ak_roles
            .iter()
            .find(|r| r.channel_master_id == "2")
            .expect("ç¼ºå°‘ B æœè§’è‰²");
        assert_eq!(bilibili.binding_uid, "700000011");
        assert_eq!(bilibili.role_id, "700000011");
        assert_eq!(bilibili.server_id, "2");

        // å·²åˆ æ¸ é“ï¼ˆuid 700000033ï¼‰å¿…é¡»è¢«è·³è¿‡
        assert!(
            !ak_roles.iter().any(|r| r.role_id == "700000033"),
            "isDelete=true çš„æ¸ é“ç»‘å®šä¸åº”äº§å‡ºè§’è‰²"
        );
    }

    #[test]
    fn test_extract_game_roles_arknights_with_roles_still_works() {
        // ä¸‡ä¸€å°†æ¥æŽ¥å£æ”¹æˆæŠŠæ˜Žæ—¥æ–¹èˆŸè§’è‰²æ”¾è¿› roles[]ï¼Œä¹Ÿè¦èƒ½æ­£å¸¸å±•å¼€ï¼ˆå‘å‰å…¼å®¹ï¼‰ï¼š
        // roles éžç©ºæ—¶èµ°é€šç”¨åˆ†æ”¯ï¼ŒroleId å– roles é‡Œçš„å€¼è€Œä¸æ˜¯ uidã€‚
        let json = r#"{
          "code": 0,
          "message": "OK",
          "timestamp": "1790924989",
          "data": {
            "list": [
              {
                "appCode": "arknights",
                "appName": "æ˜Žæ—¥æ–¹èˆŸ",
                "bindingList": [
                  {
                    "uid": "700000022",
                    "isOfficial": true,
                    "isDefault": true,
                    "channelMasterId": "1",
                    "channelName": "å®˜æœ",
                    "nickName": "Doctor#1234",
                    "isDelete": false,
                    "gameName": "æ˜Žæ—¥æ–¹èˆŸ",
                    "gameId": 1,
                    "roles": [
                      {
                        "serverId": "1",
                        "roleId": "10000000001",
                        "nickname": "åˆ€å®¢å¡”",
                        "level": 120,
                        "isDefault": true,
                        "isBanned": false,
                        "serverType": "cn",
                        "serverName": "å®˜æœ"
                      }
                    ],
                    "defaultRole": null
                  }
                ],
                "defaultUid": "700000022"
              }
            ],
            "serverDefaultBinding": {}
          }
        }"#;
        let bindings: crate::models::role::BindingResponse = serde_json::from_str(json).unwrap();
        let roles = SklandService::extract_game_roles(&bindings.data.list);

        assert_eq!(roles.len(), 1);
        let official = &roles[0];
        assert_eq!(official.game, GAME_ARKNIGHTS);
        assert_eq!(official.role_id, "10000000001");
        assert_eq!(official.nickname, "åˆ€å®¢å¡”");
        assert_eq!(official.level, 120);
        assert_eq!(official.binding_uid, "700000022");
    }

    #[test]
    fn test_extract_game_roles_skips_unknown_app() {
        let bindings: crate::models::role::BindingResponse = serde_json::from_str(
            r#"{
              "code": 0,
              "message": "OK",
              "timestamp": "1790924989",
              "data": {
                "list": [
                  {
                    "appCode": "unknown_game",
                    "appName": "æœªçŸ¥æ¸¸æˆ",
                    "bindingList": [
                      {
                        "uid": "1",
                        "isOfficial": true,
                        "isDefault": true,
                        "channelMasterId": "1",
                        "channelName": "å®˜æœ",
                        "nickName": "x",
                        "isDelete": false,
                        "gameName": "æœªçŸ¥æ¸¸æˆ",
                        "gameId": 99,
                        "roles": [
                          {
                            "serverId": "1",
                            "roleId": "9",
                            "nickname": "y",
                            "level": 1,
                            "isDefault": false,
                            "isBanned": false,
                            "serverType": "cn",
                            "serverName": "å®˜æœ"
                          }
                        ],
                        "defaultRole": null
                      }
                    ],
                    "defaultUid": "1"
                  }
                ],
                "serverDefaultBinding": {}
              }
            }"#,
        )
        .unwrap();

        assert!(SklandService::extract_game_roles(&bindings.data.list).is_empty());
    }
}

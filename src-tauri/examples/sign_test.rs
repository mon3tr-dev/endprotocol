use hex;
use hmac::{Hmac, KeyInit as _, Mac};
use md5::Digest;
use md5::Md5;
use serde_json::json;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

fn calculate_sign(path: &str, body: &str, ts: &str, did: &str, token: &str) -> String {
    // 构造 header JSON 字符串（按 Python 的键顺序和紧凑格式）
    let h_ca_str = format!(
        "{{\"platform\":\"1\",\"timestamp\":\"{}\",\"dId\":\"{}\",\"vName\":\"1.45.1\"}}",
        ts, did
    );

    // 拼接并计算 HMAC-SHA256
    let raw = format!("{}{}{}{}", path, body, ts, h_ca_str);
    let mut mac = HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC key error");
    mac.update(raw.as_bytes());
    let hex_hmac = hex::encode(mac.finalize().into_bytes());

    // MD5 of hex_hmac（digest 0.11 的输出不实现 LowerHex，改用 hex::encode）
    let md5_digest = Md5::digest(hex_hmac.as_bytes());
    hex::encode(md5_digest)
}

fn main() {
    // Test vector
    let token = "9f192562b31b3d6222a22591fda002e8";
    let path = "/api/v1/game/attendance";
    let body = "{\"uid\":45235032,\"gameId\":\"1\"}"; // note: ensure same separators as python
    let ts = "1683100800";
    let did = "Bexampledid==";

    let sign = calculate_sign(path, body, ts, did, token);
    // build header JSON string in exact order as Python: platform, timestamp, dId, vName
    let h_ca_str = format!(
        "{{\"platform\":\"1\",\"timestamp\":\"{}\",\"dId\":\"{}\",\"vName\":\"1.45.1\"}}",
        ts, did
    );
    // compute hex hmac for debugging
    let mut mac = HmacSha256::new_from_slice(token.as_bytes()).expect("HMAC key error");
    let raw = format!("{}{}{}{}", path, body, ts, h_ca_str);
    mac.update(raw.as_bytes());
    let result = mac.finalize().into_bytes();
    let hex_hmac = hex::encode(result);

    println!("Rust header json: {}", h_ca_str);
    println!("Rust raw: {}", raw);
    println!("Rust hmac hex: {}", hex_hmac);
    println!("Rust hmac hex len: {}", hex_hmac.len());
    println!("Rust hmac hex debug: {:?}", hex_hmac);
    // compute md5 in two ways for debug
    let md5_a = hex::encode(Md5::digest(hex_hmac.as_bytes()));
    println!("Rust sign (calculate_sign): {}", sign);
    println!("Rust md5_a: {}", md5_a);
}

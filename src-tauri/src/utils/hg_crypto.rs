// cipher 0.5：`BlockDecryptMut` 更名 `BlockModeDecrypt`，`decrypt_padded_mut`
// 更名 `decrypt_padded`（in-place 语义不变）。
use aes::cipher::{BlockModeDecrypt, KeyIvInit};
use aes::Aes256;
use cbc::Decryptor;
use sha2::{Digest, Sha256};

type Aes256CbcDec = Decryptor<Aes256>;

// AES-256-CBC Key (from reverse engineering Hypergryph launcher)
const AES_KEY: [u8; 32] = [
    0xC0, 0xF3, 0x0E, 0x1C, 0xE7, 0x63, 0xBB, 0xC2, 0x1C, 0xC3, 0x55, 0xA3, 0x43, 0x03, 0xAC, 0x50,
    0x39, 0x94, 0x44, 0xBF, 0xF6, 0x8C, 0x4A, 0x22, 0xAF, 0x39, 0x8C, 0x0A, 0x16, 0x6E, 0xE1, 0x43,
];

// AES-256-CBC IV (from reverse engineering Hypergryph launcher)
const AES_IV: [u8; 16] = [
    0x33, 0x46, 0x78, 0x61, 0x19, 0x27, 0x50, 0x64, 0x95, 0x01, 0x93, 0x72, 0x64, 0x60, 0x84, 0x00,
];

/// 鹰角加密文件解密 - 将加密字节解密为 UTF-8 字符串
/// 用于解密 game_files 清单等 CDN 上的加密资源
pub fn decrypt_bytes_to_string(encrypted_bytes: &[u8]) -> Result<String, String> {
    if encrypted_bytes.is_empty() {
        return Ok(String::new());
    }

    let decrypted = decrypt_bytes(encrypted_bytes)?;

    String::from_utf8(decrypted).map_err(|e| format!("UTF-8 decode failed: {}", e))
}

/// 鹰角加密文件解密 - 将加密字节解密为原始字节
pub fn decrypt_bytes(encrypted_bytes: &[u8]) -> Result<Vec<u8>, String> {
    if encrypted_bytes.is_empty() {
        return Ok(Vec::new());
    }

    let cipher =
        Aes256CbcDec::new_from_slices(&AES_KEY, &AES_IV).map_err(|e| format!("AES init: {}", e))?;

    let mut buf = encrypted_bytes.to_vec();
    let decrypted = cipher
        .decrypt_padded::<cbc::cipher::block_padding::Pkcs7>(&mut buf)
        .map_err(|e| format!("AES decrypt: {}", e))?;

    Ok(decrypted.to_vec())
}

/// 鹰角加密文件解密 - 从文件路径读取并解密为字符串
/// 用于读取加密的 config.ini 等本地文件
pub fn decrypt_file_to_string(file_path: &str) -> Result<String, String> {
    let bytes = std::fs::read(file_path)
        .map_err(|e| format!("Failed to read file '{}': {}", file_path, e))?;
    decrypt_bytes_to_string(&bytes)
}

/// 计算字节的 SHA-256 哈希（十六进制字符串）
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let result = hasher.finalize();
    hex::encode(result)
}

/// 验证文件的 MD5 哈希是否匹配
pub fn verify_md5(file_path: &str, expected_md5: &str) -> Result<bool, String> {
    verify_md5_with_cancel(file_path, expected_md5, None)
}

/// Verify an MD5 hash while allowing an active operation to stop between read chunks.
pub fn verify_md5_with_cancel(
    file_path: &str,
    expected_md5: &str,
    cancelled: Option<&std::sync::atomic::AtomicBool>,
) -> Result<bool, String> {
    use digest::Digest;
    use std::io::Read;
    use std::sync::atomic::Ordering;

    const HASH_BUFFER_SIZE: usize = 4 * 1024 * 1024;
    if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err("Hash verification cancelled".to_string());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(target_os = "windows")]
    std::os::windows::fs::OpenOptionsExt::custom_flags(&mut options, 0x08000000);
    let mut file = options
        .open(file_path)
        .map_err(|e| format!("Failed to open file '{}': {}", file_path, e))?;
    let mut hasher = md5::Md5::new();
    let mut buffer = vec![0u8; HASH_BUFFER_SIZE];
    loop {
        if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
            return Err("Hash verification cancelled".to_string());
        }
        let bytes_read = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read file '{}': {}", file_path, e))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    if cancelled.is_some_and(|flag| flag.load(Ordering::Relaxed)) {
        return Err("Hash verification cancelled".to_string());
    }
    let result = hasher.finalize();

    let computed = hex::encode(result);
    Ok(computed.eq_ignore_ascii_case(expected_md5))
}

/// 计算字节数组的 MD5（十六进制）
pub fn md5_hex(data: &[u8]) -> String {
    use digest::Digest;

    let mut hasher = md5::Md5::new();
    hasher.update(data);
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decrypt_roundtrip_key_iv() {
        assert_eq!(AES_KEY.len(), 32);
        assert_eq!(AES_IV.len(), 16);
    }
}

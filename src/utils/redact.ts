/**
 * 敏感信息遮罩工具。
 *
 * 用途：账户详情等界面不应把完整凭据渲染进 DOM —— 任何能读取 DOM 的脚本
 * （包括被注入的第三方脚本、浏览器扩展）都能直接读到明文。
 *
 * 后端对应实现见 `src-tauri/src/utils/redact.rs`；机密字段登记表见
 * `docs/secure_storage.md`。
 */

/**
 * 生成遮罩文本：保留首尾各 4 个字符，中间用 `***` 代替。
 *
 * 长度不足 9 的值整体隐藏（`***`），避免短凭据被推断。
 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return "";
  const chars = Array.from(value);
  if (chars.length <= 8) return "***";
  return `${chars.slice(0, 4).join("")}***${chars.slice(-4).join("")}`;
}

/**
 * 对可能包含令牌的自由文本做遮罩，处理 `key=value` 与 `key: value` 两种形态。
 *
 * 命中的参数名见 `SENSITIVE_KEYS`。
 */
const SENSITIVE_KEYS = new Set([
  "cred",
  "token",
  "u8token",
  "u8_token",
  "hytoken",
  "hy_token",
  "sign",
  "password",
  "passwd",
  "secret",
  "access_token",
  "refresh_token",
  "id_token",
  "session",
  "sessionid",
  "code",
  "device_token",
  "devicetoken",
  "phone",
  "mobile",
]);

export function redactText(text: string): string {
  if (!text) return text;
  // 匹配 `key=value` / `key: value`，key 允许引号包裹
  return text.replace(
    /(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1\s*([:=])\s*(["']?)([^"'\s,}&]+)\4/g,
    (match, q1: string, key: string, sep: string, q2: string, value: string) => {
      if (!SENSITIVE_KEYS.has(key.toLowerCase())) return match;
      return `${q1}${key}${q1}${sep}${q2}${maskSecret(value)}${q2}`;
    },
  );
}

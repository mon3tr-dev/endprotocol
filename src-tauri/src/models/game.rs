use serde::{Deserialize, Serialize};

/// 游戏渠道
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum GameChannel {
    /// 国服官服
    #[serde(rename = "official")]
    Official,
    /// 国服B服
    #[serde(rename = "bilibili")]
    Bilibili,
    /// 国际服
    #[serde(rename = "global")]
    Global,
    /// 国际服 Google Play
    #[serde(rename = "google_play")]
    GooglePlay,
}

impl GameChannel {
    pub fn as_str(&self) -> &'static str {
        match self {
            GameChannel::Official => "official",
            GameChannel::Bilibili => "bilibili",
            GameChannel::Global => "global",
            GameChannel::GooglePlay => "google_play",
        }
    }

    /// 返回 API URL
    pub fn api_url(&self) -> &'static str {
        match self {
            GameChannel::Official | GameChannel::Bilibili => {
                "https://launcher.hypergryph.com/api/proxy/batch_proxy"
            }
            GameChannel::Global | GameChannel::GooglePlay => {
                "https://launcher.gryphline.com/api/proxy/batch_proxy"
            }
        }
    }

    /// 返回 Web API URL (用于公告/背景图)
    pub fn web_api_url(&self) -> &'static str {
        match self {
            GameChannel::Official | GameChannel::Bilibili => {
                "https://launcher.hypergryph.com/api/proxy/web/batch_proxy"
            }
            GameChannel::Global | GameChannel::GooglePlay => {
                "https://launcher.gryphline.com/api/proxy/web/batch_proxy"
            }
        }
    }

    /// 返回 appcode
    pub fn app_code(&self) -> &'static str {
        match self {
            GameChannel::Official | GameChannel::Bilibili => "6LL0KJuqHBVz33WK",
            GameChannel::Global | GameChannel::GooglePlay => "YDUTE5gscDZ229CW",
        }
    }

    /// 返回 launcher_appcode
    pub fn launcher_app_code(&self) -> &'static str {
        match self {
            GameChannel::Official | GameChannel::Bilibili => "abYeZZ16BPluCFyT",
            GameChannel::Global | GameChannel::GooglePlay => "YDUTE5gscDZ229CW",
        }
    }

    /// 返回 channel
    pub fn channel(&self) -> &'static str {
        match self {
            GameChannel::Official => "1",
            GameChannel::Bilibili => "2",
            GameChannel::Global => "6",
            GameChannel::GooglePlay => "6",
        }
    }

    /// 返回 sub_channel
    pub fn sub_channel(&self) -> &'static str {
        match self {
            GameChannel::Official => "1",
            GameChannel::Bilibili => "2",
            GameChannel::Global => "6",
            GameChannel::GooglePlay => "802",
        }
    }

    /// 返回 seq
    pub fn seq(&self) -> &'static str {
        match self {
            GameChannel::Official | GameChannel::Bilibili => "5",
            GameChannel::Global | GameChannel::GooglePlay => "3",
        }
    }

    /// 游戏可执行文件名
    pub fn executable_name(&self) -> &'static str {
        "Endfield.exe"
    }

    /// 进程名（用于 tasklist/taskkill）
    pub fn process_name(&self) -> &'static str {
        "Endfield.exe"
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            GameChannel::Official => "终末地 官服",
            GameChannel::Bilibili => "终末地 B服",
            GameChannel::Global => "Endfield Global",
            GameChannel::GooglePlay => "Endfield Google Play",
        }
    }
}

/// 活跃操作（统一管理安装/校验/切服状态）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ActiveOperation {
    #[serde(rename = "installing")]
    Installing(OperationProgress),
    #[serde(rename = "verifying")]
    Verifying(OperationProgress),
    #[serde(rename = "repairing")]
    Repairing(OperationProgress),
    #[serde(rename = "switching")]
    Switching(SwitchProgress),
}

/// 通用操作进度（安装/校验/修复共用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationProgress {
    pub stage: String,
    pub downloaded: u64,
    pub total: u64,
    pub current_file: Option<String>,
    pub file_index: usize,
    pub file_count: usize,
    #[serde(default)]
    pub verified_bytes: u64,
}

/// 切服进度（含阶段和渠道信息）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchProgress {
    pub phase: String,
    pub downloaded: u64,
    pub total: u64,
    pub current_file: Option<String>,
    pub file_index: usize,
    pub file_count: usize,
    pub from_channel: String,
    pub to_channel: String,
}

/// 游戏安装状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameStatus {
    pub is_installed: bool,
    pub has_update: bool,
    pub local_version: Option<String>,
    pub remote_version: Option<String>,
    pub has_preload: bool,
    pub preload_version: Option<String>,
    /// 预下载分卷需下载的总字节数（`has_preload` 为 false 时为 0）
    #[serde(default)]
    pub preload_total_bytes: u64,
    pub preload_completed: bool,
    #[serde(default)]
    pub active_operation: Option<ActiveOperation>,
}

/// API 响应结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchProxyResponse {
    pub proxy_rsps: Vec<ProxyResponse>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyResponse {
    pub kind: String,
    #[serde(rename = "get_latest_game_rsp", skip_serializing_if = "Option::is_none")]
    pub get_latest_game_rsp: Option<GetLatestGameRsp>,
    #[serde(rename = "get_banner_rsp", skip_serializing_if = "Option::is_none")]
    pub get_banner_rsp: Option<BannerRsp>,
    #[serde(rename = "get_announcement_rsp", skip_serializing_if = "Option::is_none")]
    pub get_announcement_rsp: Option<AnnouncementRsp>,
    #[serde(rename = "get_main_bg_image_rsp", skip_serializing_if = "Option::is_none")]
    pub get_main_bg_image_rsp: Option<MainBgImageRsp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetLatestGameRsp {
    pub version: String,
    #[serde(default)]
    pub pkg: Option<PkgInfo>,
    /// 预下载补丁包（`pre_patch`）。
    ///
    /// 官方只在正式发版前提供，且仅当请求里带上本地版本号时才会返回；
    /// 请求不带版本（如全新安装）时该字段为 null。
    #[serde(default)]
    pub pre_patch: Option<PrePatch>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkgInfo {
    pub file_path: String,
}

/// 预下载补丁包（`get_latest_game_rsp.pre_patch`）
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PrePatch {
    /// 预下载目标版本（尚未正式发布的新版本）
    #[serde(default)]
    pub version: String,
    /// 官方客户端填写的版本，实测与 `version` 相同
    #[serde(default)]
    pub client_version: String,
    /// 分卷下载总字节数（字符串形式的数字，等于各分卷 `package_size` 之和）
    #[serde(default)]
    pub package_size: String,
    /// 解压后总字节数（字符串形式的数字）
    #[serde(default)]
    pub total_size: String,
    /// 分卷列表（`.zip.001`、`.zip.002` … 顺序拼接为一个 ZIP）
    #[serde(default)]
    pub patches: Vec<PatchPart>,
}

impl PrePatch {
    /// 各分卷下载字节数之和
    pub fn total_bytes(&self) -> u64 {
        self.patches.iter().map(|p| p.size()).sum()
    }
}

/// 预下载分卷条目
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PatchPart {
    /// CDN 地址（带 `auth_key` 查询串，过期后需重新请求 API）
    #[serde(default)]
    pub url: String,
    /// 分卷文件 MD5
    #[serde(default)]
    pub md5: String,
    /// 分卷字节数（字符串形式的数字）
    #[serde(default)]
    pub package_size: String,
}

impl PatchPart {
    /// 解析 `package_size`，解析失败按 0 处理
    pub fn size(&self) -> u64 {
        self.package_size.parse().unwrap_or(0)
    }
}

/// 清单文件条目（解密后的 NDJSON 格式）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestFile {
    pub path: String,
    pub md5: String,
    pub size: i64,
}

/// 游戏包信息（含版本和资源地址）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemotePackage {
    pub version: String,
    pub resource_base_url: String,
    pub has_preload: bool,
    pub preload_version: Option<String>,
    /// 预下载分卷列表（顺序即拼接顺序）
    pub preload_parts: Vec<PatchPart>,
    /// 预下载分卷下载字节数之和
    pub preload_total_bytes: u64,
}

/// 下载进度
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub stage: String,
    pub current_file: Option<String>,
    pub file_index: usize,
    pub file_count: usize,
    #[serde(default)]
    pub verified_bytes: u64,
}

impl Default for DownloadProgress {
    fn default() -> Self {
        Self {
            downloaded: 0,
            total: 0,
            stage: String::new(),
            current_file: None,
            file_index: 0,
            file_count: 0,
            verified_bytes: 0,
        }
    }
}

/// 安装/更新阶段
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum InstallStage {
    #[serde(rename = "checking")]
    Checking,
    #[serde(rename = "comparing")]
    Comparing,
    #[serde(rename = "downloading")]
    Downloading,
    #[serde(rename = "verifying")]
    Verifying,
    #[serde(rename = "repairing")]
    Repairing,
    /// 预下载（官方预发布补丁分卷下载）
    #[serde(rename = "preloading")]
    Preloading,
    #[serde(rename = "applying")]
    Applying,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "error")]
    Error,
}

impl InstallStage {
    pub fn as_str(&self) -> &'static str {
        match self {
            InstallStage::Checking => "checking",
            InstallStage::Comparing => "comparing",
            InstallStage::Downloading => "downloading",
            InstallStage::Verifying => "verifying",
            InstallStage::Repairing => "repairing",
            InstallStage::Preloading => "preloading",
            InstallStage::Applying => "applying",
            InstallStage::Completed => "completed",
            InstallStage::Error => "error",
        }
    }
}

/// 清单比较结果：需要下载的文件
#[derive(Debug, Clone)]
pub struct FilePlan {
    pub manifest: ManifestFile,
    pub source_path: Option<String>, // 本地已有的匹配文件路径
}

/// 持久化的 payload 状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PayloadState {
    pub channel: String,
    pub version: String,
    pub manifest_sha256: String,
    pub file_count: usize,
    pub total_bytes: u64,
    pub updated_at: String,
    #[serde(default)]
    pub preload_version: Option<String>,
    #[serde(default)]
    pub preload_completed: bool,
}

/// 安装/更新操作结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherResult {
    pub success: bool,
    pub message: String,
    pub version: Option<String>,
    /// 非致命提示（`<token>: <detail>`，见 utils/official_launcher.rs）。
    /// 目前只有「未找到签名有效的官方启动器，已回退到直接启动」会用到。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

// ========== Banner / Announcement / Background ==========

/// Banner 条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BannerItem {
    pub image_url: String,
    pub jump_url: String,
}

/// 公告条目
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnouncementItem {
    pub category: String,
    pub title: String,
    pub date: String,
    pub jump_url: String,
}

/// 公告内容（含 Banner + 公告列表）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LauncherNoticeContent {
    pub banners: Vec<BannerItem>,
    pub announcements: Vec<AnnouncementItem>,
}

/// Banner API 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BannerRsp {
    #[serde(default)]
    pub banners: Vec<BannerRspItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BannerRspItem {
    pub url: String,
    pub jump_url: String,
}

/// 公告 API 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnouncementRsp {
    #[serde(default, alias = "tab_list")]
    pub tabs: Vec<AnnouncementTab>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnouncementTab {
    #[serde(alias = "tab_name", alias = "tabName", default)]
    pub tab_name: String,
    #[serde(default)]
    pub announcements: Vec<AnnouncementApiItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnnouncementApiItem {
    #[serde(default)]
    pub content: String,
    #[serde(default, alias = "title")]
    pub title: Option<String>,
    #[serde(default, alias = "startTs", alias = "start_ts")]
    pub start_ts: Option<String>,
    #[serde(default, alias = "jumpUrl", alias = "jump_url")]
    pub jump_url: Option<String>,
}

/// 背景图 API 响应
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MainBgImageRsp {
    #[serde(rename = "main_bg_image", default)]
    pub main_bg_image: Option<MainBgImageData>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MainBgImageData {
    pub url: String,
    #[serde(default)]
    pub video_url: Option<String>,
}

/// 背景图信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundImage {
    pub url: String,
}

/// 启动器背景媒体（图片与视频地址一起返回，由前端按设置选择）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundMedia {
    #[serde(default)]
    pub image_url: Option<String>,
    #[serde(default)]
    pub video_url: Option<String>,
}

/// 安装目录扫描结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileScanResult {
    /// 渠道是否已识别
    pub channel_detected: bool,
    /// 识别到的渠道
    pub detected_channel: Option<String>,
    /// 清单中的总文件数
    pub total_files: usize,
    /// 已存在且完整的文件数
    pub valid_files: usize,
    /// 已存在但损坏的文件数
    pub corrupted_files: usize,
    /// 不存在的文件数
    pub missing_files: usize,
    /// 已存在文件的总字节数
    pub existing_bytes: u64,
    /// 需要下载的总字节数
    pub download_bytes: u64,
    /// 损坏的文件路径列表（最多20条）
    pub corrupted_file_list: Vec<String>,
    /// 不存在的文件路径列表（最多20条）
    pub missing_file_list: Vec<String>,
}

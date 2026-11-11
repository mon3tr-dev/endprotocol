//! 《明日方舟》寻访记录服务 —— `ak-webview.hypergryph.com` 的抓取、归一化与本地存储。
//!
//! # ⚠️ 与终末地抽卡**不是同一套 API**
//!
//! 两个游戏用的是**不同域名、不同端点、不同参数、不同翻页方式**，只有
//! "用 u8token 做鉴权" 这一件事是共用的。因此这里是**独立服务**，而不是在
//! [`crate::services::gacha_service::GachaService`] 里加分支 —— 后者一旦混进两套
//! 游标逻辑，任何一次改动都要同时照顾两个游戏的语义。
//!
//! | | 终末地（`gacha_service`） | **明日方舟（本文件）** |
//! | --- | --- | --- |
//! | 域名 | `ef-webview.hypergryph.com` | `ak-webview.hypergryph.com` |
//! | token 参数名 | `token` | **`code`** |
//! | 卡池枚举 | `GET /api/record/char/meta` → `tabs[]` | `GET /api/gacha/cate` → `categories[]` |
//! | 记录接口 | `GET /api/record/char` | `GET /api/gacha/history` |
//! | 卡池定位 | `pool_type` + `pool_id`（joint 类） | **`category`**（分类，不是 poolId） |
//! | 翻页游标 | `seq_id`（上一页末条，单值） | **`gachaTs` + `pos`（复合游标）** |
//! | `server_id` | 必填，恒 `"1"` | **不传**（传了也无效，渠道由 uid 决定） |
//! | 单页条数 | 由服务端决定 | 10 条 |
//! | 稀有度 | 就是星数（`6` = 六星） | **星数减一**（`5` = 六星） |
//! | 无效 token | `code=40100 Token is invalid` | **`code=0` + 空列表（静默失败）** |
//! | 记录有效期 | 全量 | **仅 90 天**（官方页面文案，见 `rollHistory_i18n`） |
//!
//! # 静默失败：必须显式判空
//!
//! 明日方舟接口对**任何**无效 token 都返回 `{"code":0,"data":[]}`，既不是 4xx 也不改
//! `code`。因此 [`ArknightsGachaService::get_categories`] 拿到空数组时**必须当作鉴权失败
//! 报错**，否则用户会看到"同步成功，0 条记录"，误以为账号没抽过卡。
//! （已用真实数据交叉验证：错误游戏/伪造的 u8token 都是 `code=0` + 空 `data`。）
//!
//! # 稀有度归一化
//!
//! 接口的 `rarity` 是 `星数 - 1`，而本地存档与前端统计（"六星数"、"六星间隔"）全部
//! 按**星数**工作（与终末地一致）。这里在入库时统一 `+1`，并同时合成 `seqId`，
//! 让上游拿到的 [`GachaRecord`] 与终末地形状一致 —— 前端因此可以共用同一套统计与图表。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Emitter};

use crate::models::gacha::{
    ArknightsGachaCategory, ArknightsGachaHistoryData, GachaPoolInfo, GachaRecord,
    GachaSyncProgress, GachaSyncResult, SavedGachaData,
};
use crate::utils::{capture, http_client, paths, AppError};
use crate::{log_debug, log_info, log_warn};

/// ak-webview 寻访记录服务基础 URL
const AK_WEBVIEW_BASE: &str = "https://ak-webview.hypergryph.com";

/// 与抓包一致的客户端 UA（`HGWebPC/1.40.3`，来自 `[3]/[4] request_ak-webview...txt`）
const AK_GACHA_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 6.2; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) QtWebEngine/5.15.8 Chrome/87.0.4280.144 Safari/537.36 PC/WIN/HGSDK HGWebPC/1.40.3";

/// 同步进度事件名（与终末地**共用**同一个事件，前端不需要订阅两次）
pub const GACHA_SYNC_PROGRESS_EVENT: &str = "gacha-sync-progress";

/// 分类 → 卡池类型映射用前缀（写入 `GachaPoolInfo.pool_type`，供前端分类筛选）
///
/// 前端 `poolKindOf` 靠 `poolType` 里是否含 `Joint` / `Standard` 判定联合与常驻，
/// 明日方舟没有这两个词，因此这里约定：`LIMITED_*` 与 `LINKAGE_*` → `Special`，
/// `CLASSIC_*` → `Standard`（中坚寻访在语义上就是常驻池）。
const AK_POOL_TYPE_SPECIAL: &str = "E_CharacterGachaPoolType_Special";
const AK_POOL_TYPE_STANDARD: &str = "E_CharacterGachaPoolType_Standard";

/// 安全阀：单个分类最多翻多少页。
///
/// 明日方舟一页 10 条，90 天窗口下单分类实测最多 12 页（120 条）。取 200 页
/// （2000 条）足以覆盖任何正常账号，同时防止服务端 `hasMore` 恒为 true 时死循环。
const AK_MAX_PAGES_PER_CATEGORY: usize = 200;

/// 无状态服务：负责《明日方舟》寻访记录的 API 抓取、归一化与本地存储
pub struct ArknightsGachaService {
    app_handle: Option<AppHandle>,
}

impl ArknightsGachaService {
    pub fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle: Some(app_handle),
        }
    }

    // ---------- API ----------

    /// `GET /api/gacha/cate`：获取卡池分类列表
    ///
    /// ⚠️ **空列表 = 鉴权失败**（明日方舟接口对无效 token 也返回 `code=0`），
    /// 因此这里把空数组转成 `AuthError`，而不是交给调用方当"没抽过卡"处理。
    pub async fn get_categories(
        &self,
        u8token: &str,
    ) -> Result<Vec<ArknightsGachaCategory>, AppError> {
        let categories: Vec<ArknightsGachaCategory> =
            self.get_api("/api/gacha/cate", &[], u8token).await?;

        if categories.is_empty() {
            // 这条分支是明日方舟特有的：终末地无效 token 会直接返回 code=40100，
            // 只有明日方舟用"空列表"表达失败，不显式判空就会静默同步 0 条。
            log_warn!(
                "arknights gacha: cate returned empty list (u8token_len={}) — treated as auth failure",
                u8token.len()
            );
            return Err(AppError::AuthError {
                message: "Arknights gacha token rejected by server (empty category list). \
                          The token may have expired, or it belongs to another account/game. \
                          Please re-authorize this role on the account page."
                    .to_string(),
            });
        }

        Ok(categories)
    }

    /// `GET /api/gacha/history`：拉取某一分类的一页记录
    ///
    /// `gacha_ts` + `pos` 是**复合游标**：传上一页最后一条的这两个值即可翻到下一页。
    /// 首次请求两者都不传。
    pub async fn get_history_page(
        &self,
        u8token: &str,
        category: &str,
        cursor: Option<(&str, i32)>,
    ) -> Result<ArknightsGachaHistoryData, AppError> {
        let mut params: Vec<(&str, String)> = Vec::with_capacity(3);
        params.push(("category", category.to_string()));
        if let Some((gacha_ts, pos)) = cursor {
            params.push(("gachaTs", gacha_ts.to_string()));
            params.push(("pos", pos.to_string()));
        }
        self.get_api("/api/gacha/history", &params, u8token).await
    }

    /// 从最新向前翻页拉取某分类的记录，遇到本地已保存的 seqId 即停止（不包含该条）
    ///
    /// 与终末地的 `fetch_pool_records_until_overlap` 逻辑意图相同，但游标完全不同：
    /// 这里是 `(gachaTs, pos)` 而不是单值 `seqId`，因此不能复用。
    async fn fetch_category_until_overlap(
        &self,
        u8token: &str,
        category: &str,
        saved_seq_ids: &HashSet<String>,
        mut progress: Option<(&mut GachaSyncProgress, usize)>,
    ) -> Result<Vec<GachaRecord>, AppError> {
        let mut result = Vec::new();
        let mut cursor: Option<(String, i32)> = None;
        let mut page_no = 0usize;

        loop {
            page_no += 1;
            if page_no > AK_MAX_PAGES_PER_CATEGORY {
                log_warn!(
                    "arknights gacha: category {} hit page guard ({}), stopping",
                    category,
                    AK_MAX_PAGES_PER_CATEGORY
                );
                break;
            }

            let page = self
                .get_history_page(
                    u8token,
                    category,
                    cursor.as_ref().map(|(ts, pos)| (ts.as_str(), *pos)),
                )
                .await?;

            log_debug!(
                "arknights gacha: category={} page={} -> {} records, hasMore={}",
                category,
                page_no,
                page.list.len(),
                page.has_more
            );

            let mut reached_saved = false;
            for raw in &page.list {
                let rec = Self::normalize(raw);
                if saved_seq_ids.contains(&rec.seq_id) {
                    reached_saved = true;
                    break;
                }
                result.push(rec);
            }

            if let Some((p, baseline)) = &mut progress {
                p.page = page_no as i32;
                p.tab_fetched = result.len();
                p.total_fetched = *baseline + result.len();
                self.emit_progress(p);
            }

            if reached_saved || !page.has_more || page.list.is_empty() {
                break;
            }

            // 下一页游标 = 本页最后一条的 (gachaTs, pos)
            let Some(last) = page.list.last() else { break };
            cursor = Some((last.gacha_ts.clone(), last.pos));
        }

        Ok(result)
    }

    // ---------- 归一化 ----------

    /// 把明日方舟原始记录转成与终末地同形状的 [`GachaRecord`]
    ///
    /// 两处关键转换：
    /// 1. **`rarity` 加一**：接口下发的是 `星数 - 1`，本地与前端一律按星数工作
    /// 2. **合成 `seqId`**：接口没有 seqId，用 `{poolId}|{gachaTs}|{pos}` 构造稳定唯一键
    ///    （已验证：210 条真实记录里 `(poolId, gachaTs, pos)` 无重复，且跨分类也不重复）
    pub fn normalize(raw: &crate::models::gacha::ArknightsGachaRecord) -> GachaRecord {
        GachaRecord {
            // 明日方舟没有"赠送十连"与武器寻访，全部按普通寻访处理
            kind: "draw".to_string(),
            pool_id: raw.pool_id.clone(),
            pool_name: raw.pool_name.clone(),
            name_text: raw.char_name.clone(),
            char_id: Some(raw.char_id.clone()),
            char_name: Some(raw.char_name.clone()),
            // 星数 = 接口值 + 1（接口 5 = 六星，本地 6 = 六星）
            rarity: Some(raw.rarity + 1),
            is_free: None,
            is_new: Some(raw.is_new),
            gacha_ts: raw.gacha_ts.clone(),
            seq_id: format!("{}|{}|{}", raw.pool_id, raw.gacha_ts, raw.pos),
            pos: Some(raw.pos),
        }
    }

    /// 卡池 id → 卡池类型（写进 `GachaPoolInfo.pool_type`）
    pub fn pool_type_of_pool_id(pool_id: &str) -> &'static str {
        if pool_id.starts_with("CLASSIC") {
            AK_POOL_TYPE_STANDARD
        } else {
            AK_POOL_TYPE_SPECIAL
        }
    }

    // ---------- 本地存储 ----------

    /// 寻访记录文件路径（gacha_records 子目录，按渠道绑定 uid 区分）
    pub fn records_file_path(&self, uid: &str) -> Result<PathBuf, AppError> {
        paths::arknights_gacha_records_file_path(uid).map_err(|e| AppError::ConfigError {
            message: e.to_string(),
        })
    }

    /// 读取本地保存的寻访记录；文件不存在时返回 None
    pub fn load_records(&self, uid: &str) -> Result<Option<SavedGachaData>, AppError> {
        let path = self.records_file_path(uid)?;
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)?;
        Ok(Some(serde_json::from_str(&content)?))
    }

    /// 读取本地记录；不存在时返回空结构
    pub fn load_records_or_empty(&self, uid: &str) -> Result<SavedGachaData, AppError> {
        Ok(self
            .load_records(uid)?
            .unwrap_or_else(|| SavedGachaData {
                user_id: uid.to_string(),
                // 明日方舟接口不吃 server_id，本地也用 uid 做唯一标识；
                // 保持 "1" 只是为了与终末地存档结构兼容（前端不区分）
                server_id: "1".to_string(),
                last_sync_time: None,
                pools: HashMap::new(),
                records: Vec::new(),
            }))
    }

    /// 保存寻访记录到本地文件
    pub fn save_records(&self, uid: &str, data: &SavedGachaData) -> Result<(), AppError> {
        let path = self.records_file_path(uid)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let content = serde_json::to_string_pretty(data)?;
        fs::write(&path, content)?;
        Ok(())
    }

    // ---------- 同步 ----------

    /// 增量同步《明日方舟》寻访记录：
    /// 1. `cate` 拿到全部分类（**空列表直接报鉴权失败**）
    /// 2. 每个分类从最新向前翻页，用 `(gachaTs, pos)` 游标，直到遇到本地已存的 seqId
    /// 3. 按合成 seqId 去重合并（全局从新到旧），重建卡池信息表并落盘
    pub async fn sync_records(&self, uid: &str, u8token: &str) -> Result<GachaSyncResult, AppError> {
        log_info!(
            "arknights gacha: sync START uid={} u8token_len={}",
            uid,
            u8token.len()
        );

        let mut saved = self.load_records_or_empty(uid)?;
        let saved_seq_ids: HashSet<String> =
            saved.records.iter().map(|r| r.seq_id.clone()).collect();
        log_info!(
            "arknights gacha: existing records={} pools={}",
            saved.records.len(),
            saved.pools.len()
        );

        let categories = self.get_categories(u8token).await?;
        log_info!("arknights gacha: categories={}", categories.len());

        let mut progress = GachaSyncProgress {
            user_id: uid.to_string(),
            server_id: "1".to_string(),
            tab_index: 0,
            tab_count: categories.len(),
            tab_key: String::new(),
            page: 0,
            tab_fetched: 0,
            total_fetched: 0,
            done: false,
        };

        let mut per_tab_new: HashMap<String, i32> = HashMap::new();
        let mut new_records: Vec<GachaRecord> = Vec::new();

        for (tab_index, category) in categories.iter().enumerate() {
            progress.tab_index = tab_index;
            // 进度里的 tab_key 用分类 id，前端 tabLabel 会兜底显示为「限定」
            progress.tab_key = category.id.clone();
            progress.page = 0;
            progress.tab_fetched = 0;
            let baseline = progress.total_fetched;

            let fetched = self
                .fetch_category_until_overlap(
                    u8token,
                    &category.id,
                    &saved_seq_ids,
                    Some((&mut progress, baseline)),
                )
                .await?;
            log_info!(
                "arknights gacha: category={} fetched_new={}",
                category.id,
                fetched.len()
            );
            per_tab_new.insert(category.id.clone(), fetched.len() as i32);
            progress.total_fetched = baseline + fetched.len();
            new_records.extend(fetched);
        }

        let before = saved.records.len();
        saved.records = Self::merge_records(&saved.records, &new_records);
        saved.pools = Self::build_pools_map(&categories, &saved.records);
        saved.last_sync_time = Some(Self::now_ms());

        self.save_records(uid, &saved)?;

        progress.done = true;
        self.emit_progress(&progress);

        let new_count = (saved.records.len() as i64 - before as i64).max(0) as i32;
        log_info!(
            "arknights gacha: sync DONE uid={} new={} total={}",
            uid,
            new_count,
            saved.records.len()
        );

        Ok(GachaSyncResult {
            user_id: uid.to_string(),
            server_id: "1".to_string(),
            synced_at: saved.last_sync_time.unwrap_or(0),
            new_records: new_count,
            total_records: saved.records.len() as i32,
            per_tab_new,
        })
    }

    // ---------- 工具方法 ----------

    /// 按 seqId 去重合并记录（新记录在前），结果保证全局从新到旧
    ///
    /// 排序键与终末地不同：明日方舟的 seqId 是 `{poolId}|{gachaTs}|{pos}`，**不是数字**，
    /// `parse::<i64>()` 会全部失败并退化成 0 —— 那样排序就只剩 `gacha_ts`，
    /// 同一次十连的 10 条会因顺序不稳定而在每次同步后抖动。因此这里显式带上 `pos`。
    pub fn merge_records(existing: &[GachaRecord], new_prefix: &[GachaRecord]) -> Vec<GachaRecord> {
        let mut seen: HashSet<String> = HashSet::new();
        let mut merged: Vec<GachaRecord> = Vec::with_capacity(existing.len() + new_prefix.len());
        for rec in new_prefix.iter().chain(existing.iter()) {
            if seen.insert(rec.seq_id.clone()) {
                merged.push(rec.clone());
            }
        }
        merged.sort_by(|a, b| {
            let a_key = (a.gacha_ts_ms().unwrap_or(0), a.pos.unwrap_or(0));
            let b_key = (b.gacha_ts_ms().unwrap_or(0), b.pos.unwrap_or(0));
            // 时间倒序（新在前）；同一次十连内 pos 倒序（9 在前），与接口下发顺序一致
            b_key.cmp(&a_key)
        });
        merged
    }

    /// 构建 poolId → 卡池信息
    ///
    /// 明日方舟的 `cate` 给的是**分类**（`anniver_fest` 等），与记录里的
    /// `poolId`（`LIMITED_79_0_1` 等）不是同一个 id，因此分类名无法直接填进
    /// 卡池表 —— 这里只用记录自带的 `poolName`，分类仅用于把"本次同步覆盖了哪些分类"
    /// 记进日志，不参与卡池表构建。
    pub fn build_pools_map(
        categories: &[ArknightsGachaCategory],
        records: &[GachaRecord],
    ) -> HashMap<String, GachaPoolInfo> {
        log_debug!(
            "arknights gacha: build_pools_map over {} categories / {} records",
            categories.len(),
            records.len()
        );
        let mut pools: HashMap<String, GachaPoolInfo> = HashMap::new();
        for rec in records {
            pools
                .entry(rec.pool_id.clone())
                .or_insert_with(|| GachaPoolInfo {
                    pool_name: rec.pool_name.clone(),
                    pool_type: Self::pool_type_of_pool_id(&rec.pool_id).to_string(),
                });
        }
        pools
    }

    fn now_ms() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    /// 推送同步进度事件给前端
    ///
    /// 与终末地**共用** `gacha-sync-progress` 事件名 —— 前端的进度弹窗不区分游戏，
    /// 玩家同一时刻只会同步一个角色，共用一个事件不会串台。
    fn emit_progress(&self, progress: &GachaSyncProgress) {
        if let Some(ref handle) = self.app_handle {
            let _ = handle.emit(GACHA_SYNC_PROGRESS_EVENT, progress);
        }
    }

    /// 统一 GET（UA/referer 与抓包一致），校验 `code == 0` 后返回 `data`
    ///
    /// 与终末地的 `get_api` 有四处**故意不同**：
    /// 1. token 参数名是 **`code`**（不是 `token`）
    /// 2. **不发** `server_id`（明日方舟接口不接受，渠道由 uid 决定）
    /// 3. **不发** `lang`（`cate` 的 `lang=en-us` 实测仍返回中文，接口忽略该参数）
    /// 4. Referer 指向 `/gacha` 页面，且不必带 `u8_token`（实测三种 Referer 结果一致）
    async fn get_api<T: serde::de::DeserializeOwned>(
        &self,
        endpoint: &str,
        params: &[(&str, String)],
        u8token: &str,
    ) -> Result<T, AppError> {
        let mut url =
            reqwest::Url::parse(&format!("{}{}", AK_WEBVIEW_BASE, endpoint)).map_err(|e| {
                AppError::ApiError {
                    code: 0,
                    message: format!("Invalid endpoint: {}", e),
                }
            })?;

        // `code` 用 query_pairs_mut 编码：u8token 里有 `+` `/` `=`，
        // 手工拼接会被服务端按表单语义解析（`+` 变成空格）。
        url.query_pairs_mut().append_pair("code", u8token);
        for (key, value) in params {
            url.query_pairs_mut().append_pair(key, value);
        }

        let client = http_client::create_client();
        log_debug!(
            "arknights gacha: GET {}",
            crate::utils::redact::redact_url(url.as_str())
        );
        let response = capture::send(
            &client,
            client
                .get(url)
                .header(reqwest::header::USER_AGENT, AK_GACHA_USER_AGENT)
                .header(
                    reqwest::header::REFERER,
                    format!("{}/gacha?lang=zh-cn", AK_WEBVIEW_BASE),
                )
                .header(reqwest::header::ACCEPT, "application/json, text/plain, */*"),
        )
        .await?;

        let response = response.error_for_status()?;
        let wrapper: crate::models::gacha::GachaApiResponse<T> = response.json().await?;
        if wrapper.code != 0 {
            return Err(AppError::ApiError {
                code: wrapper.code,
                message: wrapper.msg,
            });
        }
        wrapper.data.ok_or_else(|| AppError::ApiError {
            code: 0,
            message: "empty data".to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::gacha::ArknightsGachaRecord;

    fn raw(pool: &str, ts: &str, pos: i32, rarity: i32) -> ArknightsGachaRecord {
        ArknightsGachaRecord {
            pool_id: pool.to_string(),
            pool_name: "将雪投火".to_string(),
            char_id: format!("char_x_{}", pos),
            char_name: "测试".to_string(),
            rarity,
            is_new: false,
            gacha_ts: ts.to_string(),
            pos,
        }
    }

    #[test]
    fn normalize_offsets_rarity_by_one() {
        // 接口 5 → 六星
        let rec = ArknightsGachaService::normalize(&raw("LIMITED_79_0_1", "1794385957310", 0, 5));
        assert_eq!(rec.rarity, Some(6), "rarity 必须 +1");
        // 接口 0 → 一星
        let rec0 = ArknightsGachaService::normalize(&raw("LIMITED_79_0_1", "1", 0, 0));
        assert_eq!(rec0.rarity, Some(1));
    }

    #[test]
    fn normalize_builds_stable_seq_id() {
        let rec = ArknightsGachaService::normalize(&raw("LIMITED_79_0_1", "1794385957310", 3, 4));
        assert_eq!(rec.seq_id, "LIMITED_79_0_1|1794385957310|3");
        assert_eq!(rec.pos, Some(3));
        // 同一 (pool, ts, pos) 每次都得到同一个 seqId —— 增量去重的前提
        let again = ArknightsGachaService::normalize(&raw("LIMITED_79_0_1", "1794385957310", 3, 4));
        assert_eq!(rec.seq_id, again.seq_id);
    }

    #[test]
    fn normalize_marks_every_record_as_draw() {
        // 明日方舟没有赠送十连 / 武器寻访
        let rec = ArknightsGachaService::normalize(&raw("LIMITED_79_0_1", "1", 0, 4));
        assert!(rec.is_draw());
        assert!(!rec.is_gift());
        assert_eq!(rec.is_free, None);
    }

    #[test]
    fn merge_keeps_ten_pull_in_api_order() {
        // 同一次十连共用 gachaTs，pos 9..0；合并后必须仍是 9,8,...,0
        let new_records: Vec<GachaRecord> = (0..10)
            .rev()
            .map(|pos| ArknightsGachaService::normalize(&raw("LIMITED_79_0_1", "100", pos, 2)))
            .collect();
        let merged = ArknightsGachaService::merge_records(&[], &new_records);
        let poses: Vec<i32> = merged.iter().filter_map(|r| r.pos).collect();
        assert_eq!(poses, (0..10).rev().collect::<Vec<i32>>());
    }

    #[test]
    fn merge_dedups_by_seq_id() {
        let a = ArknightsGachaService::normalize(&raw("P1", "100", 0, 3));
        let b = ArknightsGachaService::normalize(&raw("P1", "90", 0, 3));
        let merged = ArknightsGachaService::merge_records(&[b.clone()], &[a.clone()]);
        assert_eq!(merged.len(), 2);
        // 再来一次同样的数据，不应增加
        let merged2 = ArknightsGachaService::merge_records(&merged, &[a]);
        assert_eq!(merged2.len(), 2);
    }

    #[test]
    fn pool_type_maps_classic_to_standard() {
        assert_eq!(
            ArknightsGachaService::pool_type_of_pool_id("CLASSIC_DOUBLE_78_0_2"),
            AK_POOL_TYPE_STANDARD
        );
        assert_eq!(
            ArknightsGachaService::pool_type_of_pool_id("LIMITED_79_0_1"),
            AK_POOL_TYPE_SPECIAL
        );
        assert_eq!(
            ArknightsGachaService::pool_type_of_pool_id("LINKAGE_77_0_1"),
            AK_POOL_TYPE_SPECIAL
        );
    }

    #[test]
    fn build_pools_map_uses_record_pool_names() {
        // cate 的分类 id 与记录 poolId 不是同一个东西，卡池名只能来自记录
        let categories = vec![ArknightsGachaCategory {
            id: "anniver_fest".to_string(),
            name: "限定寻访\n庆典".to_string(),
            active: Some(true),
        }];
        let records = vec![ArknightsGachaService::normalize(&raw(
            "LIMITED_79_0_1",
            "100",
            0,
            4,
        ))];
        let pools = ArknightsGachaService::build_pools_map(&categories, &records);
        assert_eq!(pools.len(), 1);
        assert_eq!(pools["LIMITED_79_0_1"].pool_name, "将雪投火");
        assert_eq!(
            pools["LIMITED_79_0_1"].pool_type,
            AK_POOL_TYPE_SPECIAL
        );
    }
}

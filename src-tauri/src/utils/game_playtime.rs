//! 游戏运行时长统计。
//!
//! 只在 EndProtocol 自身运行期间统计：后台每 [`POLL_SECONDS`] 秒探测一次游戏进程，
//! 进程出现即开始一段会话，进程消失即把这段时间累加到总时长并落盘。
//!
//! 边界约定：
//! - 软件启动时游戏已在运行 → 从软件启动时刻开始计时；
//! - 软件退出时游戏仍在运行 → 计到退出时刻（[`finalize`]）；
//! - 运行中每累积 [`FOLD_SECONDS`] 秒把已过去的时长折入总数并落盘，进程被强杀也只丢少量时长。

use std::sync::{Arc, Mutex as StdMutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::services::config_service::ConfigService;

/// 累计总时长在 `app_config.json` 中的键（单位：秒）。
pub const TOTAL_SECONDS_KEY: &str = "game_playtime_total_seconds";

/// 进程探测间隔（秒）。
const POLL_SECONDS: u64 = 5;

/// 运行中每累积多久把已过去的时长折入总数并落盘（秒）。
const FOLD_SECONDS: u64 = 60;

/// 游戏进程名（各渠道一致）。
const GAME_PROCESS_NAME: &str = "Endfield.exe";

/// 返回给前端的运行时长快照。
#[derive(Debug, Clone, Serialize)]
pub struct GamePlaytime {
    /// 已累计的总时长（不含当前正在进行的会话），单位秒。
    pub total_seconds: u64,
    /// 当前会话已运行的时长（未运行时为 0），单位秒。
    pub session_seconds: u64,
    /// 游戏进程当前是否在运行。
    pub running: bool,
}

struct Inner {
    total_seconds: u64,
    session_start: Option<u64>,
    running: bool,
    first_poll: bool,
    app_start: u64,
}

static STATE: OnceLock<StdMutex<Inner>> = OnceLock::new();
static CONFIG: OnceLock<Arc<StdMutex<ConfigService>>> = OnceLock::new();

fn state() -> &'static StdMutex<Inner> {
    STATE.get_or_init(|| {
        StdMutex::new(Inner {
            total_seconds: 0,
            session_start: None,
            running: false,
            first_poll: true,
            app_start: 0,
        })
    })
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// 载入已保存的总时长并启动后台探测。应在应用 setup 阶段调用一次。
pub fn init(config_service: Arc<StdMutex<ConfigService>>) {
    let total = config_service
        .lock()
        .ok()
        .and_then(|config| config.get::<u64>(TOTAL_SECONDS_KEY))
        .unwrap_or(0);

    let mut inner = state().lock().unwrap();
    inner.total_seconds = total;
    inner.session_start = None;
    inner.running = false;
    inner.first_poll = true;
    inner.app_start = now_secs();
    drop(inner);

    let _ = CONFIG.set(config_service);
    tauri::async_runtime::spawn(poll_loop());
}

async fn poll_loop() {
    loop {
        let running = crate::utils::process::is_process_running(GAME_PROCESS_NAME).await;
        update(running);
        tokio::time::sleep(Duration::from_secs(POLL_SECONDS)).await;
    }
}

fn update(running: bool) {
    let now = now_secs();
    let mut inner = state().lock().unwrap();

    // 会话开始：首次探测到运行（软件启动时游戏已在运行）从软件启动时刻算起，否则从此刻算起
    if running && !inner.running {
        inner.session_start = Some(if inner.first_poll { inner.app_start } else { now });
        inner.running = true;
        inner.first_poll = false;
        tracing::info!("[playtime] game session started");
        return;
    }

    // 会话结束：累加本段时长并落盘
    if !running && inner.running {
        if let Some(start) = inner.session_start.take() {
            inner.total_seconds = inner.total_seconds.saturating_add(now.saturating_sub(start));
        }
        inner.running = false;
        inner.first_poll = false;
        persist(&inner);
        tracing::info!(
            "[playtime] game session ended, total={}s",
            inner.total_seconds
        );
        return;
    }

    inner.first_poll = false;

    // 运行中：定期折叠已过去的时长并落盘，避免进程被强杀丢失整段时长
    if running {
        if let Some(start) = inner.session_start {
            let elapsed = now.saturating_sub(start);
            if elapsed >= FOLD_SECONDS {
                inner.total_seconds = inner.total_seconds.saturating_add(elapsed);
                inner.session_start = Some(now);
                persist(&inner);
            }
        }
    }
}

/// 返回当前运行时长快照（供前端展示）。
pub fn snapshot() -> GamePlaytime {
    let now = now_secs();
    let inner = state().lock().unwrap();
    let session_seconds = if inner.running {
        inner
            .session_start
            .map(|start| now.saturating_sub(start))
            .unwrap_or(0)
    } else {
        0
    };
    GamePlaytime {
        total_seconds: inner.total_seconds,
        session_seconds,
        running: inner.running,
    }
}

/// 应用退出时收尾：若游戏仍在运行，把当前会话计到此刻并落盘。
pub fn finalize() {
    let now = now_secs();
    let mut inner = state().lock().unwrap();
    if inner.running {
        if let Some(start) = inner.session_start.take() {
            inner.total_seconds = inner.total_seconds.saturating_add(now.saturating_sub(start));
        }
        inner.running = false;
    }
    persist(&inner);
}

fn persist(inner: &Inner) {
    let Some(config) = CONFIG.get() else {
        return;
    };
    let Ok(mut config) = config.lock() else {
        return;
    };
    if let Err(error) = config.set(
        TOTAL_SECONDS_KEY.to_string(),
        serde_json::Value::from(inner.total_seconds),
    ) {
        tracing::warn!("[playtime] failed to persist total: {error}");
    }
}

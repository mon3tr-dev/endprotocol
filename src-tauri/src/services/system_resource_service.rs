//! 本机系统资源采集服务。
//!
//! 使用 `sysinfo` 采集 CPU / 内存 / 磁盘 / 网络，并通过 `nvidia-smi` 尽力采集
//! GPU 指标。所有采集失败都以「空数据 + errors 文案」的形式返回，绝不 panic，
//! 由前端决定如何友好提示。

use serde::Serialize;
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use sysinfo::{Components, CpuRefreshKind, Disks, Networks, System};

/// 温度读数（CPU / 主板 / 硬盘等）。
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TemperatureReading {
    pub label: String,
    pub celsius: f32,
    pub max_celsius: Option<f32>,
    pub critical_celsius: Option<f32>,
}

/// 单个 CPU 核心信息。
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CpuCoreInfo {
    pub name: String,
    pub usage_percent: f32,
    pub frequency_mhz: u64,
}

/// CPU 指标。
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub brand: String,
    pub usage_percent: f32,
    pub per_core_percent: Vec<f32>,
    pub cores: Vec<CpuCoreInfo>,
    /// 实际频率（MHz）。Windows 下由 PDH「% Processor Performance」× 基准频率换算，
    /// 因此会随负载/睿频变化；无法获取时回退为标称频率。
    pub frequency_mhz: u64,
    /// `frequency_mhz` 是否为实测值
    pub frequency_is_actual: bool,
    pub physical_cores: usize,
    pub logical_cores: usize,
    pub temperature_celsius: Option<f32>,
    pub temperatures: Vec<TemperatureReading>,
}

/// 内存 / Swap 指标。
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub free_bytes: u64,
    /// 近似缓存量（available - free），并非所有平台都精确。
    pub cached_bytes: u64,
    pub usage_percent: f32,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub swap_usage_percent: f32,
}

/// 单块 GPU 指标。无法获取的字段为 `None`。
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub index: u32,
    pub name: String,
    pub usage_percent: Option<f32>,
    pub memory_total_bytes: Option<u64>,
    pub memory_used_bytes: Option<u64>,
    pub temperature_celsius: Option<f32>,
    pub power_watts: Option<f32>,
    pub fan_percent: Option<f32>,
}

/// 磁盘 / 分区指标。
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub id: String,
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub total_bytes: u64,
    pub available_bytes: u64,
    pub used_bytes: u64,
    pub usage_percent: f32,
    pub read_bytes_per_sec: f64,
    pub write_bytes_per_sec: f64,
    pub total_read_bytes: u64,
    pub total_written_bytes: u64,
    pub is_removable: bool,
}

/// 网卡指标。
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInfo {
    pub id: String,
    pub name: String,
    pub received_bytes_per_sec: f64,
    pub transmitted_bytes_per_sec: f64,
    pub total_received_bytes: u64,
    pub total_transmitted_bytes: u64,
}

/// 一次完整采集的结果。
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub timestamp_ms: u64,
    pub host_name: Option<String>,
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub long_os_version: Option<String>,
    pub kernel_version: Option<String>,
    pub uptime_sec: u64,
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub gpus: Vec<GpuInfo>,
    pub disks: Vec<DiskInfo>,
    pub networks: Vec<NetworkInfo>,
    /// 采集过程中的非致命错误提示（前端可展示为友好提示）。
    pub errors: Vec<String>,
}

/// 有状态的资源采集器。需要跨调用保存上一次采样点以计算速率。
pub struct SystemResourceService {
    system: System,
    disks: Disks,
    networks: Networks,
    components: Components,
    last_tick: Instant,
    temperatures_at: Option<Instant>,
    gpu_cache: Vec<GpuInfo>,
    gpu_cache_at: Option<Instant>,
    /// PDH「% Processor Performance」后台采样值（>100 表示睿频）
    cpu_perf_percent: Arc<Mutex<Option<f64>>>,
}

const TEMPERATURE_REFRESH_INTERVAL: Duration = Duration::from_secs(3);
const GPU_REFRESH_INTERVAL: Duration = Duration::from_secs(2);

impl SystemResourceService {
    pub fn new() -> Self {
        let mut system = System::new();
        // 只初始化 CPU 列表与内存，避免在应用启动时枚举全部进程。
        system.refresh_cpu_list(CpuRefreshKind::nothing());
        system.refresh_memory();
        let disks = Disks::new_with_refreshed_list();
        let networks = Networks::new_with_refreshed_list();
        // 温度传感器首次采集较慢，延迟到第一次 snapshot 时刷新。
        let components = Components::new();
        let cpu_perf_percent = Arc::new(Mutex::new(None));
        spawn_cpu_performance_thread(cpu_perf_percent.clone());

        Self {
            system,
            disks,
            networks,
            components,
            last_tick: Instant::now(),
            temperatures_at: None,
            gpu_cache: Vec::new(),
            gpu_cache_at: None,
            cpu_perf_percent,
        }
    }

    /// 采集一次完整快照。所有子项都是「尽力而为」，失败不会中断整体采集。
    pub fn snapshot(&mut self) -> SystemSnapshot {
        let now = Instant::now();
        let elapsed_secs = now.duration_since(self.last_tick).as_secs_f64().max(0.001);
        self.last_tick = now;

        let mut errors: Vec<String> = Vec::new();

        self.system.refresh_cpu_all();
        self.system.refresh_memory();

        let cpu = self.collect_cpu();
        let memory = self.collect_memory();
        let disks = self.collect_disks(elapsed_secs, &mut errors);
        let networks = self.collect_networks(elapsed_secs);
        let gpus = self.collect_gpus(&mut errors);

        SystemSnapshot {
            timestamp_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            host_name: System::host_name(),
            os_name: System::name(),
            os_version: System::os_version(),
            long_os_version: System::long_os_version(),
            kernel_version: System::kernel_version(),
            uptime_sec: System::uptime(),
            cpu,
            memory,
            gpus,
            disks,
            networks,
            errors,
        }
    }

    fn collect_cpu(&mut self) -> CpuInfo {
        let cpus = self.system.cpus();
        let logical_cores = cpus.len();

        let cores: Vec<CpuCoreInfo> = cpus
            .iter()
            .map(|cpu| CpuCoreInfo {
                name: cpu.name().to_string(),
                usage_percent: round2(cpu.cpu_usage()),
                frequency_mhz: cpu.frequency(),
            })
            .collect();

        let per_core_percent: Vec<f32> = cores.iter().map(|c| c.usage_percent).collect();
        let nominal_mhz = if cores.is_empty() {
            0
        } else {
            (cores.iter().map(|c| c.frequency_mhz).sum::<u64>() / logical_cores as u64) as u64
        };

        // 标称频率 ×「% Processor Performance」= 当前实际频率（含睿频）
        let perf = self
            .cpu_perf_percent
            .lock()
            .ok()
            .and_then(|guard| *guard);
        let (frequency_mhz, frequency_is_actual) = match perf {
            Some(percent) if nominal_mhz > 0 && percent > 0.0 => (
                ((nominal_mhz as f64) * percent / 100.0).round() as u64,
                true,
            ),
            _ => (nominal_mhz, false),
        };

        let brand = cpus
            .first()
            .map(|c| {
                let b = c.brand().trim();
                if b.is_empty() {
                    c.vendor_id().trim().to_string()
                } else {
                    b.to_string()
                }
            })
            .unwrap_or_default();

        let temperatures = self.collect_temperatures();
        let temperature_celsius = pick_cpu_temperature(&temperatures);

        CpuInfo {
            brand,
            usage_percent: round2(self.system.global_cpu_usage()),
            per_core_percent,
            cores,
            frequency_mhz,
            frequency_is_actual,
            physical_cores: System::physical_core_count().unwrap_or(logical_cores),
            logical_cores,
            temperature_celsius,
            temperatures,
        }
    }

    fn collect_temperatures(&mut self) -> Vec<TemperatureReading> {
        let stale = self
            .temperatures_at
            .map(|t| t.elapsed() >= TEMPERATURE_REFRESH_INTERVAL)
            .unwrap_or(true);
        if stale {
            self.components.refresh(true);
            self.temperatures_at = Some(Instant::now());
        }

        let readings: Vec<TemperatureReading> = self
            .components
            .list()
            .iter()
            .filter_map(|component| {
                component.temperature().map(|celsius| TemperatureReading {
                    label: component.label().to_string(),
                    celsius: round2(celsius),
                    max_celsius: component.max().map(round2),
                    critical_celsius: component.critical().map(round2),
                })
            })
            .collect();

        if readings.is_empty() {
            crate::log_debug!("[system_resource] no temperature sensors reported");
        }
        readings
    }

    fn collect_memory(&self) -> MemoryInfo {
        let total = self.system.total_memory();
        let used = self.system.used_memory();
        let available = self.system.available_memory();
        let free = self.system.free_memory();
        let swap_total = self.system.total_swap();
        let swap_used = self.system.used_swap();

        MemoryInfo {
            total_bytes: total,
            used_bytes: used,
            available_bytes: available,
            free_bytes: free,
            cached_bytes: available.saturating_sub(free),
            usage_percent: percent(used, total),
            swap_total_bytes: swap_total,
            swap_used_bytes: swap_used,
            swap_usage_percent: percent(swap_used, swap_total),
        }
    }

    fn collect_disks(&mut self, elapsed_secs: f64, errors: &mut Vec<String>) -> Vec<DiskInfo> {
        self.disks.refresh(true);

        let mut result: Vec<DiskInfo> = self
            .disks
            .list()
            .iter()
            .map(|disk| {
                let total = disk.total_space();
                let available = disk.available_space();
                let used = total.saturating_sub(available);
                let usage = disk.usage();
                let name = disk.name().to_string_lossy().to_string();
                let mount = disk.mount_point().to_string_lossy().to_string();
                DiskInfo {
                    id: if mount.is_empty() {
                        name.clone()
                    } else {
                        mount.clone()
                    },
                    name,
                    mount_point: mount,
                    file_system: disk.file_system().to_string_lossy().to_string(),
                    total_bytes: total,
                    available_bytes: available,
                    used_bytes: used,
                    usage_percent: percent(used, total),
                    read_bytes_per_sec: usage.read_bytes as f64 / elapsed_secs,
                    write_bytes_per_sec: usage.written_bytes as f64 / elapsed_secs,
                    total_read_bytes: usage.total_read_bytes,
                    total_written_bytes: usage.total_written_bytes,
                    is_removable: disk.is_removable(),
                }
            })
            .collect();

        // 大容量分区排前，便于前端默认选择系统盘。
        result.sort_by(|a, b| b.total_bytes.cmp(&a.total_bytes));
        if result.is_empty() {
            errors.push("no_disk".to_string());
        }
        result
    }

    fn collect_networks(&mut self, elapsed_secs: f64) -> Vec<NetworkInfo> {
        self.networks.refresh(true);

        let mut result: Vec<NetworkInfo> = self
            .networks
            .list()
            .iter()
            .map(|(name, data)| NetworkInfo {
                id: name.clone(),
                name: name.clone(),
                received_bytes_per_sec: data.received() as f64 / elapsed_secs,
                transmitted_bytes_per_sec: data.transmitted() as f64 / elapsed_secs,
                total_received_bytes: data.total_received(),
                total_transmitted_bytes: data.total_transmitted(),
            })
            .collect();

        // 活跃网卡优先。
        result.sort_by(|a, b| {
            let a_active = a.received_bytes_per_sec + a.transmitted_bytes_per_sec;
            let b_active = b.received_bytes_per_sec + b.transmitted_bytes_per_sec;
            b_active
                .partial_cmp(&a_active)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        result
    }

    fn collect_gpus(&mut self, errors: &mut Vec<String>) -> Vec<GpuInfo> {
        let stale = self
            .gpu_cache_at
            .map(|t| t.elapsed() >= GPU_REFRESH_INTERVAL)
            .unwrap_or(true);
        if !stale {
            return self.gpu_cache.clone();
        }

        match probe_nvidia_smi() {
            Ok(gpus) => {
                if gpus.is_empty() {
                    errors.push("gpu_unavailable".to_string());
                }
                self.gpu_cache = gpus;
            }
            Err(_) => {
                errors.push("gpu_unavailable".to_string());
                self.gpu_cache = Vec::new();
            }
        }
        self.gpu_cache_at = Some(Instant::now());
        self.gpu_cache.clone()
    }
}

impl Default for SystemResourceService {
    fn default() -> Self {
        Self::new()
    }
}

/// 通过 nvidia-smi 采集 NVIDIA GPU 指标。非 NVIDIA / 未安装驱动时返回 Err。
fn probe_nvidia_smi() -> Result<Vec<GpuInfo>, String> {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=index,name,utilization.gpu,memory.total,memory.used,temperature.gpu,power.draw,fan.speed",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err("nvidia-smi failed".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut gpus = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split(',').map(|p| p.trim()).collect();
        if parts.len() < 8 {
            continue;
        }
        gpus.push(GpuInfo {
            index: parts[0].parse().unwrap_or(0),
            name: parts[1].to_string(),
            usage_percent: parse_metric(parts[2]),
            memory_total_bytes: parse_metric(parts[3]).map(|mib| (mib as u64) * 1024 * 1024),
            memory_used_bytes: parse_metric(parts[4]).map(|mib| (mib as u64) * 1024 * 1024),
            temperature_celsius: parse_metric(parts[5]),
            power_watts: parse_metric(parts[6]),
            fan_percent: parse_metric(parts[7]),
        });
    }

    if gpus.is_empty() {
        return Err("no nvidia gpu".to_string());
    }
    Ok(gpus)
}

/// 解析 nvidia-smi 的数值单元格，`[N/A]` 等无效值返回 None。
fn parse_metric(raw: &str) -> Option<f32> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.contains("N/A") {
        return None;
    }
    trimmed.parse::<f32>().ok()
}

fn percent(part: u64, whole: u64) -> f32 {
    if whole == 0 {
        return 0.0;
    }
    round2(part as f32 / whole as f32 * 100.0)
}

fn round2(value: f32) -> f32 {
    (value * 100.0).round() / 100.0
}

fn pick_cpu_temperature(readings: &[TemperatureReading]) -> Option<f32> {
    if readings.is_empty() {
        return None;
    }
    let cpu = readings.iter().find(|r| {
        let label = r.label.to_lowercase();
        label.contains("cpu") || label.contains("package") || label.contains("tctl") || label.contains("tdie")
    });
    let chosen = cpu.unwrap_or_else(|| {
        readings
            .iter()
            .max_by(|a, b| a.celsius.partial_cmp(&b.celsius).unwrap_or(std::cmp::Ordering::Equal))
            .unwrap()
    });
    Some(chosen.celsius)
}

/// 后台线程：每秒采样一次 PDH「% Processor Performance」，写入共享缓存。
///
/// Windows 的 `PROCESSOR_POWER_INFORMATION`（sysinfo 采用的来源）返回的是标称频率，
/// 无法反映睿频/降频；`% Processor Performance` 是相对基准频率的百分比（睿频时 >100），
/// 两者相乘即得当前实际频率。PDH 句柄非 `Send`，因此整个查询生命周期都在本线程内。
#[cfg(windows)]
fn spawn_cpu_performance_thread(cache: Arc<Mutex<Option<f64>>>) {
    use windows_sys::Win32::System::Performance::{
        PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData,
        PdhGetFormattedCounterValue, PdhOpenQueryW, PDH_FMT_COUNTERVALUE, PDH_FMT_DOUBLE,
        PDH_HCOUNTER, PDH_HQUERY,
    };

    std::thread::spawn(move || unsafe {
        let mut query: PDH_HQUERY = std::ptr::null_mut();
        if PdhOpenQueryW(std::ptr::null(), 0, &mut query) != 0 {
            crate::log_warn!("[system_resource] PdhOpenQuery failed, CPU frequency falls back to nominal");
            return;
        }
        let path: Vec<u16> = "\\Processor Information(_Total)\\% Processor Performance\0"
            .encode_utf16()
            .collect();
        let mut counter: PDH_HCOUNTER = std::ptr::null_mut();
        if PdhAddEnglishCounterW(query, path.as_ptr(), 0, &mut counter) != 0 {
            crate::log_warn!("[system_resource] % Processor Performance counter unavailable");
            PdhCloseQuery(query);
            return;
        }
        // 首次采集用于建立基线
        let _ = PdhCollectQueryData(query);
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if PdhCollectQueryData(query) != 0 {
                continue;
            }
            let mut value = PDH_FMT_COUNTERVALUE::default();
            let status = PdhGetFormattedCounterValue(
                counter,
                PDH_FMT_DOUBLE,
                std::ptr::null_mut(),
                &mut value,
            );
            if status != 0 || value.CStatus != 0 {
                continue;
            }
            let percent = value.Anonymous.doubleValue;
            if percent > 0.0 {
                if let Ok(mut guard) = cache.lock() {
                    *guard = Some(percent);
                }
            }
        }
    });
}

#[cfg(not(windows))]
fn spawn_cpu_performance_thread(_cache: Arc<Mutex<Option<f64>>>) {
    // 非 Windows 平台暂不支持实测频率，保持 None（回退标称频率）
}

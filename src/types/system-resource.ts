// 系统资源卡片类型定义（指标目录、卡片配置、全局默认值）

/** 指标所属类别 */
export type ResourceCategory =
  | "cpu"
  | "gpu"
  | "memory"
  | "disk"
  | "network"
  | "system";

/** 指标的显示模式 */
export type MetricDisplayMode =
  | "value"
  | "percent"
  | "bar"
  | "ring"
  | "sparkline";

/** 指标的取值语义，决定格式化方式 */
export type MetricValueKind =
  | "percent"
  | "bytes"
  | "bytesRate"
  | "frequency"
  | "temperature"
  | "power"
  | "rpm"
  | "count";

/** 字节单位制式 */
export type ByteUnitSystem = "auto" | "binary" | "decimal" | "bit";

export type MetricPrecision = 0 | 1 | 2 | 3;

/** 卡片尺寸档位（小 2×2 / 中 3×3 / 大 4×3） */
export type SystemResourceSizeTier = "small" | "medium" | "large";

export interface SystemResourceSizePreset {
  tier: SystemResourceSizeTier;
  labelKey: string;
  w: number;
  h: number;
}

/** 三档固定尺寸（卡片指标数不受尺寸容量限制） */
export const SIZE_PRESETS: SystemResourceSizePreset[] = [
  { tier: "small", labelKey: "system_resource_size_small", w: 2, h: 2 },
  { tier: "medium", labelKey: "system_resource_size_medium", w: 3, h: 3 },
  { tier: "large", labelKey: "system_resource_size_large", w: 4, h: 3 },
];

/** 由网格尺寸推断档位（小的更小、大的更大） */
export function sizeTier(w: number, h: number): SystemResourceSizeTier {
  if (w <= 2 && h <= 2) return "small";
  if (w <= 3) return "medium";
  return "large";
}

export type ResourceMetricId =
  | "cpu_usage"
  | "cpu_frequency"
  | "cpu_temperature"
  | "gpu_usage"
  | "gpu_memory"
  | "gpu_temperature"
  | "gpu_power"
  | "gpu_fan"
  | "memory_used"
  | "memory_percent"
  | "swap_percent"
  | "disk_percent"
  | "disk_read"
  | "disk_write"
  | "net_down"
  | "net_up"
  | "net_total";

export interface MetricDefinition {
  id: ResourceMetricId;
  category: ResourceCategory;
  kind: MetricValueKind;
  /** i18n key（注册进 `card` 命名空间，使用 `t("card:<key>")`） */
  labelKey: string;
  defaultDisplay: MetricDisplayMode;
  /** 该指标是否天然可表示为 0-100 百分比 */
  percentual: boolean;
  /** 该指标是否需要选择设备（GPU / 磁盘 / 网卡） */
  deviceScope?: "gpu" | "disk" | "network";
}

export const METRIC_CATALOG: Record<ResourceMetricId, MetricDefinition> = {
  cpu_usage: {
    id: "cpu_usage",
    category: "cpu",
    kind: "percent",
    labelKey: "system_resource_metric_cpu_usage",
    defaultDisplay: "percent",
    percentual: true,
  },
  cpu_frequency: {
    id: "cpu_frequency",
    category: "cpu",
    kind: "frequency",
    labelKey: "system_resource_metric_cpu_frequency",
    defaultDisplay: "value",
    percentual: false,
  },
  cpu_temperature: {
    id: "cpu_temperature",
    category: "cpu",
    kind: "temperature",
    labelKey: "system_resource_metric_cpu_temperature",
    defaultDisplay: "value",
    percentual: false,
  },
  gpu_usage: {
    id: "gpu_usage",
    category: "gpu",
    kind: "percent",
    labelKey: "system_resource_metric_gpu_usage",
    defaultDisplay: "percent",
    percentual: true,
    deviceScope: "gpu",
  },
  gpu_memory: {
    id: "gpu_memory",
    category: "gpu",
    kind: "bytes",
    labelKey: "system_resource_metric_gpu_memory",
    defaultDisplay: "value",
    percentual: false,
    deviceScope: "gpu",
  },
  gpu_temperature: {
    id: "gpu_temperature",
    category: "gpu",
    kind: "temperature",
    labelKey: "system_resource_metric_gpu_temperature",
    defaultDisplay: "value",
    percentual: false,
    deviceScope: "gpu",
  },
  gpu_power: {
    id: "gpu_power",
    category: "gpu",
    kind: "power",
    labelKey: "system_resource_metric_gpu_power",
    defaultDisplay: "value",
    percentual: false,
    deviceScope: "gpu",
  },
  gpu_fan: {
    id: "gpu_fan",
    category: "gpu",
    kind: "rpm",
    labelKey: "system_resource_metric_gpu_fan",
    defaultDisplay: "value",
    percentual: false,
    deviceScope: "gpu",
  },
  memory_used: {
    id: "memory_used",
    category: "memory",
    kind: "bytes",
    labelKey: "system_resource_metric_memory_used",
    defaultDisplay: "value",
    percentual: false,
  },
  memory_percent: {
    id: "memory_percent",
    category: "memory",
    kind: "percent",
    labelKey: "system_resource_metric_memory_percent",
    defaultDisplay: "bar",
    percentual: true,
  },
  swap_percent: {
    id: "swap_percent",
    category: "memory",
    kind: "percent",
    labelKey: "system_resource_metric_swap_percent",
    defaultDisplay: "bar",
    percentual: true,
  },
  disk_percent: {
    id: "disk_percent",
    category: "disk",
    kind: "percent",
    labelKey: "system_resource_metric_disk_percent",
    defaultDisplay: "bar",
    percentual: true,
    deviceScope: "disk",
  },
  disk_read: {
    id: "disk_read",
    category: "disk",
    kind: "bytesRate",
    labelKey: "system_resource_metric_disk_read",
    defaultDisplay: "value",
    percentual: false,
    deviceScope: "disk",
  },
  disk_write: {
    id: "disk_write",
    category: "disk",
    kind: "bytesRate",
    labelKey: "system_resource_metric_disk_write",
    defaultDisplay: "value",
    percentual: false,
    deviceScope: "disk",
  },
  net_down: {
    id: "net_down",
    category: "network",
    kind: "bytesRate",
    labelKey: "system_resource_metric_net_down",
    defaultDisplay: "value",
    percentual: false,
    deviceScope: "network",
  },
  net_up: {
    id: "net_up",
    category: "network",
    kind: "bytesRate",
    labelKey: "system_resource_metric_net_up",
    defaultDisplay: "value",
    percentual: false,
    deviceScope: "network",
  },
  net_total: {
    id: "net_total",
    category: "network",
    kind: "bytesRate",
    labelKey: "system_resource_metric_net_total",
    defaultDisplay: "value",
    percentual: false,
    deviceScope: "network",
  },
};

/** 指标在「添加指标」列表中的展示顺序。 */
export const METRIC_ORDER: ResourceMetricId[] = [
  "cpu_usage",
  "cpu_frequency",
  "cpu_temperature",
  "gpu_usage",
  "gpu_memory",
  "gpu_temperature",
  "gpu_power",
  "gpu_fan",
  "memory_used",
  "memory_percent",
  "swap_percent",
  "disk_percent",
  "disk_read",
  "disk_write",
  "net_down",
  "net_up",
  "net_total",
];

export interface ResourceMetricConfig {
  id: ResourceMetricId;
  visible: boolean;
  display: MetricDisplayMode;
  /** 字节类指标的单位制式 */
  unit?: ByteUnitSystem;
  precision: MetricPrecision;
  color?: string;
  /** 告警阈值（百分比，0-100） */
  warn?: number;
  critical?: number;
  /** 设备选择：GPU 索引 / 磁盘 id / 网卡 id */
  scope?: string;
}

export interface SystemResourceCardSettings {
  /**
   * 配置结构版本：v2 默认开启历史曲线/120s 窗口；v3 移除卡内排列与已删除指标；
   * v4 小卡单指标并增加自动翻页默认值；v5 中/大卡不再按尺寸裁剪指标。
   */
  settingsVersion?: number;
  mode: "atomic" | "group";
  title?: string;
  refreshMs: number;
  accent?: string;
  showTitleBar: boolean;
  showSeparators: boolean;
  showLabels: boolean;
  showSparklines: boolean;
  /** 自动翻页间隔（毫秒）；0 = 关闭自动翻页 */
  rotateMs?: number;
  historyWindowSec: number;
  showPeakAvg: boolean;
  cpuScope?: "total" | "perCore" | "allCores";
  warnThreshold?: number;
  criticalThreshold?: number;
  /** 需要展示的指标（形态 A 只有一项） */
  metrics: ResourceMetricConfig[];
}

export interface SystemResourceDefaults {
  refreshMs: number;
  unitSystem: ByteUnitSystem;
  display: MetricDisplayMode;
  precision: MetricPrecision;
  warnThreshold: number;
  criticalThreshold: number;
  showSparklines: boolean;
  /** 默认自动翻页间隔（毫秒），0 = 关闭 */
  rotateMs: number;
  accent: string;
  /** 默认卡片组模板包含哪些指标 */
  template: ResourceMetricId[];
}

export const DEFAULT_SYSTEM_RESOURCE_DEFAULTS: SystemResourceDefaults = {
  refreshMs: 1000,
  unitSystem: "auto",
  display: "value",
  precision: 1,
  warnThreshold: 80,
  criticalThreshold: 95,
  showSparklines: true,
  rotateMs: 5000,
  accent: "#6366f1",
  template: ["cpu_usage", "gpu_usage", "memory_percent"],
};

export interface ResourceGroupTemplate {
  id: string;
  labelKey: string;
  icon: string;
  tier: SystemResourceSizeTier;
  metrics: ResourceMetricId[];
}

/** 预设卡片组（固定档位 + 固定指标，不再提供卡内排列）。 */
export const RESOURCE_GROUP_TEMPLATES: ResourceGroupTemplate[] = [
  {
    id: "cpu",
    labelKey: "system_resource_template_cpu",
    icon: "chart",
    tier: "medium",
    metrics: ["cpu_usage", "cpu_temperature", "cpu_frequency"],
  },
  {
    id: "gpu",
    labelKey: "system_resource_template_gpu",
    icon: "chart",
    tier: "large",
    metrics: ["gpu_usage", "gpu_memory", "gpu_temperature", "gpu_power"],
  },
  {
    id: "memory",
    labelKey: "system_resource_template_memory",
    icon: "chart",
    tier: "medium",
    metrics: ["memory_percent", "memory_used", "swap_percent"],
  },
  {
    id: "disk",
    labelKey: "system_resource_template_disk",
    icon: "chart",
    tier: "medium",
    metrics: ["disk_percent", "disk_read", "disk_write"],
  },
  {
    id: "network",
    labelKey: "system_resource_template_network",
    icon: "chart",
    tier: "medium",
    metrics: ["net_down", "net_up", "net_total"],
  },
  {
    id: "performance",
    labelKey: "system_resource_template_performance",
    icon: "chart",
    tier: "large",
    metrics: ["cpu_usage", "gpu_usage", "memory_percent", "cpu_temperature"],
  },
  {
    id: "full",
    labelKey: "system_resource_template_full",
    icon: "chart",
    tier: "large",
    metrics: ["cpu_usage", "gpu_usage", "memory_percent", "disk_percent"],
  },
];

export const REFRESH_PRESETS = [500, 1000, 2000, 5000, 10000];

export const RESOURCE_ACCENT_PRESETS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#a855f7",
  "#ec4899",
];

/** 由全局默认值 + 模板创建一个指标配置 */
export function createMetricConfig(
  id: ResourceMetricId,
  defaults?: Partial<SystemResourceDefaults>,
): ResourceMetricConfig {
  const def = METRIC_CATALOG[id];
  return {
    id,
    visible: true,
    display: defaults?.display ?? def.defaultDisplay,
    unit: defaults?.unitSystem ?? "auto",
    precision: defaults?.precision ?? 1,
    color: undefined,
    warn: def.percentual ? (defaults?.warnThreshold ?? 80) : undefined,
    critical: def.percentual ? (defaults?.criticalThreshold ?? 95) : undefined,
  };
}

/** 用全局默认值构建一张卡片的初始配置 */
export function buildDefaultCardSettings(
  mode: "atomic" | "group",
  metricIds: ResourceMetricId[],
  defaults: SystemResourceDefaults = DEFAULT_SYSTEM_RESOURCE_DEFAULTS,
): SystemResourceCardSettings {
  return {
    settingsVersion: 5,
    mode,
    refreshMs: defaults.refreshMs,
    accent: defaults.accent,
    showTitleBar: true,
    showSeparators: true,
    showLabels: true,
    showSparklines: defaults.showSparklines,
    rotateMs: defaults.rotateMs,
    historyWindowSec: 120,
    showPeakAvg: false,
    cpuScope: "total",
    warnThreshold: defaults.warnThreshold,
    criticalThreshold: defaults.criticalThreshold,
    metrics: metricIds.map((id) => createMetricConfig(id, defaults)),
  };
}

/* ------------------------------------------------------------------ */
/* 后端快照类型（与 Rust `SystemSnapshot` 的 camelCase 序列化一致）      */
/* ------------------------------------------------------------------ */

export interface TemperatureReading {
  label: string;
  celsius: number;
  maxCelsius?: number | null;
  criticalCelsius?: number | null;
}

export interface CpuCoreInfo {
  name: string;
  usagePercent: number;
  frequencyMhz: number;
}

export interface CpuSnapshot {
  brand: string;
  usagePercent: number;
  perCorePercent: number[];
  cores: CpuCoreInfo[];
  /** 当前实际频率（MHz，含睿频）；无法实测时为标称频率 */
  frequencyMhz: number;
  /** `frequencyMhz` 是否来自实测（PDH） */
  frequencyIsActual: boolean;
  physicalCores: number;
  logicalCores: number;
  temperatureCelsius?: number | null;
  temperatures: TemperatureReading[];
}

export interface MemorySnapshot {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  freeBytes: number;
  cachedBytes: number;
  usagePercent: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  swapUsagePercent: number;
}

export interface GpuSnapshot {
  index: number;
  name: string;
  usagePercent?: number | null;
  memoryTotalBytes?: number | null;
  memoryUsedBytes?: number | null;
  temperatureCelsius?: number | null;
  powerWatts?: number | null;
  fanPercent?: number | null;
}

export interface DiskSnapshot {
  id: string;
  name: string;
  mountPoint: string;
  fileSystem: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usagePercent: number;
  readBytesPerSec: number;
  writeBytesPerSec: number;
  totalReadBytes: number;
  totalWrittenBytes: number;
  isRemovable: boolean;
}

export interface NetworkSnapshot {
  id: string;
  name: string;
  receivedBytesPerSec: number;
  transmittedBytesPerSec: number;
  totalReceivedBytes: number;
  totalTransmittedBytes: number;
}

export interface SystemSnapshot {
  timestampMs: number;
  hostName?: string | null;
  osName?: string | null;
  osVersion?: string | null;
  longOsVersion?: string | null;
  kernelVersion?: string | null;
  uptimeSec: number;
  cpu: CpuSnapshot;
  memory: MemorySnapshot;
  gpus: GpuSnapshot[];
  disks: DiskSnapshot[];
  networks: NetworkSnapshot[];
  errors: string[];
}

// 指标解析与格式化：把后端快照 + 指标配置折算成可直接渲染的数值。

import type {
  ByteUnitSystem,
  DiskSnapshot,
  GpuSnapshot,
  MetricPrecision,
  NetworkSnapshot,
  ResourceMetricConfig,
  ResourceMetricId,
  SystemResourceCardSettings,
  SystemSnapshot,
} from "@/types/system-resource";
import { METRIC_CATALOG } from "@/types/system-resource";

export type MetricTone = "normal" | "warn" | "critical";

export interface ResolvedMetric {
  value: number | null;
  /** 用于进度条 / 环形图的 0-100 值 */
  percent: number | null;
  /** 主显示文本（不含单位） */
  text: string;
  unit: string;
  tone: MetricTone;
  /** 该指标是否可用（缺传感器 / 无设备时为 false） */
  available: boolean;
}

export function pickGpu(
  snapshot: SystemSnapshot,
  scope?: string,
): GpuSnapshot | null {
  if (!snapshot.gpus || snapshot.gpus.length === 0) return null;
  if (scope != null && scope !== "") {
    const index = Number(scope);
    const found = snapshot.gpus.find((g) => g.index === index);
    if (found) return found;
  }
  return snapshot.gpus[0];
}

export function pickDisk(
  snapshot: SystemSnapshot,
  scope?: string,
): DiskSnapshot | null {
  if (!snapshot.disks || snapshot.disks.length === 0) return null;
  if (scope) {
    const found = snapshot.disks.find((d) => d.id === scope);
    if (found) return found;
  }
  return snapshot.disks[0];
}

export function pickNetwork(
  snapshot: SystemSnapshot,
  scope?: string,
): NetworkSnapshot | null {
  if (!snapshot.networks || snapshot.networks.length === 0) return null;
  if (scope) {
    const found = snapshot.networks.find((n) => n.id === scope);
    if (found) return found;
  }
  return snapshot.networks[0];
}

/** 把原始数值格式化为「数值 + 单位」，按单位制式与精度处理。 */
export function formatBytes(
  bytes: number,
  unit: ByteUnitSystem = "auto",
  precision: MetricPrecision = 1,
): { value: number; unit: string } {
  if (!Number.isFinite(bytes)) return { value: 0, unit: "B" };

  if (unit === "bit") {
    const bits = bytes * 8;
    if (bits >= 1e9) return { value: round(bits / 1e9, precision), unit: "Gbit" };
    if (bits >= 1e6) return { value: round(bits / 1e6, precision), unit: "Mbit" };
    if (bits >= 1e3) return { value: round(bits / 1e3, precision), unit: "Kbit" };
    return { value: round(bits, precision), unit: "bit" };
  }

  const base = unit === "decimal" ? 1000 : 1024;
  const units =
    unit === "decimal"
      ? ["B", "KB", "MB", "GB", "TB", "PB"]
      : ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

  let value = Math.abs(bytes);
  let unitIndex = 0;
  while (value >= base && unitIndex < units.length - 1) {
    value /= base;
    unitIndex += 1;
  }
  return {
    value: round(bytes < 0 ? -value : value, precision),
    unit: units[unitIndex],
  };
}

export function formatRate(
  bytesPerSec: number,
  unit: ByteUnitSystem = "auto",
  precision: MetricPrecision = 1,
): { value: number; unit: string } {
  const formatted = formatBytes(bytesPerSec, unit, precision);
  return { value: formatted.value, unit: `${formatted.unit}/s` };
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

/**
 * 折线图坐标轴刻度格式化：按指标类型做单位换算（字节/速率/频率/温度…）。
 */
export function formatAxisValue(
  raw: number,
  config: ResourceMetricConfig,
): string {
  const definition = METRIC_CATALOG[config.id as ResourceMetricId];
  if (!definition) return String(Math.round(raw));
  const precision = Math.min(config.precision ?? 1, 1);
  const unitSystem = config.unit ?? "auto";

  if (definition.kind === "bytes") {
    const f = formatBytes(raw, unitSystem, precision as MetricPrecision);
    return `${f.value}${f.unit ? ` ${f.unit}` : ""}`;
  }
  if (definition.kind === "bytesRate") {
    const f = formatRate(raw, unitSystem, precision as MetricPrecision);
    return `${f.value} ${f.unit}`;
  }
  if (definition.kind === "percent") {
    return `${round(raw, 0)}%`;
  }
  if (definition.kind === "frequency") {
    return `${round(raw / 1000, precision)} GHz`;
  }
  if (definition.kind === "temperature") {
    return `${round(raw, precision)}°C`;
  }
  if (definition.kind === "power") {
    return `${round(raw, precision)} W`;
  }
  if (definition.kind === "rpm") {
    return `${round(raw, 0)}%`;
  }
  return `${round(raw, precision)}`;
}

function formatNumber(value: number, precision: number): string {
  return round(value, precision).toFixed(precision);
}

/** 按指标的展示单位格式化历史统计值（峰值/平均值）。 */
export function formatMetricValue(
  value: number,
  config: ResourceMetricConfig,
): string {
  const definition = METRIC_CATALOG[config.id as ResourceMetricId];
  if (!definition) return String(value);

  const precision = config.precision ?? 1;
  const unitSystem = config.unit ?? "auto";
  let formattedValue = value;
  let unit = "";

  switch (definition.kind) {
    case "bytes": {
      const formatted = formatBytes(value, unitSystem, precision);
      formattedValue = formatted.value;
      unit = formatted.unit;
      break;
    }
    case "bytesRate": {
      const formatted = formatRate(value, unitSystem, precision);
      formattedValue = formatted.value;
      unit = formatted.unit;
      break;
    }
    case "frequency":
      formattedValue = value / 1000;
      unit = "GHz";
      break;
    case "percent":
    case "rpm":
      unit = "%";
      break;
    case "temperature":
      unit = "°C";
      break;
    case "power":
      unit = "W";
      break;
    case "count":
      break;
  }

  return `${formatNumber(formattedValue, precision)}${unit ? ` ${unit}` : ""}`;
}

/**
 * 根据快照与配置解析单个指标。
 */
export function resolveMetric(
  snapshot: SystemSnapshot | null,
  config: ResourceMetricConfig,
  settings: SystemResourceCardSettings,
): ResolvedMetric {
  const definition = METRIC_CATALOG[config.id as ResourceMetricId];
  const precision = config.precision ?? 1;
  const unitSystem = config.unit ?? "auto";

  const empty: ResolvedMetric = {
    value: null,
    percent: null,
    text: "--",
    unit: "",
    tone: "normal",
    available: false,
  };
  if (!snapshot || !definition) return empty;

  const { cpu, memory } = snapshot;

  const makePercent = (
    value: number | null | undefined,
    label?: string,
  ): ResolvedMetric => {
    if (value == null || Number.isNaN(value)) return empty;
    const percent = clampPercent(value);
    return {
      value,
      percent,
      text: label ?? formatNumber(value, precision),
      unit: "%",
      tone: toneFor(percent, config, settings),
      available: true,
    };
  };

  const makeBytes = (value: number | null | undefined): ResolvedMetric => {
    if (value == null || Number.isNaN(value)) return empty;
    const { value: v, unit } = formatBytes(value, unitSystem, precision);
    return {
      value,
      percent: null,
      text: formatNumber(v, precision),
      unit,
      tone: "normal",
      available: true,
    };
  };

  const makeRate = (value: number | null | undefined): ResolvedMetric => {
    if (value == null || Number.isNaN(value)) return empty;
    const { value: v, unit } = formatRate(value, unitSystem, precision);
    return {
      value,
      percent: null,
      text: formatNumber(v, precision),
      unit,
      tone: "normal",
      available: true,
    };
  };

  switch (definition.id) {
    case "cpu_usage":
      return makePercent(cpu.usagePercent);
    case "cpu_frequency": {
      if (!cpu.frequencyMhz) return empty;
      const ghz = cpu.frequencyMhz / 1000;
      return {
        value: cpu.frequencyMhz,
        percent: null,
        text: formatNumber(ghz, precision),
        // 后端优先返回 PDH 实测频率（含睿频），无法实测时回退标称频率
        unit: "GHz",
        tone: "normal",
        available: true,
      };
    }
    case "cpu_temperature": {
      const temp = cpu.temperatureCelsius;
      if (temp == null) return empty;
      return {
        value: temp,
        percent: clampPercent((temp / 100) * 100),
        text: formatNumber(temp, precision),
        unit: "°C",
        tone: toneFor(temp, config, settings, true),
        available: true,
      };
    }
    case "memory_used":
      return makeBytes(memory.usedBytes);
    case "memory_percent":
      return makePercent(memory.usagePercent);
    case "swap_percent":
      return makePercent(memory.swapUsagePercent);
    case "gpu_usage": {
      const gpu = pickGpu(snapshot, config.scope);
      if (!gpu) return empty;
      return makePercent(gpu.usagePercent ?? null);
    }
    case "gpu_memory": {
      const gpu = pickGpu(snapshot, config.scope);
      if (!gpu) return empty;
      return makeBytes(gpu.memoryUsedBytes ?? null);
    }
    case "gpu_temperature": {
      const gpu = pickGpu(snapshot, config.scope);
      if (!gpu || gpu.temperatureCelsius == null) return empty;
      const temp = gpu.temperatureCelsius;
      return {
        value: temp,
        percent: clampPercent(temp),
        text: formatNumber(temp, precision),
        unit: "°C",
        tone: toneFor(temp, config, settings, true),
        available: true,
      };
    }
    case "gpu_power": {
      const gpu = pickGpu(snapshot, config.scope);
      if (!gpu || gpu.powerWatts == null) return empty;
      return {
        value: gpu.powerWatts,
        percent: null,
        text: formatNumber(gpu.powerWatts, precision),
        unit: "W",
        tone: "normal",
        available: true,
      };
    }
    case "gpu_fan": {
      const gpu = pickGpu(snapshot, config.scope);
      if (!gpu || gpu.fanPercent == null) return empty;
      return {
        value: gpu.fanPercent,
        percent: clampPercent(gpu.fanPercent),
        text: formatNumber(gpu.fanPercent, 0),
        unit: "%",
        tone: "normal",
        available: true,
      };
    }
    case "disk_percent": {
      const disk = pickDisk(snapshot, config.scope);
      if (!disk) return empty;
      return makePercent(disk.usagePercent);
    }
    case "disk_read": {
      const disk = pickDisk(snapshot, config.scope);
      if (!disk) return empty;
      return makeRate(disk.readBytesPerSec);
    }
    case "disk_write": {
      const disk = pickDisk(snapshot, config.scope);
      if (!disk) return empty;
      return makeRate(disk.writeBytesPerSec);
    }
    case "net_down": {
      const net = pickNetwork(snapshot, config.scope);
      if (!net) return empty;
      return makeRate(net.receivedBytesPerSec);
    }
    case "net_up": {
      const net = pickNetwork(snapshot, config.scope);
      if (!net) return empty;
      return makeRate(net.transmittedBytesPerSec);
    }
    case "net_total": {
      const net = pickNetwork(snapshot, config.scope);
      if (!net) return empty;
      return makeRate(net.receivedBytesPerSec + net.transmittedBytesPerSec);
    }
    default:
      return empty;
  }
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function toneFor(
  value: number,
  config: ResourceMetricConfig,
  settings: SystemResourceCardSettings,
  isAbsolute = false,
): MetricTone {
  const critical = config.critical ?? settings.criticalThreshold ?? 95;
  const warn = config.warn ?? settings.warnThreshold ?? 80;
  if (!isAbsolute) {
    if (value >= critical) return "critical";
    if (value >= warn) return "warn";
    return "normal";
  }
  // 绝对量（温度等）只在配置了阈值时告警
  if (config.critical != null && value >= config.critical) return "critical";
  if (config.warn != null && value >= config.warn) return "warn";
  return "normal";
}

export function toneColor(tone: MetricTone, fallback: string): string {
  if (tone === "critical") return "#ef4444";
  if (tone === "warn") return "#f59e0b";
  return fallback;
}

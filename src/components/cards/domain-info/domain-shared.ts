/**
 * 区域信息卡片与独立页面共享的数据类型与格式化工具
 */

export interface DomainSettlement {
  id?: string;
  level?: number;
  exp?: string;
  expToLevelUp?: string;
  remainMoney?: string;
  moneyMax?: string;
  officerCharIds?: string;
  officerCharAvatar?: string;
  name?: string;
  lastTickTime?: string;
  isFinalMaxLevel?: boolean;
}

export interface DomainData {
  domainId?: string;
  name?: string;
  level?: number;
  settlements?: DomainSettlement[];
  moneyMgr?: { total?: string; count?: string };
  factory?: unknown;
}

export function formatMoney(value: string | number | undefined): string {
  if (value === undefined || value === null) return "--";
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return num >= 10000 ? `${(num / 10000).toFixed(1)}w` : String(num);
}

export function formatDateTime(ts: string | undefined): string {
  if (!ts) return "--";
  const num = Number(ts);
  if (isNaN(num)) return ts;
  const d = new Date(num * 1000);
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mo}-${day} ${h}:${mi}`;
}

/**
 * 区域调度券名称（终末地官方术语：Stock Bill；简中为「调度券」，不是「调度卷」）。
 *
 * 每个地区各有自己的调度券，互不通用：
 * - 四号谷地 → Valley Stock Bill / 谷地调度券
 * - 武陵 → Wuling Stock Bill / 武陵调度券
 */
const DOMAIN_MONEY_NAMES: Record<string, { zh: string; en: string }> = {
  domain_1: { zh: "谷地调度券", en: "Valley Stock Bill" },
  domain_2: { zh: "武陵调度券", en: "Wuling Stock Bill" },
};

export function getMoneyName(
  domainId: string | undefined,
  lang: string,
): string {
  if (!domainId) return "";
  const entry = DOMAIN_MONEY_NAMES[domainId];
  if (!entry) return "";
  return lang.startsWith("zh") ? entry.zh : entry.en;
}

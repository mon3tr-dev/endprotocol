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

const DOMAIN_MONEY_NAMES: Record<string, { zh: string; en: string }> = {
  domain_1: { zh: "谷地调度卷", en: "Valley Dispatch Ticket" },
  domain_2: { zh: "武陵调度卷", en: "Wuling Dispatch Ticket" },
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

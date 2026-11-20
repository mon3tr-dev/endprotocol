import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useTranslation } from "react-i18next";
import {
  HomeIcon,
  CalendarIcon,
  GachaIcon,
  BookmarkIcon,
  AccountIcon,
} from "@/components/icons";
import { MorphIcon } from "morphicons/react";
import { Menu } from "lucide";
import { isNavVisible } from "@/config/gameSupport";
import type { GameId } from "@/utils/accountService";

/**
 * 移动端底部导航条 —— **悬浮胶囊**形态。
 *
 * 为什么是胶囊而不是贴边的整条：桌面端把全部导航放在左侧栏里，窄屏下侧栏收成
 * 一个汉堡按钮，于是手机上每次换页面都要「开抽屉 → 点 → 关抽屉」（三次点击）。
 * 底部导航条把最常用的几个入口常驻在拇指可达范围内；而胶囊（而不是铺满一整条）
 * 是当前移动端的主流做法（iOS 26 / macOS Tahoe 的 Liquid Glass 导航条即如此）：
 * 它不遮挡内容、不与手势条打架，视觉上像「浮在页面上的一件东西」而不是
 * 「系统的一层 chrome」。
 *
 * 具体形态（对齐 Apple 的悬浮导航条）：
 * - **不贴边**：左右各留 12px，底部也留出安全区 + 8px —— 悬浮感的关键。
 * - **四角全圆**（`rounded-[28px]`），不是只有上两角圆 —— 它是悬浮件不是抽屉。
 * - **半透明玻璃**：`.lg-regular` 材质（模糊 + 提亮 + 边缘高光），与全应用的
 *   Liquid Glass 语言一致；底下滚动的卡片会透出一点。
 * - **选中态**用一枚实底主色胶囊托住图标，比只改文字色更易读。
 *
 * 高度与安全区：`padding-bottom: env(safe-area-inset-bottom)` 让开 Android 手势条
 * / iOS Home 条（桌面 webview 恒为 0px）。
 */
export interface MobileBottomNavProps {
  /** 当前账户的游戏（决定哪些入口可见） */
  game?: GameId | string | null;
  /** 点击「更多」时打开侧栏抽屉 */
  onOpenDrawer: () => void;
}

interface NavEntry {
  key: string;
  path: string;
  labelKey: string;
  Icon: typeof HomeIcon;
}

/**
 * 底部常驻的四个入口（顺序即显示顺序）。
 *
 * 标签走**独立的短文案**（`mobile_nav.*`）而不是复用侧栏的 `sidebar.*`：
 * 「抽卡记录」四个字在胶囊里会把格子撑宽、挤掉图标，短文案（抽卡 / Daily）
 * 才能让胶囊保持紧凑。
 */
const PRIMARY_NAV: NavEntry[] = [
  { key: "dashboard", path: "/", labelKey: "mobile_nav.dashboard", Icon: HomeIcon },
  {
    key: "attendance",
    path: "/attendance",
    labelKey: "mobile_nav.attendance",
    Icon: CalendarIcon,
  },
  { key: "gacha", path: "/gacha", labelKey: "mobile_nav.gacha", Icon: GachaIcon },
  { key: "todo", path: "/todo", labelKey: "mobile_nav.todo", Icon: BookmarkIcon },
];

export function MobileBottomNav({ game, onOpenDrawer }: MobileBottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  /** 按当前游戏过滤（与侧栏同一真值表） */
  const entries = useMemo(
    () => PRIMARY_NAV.filter((entry) => isNavVisible(entry.key, game)),
    [game],
  );

  const isActive = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path);

  return (
    <nav
      className="mobile-bottom-nav lg:hidden"
      aria-label={t("sidebar.title", "主导航")}
    >
      {/*
       * 胶囊本体。
       *
       * `.mobile-bottom-nav` 负责「固定在视口底部 + 底部留安全区」，
       * 这里再给左右 12px 的内缩与底部 8px 的间隙 —— 悬浮件不贴边的关键。
       *
       * `lg-regular` 提供玻璃材质（模糊 + 提亮 + 边缘高光 + 阴影），
       * 它是**功能层**变体，底下滚动的卡片会透出一点，符合悬浮件的观感。
       */}
      <div className="mx-3 mb-2 lg-regular rounded-[28px] border border-separator/60 shadow-[0_8px_28px_rgba(0,0,0,0.18)]">
        <ul className="flex items-stretch justify-around px-1.5 py-1">
          {entries.map((entry) => {
            const active = isActive(entry.path);
            const Icon = entry.Icon;
            return (
              <li key={entry.key} className="flex-1 min-w-0">
                <button
                  type="button"
                  onClick={() => navigate(entry.path)}
                  aria-current={active ? "page" : undefined}
                  className={clsx(
                    "flex w-full flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1",
                    "transition-colors duration-200 touch-target",
                    active ? "text-primary-foreground" : "text-muted",
                  )}
                >
                  {/*
                    * 选中态：整枚实底主色胶囊托住**图标与文字**（竖排）。
                    *
                    * 不用「只改文字色」：胶囊是浅色玻璃上的浮层，同为灰色的
                    * 未选中文字与主色选中文字在浅背景上区分度不够，一眼扫过去
                    * 不知道自己在哪一页。
                    * `lg-control lg-solid`：实底玻璃只留边缘高光、不铺填充 ——
                    * 否则 ::before 的 tint 会把主色压成灰紫，深色主题下
                    * --primary-foreground（近黑）落上去几乎读不出字。
                    */}
                  <span
                    className={clsx(
                      "flex min-h-[38px] w-full flex-col items-center justify-center gap-0.5 rounded-full py-1 transition-colors duration-200",
                      active ? "lg-control lg-solid bg-primary" : "bg-transparent",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    <span
                      className={clsx(
                        "truncate text-[10px] leading-tight",
                        active ? "font-semibold" : "font-normal",
                      )}
                    >
                      {t(entry.labelKey)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}

          {/* 「更多」：打开侧栏抽屉（那里有完整导航 + 账户 + 设置 + 标签页） */}
          <li className="flex-1 min-w-0">
            <button
              type="button"
              onClick={onOpenDrawer}
              aria-label={t("mobile_nav.more", "更多")}
              className="flex w-full flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1 text-muted transition-colors duration-200 touch-target"
            >
              <span className="flex min-h-[38px] w-full flex-col items-center justify-center gap-0.5 rounded-full py-1">
                <MorphIcon icon={Menu} size={18} className="shrink-0" />
                <span className="truncate text-[10px] leading-tight font-normal">
                  {t("mobile_nav.more", "更多")}
                </span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}

/** 抽屉里的「账户」快捷入口图标（供抽屉头部使用）。 */
export const MobileAccountIcon = AccountIcon;

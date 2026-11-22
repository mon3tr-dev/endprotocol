import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  HomeIcon,
  CalendarIcon,
  GachaIcon,
  BookmarkIcon,
  AccountIcon,
} from "@/components/icons";
import { isNavVisible } from "@/config/gameSupport";
import type { GameId } from "@/utils/accountService";
import {
  GlassPillIndicator,
  GlassPillItem,
} from "@/components/ui/glass-pill";

/**
 * 移动端**底部导航栏** —— 固定在视口底部的玻璃胶囊。
 *
 * ## 职责范围：只管导航，不再承载页面分类
 *
 * 早先为了「只有一条贴底胶囊」，这里也承载过抽卡页的分类项（页面把分类
 * 注册到共享 store，本组件读出来渲染）。但那样会让底部导航在某些页面
 * **整条消失**（分类占满时导航项没地方放），与「导航栏应当常驻」的预期冲突。
 *
 * 现在职责切开：
 * - **本组件**：只在视口底部渲染导航项，任何页面都常驻。
 * - **页面分类栏**：由页面自己渲染在其内容里（抽卡页放在工具行下方），
 *   用 `sticky` 在滚动时吸附 —— 见 `pages/gacha-records.tsx`。
 *
 * 两者材质与滑块动画仍然共用 `GlassPillIndicator` / `GlassPillItem`，
 * 观感一致，但定位互不影响。
 */
export interface MobileBottomNavProps {
  /** 当前账户的游戏（决定哪些入口可见） */
  game?: GameId | string | null;
}

interface NavEntry {
  key: string;
  path: string;
  labelKey: string;
  Icon: typeof HomeIcon;
}

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
  { key: "me", path: "/account", labelKey: "mobile_nav.me", Icon: AccountIcon },
];

export function MobileBottomNav({ game }: MobileBottomNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const entries = useMemo(
    () => PRIMARY_NAV.filter((entry) => isNavVisible(entry.key, game)),
    [game],
  );

  const isActive = (path: string) =>
    path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(path);

  const activeIndex = Math.max(
    0,
    entries.findIndex((entry) => isActive(entry.path)),
  );

  return (
    <nav className="mobile-bottom-nav lg:hidden" aria-label={t("sidebar.title", "主导航")}>
      <div className="relative mx-auto flex h-[62px] items-stretch overflow-hidden rounded-full border border-separator/70 p-1.5 shadow-lg lg-control">
        <GlassPillIndicator index={activeIndex} count={entries.length} />
        {entries.map((entry) => {
          const Icon = entry.Icon;
          return (
            <GlassPillItem
              key={entry.key}
              active={isActive(entry.path)}
              ariaCurrent="page"
              onClick={() => navigate(entry.path)}
              className="flex-col gap-0.5"
            >
              <Icon className="h-[18px] w-[18px] shrink-0" />
              <span className="truncate text-[10px] leading-tight">
                {t(entry.labelKey)}
              </span>
            </GlassPillItem>
          );
        })}
      </div>
    </nav>
  );
}

/** 抽屉里的「账户」快捷入口图标（供抽屉头部使用）。 */
export const MobileAccountIcon = AccountIcon;

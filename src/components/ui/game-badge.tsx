import clsx from "clsx";
import { useTranslation } from "react-i18next";
import type { GameId } from "@/utils/accountService";

/**
 * 游戏标识的展示元数据。
 *
 * `icon` 复用 `public/games/` 下的官方启动器图标（与左侧游戏切换栏同一份资源），
 * 这样账户列表、角色选择、启动器里出现的同一个游戏长得一样。
 *
 * 不把「终末地 / 明日方舟」写成硬编码中文字面量：文案走 i18n（`game.endfield` /
 * `game.arknights`），中文环境下也是从语言包取的。
 */
export const GAME_META: Record<
  GameId,
  { icon: string; labelKey: string; /** 极短标签，用于空间紧张的行内徽标 */ shortKey: string }
> = {
  endfield: {
    icon: "/games/endfield.png",
    labelKey: "game.endfield",
    shortKey: "game.endfield_short",
  },
  arknights: {
    icon: "/games/arknights.png",
    labelKey: "game.arknights",
    shortKey: "game.arknights_short",
  },
};

/** 账户/角色上的 `game` 字段可能缺失（老缓存），统一收敛为终末地 */
export function normalizeGameId(game?: string | null): GameId {
  return game === "arknights" ? "arknights" : "endfield";
}

interface GameBadgeProps {
  /** 游戏标识；缺失时按终末地展示 */
  game?: string | null;
  /** `icon` 只有图标，`short` 图标 + 极短文案，`full` 图标 + 完整游戏名 */
  variant?: "icon" | "short" | "full";
  size?: "sm" | "md";
  className?: string;
}

/**
 * 游戏标识徽标：一枚游戏图标（可带游戏名）。
 *
 * 账户页用它区分「这个角色属于终末地还是明日方舟」—— 两个游戏的账户数据来源不同，
 * 混在一个列表里没有标识就分不清哪条是哪个游戏。
 */
export function GameBadge({
  game,
  variant = "short",
  size = "sm",
  className,
}: GameBadgeProps) {
  const { t } = useTranslation();
  const id = normalizeGameId(game);
  const meta = GAME_META[id];

  const iconSize = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  // 超越椭圆：`public/games/*.png` 自身已切好 alpha，这里只做圆角收敛
  const iconCls = clsx(iconSize, "shrink-0 rounded-[5px] object-contain");

  if (variant === "icon") {
    return (
      <img
        src={meta.icon}
        alt={t(meta.labelKey)}
        title={t(meta.labelKey)}
        className={clsx(iconCls, className)}
        draggable={false}
      />
    );
  }

  const label = variant === "full" ? t(meta.labelKey) : t(meta.shortKey);

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-separator/60 bg-content2/40 px-1.5 py-0.5 text-[10px] font-medium text-muted",
        size === "md" && "gap-1.5 px-2 py-1 text-xs",
        className,
      )}
      title={t(meta.labelKey)}
    >
      <img
        src={meta.icon}
        alt=""
        aria-hidden="true"
        className={iconCls}
        draggable={false}
      />
      <span className="whitespace-nowrap">{label}</span>
    </span>
  );
}

import { useTranslation } from "react-i18next";
import { GlassSpinner } from "@/components/ui/glass";
import { useElapsedSeconds } from "@/hooks/useElapsedSeconds";
import { cn } from "@/lib/utils";

/**
 * 「正在检测…」的进行中提示。
 *
 * 解决的核心问题是**结论式空态冒充进度**：拉取游戏角色 / 验证抽卡授权都要
 * 串鹰角接口，慢的时候十几秒。原先这段等待里界面要么只剩一个不停转的圆环，
 * 要么直接显示「暂无可绑定的游戏角色」这种已经结束的结论 —— 用户会以为流程
 * 走完了或者卡死了，于是关掉重来，再等一遍。
 *
 * 这里把三件事摆明：正在做什么（文案）、已经等了多久（每秒推进的秒数）、
 * 以及「还在继续」本身（秒数在动）。秒数超过 `slowAfterSeconds` 后换成
 * 「网络较慢」口径并转警示色，但仍是进行中，不是失败。
 *
 * 两个作用域共用同一套呈现，只换文案前缀：
 * - `roles`：正在检测可绑定的游戏角色
 * - `u8`：正在验证抽卡授权（换取一次性令牌）
 */
export type CheckScope = "roles" | "u8";

/** 每个作用域的 i18n 键前缀；`_elapsed` / `_slow` / `_hint` 由它派生。 */
const KEY_PREFIX: Record<CheckScope, string> = {
  roles: "settings.account.roles_checking",
  u8: "settings.account.u8_checking",
};

export interface CheckStatusProps {
  /** 是否正在检测；false 时组件不渲染 */
  active: boolean;
  scope: CheckScope;
  /** 超过多少秒后提示「网络较慢」，默认 8 */
  slowAfterSeconds?: number;
  className?: string;
}

export function CheckStatus({
  active,
  scope,
  slowAfterSeconds = 8,
  className,
}: CheckStatusProps) {
  const { t } = useTranslation();
  const seconds = useElapsedSeconds(active);

  if (!active) return null;

  const prefix = KEY_PREFIX[scope];
  const isSlow = seconds >= slowAfterSeconds;

  return (
    <p
      // 状态提示不是错误：用 muted/warning 而不是 danger，避免看起来像失败了
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-[11px] leading-tight",
        isSlow ? "text-warning-text" : "text-muted",
        className,
      )}
      // 悬停说明这一步在做什么（桌面端）；移动端没有悬停，纯装饰不误导
      title={t(`${prefix}_hint`)}
      // 屏幕阅读器不必每秒念一遍，但要让它在变化时保持稳定
      aria-live="polite"
    >
      <GlassSpinner
        size={12}
        color={isSlow ? "default" : "primary"}
        className="shrink-0"
      />
      <span className="truncate">
        {isSlow
          ? t(`${prefix}_slow`, { seconds })
          : seconds === 0
            ? t(prefix)
            : t(`${prefix}_elapsed`, { seconds })}
      </span>
    </p>
  );
}

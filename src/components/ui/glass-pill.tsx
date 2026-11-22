import { useRef, type ReactNode } from "react";
import clsx from "clsx";

/**
 * 玻璃分段胶囊 —— 抽卡页分类栏与底部导航共用的**同一套材质与滑块动画**。
 *
 * 抽卡的分类栏本来是这个应用里最完整的一套「玻璃胶囊 + 滑动指示器」实现：
 * `lg-control` 实底 + `border-separator/70` 描边 + `rounded-full`，
 * 指示器是一条 `lg-control border-primary/50` 的浮层，宽度 = 内容宽 / 项数，
 * 靠 `translateX(下标 * 100%)` 滑过去，缓动 `--lg-ease-glide`（带惯性过冲）。
 * 现在把这段抽出来，导航胶囊与页面分类胶囊都用它 —— 两处外观和动画完全一致，
 * 不会各自漂移成两套。
 *
 * 为什么指示器用 `translateX(%)` 而不是动态计算像素：
 * `%` 的基准是**指示器自身宽度**，而指示器宽度恰好等于「内容宽 / 项数」，
 * 于是「移动下标 × 自身宽」正好落在第下标项上。项等宽（`flex-1`）是这个
 * 算法成立的前提，调用方不要再给某一项加宽。
 */
export function GlassPillGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "relative flex items-stretch rounded-full lg-control border border-separator/70 shadow-lg",
        "mx-auto p-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * 分段胶囊的滑块指示器。
 *
 * `index` / `count` 由调用方给出；`count` 变化时宽度自动重算（例如明日方舟
 * 只有三个抽卡分类），`index` 变化时滑块带惯性滑过去。
 *
 * ## 为什么自带一层定位包裹
 *
 * 绝对定位元素的包含块是定位祖先的 **padding box**，而胶囊的选项在**内容区**
 * （被 `p-1.5` 再内缩 6px）。若直接写 `top: 6px`，滑块顶边只到 padding box
 * 的内容起点 —— 也就是**仍贴着胶囊描边**，上下不留空隙（实测：滑块顶端比
 * 胶囊外框还高 12px，正是没退够）。
 *
 * 所以这里自带一个 `absolute inset-1.5` 的包裹层（`inset-1.5` = 6px = `p-1.5`），
 * 让滑块相对**内容区**定位。包裹层同时充当宽度基准：滑块宽度 =
 * `内容区宽 / 项数`，与等分选项严丝合缝。
 */
export function GlassPillIndicator({
  index,
  count,
  /** 包裹层相对 padding box 的内缩（px），默认 6（`p-1.5`）；胶囊内边距不同就传对应值 */
  wrapInset = 6,
  /** 滑块相对包裹层上下各留的空白（px），默认 3 */
  gap = 3,
  className,
}: {
  index: number;
  count: number;
  wrapInset?: number;
  gap?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute z-0"
      // 用内联样式而非拼接类名：动态类名不会被 Tailwind 的扫描器收录，
      // 拼出来的 `inset-x-1.5` 之类根本不会生成对应规则。
      style={{
        top: wrapInset,
        bottom: wrapInset,
        left: wrapInset,
        right: wrapInset,
      }}
    >
      <span
        className={clsx(
          "absolute left-0 rounded-full",
          "lg-control border border-primary/50",
          // 动画与抽卡分类栏完全一致：slow + glide（位移主力，带惯性过冲）
          "[transition:transform_var(--lg-dur-slow)_var(--lg-ease-glide)]",
          className,
        )}
        style={{
          top: gap,
          bottom: gap,
          width: `calc(100% / ${count})`,
          transform: `translateX(${Math.max(0, index) * 100}%)`,
        }}
      />
    </span>
  );
}

/**
 * 分段胶囊的一个选项。
 *
 * 选中态**由指示器承担**，按钮本身只改文字色 —— 若按钮各自换底，滑块滑走时
 * 会在原位置留下一块残留色，且两套选中态会打架（抽卡分类栏当初就踩过）。
 */
export function GlassPillItem({
  active,
  onClick,
  children,
  className,
  ariaCurrent,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  ariaCurrent?: "page" | undefined;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      aria-current={active ? (ariaCurrent ?? "true") : undefined}
      className={clsx(
        "relative z-10 flex flex-1 min-w-0 items-center justify-center gap-1 rounded-full px-1",
        "whitespace-nowrap transition-colors duration-200 active:scale-[0.98]",
        active ? "text-primary-text" : "text-foreground/70",
        className,
      )}
    >
      {children}
    </button>
  );
}
import { useEffect, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";

/**
 * 头像轮播 —— **连续位置模型**，拖动时按「离中心多远」逐个插值。
 *
 * ## 与上一版的区别（这是关键）
 *
 * 上一版是「三张牌一起刚性平移」：拖动只改一个 `dragX`，三个头像同步横移；
 * 松手时改 `index` 并由父组件回写，视觉上就是**先弹回原位、再换成新的中间像**。
 *
 * 现在只有一个真值：**连续位置 `pos`**（单位是「第几个账户」，可以是 2.6）。
 * 每个头像按它与 `pos` 的距离 `d` 独立计算自己的形态：
 *
 *   d = 0      → 满尺寸、满色、不透明（就是当前选中的那个）
 *   d = ±0.5   → 缩到 ~0.81、饱和度 ~0.63（拖到一半）
 *   d = ±1     → 缩到 0.62、灰化、淡到 0.45（就是左右两个候选）
 *   d = ±1.5   → 完全透明（淡出/淡入的尽头）
 *
 * 于是「向左拖」自然得到用户描述的那套动效：
 * 左边的往左走并**慢慢淡出**，当前的这个**变小、灰化**，
 * 右边的**变大、恢复色彩**，同时下一个循环头像从右边**淡入**。
 *
 * 松手时把 `pos` 动画到最近的整数并在**同一次提交里**通知 `onIndexChange`，
 * 所以不再有「先还原再切换」。
 */

export interface SwipeCarouselProps<T> {
  items: T[];
  index: number;
  onIndexChange: (next: number) => void;
  /** 单个头像的渲染（`active` 为真表示它是当前居中的那个） */
  renderItem: (item: T, active: boolean) => ReactNode;
  /** 循环滑动（默认开启） */
  loop?: boolean;
  className?: string;
}

/** 居中头像直径（px） */
const ITEM_SIZE = 80;
/** 相邻头像中心距 */
const SLOT_GAP = ITEM_SIZE * 0.92;
/** d=±1 时的缩放 */
const SIDE_SCALE = 0.62;
/** d=±1 时的不透明度 */
const SIDE_OPACITY = 0.45;
/** 渲染窗口：|d| 超过它就完全透明，直接不渲染 */
const WINDOW = 1.55;
/** 松手停靠动画时长（ms），需与 CSS transition 保持一致 */
const SETTLE_MS = 300;
/** 判定腕动的横向位移阈值（px） */
const AXIS_LOCK_PX = 8;
/** 腕动速度阈值（px/ms） */
const FLING_VX = 0.35;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function SwipeCarousel<T>({
  items,
  index,
  onIndexChange,
  renderItem,
  loop = true,
  className,
}: SwipeCarouselProps<T>) {
  const count = items.length;

  /**
   * 连续位置。这是**唯一**驱动渲染的真值：
   * 拖动时按手指位移连续变化，松手后动画到整数。
   */
  const [pos, setPos] = useState(index);
  const posRef = useRef(index);

  const [isDragging, setIsDragging] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const settlingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 记录本组件捕获的 pointerId，松手时逐一释放 */
  const capturedIdsRef = useRef<number[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const axisRef = useRef<"unknown" | "x" | "y">("unknown");
  const startRef = useRef({ x: 0, y: 0, pos: 0 });
  /** 最近一次指针采样，用于算腕动速度（px/ms） */
  const lastRef = useRef({ x: 0, t: 0, vx: 0 });
  /** 本次手势是否已经移动超过阈值（用来吞掉拖动后的 click） */
  const movedRef = useRef(false);

  const wrapIndex = (i: number) =>
    count > 0 ? ((i % count) + count) % count : 0;

  /** 与 `target` 同余（mod count）且离 `ref` 最近的整数位置 */
  const nearestCongruent = (target: number, ref: number) => {
    if (!loop || count === 0) return target;
    return target + count * Math.round((ref - target) / count);
  };

  const clearSettleTimer = () => {
    if (settlingTimerRef.current) {
      clearTimeout(settlingTimerRef.current);
      settlingTimerRef.current = null;
    }
  };

  useEffect(() => clearSettleTimer, []);

  /**
   * 外部 `index` 变化（点头像直接切、父组件改选账户）时对齐 `pos`。
   *
   * 对齐到**同余的最近位置**，而不是直接 `setPos(index)`：后者会让虚拟槽位
   * 整体跳变（k 从 55..59 变成 -2..2），头像节点全部重挂，图片闪一下。
   */
  useEffect(() => {
    if (isDragging || isSettling) return;
    if (count === 0) {
      posRef.current = 0;
      setPos(0);
      return;
    }
    const target = nearestCongruent(index, posRef.current);
    if (Math.abs(posRef.current - target) > 0.001) {
      posRef.current = target;
      setPos(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count, isDragging, isSettling, loop]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (count <= 1) return;
    // 停靠动画中再次按下：立即结束动画，从落点继续
    clearSettleTimer();
    setIsSettling(false);
    movedRef.current = false;
    startRef.current = { x: e.clientX, y: e.clientY, pos: posRef.current };
    lastRef.current = { x: e.clientX, t: performance.now(), vx: 0 };
    axisRef.current = "unknown";
    setIsDragging(true);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    capturedIdsRef.current = [e.pointerId];
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - startRef.current.x;
    const dy = e.clientY - startRef.current.y;

    // 首次显著位移锁定轴向。
    //
    // ⚠️ 判定为纵向时**不要 `setIsDragging(false)`**：那会把这次手势彻底作废，
    // 而 `finish` 又因为 `isDragging` 已为假而提前返回，指针捕获永远不释放 ——
    // 结果是「第一次滑动正常，之后每次按下都像没反应」。纵向时只需 `return`
    // 让事件冒泡给页面滚动，拖动状态留着，松手时照常收尾。
    if (axisRef.current === "unknown") {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (axisRef.current !== "x") return;

    if (Math.abs(dx) > AXIS_LOCK_PX) movedRef.current = true;

    // 瞬时速度（px/ms）
    const now = performance.now();
    const dt = Math.max(1, now - lastRef.current.t);
    lastRef.current.vx = (e.clientX - lastRef.current.x) / dt;
    lastRef.current.x = e.clientX;
    lastRef.current.t = now;

    // 向左拖（dx<0）→ 右边那张移到中间 → pos 增大
    let next = startRef.current.pos - dx / SLOT_GAP;

    // 不循环时到头给阻尼
    if (!loop) {
      if (next < 0) next = next * 0.28;
      else if (next > count - 1) next = count - 1 + (next - (count - 1)) * 0.28;
    }

    posRef.current = next;
    setPos(next);
  };

  /**
   * 松手：把 `pos` 动画到目标整数，并通知父组件。
   *
   * 关键在**同一次提交**里改 `pos` 与 `index`：父组件的状态回写晚一拍也不影响，
   * 因为渲染只认 `pos`，不会出现「先弹回、再换像」。
   */
  const finish = () => {
    if (!isDragging) return;
    setIsDragging(false);

    // 显式释放指针捕获：松手点可能已经在元素外，不释放会让后续手势全被
    // 这个元素吞掉（表现为「第二次拖动完全没反应」）。
    const root = rootRef.current;
    if (root) {
      try {
        for (const id of capturedIdsRef.current) root.releasePointerCapture(id);
      } catch {
        /* 已释放 / 未捕获 */
      }
      capturedIdsRef.current = [];
    }

    const cur = posRef.current;
    const vx = lastRef.current.vx;
    axisRef.current = "unknown";

    let target = Math.round(cur);
    if (Math.abs(vx) > FLING_VX) {
      // 手指往右甩（vx>0）→ pos 减小；往左甩 → pos 增大
      const posDir = vx > 0 ? -1 : 1;
      target = posDir > 0 ? Math.ceil(cur) : Math.floor(cur);
      if (target === cur) target = cur + posDir;
    }
    if (!loop) target = Math.max(0, Math.min(count - 1, target));

    setIsSettling(true);
    posRef.current = target;
    setPos(target);

    const wrapped = wrapIndex(target);
    if (wrapped !== wrapIndex(index)) onIndexChange(wrapped);

    clearSettleTimer();
    settlingTimerRef.current = setTimeout(() => {
      setIsSettling(false);
      settlingTimerRef.current = null;
    }, SETTLE_MS);
  };

  if (count === 0) return null;

  /**
   * 虚拟槽位：渲染所有 `|k - pos| <= WINDOW` 的整数槽。
   *
   * 上下界必须**由 pos 直接算**，不能写死 `base ± 2`：`pos=2.4` 时 base=2，
   * 写死范围只到 k=4，而 k=4 的 d 恰是 1.6，把「淡入中的下一张」裁掉了 ——
   * 表现为拖到一半时外圈该出现的那张永远不出现。
   *
   * `key` 用**虚拟槽号 k**（而不是账户下标）：循环时同一个账户会同时出现在
   * 左右两侧（count=2 时尤其明显），用 k 才能让它们各自独立动画。
   */
  const slots: { k: number; itemIndex: number; d: number }[] = [];
  if (count === 1) {
    slots.push({ k: 0, itemIndex: 0, d: 0 });
  } else {
    const lo = Math.ceil(pos - WINDOW);
    const hi = Math.floor(pos + WINDOW);
    for (let k = lo; k <= hi; k++) {
      if (!loop && (k < 0 || k > count - 1)) continue;
      slots.push({ k, itemIndex: wrapIndex(k), d: k - pos });
    }
  }
  // 由远到近绘制，保证中间那张在最上层（zIndex 兜底，顺序更稳）
  slots.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));

  // 拖动中不要过渡（要跟手）；松手后交给 CSS 过渡
  const transition = isDragging
    ? "none"
    : `transform ${SETTLE_MS}ms var(--lg-ease-emphasized), opacity ${SETTLE_MS}ms linear`;

  return (
    <div
      ref={rootRef}
      className={clsx("select-none", className)}
      style={{
        position: "relative",
        width: "100%",
        height: ITEM_SIZE + 24,
        overflow: "hidden",
        touchAction: "pan-y",
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {slots.map(({ k, itemIndex, d }) => {
        const ad = Math.abs(d);
        const t1 = clamp01(ad);
        /** d 在 [0,1] 段：从「中心态」过渡到「候选态」 */
        const t2 = clamp01(ad - 1);

        const scale = lerp(1, SIDE_SCALE, t1);
        const saturate = lerp(1, 0.25, t1);
        const opacity =
          ad <= 1
            ? lerp(1, SIDE_OPACITY, t1)
            : lerp(SIDE_OPACITY, 0, t2 / (WINDOW - 1));

        const isCenter = ad < 0.5;
        return (
          <div
            key={k}
            data-carousel-slot={k}
            data-carousel-item={itemIndex}
            data-carousel-d={d.toFixed(3)}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              zIndex: Math.round((WINDOW - ad) * 100),
              opacity,
              filter: `saturate(${saturate})`,
              // 顺序很重要：先位移到槽位，再按自身中心缩放
              transform: `translate(-50%, -50%) translateX(${d * SLOT_GAP}px) scale(${scale})`,
              transition,
              willChange: "transform, opacity",
              pointerEvents: ad < 0.9 ? "auto" : "none",
            }}
            onClick={() => {
              // 拖动过的这次不算点击
              if (movedRef.current) return;
              if (Math.abs(d) > 0.5) onIndexChange(wrapIndex(k));
            }}
          >
            {renderItem(items[itemIndex], isCenter)}
          </div>
        );
      })}

      {/* 分页点 */}
      {count > 1 && (
        <div
          className="flex items-center gap-1"
          style={{
            position: "absolute",
            bottom: -4,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999,
          }}
        >
          {items.map((_, i) => (
            <span
              key={i}
              className={clsx(
                "h-1.5 rounded-full transition-all duration-300",
                i === wrapIndex(Math.round(pos))
                  ? "w-4 bg-primary"
                  : "w-1.5 bg-foreground/20",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import { cn } from "@/lib/utils";

/**
 * ToggleGroup — 纯布局分段控件。
 *
 * 刻意不在这里铺任何底色：玻璃材质统一由调用点的一个 `lg-*` /
 * `.titlebar-mode-toggle` 之类的类给出（此前这里写死
 * `bg-default-100/50` + `border-separator/40`，是所有分段控件
 * “比旁边浮层更实”的来源；现在轨道底由调用方用 `.lg-inset` 给出）。
 *
 * 形状（圆角）同样只由调用点给出，这里不写任何 `rounded-*`：
 * 调用点常用 `rounded-full`（Tailwind v4 编译为 `calc(infinity * 1px)`），
 * 若这里再叠一层 `first:rounded-l-md` / `last:rounded-r-md` 这类**具体值**，
 * CSS 的 border-radius 重叠缩放（相邻两角之和超过边长时按比例缩小）会把
 * 具体值那一侧压成 0px —— 首项（或末项）的圆角直接变成直角，
 * 悬浮高亮块看起来就是「右边是方形的、顶出胶囊」。一个元素上不要混用
 * 无限半径与具体半径，要单独改首尾圆角就整组用 `rounded-*-full`。
 */
const ToggleGroup = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Root>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Root
    ref={ref}
    className={cn("inline-flex items-center rounded-lg p-0.5", className)}
    {...props}
  />
));

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

const ToggleGroupItem = React.forwardRef<
  React.ElementRef<typeof ToggleGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ToggleGroupPrimitive.Item
    ref={ref}
    className={cn(
      "lg-hoverable inline-flex h-5 items-center justify-center px-2.5 text-[10px] font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 data-[state=on]:bg-transparent hover:text-foreground",
      className,
    )}
    {...props}
  />
));

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };

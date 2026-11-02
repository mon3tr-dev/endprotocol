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
      "lg-hoverable inline-flex h-5 items-center justify-center px-2.5 text-[10px] font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 first:rounded-l-md last:rounded-r-md data-[state=on]:bg-transparent hover:text-foreground",
      className,
    )}
    {...props}
  />
));

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };

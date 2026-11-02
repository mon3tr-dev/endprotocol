import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className,
    )}
    {...props}
  >
    {/* 轨道：功能层控件底；填充与拖动反馈均为 paint 级轻量过渡 */}
    <SliderPrimitive.Track className="lg-control lg-hairline relative h-2 w-full grow overflow-hidden rounded-full border">
      <SliderPrimitive.Range className="absolute h-full bg-primary shadow-[0_0_10px_color-mix(in_srgb,var(--primary)_35%,transparent)]" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={props["aria-label"]}
      className="lg-thumb block h-5 w-5 rounded-full border bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.75)] [transition:transform_var(--lg-dur-fast)_var(--lg-ease-spring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 hover:scale-110 disabled:pointer-events-none disabled:opacity-50"
    />
  </SliderPrimitive.Root>
));

Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

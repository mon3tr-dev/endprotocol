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
      "slider relative flex w-full touch-none select-none items-center py-2.5",
      className,
    )}
    {...props}
  >
    {/* 轨道：不用 lg-control（其 ::before 带 backdrop-filter 玻璃模糊），
        拖动时填充区逐帧重算会导致掉帧；改用无模糊的轻量填充 lg-inset。 */}
    <SliderPrimitive.Track className="lg-hairline lg-inset relative h-2.5 w-full grow overflow-hidden rounded-full border">
      <SliderPrimitive.Range className="absolute h-full rounded-full bg-primary" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb
      aria-label={props["aria-label"]}
      className="lg-thumb block h-5 w-5 cursor-grab active:cursor-grabbing rounded-full border bg-white shadow-[0_1px_3px_rgba(0,0,0,0.3),0_0_0_1px_rgba(0,0,0,0.05),0_0_8px_color-mix(in_srgb,var(--primary)_35%,transparent),inset_0_1px_1px_var(--lg-edge-glint)] will-change-transform [transition:transform_var(--lg-dur-press)_var(--lg-ease-spring)] hover:scale-110 active:scale-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50"
    />
  </SliderPrimitive.Root>
));

Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

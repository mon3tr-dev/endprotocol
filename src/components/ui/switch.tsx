import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

export interface GlassSwitchProps extends Omit<
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
  "onCheckedChange"
> {
  isSelected?: boolean;
  onValueChange?: (selected: boolean) => void;
  isDisabled?: boolean;
}

function GlassSwitch({
  isSelected = false,
  onValueChange,
  isDisabled = false,
  disabled,
  className,
  children,
  ...rest
}: GlassSwitchProps) {
  const off = disabled || isDisabled;
  return (
    <SwitchPrimitive.Root
      checked={isSelected}
      onCheckedChange={onValueChange}
      disabled={off}
      className={cn(
        "group inline-flex items-center gap-2 select-none cursor-pointer",
        // 惯性：整行的按压缩放与滑块共用同一条弹性曲线（spring 带轻微过冲）
        "[transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring)]",
        "hover:scale-105 active:scale-95",
        "disabled:opacity-50 disabled:pointer-events-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
        className,
      )}
      {...rest}
    >
      {/* 默认分支必须用本项目的 Thumb：直接渲染 Radix 原生 Thumb 时它既没有
          样式也没有过渡，就是个瞬移的白块——「库里的组件没动画」即指此处。 */}
      {children ?? <Thumb />}
    </SwitchPrimitive.Root>
  );
}

function Control({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        // 轨道：功能层控件底（lg-control）。底色与边框走 base 档淡入，
        // 配合 globals.css 里 ::before 的 background-color 过渡，不再闪一下。
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full",
        "lg-control lg-hairline border",
        "[transition:background-color_var(--lg-dur-base)_var(--lg-ease-standard),border-color_var(--lg-dur-base)_var(--lg-ease-standard),box-shadow_var(--lg-dur-base)_var(--lg-ease-standard)]",
        "group-data-[state=checked]:border-primary/50 group-data-[state=checked]:bg-primary",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Thumb({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        // 滑块：位移走 press 档 + spring——过冲收敛到 1.2 的弹性曲线，
        // 滑到位时带一点惯性回弹，而不是 glide 那样匀速抹平（更不会瞬移）。
        "pointer-events-none block h-5 w-5 translate-x-0.5 rounded-full bg-white",
        "shadow-[0_1px_3px_rgba(0,0,0,0.22),inset_0_1px_1px_var(--lg-edge-glint)]",
        "[transition:translate_var(--lg-dur-press)_var(--lg-ease-inertia),transform_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring)]",
        "group-data-[state=checked]:translate-x-[22px]",
        className,
      )}
    />
  );
}

GlassSwitch.Control = Control;
GlassSwitch.Thumb = Thumb;

const SwitchThumb = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Thumb>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Thumb>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Thumb
    ref={ref}
    className={cn(
      "pointer-events-none block h-5 w-5 translate-x-0.5 rounded-full bg-white",
      "shadow-[0_1px_3px_rgba(0,0,0,0.22),inset_0_1px_1px_var(--lg-edge-glint)]",
      "[transition:translate_var(--lg-dur-press)_var(--lg-ease-spring),transform_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring)]",
      "data-[state=checked]:translate-x-[22px]",
      className,
    )}
    {...props}
  />
));

SwitchThumb.displayName = SwitchPrimitive.Thumb.displayName;

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full lg-control lg-hairline border",
      "[transition:background-color_var(--lg-dur-base)_var(--lg-ease-standard),border-color_var(--lg-dur-base)_var(--lg-ease-standard),box-shadow_var(--lg-dur-base)_var(--lg-ease-standard)]",
      "data-[state=checked]:border-primary/50 data-[state=checked]:bg-primary",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  >
    {children ?? <SwitchThumb />}
  </SwitchPrimitive.Root>
));

Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch, SwitchThumb, GlassSwitch };

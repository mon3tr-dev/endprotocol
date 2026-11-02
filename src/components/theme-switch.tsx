import { FC, useState, useEffect, useCallback, useRef } from "react";
import { MorphIcon } from "morphicons/react";
import { Sun, Moon } from "lucide";
import { getConfig, setConfig } from "@/utils/configService";
import { emit } from "@tauri-apps/api/event";
import { applyThemeMode, isSystemDark, type ThemeMode } from "@/utils/theme";

export interface ThemeSwitchProps {
  className?: string;
}

// 有效模式：跟随系统时解析为当前实际生效的浅色/深色
function resolveEffective(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return isSystemDark() ? "dark" : "light";
  return mode;
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({ className }) => {
  const [isMounted, setIsMounted] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const init = async () => {
      const savedMode = await getConfig<ThemeMode>("theme_mode");
      const mode = savedMode ?? "system";
      setThemeMode(mode);
      applyThemeMode(mode);
      setIsMounted(true);
    };
    init();
  }, []);

  // 监听 themeChange，与设置页双向同步
  useEffect(() => {
    const handler = async () => {
      const savedMode = await getConfig<ThemeMode>("theme_mode");
      const mode = savedMode ?? "system";
      setThemeMode(mode);
      applyThemeMode(mode);
    };
    window.addEventListener("themeChange", handler);
    return () => window.removeEventListener("themeChange", handler);
  }, []);

  // 跟随系统模式下，系统外观变化时同步切换
  useEffect(() => {
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      applyThemeMode("system");
      emit("theme-changed", "system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeMode]);

  // 侧边栏只做浅色↔深色切换，不进入跟随系统
  const toggleTheme = useCallback(async () => {
    const effective = resolveEffective(themeMode);
    const nextMode: ThemeMode = effective === "light" ? "dark" : "light";

    setThemeMode(nextMode);
    await setConfig("theme_mode", nextMode);
    emit("theme-changed", nextMode);

    // 先 applyThemeMode 再广播 themeChange：订阅者（图表等）需要在新的
    // .dark 状态下取色，否则拿到的是上一个主题的颜色且不会再重算。
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.style.transition = "opacity 0.16s ease";
      rootEl.style.opacity = "0";
      setTimeout(() => {
        applyThemeMode(nextMode);
        window.dispatchEvent(new CustomEvent("themeChange"));
        setTimeout(() => {
          rootEl.style.opacity = "1";
          rootEl.style.transition = "";
        }, 40);
      }, 170);
    } else {
      applyThemeMode(nextMode);
      window.dispatchEvent(new CustomEvent("themeChange"));
    }
  }, [themeMode]);

  if (!isMounted) return <div className="w-6 h-6" />;

  const effective = resolveEffective(themeMode);
  const isDark = effective === "dark";

  return (
    <button
      ref={btnRef}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={`lg-control p-1.5 rounded-full transition-all duration-200 hover:scale-105 active:scale-90 cursor-pointer border-none ${className || ""}`}
      onClick={toggleTheme}
    >
      <MorphIcon icon={isDark ? Moon : Sun} size={20} spring="snappy" />
    </button>
  );
};

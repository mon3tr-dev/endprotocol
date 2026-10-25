import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { SettingsDivider } from "@/components/ui/settings-row";
import { Slider } from "@/components/ui/slider";
import ScreenColorPicker from "@/components/screen-color-picker";
import { getConfig, setConfig } from "@/utils/configService";
import { isWindowsPlatform } from "@/utils/platform";
import {
  DEFAULT_GLASS_CLARITY,
  DEFAULT_THEME_COLOR,
  PRESET_COLORS,
  applyGlassClarity,
  applyThemeColor,
  applyThemeMode,
  getAllColors,
  type ThemeColor,
  type ThemeMode,
} from "@/utils/theme";
import { MorphIcon } from "morphicons/react";
import {
  Sun,
  Moon,
  Monitor,
  Check,
  Plus,
  Pencil,
  Trash2,
  Pipette,
  ImagePlus,
  X,
} from "lucide";

/** 兼容旧导入：findColorByName / getAllColors 的权威实现在 `@/utils/theme` */
export { findColorByName, getAllColors } from "@/utils/theme";


function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace(/^#/, "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function rgbToHex(rgb: { r: number; g: number; b: number }): string {
  const f = (n: number) => n.toString(16).padStart(2, "0");
  return `#${f(rgb.r)}${f(rgb.g)}${f(rgb.b)}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const s = max === 0 ? 0 : d / max;
  return { h: h * 360, s: s * 100, v: max * 100 };
}

function hsvToHex(h: number, s: number, v: number): string {
  const ss = s / 100;
  const vv = v / 100;
  const c = vv * ss;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vv - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const f = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

function useDragArea(onPosition: (left: number, top: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;

  const move = useCallback((clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const top = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    onPositionRef.current(left, top);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      move(e.clientX, e.clientY);
    },
    [move],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      e.preventDefault();
      move(e.clientX, e.clientY);
    },
    [move],
  );

  const end = useCallback(() => {
    dragging.current = false;
  }, []);

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
  };
}

function generateColorScale(hex: string): ThemeColor["colors"] {
  const [h, s] = hexToHsl(hex);
  const lighter = (l: number) => hslToHex(h, Math.max(s - 10, 10), l);
  const darker = (l: number) => hslToHex(h, Math.min(s + 10, 90), l);
  return {
    50: lighter(97),
    100: lighter(93),
    200: lighter(86),
    300: lighter(76),
    400: lighter(64),
    500: hex,
    600: darker(42),
    700: darker(34),
    800: darker(26),
    900: darker(18),
    foreground: "#ffffff",
  };
}

export function AppearanceSettings() {
  const { t } = useTranslation();
  const [themeMode, setThemeMode] = useState<ThemeMode>("system");
  /** 供 useCallback 里读取最新主题模式（避免依赖数组频繁重建） */
  const themeModeRef = useRef<ThemeMode>(themeMode);
  themeModeRef.current = themeMode;
  const [themeColor, setThemeColor] = useState(DEFAULT_THEME_COLOR);
  const [customColors, setCustomColors] = useState<ThemeColor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [pickerHex, setPickerHex] = useState("#6366f1");
  const [pickerLabel, setPickerLabel] = useState("");
  const [pickerPos, setPickerPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const [hexDraft, setHexDraft] = useState("");
  const [editingColor, setEditingColor] = useState<ThemeColor | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{
    color: ThemeColor;
    x: number;
    y: number;
  } | null>(null);
  const [screenPickerOpen, setScreenPickerOpen] = useState(false);
  const supportsEyeDropper =
    typeof window !== "undefined" && "EyeDropper" in window;
  const canPickFromScreen = isTauri()
    ? isWindowsPlatform()
    : supportsEyeDropper;
  const [rgbDraft, setRgbDraft] = useState<{ r: string; g: string; b: string }>(
    {
      r: "99",
      g: "102",
      b: "241",
    },
  );
  const [bgImagePath, setBgImagePath] = useState<string | null>(null);
  const [bgImageOpacity, setBgImageOpacity] = useState(0.5);
  const DEFAULT_BG_IMAGE_OPACITY = 0.5;
  const [bgBlur, setBgBlur] = useState(16);
  const DEFAULT_BG_BLUR = 16;
  const [glassClarity, setGlassClarity] = useState(DEFAULT_GLASS_CLARITY);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const [bgImagePreview, setBgImagePreview] = useState<string | null>(null);

  useEffect(() => {
    const { r, g, b } = hexToRgb(pickerHex);
    setRgbDraft({ r: String(r), g: String(g), b: String(b) });
  }, [pickerHex]);

  const applyHex = useCallback((hex: string) => {
    setPickerHex(hex);
    setHexDraft(hex.startsWith("#") ? hex.slice(1) : hex);
  }, []);

  const handleSatChange = useCallback(
    (left: number, top: number) => {
      const { h } = hexToHsv(pickerHex);
      applyHex(
        hsvToHex(h, Math.round(left * 100), Math.round((1 - top) * 100)),
      );
    },
    [pickerHex, applyHex],
  );

  const handleHueChange = useCallback(
    (left: number) => {
      const { s, v } = hexToHsv(pickerHex);
      applyHex(hsvToHex(Math.round(left * 360), s, v));
    },
    [pickerHex, applyHex],
  );

  const satDrag = useDragArea(handleSatChange);
  const hueDrag = useDragArea(handleHueChange);

  const handleRgbChange = (ch: "r" | "g" | "b", value: string) => {
    const clean = value.replace(/\D/g, "").slice(0, 3);
    const next = { ...rgbDraft, [ch]: clean };
    setRgbDraft(next);
    if (clean === "") return;
    const r = Math.max(0, Math.min(255, parseInt(next.r || "0", 10)));
    const g = Math.max(0, Math.min(255, parseInt(next.g || "0", 10)));
    const b = Math.max(0, Math.min(255, parseInt(next.b || "0", 10)));
    applyHex(rgbToHex({ r, g, b }));
  };

  const repositionPicker = useCallback(() => {
    if (!showPicker) {
      setPickerPos(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const panelWidth = 264;
    const panelHeight = 460;
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 默认在触发器下方，空间不足时翻转到上方
    let top = rect.bottom + gap;
    let left = rect.left;
    if (top + panelHeight > vh - 8) {
      top = rect.top - panelHeight - gap;
    }
    top = Math.max(8, Math.min(top, vh - panelHeight - 8));
    left = Math.max(8, Math.min(left, vw - panelWidth - 8));
    setPickerPos({ top, left });
  }, [showPicker]);

  useEffect(() => {
    if (showPicker) {
      setHexDraft(pickerHex.startsWith("#") ? pickerHex.slice(1) : pickerHex);
    }
  }, [showPicker, pickerHex]);

  useLayoutEffect(() => {
    repositionPicker();
  }, [repositionPicker]);

  useEffect(() => {
    if (!showPicker) return;
    window.addEventListener("resize", repositionPicker);
    window.addEventListener("scroll", repositionPicker, true);
    return () => {
      window.removeEventListener("resize", repositionPicker);
      window.removeEventListener("scroll", repositionPicker, true);
    };
  }, [showPicker, repositionPicker]);

  useEffect(() => {
    const loadConfig = async () => {
      const [
        savedMode,
        savedColor,
        savedCustom,
        savedBgPath,
        savedBgOpacity,
        savedBgBlur,
        savedGlassClarity,
      ] = await Promise.all([
        getConfig<ThemeMode>("theme_mode"),
        getConfig<string>("theme_color"),
        getConfig<ThemeColor[]>("theme_custom_colors"),
        getConfig<string>("bg_image_path"),
        getConfig<number>("bg_image_opacity"),
        getConfig<number>("bg_blur"),
        getConfig<number>("glass_clarity"),
      ]);
      setThemeMode(savedMode ?? "system");
      setThemeColor(savedColor ?? DEFAULT_THEME_COLOR);
      setCustomColors(savedCustom ?? []);
      const bgPath = savedBgPath ?? null;
      setBgImagePath(bgPath);
      const bgImgOpacity = savedBgOpacity ?? DEFAULT_BG_IMAGE_OPACITY;
      setBgImageOpacity(bgImgOpacity);
      document.documentElement.style.setProperty(
        "--bg-image-opacity",
        String(bgImgOpacity),
      );
      const bgBlurVal = savedBgBlur ?? DEFAULT_BG_BLUR;
      setBgBlur(bgBlurVal);
      document.documentElement.style.setProperty("--bg-blur", `${bgBlurVal}px`);
      const glassClarityVal = savedGlassClarity ?? DEFAULT_GLASS_CLARITY;
      setGlassClarity(glassClarityVal);
      applyGlassClarity(glassClarityVal);
      if (bgPath) {
        try {
          const bytes = await invoke<number[]>("read_image_file", {
            path: bgPath,
          });
          const blob = new Blob([new Uint8Array(bytes)], {
            type: "image/webp",
          });
          const url = URL.createObjectURL(blob);
          setBgImagePreview(url);
          document.documentElement.style.setProperty(
            "--bg-image",
            `url(${url})`,
          );
        } catch {
          setBgImagePreview(null);
          document.documentElement.style.setProperty("--bg-image", "none");
        }
      }
      setIsLoading(false);
    };
    loadConfig();
  }, []);

  // 监听 themeChange（侧边栏切换主题时），保持设置页高亮同步
  useEffect(() => {
    const handler = async () => {
      const [savedMode, savedColor, savedCustom] = await Promise.all([
        getConfig<ThemeMode>("theme_mode"),
        getConfig<string>("theme_color"),
        getConfig<ThemeColor[]>("theme_custom_colors"),
      ]);
      setThemeMode(savedMode ?? "system");
      setThemeColor(savedColor ?? DEFAULT_THEME_COLOR);
      setCustomColors(savedCustom ?? []);
    };
    window.addEventListener("themeChange", handler);
    return () => window.removeEventListener("themeChange", handler);
  }, []);

  useEffect(() => {
    if (isLoading) return;
    const allColors = getAllColors(customColors);
    const color = allColors.find((c) => c.name === themeColor) ?? allColors[0];
    if (color) applyThemeColor(color.colors);
    applyThemeModeLocal(themeMode);
  }, [themeMode, themeColor, customColors, isLoading]);

  useEffect(() => {
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      applyThemeModeLocal("system");
      emit("theme-changed", "system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeMode]);

  useEffect(() => {
    if (!showPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (screenPickerOpen) return;
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    const onScroll = () => setShowPicker(false);
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [showPicker, screenPickerOpen]);

  const handleModeChange = async (mode: ThemeMode) => {
    setThemeMode(mode);
    await setConfig("theme_mode", mode);
    dispatchThemeChange();
    emit("theme-changed", mode);

    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.style.transition = "opacity 0.16s ease";
      rootEl.style.opacity = "0";
      setTimeout(() => {
        applyThemeModeLocal(mode);
        // 恢复透明度：不依赖 rAF（透明窗口合成时可能不触发），用普通定时器兜底
        setTimeout(() => {
          rootEl.style.opacity = "1";
          rootEl.style.transition = "";
        }, 40);
      }, 170);
    } else {
      applyThemeModeLocal(mode);
    }
  };

  const handleColorChange = async (colorName: string) => {
    setThemeColor(colorName);
    await setConfig("theme_color", colorName);
    dispatchThemeChange();
  };

  const convertToWebP = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Failed to get canvas context"));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL("image/webp", 0.92);
        URL.revokeObjectURL(img.src);
        resolve(dataUrl);
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error("Failed to load image"));
      };
      img.src = URL.createObjectURL(file);
    });
  }, []);

  const handleBgImageSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await convertToWebP(file);
        const savedPath = await invoke<string>("save_background_image", {
          data: dataUrl,
        });
        setBgImagePath(savedPath);
        setBgImagePreview(dataUrl);
        document.documentElement.style.setProperty(
          "--bg-image",
          `url(${dataUrl})`,
        );
        await setConfig("bg_image_path", savedPath);
      } catch (err) {
        console.error("Failed to save background image:", err);
      }
      if (bgFileInputRef.current) bgFileInputRef.current.value = "";
    },
    [convertToWebP],
  );

  const handleBgImageRemove = useCallback(async () => {
    try {
      await invoke("delete_background_image");
    } catch {
      // ignore
    }
    setBgImagePath(null);
    setBgImagePreview(null);
    document.documentElement.style.setProperty("--bg-image", "none");
    await setConfig("bg_image_path", null);
  }, []);

  const handleBgImageOpacityChange = useCallback(async (value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    setBgImageOpacity(clamped);
    document.documentElement.style.setProperty(
      "--bg-image-opacity",
      String(clamped),
    );
    await setConfig("bg_image_opacity", clamped);
  }, []);

  const handleBgImageOpacityReset = useCallback(async () => {
    setBgImageOpacity(DEFAULT_BG_IMAGE_OPACITY);
    document.documentElement.style.setProperty(
      "--bg-image-opacity",
      String(DEFAULT_BG_IMAGE_OPACITY),
    );
    await setConfig("bg_image_opacity", DEFAULT_BG_IMAGE_OPACITY);
  }, []);

  const handleBgBlurChange = useCallback(async (value: number) => {
    const clamped = Math.max(0, Math.min(40, value));
    setBgBlur(clamped);
    document.documentElement.style.setProperty("--bg-blur", `${clamped}px`);
    await setConfig("bg_blur", clamped);
  }, []);

  const handleBgBlurReset = useCallback(async () => {
    setBgBlur(DEFAULT_BG_BLUR);
    document.documentElement.style.setProperty(
      "--bg-blur",
      `${DEFAULT_BG_BLUR}px`,
    );
    await setConfig("bg_blur", DEFAULT_BG_BLUR);
  }, []);

  const handleGlassClarityChange = useCallback(async (value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    setGlassClarity(clamped);
    applyGlassClarity(clamped);
    // 广播给其他窗口（托盘面板等），让它们实时跟随清晰度变化
    emit("theme-changed", themeModeRef.current);
    await setConfig("glass_clarity", clamped);
  }, []);

  const handleGlassClarityReset = useCallback(async () => {
    setGlassClarity(DEFAULT_GLASS_CLARITY);
    applyGlassClarity(DEFAULT_GLASS_CLARITY);
    emit("theme-changed", themeModeRef.current);
    await setConfig("glass_clarity", DEFAULT_GLASS_CLARITY);
  }, []);

  const handleSaveCustom = async () => {
    const normalized = pickerHex.replace(/^#?([0-9a-fA-F]{6})$/, "#$1");
    const hex = /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : "#6366f1";
    const label = pickerLabel.trim() || hex.toUpperCase();

    if (editingColor) {
      const updated = customColors.map((c) =>
        c.name === editingColor.name
          ? { ...c, label, colors: generateColorScale(hex) }
          : c,
      );
      setCustomColors(updated);
      await setConfig("theme_custom_colors", updated);
      dispatchThemeChange();
      setShowPicker(false);
      setEditingColor(null);
      setPickerLabel("");
      return;
    }

    const name = `custom-${Date.now()}`;
    const newColor: ThemeColor = {
      name,
      label,
      colors: generateColorScale(hex),
    };
    const updated = [...customColors, newColor];
    setCustomColors(updated);
    setThemeColor(name);
    await Promise.all([
      setConfig("theme_custom_colors", updated),
      setConfig("theme_color", name),
    ]);
    dispatchThemeChange();
    setShowPicker(false);
    setPickerLabel("");
  };

  const handleDeleteCustom = async (colorName: string) => {
    const updated = customColors.filter((c) => c.name !== colorName);
    setCustomColors(updated);
    if (themeColor === colorName) {
      const fallback = PRESET_COLORS[0];
      setThemeColor(fallback.name);
      applyThemeColor(fallback.colors);
      await setConfig("theme_color", fallback.name);
    }
    await setConfig("theme_custom_colors", updated);
    dispatchThemeChange();
    setCtxMenu(null);
  };

  const openPicker = (mode: "add" | "edit", color?: ThemeColor) => {
    if (mode === "edit" && color) {
      setPickerHex(color.colors[500]);
      setHexDraft(
        color.colors[500].startsWith("#")
          ? color.colors[500].slice(1)
          : color.colors[500],
      );
      setPickerLabel(color.label);
      setEditingColor(color);
    } else {
      setPickerHex("#6366f1");
      setHexDraft("6366f1");
      setPickerLabel("");
      setEditingColor(null);
    }
    setShowPicker(true);
  };

  const closePicker = () => {
    setShowPicker(false);
    setEditingColor(null);
    setPickerLabel("");
  };

  const handleScreenPick = (hex: string) => {
    setScreenPickerOpen(false);
    setPickerHex(hex);
    setHexDraft(hex.startsWith("#") ? hex.slice(1) : hex);
  };

  const handlePickFromScreen = () => {
    // WebView2 中 EyeDropper API 存在但 open() 静默失效，Tauri 环境下改用原生截图 + 放大镜覆盖层
    if (isTauri()) {
      if (!isWindowsPlatform()) return;
      setScreenPickerOpen(true);
      return;
    }
    if (typeof window === "undefined" || !("EyeDropper" in window)) return;
    (async () => {
      try {
        const dropper = new (
          window as unknown as {
            EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> };
          }
        ).EyeDropper();
        const result = await dropper.open();
        if (result?.sRGBHex) {
          const hex = result.sRGBHex;
          setPickerHex(hex);
          setHexDraft(hex.startsWith("#") ? hex.slice(1) : hex);
        }
      } catch {
        // 用户取消取色
      }
    })();
  };

  if (isLoading) return null;

  const modeOptions: { value: ThemeMode; label: string; icon: JSX.Element }[] =
    [
      {
        value: "light",
        label: t("settings.general.theme_light"),
        icon: <MorphIcon icon={Sun} size={16} />,
      },
      {
        value: "dark",
        label: t("settings.general.theme_dark"),
        icon: <MorphIcon icon={Moon} size={16} />,
      },
      {
        value: "system",
        label: t("settings.general.theme_system"),
        icon: <MorphIcon icon={Monitor} size={16} />,
      },
    ];

  const hsv = hexToHsv(pickerHex);

  return (
    <div className="space-y-6">
      {/* Theme Mode */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">
            {t("settings.appearance.theme_mode")}
          </p>
          <p className="text-sm text-muted mt-0.5">
            {t("settings.appearance.theme_mode_desc")}
          </p>
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-default-100/60 ring-1 ring-default-200/50">
          {modeOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleModeChange(opt.value)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer ${
                themeMode === opt.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted hover:text-foreground hover:bg-default-200/50"
              }`}
            >
              {opt.icon}
              <span className="hidden sm:inline">{opt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <SettingsDivider />

      {/* Theme Color */}
      <div>
        <div className="mb-4">
          <p className="font-medium text-foreground">
            {t("settings.appearance.theme_color")}
          </p>
          <p className="text-sm text-muted mt-0.5">
            {t("settings.appearance.theme_color_desc")}
          </p>
        </div>
        <div className="space-y-4">
          {/* Preset row */}
          <div className="flex items-start gap-3">
            <span className="w-14 shrink-0 text-sm text-muted pt-2.5">
              {t("settings.appearance.theme_color_preset")}
            </span>
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
              {PRESET_COLORS.map((color) => (
                <button
                  key={color.name}
                  onClick={() => handleColorChange(color.name)}
                  className={`relative w-10 h-10 rounded-full transition-all duration-200 cursor-pointer ${
                    themeColor === color.name
                      ? "ring-2 ring-offset-2 ring-offset-background scale-110"
                      : "hover:scale-105"
                  }`}
                  style={{
                    backgroundColor: color.colors[500],
                    ["--tw-ring-color" as string]:
                      themeColor === color.name ? color.colors[500] : undefined,
                  }}
                  title={color.label}
                >
                  {themeColor === color.name && (
                    <MorphIcon
                      icon={Check}
                      size={20}
                      className="absolute inset-0 m-auto drop-shadow-md"
                      color="white"
                      strokeWidth={2.5}
                    />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Custom row */}
          <div className="flex items-start gap-3">
            <span className="w-14 shrink-0 text-sm text-muted pt-2.5">
              {t("settings.appearance.theme_color_custom")}
            </span>
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
              {customColors.map((color) => (
                <button
                  key={color.name}
                  onClick={() => handleColorChange(color.name)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ color, x: e.clientX, y: e.clientY });
                  }}
                  className={`relative w-10 h-10 rounded-full transition-all duration-200 cursor-pointer ${
                    themeColor === color.name
                      ? "ring-2 ring-offset-2 ring-offset-background scale-110"
                      : "hover:scale-105"
                  }`}
                  style={{
                    backgroundColor: color.colors[500],
                    ["--tw-ring-color" as string]:
                      themeColor === color.name ? color.colors[500] : undefined,
                  }}
                  title={color.label}
                >
                  {themeColor === color.name && (
                    <MorphIcon
                      icon={Check}
                      size={20}
                      className="absolute inset-0 m-auto drop-shadow-md"
                      color="white"
                      strokeWidth={2.5}
                    />
                  )}
                </button>
              ))}

              {/* Add button */}
              <div className="relative" ref={triggerRef}>
                <button
                  onClick={() => openPicker("add")}
                  className="w-10 h-10 rounded-full border-2 border-dashed border-default-300 hover:border-primary/60 flex items-center justify-center transition-all duration-200 cursor-pointer hover:scale-105 text-muted hover:text-primary"
                  title="Add custom color"
                >
                  <MorphIcon icon={Plus} size={20} strokeWidth={2} />
                </button>

                {showPicker &&
                  createPortal(
                    <>
                      <div
                        className="fixed inset-0 z-[9998]"
                        onClick={closePicker}
                      />
                      <div
                        ref={pickerRef}
                        className="fixed p-4 rounded-2xl glass-surface-strong shadow-2xl animate-scale-in z-[9999] w-64"
                        style={{
                          top: pickerPos?.top ?? -9999,
                          left: pickerPos?.left ?? -9999,
                        }}
                      >
                        <p className="text-sm font-medium text-foreground mb-3">
                          {editingColor ? "Edit Color" : "Custom Color"}
                        </p>

                        {/* 取色面板：饱和度/亮度 */}
                        <div
                          className="relative w-full"
                          style={{
                            height: 160,
                            borderRadius: 12,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            className="absolute inset-0"
                            style={{
                              backgroundColor: `hsl(${hsv.h} 100% 50%)`,
                              backgroundImage:
                                "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
                            }}
                          />
                          <div
                            ref={satDrag.ref}
                            onPointerDown={satDrag.onPointerDown}
                            onPointerMove={satDrag.onPointerMove}
                            onPointerUp={satDrag.onPointerUp}
                            onPointerCancel={satDrag.onPointerCancel}
                            className="absolute inset-0"
                            style={{ touchAction: "none", cursor: "crosshair" }}
                            role="slider"
                            aria-label="Color"
                            aria-valuetext={`Saturation ${Math.round(hsv.s)}%, Brightness ${Math.round(hsv.v)}%`}
                          />
                          <div
                            className="absolute rounded-full"
                            style={{
                              width: 24,
                              height: 24,
                              left: `${hsv.s}%`,
                              top: `${100 - hsv.v}%`,
                              transform: "translate(-50%, -50%)",
                              pointerEvents: "none",
                              backgroundColor: "#ffffff",
                              border: "2px solid #ffffff",
                              boxShadow:
                                "0 1px 3px rgba(0,0,0,.4), inset 0 0 0 1px rgba(0,0,0,.15)",
                            }}
                          />
                        </div>

                        {/* 取色面板：色相 */}
                        <div
                          className="relative w-full mt-3"
                          style={{
                            height: 20,
                            borderRadius: 999,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            className="absolute inset-0"
                            style={{
                              background:
                                "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
                            }}
                          />
                          <div
                            ref={hueDrag.ref}
                            onPointerDown={hueDrag.onPointerDown}
                            onPointerMove={hueDrag.onPointerMove}
                            onPointerUp={hueDrag.onPointerUp}
                            onPointerCancel={hueDrag.onPointerCancel}
                            className="absolute inset-0"
                            style={{ touchAction: "none", cursor: "pointer" }}
                            role="slider"
                            aria-label="Hue"
                            aria-valuenow={Math.round(hsv.h)}
                            aria-valuemin={0}
                            aria-valuemax={360}
                          />
                          <div
                            className="absolute rounded-full"
                            style={{
                              width: 22,
                              height: 22,
                              left: `${(hsv.h / 360) * 100}%`,
                              top: "50%",
                              transform: "translate(-50%, -50%)",
                              pointerEvents: "none",
                              backgroundColor: "#ffffff",
                              border: "2px solid #ffffff",
                              boxShadow:
                                "0 1px 3px rgba(0,0,0,.4), inset 0 0 0 1px rgba(0,0,0,.15)",
                            }}
                          />
                        </div>

                        {/* 颜色预览 + Hex 输入 */}
                        <div className="flex items-center gap-3 mt-3 mb-3">
                          <div
                            className="w-10 h-10 shrink-0 rounded-xl ring-1 ring-separator shadow-inner"
                            style={{ backgroundColor: pickerHex }}
                          />
                          <div className="flex items-center gap-1 glass-field flex-1 min-w-0 h-9 px-3 rounded-xl">
                            <span className="text-muted/70 font-mono text-sm shrink-0">
                              #
                            </span>
                            <input
                              type="text"
                              value={hexDraft}
                              onChange={(e) => {
                                const v = e.target.value
                                  .replace(/[^0-9a-fA-F]/g, "")
                                  .slice(0, 6);
                                setHexDraft(v);
                                if (/^[0-9a-fA-F]{6}$/.test(v))
                                  setPickerHex(`#${v}`);
                              }}
                              onPaste={(e) => {
                                e.preventDefault();
                                const pasted = e.clipboardData
                                  .getData("text")
                                  .trim();
                                const clean = pasted
                                  .replace(/^#/, "")
                                  .replace(/^0x/, "")
                                  .replace(/[^0-9a-fA-F]/g, "")
                                  .slice(0, 6);
                                setHexDraft(clean);
                                if (/^[0-9a-fA-F]{6}$/.test(clean))
                                  setPickerHex(`#${clean}`);
                              }}
                              onBlur={() => {
                                if (/^[0-9a-fA-F]{6}$/.test(hexDraft)) {
                                  setPickerHex(`#${hexDraft}`);
                                } else {
                                  setHexDraft(
                                    pickerHex.startsWith("#")
                                      ? pickerHex.slice(1)
                                      : pickerHex,
                                  );
                                }
                              }}
                              onKeyDown={(e) => {
                                if (
                                  e.key === "Enter" &&
                                  /^[0-9a-fA-F]{6}$/.test(hexDraft)
                                ) {
                                  setPickerHex(`#${hexDraft}`);
                                  handleSaveCustom();
                                }
                              }}
                              className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted/70 font-mono focus:outline-none"
                              placeholder="000000"
                              maxLength={6}
                            />
                          </div>
                          {canPickFromScreen && (
                            <button
                              type="button"
                              onClick={handlePickFromScreen}
                              title="Pick color from screen"
                              className="w-10 h-10 shrink-0 flex items-center justify-center glass-field rounded-xl text-muted hover:text-foreground transition-colors cursor-pointer"
                            >
                              <MorphIcon
                                icon={Pipette}
                                size={16}
                                strokeWidth={1.8}
                              />
                            </button>
                          )}
                        </div>

                        {/* RGB 输入 */}
                        <div className="flex items-center gap-2 mb-3">
                          {(
                            [
                              ["r", "R"],
                              ["g", "G"],
                              ["b", "B"],
                            ] as const
                          ).map(([ch, label]) => (
                            <div
                              key={ch}
                              className="flex items-center gap-1 glass-field flex-1 min-w-0 h-9 px-3 rounded-xl"
                            >
                              <span className="text-muted/60 font-mono text-sm shrink-0">
                                {label}
                              </span>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={rgbDraft[ch]}
                                onChange={(e) =>
                                  handleRgbChange(ch, e.target.value)
                                }
                                onBlur={() => {
                                  if (rgbDraft[ch] === "") {
                                    setRgbDraft({ ...rgbDraft, [ch]: "0" });
                                    handleRgbChange(ch, "0");
                                  }
                                }}
                                className="flex-1 min-w-0 bg-transparent text-sm text-foreground font-mono focus:outline-none"
                                maxLength={3}
                              />
                            </div>
                          ))}
                        </div>

                        <input
                          type="text"
                          value={pickerLabel}
                          onChange={(e) => setPickerLabel(e.target.value)}
                          className="glass-field w-full min-w-0 h-9 px-3 rounded-xl text-sm text-foreground placeholder:text-muted/70 mb-3 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40"
                          placeholder="Color name (optional)"
                        />

                        <div className="flex gap-2">
                          <button
                            onClick={closePicker}
                            className="flex-1 h-9 px-3 rounded-xl glass-field text-sm text-muted hover:text-foreground transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleSaveCustom}
                            className="flex-1 h-9 px-3 rounded-xl bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
                          >
                            {editingColor ? "Save" : "Add"}
                          </button>
                        </div>
                      </div>
                    </>,
                    document.body,
                  )}
              </div>
            </div>
          </div>
        </div>

        {/* Custom color context menu */}
        {ctxMenu &&
          createPortal(
            <>
              <div
                className="fixed inset-0 z-[9998]"
                onClick={() => setCtxMenu(null)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu(null);
                }}
              />
              <div
                className="fixed z-[9999] glass-surface-strong rounded-xl shadow-2xl p-1 w-36 animate-scale-in"
                style={{
                  top: Math.min(ctxMenu.y, window.innerHeight - 96),
                  left: Math.min(ctxMenu.x, window.innerWidth - 152),
                }}
              >
                <button
                  onClick={() => {
                    setCtxMenu(null);
                    openPicker("edit", ctxMenu.color);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-foreground hover:bg-default-100 transition-colors cursor-pointer"
                >
                  <MorphIcon
                    icon={Pencil}
                    size={16}
                    className="text-muted"
                    strokeWidth={1.8}
                  />
                  {t("common.edit")}
                </button>
                <button
                  onClick={() => handleDeleteCustom(ctxMenu.color.name)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-danger hover:bg-danger/10 transition-colors cursor-pointer"
                >
                  <MorphIcon icon={Trash2} size={16} strokeWidth={1.8} />
                  {t("common.delete")}
                </button>
              </div>
            </>,
            document.body,
          )}

        {screenPickerOpen &&
          createPortal(
            <ScreenColorPicker
              onPick={handleScreenPick}
              onCancel={() => setScreenPickerOpen(false)}
            />,
            document.body,
          )}
      </div>

      <SettingsDivider />

      {/* Background Image */}
      <div>
        <div className="mb-4">
          <p className="font-medium text-foreground">
            {t("settings.appearance.bg_image")}
          </p>
          <p className="text-sm text-muted mt-0.5">
            {t("settings.appearance.bg_image_desc")}
          </p>
        </div>

        {/* Hidden file input */}
        <input
          ref={bgFileInputRef}
          type="file"
          accept="image/*"
          onChange={handleBgImageSelect}
          className="hidden"
        />

        {bgImagePreview ? (
          <div className="space-y-3">
            {/* Preview - full width, clickable to change */}
            <button
              onClick={() => bgFileInputRef.current?.click()}
              className="relative w-full rounded-xl overflow-hidden border border-separator cursor-pointer group block text-left flex items-center justify-center"
            >
              <img
                src={bgImagePreview}
                alt="Background preview"
                className="w-full h-32 object-cover"
              />
              {/* Remove button - overlaid on image */}
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  handleBgImageRemove();
                }}
                className="absolute top-2 right-2 p-1.5 rounded-lg bg-danger/90 text-white hover:bg-danger transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95"
                title={t("settings.appearance.bg_image_remove")}
              >
                <MorphIcon icon={X} size={14} strokeWidth={2} />
              </span>
            </button>

            {/* Image opacity */}
            <div>
              <p className="text-sm text-muted mb-2">
                {t("settings.appearance.bg_image_opacity")}
              </p>
              <div className="flex items-center gap-4">
                <Slider
                  min={0}
                  max={1}
                  step={0.01}
                  value={[bgImageOpacity]}
                  onValueChange={([value]) => handleBgImageOpacityChange(value)}
                  aria-label={t("settings.appearance.bg_image_opacity")}
                  className="flex-1"
                />
                <span className="w-14 text-center text-sm font-mono text-foreground tabular-nums">
                  {Math.round(bgImageOpacity * 100)}%
                </span>
                <button
                  onClick={handleBgImageOpacityReset}
                  disabled={bgImageOpacity === DEFAULT_BG_IMAGE_OPACITY}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-separator text-muted hover:text-foreground hover:border-foreground/50 transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                >
                  {t("common.reset")}
                </button>
              </div>
            </div>

            {/* Background blur */}
            <div>
              <p className="text-sm text-muted mb-2">
                {t("settings.appearance.bg_blur")}
              </p>
              <div className="flex items-center gap-4">
                <Slider
                  min={0}
                  max={40}
                  step={1}
                  value={[bgBlur]}
                  onValueChange={([value]) => handleBgBlurChange(value)}
                  aria-label={t("settings.appearance.bg_blur")}
                  className="flex-1"
                />
                <span className="w-14 text-center text-sm font-mono text-foreground tabular-nums">
                  {bgBlur}px
                </span>
                <button
                  onClick={handleBgBlurReset}
                  disabled={bgBlur === DEFAULT_BG_BLUR}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-separator text-muted hover:text-foreground hover:border-foreground/50 transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
                >
                  {t("common.reset")}
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* No image - show select button */
          <button
            onClick={() => bgFileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-3 p-6 rounded-xl border-2 border-dashed border-default-300 hover:border-primary/50 text-muted hover:text-foreground transition-all duration-200 cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
          >
            <MorphIcon icon={ImagePlus} size={24} strokeWidth={1.5} />
            <span className="text-sm">
              {t("settings.appearance.bg_image_select")}
            </span>
          </button>
        )}
      </div>

      <SettingsDivider />

      <div>
        <div className="mb-3">
          <p className="font-medium text-foreground">
            {t("settings.appearance.glass_clarity")}
          </p>
          <p className="text-sm text-muted mt-0.5">
            {t("settings.appearance.glass_clarity_desc")}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Slider
            min={0}
            max={100}
            step={1}
            value={[glassClarity]}
            onValueChange={([value]) => handleGlassClarityChange(value)}
            aria-label={t("settings.appearance.glass_clarity")}
            className="flex-1"
          />
          <span className="w-12 text-right text-sm font-mono text-foreground tabular-nums">
            {glassClarity}%
          </span>
          <button
            onClick={handleGlassClarityReset}
            disabled={glassClarity === DEFAULT_GLASS_CLARITY}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-separator text-muted hover:text-foreground hover:border-foreground/50 transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
          >
            {t("common.reset")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 设置页内部别名：主题模式应用已迁移到 `@/utils/theme` */
const applyThemeModeLocal = applyThemeMode;

function dispatchThemeChange() {
  window.dispatchEvent(new CustomEvent("themeChange"));
}

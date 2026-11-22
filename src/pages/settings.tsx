import { useTranslation } from "react-i18next";
import {
  GlassAlertDialog,
  GlassButton,
  GlassCard,
  GlassSelect,
  GlassSkeleton,
  GlassSwitch,
} from "@/components/ui/glass";
import { GameLaunchSettings } from "@/components/game-launch-settings";
import { AppearanceSettings } from "@/components/appearance-settings";
import { NetworkSettings } from "@/components/network-settings";
import { SystemResourceSettings } from "@/components/system-resource-settings";
import { TodoSettings } from "@/components/todo-settings";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  buildSettingsSections,
  jumpToSettingAnchor,
  useActiveSettingsSection,
  SettingsMobileNav,
  SettingsSideNav,
} from "@/components/settings-nav";
import {
  getAppIdentifier,
  getAppVersion,
  getTauriVersionSafe,
} from "@/utils/appInfoService";
import { getConfig, setConfig } from "@/utils/configService";
import { roleDetailService } from "@/utils/roleDetailService";
import { isTrayAvailable, setTrayUser } from "@/utils/trayService";
import { SettingsDivider } from "@/components/ui/settings-row";
import { AccountNameLine } from "@/components/ui/game-badge";
import {
  fetchRemoteVersion,
  getRemoteVersion,
  subscribeRemoteVersion,
  getChannel,
  setChannel,
  getSource,
  setSource,
  initializeChannel,
  type RemoteVersionState,
  type UpdateChannel,
  type UpdateSource,
} from "@/utils/updateService";
import { pushGlobalAlert } from "@/components/ui/global-alert";
import { UpdateDialog } from "@/components/update-dialog";
import { isWindowsPlatform, isMobileApp, isAndroidApp, isIosApp } from "@/utils/platform";

export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const supportsLauncher = isWindowsPlatform();
  // 窗口关闭行为 / 托盘展示角色：仅桌面（有系统托盘与窗口关闭按钮）可见。
  const supportsTray = !isMobileApp();
  // 桌面使用 Tauri updater；Android 下载 APK 并交给系统安装器确认。
  const supportsUpdater = !isMobileApp();
  const supportsUpdateChecks = supportsUpdater || isAndroidApp();
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const langDropdownRef = useRef<HTMLDivElement>(null);
  const langBtnRef = useRef<HTMLButtonElement>(null);
  const langDropdownMenuRef = useRef<HTMLDivElement>(null);
  const [langDropdownPos, setLangDropdownPos] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const [refreshOnSwitch, setRefreshOnSwitch] = useState(false);
  const [lazyLoadEnabled, setLazyLoadEnabled] = useState(true);
  const [wikiDetailPreload, setWikiDetailPreload] = useState(false);
  const [closeAction, setCloseAction] = useState<string>("ask");
  const [trayAvailable, setTrayAvailable] = useState(true);
  const [trayUserRoleId, setTrayUserRoleId] = useState<string>("");
  const [accounts, setAccounts] = useState<
    Array<{ id: string; nickname: string; avatar: string; game?: string }>
  >([]);

  const [developerMode, setDeveloperMode] = useState(false);
  const [showDevWarning, setShowDevWarning] = useState(false);
  const [isConfigLoading, setIsConfigLoading] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [tauriVersion, setTauriVersion] = useState("");
  const [appId, setAppId] = useState("");
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [remoteVersion, setRemoteVersion] =
    useState<RemoteVersionState>(getRemoteVersion());
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>("stable");
  const [updateSource, setUpdateSource] = useState<UpdateSource>("github");
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);
  const [showPreviewWarning, setShowPreviewWarning] = useState(false);
  const [showGithubWarning, setShowGithubWarning] = useState(false);
  const [pendingChannel, setPendingChannel] = useState<UpdateChannel | null>(
    null,
  );
  const [pendingSource, setPendingSource] = useState<UpdateSource | null>(null);

  // 设置导航（分区栏 / 搜索框）：分区索引按平台能力生成，与下面渲染的卡片一一对应。
  const [navQuery, setNavQuery] = useState("");
  const sections = useMemo(
    () =>
      buildSettingsSections({
        supportsLauncher,
        supportsTray,
        supportsUpdateChecks,
      }),
    [supportsLauncher, supportsTray, supportsUpdateChecks],
  );
  const sectionAnchors = useMemo(
    () => sections.map((section) => section.anchor),
    [sections],
  );
  const { active: activeAnchor, navRef } = useActiveSettingsSection(sectionAnchors);

  const jumpToItem = useCallback((id: string) => {
    // 手机端搜索结果是浮在内容上的列表：点完要收起来，否则遮住的正好是目标行
    setNavQuery("");
    // 等搜索结果收起、布局回稳后再滚，否则目标位置按「列表还开着」算
    window.requestAnimationFrame(() => jumpToSettingAnchor(id));
  }, []);

  const jumpToSection = useCallback((anchor: string) => {
    setNavQuery("");
    window.requestAnimationFrame(() => jumpToSettingAnchor(anchor));
  }, []);

  // 桌面端 Cmd/Ctrl+F 直接聚焦设置搜索框（长页面里浏览器自带查找不好用）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "f")
        return;
      // 窄屏的分区栏是 `lg:hidden`：它里面的输入框也在 DOM 里，但 `display:none`
      // 的祖先下 focus() 无效。这里挑第一个「确实可见」的搜索框。
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          "[data-settings-search] input",
        ),
      );
      const input = inputs.find((el) => el.offsetParent !== null);
      if (!input) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const languages = [
    { key: "en", label: "English" },
    { key: "zh", label: "简体中文" },
  ];

  useEffect(() => {
    const loadConfig = async () => {
      setIsConfigLoading(true);
      const [
        value,
        lazyLoadValue,
        devMode,
        wikiPreload,
        version,
        tauriVer,
        identifier,
        closeAct,
        trayUser,
        trayAvailability,
      ] = await Promise.all([
        getConfig<boolean>("refresh_on_account_switch"),
        roleDetailService.isLazyLoadEnabled(),
        getConfig<boolean>("developer_mode"),
        getConfig<boolean>("wiki_detail_preload"),
        // 版本/标识符走永不 reject 的封装：IPC 失败时退回构建期常量，
        // 不会因为其中一个失败就把整页配置一起打回默认值。
        getAppVersion(),
        getTauriVersionSafe(),
        getAppIdentifier(),
        getConfig<string>("close_action"),
        getConfig<string>("tray_user_role_id"),
        isTrayAvailable(),
      ]);
      setRefreshOnSwitch(value ?? false);
      setLazyLoadEnabled(lazyLoadValue);
      setWikiDetailPreload(wikiPreload ?? false);
      setDeveloperMode(devMode ?? false);
      setAppVersion(version);
      setTauriVersion(tauriVer);
      setAppId(identifier);
      setCloseAction(closeAct ?? "ask");
      setTrayUserRoleId(trayUser ?? "");
      setTrayAvailable(trayAvailability);
      // 托盘不可用时把残留的 minimize_to_tray 收敛为 close，避免选项无高亮、行为含糊。
      if (!trayAvailability && closeAct === "minimize_to_tray") {
        setCloseAction("close");
        void setConfig("close_action", "close");
      }
      setIsConfigLoading(false);

      // Load accounts for tray user selection
      try {
        const { getAccounts } = await import("@/utils/accountService");
        const accts = await getAccounts();
        setAccounts(
          accts.map((a) => ({
            id: a.id,
            nickname: a.nickname,
            avatar: a.avatar,
            // 游戏必须一起带上：下拉里两个游戏的角色混在一起，只显示昵称分不清
            game: a.game,
          })),
        );
      } catch {
        // ignore
      }

      // Load update channel and source
      await initializeChannel();
      setUpdateChannel(getChannel());
      setUpdateSource(getSource());
    };
    loadConfig().then(() => {
      // Auto-fetch remote version after channel is initialized
      fetchRemoteVersion();
    });

    // Subscribe to remote version changes
    const unsub = subscribeRemoteVersion(() => {
      setRemoteVersion(getRemoteVersion());
    });

    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!isLangDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (langDropdownMenuRef.current?.contains(event.target as Node)) return;
      if (langDropdownRef.current?.contains(event.target as Node)) return;
      setIsLangDropdownOpen(false);
    };
    const onScroll = () => setIsLangDropdownOpen(false);
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [isLangDropdownOpen]);

  const handleLanguageChange = (langKey: string) => {
    i18n.changeLanguage(langKey);
    setIsLangDropdownOpen(false);
  };

  const handleRefreshOnSwitchChange = async (value: boolean) => {
    setRefreshOnSwitch(value);
    await setConfig("refresh_on_account_switch", value);
  };

  const handleLazyLoadChange = async (value: boolean) => {
    setLazyLoadEnabled(value);
    try {
      await roleDetailService.setLazyLoadEnabled(value);
    } catch {
      setLazyLoadEnabled(!value);
    }
  };

  const handleWikiDetailPreloadChange = async (value: boolean) => {
    setWikiDetailPreload(value);
    await setConfig("wiki_detail_preload", value);
  };

  const handleCloseActionChange = async (value: string) => {
    setCloseAction(value);
    await setConfig("close_action", value);
  };

  const handleTrayUserChange = async (value: string) => {
    setTrayUserRoleId(value);
    await setConfig("tray_user_role_id", value);
    await setTrayUser(value);
  };

  const handleDevModeToggle = (value: boolean) => {
    if (value) {
      setShowDevWarning(true);
    } else {
      setDeveloperMode(false);
      setConfig("developer_mode", false);
      window.dispatchEvent(
        new CustomEvent("developerModeChange", { detail: { enabled: false } }),
      );
    }
  };

  const confirmDevMode = () => {
    setDeveloperMode(true);
    setConfig("developer_mode", true);
    setShowDevWarning(false);
    window.dispatchEvent(
      new CustomEvent("developerModeChange", { detail: { enabled: true } }),
    );
  };

  const handleCheckUpdate = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      await fetchRemoteVersion();
      const state = getRemoteVersion();
      if (state.hasUpdate) {
        pushGlobalAlert(
          "success",
          i18n.language === "zh" ? "发现新版本！" : "Update available!",
        );
      } else if (state.error) {
        pushGlobalAlert(
          "danger",
          i18n.language === "zh"
            ? "检查更新失败"
            : "Failed to check for updates",
        );
      } else {
        pushGlobalAlert(
          "success",
          i18n.language === "zh" ? "已是最新版本" : "Already up to date",
        );
      }
    } catch {
      pushGlobalAlert(
        "danger",
        i18n.language === "zh" ? "检查更新失败" : "Failed to check for updates",
      );
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleChannelChange = useCallback(
    async (channel: UpdateChannel) => {
      if (channel === "preview" && updateChannel === "stable") {
        setPendingChannel(channel);
        setShowPreviewWarning(true);
        return;
      }
      setUpdateChannel(channel);
      setIsCheckingUpdate(true);
      try {
        await setChannel(channel);
      } finally {
        setIsCheckingUpdate(false);
      }
    },
    [updateChannel],
  );

  const handleSourceChange = useCallback(
    async (source: UpdateSource) => {
      if (source === "github" && updateSource === "mirror") {
        setPendingSource(source);
        setShowGithubWarning(true);
        return;
      }
      setUpdateSource(source);
      setIsCheckingUpdate(true);
      try {
        await setSource(source);
      } finally {
        setIsCheckingUpdate(false);
      }
    },
    [updateSource],
  );

  const confirmPreviewChannel = useCallback(async () => {
    setShowPreviewWarning(false);
    if (pendingChannel) {
      setUpdateChannel(pendingChannel);
      setIsCheckingUpdate(true);
      try {
        await setChannel(pendingChannel);
      } finally {
        setIsCheckingUpdate(false);
      }
      setPendingChannel(null);
    }
  }, [pendingChannel]);

  const confirmGithubSource = useCallback(async () => {
    setShowGithubWarning(false);
    if (pendingSource) {
      setUpdateSource(pendingSource);
      setIsCheckingUpdate(true);
      try {
        await setSource(pendingSource);
      } finally {
        setIsCheckingUpdate(false);
      }
      setPendingSource(null);
    }
  }, [pendingSource]);

  // Global listener: open update dialog from message action
  useEffect(() => {
    const handler = () => setShowUpdateDialog(true);
    window.addEventListener("openUpdateDialog", handler);
    return () => window.removeEventListener("openUpdateDialog", handler);
  }, []);

  const platformInfo = (() => {
    // Android 的 WebView UA 含 "Linux"，必须先判移动端，否则会误报成 Linux。
    if (isAndroidApp()) return "Android";
    if (isIosApp()) return "iOS";
    const ua = navigator.userAgent;
    if (ua.includes("Win")) return "Windows x64";
    if (ua.includes("Mac")) return "macOS";
    if (ua.includes("Linux")) return "Linux";
    return navigator.platform || "Unknown";
  })();

  return (
    /*
     * 宽屏（lg+）：两列网格，**右列从标题那一行就开始**，与「设置」二字的
     * 顶端齐平；标题与左栏都不跟随滚动，只有右列内部滚动。
     *
     * 网格定义 `lg:grid-rows-[auto_minmax(0,1fr)]`：
     *   row 1 (auto)      ← 只放标题，高度 = 标题块
     *   row 2 (1fr)       ← 左栏导航
     * 右列 `row-span-2` 同时跨两行，于是它的顶边贴着 row 1 的顶边（= 标题
     * 顶端），底边吃到容器底部。左栏则从 row 2 开始，正好排在标题下方 ——
     * 这就是「右侧顶端对齐设置字样顶端」的几何来源。
     *
     * 窄屏仍是 `flex-col`：标题 → 吸附条 → 卡片，整页随 `<main>` 滚动。
     * 手机上标题不钉住，把高度留给内容；分区导航由吸附的搜索条承担。
     */
    <div className="mx-auto flex w-full max-w-3xl flex-col pb-12 wide:grid wide:h-full wide:max-w-5xl wide:grid-cols-[248px_minmax(0,1fr)] wide:grid-rows-[auto_minmax(0,1fr)] wide:gap-x-6 wide:pb-0">
      <header className="shrink-0 wide:col-start-1 wide:row-start-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
          {t("settings.title")}
        </h1>
        <p className="mt-1.5 text-foreground/70">
          {t("common.managePreferences")}
        </p>
      </header>

      {/*
       * 窄屏（手机 / Android）：搜索框 + 横向分区胶囊，吸附在页面顶部。
       *
       * 设置页原本是 8 张卡片顺序铺下来的长列表，手机上要滑好几屏才能找到
       * 某一项 —— 这条吸附条让「跳到某个分区 / 搜某一项」在任何位置都能做。
       *
       * ⚠️ 必须直接作为本页容器的子元素：`sticky` 的定位范围是**包含块**，
       * 套一层只包住它自己的 `<div>` 就等于没有可滚动距离，永远吸不住。
       * 宽屏下它自己是 `lg:hidden`（`display:none` 不生成盒子），不占网格单元。
       */}
      <SettingsMobileNav
        sections={sections}
        activeAnchor={activeAnchor}
        query={navQuery}
        onQueryChange={setNavQuery}
        onJumpItem={jumpToItem}
        onJumpSection={jumpToSection}
        navRef={navRef}
      />

      {/* 左栏导航：宽屏占 row 2（标题下方）；窄屏由上面的吸附条负责，这里隐藏 */}
      <div className="wide:col-start-1 wide:row-start-2 wide:flex wide:min-h-0 wide:flex-col">
        <SettingsSideNav
          sections={sections}
          activeAnchor={activeAnchor}
          query={navQuery}
          onQueryChange={setNavQuery}
          onJumpItem={jumpToItem}
          onJumpSection={jumpToSection}
        />
      </div>

      {/*
       * 右侧卡片列 = 唯一滚动容器，跨两行（顶边与标题齐平）。
       *
       * ⚠️ **必须是块级（block），不能是 grid / flex**。
       *
       * 这个容器的可视高度是被网格行定死的。一旦它自己是 grid 或 flex，
       * 卡片就成了它的"布局子项"、会参与压缩分配（grid 的 `auto` 行在确定
       * 高度下会收缩、flex 子项 `flex-shrink` 默认 1），实测 4 张卡从应有的
       * 362px 被压到 169px，正文被卡片的 `overflow:hidden` 裁掉 —— 页面只剩
       * 一排标题条。块级布局没有收缩语义：卡片保持内容高度，超出部分交给
       * 这里的 `overflow-y: auto`。间距用 `space-y-6`（块级 margin）。
       *
       * ② **上方留出「悬停余量」且卡片顶边仍与标题齐平**（`lg:-mt-4 lg:pt-4`，16px）。
       *
       *    `GlassCard` 悬停时上浮 4px（`lg:hover:-translate-y-1`）并以中心
       *    放大 1.01（`lg:hover:scale-[1.01]`），顶边实际外扩：
       *
       *        4px（位移） + 卡片高度 × 0.005（缩放取上半）
       *
       *    「通用设置」这张卡高约 800px，缩放一项就外扩 ~4px，合计 ~8px。
       *    ⚠️ 这是**按卡片高度变化**的量 —— 早先按 402px 小卡估算只留了 8px，
       *    换成真实高度后边际归零，抗锯齿一渲染顶边圆角就被削平（实测复现）。
       *    因此取 16px，覆盖到约 2400px 高的极端卡片仍有余量。
       *
       *    同时**不能把卡片整体下移**（要与「设置」二字齐平），故用负 margin
       *    把容器盒子向上扩、再用等量 padding 把内容推回：
       *      容器盒子顶边 = 68 - 16 = 52px   ← `lg:-mt-4`
       *      内容起点     = 52 + 16 = 68px   ← `lg:pt-4`
       *      卡片静止顶边 = 68px             ← 与标题齐平
       *      悬停后顶边   = 60px             ← 仍在 52 之内，不再被裁
       *
       *    `-ml-2/-mr-2` 同理给左右两侧 1.01 缩放留 8px（右侧另有 `pr-2`）。
       *
       * `data-no-ovs`：不要可见滚动条（全局已隐藏），溢出能滚但看不到条。
       * `lg:min-h-0` 不能省：网格项默认 `min-height: auto`（不小于内容），
       * 那样容器会被内容撑高、`overflow-y` 永远不触发。
       */}
      <div
        data-no-ovs
        className="mt-6 min-w-0 space-y-6 wide:col-start-2 wide:row-span-2 wide:row-start-1 wide:-ml-2 wide:-mr-2 wide:-mt-4 wide:min-h-0 wide:overflow-y-auto wide:overflow-x-hidden wide:pb-6 wide:pl-2 wide:pr-2 wide:pt-4 wide:scroll-touch"
      >
        {/* General Settings */}
        <GlassCard
          id="settings-general"
          className="shrink-0 p-4 sm:p-6 lg-material border border-separator/90"
        >
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
              <svg
                className="w-4 h-4 text-primary-text"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
              >
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
              </svg>
            </div>
            {t("settings.general.title")}
          </h2>
          {isConfigLoading ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <GlassSkeleton className="w-32 h-4 rounded-lg" />
                  <GlassSkeleton className="w-48 h-3 rounded-lg" />
                </div>
                <GlassSkeleton className="w-40 h-10 rounded-lg shrink-0" />
              </div>
              <SettingsDivider />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <GlassSkeleton className="w-24 h-4 rounded-lg" />
                  <GlassSkeleton className="w-40 h-3 rounded-lg" />
                </div>
                <GlassSkeleton className="w-12 h-6 rounded-full shrink-0" />
              </div>
              <SettingsDivider />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <GlassSkeleton className="w-36 h-4 rounded-lg" />
                  <GlassSkeleton className="w-56 h-3 rounded-lg" />
                </div>
                <GlassSkeleton className="w-12 h-6 rounded-full shrink-0" />
              </div>
              <SettingsDivider />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <GlassSkeleton className="w-28 h-4 rounded-lg" />
                  <GlassSkeleton className="w-44 h-3 rounded-lg" />
                </div>
                <GlassSkeleton className="w-12 h-6 rounded-full shrink-0" />
              </div>
              <SettingsDivider />
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <GlassSkeleton className="w-36 h-4 rounded-lg" />
                  <GlassSkeleton className="w-56 h-3 rounded-lg" />
                </div>
                <GlassSkeleton className="w-12 h-6 rounded-full shrink-0" />
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                <div id="settings-language" className="min-w-0">
                  <p className="font-medium text-foreground">
                    {t("settings.general.language")}
                  </p>
                  <p className="text-sm text-muted mt-0.5">
                    {i18n.language === "zh"
                      ? "选择您偏好的界面语言"
                      : "Choose your preferred language"}
                  </p>
                </div>
                <div className="w-full sm:w-48" ref={langDropdownRef}>
                  <GlassButton
                    ref={langBtnRef}
                    variant="outline"
                    className="w-full justify-between gap-2"
                    onPress={() => {
                      const next = !isLangDropdownOpen;
                      if (next && langBtnRef.current) {
                        const r = langBtnRef.current.getBoundingClientRect();
                        setLangDropdownPos({
                          top: r.bottom + 8,
                          left: r.left,
                          width: r.width,
                        });
                      }
                      setIsLangDropdownOpen(next);
                    }}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <svg
                        className="w-4 h-4 text-muted shrink-0"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        strokeWidth="1.5"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M2 12h20" />
                        <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                      </svg>
                      <span className="truncate">
                        {languages.find((lang) => lang.key === i18n.language)
                          ?.label ||
                          (i18n.language === "zh" ? "简体中文" : "English")}
                      </span>
                    </span>
                    <svg
                      className={`w-4 h-4 shrink-0 transition-transform duration-200 ${isLangDropdownOpen ? "rotate-180" : ""}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </GlassButton>

                  {isLangDropdownOpen &&
                    createPortal(
                      <div
                        ref={langDropdownMenuRef}
                        className="lg-regular fixed z-[9999] rounded-xl border border-separator/60 animate-scale-in"
                        style={{
                          top: langDropdownPos.top,
                          left: langDropdownPos.left,
                          width: langDropdownPos.width,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* 玻璃宿主与滚动容器分层：::before 材质层随滚动容器一起滚走 */}
                        <div className="max-h-72 overflow-y-auto rounded-xl">
                        <div className="py-1">
                          {languages.map((lang) => (
                            <button
                              key={lang.key}
                              className="w-full px-4 py-2.5 text-left lg-hoverable transition-colors flex items-center justify-between"
                              onClick={() => handleLanguageChange(lang.key)}
                            >
                              <span className="text-sm">{lang.label}</span>
                              {i18n.language === lang.key && (
                                <svg
                                  className="w-4 h-4 text-primary-text"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                            </button>
                          ))}
                        </div>
                        </div>
                      </div>,
                      document.body,
                    )}
                </div>
              </div>

              <SettingsDivider />

              <div
                id="settings-refresh-on-switch"
                className="flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {t("settings.general.refresh_on_switch")}
                  </p>
                  <p className="text-sm text-muted mt-0.5">
                    {t("settings.general.refresh_on_switch_desc")}
                  </p>
                </div>
                <GlassSwitch
                  isSelected={refreshOnSwitch}
                  onValueChange={handleRefreshOnSwitchChange}
                >
                  <GlassSwitch.Control>
                    <GlassSwitch.Thumb />
                  </GlassSwitch.Control>
                </GlassSwitch>
              </div>

              <SettingsDivider />

              <div
                id="settings-lazy-load"
                className="flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {t("settings.general.lazy_load")}
                  </p>
                  <p className="text-sm text-muted mt-0.5">
                    {t("settings.general.lazy_load_desc")}
                  </p>
                </div>
                <GlassSwitch
                  isSelected={lazyLoadEnabled}
                  onValueChange={handleLazyLoadChange}
                >
                  <GlassSwitch.Control>
                    <GlassSwitch.Thumb />
                  </GlassSwitch.Control>
                </GlassSwitch>
              </div>

              <SettingsDivider />

              <div
                id="settings-wiki-detail-preload"
                className="flex items-center justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">
                    {t("settings.general.wiki_detail_preload")}
                  </p>
                  <p className="text-sm text-muted mt-0.5">
                    {t("settings.general.wiki_detail_preload_desc")}
                  </p>
                </div>
                <GlassSwitch
                  isSelected={wikiDetailPreload}
                  onValueChange={handleWikiDetailPreloadChange}
                >
                  <GlassSwitch.Control>
                    <GlassSwitch.Thumb />
                  </GlassSwitch.Control>
                </GlassSwitch>
              </div>

              {/* Close Action + Tray User：窗口关闭语义 / 系统托盘仅桌面存在，
                  移动端（Android/iOS）没有系统托盘与窗口关闭按钮，整体隐藏 */}
              {supportsTray && (
                <>
              <SettingsDivider />

              {/* Close Action */}
              <div id="settings-close-action">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {t("settings.general.close_action")}
                    </p>
                    <p className="text-sm text-muted mt-0.5">
                      {t("settings.general.close_action_desc")}
                    </p>
                    {!trayAvailable && (
                      <p className="text-xs text-muted mt-1">
                        {t("settings.general.close_action_tray_unavailable")}
                      </p>
                    )}
                  </div>
                  {/* 窄屏：三个选项并排会溢出（中文标签各 4~5 字 + padding），
                      改成横向滚动，宽度不足时能滑。 */}
                  <div className="flex gap-2 max-w-full overflow-x-auto scroll-touch [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {[
                      {
                        value: "close",
                        label: t("settings.general.close_action_close"),
                      },
                      ...(trayAvailable
                        ? [
                            {
                              value: "minimize_to_tray",
                              label: t(
                                "settings.general.close_action_minimize",
                              ),
                            },
                          ]
                        : []),
                      {
                        value: "ask",
                        label: t("settings.general.close_action_ask"),
                      },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        className={`px-3 py-2 rounded-lg text-sm border transition-all shrink-0 ${
                          closeAction === opt.value
                            ? "border-primary/50 bg-primary/10 text-primary-text font-medium"
                            : "border-separator/40 text-muted lg-hoverable"
                        }`}
                        onClick={() => handleCloseActionChange(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <SettingsDivider />

              {/* Tray User */}
              <div id="settings-tray-user">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {t("settings.general.tray_user")}
                    </p>
                    <p className="text-sm text-muted mt-0.5">
                      {t("settings.general.tray_user_desc")}
                    </p>
                  </div>
                  <GlassSelect
                    value={trayUserRoleId || null}
                    placeholder={i18n.language === "zh" ? "未选择" : "None"}
                    options={accounts.map((a) => ({
                      value: a.id,
                      // 徽标紧跟昵称之后（不再拼进文案，也不推到行尾）
                      label: (
                        <AccountNameLine game={a.game}>{a.nickname}</AccountNameLine>
                      ),
                    }))}
                    onChange={handleTrayUserChange}
                  />
                </div>
              </div>
                </>
              )}
            </div>
          )}
        </GlassCard>

        {/* Network Settings */}
        <GlassCard
          id="settings-network"
          className="shrink-0 p-4 sm:p-6 lg-material border border-separator/90"
        >
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
              <svg
                className="w-4 h-4 text-primary-text"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M3 12h18" />
                <path d="M12 3a15 15 0 014 9 15 15 0 01-4 9 15 15 0 01-4-9 15 15 0 014-9z" />
              </svg>
            </div>
            <div className="min-w-0">
              <p className="font-semibold">{t("settings.network.title")}</p>
              <p className="text-sm font-normal text-muted mt-0.5">
                {t("settings.network.desc")}
              </p>
            </div>
          </h2>
          <NetworkSettings />
        </GlassCard>

        {/* Game Launch Settings */}
        {supportsLauncher && (
          <GlassCard
            id="settings-game-launch"
            className="shrink-0 p-4 sm:p-6 lg-material border border-separator/90"
          >
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
                <svg
                  className="w-4 h-4 text-primary-text"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              {t("settings.game_launch.title")}
            </h2>
            <div className="space-y-6">
              <GameLaunchSettings />
            </div>
          </GlassCard>
        )}

        {/* Appearance Settings */}
        <GlassCard
          id="settings-appearance"
          className="shrink-0 p-4 sm:p-6 lg-material border border-separator/90"
        >
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
              <svg
                className="w-4 h-4 text-primary-text"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
              >
                <path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z" />
              </svg>
            </div>
            {t("settings.appearance.title")}
          </h2>
          <AppearanceSettings />
        </GlassCard>

        {/* System Resource Card Defaults */}
        <GlassCard
          id="settings-system-resource"
          className="shrink-0 p-4 sm:p-6 lg-material border border-separator/90"
        >
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
              <svg
                className="w-4 h-4 text-primary-text"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
              >
                <path d="M3 3v18h18" />
                <path d="M7 14l3-3 3 3 4-5" />
              </svg>
            </div>
            {t("settings.system_resource.title")}
          </h2>
          <SystemResourceSettings />
        </GlassCard>

        {/* To-Do Card Defaults */}
        <GlassCard
          id="settings-todo"
          className="shrink-0 p-4 sm:p-6 lg-material border border-separator/90"
        >
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
              <svg
                className="w-4 h-4 text-primary-text"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
              >
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
            </div>
            {t("settings.todo.title")}
          </h2>
          <TodoSettings />
        </GlassCard>

        {/* Developer Mode */}
        <GlassCard
          id="settings-developer"
          className="shrink-0 p-4 sm:p-6 lg-material border border-separator/90"
        >
          {isConfigLoading ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <GlassSkeleton className="w-32 h-4 rounded-lg" />
                  <GlassSkeleton className="w-48 h-3 rounded-lg" />
                </div>
                <GlassSkeleton className="w-12 h-6 rounded-full shrink-0" />
              </div>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold mb-6 flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
                  <svg
                    className="w-4 h-4 text-primary-text"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth="1.5"
                  >
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                </div>
                {t("settings.developer.title")}
              </h2>
              <div className="space-y-6">
                <div
                  id="settings-developer-enable"
                  className="flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {t("settings.developer.enable")}
                    </p>
                    <p className="text-sm text-muted mt-0.5">
                      {t("settings.developer.enable_desc")}
                    </p>
                  </div>
                  <GlassSwitch
                    isSelected={developerMode}
                    onValueChange={handleDevModeToggle}
                  >
                    <GlassSwitch.Control>
                      <GlassSwitch.Thumb />
                    </GlassSwitch.Control>
                  </GlassSwitch>
                </div>
              </div>
            </>
          )}
        </GlassCard>

        {/* Updates & About */}
        <GlassCard
          id="settings-about"
          className="shrink-0 p-4 sm:p-6 lg-material border border-separator/90"
        >
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center ring-1 ring-primary/20">
              <svg
                className="w-4 h-4 text-primary-text"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
            </div>
            {t("settings.update.about_section")}
          </h2>
          <div className="space-y-5">
            {/* App Header */}
            <div className="flex items-center gap-4">
              <img
                src="/app-icon.png"
                alt="EndProtocol"
                className="w-16 h-16 rounded-2xl ring-1 ring-separator/50"
              />
              <div className="flex-1 min-w-0">
                <h3 className="text-xl font-bold text-foreground">
                  EndProtocol
                </h3>
                <p className="text-sm text-muted mt-0.5">
                  {i18n.language === "zh"
                    ? "跨平台森空岛桌面客户端"
                    : "Cross-platform Skland desktop client"}
                </p>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {remoteVersion.hasUpdate ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-danger/15 text-danger-text border border-danger/20">
                      {i18n.language === "zh" ? "有新版本" : "Update Available"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-success/15 text-success-text border border-success/20">
                      {i18n.language === "zh" ? "已是最新" : "Up to Date"}
                    </span>
                  )}
                  <span className="text-[11px] text-muted">
                    v{appVersion || "..."}
                  </span>
                </div>
              </div>
            </div>

            {/* Android APK updates also honour the mirror/GitHub source choice. */}
            {supportsUpdateChecks && (
              <>
            <SettingsDivider />

            {/* Update Channel */}
            <div id="settings-update-channel">
              <p className="text-sm font-medium text-foreground mb-2">
                {t("settings.update_channel.title")}
              </p>
              <p className="text-xs text-muted mb-3">
                {t("settings.update_channel.desc")}
              </p>
              <div className="flex gap-2">
                <button
                  className={`lg-material flex-1 p-3 rounded-xl border transition-all text-left ${
                    updateChannel === "stable"
                      ? "border-primary/50 bg-primary/5"
                      : "border-separator/40 lg-hoverable"
                  }`}
                  onClick={() => handleChannelChange("stable")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                        updateChannel === "stable"
                          ? "border-primary"
                          : "border-muted/40"
                      }`}
                    >
                      {updateChannel === "stable" && (
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {t("settings.update_channel.stable")}
                      </p>
                      <p className="text-[10px] text-muted mt-0.5">
                        {t("settings.update_channel.stable_desc")}
                      </p>
                    </div>
                  </div>
                </button>
                <button
                  className={`lg-material flex-1 p-3 rounded-xl border transition-all text-left ${
                    updateChannel === "preview"
                      ? "border-primary/50 bg-primary/5"
                      : "border-separator/40 lg-hoverable"
                  }`}
                  onClick={() => handleChannelChange("preview")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                        updateChannel === "preview"
                          ? "border-primary"
                          : "border-muted/40"
                      }`}
                    >
                      {updateChannel === "preview" && (
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {t("settings.update_channel.preview")}
                      </p>
                      <p className="text-[10px] text-muted mt-0.5">
                        {t("settings.update_channel.preview_desc")}
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {supportsUpdateChecks && <SettingsDivider />}

            {/* Update Source（桌面与 Android 都可用：两端都能从镜像源取更新） */}
            {supportsUpdateChecks && (
            <div id="settings-update-source">
              <p className="text-sm font-medium text-foreground mb-2">
                {t("settings.update_source.title")}
              </p>
              <p className="text-xs text-muted mb-3">
                {t("settings.update_source.desc")}
              </p>
              <div className="flex gap-2">
                <button
                  className={`lg-material flex-1 p-3 rounded-xl border transition-all text-left ${
                    updateSource === "github"
                      ? "border-primary/50 bg-primary/5"
                      : "border-separator/40 lg-hoverable"
                  }`}
                  onClick={() => handleSourceChange("github")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                        updateSource === "github"
                          ? "border-primary"
                          : "border-muted/40"
                      }`}
                    >
                      {updateSource === "github" && (
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {t("settings.update_source.github")}
                      </p>
                      <p className="text-[10px] text-muted mt-0.5">
                        {t("settings.update_source.github_desc")}
                      </p>
                    </div>
                  </div>
                </button>
                <button
                  className={`lg-material flex-1 p-3 rounded-xl border transition-all text-left ${
                    updateSource === "mirror"
                      ? "border-primary/50 bg-primary/5"
                      : "border-separator/40 lg-hoverable"
                  }`}
                  onClick={() => handleSourceChange("mirror")}
                >
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full border-2 flex items-center justify-center ${
                        updateSource === "mirror"
                          ? "border-primary"
                          : "border-muted/40"
                      }`}
                    >
                      {updateSource === "mirror" && (
                        <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-foreground">
                        {t("settings.update_source.mirror")}
                      </p>
                      <p className="text-[10px] text-muted mt-0.5">
                        {t("settings.update_source.mirror_desc")}
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
            )}
              </>
            )}

            <SettingsDivider />

            {/* Version Info */}
            <div id="settings-update-versions" className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl lg-material border border-separator/40">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-1">
                  {t("settings.update.app_version")}
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {appVersion || "..."}
                </p>
              </div>
              <div className="p-3 rounded-xl lg-material border border-separator/40">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-1">
                  {t("settings.update.tauri_version")}
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {tauriVersion || "..."}
                </p>
              </div>
              <div className="p-3 rounded-xl lg-material border border-separator/40">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-1">
                  {t("settings.update.platform")}
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {platformInfo}
                </p>
              </div>
              <div className="p-3 rounded-xl lg-material border border-separator/40">
                <p className="text-[11px] text-muted uppercase tracking-wider mb-1">
                  {t("settings.update.latest_version")}
                </p>
                <p className="text-sm font-semibold text-foreground">
                  {remoteVersion.loading
                    ? "..."
                    : remoteVersion.error
                      ? i18n.language === "zh"
                        ? "获取失败"
                        : "Failed"
                      : remoteVersion.version
                        ? `v${remoteVersion.version}`
                        : appVersion
                          ? `v${appVersion}`
                          : "..."}
                </p>
              </div>
            </div>

            {remoteVersion.date && (
              <div className="text-[11px] text-muted">
                {t("settings.update.release_date")}:{" "}
                {new Date(remoteVersion.date).toLocaleDateString()}
              </div>
            )}

            {/* Update Button */}
            {supportsUpdateChecks && remoteVersion.hasUpdate && (
              <GlassButton
                variant="primary"
                fullWidth
                onPress={() => setShowUpdateDialog(true)}
                startContent={
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    strokeWidth="2"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                }
              >
                {i18n.language === "zh"
                  ? `更新到 v${remoteVersion.version}`
                  : `Update to v${remoteVersion.version}`}
              </GlassButton>
            )}

            {/* Refresh Check Button（仅桌面） */}
            {supportsUpdater && (
            <GlassButton
              variant="outline"
              fullWidth
              onPress={handleCheckUpdate}
              disabled={isCheckingUpdate}
              startContent={
                <svg
                  className={`w-4 h-4 ${isCheckingUpdate ? "animate-spin" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="2"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
              }
            >
              {isCheckingUpdate
                ? i18n.language === "zh"
                  ? "检查中..."
                  : "Checking..."
                : i18n.language === "zh"
                  ? "检查更新"
                  : "Check for Updates"}
            </GlassButton>
            )}

            <SettingsDivider />

            {/* Identifier */}
            <div className="text-[11px] text-muted/60 font-mono break-all">
              {appId}
            </div>

            <SettingsDivider />

            {/* License */}
            <div id="settings-license">
              <h4 className="text-sm font-semibold text-foreground mb-2">
                {t("settings.update.license")}
              </h4>
              <p className="text-xs text-muted">
                GNU Affero General Public License v3.0 (AGPL-3.0)
              </p>
              <p className="text-[11px] text-muted/60 mt-1">
                {t("settings.update.license_desc")}
              </p>
            </div>

            <SettingsDivider />

            {/* Open Source Credits */}
            <div id="settings-credits">
              <h4 className="text-sm font-semibold text-foreground mb-3">
                {t("settings.update.open_source_credits")}
              </h4>
              <div className="space-y-1.5">
                {[
                  {
                    name: "Tauri",
                    url: "https://tauri.app",
                    desc: "Desktop framework",
                  },
                  {
                    name: "React",
                    url: "https://react.dev",
                    desc: "UI library",
                  },
                  {
                    name: "React Router",
                    url: "https://reactrouter.com",
                    desc: "Client-side routing",
                  },
                  {
                    name: "Vite",
                    url: "https://vitejs.dev",
                    desc: "Build tool",
                  },
                  {
                    name: "TypeScript",
                    url: "https://www.typescriptlang.org",
                    desc: "Type-safe JavaScript",
                  },
                  {
                    name: "Tailwind CSS",
                    url: "https://tailwindcss.com",
                    desc: "CSS framework",
                  },
                  {
                    name: "shadcn/ui",
                    url: "https://ui.shadcn.com",
                    desc: "Component primitives",
                  },
                  {
                    name: "ECharts",
                    url: "https://echarts.apache.org",
                    desc: "Charting library",
                  },
                  {
                    name: "Lucide",
                    url: "https://lucide.dev",
                    desc: "Icon library",
                  },
                  {
                    name: "morphicons",
                    url: "https://github.com/nicedoc/morphicons",
                    desc: "Morphing icons",
                  },
                  {
                    name: "i18next",
                    url: "https://www.i18next.com",
                    desc: "Internationalization",
                  },
                  {
                    name: "react-i18next",
                    url: "https://github.com/i18next/react-i18next",
                    desc: "React i18n bindings",
                  },
                  {
                    name: "clsx",
                    url: "https://github.com/lukeed/clsx",
                    desc: "Class name utility",
                  },
                  {
                    name: "Tailwind Variants",
                    url: "https://tailwind-variants.com",
                    desc: "Variant management",
                  },
                  {
                    name: "dnd-kit",
                    url: "https://dndkit.com",
                    desc: "Drag and drop",
                  },
                  {
                    name: "qrcode",
                    url: "https://github.com/soldair/qrcode",
                    desc: "QR code generation",
                  },
                  {
                    name: "react-beautiful-color",
                    url: "https://github.com/nicedoc/react-beautiful-color",
                    desc: "Color picker",
                  },
                  {
                    name: "uuid",
                    url: "https://github.com/uuidjs/uuid",
                    desc: "UUID generation",
                  },
                  {
                    name: "Tauri Plugin Updater",
                    url: "https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater",
                    desc: "In-app updater",
                  },
                  {
                    name: "Tauri Plugin Opener",
                    url: "https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/opener",
                    desc: "URL/file opener",
                  },
                ].map((lib) => (
                  // 窄屏（Android 手机）下这里是全页最容易崩的一行：
                  // 链接是 `shrink-0` + 长 URL 不换行，实测宽达 326.8px，比整行
                  // (321.9px) 还宽 —— flex 于是把左侧名称容器压成 **0 宽**，
                  // 名称与链接叠在同一处（截图里「Tauri Plugin」被 URL 盖住）。
                  // 修法：链接改成可收缩 + 省略号，名称保持 nowrap 单行，
                  // 中间留 12px 间隙。名称优先，URL 让位（完整地址点开就是）。
                  <div
                    key={lib.name}
                    className="flex items-center gap-3 py-1"
                  >
                    <div className="flex items-center gap-2 min-w-0 shrink-0">
                      <span className="text-xs font-medium text-foreground whitespace-nowrap">
                        {lib.name}
                      </span>
                      <span className="text-[10px] text-muted/50 hidden sm:inline">
                        {lib.desc}
                      </span>
                    </div>
                    <a
                      href={lib.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={lib.url}
                      className="flex-1 min-w-0 text-right text-[11px] text-primary-text hover:text-primary-text hover:underline truncate"
                    >
                      {lib.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  </div>
                ))}
              </div>
            </div>

            <SettingsDivider />

            {/* Special Thanks */}
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">
                {t("settings.update.special_thanks")}
              </h4>
              <div className="space-y-2.5">
                {[
                  {
                    name: "Xel-Launcher",
                    url: "https://github.com/lTinchl/Xel-Launcher",
                    desc: t("settings.update.xel_launcher_desc"),
                  },
                  {
                    name: "Better-Endfield",
                    url: "https://github.com/Dr-hydra/Better-Endfield",
                    desc: t("settings.update.better_endfield_desc"),
                  },
                ].map((proj) => (
                  <div key={proj.name} className="py-1">
                    {/* 同上：URL 必须可收缩 + 省略，否则窄屏会把名称压成 0 宽 */}
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-foreground whitespace-nowrap shrink-0">
                        {proj.name}
                      </span>
                      <a
                        href={proj.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={proj.url}
                        className="flex-1 min-w-0 text-right text-[11px] text-primary-text hover:text-primary-text hover:underline truncate"
                      >
                        {proj.url
                          .replace(/^https?:\/\//, "")
                          .replace(/\/$/, "")}
                      </a>
                    </div>
                    <p className="text-[11px] text-muted/60 mt-0.5">
                      {proj.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <SettingsDivider />

            {/* Links */}
            <div className="flex items-center gap-3">
              <a
                href="https://github.com/mon3tr-dev/endprotocol"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                GitHub
              </a>
              <a
                href="https://github.com/mon3tr-dev/endprotocol/blob/master/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-colors"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                License
              </a>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Developer Mode Warning Dialog */}
      <GlassAlertDialog
        isOpen={showDevWarning}
        onOpenChange={setShowDevWarning}
      >
        <GlassAlertDialog.Backdrop>
          <GlassAlertDialog.Container>
            <GlassAlertDialog.Dialog className="sm:max-w-[400px]">
              <GlassAlertDialog.CloseTrigger />
              <GlassAlertDialog.Header>
                <GlassAlertDialog.Icon status="warning" />
                <GlassAlertDialog.Heading>
                  {t("settings.developer.warning_title")}
                </GlassAlertDialog.Heading>
              </GlassAlertDialog.Header>
              <GlassAlertDialog.Body>
                <p>{t("settings.developer.warning_body")}</p>
              </GlassAlertDialog.Body>
              <GlassAlertDialog.Footer>
                <GlassButton
                  variant="tertiary"
                  onPress={() => setShowDevWarning(false)}
                >
                  {t("settings.developer.warning_cancel")}
                </GlassButton>
                <GlassButton variant="primary" onPress={confirmDevMode}>
                  {t("settings.developer.warning_confirm")}
                </GlassButton>
              </GlassAlertDialog.Footer>
            </GlassAlertDialog.Dialog>
          </GlassAlertDialog.Container>
        </GlassAlertDialog.Backdrop>
      </GlassAlertDialog>

      {/* Preview Channel Warning Dialog */}
      <GlassAlertDialog
        isOpen={showPreviewWarning}
        onOpenChange={setShowPreviewWarning}
      >
        <GlassAlertDialog.Backdrop>
          <GlassAlertDialog.Container>
            <GlassAlertDialog.Dialog className="sm:max-w-[420px]">
              <GlassAlertDialog.CloseTrigger />
              <GlassAlertDialog.Header>
                <GlassAlertDialog.Icon status="warning" />
                <GlassAlertDialog.Heading>
                  {i18n.language === "zh"
                    ? "切换到测试版通道？"
                    : "Switch to Preview Channel?"}
                </GlassAlertDialog.Heading>
              </GlassAlertDialog.Header>
              <GlassAlertDialog.Body>
                <div className="space-y-2">
                  <p>
                    {i18n.language === "zh"
                      ? "测试版包含尚在开发中的新功能和实验性改动，可能存在以下风险："
                      : "Preview builds contain new features and experimental changes still under development. Risks include:"}
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-[13px]">
                    {i18n.language === "zh" ? (
                      <>
                        <li>功能不稳定，可能导致应用崩溃或数据异常</li>
                        <li>尚未经过完整测试，可能存在未知缺陷</li>
                        <li>界面和交互可能在后续版本中发生变更</li>
                      </>
                    ) : (
                      <>
                        <li>
                          Unstable features that may cause crashes or data
                          issues
                        </li>
                        <li>Incomplete testing with potential unknown bugs</li>
                        <li>UI and behavior may change in future versions</li>
                      </>
                    )}
                  </ul>
                  <p className="text-muted text-[13px]">
                    {i18n.language === "zh"
                      ? "建议仅在需要提前体验新功能时使用测试版。"
                      : "We recommend using preview only if you want early access to new features."}
                  </p>
                </div>
              </GlassAlertDialog.Body>
              <GlassAlertDialog.Footer>
                <GlassButton
                  variant="tertiary"
                  onPress={() => {
                    setShowPreviewWarning(false);
                    setPendingChannel(null);
                  }}
                >
                  {i18n.language === "zh" ? "取消" : "Cancel"}
                </GlassButton>
                <GlassButton variant="primary" onPress={confirmPreviewChannel}>
                  {i18n.language === "zh" ? "确认切换" : "Confirm Switch"}
                </GlassButton>
              </GlassAlertDialog.Footer>
            </GlassAlertDialog.Dialog>
          </GlassAlertDialog.Container>
        </GlassAlertDialog.Backdrop>
      </GlassAlertDialog>

      {/* GitHub Source Warning Dialog */}
      <GlassAlertDialog
        isOpen={showGithubWarning}
        onOpenChange={setShowGithubWarning}
      >
        <GlassAlertDialog.Backdrop>
          <GlassAlertDialog.Container>
            <GlassAlertDialog.Dialog className="sm:max-w-[420px]">
              <GlassAlertDialog.CloseTrigger />
              <GlassAlertDialog.Header>
                <GlassAlertDialog.Icon status="warning" />
                <GlassAlertDialog.Heading>
                  {i18n.language === "zh"
                    ? "切换到 GitHub 源？"
                    : "Switch to GitHub Source?"}
                </GlassAlertDialog.Heading>
              </GlassAlertDialog.Header>
              <GlassAlertDialog.Body>
                <div className="space-y-2">
                  <p>
                    {i18n.language === "zh"
                      ? "GitHub 是应用的官方更新源，但在中国大陆地区可能存在以下问题："
                      : "GitHub is the official update source, but may present issues in certain regions:"}
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-[13px]">
                    {i18n.language === "zh" ? (
                      <>
                        <li>由于网络环境差异，下载速度可能较慢或连接超时</li>
                        <li>更新检查和安装过程可能因网络波动而失败</li>
                        <li>如遇网络问题，请切换回镜像源重试</li>
                      </>
                    ) : (
                      <>
                        <li>
                          Download speeds may be slow or connections may timeout
                        </li>
                        <li>
                          Update checks and installations may fail due to
                          network issues
                        </li>
                        <li>
                          If network problems occur, switch back to the mirror
                          source
                        </li>
                      </>
                    )}
                  </ul>
                  <p className="text-muted text-[13px]">
                    {i18n.language === "zh"
                      ? "如需更稳定的下载体验，建议使用镜像源。"
                      : "For a more stable download experience, consider using the mirror source."}
                  </p>
                </div>
              </GlassAlertDialog.Body>
              <GlassAlertDialog.Footer>
                <GlassButton
                  variant="tertiary"
                  onPress={() => {
                    setShowGithubWarning(false);
                    setPendingSource(null);
                  }}
                >
                  {i18n.language === "zh" ? "取消" : "Cancel"}
                </GlassButton>
                <GlassButton variant="primary" onPress={confirmGithubSource}>
                  {i18n.language === "zh" ? "确认切换" : "Confirm Switch"}
                </GlassButton>
              </GlassAlertDialog.Footer>
            </GlassAlertDialog.Dialog>
          </GlassAlertDialog.Container>
        </GlassAlertDialog.Backdrop>
      </GlassAlertDialog>

      {/* Update Dialog（桌面走 Tauri updater，Android 下载 APK 交给系统安装器） */}
      {supportsUpdateChecks && (
        <UpdateDialog
          isOpen={showUpdateDialog}
          onOpenChange={setShowUpdateDialog}
        />
      )}
    </div>
  );
}

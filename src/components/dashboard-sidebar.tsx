import { Link, useLocation, useNavigate } from "react-router-dom";
import clsx from "clsx";
import { useState, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { GlassKbd, GlassSkeleton } from "@/components/ui/glass";
import {
  HomeIcon,
  SettingsIcon,
  AccountIcon,
  DeveloperIcon,
  UsersIcon,
  MedalIcon,
  CalendarIcon,
  GachaIcon,
  GithubIcon,
  SearchIcon,
  PlusIcon,
  BookmarkIcon,
} from "@/components/icons";
import { siteConfig } from "@/config/site";
import { ThemeSwitch } from "@/components/theme-switch";
import { LanguageSwitch } from "@/components/language-switch";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { resolveServerLabel } from "@/types";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SwitchIcon,
} from "@/components/ui/app-icon";
import AccountSwitchModal from "./account-switch-modal";
import {
  getAccounts,
  getSelectedAccount,
  type Account,
} from "@/utils/accountService";
import { usePinImages } from "@/utils/imageCacheManager";
import { getConfig, setConfig } from "@/utils/configService";
import {
  getAllTabs,
  addTab,
  removeTab,
  updateTab,
  getActiveTabId,
  setActiveTabId,
  saveTabs,
} from "@/utils/tabService";
import { getTabIcon } from "@/utils/tabIcons";
import { CardContextMenu } from "@/components/cards/card-context-menu";
import { TabEditorModal } from "@/components/tab-editor-modal";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import type { DashboardTab } from "@/types/dashboard";
import logger from "@/utils/logger";

interface SearchResult {
  id: string;
  title: string;
  description?: string;
  path: string;
  category: string;
  elementId?: string; // DOM element ID for precise navigation
  // Multi-language content for cross-language search
  titleEn?: string;
  titleZh?: string;
  descriptionEn?: string;
  descriptionZh?: string;
  categoryEn?: string;
  categoryZh?: string;
  // Match information
  matchedLang?: "current" | "en" | "zh" | null;
  matchedText?: string;
}

interface SidebarProps {
  /** 点击导航链接后回调（用于移动端关闭抽屉） */
  onNavigate?: () => void;
  /** 折叠为仅图标的窄轨（桌面端） */
  collapsed?: boolean;
  /** 切换折叠状态 */
  onToggleCollapsed?: () => void;
}

type NavKey = "dashboard" | "characters" | "medals" | "attendance" | "gacha" | "todo";

const NAV_KEYS: NavKey[] = [
  "dashboard",
  "characters",
  "medals",
  "attendance",
  "gacha",
  "todo",
];

function GripHandle({
  onPointerDown,
  onDragEnd,
  isDragging,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onPointerUp={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragEnd?.();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className={`absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all duration-150 cursor-grab text-muted hover:text-foreground active:cursor-grabbing ${
        isDragging ? "opacity-100 cursor-grabbing" : ""
      }`}
      aria-label="Drag to reorder"
    >
      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="9" cy="6" r="1.5" />
        <circle cx="15" cy="6" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="18" r="1.5" />
        <circle cx="15" cy="18" r="1.5" />
      </svg>
    </button>
  );
}

export const Sidebar = ({
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
}: SidebarProps = {}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [themeChangeKey, setThemeChangeKey] = useState(0);
  const { t, i18n } = useTranslation();
  const searchRef = useRef<HTMLDivElement>(null);
  const searchMenuRef = useRef<HTMLDivElement>(null);
  const [searchMenuPos, setSearchMenuPos] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  // 选中账户状态
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  usePinImages(
    useMemo(
      () => (selectedAccount?.avatar ? [selectedAccount.avatar] : []),
      [selectedAccount?.avatar],
    ),
  );
  const [isLoadingAccount, setIsLoadingAccount] = useState(true);
  const [isSwitchModalOpen, setIsSwitchModalOpen] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false); // 手动刷新状态
  const [expectedAccountCount, setExpectedAccountCount] = useState<number>(3); // 预期的账户数量（保留以兼容 manualRefresh 事件）
  const [developerMode, setDeveloperMode] = useState(false);
  const [sidebarTabs, setSidebarTabs] = useState<DashboardTab[]>([]);
  const [sidebarActiveTab, setSidebarActiveTab] = useState<string | null>(null);
  const [isDashboardCollapsed, setIsDashboardCollapsed] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
    tabName: string;
  } | null>(null);
  const [isTabEditorOpen, setIsTabEditorOpen] = useState(false);
  const [editingTabForSidebar, setEditingTabForSidebar] = useState<
    DashboardTab | undefined
  >();
  const [navOrder, setNavOrder] = useState<NavKey[]>(NAV_KEYS);
  const [draggingNav, setDraggingNav] = useState<NavKey | null>(null);
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
  const navDragRef = useRef<NavKey | null>(null);
  const tabDragRef = useRef<string | null>(null);
  const navOrderRef = useRef(navOrder);
  const sidebarTabsRef = useRef(sidebarTabs);

  useEffect(() => {
    navOrderRef.current = navOrder;
  }, [navOrder]);

  useEffect(() => {
    sidebarTabsRef.current = sidebarTabs;
  }, [sidebarTabs]);

  // Load persisted sidebar nav order
  useEffect(() => {
    getConfig<string[]>("sidebar_nav_order").then((order) => {
      if (Array.isArray(order) && order.length > 0) {
        const valid = order.filter((k): k is NavKey =>
          (NAV_KEYS as string[]).includes(k),
        );
        for (const k of NAV_KEYS) {
          if (!valid.includes(k)) valid.push(k);
        }
        setNavOrder(valid);
      }
    });
  }, []);

  const swapNav = (from: NavKey, to: NavKey) => {
    setNavOrder((prev) => {
      const i = prev.indexOf(from);
      const j = prev.indexOf(to);
      if (i === -1 || j === -1 || i === j) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const swapTab = (fromId: string, toId: string) => {
    setSidebarTabs((prev) => {
      const i = prev.findIndex((t) => t.id === fromId);
      const j = prev.findIndex((t) => t.id === toId);
      if (i === -1 || j === -1 || i === j) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const endNavDrag = () => {
    if (!navDragRef.current) return;
    setConfig("sidebar_nav_order", navOrderRef.current);
    navDragRef.current = null;
    setDraggingNav(null);
  };

  const endTabDrag = () => {
    if (!tabDragRef.current) return;
    saveTabs(sidebarTabsRef.current);
    tabDragRef.current = null;
    setDraggingTab(null);
  };

  const startNavDrag = (key: NavKey, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navDragRef.current = key;
    setDraggingNav(key);
    const handleUp = () => {
      endNavDrag();
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointerup", handleUp);
  };

  const startTabDrag = (id: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    tabDragRef.current = id;
    setDraggingTab(id);
    const handleUp = () => {
      endTabDrag();
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointerup", handleUp);
  };

  // Load tabs for sidebar
  useEffect(() => {
    const loadTabs = async () => {
      const tabs = await getAllTabs();
      setSidebarTabs(tabs);
      const active = await getActiveTabId();
      setSidebarActiveTab(active);
    };
    loadTabs();
    const handleTabChange = () => loadTabs();
    window.addEventListener("tabsChanged", handleTabChange);
    window.addEventListener("accountChanged", handleTabChange);
    return () => {
      window.removeEventListener("tabsChanged", handleTabChange);
      window.removeEventListener("accountChanged", handleTabChange);
    };
  }, []);

  // 监听主题变化，强制重新渲染
  useEffect(() => {
    const handleThemeChange = () => {
      setThemeChangeKey((prev) => prev + 1);
    };

    window.addEventListener("themeChange", handleThemeChange);
    return () => {
      window.removeEventListener("themeChange", handleThemeChange);
    };
  }, []);

  // 加载开发者模式配置
  useEffect(() => {
    const loadDevMode = async () => {
      const value = await getConfig<boolean>("developer_mode");
      setDeveloperMode(value ?? false);
    };
    loadDevMode();
  }, []);

  // 加载侧边栏折叠状态
  useEffect(() => {
    const loadCollapsed = async () => {
      const value = await getConfig<boolean>("sidebar_collapsed");
      setIsDashboardCollapsed(value ?? false);
    };
    loadCollapsed();
  }, []);

  // 监听开发者模式变化
  useEffect(() => {
    const handleDevModeChange = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setDeveloperMode(detail.enabled);
    };
    window.addEventListener("developerModeChange", handleDevModeChange);
    return () =>
      window.removeEventListener("developerModeChange", handleDevModeChange);
  }, []);

  // 加载选中的账户
  useEffect(() => {
    const loadSelectedAccount = async () => {
      try {
        setIsLoadingAccount(true);
        // 并行获取选中账户ID和账户列表
        const [selectedId, accounts] = await Promise.all([
          getSelectedAccount(),
          getAccounts(),
        ]);
        logger.info("Selected account ID: " + selectedId, "Sidebar");
        logger.info("Loaded accounts: " + accounts.length, "Sidebar");

        if (selectedId && accounts.length > 0) {
          const account = accounts.find((acc) => acc.id === selectedId);
          logger.info("Found account: " + account?.nickname, "Sidebar");
          setSelectedAccount(account || null);
        } else {
          logger.info("No selected account ID or no accounts", "Sidebar");
          setSelectedAccount(null);
        }
      } catch (error) {
        logger.error("Failed to load selected account: " + error, "Sidebar");
      } finally {
        setIsLoadingAccount(false);
      }
    };

    loadSelectedAccount();

    // 监听账户变化事件(从Account页面切换时触发)
    const handleAccountChange = async () => {
      logger.info("Account changed event received", "Sidebar");

      // 并行获取配置、账户列表和选中账户ID
      const [shouldRefresh, accounts, selectedId] = await Promise.all([
        getConfig<boolean>("refresh_on_account_switch"),
        getAccounts(),
        getSelectedAccount(),
      ]);
      logger.info("Should refresh on switch: " + shouldRefresh, "Sidebar");
      logger.info("New selected account ID: " + selectedId, "Sidebar");

      if (selectedId && accounts && accounts.length > 0) {
        const account = accounts.find((acc) => acc.id === selectedId);
        logger.info("Found account: " + account?.nickname, "Sidebar");
        // 强制更新状态,确保UI同步
        setSelectedAccount(account || null);
      } else {
        logger.info("No account found or no selected ID", "Sidebar");
        setSelectedAccount(null);
      }
    };

    window.addEventListener("accountChanged", handleAccountChange);

    // 监听手动刷新事件
    const handleManualRefresh = (event: Event) => {
      logger.info("Manual refresh event received", "Sidebar");

      // 从事件中获取账户数量
      const customEvent = event as CustomEvent;
      const count = customEvent.detail?.count || 3;
      void expectedAccountCount; // 占位以避免 lint 警告
      setExpectedAccountCount(Math.min(count, 5)); // 最多5个

      setIsManualRefreshing(true);

      // 刷新完成后隐藏骨架屏（延迟一下确保数据已更新）
      setTimeout(() => {
        setIsManualRefreshing(false);
        setExpectedAccountCount(3); // 重置为默认值
      }, 300);
      logger.debug(`Expected accounts: ${expectedAccountCount}`);
    };

    window.addEventListener("manualRefresh", handleManualRefresh);

    return () => {
      window.removeEventListener("accountChanged", handleAccountChange);
      window.removeEventListener("manualRefresh", handleManualRefresh);
    };
  }, []);

  // Generate searchable content from all pages and navigation (with multi-language support)
  const getAllSearchableContent = useMemo(() => {
    return (): SearchResult[] => {
      return [
        // Navigation items
        {
          id: "nav-dashboard",
          title: t("sidebar.dashboard"),
          titleEn: "Dashboard",
          titleZh: "仪表板",
          description:
            i18n.language === "zh"
              ? "查看仪表板和统计数据"
              : "View dashboard and statistics",
          descriptionEn: "View dashboard and statistics",
          descriptionZh: "查看仪表板和统计数据",
          path: "/",
          elementId: "dashboard-header",
          category: i18n.language === "zh" ? "导航" : "Navigation",
          categoryEn: "Navigation",
          categoryZh: "导航",
        },
        {
          id: "nav-settings",
          title: t("sidebar.settings"),
          titleEn: "Settings",
          titleZh: "设置",
          description:
            i18n.language === "zh"
              ? "管理应用设置和偏好"
              : "Manage app settings and preferences",
          descriptionEn: "Manage app settings and preferences",
          descriptionZh: "管理应用设置和偏好",
          path: "/settings",
          category: i18n.language === "zh" ? "导航" : "Navigation",
          categoryEn: "Navigation",
          categoryZh: "导航",
        },
        {
          id: "nav-account",
          title: t("sidebar.account"),
          titleEn: "Account",
          titleZh: "账户",
          description:
            i18n.language === "zh"
              ? "管理您的登录账户"
              : "Manage your logged-in accounts",
          descriptionEn: "Manage your logged-in accounts",
          descriptionZh: "管理您的登录账户",
          path: "/account",
          category: i18n.language === "zh" ? "导航" : "Navigation",
          categoryEn: "Navigation",
          categoryZh: "导航",
        },

        // Dashboard page content
        {
          id: "dashboard-welcome",
          title: i18n.language === "zh" ? "欢迎信息" : "Welcome Message",
          titleEn: "Welcome Message",
          titleZh: "欢迎信息",
          description: t("common.welcome"),
          descriptionEn: "Welcome back! Here's what's happening.",
          descriptionZh: "欢迎回来！以下是最新动态。",
          path: "/",
          elementId: "dashboard-header",
          category: i18n.language === "zh" ? "仪表板" : "Dashboard",
          categoryEn: "Dashboard",
          categoryZh: "仪表板",
        },
        {
          id: "dashboard-stats-revenue",
          title: t("common.totalRevenue"),
          titleEn: "Total Revenue",
          titleZh: "总收入",
          description:
            i18n.language === "zh"
              ? "查看总收入统计"
              : "View total revenue statistics",
          descriptionEn: "View total revenue statistics",
          descriptionZh: "查看总收入统计",
          path: "/",
          elementId: "dashboard-stats",
          category: i18n.language === "zh" ? "统计" : "Statistics",
          categoryEn: "Statistics",
          categoryZh: "统计",
        },
        {
          id: "dashboard-stats-users",
          title: t("common.activeUsers"),
          titleEn: "Active Users",
          titleZh: "活跃用户",
          description:
            i18n.language === "zh"
              ? "查看活跃用户数据"
              : "View active user data",
          descriptionEn: "View active user data",
          descriptionZh: "查看活跃用户数据",
          path: "/",
          elementId: "dashboard-stats",
          category: i18n.language === "zh" ? "统计" : "Statistics",
          categoryEn: "Statistics",
          categoryZh: "统计",
        },
        {
          id: "dashboard-stats-sales",
          title: t("common.sales"),
          titleEn: "Sales",
          titleZh: "销售额",
          description:
            i18n.language === "zh" ? "查看销售数据" : "View sales data",
          descriptionEn: "View sales data",
          descriptionZh: "查看销售数据",
          path: "/",
          elementId: "dashboard-stats",
          category: i18n.language === "zh" ? "统计" : "Statistics",
          categoryEn: "Statistics",
          categoryZh: "统计",
        },
        {
          id: "dashboard-activity",
          title: t("common.recentActivity"),
          titleEn: "Recent Activity",
          titleZh: "最近活动",
          description:
            i18n.language === "zh"
              ? "查看最近的活动记录"
              : "View recent activity logs",
          descriptionEn: "View recent activity logs",
          descriptionZh: "查看最近的活动记录",
          path: "/",
          elementId: "dashboard-activity",
          category: i18n.language === "zh" ? "仪表板" : "Dashboard",
          categoryEn: "Dashboard",
          categoryZh: "仪表板",
        },
        {
          id: "dashboard-projects",
          title: t("common.recentProjects"),
          titleEn: "Recent Projects",
          titleZh: "最近项目",
          description:
            i18n.language === "zh"
              ? "查看最近的项目列表"
              : "View recent projects list",
          descriptionEn: "View recent projects list",
          descriptionZh: "查看最近的项目列表",
          path: "/",
          elementId: "dashboard-projects",
          category: i18n.language === "zh" ? "仪表板" : "Dashboard",
          categoryEn: "Dashboard",
          categoryZh: "仪表板",
        },
        {
          id: "dashboard-quick-actions",
          title: t("common.quickActions"),
          titleEn: "Quick Actions",
          titleZh: "快捷操作",
          description:
            i18n.language === "zh"
              ? "快速操作和快捷方式"
              : "Quick actions and shortcuts",
          descriptionEn: "Quick actions and shortcuts",
          descriptionZh: "快速操作和快捷方式",
          path: "/",
          elementId: "dashboard-quick-actions",
          category: i18n.language === "zh" ? "仪表板" : "Dashboard",
          categoryEn: "Dashboard",
          categoryZh: "仪表板",
        },
        {
          id: "dashboard-create-project",
          title: t("common.createProject"),
          titleEn: "Create Project",
          titleZh: "创建项目",
          description:
            i18n.language === "zh" ? "创建新项目" : "Create a new project",
          descriptionEn: "Create a new project",
          descriptionZh: "创建新项目",
          path: "/",
          category: i18n.language === "zh" ? "操作" : "Actions",
          categoryEn: "Actions",
          categoryZh: "操作",
        },
        {
          id: "dashboard-start-project",
          title: t("common.startNewProject"),
          titleEn: "Start New Project",
          titleZh: "开始新项目",
          description:
            i18n.language === "zh" ? "开始一个新项目" : "Start a new project",
          descriptionEn: "Start a new project",
          descriptionZh: "开始一个新项目",
          path: "/",
          category: i18n.language === "zh" ? "操作" : "Actions",
          categoryEn: "Actions",
          categoryZh: "操作",
        },
        {
          id: "dashboard-invite",
          title: t("common.inviteSomeone"),
          titleEn: "Invite Someone",
          titleZh: "邀请某人",
          description:
            i18n.language === "zh" ? "邀请团队成员" : "Invite team members",
          descriptionEn: "Invite team members",
          descriptionZh: "邀请团队成员",
          path: "/",
          category: i18n.language === "zh" ? "操作" : "Actions",
          categoryEn: "Actions",
          categoryZh: "操作",
        },
        {
          id: "dashboard-analytics",
          title: t("common.analyticsInsights"),
          titleEn: "Analytics & Insights",
          titleZh: "分析与洞察",
          description:
            i18n.language === "zh"
              ? "查看分析和洞察"
              : "View analytics and insights",
          descriptionEn: "View analytics and insights",
          descriptionZh: "查看分析和洞察",
          path: "/",
          category: i18n.language === "zh" ? "操作" : "Actions",
          categoryEn: "Actions",
          categoryZh: "操作",
        },

        // To-Do page content
        {
          id: "todo-title",
          title: t("todo_page.title"),
          titleEn: "To-Do",
          titleZh: "待办事项",
          description:
            i18n.language === "zh" ? "管理待办列表" : "Manage to-do lists",
          descriptionEn: "Manage to-do lists",
          descriptionZh: "管理待办列表",
          path: "/todo",
          elementId: "todo-header",
          category: i18n.language === "zh" ? "导航" : "Navigation",
          categoryEn: "Navigation",
          categoryZh: "导航",
        },

        // Settings page content
        {
          id: "settings-title",
          title: t("settings.title"),
          titleEn: "Settings",
          titleZh: "设置",
          description:
            i18n.language === "zh"
              ? "管理应用设置"
              : "Manage application settings",
          descriptionEn: "Manage application settings",
          descriptionZh: "管理应用设置",
          path: "/settings",
          elementId: "settings-general",
          category: i18n.language === "zh" ? "设置" : "Settings",
          categoryEn: "Settings",
          categoryZh: "设置",
        },
        {
          id: "settings-general",
          title: t("settings.general.title"),
          titleEn: "General Settings",
          titleZh: "通用设置",
          description:
            i18n.language === "zh"
              ? "通用设置配置"
              : "General settings configuration",
          descriptionEn: "General settings configuration",
          descriptionZh: "通用设置配置",
          path: "/settings",
          elementId: "settings-general",
          category: i18n.language === "zh" ? "设置" : "Settings",
          categoryEn: "Settings",
          categoryZh: "设置",
        },
        {
          id: "settings-language",
          title: t("settings.general.language"),
          titleEn: "Language",
          titleZh: "语言",
          description:
            i18n.language === "zh"
              ? "选择界面语言"
              : "Choose interface language",
          descriptionEn: "Choose interface language",
          descriptionZh: "选择界面语言",
          path: "/settings",
          elementId: "settings-language",
          category: i18n.language === "zh" ? "设置" : "Settings",
          categoryEn: "Settings",
          categoryZh: "设置",
        },
        {
          id: "settings-theme",
          title: t("settings.general.theme"),
          titleEn: "Theme",
          titleZh: "主题",
          description:
            i18n.language === "zh" ? "切换主题模式" : "Toggle theme mode",
          descriptionEn: "Toggle theme mode",
          descriptionZh: "切换主题模式",
          path: "/settings",
          elementId: "settings-theme",
          category: i18n.language === "zh" ? "设置" : "Settings",
          categoryEn: "Settings",
          categoryZh: "设置",
        },
        {
          id: "nav-developer",
          title: t("sidebar.developer"),
          titleEn: "Developer",
          titleZh: "开发者",
          description:
            i18n.language === "zh"
              ? "调试工具和高级设置"
              : "Debugging tools and advanced settings",
          descriptionEn: "Debugging tools and advanced settings",
          descriptionZh: "调试工具和高级设置",
          path: "/developer",
          category: i18n.language === "zh" ? "导航" : "Navigation",
          categoryEn: "Navigation",
          categoryZh: "导航",
        },
      ];
    };
  }, [t, i18n.language]);

  // Filter search results with cross-language support
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const allContent = getAllSearchableContent();
    const query = searchQuery.toLowerCase();

    return allContent
      .filter((item) => {
        // Search in current language
        const currentLangMatch =
          item.title.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query);

        // Search in other languages
        const otherLangMatch =
          item.titleEn?.toLowerCase().includes(query) ||
          item.titleZh?.toLowerCase().includes(query) ||
          item.descriptionEn?.toLowerCase().includes(query) ||
          item.descriptionZh?.toLowerCase().includes(query) ||
          item.categoryEn?.toLowerCase().includes(query) ||
          item.categoryZh?.toLowerCase().includes(query);

        return currentLangMatch || otherLangMatch;
      })
      .map((item) => {
        // Determine which language matched
        let matchedLang: "current" | "en" | "zh" | null = null;
        let matchedText = "";

        if (
          item.title.toLowerCase().includes(query) ||
          item.description?.toLowerCase().includes(query) ||
          item.category.toLowerCase().includes(query)
        ) {
          matchedLang = "current";
        } else if (
          item.titleEn?.toLowerCase().includes(query) ||
          item.descriptionEn?.toLowerCase().includes(query) ||
          item.categoryEn?.toLowerCase().includes(query)
        ) {
          matchedLang = "en";
          // Find the matched text
          if (item.titleEn?.toLowerCase().includes(query))
            matchedText = item.titleEn;
          else if (item.descriptionEn?.toLowerCase().includes(query))
            matchedText = item.descriptionEn;
          else if (item.categoryEn?.toLowerCase().includes(query))
            matchedText = item.categoryEn;
        } else if (
          item.titleZh?.toLowerCase().includes(query) ||
          item.descriptionZh?.toLowerCase().includes(query) ||
          item.categoryZh?.toLowerCase().includes(query)
        ) {
          matchedLang = "zh";
          // Find the matched text
          if (item.titleZh?.toLowerCase().includes(query))
            matchedText = item.titleZh;
          else if (item.descriptionZh?.toLowerCase().includes(query))
            matchedText = item.descriptionZh;
          else if (item.categoryZh?.toLowerCase().includes(query))
            matchedText = item.categoryZh;
        }

        return {
          ...item,
          matchedLang,
          matchedText: matchedLang !== "current" ? matchedText : "",
        };
      });
  }, [searchQuery, getAllSearchableContent]);

  // Keyboard shortcut for search (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Close results when clicking outside
  useEffect(() => {
    if (!showResults) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (searchMenuRef.current?.contains(event.target as Node)) return;
      if (searchRef.current?.contains(event.target as Node)) return;
      setShowResults(false);
    };
    const onScroll = () => setShowResults(false);
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [showResults]);

  // Handle keyboard navigation in search results
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!showResults || searchResults.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, searchResults.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, -1));
      } else if (e.key === "Enter" && selectedIndex >= 0) {
        e.preventDefault();
        handleSelectResult(searchResults[selectedIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowResults(false);
        inputRef.current?.blur();
      }
    };

    if (showResults) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showResults, selectedIndex, searchResults]);

  // Scroll selected item into view
  useEffect(() => {
    if (selectedIndex >= 0 && resultsRef.current) {
      const selectedElement = resultsRef.current.children[selectedIndex];
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [selectedIndex]);

  const handleSelectResult = (result: SearchResult) => {
    // Navigate to the page
    navigate(result.path);

    // Clear search state
    setSearchQuery("");
    setShowResults(false);
    setSelectedIndex(-1);

    // Scroll to specific element if elementId is provided
    if (result.elementId) {
      // Wait for navigation to complete, then scroll to element
      setTimeout(() => {
        const element = document.getElementById(result.elementId!);
        if (element) {
          const offset = 80;
          const elementPosition =
            element.getBoundingClientRect().top + window.pageYOffset;
          const offsetPosition = elementPosition - offset;

          window.scrollTo({
            top: offsetPosition,
            behavior: "smooth",
          });

          element.classList.add("animate-pulse");
          element.style.transition = "all 0.3s ease";
          element.style.boxShadow =
            "0 0 0 3px hsl(var(--heroui-primary) / 0.3)";

          setTimeout(() => {
            element.classList.remove("animate-pulse");
            element.style.boxShadow = "";
          }, 2000);
        }
      }, 100);
    }
  };

  const highlightMatch = (text: string, query: string) => {
    if (!query.trim()) return text;

    const regex = new RegExp(
      `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
      "gi",
    );
    const parts = text.split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? (
        <mark
          key={index}
          className="bg-primary/20 text-primary font-semibold px-0.5 rounded"
        >
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };

  const bottomItems = useMemo(() => {
    const items = [
      {
        label: t("sidebar.account"),
        href: "/account",
        icon: AccountIcon,
      },
    ];

    if (developerMode) {
      items.push({
        label: t("sidebar.developer"),
        href: "/developer",
        icon: DeveloperIcon,
      });
    }

    items.push({
      label: t("sidebar.settings"),
      href: "/settings",
      icon: SettingsIcon,
    });

    return items;
  }, [t, developerMode]);

  const tabsHidden = isDashboardCollapsed || collapsed;

  return (
    <>
      <aside key={themeChangeKey} className="w-full h-full flex flex-col">
        {/* Selected Account Display */}
        <div
          className={clsx(
            "transition-all duration-300 ease-out",
            collapsed ? "px-[7px] py-2" : "px-3 py-2",
          )}
        >
          {isLoadingAccount || isManualRefreshing ? (
            <div
              className={clsx(
                "glass-surface flex items-center rounded-xl transition-all duration-300 ease-out",
                collapsed ? "p-[5px]" : "gap-3 p-2",
              )}
            >
              <GlassSkeleton
                className={clsx(
                  "rounded-full transition-all duration-300 ease-in-out",
                  collapsed ? "w-8 h-8" : "w-10 h-10",
                )}
              />
              <div
                className={clsx(
                  "space-y-2 overflow-hidden transition-all duration-300 ease-out",
                  collapsed
                    ? "max-w-0 max-h-0 opacity-0"
                    : "max-w-full max-h-10 flex-1 opacity-100",
                )}
              >
                <GlassSkeleton className="w-24 h-4 rounded-lg" />
                <GlassSkeleton className="w-16 h-3 rounded-lg" />
              </div>
            </div>
          ) : selectedAccount ? (
            <div
              onClick={
                collapsed ? () => setIsSwitchModalOpen(true) : undefined
              }
              title={collapsed ? selectedAccount.nickname : undefined}
              className={clsx(
                "glass-surface flex items-center rounded-xl transition-all duration-300 ease-out group",
                collapsed
                  ? "p-[5px] cursor-pointer hover:bg-default-100"
                  : "gap-3 p-2",
              )}
            >
              <AccountAvatar
                src={selectedAccount.avatar}
                alt={selectedAccount.nickname}
                size={collapsed ? "sm" : "md"}
                className="transition-all duration-300 ease-out"
              />
              <div
                className={clsx(
                  "min-w-0 overflow-hidden transition-all duration-300 ease-out",
                  collapsed
                    ? "max-w-0 max-h-0 opacity-0"
                    : "max-w-full max-h-[6rem] flex-1 opacity-100",
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">
                    {selectedAccount.nickname}
                  </p>
                  <p className="text-xs text-muted truncate">
                    Lv.{selectedAccount.level} •{" "}
                    {resolveServerLabel(selectedAccount.server, i18n.language)}
                  </p>
                  {selectedAccount.userId && (
                    <p className="text-[10px] text-muted/70 truncate">
                      {i18n.language === "zh" ? "森空岛" : "Skland"}:{" "}
                      {selectedAccount.userId}
                    </p>
                  )}
                </div>
              </div>

              <div
                className={clsx(
                  "flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out",
                  collapsed ? "max-w-0 opacity-0" : "max-w-[2.5rem] opacity-100",
                )}
              >
                <button
                  onClick={() => setIsSwitchModalOpen(true)}
                  className="p-1.5 rounded-lg transition-all duration-200 flex-shrink-0 text-muted hover:text-foreground hover:scale-105 active:scale-95 opacity-0 group-hover:opacity-100"
                  title={i18n.language === "zh" ? "切换账户" : "Switch Account"}
                  aria-label="Switch account"
                >
                  <SwitchIcon size={18} />
                </button>
              </div>
            </div>
          ) : (
            <div
              title={
                collapsed
                  ? i18n.language === "zh"
                    ? "未选择账户"
                    : "No account selected"
                  : undefined
              }
              className={clsx(
                "glass-surface flex items-center rounded-xl border border-dashed border-separator/60 transition-all duration-300 ease-out",
                collapsed ? "p-[5px]" : "gap-3 p-2.5",
              )}
            >
              <div
                className={clsx(
                  "rounded-lg flex items-center justify-center transition-all duration-300 ease-in-out",
                  collapsed ? "w-8 h-8" : "w-10 h-10",
                )}
              >
                <AccountIcon
                  className={clsx(
                    "text-muted transition-all duration-300 ease-in-out",
                    collapsed ? "w-4 h-4" : "w-5 h-5",
                  )}
                />
              </div>
              <div
                className={clsx(
                  "overflow-hidden transition-all duration-300 ease-out",
                  collapsed
                    ? "max-w-0 max-h-0 opacity-0"
                    : "max-w-full max-h-12 flex-1 opacity-100",
                )}
              >
                <p className="text-sm text-muted">
                  {i18n.language === "zh"
                    ? "未选择账户"
                    : "No account selected"}
                </p>
                <p className="text-xs text-muted/60">
                  {i18n.language === "zh"
                    ? "前往账户页面选择"
                    : "Go to Account page"}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Search Section - Hidden */}
        {false && (
          <div className="px-4 py-4" ref={searchRef}>
            <div className="relative">
              <div className="bg-default-100 hover:bg-default-200 transition-colors rounded-lg h-9 flex items-center px-3 gap-2">
                <SearchIcon className="text-base text-muted pointer-events-none flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="search"
                  placeholder={t("common.search")}
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    if (!showResults) {
                      setShowResults(true);
                      requestAnimationFrame(() => {
                        if (searchRef.current) {
                          const r = searchRef.current.getBoundingClientRect();
                          setSearchMenuPos({
                            top: r.bottom,
                            left: r.left,
                            width: r.width,
                          });
                        }
                      });
                    }
                    setSelectedIndex(-1);
                  }}
                  onFocus={() => {
                    if (searchQuery.trim() && !showResults) {
                      setShowResults(true);
                      if (searchRef.current) {
                        const r = searchRef.current.getBoundingClientRect();
                        setSearchMenuPos({
                          top: r.bottom,
                          left: r.left,
                          width: r.width,
                        });
                      }
                    }
                  }}
                  className="bg-transparent border-none outline-none text-sm w-full text-foreground placeholder:text-muted"
                  aria-label="Search"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setShowResults(false);
                      setSelectedIndex(-1);
                    }}
                    className="text-muted hover:text-foreground transition-colors"
                    aria-label="Clear search"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                )}
                {!searchQuery && (
                  <GlassKbd className="hidden lg:inline-flex text-xs">
                    <GlassKbd.Abbr keyValue="command" />
                    <GlassKbd.Content>K</GlassKbd.Content>
                  </GlassKbd>
                )}
              </div>

              {/* Search Results Dropdown */}
              {showResults &&
                searchQuery.trim() &&
                createPortal(
                  <div
                    ref={searchMenuRef}
                    className="fixed z-[9999] bg-background glass-surface-strong border-2 border-separator/80 rounded-lg shadow-2xl max-h-[400px] overflow-y-auto animate-scale-in"
                    style={{
                      top: searchMenuPos.top + 8,
                      left: searchMenuPos.left,
                      width: searchMenuPos.width || 320,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {searchResults.length === 0 ? (
                      <div className="py-6 text-center">
                        <SearchIcon className="w-8 h-8 text-muted mx-auto mb-2 opacity-50" />
                        <p className="text-sm text-muted">
                          {i18n.language === "zh"
                            ? "未找到结果"
                            : "No results found"}
                        </p>
                      </div>
                    ) : (
                      <div ref={resultsRef}>
                        {/* Group results by category */}
                        {Object.entries(
                          searchResults.reduce(
                            (groups, result) => {
                              const category = result.category;
                              if (!groups[category]) {
                                groups[category] = [];
                              }
                              groups[category].push(result);
                              return groups;
                            },
                            {} as Record<string, SearchResult[]>,
                          ),
                        ).map(([category, items]) => (
                          <div key={category}>
                            <div className="px-3 py-2 text-xs font-semibold text-muted uppercase tracking-wider bg-default-100 border-b border-separator">
                              {category}
                            </div>
                            {items.map((result) => {
                              const globalIndex = searchResults.findIndex(
                                (r) => r.id === result.id,
                              );
                              const isSelected = globalIndex === selectedIndex;

                              return (
                                <button
                                  key={result.id}
                                  className={`w-full px-3 py-2.5 flex items-start gap-3 transition-colors text-left border-b border-separator last:border-b-0 ${
                                    isSelected
                                      ? "bg-primary/20"
                                      : "hover:bg-default-50"
                                  }`}
                                  onClick={() => handleSelectResult(result)}
                                  onMouseEnter={() =>
                                    setSelectedIndex(globalIndex)
                                  }
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium text-foreground text-sm truncate">
                                        {highlightMatch(
                                          result.title,
                                          searchQuery,
                                        )}
                                      </span>
                                      {/* Show language badge if matched in other language */}
                                      {result.matchedLang &&
                                        result.matchedLang !== "current" && (
                                          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-warning/20 text-warning border border-warning/30 flex-shrink-0">
                                            {result.matchedLang === "en"
                                              ? "EN"
                                              : "中文"}
                                          </span>
                                        )}
                                    </div>
                                    {result.description && (
                                      <p className="text-xs text-muted mt-0.5 line-clamp-1">
                                        {highlightMatch(
                                          result.description,
                                          searchQuery,
                                        )}
                                      </p>
                                    )}
                                    {/* Show matched text from other language */}
                                    {result.matchedLang &&
                                      result.matchedLang !== "current" &&
                                      result.matchedText && (
                                        <p className="text-xs mt-1 px-2 py-1 bg-warning/10 border border-warning/20 rounded">
                                          <span className="text-warning font-medium mr-1">
                                            {i18n.language === "zh"
                                              ? "匹配:"
                                              : "Match:"}
                                          </span>
                                          <mark className="bg-warning/30 text-warning-dark px-0.5 rounded">
                                            {highlightMatch(
                                              result.matchedText,
                                              searchQuery,
                                            )}
                                          </mark>
                                        </p>
                                      )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Footer with keyboard shortcuts */}
                    <div className="border-t-2 border-separator px-3 py-2 flex items-center justify-between text-xs text-muted bg-default-50">
                      <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1">
                          <GlassKbd className="text-xs">↑</GlassKbd>
                          <GlassKbd className="text-xs">↓</GlassKbd>
                          <span>
                            {i18n.language === "zh" ? "导航" : "Navigate"}
                          </span>
                        </span>
                        <span className="flex items-center gap-1">
                          <GlassKbd className="text-xs">↵</GlassKbd>
                          <span>
                            {i18n.language === "zh" ? "选择" : "Select"}
                          </span>
                        </span>
                      </div>
                      <span>
                        {searchResults.length}{" "}
                        {i18n.language === "zh" ? "个结果" : "results"}
                      </span>
                    </div>
                  </div>,
                  document.body,
                )}
            </div>
          </div>
        )}

        {/* Main Navigation */}
        <nav
          className={clsx(
            "flex-1 overflow-y-auto select-none transition-all duration-300 ease-in-out",
            collapsed ? "px-2" : "px-3",
          )}
        >
          <div className="space-y-0.5 py-2">
            {navOrder.map((key) => {
              switch (key) {
                case "dashboard":
                  return (
                    <div
                      key="dashboard"
                      onMouseEnter={() =>
                        draggingNav &&
                        draggingNav !== "dashboard" &&
                        swapNav(draggingNav, "dashboard")
                      }
                    >
                      {/* Dashboard link with collapse toggle */}
                      <div
                        className={clsx(
                          "relative flex items-center rounded-xl transition-all duration-300 ease-in-out group",
                          collapsed
                            ? "justify-center px-0 py-2.5 gap-0"
                            : "gap-1 pl-3 pr-8 py-2.5",
                          draggingNav === "dashboard" ? "opacity-60" : "",
                          location.pathname === "/"
                            ? "glass-surface-strong text-foreground"
                            : "text-foreground hover:text-foreground",
                        )}
                      >
                        <Link
                          to="/"
                          onClick={onNavigate}
                          title={collapsed ? t("sidebar.dashboard") : undefined}
                          className={clsx(
                            "flex items-center min-w-0 transition-all duration-300 ease-in-out",
                            collapsed
                              ? "flex-none justify-center gap-0"
                              : "flex-1 gap-3",
                          )}
                        >
                          <HomeIcon
                            className={clsx(
                              "w-5 h-5 flex-shrink-0 transition-all duration-200",
                              location.pathname === ""
                                ? ""
                                : "group-hover:scale-110 group-hover:rotate-12",
                            )}
                          />
                          <span
                            className={clsx(
                              "text-sm font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out",
                              collapsed
                                ? "max-w-0 opacity-0"
                                : "max-w-[10rem] opacity-100",
                            )}
                          >
                            {t("sidebar.dashboard")}
                          </span>
                        </Link>
                        {!collapsed && (
                          <button
                            type="button"
                            onClick={() => {
                              const next = !isDashboardCollapsed;
                              setIsDashboardCollapsed(next);
                              setConfig("sidebar_collapsed", next);
                            }}
                            className={clsx(
                              "p-1 rounded-lg transition-colors",
                              "text-muted hover:text-foreground",
                            )}
                            aria-label={
                              isDashboardCollapsed
                                ? "Expand tabs"
                                : "Collapse tabs"
                            }
                          >
                            <ChevronDownIcon
                              size={16}
                              className={clsx(
                                "transition-transform duration-300",
                                isDashboardCollapsed && "-rotate-90",
                              )}
                            />
                          </button>
                        )}
                        {!collapsed && (
                          <GripHandle
                            onPointerDown={(e) => startNavDrag("dashboard", e)}
                            onDragEnd={endNavDrag}
                            isDragging={draggingNav === "dashboard"}
                          />
                        )}
                      </div>

                      {/* Tab list */}
                      <div
                        className="grid transition-all duration-300 ease-in-out"
                        style={{
                          gridTemplateRows: tabsHidden ? "0fr" : "1fr",
                          opacity: tabsHidden ? 0 : 1,
                        }}
                      >
                        <div className="overflow-hidden">
                          <div className="ml-6 pl-3 border-l-2 border-default-200/60 dark:border-default-700/40 space-y-0.5 pt-0">
                            <div className="flex items-center justify-between px-3 py-1 mt-1.5">
                              <span className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                                {i18n.language === "zh" ? "标签页" : "Tabs"}
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingTabForSidebar(undefined);
                                  setIsTabEditorOpen(true);
                                }}
                                className="p-1 rounded-lg text-muted hover:text-foreground transition-all duration-200 hover:scale-105 active:scale-95"
                                aria-label="Add tab"
                              >
                                <PlusIcon size={15} />
                              </button>
                            </div>
                            {sidebarTabs.length > 0 && (
                              <div className="space-y-0.5 pb-2">
                                {sidebarTabs.map((tab) => {
                                  const Icon = getTabIcon(tab.icon);
                                  const isTabActive =
                                    location.pathname === "/" &&
                                    sidebarActiveTab === tab.id;
                                  return (
                                    <div
                                      key={tab.id}
                                      className="relative group"
                                      onContextMenu={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setContextMenu({
                                          x: e.clientX,
                                          y: e.clientY,
                                          tabId: tab.id,
                                          tabName: tab.name,
                                        });
                                      }}
                                      onMouseEnter={() =>
                                        draggingTab &&
                                        draggingTab !== tab.id &&
                                        swapTab(draggingTab, tab.id)
                                      }
                                    >
                                      <Link
                                        to="/"
                                        onClick={async () => {
                                          await setActiveTabId(tab.id);
                                          setSidebarActiveTab(tab.id);
                                          window.dispatchEvent(
                                            new CustomEvent("accountChanged"),
                                          );
                                          onNavigate?.();
                                        }}
                                        className={clsx(
                                          "flex items-center gap-3 px-3 pr-8 py-2 rounded-lg transition-all duration-200",
                                          draggingTab === tab.id
                                            ? "opacity-60"
                                            : "",
                                          isTabActive
                                            ? "glass-surface-strong text-foreground font-medium"
                                            : "text-muted hover:text-foreground",
                                        )}
                                      >
                                        {isTabActive && (
                                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-foreground rounded-full" />
                                        )}
                                        <Icon className="w-4 h-4 flex-shrink-0" />
                                        <span className="text-sm truncate">
                                          {tab.name}
                                        </span>
                                      </Link>
                                      <GripHandle
                                        onPointerDown={(e) =>
                                          startTabDrag(tab.id, e)
                                        }
                                        onDragEnd={endTabDrag}
                                        isDragging={draggingTab === tab.id}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {sidebarTabs.length === 0 && (
                              <div className="px-3 py-4 text-center">
                                <p className="text-xs text-muted/60">
                                  {i18n.language === "zh"
                                    ? "暂无标签页"
                                    : "No tabs yet"}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );

                case "characters":
                  return (
                    <div
                      key="characters"
                      className="relative group"
                      onMouseEnter={() =>
                        draggingNav &&
                        draggingNav !== "characters" &&
                        swapNav(draggingNav, "characters")
                      }
                    >
                      <Link
                        to="/characters"
                        onClick={onNavigate}
                        title={
                          collapsed
                            ? t("sidebar.characters") || "Characters"
                            : undefined
                        }
                        className={clsx(
                          "flex items-center rounded-xl transition-all duration-300 ease-in-out",
                          collapsed
                            ? "justify-center px-0 py-2.5 gap-0"
                            : "gap-3 pl-3 pr-8 py-2.5",
                          draggingNav === "characters" ? "opacity-60" : "",
                          location.pathname === "/characters"
                            ? "glass-surface-strong text-foreground"
                            : "text-foreground hover:text-foreground",
                        )}
                      >
                        <UsersIcon
                          className={clsx(
                            "w-5 h-5 flex-shrink-0 transition-all duration-200",
                            location.pathname === "/characters"
                              ? ""
                              : "group-hover:scale-110 group-hover:rotate-12",
                          )}
                        />
                        <span
                          className={clsx(
                            "text-sm font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out",
                            collapsed
                              ? "max-w-0 opacity-0"
                              : "max-w-[10rem] opacity-100",
                          )}
                        >
                          {t("sidebar.characters") || "Characters"}
                        </span>
                      </Link>
                      {!collapsed && (
                        <GripHandle
                          onPointerDown={(e) => startNavDrag("characters", e)}
                          onDragEnd={endNavDrag}
                          isDragging={draggingNav === "characters"}
                        />
                      )}
                    </div>
                  );

                case "medals":
                  return (
                    <div
                      key="medals"
                      className="relative group"
                      onMouseEnter={() =>
                        draggingNav &&
                        draggingNav !== "medals" &&
                        swapNav(draggingNav, "medals")
                      }
                    >
                      <Link
                        to="/medals"
                        onClick={onNavigate}
                        title={
                          collapsed ? t("sidebar.medals") || "Medals" : undefined
                        }
                        className={clsx(
                          "flex items-center rounded-xl transition-all duration-300 ease-in-out",
                          collapsed
                            ? "justify-center px-0 py-2.5 gap-0"
                            : "gap-3 pl-3 pr-8 py-2.5",
                          draggingNav === "medals" ? "opacity-60" : "",
                          location.pathname === "/medals"
                            ? "glass-surface-strong text-foreground"
                            : "text-foreground hover:text-foreground",
                        )}
                      >
                        <MedalIcon
                          className={clsx(
                            "w-5 h-5 flex-shrink-0 transition-all duration-200",
                            location.pathname === "/medals"
                              ? ""
                              : "group-hover:scale-110 group-hover:rotate-12",
                          )}
                        />
                        <span
                          className={clsx(
                            "text-sm font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out",
                            collapsed
                              ? "max-w-0 opacity-0"
                              : "max-w-[10rem] opacity-100",
                          )}
                        >
                          {t("sidebar.medals") || "Medals"}
                        </span>
                      </Link>
                      {!collapsed && (
                        <GripHandle
                          onPointerDown={(e) => startNavDrag("medals", e)}
                          onDragEnd={endNavDrag}
                          isDragging={draggingNav === "medals"}
                        />
                      )}
                    </div>
                  );

                case "attendance":
                  return (
                    <div
                      key="attendance"
                      className="relative group"
                      onMouseEnter={() =>
                        draggingNav &&
                        draggingNav !== "attendance" &&
                        swapNav(draggingNav, "attendance")
                      }
                    >
                      <Link
                        to="/attendance"
                        onClick={onNavigate}
                        title={
                          collapsed
                            ? t("sidebar.attendance") || "Attendance"
                            : undefined
                        }
                        className={clsx(
                          "flex items-center rounded-xl transition-all duration-300 ease-in-out",
                          collapsed
                            ? "justify-center px-0 py-2.5 gap-0"
                            : "gap-3 pl-3 pr-8 py-2.5",
                          draggingNav === "attendance" ? "opacity-60" : "",
                          location.pathname === "/attendance"
                            ? "glass-surface-strong text-foreground"
                            : "text-foreground hover:text-foreground",
                        )}
                      >
                        <CalendarIcon
                          className={clsx(
                            "w-5 h-5 flex-shrink-0 transition-all duration-200",
                            location.pathname === "/attendance"
                              ? ""
                              : "group-hover:scale-110 group-hover:rotate-12",
                          )}
                        />
                        <span
                          className={clsx(
                            "text-sm font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out",
                            collapsed
                              ? "max-w-0 opacity-0"
                              : "max-w-[10rem] opacity-100",
                          )}
                        >
                          {t("sidebar.attendance") || "Attendance"}
                        </span>
                      </Link>
                      {!collapsed && (
                        <GripHandle
                          onPointerDown={(e) => startNavDrag("attendance", e)}
                          onDragEnd={endNavDrag}
                          isDragging={draggingNav === "attendance"}
                        />
                      )}
                    </div>
                  );

                case "gacha":
                  return (
                    <div
                      key="gacha"
                      className="relative group"
                      onMouseEnter={() =>
                        draggingNav &&
                        draggingNav !== "gacha" &&
                        swapNav(draggingNav, "gacha")
                      }
                    >
                      <Link
                        to="/gacha"
                        onClick={onNavigate}
                        title={
                          collapsed ? t("sidebar.gacha") || "Gacha" : undefined
                        }
                        className={clsx(
                          "flex items-center rounded-xl transition-all duration-300 ease-in-out",
                          collapsed
                            ? "justify-center px-0 py-2.5 gap-0"
                            : "gap-3 pl-3 pr-8 py-2.5",
                          draggingNav === "gacha" ? "opacity-60" : "",
                          location.pathname === "/gacha"
                            ? "glass-surface-strong text-foreground"
                            : "text-foreground hover:text-foreground",
                        )}
                      >
                        <GachaIcon
                          className={clsx(
                            "w-5 h-5 flex-shrink-0 transition-all duration-200",
                            location.pathname === "/gacha"
                              ? ""
                              : "group-hover:scale-110 group-hover:rotate-12",
                          )}
                        />
                        <span
                          className={clsx(
                            "text-sm font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out",
                            collapsed
                              ? "max-w-0 opacity-0"
                              : "max-w-[10rem] opacity-100",
                          )}
                        >
                          {t("sidebar.gacha") || "Gacha"}
                        </span>
                      </Link>
                      {!collapsed && (
                        <GripHandle
                          onPointerDown={(e) => startNavDrag("gacha", e)}
                          onDragEnd={endNavDrag}
                          isDragging={draggingNav === "gacha"}
                        />
                      )}
                    </div>
                  );

                case "todo":
                  return (
                    <div
                      key="todo"
                      className="relative group"
                      onMouseEnter={() =>
                        draggingNav &&
                        draggingNav !== "todo" &&
                        swapNav(draggingNav, "todo")
                      }
                    >
                      <Link
                        to="/todo"
                        onClick={onNavigate}
                        title={
                          collapsed ? t("sidebar.todo") || "To-Do" : undefined
                        }
                        className={clsx(
                          "flex items-center rounded-xl transition-all duration-300 ease-in-out",
                          collapsed
                            ? "justify-center px-0 py-2.5 gap-0"
                            : "gap-3 pl-3 pr-8 py-2.5",
                          draggingNav === "todo" ? "opacity-60" : "",
                          location.pathname === "/todo"
                            ? "glass-surface-strong text-foreground"
                            : "text-foreground hover:text-foreground",
                        )}
                      >
                        <BookmarkIcon
                          className={clsx(
                            "w-5 h-5 flex-shrink-0 transition-all duration-200",
                            location.pathname === "/todo"
                              ? ""
                              : "group-hover:scale-110 group-hover:rotate-12",
                          )}
                        />
                        <span
                          className={clsx(
                            "text-sm font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out",
                            collapsed
                              ? "max-w-0 opacity-0"
                              : "max-w-[10rem] opacity-100",
                          )}
                        >
                          {t("sidebar.todo") || "To-Do"}
                        </span>
                      </Link>
                      {!collapsed && (
                        <GripHandle
                          onPointerDown={(e) => startNavDrag("todo", e)}
                          onDragEnd={endNavDrag}
                          isDragging={draggingNav === "todo"}
                        />
                      )}
                    </div>
                  );
              }
            })}
          </div>
        </nav>

        {/* Context Menu */}
        {contextMenu && (
          <CardContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={[
              {
                key: "edit",
                label: i18n.language === "zh" ? "编辑" : "Edit",
                onPress: async () => {
                  const tabs = await getAllTabs();
                  const tab = tabs.find((t) => t.id === contextMenu.tabId);
                  if (tab) {
                    setEditingTabForSidebar(tab);
                    setIsTabEditorOpen(true);
                  }
                },
              },
              {
                key: "delete",
                label: i18n.language === "zh" ? "删除" : "Delete",
                danger: true,
                onPress: async () => {
                  const confirmed = await confirmDialog({
                    title: i18n.language === "zh" ? "删除标签页" : "Delete Tab",
                    body:
                      i18n.language === "zh"
                        ? `确定要删除「${contextMenu.tabName}」吗？`
                        : `Are you sure you want to delete "${contextMenu.tabName}"?`,
                    confirmText: i18n.language === "zh" ? "删除" : "Delete",
                    cancelText: i18n.language === "zh" ? "取消" : "Cancel",
                    tone: "danger",
                  });
                  if (!confirmed) return;
                  await removeTab(contextMenu.tabId);
                  const tabs = await getAllTabs();
                  setSidebarTabs(tabs);
                  window.dispatchEvent(new CustomEvent("tabsChanged"));
                },
              },
            ]}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* Tab Editor Modal */}
        <TabEditorModal
          isOpen={isTabEditorOpen}
          onClose={() => {
            setIsTabEditorOpen(false);
            setEditingTabForSidebar(undefined);
          }}
          onSave={async (data) => {
            if (editingTabForSidebar) {
              await updateTab(editingTabForSidebar.id, data);
            } else {
              await addTab(data.name, data.icon, data.tags, data.defaultRoleId);
            }
            setIsTabEditorOpen(false);
            setEditingTabForSidebar(undefined);
            const tabs = await getAllTabs();
            setSidebarTabs(tabs);
            window.dispatchEvent(new CustomEvent("tabsChanged"));
          }}
          initialData={editingTabForSidebar}
        />

        {/* Footer Section */}
        <div
          className={clsx(
            "py-4 space-y-2 border-t border-separator/60 transition-all duration-300 ease-in-out",
            collapsed ? "px-2" : "px-4",
          )}
        >
          {/* Bottom Navigation */}
          <div className="space-y-0.5">
            {bottomItems.map((item) => {
              const isActive = location.pathname === item.href;
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  to={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  className={clsx(
                    "flex items-center rounded-xl transition-all duration-300 ease-in-out group",
                    collapsed
                      ? "justify-center px-0 py-2.5 gap-0"
                      : "gap-3 px-3 py-2.5",
                    isActive
                      ? "glass-surface-strong text-foreground"
                      : "text-foreground hover:text-foreground",
                  )}
                >
                  <Icon
                    className={clsx(
                      "w-5 h-5 flex-shrink-0 transition-all duration-200",
                      isActive
                        ? ""
                        : "group-hover:scale-110 group-hover:rotate-12",
                    )}
                  />
                  <span
                    className={clsx(
                      "text-sm font-semibold whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out",
                      collapsed
                        ? "max-w-0 opacity-0"
                        : "max-w-[10rem] opacity-100",
                    )}
                  >
                    {item.label}
                  </span>
                </Link>
              );
            })}
          </div>

          <div
            className={clsx(
              "flex px-1 pt-1 transition-all duration-300 ease-out",
              collapsed ? "justify-center" : "items-center justify-between",
            )}
          >
            {!collapsed && (
              <div className="flex items-center gap-1">
                <a
                  aria-label="Github"
                  href={siteConfig.links.github}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="glass-surface p-2 rounded-full transition-all duration-200 hover:scale-105 active:scale-95"
                >
                  <GithubIcon className="text-muted w-4 h-4 hover:text-foreground transition-colors" />
                </a>
                <ThemeSwitch />
                <LanguageSwitch />
              </div>
            )}
            {onToggleCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapsed}
                title={
                  collapsed
                    ? i18n.language === "zh"
                      ? "展开侧边栏"
                      : "Expand sidebar"
                    : i18n.language === "zh"
                      ? "折叠侧边栏"
                      : "Collapse sidebar"
                }
                aria-label={
                  collapsed ? "Expand sidebar" : "Collapse sidebar"
                }
                className="glass-surface p-2 rounded-full transition-all duration-200 hover:scale-105 active:scale-95 text-muted hover:text-foreground"
              >
                {collapsed ? (
                  <ChevronRightIcon size={16} />
                ) : (
                  <ChevronLeftIcon size={16} />
                )}
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Account Switch Modal */}
      <AccountSwitchModal
        isOpen={isSwitchModalOpen}
        onClose={() => setIsSwitchModalOpen(false)}
        currentAccountId={selectedAccount?.id}
      />
    </>
  );
};

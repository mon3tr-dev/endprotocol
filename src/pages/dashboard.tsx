import { useEffect, useRef, useState } from "react";
import { GlassButton, GlassProgressCircle, GlassTooltip } from "@/components/ui/glass";
import { useTranslation } from "react-i18next";
import { getSelectedAccount, refreshAccountData, getAccounts } from "@/utils/accountService";
import type { Account } from "@/utils/accountService";
import { CardContainer } from "@/components/cards/card-container";
import { DashboardFAB } from "@/components/dashboard-fab";
import { AddCardModal } from "@/components/add-card-modal";
import {
  SystemResourceAddModal,
  type SystemResourceAddPayload,
} from "@/components/cards/system-resource/add-modal";
import { TodoAddModal } from "@/components/cards/todo/add-modal";
import type { TodoAddChoice } from "@/components/cards/todo/add-modal";
import { CharacterListSizeModal } from "@/components/cards/character-list/character-list-size-modal";
import { CardTypeId, DashboardConfig, DashboardTab } from "@/types/dashboard";
import {
  getDashboardConfig,
  addCard,
  removeCard,
} from "@/utils/dashboardConfig";
import {
  getAllTabs,
  getActiveTabId,
  setActiveTabId,
  addTab,
  removeTab,
  updateTab,
} from "@/utils/tabService";
import { logDebug, logError } from "@/utils/logger";
import { roleDetailService } from "@/utils/roleDetailService";
import { CardConfigService } from "@/utils/cardConfigService";
import { CardStartupService } from "@/cards/startup-service";
import { confirmDialog } from "@/components/ui/confirm-dialog";
import { RefreshIcon, ChevronLeftIcon } from "@/components/ui/app-icon";
import { getTabIcon } from "@/utils/tabIcons";
import { TabSelector } from "@/components/tab-selector";
import { TabEditorModal } from "@/components/tab-editor-modal";
import type { CharacterListDisplayMode } from "@/types/card-settings";
import { Img } from "@/utils/imageLoader";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import { resolveServerLabel } from "@/types";
import { trackStartupTask } from "@/utils/startupProgress";
import {
  captureTabSnapshot,
  deleteTabSnapshotFile,
  getSnapshotPaths,
  registerDashboardLeaveHandler,
} from "@/utils/tabSnapshotService";
import { buildDefaultCardSettings } from "@/types/system-resource";
import { getSystemResourceDefaults } from "@/utils/systemResourceService";
import { createTodoListFromTemplate } from "@/utils/todoTemplateService";

type DashboardView = "loading" | "selector" | "tab";

export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<DashboardView>("loading");
  const [tabs, setTabs] = useState<DashboardTab[]>([]);
  const [activeTabId, setActiveTabIdState] = useState<string | null>(null);
  const [currentRoleId, setCurrentRoleId] = useState<string | null>(null);
  const [dashboardConfig, setDashboardConfig] =
    useState<DashboardConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isAddCardModalOpen, setIsAddCardModalOpen] = useState(false);
  const [isSystemResourceAddOpen, setIsSystemResourceAddOpen] = useState(false);
  const [isTodoAddOpen, setIsTodoAddOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSizeModalOpen, setIsSizeModalOpen] = useState(false);
  const [pendingCardType, setPendingCardType] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTab, setEditingTab] = useState<DashboardTab | undefined>();
  const [isRoleSelectModalOpen, setIsRoleSelectModalOpen] = useState(false);
  const [pendingDisplayMode, setPendingDisplayMode] = useState<CharacterListDisplayMode | null>(null);
  const [availableAccounts, setAvailableAccounts] = useState<Account[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  /** tabId -> 快照 PNG 路径（主界面缩略图用） */
  const [snapshotPaths, setSnapshotPaths] = useState<Record<string, string>>({});

  const activeTab = tabs.find((t) => t.id === activeTabId);

  // 当前渲染中的视图与标签页（ref 供事件回调读取最新值，用于「离开时截图」）
  const viewRef = useRef<DashboardView>("loading");
  const tabIdRef = useRef<string | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);
  useEffect(() => {
    tabIdRef.current = activeTabId;
  }, [activeTabId]);

  // 快照策略：截图都发生在「当前视图要被换掉」之前（await，此时窗口画面仍是
  // 旧标签页），PrintWindow 截到的就是「上次离开时的画面」。
  const snapshotLeavingTab = async () => {
    if (viewRef.current === "tab" && tabIdRef.current) {
      await captureTabSnapshot(tabIdRef.current);
    }
  };

  const loadDashboard = async () => {
    try {
      // 重新加载前给当前视图留快照（切标签页 / 刷新 / 切账户都会走到这里；
      // 同一标签页重截只是把画面更新到最新，不会污染其它标签页）
      await snapshotLeavingTab();
      setIsLoading(true);
      const selectedAccountId = await getSelectedAccount();
      setCurrentRoleId(selectedAccountId);

      if (selectedAccountId) {
        await roleDetailService.setCurrentRoleId(selectedAccountId);
      }

      const allTabs = await getAllTabs();
      setTabs(allTabs);

      const savedActiveId = await getActiveTabId();
      if (savedActiveId && allTabs.some((t) => t.id === savedActiveId)) {
        setActiveTabIdState(savedActiveId);
        const config = await getDashboardConfig(savedActiveId);
        setDashboardConfig(config);
        setView("tab");
      } else {
        // 没有激活标签页 → 进入主界面（标签页总览），不再自动跳进第一个仪表盘
        setActiveTabIdState(null);
        setDashboardConfig(null);
        setView("selector");
      }

      setIsLoading(false);
    } catch (error) {
      logError("Failed to load dashboard:", error);
      setIsLoading(false);
    }
  };

  // 回到主界面时刷新各标签页的快照路径（截图在离开 tab 视图时已完成）
  useEffect(() => {
    if (view === "selector") {
      void getSnapshotPaths().then(setSnapshotPaths);
    }
  }, [view]);

  useEffect(() => {
    void trackStartupTask(loadDashboard());

    // 供侧栏导航使用：点击前 await，趁画面还是仪表盘先截图
    registerDashboardLeaveHandler(snapshotLeavingTab);

    const handleAccountChange = () => {
      loadDashboard();
    };
    const handleManualRefresh = () => {
      logDebug("[Dashboard] Received manual refresh event, reloading data...");
      loadDashboard();
    };
    // 侧边栏点击「仪表盘」父节点：先给当前仪表盘留快照，再回到主界面（标签页总览）
    const handleOpenSelector = async () => {
      await snapshotLeavingTab();
      setActiveTabIdState(null);
      setDashboardConfig(null);
      setView("selector");
      void getAllTabs().then(setTabs);
    };
    window.addEventListener("accountChanged", handleAccountChange);
    window.addEventListener("manualRefresh", handleManualRefresh);
    window.addEventListener("dashboardOpenSelector", handleOpenSelector);
    return () => {
      registerDashboardLeaveHandler(null);
      window.removeEventListener("accountChanged", handleAccountChange);
      window.removeEventListener("manualRefresh", handleManualRefresh);
      window.removeEventListener("dashboardOpenSelector", handleOpenSelector);
    };
  }, []);

  // 卡片在自身设置里调整了尺寸：刷新当前标签页配置，保持内存状态与落盘一致
  useEffect(() => {
    const handleCardLayoutChanged = () => {
      if (!activeTabId) return;
      void getDashboardConfig(activeTabId).then(setDashboardConfig);
    };
    window.addEventListener("cardLayoutChanged", handleCardLayoutChanged);
    return () =>
      window.removeEventListener("cardLayoutChanged", handleCardLayoutChanged);
  }, [activeTabId]);

  const handleRefresh = async () => {
    try {
      setIsRefreshing(true);
      window.dispatchEvent(
        new CustomEvent("manualRefresh", {
          detail: { count: dashboardConfig?.cards.length || 1 },
        }),
      );
      const result = await refreshAccountData();
      if (result.success && result.accounts) {
        logDebug("[Dashboard] Data refreshed successfully");
        await loadDashboard();
      }
    } catch (error) {
      logError("Failed to refresh dashboard:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddCard = async (cardType: CardTypeId) => {
    if (!activeTabId) return;
    if (cardType === "system_resource") {
      setIsSystemResourceAddOpen(true);
      return;
    }
    if (cardType === "todo") {
      setIsTodoAddOpen(true);
      return;
    }
    if (cardType === "character_list") {
      setPendingCardType(cardType);
      setIsSizeModalOpen(true);
      return;
    }
    await openRoleSelect(cardType);
  };

  const handleTodoAdd = async (choice: TodoAddChoice) => {
    if (!activeTabId) return;
    try {
      const listId =
        choice.type === "existing"
          ? choice.listId
          : (await createTodoListFromTemplate(choice.templateId, t)).id;
      const newCardId = await addCard(activeTabId, "todo", {
        settings: { listId },
      });
      const config = await getDashboardConfig(activeTabId);
      setDashboardConfig(config);
      if (newCardId) setHighlightedCardId(newCardId);
    } catch (error) {
      logError("Failed to add todo card:", error);
    } finally {
      setIsTodoAddOpen(false);
    }
  };

  const handleSystemResourceAdd = async (payload: SystemResourceAddPayload) => {
    if (!activeTabId) return;
    try {
      const defaults = await getSystemResourceDefaults();
      const settings = buildDefaultCardSettings(payload.mode, payload.metrics, defaults);
      const newCardId = await addCard(activeTabId, "system_resource", {
        w: payload.size.w,
        h: payload.size.h,
        settings,
      });
      const config = await getDashboardConfig(activeTabId);
      setDashboardConfig(config);
      if (newCardId) setHighlightedCardId(newCardId);
    } catch (error) {
      logError("Failed to add system resource card:", error);
    } finally {
      setIsSystemResourceAddOpen(false);
    }
  };

  const openRoleSelect = async (cardType: CardTypeId) => {
    try {
      const accounts = await getAccounts();
      setAvailableAccounts(accounts);
      setSelectedRoleId(activeTab?.defaultRoleId ?? null);
      setPendingCardType(cardType);
      setIsRoleSelectModalOpen(true);
    } catch (error) {
      logError("Failed to load accounts:", error);
    }
  };

  const closeRoleSelect = () => {
    setIsRoleSelectModalOpen(false);
    setPendingCardType(null);
    setPendingDisplayMode(null);
    setSelectedRoleId(null);
  };

  const handleSizeConfirm = async (mode: CharacterListDisplayMode) => {
    if (!activeTabId || !pendingCardType) return;
    setPendingDisplayMode(mode);
    setIsSizeModalOpen(false);
    await openRoleSelect(pendingCardType);
  };

  const handleRoleConfirm = async (roleId: string) => {
    if (!activeTabId || !pendingCardType) return;
    const cardType = pendingCardType;
    let newCardId: string | null = null;
    try {
      if (cardType === "character_list") {
        if (!pendingDisplayMode) return;
        const SIZE_MAP: Record<CharacterListDisplayMode, { w: number; h: number }> = {
          single: { w: 2, h: 3 },
          double: { w: 3, h: 3 },
          triple: { w: 4, h: 3 },
        };
        const { w, h } = SIZE_MAP[pendingDisplayMode];
        newCardId = await addCard(activeTabId, cardType, {
          w,
          h,
          settings: { roleId, displayMode: pendingDisplayMode },
        });
      } else if (cardType === "attendance") {
        newCardId = await addCard(activeTabId, cardType, {
          settings: { selectedRoleId: roleId },
        });
      } else {
        newCardId = await addCard(activeTabId, cardType, {
          settings: { roleId },
        });
      }
      const config = await getDashboardConfig(activeTabId);
      setDashboardConfig(config);
      if (newCardId) {
        setHighlightedCardId(newCardId);
      }
    } catch (error) {
      logError("Failed to add card:", error);
    } finally {
      closeRoleSelect();
    }
  };

  // 添加卡片后滚动到卡片位置并闪烁提示
  useEffect(() => {
    if (!highlightedCardId) return;
    const scrollTimer = window.setTimeout(() => {
      const el = document.querySelector(`[data-card-id="${highlightedCardId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 200);
    const clearTimer = window.setTimeout(() => setHighlightedCardId(null), 2800);
    return () => {
      window.clearTimeout(scrollTimer);
      window.clearTimeout(clearTimer);
    };
  }, [highlightedCardId]);

  const handleRemoveCard = async (cardId: string) => {
    if (!activeTabId) return;
    try {
      await Promise.all([
        CardConfigService.removeCardSettings(cardId),
        CardStartupService.removeCardFromMapping(cardId),
        removeCard(activeTabId, cardId),
      ]);
      logDebug(`Removed settings for card ${cardId}`);
      const config = await getDashboardConfig(activeTabId);
      setDashboardConfig(config);
      logDebug(`Successfully removed card ${cardId}`);
    } catch (error) {
      logError("Failed to remove card:", error);
    }
  };

  const handleSelectTab = async (tabId: string) => {
    await setActiveTabId(tabId);
    setActiveTabIdState(tabId);
    const config = await getDashboardConfig(tabId);
    setDashboardConfig(config);
    setView("tab");
    // 同步侧边栏的标签页高亮
    window.dispatchEvent(new CustomEvent("tabsChanged"));
  };

  const handleBackToSelector = async () => {
    await snapshotLeavingTab();
    await setActiveTabId(null);
    setActiveTabIdState(null);
    setDashboardConfig(null);
    setView("selector");
    const allTabs = await getAllTabs();
    setTabs(allTabs);
    window.dispatchEvent(new CustomEvent("tabsChanged"));
  };

  const handleCreateTab = () => {
    setEditingTab(undefined);
    setIsEditorOpen(true);
  };

  const handleEditTab = (tab: DashboardTab) => {
    setEditingTab(tab);
    setIsEditorOpen(true);
  };

  const handleDeleteTab = async (tabId: string) => {
    const confirmed = await confirmDialog({
      title: t("tab.confirm_delete_title"),
      body: t("tab.confirm_delete_body"),
      confirmText: t("common.delete"),
      cancelText: t("common.cancel"),
      tone: "danger",
    });
    if (!confirmed) return;

    await removeTab(tabId);
    void deleteTabSnapshotFile(tabId);
    const allTabs = await getAllTabs();
    setTabs(allTabs);
    if (activeTabId === tabId) {
      setActiveTabIdState(null);
      setDashboardConfig(null);
    }
  };

  const handleSaveTab = async (data: {
    name: string;
    icon: string;
    tags: string[];
    defaultRoleId: string;
  }) => {
    if (editingTab) {
      await updateTab(editingTab.id, data);
    } else {
      await addTab(data.name, data.icon, data.tags, data.defaultRoleId);
    }
    setIsEditorOpen(false);
    setEditingTab(undefined);
    const allTabs = await getAllTabs();
    setTabs(allTabs);
  };

  if (isLoading && view === "loading") {
    return (
      <div className="flex items-center justify-center py-24">
        <GlassProgressCircle isIndeterminate size="lg" aria-label="Loading" className="text-primary-text">
          <GlassProgressCircle.Track>
            <GlassProgressCircle.TrackCircle />
            <GlassProgressCircle.FillCircle />
          </GlassProgressCircle.Track>
        </GlassProgressCircle>
      </div>
    );
  }

  if (view === "selector") {
    return (
      <>
        <TabSelector
          tabs={tabs}
          snapshotPaths={snapshotPaths}
          onSelectTab={handleSelectTab}
          onCreateTab={handleCreateTab}
          onEditTab={handleEditTab}
          onDeleteTab={handleDeleteTab}
        />
        <TabEditorModal
          isOpen={isEditorOpen}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingTab(undefined);
          }}
          onSave={handleSaveTab}
          initialData={editingTab}
        />
      </>
    );
  }

  const IconComponent = activeTab ? getTabIcon(activeTab.icon) : null;

  return (
    <div className="space-y-6 lg:space-y-8">
      <div
        id="dashboard-header"
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="flex items-center gap-3">
          <GlassTooltip>
            <GlassButton
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={handleBackToSelector}
              aria-label="Back"
              className="rounded-xl lg-hoverable"
            >
              <ChevronLeftIcon size={20} />
            </GlassButton>
            <GlassTooltip.Content>
              {t("settings.account.back") || "Back"}
            </GlassTooltip.Content>
          </GlassTooltip>
          <div>
            <div className="flex items-center gap-2">
              {IconComponent && <IconComponent size={24} className="text-primary-text" />}
              <h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
                {activeTab?.name ?? t("nav.dashboard")}
              </h1>
            </div>
            <p className="text-foreground/70 mt-1">
              {t("dashboard.customize_hint") ||
                "Customize your dashboard with cards"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <GlassTooltip>
            <GlassButton
              isIconOnly
              variant="ghost"
              size="sm"
              onPress={handleRefresh}
              isDisabled={isRefreshing}
              className="text-muted hover:text-foreground lg-hoverable rounded-xl"
              aria-label={t("common.refresh") || "Refresh"}
            >
              <RefreshIcon size={20} className={isRefreshing ? "animate-spin" : ""} />
            </GlassButton>
            <GlassTooltip.Content>
              {t("common.refresh") || "Refresh"}
            </GlassTooltip.Content>
          </GlassTooltip>
        </div>
      </div>

      {isRefreshing ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-5">
          <GlassProgressCircle isIndeterminate size="lg" aria-label="Loading" className="text-primary-text">
            <GlassProgressCircle.Track>
              <GlassProgressCircle.TrackCircle />
              <GlassProgressCircle.FillCircle />
            </GlassProgressCircle.Track>
          </GlassProgressCircle>
          <p className="text-sm text-muted/70 animate-pulse-soft">
            {t("common.refreshing") || "Refreshing..."}
          </p>
        </div>
      ) : dashboardConfig ? (
        <CardContainer
          roleId={activeTab?.defaultRoleId || currentRoleId!}
          tabId={activeTabId!}
          cards={dashboardConfig.cards}
          onRemoveCard={handleRemoveCard}
          isEditMode={isEditMode}
          onEnterEditMode={() => setIsEditMode(true)}
          onExitEditMode={() => setIsEditMode(false)}
          highlightCardId={highlightedCardId}
        />
      ) : null}

      <DashboardFAB
        onAddCard={() => setIsAddCardModalOpen(true)}
        onToggleEdit={() => setIsEditMode(!isEditMode)}
        isEditMode={isEditMode}
      />

      {dashboardConfig && (
        <AddCardModal
          isOpen={isAddCardModalOpen}
          onClose={() => setIsAddCardModalOpen(false)}
          onAdd={handleAddCard}
          existingTypes={dashboardConfig.cards.map((c) => c.type)}
        />
      )}

      <CharacterListSizeModal
        isOpen={isSizeModalOpen}
        onClose={() => {
          setIsSizeModalOpen(false);
          setPendingCardType(null);
        }}
        onConfirm={handleSizeConfirm}
      />

      <SystemResourceAddModal
        isOpen={isSystemResourceAddOpen}
        onClose={() => setIsSystemResourceAddOpen(false)}
        onConfirm={handleSystemResourceAdd}
      />

      <TodoAddModal
        isOpen={isTodoAddOpen}
        onClose={() => setIsTodoAddOpen(false)}
        onConfirm={(templateId) => void handleTodoAdd(templateId)}
      />

      {/* Role Select Modal for Character List Card */}
      <CustomModal
        isOpen={isRoleSelectModalOpen}
        onClose={closeRoleSelect}
        size="md"
      >
        <CustomModalHeader onClose={closeRoleSelect}>
          {t("card:select_role") || "Select Account"}
        </CustomModalHeader>
        <CustomModalBody>
          <div className="space-y-3">
            {availableAccounts.length === 0 ? (
              <div className="text-center text-muted py-8">
                {t("card:no_accounts") || "No accounts available"}
              </div>
            ) : (
              availableAccounts.map((account) => {
                const isSelected = selectedRoleId === account.id;
                return (
                  <div
                    key={account.id}
                    onClick={() => setSelectedRoleId(account.id)}
                    className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all border ${
                      isSelected
                        ? "border-primary/70 bg-primary/10"
                        : "border-separator hover:border-primary/50 lg-hoverable"
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0">
                      {account.avatar ? (
                        <Img
                          src={account.avatar}
                          alt={account.nickname}
                          className="w-full h-full avatar-feather"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted text-sm">
                          {account.nickname?.charAt(0) || "?"}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {account.nickname || t("common.unknown") || "Unknown"}
                      </div>
                      <div className="text-xs text-muted">
                        {resolveServerLabel(account.server, i18n.language)} · Lv.{account.level}
                      </div>
                    </div>
                    {isSelected && (
                      <svg className="w-5 h-5 text-primary-text shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </CustomModalBody>
        <CustomModalFooter>
          <GlassButton variant="secondary" onPress={closeRoleSelect}>
            {t("common.cancel") || "Cancel"}
          </GlassButton>
          <GlassButton
            variant="primary"
            isDisabled={!selectedRoleId}
            onPress={() => selectedRoleId && handleRoleConfirm(selectedRoleId)}
          >
            {t("common.confirm") || "Confirm"}
          </GlassButton>
        </CustomModalFooter>
      </CustomModal>
    </div>
  );
}

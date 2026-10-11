import { useEffect, useState } from "react";
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

  const activeTab = tabs.find((t) => t.id === activeTabId);

  const loadDashboard = async () => {
    try {
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
      } else if (allTabs.length > 0) {
        const firstTabId = allTabs[0].id;
        setActiveTabIdState(firstTabId);
        await setActiveTabId(firstTabId);
        const config = await getDashboardConfig(firstTabId);
        setDashboardConfig(config);
        setView("tab");
      } else {
        setDashboardConfig(null);
        setView("selector");
      }

      setIsLoading(false);
    } catch (error) {
      logError("Failed to load dashboard:", error);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void trackStartupTask(loadDashboard());

    const handleAccountChange = () => {
      loadDashboard();
    };
    const handleManualRefresh = () => {
      logDebug("[Dashboard] Received manual refresh event, reloading data...");
      loadDashboard();
    };
    window.addEventListener("accountChanged", handleAccountChange);
    window.addEventListener("manualRefresh", handleManualRefresh);
    return () => {
      window.removeEventListener("accountChanged", handleAccountChange);
      window.removeEventListener("manualRefresh", handleManualRefresh);
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
  };

  const handleBackToSelector = async () => {
    await setActiveTabId(null);
    setActiveTabIdState(null);
    setDashboardConfig(null);
    setView("selector");
    const allTabs = await getAllTabs();
    setTabs(allTabs);
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
        <GlassProgressCircle isIndeterminate size="lg" aria-label="Loading" className="text-primary">
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
              className="rounded-xl hover:bg-default-100"
            >
              <ChevronLeftIcon size={20} />
            </GlassButton>
            <GlassTooltip.Content>
              {t("settings.account.back") || "Back"}
            </GlassTooltip.Content>
          </GlassTooltip>
          <div>
            <div className="flex items-center gap-2">
              {IconComponent && <IconComponent size={24} className="text-primary" />}
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
              className="text-muted hover:text-foreground hover:bg-default-100 rounded-xl"
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
          <GlassProgressCircle isIndeterminate size="lg" aria-label="Loading" className="text-primary">
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
                        : "border-separator hover:border-primary/50 hover:bg-default-100"
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
                      <svg className="w-5 h-5 text-primary shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
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

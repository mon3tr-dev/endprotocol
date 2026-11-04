import { useMemo, useState } from "react";
import { GlassButton, GlassChip, GlassInput } from "@/components/ui/glass";
import { useTranslation } from "react-i18next";
import { DashboardTab } from "@/types/dashboard";
import { getTabIcon } from "@/utils/tabIcons";
import { PlusIcon, SearchIcon, EditIcon, TrashIcon } from "@/components/icons";
import { CardContextMenu } from "@/components/cards/card-context-menu";

interface TabSelectorProps {
  tabs: DashboardTab[];
  onSelectTab: (tabId: string) => void;
  onCreateTab: () => void;
  onEditTab: (tab: DashboardTab) => void;
  onDeleteTab: (tabId: string) => void;
}

export function TabSelector({
  tabs,
  onSelectTab,
  onCreateTab,
  onEditTab,
  onDeleteTab,
}: TabSelectorProps) {
  const { i18n } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; tab: DashboardTab } | null>(null);

  const filteredTabs = useMemo(() => {
    if (!searchQuery.trim()) return tabs;
    const q = searchQuery.toLowerCase();
    return tabs.filter(
      (tab) =>
        tab.name.toLowerCase().includes(q) ||
        tab.tags.some((tag) => tag.toLowerCase().includes(q)),
    );
  }, [tabs, searchQuery]);

  return (
    <>
      <div className="space-y-6 lg:space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold text-foreground">
              {i18n.language === "zh" ? "仪表盘" : "Dashboard"}
            </h1>
            <p className="text-muted mt-1">
              {i18n.language === "zh"
                ? "选择一个标签页进入，或创建新的标签页"
                : "Select a tab to enter, or create a new one"}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-muted w-4 h-4 z-10" />
            <GlassInput
              placeholder={
                i18n.language === "zh" ? "搜索标签页..." : "Search tabs..."
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <GlassButton
            variant="primary"
            onPress={onCreateTab}
          >
            <PlusIcon size={18} />
            {i18n.language === "zh" ? "新建标签页" : "New Tab"}
          </GlassButton>
        </div>

        {filteredTabs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl lg-inset flex items-center justify-center mb-4">
              <SearchIcon className="w-8 h-8 text-muted" />
            </div>
            <p className="text-lg font-medium text-foreground mb-2">
              {searchQuery
                ? (i18n.language === "zh" ? "未找到匹配的标签页" : "No tabs found")
                : (i18n.language === "zh" ? "还没有标签页" : "No tabs yet")}
            </p>
            <p className="text-sm text-muted max-w-sm mb-4">
              {searchQuery
                ? (i18n.language === "zh" ? "尝试其他搜索词" : "Try a different search term")
                : (i18n.language === "zh"
                    ? "点击「新建标签页」按钮创建你的第一个标签页"
                    : "Click 'New Tab' to create your first tab")}
            </p>
            {!searchQuery && (
              <GlassButton
                variant="outline"
                onPress={onCreateTab}
              >
                <PlusIcon size={18} />
                {i18n.language === "zh" ? "创建第一个标签页" : "Create First Tab"}
              </GlassButton>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredTabs.map((tab) => {
              const Icon = getTabIcon(tab.icon);
              return (
                <div
                  key={tab.id}
                  className="group relative lg-material border border-separator/90 rounded-xl p-5 [transition:transform_var(--lg-dur-fast)_var(--lg-ease-standard),translate_var(--lg-dur-fast)_var(--lg-ease-standard),scale_var(--lg-dur-fast)_var(--lg-ease-standard),box-shadow_var(--lg-dur-fast)_var(--lg-ease-standard),border-color_var(--lg-dur-fast)_var(--lg-ease-standard)] hover:border-primary/50 hover:shadow-md hover:-translate-y-0.5 cursor-pointer active:translate-y-0 active:scale-[0.99]"
                  onClick={() => onSelectTab(tab.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY, tab });
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div className="p-3 rounded-xl bg-primary/10 text-primary-text flex-shrink-0">
                      <Icon size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground text-base truncate">
                        {tab.name}
                      </h3>
                      <p className="text-xs text-muted mt-0.5">
                        {tab.cards.length}{" "}
                        {i18n.language === "zh" ? "个卡片" : "cards"}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 mt-3">
                    {tab.defaultRoleId && (
                      <GlassChip variant="soft" size="sm" color="success">
                        {i18n.language === "zh" ? "已绑定角色" : "Role set"}
                      </GlassChip>
                    )}
                    {tab.tags.map((tag) => (
                      <GlassChip key={tag} variant="soft" size="sm">
                        {tag}
                      </GlassChip>
                    ))}
                  </div>

                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onEditTab(tab);
                      }}
                      className="p-1.5 rounded-lg lg-hoverable text-muted hover:text-foreground transition-all duration-150 hover:scale-110 active:scale-90"
                    >
                      <EditIcon size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTab(tab.id);
                      }}
                      className="p-1.5 rounded-lg hover:bg-danger/10 text-danger-text transition-all duration-150 hover:scale-110 active:scale-90"
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {contextMenu && (
        <CardContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              key: "edit",
              label: i18n.language === "zh" ? "编辑" : "Edit",
              onPress: () => onEditTab(contextMenu.tab),
            },
            {
              key: "delete",
              label: i18n.language === "zh" ? "删除" : "Delete",
              danger: true,
              onPress: () => onDeleteTab(contextMenu.tab.id),
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}

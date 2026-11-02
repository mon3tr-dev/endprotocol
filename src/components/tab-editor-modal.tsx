import { useState, useEffect } from "react";
import { GlassButton, GlassChip, GlassInput } from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "./custom-modal";
import { useTranslation } from "react-i18next";
import { TAB_ICONS, DashboardTab } from "@/types/dashboard";
import { getTabIcon, getIconLabel } from "@/utils/tabIcons";
import { getAccounts, getSelectedAccount, type Account } from "@/utils/accountService";
import { AccountAvatar } from "@/components/ui/account-avatar";
import { MorphIcon } from "morphicons/react";
import { X, Check } from "lucide";

interface TabEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { name: string; icon: string; tags: string[]; defaultRoleId: string }) => void;
  initialData?: Pick<DashboardTab, "name" | "icon" | "tags" | "defaultRoleId">;
  title?: string;
}

export function TabEditorModal({
  isOpen,
  onClose,
  onSave,
  initialData,
  title,
}: TabEditorModalProps) {
  const { i18n } = useTranslation();
  const [name, setName] = useState(initialData?.name ?? "");
  const [selectedIcon, setSelectedIcon] = useState(
    initialData?.icon ?? "home",
  );
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(initialData?.tags ?? []);
  const [defaultRoleId, setDefaultRoleId] = useState<string>("");
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    if (isOpen) {
      setName(initialData?.name ?? "");
      setSelectedIcon(initialData?.icon ?? "home");
      setTags(initialData?.tags ?? []);
      setAccounts([]);
      setDefaultRoleId("");

      const init = async () => {
        const [allAccounts, activeId] = await Promise.all([
          getAccounts(),
          getSelectedAccount(),
        ]);
        setAccounts(allAccounts);

        if (initialData?.defaultRoleId && allAccounts.some((a) => a.id === initialData.defaultRoleId)) {
          setDefaultRoleId(initialData.defaultRoleId);
        } else if (activeId && allAccounts.some((a) => a.id === activeId)) {
          setDefaultRoleId(activeId);
        } else if (allAccounts.length > 0) {
          setDefaultRoleId(allAccounts[0].id);
        }
      };
      init();
    }
  }, [isOpen, initialData]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleSave = () => {
    if (!name.trim() || !defaultRoleId) return;
    onSave({
      name: name.trim(),
      icon: selectedIcon,
      tags,
      defaultRoleId,
    });
  };

  const isEdit = !!initialData;

  return (
    <CustomModal isOpen={isOpen} onClose={onClose} size="md">
      <CustomModalHeader>
        {title ?? (isEdit
          ? (i18n.language === "zh" ? "编辑标签页" : "Edit Tab")
          : (i18n.language === "zh" ? "创建标签页" : "Create Tab"))}
      </CustomModalHeader>
      <CustomModalBody>
        <div className="space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">
              {i18n.language === "zh" ? "名称" : "Name"}
            </label>
            <GlassInput
              placeholder={
                i18n.language === "zh" ? "输入标签页名称" : "Enter tab name"
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              {i18n.language === "zh" ? "图标" : "Icon"}
            </label>
            <div className="grid grid-cols-5 gap-3">
              {TAB_ICONS.map((iconKey) => {
                const Icon = getTabIcon(iconKey);
                const isSelected = selectedIcon === iconKey;
                return (
                  <button
                    key={iconKey}
                    type="button"
                    onClick={() => setSelectedIcon(iconKey)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all ${
                      isSelected
                        ? "border-primary bg-primary/20 text-primary-text shadow-[0_0_14px_hsl(var(--heroui-primary)/0.45)] ring-2 ring-primary/50 scale-105 font-semibold"
                        : "border-separator hover:border-default-400 text-muted hover:text-foreground lg-hoverable-soft"
                    }`}
                  >
                    <Icon size={22} />
                    <span className="text-[10px] leading-tight truncate w-full text-center">
                      {getIconLabel(iconKey, i18n.language)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              {i18n.language === "zh" ? "标签" : "Tags"}
            </label>
            <div className="flex gap-2 mb-2">
              <GlassInput
                placeholder={
                  i18n.language === "zh"
                    ? "输入标签后按回车"
                    : "Type tag and press Enter"
                }
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
              />
              <GlassButton variant="outline" onPress={handleAddTag}>
                {i18n.language === "zh" ? "添加" : "Add"}
              </GlassButton>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {tags.map((tag) => (
                  <GlassChip key={tag} variant="soft" color="accent">
                    <div className="flex items-center gap-1">
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-0.5 hover:text-danger-text transition-colors"
                      >
                        <MorphIcon icon={X} size={12} />
                      </button>
                    </div>
                  </GlassChip>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">
              {i18n.language === "zh" ? "默认角色（必选）" : "Default Role (required)"}
            </label>
            <p className="text-xs text-muted mb-1">
              {i18n.language === "zh"
                ? "此标签页中的所有卡片将默认使用该角色的数据"
                : "All cards in this tab will use this role's data by default"}
            </p>
            <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto p-2 lg-material-sub border border-separator rounded-lg">
              {accounts.map((acc) => {
                const isSelected = defaultRoleId === acc.id;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => setDefaultRoleId(acc.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all border-2 w-full text-left ${
                      isSelected
                        ? "border-primary bg-primary-50 dark:bg-primary-900/40 shadow-sm"
                        : "border-separator hover:border-primary/50 lg-hoverable-soft"
                    }`}
                  >
                    <AccountAvatar
                      src={acc.avatar}
                      alt={acc.nickname}
                      size="xs"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium">{acc.nickname}</span>
                      <span className="text-xs text-muted ml-1.5">Lv.{acc.level}</span>
                    </div>
                    {isSelected && (
                      <MorphIcon icon={Check} size={16} className="text-primary-text shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </CustomModalBody>
      <CustomModalFooter>
        <GlassButton variant="ghost" onPress={onClose}>
          {i18n.language === "zh" ? "取消" : "Cancel"}
        </GlassButton>
        <GlassButton
          variant="primary"
          onPress={handleSave}
          isDisabled={!name.trim() || !defaultRoleId}
        >
          {i18n.language === "zh" ? "保存" : "Save"}
        </GlassButton>
      </CustomModalFooter>
    </CustomModal>
  );
}

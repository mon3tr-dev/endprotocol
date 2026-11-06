import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { MorphIcon } from "morphicons/react";
import { Plus, X, Pencil, Check } from "lucide";

interface DashboardFABProps {
  onAddCard: () => void;
  onToggleEdit: () => void;
  isEditMode: boolean;
}

export function DashboardFAB({
  onAddCard,
  onToggleEdit,
  isEditMode,
}: DashboardFABProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (isEditMode) setIsExpanded(true);
  }, [isEditMode]);

  return createPortal(
    <div className="fixed bottom-6 right-6 z-50">
      {isExpanded && (
        <div className="absolute bottom-16 right-0 flex flex-col gap-2 animate-fade-in">
          <button
            type="button"
            onClick={onAddCard}
            className="lg-regular lg-glass-interactive [--lg-glass-hover:1.1] flex min-w-[160px] items-center justify-center gap-2 rounded-2xl border border-primary/50 px-4 h-11 text-sm font-medium text-primary-text [transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),box-shadow_var(--lg-dur-fast)_var(--lg-ease-standard)] cursor-pointer hover:scale-105 active:scale-95"
          >
            <MorphIcon icon={Plus} size={20} />
            {t("dashboard.add_card_button") || "Add Card"}
          </button>

          <button
            type="button"
            onClick={onToggleEdit}
            className="lg-regular flex min-w-[160px] items-center justify-center gap-2 rounded-2xl border border-separator/70 px-4 h-11 text-sm font-medium text-foreground [transition:transform_var(--lg-dur-press)_var(--lg-ease-spring),translate_var(--lg-dur-press)_var(--lg-ease-spring),scale_var(--lg-dur-press)_var(--lg-ease-spring),box-shadow_var(--lg-dur-fast)_var(--lg-ease-standard)] cursor-pointer hover:text-primary-text hover:scale-105 active:scale-95"
          >
            <MorphIcon
              icon={isEditMode ? Check : Pencil}
              size={20}
              spring="snappy"
            />
            {isEditMode
              ? t("dashboard.exit_edit") || "Exit Edit"
              : t("dashboard.edit_mode") || "Edit Mode"}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        aria-label="FAB toggle"
        className={`lg-regular lg-glass-interactive [--lg-glass-hover:1.1] flex h-14 w-14 items-center justify-center rounded-full border border-primary/50 text-primary-text [transition:transform_var(--lg-dur-base)_var(--lg-ease-spring),translate_var(--lg-dur-base)_var(--lg-ease-spring),scale_var(--lg-dur-base)_var(--lg-ease-spring),box-shadow_var(--lg-dur-base)_var(--lg-ease-standard)] cursor-pointer hover:scale-110 active:scale-90 ${
          isExpanded ? "rotate-90" : "rotate-0"
        }`}
      >
        <MorphIcon icon={isExpanded ? X : Plus} size={24} spring="snappy" />
      </button>
    </div>,
    document.body,
  );
}

import { useMemo, useState } from "react";
import { GlassButton, GlassCard, GlassInput } from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "./custom-modal";
import { useTranslation } from "react-i18next";
import { getAvailableCards } from "./cards/registry/loader";
import { CardIcon, SearchIcon } from "@/components/icons";
import { ChevronRightIcon } from "@/components/ui/app-icon";
import type { CardTag } from "./cards/registry/types";

interface AddCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (cardType: string) => void;
  existingTypes: string[];
}

export function AddCardModal({
  isOpen,
  onClose,
  onAdd,
  existingTypes,
}: AddCardModalProps) {
  const { t, i18n } = useTranslation();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // Get available cards from registry
  const availableCards = getAvailableCards();

  // Collect all unique tags from available cards
  const allTags = useMemo(() => {
    const map = new Map<string, CardTag>();
    availableCards.forEach((card) => {
      card.tags?.forEach((tag) => {
        if (!map.has(tag.id)) {
          map.set(tag.id, tag);
        }
      });
    });
    return Array.from(map.values());
  }, [availableCards]);

  const getTagLabel = (tag: CardTag) =>
    tag.label[i18n.language] || tag.label.en || tag.id;

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  };

  // Filter cards based on search text, selected tags, and allowMultiple
  const displayCards = useMemo(() => {
    return availableCards.filter((card) => {
      if (card.allowMultiple === false && existingTypes.includes(card.id)) {
        return false;
      }

      if (searchText.trim()) {
        const name =
          (card.name[i18n.language] || card.name.en).toLowerCase();
        if (!name.includes(searchText.trim().toLowerCase())) {
          return false;
        }
      }

      if (selectedTagIds.size > 0) {
        const cardTagIds = new Set(card.tags?.map((t) => t.id) ?? []);
        if (![...selectedTagIds].some((id) => cardTagIds.has(id))) {
          return false;
        }
      }

      return true;
    });
  }, [availableCards, existingTypes, searchText, selectedTagIds, i18n.language]);

  const handleConfirm = () => {
    if (selectedType) {
      onAdd(selectedType);
      setSelectedType(null);
      onClose();
    }
  };

  const handleClose = () => {
    setSelectedType(null);
    setSearchText("");
    setSelectedTagIds(new Set());
    setShowFilters(false);
    onClose();
  };

  return (
    <CustomModal isOpen={isOpen} onClose={handleClose} size="md">
      <CustomModalHeader onClose={handleClose}>
        {t("dashboard.add_card.title") || "Add Card"}
      </CustomModalHeader>
      <CustomModalBody>
        <div className="space-y-3">
          {/* Search box */}
          <GlassInput
            placeholder={t("common.search") || "Search..."}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            size="sm"
            startContent={
              <SearchIcon size={16} className="text-muted pointer-events-none" />
            }
          />

          {/* Filter toggle and tags */}
          {allTags.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-foreground transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95"
              >
                <ChevronRightIcon
                  size={14}
                  className={`transition-transform ${showFilters ? "rotate-90" : ""}`}
                />
                {showFilters
                  ? t("common.hide_filters") || "Hide Filters"
                  : t("common.show_filters") || "Filters"}
                {selectedTagIds.size > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 text-[10px] rounded-full bg-primary text-primary-foreground">
                    {selectedTagIds.size}
                  </span>
                )}
              </button>

              {showFilters && (
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((tag) => {
                    const isActive = selectedTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-all duration-150 cursor-pointer hover:scale-105 active:scale-95 ${
                          isActive
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-default-50 text-muted border-separator hover:border-primary hover:text-primary-text"
                        }`}
                      >
                        {getTagLabel(tag)}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* Card list */}
          {displayCards.length === 0 ? (
            <div className="text-center py-8 text-muted">
              {t("common.no_results_found") || "No results found"}
            </div>
          ) : (
            displayCards.map((card) => {
              const isSelected = selectedType === card.id;

              return (
                <GlassCard
                  key={card.id}
                  isPressable
                  onPress={() => setSelectedType(card.id)}
                  className={`p-4 cursor-pointer transition-all ${
                    isSelected
                      ? "border-[3px] border-primary bg-primary-50 dark:bg-primary-900/40 shadow-md scale-[1.02]"
                      : "hover:border-primary/50 hover:bg-primary-50 dark:hover:bg-primary-900/20 border-2 border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <CardIcon iconKey={card.icon} size={28} className="text-primary-text shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold">
                        {card.name[i18n.language] || card.name.en}
                      </h3>
                      <p className="text-sm text-muted line-clamp-2">
                        {card.description[i18n.language] || card.description.en}
                      </p>
                      {card.tags && card.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {card.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="px-1.5 py-0.5 text-[10px] rounded lg-inset text-muted"
                            >
                              {getTagLabel(tag)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </GlassCard>
              );
            })
          )}
        </div>
      </CustomModalBody>
      <CustomModalFooter>
        <GlassButton variant="secondary" onPress={handleClose}>
          {t("common.cancel") || "Cancel"}
        </GlassButton>
        <GlassButton
          variant="primary"
          isDisabled={!selectedType}
          onPress={handleConfirm}
        >
          {t("common.confirm") || "Confirm"}
        </GlassButton>
      </CustomModalFooter>
    </CustomModal>
  );
}

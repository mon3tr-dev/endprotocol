import { useState } from "react";
import { GlassButton } from "@/components/ui/glass";
import {
  CustomModal,
  CustomModalHeader,
  CustomModalBody,
  CustomModalFooter,
} from "@/components/custom-modal";
import { useTranslation } from "react-i18next";
import type { CharacterListDisplayMode } from "@/types/card-settings";

interface CharacterListSizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (mode: CharacterListDisplayMode) => void;
}

interface SizeOption {
  mode: CharacterListDisplayMode;
  w: number;
  h: number;
  labelKey: string;
  descKey: string;
  preview: React.ReactNode;
}

function ModePreview({ count }: { count: number }) {
  return (
    <div
      className="flex gap-1 h-12"
      style={{ width: `${count * 28 + (count - 1) * 4}px` }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex-1 rounded border border-primary/40 bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center"
        >
          <svg
            className="w-4 h-4 text-primary-text"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </div>
      ))}
    </div>
  );
}

const SIZE_OPTIONS: SizeOption[] = [
  {
    mode: "single",
    w: 2,
    h: 3,
    labelKey: "card:mode_single",
    descKey: "card:mode_single_desc",
    preview: <ModePreview count={1} />,
  },
  {
    mode: "double",
    w: 3,
    h: 3,
    labelKey: "card:mode_double",
    descKey: "card:mode_double_desc",
    preview: <ModePreview count={2} />,
  },
  {
    mode: "triple",
    w: 4,
    h: 3,
    labelKey: "card:mode_triple",
    descKey: "card:mode_triple_desc",
    preview: <ModePreview count={3} />,
  },
];

export function CharacterListSizeModal({
  isOpen,
  onClose,
  onConfirm,
}: CharacterListSizeModalProps) {
  const { t } = useTranslation();
  const [selectedMode, setSelectedMode] = useState<CharacterListDisplayMode | null>(null);

  const handleConfirm = () => {
    if (selectedMode) {
      onConfirm(selectedMode);
      setSelectedMode(null);
    }
  };

  const handleClose = () => {
    setSelectedMode(null);
    onClose();
  };

  return (
    <CustomModal isOpen={isOpen} onClose={handleClose} size="sm">
      <CustomModalHeader onClose={handleClose}>
        {t("card:display_mode") || "Display Mode"}
      </CustomModalHeader>
      <CustomModalBody>
        <div className="space-y-3">
          {SIZE_OPTIONS.map((opt) => {
            const isSelected = selectedMode === opt.mode;
            return (
              <div
                key={opt.mode}
                className={`p-4 rounded-lg cursor-pointer transition-all border-2 ${
                  isSelected
                    ? "border-primary bg-primary-50 dark:bg-primary-900/40 shadow-md"
                    : "border-separator hover:border-primary/50 lg-hoverable-soft"
                }`}
                onClick={() => setSelectedMode(opt.mode)}
              >
                <div className="flex items-center gap-4">
                  <div className="flex items-center justify-center shrink-0">
                    {opt.preview}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">
                      {t(opt.labelKey)}
                    </div>
                    <div className="text-xs text-muted mt-0.5">
                      {t(opt.descKey)}
                    </div>
                    <div className="text-[10px] text-muted/60 mt-0.5">
                      {opt.w}x{opt.h}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CustomModalBody>
      <CustomModalFooter>
        <GlassButton variant="secondary" onPress={handleClose}>
          {t("common.cancel") || "Cancel"}
        </GlassButton>
        <GlassButton
          variant="primary"
          isDisabled={!selectedMode}
          onPress={handleConfirm}
        >
          {t("common.confirm") || "Confirm"}
        </GlassButton>
      </CustomModalFooter>
    </CustomModal>
  );
}

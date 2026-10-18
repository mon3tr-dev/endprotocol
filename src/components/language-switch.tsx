"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { GlassInput } from "@/components/ui/glass";
import { setConfig } from "@/utils/configService";
import { MorphIcon } from "morphicons/react";
import { ChevronDown, Check } from "lucide";

// SVG flag components
const USFlag = () => (
  <svg
    className="w-6 h-4 rounded-sm"
    viewBox="0 0 36 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect width="36" height="24" fill="#B22234" />
    <path
      d="M0 2h36M0 6h36M0 10h36M0 14h36M0 18h36M0 22h36"
      stroke="#fff"
      strokeWidth="2"
    />
    <rect width="16" height="12" fill="#3C3B6E" />
  </svg>
);

const CNFlag = () => (
  <svg
    className="w-6 h-4 rounded-sm"
    viewBox="0 0 36 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect width="36" height="24" fill="#DE2910" />
    <polygon
      points="5,4 6,7 9,7 7,9 8,12 5,10 2,12 3,9 1,7 4,7"
      fill="#FFDE00"
    />
  </svg>
);

export interface LanguageSwitchProps {
  /** 紧凑模式：仅显示语言图标，隐藏文字标签 */
  compact?: boolean;
}

export const LanguageSwitch = ({ compact = false }: LanguageSwitchProps) => {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 220 });

  const languages = [
    { key: "en", label: "English", code: "US", flag: <USFlag /> },
    { key: "zh", label: "中文", code: "CN", flag: <CNFlag /> },
  ];

  const selectedLang =
    languages.find((lang) => lang.key === i18n.language) || languages[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      if (wrapperRef.current?.contains(event.target as Node)) return;
      setIsOpen(false);
    };
    const onScroll = () => setIsOpen(false);
    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [isOpen]);

  const handleLanguageChange = async (langKey: string) => {
    i18n.changeLanguage(langKey);
    await setConfig("app.language", langKey);
    setIsOpen(false);
    setSearchQuery("");
  };

  const filteredLanguages = languages.filter(
    (lang) =>
      lang.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lang.code.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleToggle = () => {
    const next = !isOpen;
    if (next && buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect();
      setDropdownPos({
        top: r.bottom + 4,
        left: r.left,
        width: Math.max(220, r.width),
      });
    }
    setIsOpen(next);
  };

  // 根据实际渲染高度校准位置，避免浮出框溢出或悬在离按钮很远的上方
  useEffect(() => {
    if (!isOpen || !menuRef.current || !buttonRef.current) return;
    const menu = menuRef.current;
    const btn = buttonRef.current.getBoundingClientRect();
    const mh = menu.offsetHeight;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    setDropdownPos((prev) => {
      let top = prev.top;
      if (btn.bottom + 4 + mh > vh) {
        top = Math.max(8, btn.top - mh - 4);
      }
      const left = Math.max(8, Math.min(prev.left, vw - prev.width - 8));
      return { ...prev, top, left };
    });
  }, [isOpen]);

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="flex items-center">
        <button
          ref={buttonRef}
          type="button"
          onClick={handleToggle}
          aria-label="Switch language"
          className={`glass-surface h-9 rounded-full flex items-center transition-all duration-300 ease-in-out hover:scale-105 active:scale-95 text-foreground ${compact ? "px-2 gap-0" : "px-3 gap-2"}`}
        >
          {selectedLang.flag}
          <span
            className={`text-sm font-medium whitespace-nowrap overflow-hidden transition-all duration-300 ease-in-out ${compact ? "max-w-0 opacity-0" : "max-w-[6rem] opacity-100"}`}
          >
            {selectedLang.label}
          </span>
          {!compact && (
            <MorphIcon
              icon={ChevronDown}
              size={16}
              className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          )}
        </button>
      </div>

      {isOpen && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[9999] w-[220px] bg-background glass-surface-strong border border-separator/80 rounded-lg shadow-xl overflow-hidden animate-scale-in"
          style={{ top: dropdownPos.top, left: dropdownPos.left }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b border-separator">
            <GlassInput
              placeholder="Search language..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              size="sm"
            />
          </div>
          <div className="max-h-[200px] overflow-y-auto py-1">
            {filteredLanguages.map((lang) => (
              <button
                key={lang.key}
                className="w-full px-3 py-2 flex items-center gap-3 transition-all duration-150 hover:bg-default-100 hover:translate-x-1 active:translate-x-0.5"
                onClick={() => handleLanguageChange(lang.key)}
              >
                <div className="flex-shrink-0">{lang.flag}</div>
                <div className="flex flex-col flex-1 items-start">
                  <span className="text-sm font-medium text-foreground">{lang.label}</span>
                  <span className="text-xs text-muted">
                    {lang.code}
                  </span>
                </div>
                {i18n.language === lang.key && (
                  <MorphIcon icon={Check} size={16} className="text-success" />
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

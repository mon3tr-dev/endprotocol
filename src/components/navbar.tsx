"use client";

import { useState } from "react";
import { GlassButton, GlassKbd, GlassLink } from "@/components/ui/glass";
import { useTranslation } from "react-i18next";

import { siteConfig } from "@/config/site";
import { ThemeSwitch } from "@/components/theme-switch";
import { LanguageSwitch } from "@/components/language-switch";
import {
  GithubIcon,
  HeartIcon,
  SearchIcon,
} from "@/components/icons";
import { MorphIcon } from "morphicons/react";
import { Menu, X } from "lucide";

export const Navbar = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { t } = useTranslation();

  const searchInput = (
    <div className="lg-field flex h-9 w-56 items-center gap-2 rounded-xl px-3 [transition:box-shadow_var(--lg-dur-fast)_var(--lg-ease-standard)] focus-within:ring-2 focus-within:ring-primary/40">
      <SearchIcon className="text-base text-muted pointer-events-none flex-shrink-0" />
      <input
        type="search"
        placeholder={t('common.search')}
        className="h-full w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted/70 outline-none"
      />
      <GlassKbd className="hidden lg:inline-flex">
        <GlassKbd.Abbr keyValue="command" />
        <GlassKbd.Content>K</GlassKbd.Content>
      </GlassKbd>
    </div>
  );

  return (
    <nav className="lg-regular sticky top-0 z-40 w-full border-b border-separator/60">
      <header className="mx-auto flex h-16 max-w-[1280px] items-center justify-end gap-4 px-6">
        <div className="flex items-center gap-2">
          <GlassLink
            aria-label="Github"
            href={siteConfig.links.github}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GithubIcon className="text-muted" />
          </GlassLink>
          <ThemeSwitch />
          <LanguageSwitch />
          <div className="hidden lg:flex">{searchInput}</div>
          <div className="hidden md:flex">
            <GlassButton
              className="text-sm font-normal"
              variant="tertiary"
              onPress={() => window.open(siteConfig.links.sponsor, "_blank")}
            >
              <HeartIcon className="text-danger-text" />
              {t('common.sponsor')}
            </GlassButton>
          </div>
        </div>

        <div className="flex sm:hidden items-center gap-2">
          <GlassLink
            aria-label="Github"
            href={siteConfig.links.github}
            rel="noopener noreferrer"
            target="_blank"
          >
            <GithubIcon className="text-muted" />
          </GlassLink>
          <ThemeSwitch />
          <LanguageSwitch />
          <button
            aria-expanded={isMenuOpen}
            aria-label="Toggle menu"
            className="p-2"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <MorphIcon icon={isMenuOpen ? X : Menu} size={24} className="h-6 w-6" spring="snappy" />
          </button>
        </div>
      </header>

      {isMenuOpen && (
        <div className="border-t border-separator sm:hidden">
          <div className="p-4">{searchInput}</div>
        </div>
      )}
    </nav>
  );
};

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/cn";
import type { AppMessage } from "@/utils/messageStore";
import { removeMessage, markRead } from "@/utils/messageStore";

type VisualType = "info" | "warn" | "urgent";

const TYPE_STYLES: Record<VisualType, { icon: string; card: string; cardRead: string }> = {
  info: {
    icon: "bg-info/15 text-info-text",
    card: "border-info/15 bg-info/5",
    cardRead: "border-info/10 bg-info/[0.02]",
  },
  warn: {
    icon: "bg-warning/15 text-warning-text",
    card: "border-warning/15 bg-warning/5",
    cardRead: "border-warning/10 bg-warning/[0.02]",
  },
  urgent: {
    icon: "bg-danger/15 text-danger-text",
    card: "border-danger/15 bg-danger/5",
    cardRead: "border-danger/10 bg-danger/[0.02]",
  },
};

function resolveType(raw: string): VisualType {
  if (raw === "warn" || raw === "error") return "warn";
  if (raw === "urgent") return "urgent";
  return "info";
}

function TypeIcon({ type }: { type: string }) {
  const v = resolveType(type);
  const s = TYPE_STYLES[v];
  return (
    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", s.icon)}>
      {v === "info" && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="7" cy="7" r="5.5" />
          <path d="M7 6v4M7 4.5h.01" />
        </svg>
      )}
      {v === "warn" && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 4v3.5M7 9.5h.01" />
          <path d="M1.5 12h11L7.5 2.5 1.5 12z" />
        </svg>
      )}
      {v === "urgent" && (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6.5 3.5l.5-.5 1-.5" />
          <path d="M7 4v4" />
          <path d="M7 10h.01" />
          <path d="M1 12.5h12L7.5 1.5 1 12.5z" fill="currentColor" fillOpacity="0.15" />
          <path d="M1 12.5h12L7.5 1.5 1 12.5z" />
        </svg>
      )}
    </span>
  );
}

function timeAgo(ts: number, t: TFunction): string {
  const diff = Date.now() - ts;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return t("messages.just_now");
  const min = Math.floor(sec / 60);
  if (min < 60) return t("messages.minutes_ago", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("messages.hours_ago", { count: hr });
  const d = Math.floor(hr / 24);
  return t("messages.days_ago", { count: d });
}

export function MessageCard({
  msg,
  compact = false,
  onOpen,
}: {
  msg: AppMessage;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const v = resolveType(msg.type);
  const s = TYPE_STYLES[v];
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [bodyExpanded, setBodyExpanded] = useState(!compact);

  return (
    <div
      className={cn(
        "group flex gap-3 p-3 rounded-xl transition-all duration-200",
        msg.actions ? "cursor-default" : "cursor-pointer",
        compact
          ? "border-0 bg-transparent"
          : cn("border", msg.read ? s.cardRead : cn("ring-1", s.card)),
      )}
      onClick={() => {
        if (onOpen) onOpen();
        else if (!msg.read && !msg.actions) markRead(msg.id);
      }}
    >
      <TypeIcon type={msg.type} />

      <div className="flex-1 min-w-0">
        <p className={cn("text-xs leading-snug", msg.read ? "text-foreground/70" : "text-foreground font-medium")}>
          {msg.title}
        </p>
        {msg.body && bodyExpanded && (
          <p className="text-[11px] text-muted mt-0.5 leading-relaxed whitespace-pre-line">{msg.body}</p>
        )}
        {compact && msg.body && (
          <button
            type="button"
            className="mt-1 text-[10px] text-info-text hover:text-info/80"
            onClick={(e) => {
              e.stopPropagation();
              setBodyExpanded((expanded) => !expanded);
            }}
          >
            {bodyExpanded
              ? t("messages.collapse")
              : t("messages.expand")}
          </button>
        )}
        {typeof msg.progress === "number" && msg.progress === -1 && (
          <div className="mt-1.5 flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" className="animate-spin text-primary-text">
              <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
            </svg>
            <span className="text-[10px] text-primary-text">{t("messages.working")}</span>
          </div>
        )}
        {typeof msg.progress === "number" && msg.progress >= 0 && (
          <div className="mt-1.5">
            <div className="h-1.5 w-full rounded-full bg-primary/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, msg.progress))}%` }}
              />
            </div>
            <p className="text-[10px] text-primary-text mt-0.5">{Math.round(msg.progress)}%</p>
          </div>
        )}
        <p className="text-[10px] text-muted/60 mt-1">{timeAgo(msg.timestamp, t)}</p>

        {msg.actions && msg.actions.length > 0 && (
          <div className="flex gap-2 mt-2">
            {msg.actions.map((action, i) => {
              const isLoading = loadingAction === action.label;
              const btnVariant = action.variant ?? "primary";
              return (
                <button
                  key={i}
                  type="button"
                  disabled={isLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLoadingAction(action.label);
                    Promise.resolve(action.onClick()).finally(() => {
                      setLoadingAction(null);
                    });
                  }}
                  className={cn(
                    "px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all duration-200",
                    "active:scale-95 disabled:opacity-60",
                    btnVariant === "primary" &&
                      "bg-primary text-primary-foreground hover:bg-primary/90",
                    btnVariant === "secondary" &&
                      "bg-default-200 text-foreground hover:bg-default-300",
                    btnVariant === "danger" &&
                      "bg-danger text-white hover:bg-danger/90",
                  )}
                >
                  {isLoading ? (action.loadingLabel ?? t("messages.loading")) : action.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {msg.dismissable !== false && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            removeMessage(msg.id);
          }}
          className="opacity-0 group-hover:opacity-100 shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted/50 hover:text-foreground transition-all"
          aria-label={t("messages.dismiss")}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M2 2l6 6M8 2 2 8" />
          </svg>
        </button>
      )}
    </div>
  );
}

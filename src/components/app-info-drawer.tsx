import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { getMessages, subscribeMessages, markAllRead, markRead } from "@/utils/messageStore";
import { MessageCard } from "@/components/message-card";

interface AppInfoDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AppInfoDrawer({ isOpen, onClose }: AppInfoDrawerProps) {
  const { t } = useTranslation();
  const [msgs, setMsgs] = useState(() => getMessages());
  const unreadCount = msgs.filter((m) => !m.read).length;

  useEffect(() => {
    return subscribeMessages(() => setMsgs(getMessages()));
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const current = getMessages();
    current.forEach((m) => {
      if (!m.read && m.type === "info") markRead(m.id);
    });
  }, [isOpen]);

  const handleBackdropClick = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] [animation:lg-fade-in_var(--lg-dur-base)_var(--lg-ease-emphasized)] bg-black/25"
      onClick={handleBackdropClick}
      style={{ pointerEvents: "auto" }}
    >
      <div
        className="lg-regular lg-float-in fixed inset-y-0 right-0 z-[210] w-[380px] max-w-[85vw] border-l border-separator/60 flex flex-col rounded-l-2xl"
        style={{ pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        {unreadCount > 0 && (
          <div className="flex items-center justify-end px-4 py-2 border-b border-separator/40 shrink-0">
            <button
              type="button"
              onClick={markAllRead}
              className="text-[11px] text-muted hover:text-foreground transition-colors px-2 py-1 rounded-lg lg-hoverable"
            >
              {t("messages.mark_all_read", { defaultValue: "Mark all read" })}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2" data-ovs>
          {msgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted/50 select-none">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" className="mb-3 opacity-40">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <p className="text-xs">{t("messages.empty", { defaultValue: "No messages yet" })}</p>
            </div>
          ) : (
            msgs.map((msg) => <MessageCard key={msg.id} msg={msg} />)
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

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
      className="fixed inset-0 z-[200] [--lg-backdrop-alpha:0.25] [animation:lg-backdrop-in_var(--lg-dur-base)_var(--lg-ease-emphasized)] bg-black/25"
      onClick={handleBackdropClick}
      style={{ pointerEvents: "auto" }}
    >
      {/*
       * 窄屏：右侧抽屉改成**底部抽屉**（占满宽度、贴底）。
       *
       * 原来固定 380px 宽、右侧贴边，在手机上会占掉 2/3 屏宽，
       * 背后的消息列表只剩一条缝；而消息中心是竖向内容，底部抽屉
       * 能给出完整宽度 + 拇指可达的关闭位置。
       * 高度留出顶部安全区，避免被状态栏压住。
       */}
      <div
        className="lg-regular lg-float-in fixed inset-x-0 bottom-0 lg:inset-y-0 lg:left-auto lg:right-0 z-[210] w-full lg:w-[380px] lg:max-w-[85vw] max-h-[85dvh] lg:max-h-none border-t lg:border-t-0 lg:border-l border-separator/60 flex flex-col rounded-t-2xl lg:rounded-l-2xl lg:rounded-tr-none"
        style={{
          pointerEvents: "auto",
          paddingBottom: "var(--safe-area-bottom)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 窄屏：抽屉顶部的抓手 */}
        <span className="mobile-sheet-grip lg:hidden" aria-hidden="true" />

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

        <div className="flex-1 overflow-y-auto scroll-touch px-4 py-3 space-y-2" data-ovs>
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

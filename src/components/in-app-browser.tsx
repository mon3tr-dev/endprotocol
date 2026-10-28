import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { Webview } from "@tauri-apps/api/webview";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import logger from "@/utils/logger";
import { getConfig } from "@/utils/configService";
import { CloseConfirmDialog } from "@/components/close-confirm-dialog";
import {
  MinimizeIcon,
  MaximizeIcon,
  RestoreIcon,
  CloseIcon,
} from "@/components/ui/app-icon";
import { ExternalLinkIcon } from "@/components/icons";
import {
  isBrowserOpen,
  getInAppBrowserUrl,
  closeInAppBrowser,
  subscribeInAppBrowser,
} from "@/stores/inAppBrowser";
import {
  browserGoBack,
  browserGoForward,
  browserReload,
  browserNavigate,
  browserCurrentUrl,
  type BrowserPageLoadPayload,
} from "@/utils/browserViewService";

/** 子 Webview 的 label 前缀，后端 lib.rs 的 on_page_load 按此前缀过滤转发事件 */
const WEBVIEW_LABEL_PREFIX = "inapp-browser-";

/** label 递增序列：保证反复开合 / StrictMode 双挂载时，新实例不与仍在销毁中的旧实例撞 label */
let webviewSeq = 0;

/**
 * 原生层底色：白色。
 *
 * 这是「页面未绘制区域」透出来的颜色，必须跟被加载站点的色调一致，而不是跟应用主题：
 * 多数站点（森空岛、鹰角官网等）不设 body 背景、正文是深色文字，若这里给深色底，
 * 未绘制区就变黑底配深色字，完全不可读。
 * Windows 上 alpha 非 0 时会被强制为 255（wry webview2/mod.rs），所以给不透明值。
 */
const WEBVIEW_BACKGROUND: [number, number, number, number] = [255, 255, 255, 255];

/** 一个原生 Webview 实例及其创建结果（create 是异步的，close 必须排在它之后） */
interface WebviewHandle {
  webview: Webview;
  /** create_webview 的 invoke 落定（成功或失败）后 resolve */
  settled: Promise<void>;
}

export function InAppBrowser() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(isBrowserOpen);
  const [url, setUrl] = useState(getInAppBrowserUrl);
  const [loading, setLoading] = useState(true);

  /** 原生 Webview 模式：占位容器 + 实例引用 */
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<WebviewHandle | null>(null);
  /** 非 Tauri 环境（纯浏览器开发调试）的降级分支 */
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const urlRef = useRef(url);
  urlRef.current = url;

  /* ---------- 窗口控制（覆盖层盖住标题栏后由本组件接管） ---------- */
  const [isMaximized, setIsMaximized] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closeAction, setCloseAction] = useState<string>("ask");

  const checkMaximizedState = useCallback(async () => {
    try {
      setIsMaximized(await getCurrentWindow().isMaximized());
    } catch (error) {
      logger.error("Failed to check maximized state: " + error, "Browser");
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void checkMaximizedState();
    let unlistenResize: (() => void) | undefined;
    let unlistenMove: (() => void) | undefined;
    void listen("tauri://resize", () => void checkMaximizedState()).then(
      (u) => (unlistenResize = u),
    );
    void listen("tauri://move", () => void checkMaximizedState()).then(
      (u) => (unlistenMove = u),
    );
    return () => {
      unlistenResize?.();
      unlistenMove?.();
    };
  }, [checkMaximizedState]);

  useEffect(() => {
    if (!isTauri()) return;
    getConfig<string>("close_action").then((value) => {
      setCloseAction(value ?? "ask");
    });
  }, []);

  const handleWindowMinimize = useCallback(async () => {
    try {
      await invoke("minimize_window");
    } catch (error) {
      logger.error("Failed to minimize window: " + error, "Browser");
    }
  }, []);

  const handleWindowMaximize = useCallback(async () => {
    try {
      await invoke("toggle_maximize_window");
      window.setTimeout(() => void checkMaximizedState(), 100);
    } catch (error) {
      logger.error("Failed to toggle maximize: " + error, "Browser");
    }
  }, [checkMaximizedState]);

  const runCloseAction = useCallback(
    async (action: "close" | "minimize_to_tray") => {
      try {
        if (action === "minimize_to_tray") {
          await invoke("minimize_to_tray");
        } else {
          await invoke("app_quit");
        }
        const newAction = await getConfig<string>("close_action");
        if (newAction) setCloseAction(newAction);
      } catch (error) {
        logger.error("Failed to execute close action: " + error, "Browser");
      }
    },
    [],
  );

  const handleWindowClose = useCallback(async () => {
    try {
      if (closeAction === "ask") {
        setShowCloseConfirm(true);
      } else if (closeAction === "minimize_to_tray") {
        await invoke("minimize_to_tray");
      } else {
        await invoke("app_quit");
      }
    } catch (error) {
      logger.error("Failed to close window: " + error, "Browser");
    }
  }, [closeAction]);

  /* ---------- store 订阅 ---------- */

  /** 就地导航（保留实例与历史），失败则销毁重建 */
  const navigateHandle = useCallback(
    async (handle: WebviewHandle, target: string) => {
      await handle.settled;
      if (handleRef.current !== handle) return;
      const result = await browserNavigate(handle.webview.label, target);
      if (result.ok || handleRef.current !== handle) return;
      logger.warn(
        `[browser] navigate failed, rebuilding webview: ${result.error}`,
      );
      destroyRef.current(handle);
      const next = createRef.current?.(target);
      if (next) handleRef.current = next;
    },
    [],
  );

  useEffect(() => {
    return subscribeInAppBrowser(() => {
      const open = isBrowserOpen();
      const u = getInAppBrowserUrl();
      setIsOpen(open);
      setUrl(u);
      setLoading(true);
      // 浏览器已打开时再次跳转（点另一条公告）：就地导航，不重建生命周期
      if (open && u && u !== urlRef.current && handleRef.current) {
        void navigateHandle(handleRef.current, u);
      }
      urlRef.current = u;
    });
  }, [navigateHandle]);

  /* ============================================================
   * 原生 Webview：占位容器 + 动态创建 / 同步 / 销毁
   * ============================================================ */

  /**
   * 把 Webview 的位置尺寸同步到占位容器。
   *
   * `getBoundingClientRect()` 是相对视口的 CSS 逻辑像素；主窗口是无装饰窗口
   * （`decorations(false)`），视口左上角即窗口客户区左上角，因此可直接作为
   * Webview 相对宿主窗口的逻辑坐标传给 setPosition/setSize。
   */
  const syncBounds = useCallback(async () => {
    const handle = handleRef.current;
    const container = containerRef.current;
    if (!handle || !container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    try {
      await handle.webview.setPosition(
        new LogicalPosition(Math.round(rect.x), Math.round(rect.y)),
      );
      await handle.webview.setSize(
        new LogicalSize(Math.round(rect.width), Math.round(rect.height)),
      );
    } catch (error) {
      logger.warn(`[browser] syncBounds failed: ${String(error)}`);
    }
  }, []);

  /**
   * 创建子 Webview。
   *
   * `new Webview()` 内部只发出 `plugin:webview|create_webview` 就返回，创建结果
   * 通过本地事件 `tauri://created` / `tauri://error` 通知，所以这里把它包装成
   * settled promise，让销毁动作能排在创建之后。
   */
  const createWebview = useCallback(
    (target: string): WebviewHandle | null => {
      const container = containerRef.current;
      if (!container || !target) return null;
      const rect = container.getBoundingClientRect();
      const label = `${WEBVIEW_LABEL_PREFIX}${++webviewSeq}`;

      const webview = new Webview(getCurrentWindow(), label, {
        url: target,
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
        backgroundColor: WEBVIEW_BACKGROUND,
        // 不抢焦点：否则原生层会夺走主窗口焦点，工具栏按钮无法点击
        focus: false,
      });

      const settled = new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        void webview
          .once("tauri://created", () => {
            logger.info(`[browser] webview ${label} created`);
            finish();
            if (handleRef.current?.webview === webview) void syncBounds();
          })
          .catch(finish);
        void webview
          .once("tauri://error", (event) => {
            logger.error(`[browser] webview ${label} create failed`, event?.payload);
            finish();
            if (handleRef.current?.webview === webview) setLoading(false);
          })
          .catch(finish);
      });

      return { webview, settled };
    },
    [syncBounds],
  );

  /**
   * 销毁实例。原生层不会随 React 卸载消失，必须显式 close()。
   *
   * 等 settled 落定再 close：否则创建还没完成时 close 会因 label 不存在而失败，
   * 创建随后成功就留下一个没人管的原生 webview（StrictMode 双挂载必踩）。
   *
   * @param handle 要销毁的实例；省略则销毁当前实例。传入时只在它仍是当前实例时
   *   才摘除引用，避免异步竞态下误关后来创建的新实例。
   */
  const destroyWebview = useCallback((handle?: WebviewHandle) => {
    const target = handle ?? handleRef.current;
    if (!target) return;
    if (handleRef.current === target) handleRef.current = null;
    void target.settled.then(async () => {
      try {
        await target.webview.close();
      } catch (error) {
        logger.warn(
          `[browser] close ${target.webview.label} failed: ${String(error)}`,
        );
      }
    });
  }, []);

  // navigateHandle 是稳定回调但引用 create/destroy，用 ref 打破循环依赖
  const createRef = useRef(createWebview);
  createRef.current = createWebview;
  const destroyRef = useRef(destroyWebview);
  destroyRef.current = destroyWebview;

  // 生命周期：isOpen 转 false（关闭或挂起）即销毁；转 true 则以当前 URL 创建。
  useEffect(() => {
    if (!isOpen || !isTauri()) return;

    const handle = createWebview(urlRef.current);
    if (!handle) return;
    handleRef.current = handle;

    const container = containerRef.current;
    const observer = container
      ? new ResizeObserver(() => void syncBounds())
      : null;
    observer?.observe(container!);
    // DPI 变化（拖到不同缩放率的显示器）时 ResizeObserver 不一定触发，resize 兜底
    const onWindowResize = () => void syncBounds();
    window.addEventListener("resize", onWindowResize);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      destroyWebview();
    };
  }, [isOpen, createWebview, destroyWebview, syncBounds]);

  // loading / 地址显示：后端 on_page_load 桥接出来的 browser://page-load 事件。
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void listen<BrowserPageLoadPayload>("browser://page-load", (event) => {
      const payload = event.payload;
      const handle = handleRef.current;
      if (!payload || !handle || payload.label !== handle.webview.label) return;
      if (payload.event === "started") {
        setLoading(true);
        return;
      }
      setLoading(false);
      // 页面内跳转 / 重定向同步到地址显示（只读，不触发再导航）
      if (payload.url) {
        urlRef.current = payload.url;
        setUrl(payload.url);
      }
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  /**
   * 地址栏点击时回读一次真实地址。
   *
   * on_page_load 只在顶层导航触发，SPA 用 history.pushState 换页不会有事件，
   * 地址显示就会停留在旧地址；点击时主动 pull 一次补上这个盲区。
   */
  const syncUrlFromWebview = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle || !isTauri()) return;
    await handle.settled;
    const actual = await browserCurrentUrl(handle.webview.label);
    if (!actual) return;
    urlRef.current = actual;
    setUrl(actual);
  }, []);

  /* ---------- 工具栏动作 ---------- */

  const handleBack = useCallback(async () => {
    const handle = handleRef.current;
    if (handle) {
      await handle.settled;
      await browserGoBack(handle.webview.label);
      return;
    }
    try {
      iframeRef.current?.contentWindow?.history.back();
    } catch {
      // cross-origin
    }
  }, []);

  const handleForward = useCallback(async () => {
    const handle = handleRef.current;
    if (handle) {
      await handle.settled;
      await browserGoForward(handle.webview.label);
      return;
    }
    try {
      iframeRef.current?.contentWindow?.history.forward();
    } catch {
      // cross-origin
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    const handle = handleRef.current;
    if (handle) {
      setLoading(true);
      await handle.settled;
      const result = await browserReload(handle.webview.label);
      // reload 不可用时兜底：就地重新导航
      if (!result.ok) {
        await browserNavigate(handle.webview.label, urlRef.current);
      }
      return;
    }
    if (iframeRef.current) {
      setLoading(true);
      iframeRef.current.src = url;
    }
  }, [url]);

  /** 用系统默认浏览器打开当前地址 */
  const handleOpenExternal = useCallback(async () => {
    if (!url) return;
    try {
      if (isTauri()) {
        await openUrl(url);
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      logger.error(`[browser] open external failed: ${String(error)}`);
    }
  }, [url]);

  const handleClose = useCallback(() => {
    closeInAppBrowser();
  }, []);

  if (!isOpen) return null;

  const noDrag = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

  return (
    <div className="absolute inset-0 z-40 flex flex-col">
      {/*
       * 玻璃工具栏：整条覆盖标题栏高度（h-11），空白区即窗口拖拽区。
       * 布局保持在 Webview 区域之外，避免被原生层覆盖。
       */}
      <div
        className="h-11 flex items-center gap-1.5 pl-3 pr-2 shrink-0 bg-background/60 backdrop-blur-xl border-b border-white/10"
      >
        {/* Back */}
        <button
          type="button"
          onClick={handleBack}
          style={noDrag}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer"
          title={t("browser.back", "Back")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        {/* Forward */}
        <button
          type="button"
          onClick={handleForward}
          style={noDrag}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer"
          title={t("browser.forward", "Forward")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Refresh */}
        <button
          type="button"
          onClick={handleRefresh}
          style={noDrag}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer"
          title={t("browser.refresh", "Refresh")}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        {/* Open in external browser */}
        <button
          type="button"
          onClick={handleOpenExternal}
          style={noDrag}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-white/10 transition-colors cursor-pointer"
          title={t("browser.open_in_browser", "Open in Browser")}
        >
          <ExternalLinkIcon size={14} />
        </button>

        {/* 地址显示：只读，点击回读真实地址 */}
        <div
          className="flex-1 flex items-center h-7 px-2.5 rounded-lg bg-white/5 border border-white/10 min-w-0"
          style={noDrag}
        >
          <svg className="w-3 h-3 text-muted shrink-0 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
          </svg>
          <input
            type="text"
            value={url}
            readOnly
            onClick={() => void syncUrlFromWebview()}
            title={url}
            className="flex-1 min-w-0 bg-transparent text-xs text-foreground outline-none cursor-default select-all"
          />
        </div>

        {/* Close browser */}
        <button
          type="button"
          onClick={handleClose}
          style={noDrag}
          className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-danger hover:bg-danger/10 transition-colors cursor-pointer mr-1"
          title={t("browser.close", "Close Browser")}
        >
          <CloseIcon size={14} />
        </button>

        {/* 窗口控制（接管被覆盖的标题栏） */}
        {isTauri() && (
          <div
            className="flex items-center rounded-xl overflow-hidden glass-surface border border-separator/60"
            style={noDrag}
          >
            <button
              type="button"
              onClick={handleWindowMinimize}
              aria-label={t("browser.minimize", "Minimize")}
              style={noDrag}
              className="flex h-7 w-8 items-center justify-center rounded-l-xl text-muted transition-all duration-200 hover:bg-white/10 hover:text-foreground hover:scale-105 active:scale-95 cursor-pointer"
            >
              <MinimizeIcon size={14} />
            </button>
            <button
              type="button"
              onClick={handleWindowMaximize}
              aria-label={isMaximized ? t("browser.restore", "Restore") : t("browser.maximize", "Maximize")}
              style={noDrag}
              className="flex h-7 w-8 items-center justify-center text-muted transition-all duration-200 hover:bg-white/10 hover:text-foreground hover:scale-105 active:scale-95 cursor-pointer"
            >
              {isMaximized ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
            </button>
            <button
              type="button"
              onClick={handleWindowClose}
              aria-label={t("browser.quit_window", "Close Window")}
              style={noDrag}
              className="flex h-7 w-8 items-center justify-center rounded-r-xl text-muted transition-all duration-200 hover:bg-danger/20 hover:text-danger hover:scale-105 active:scale-95 cursor-pointer"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Loading bar */}
      {loading && (
        <div className="h-0.5 bg-primary/20 shrink-0 overflow-hidden">
          <div className="h-full bg-primary animate-pulse w-full" />
        </div>
      )}

      {/*
       * Webview 占位容器：Tauri 下由原生子 Webview 精确覆盖这块矩形；
       * 非 Tauri（纯浏览器 `npm run dev`）下渲染 iframe 降级，保证开发页面可跑。
       */}
      <div ref={containerRef} className="flex-1 w-full relative bg-white">
        {!isTauri() && (
          <iframe
            ref={iframeRef}
            src={url}
            className="absolute inset-0 w-full h-full border-none bg-white"
            onLoad={() => setLoading(false)}
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads"
            title="In-app browser"
          />
        )}
      </div>

      <CloseConfirmDialog
        isOpen={showCloseConfirm}
        onOpenChange={setShowCloseConfirm}
        onConfirm={runCloseAction}
      />
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {
  Activity,
  Code,
  Gamepad2,
  Globe,
  Info,
  ListChecks,
  Palette,
  SlidersHorizontal,
  Search,
} from "lucide";
import { createMorphIcon } from "@/components/morph-icon";
import { GlassInput } from "@/components/ui/glass";
import { CloseIcon } from "@/components/ui/app-icon";

/**
 * 设置页的「分区 / 设置项」索引与导航。
 *
 * ## 为什么需要这一层
 *
 * 设置页原本是 8 张卡片顺序铺下来的长列表（通用 / 网络 / 游戏启动 / 外观 /
 * 系统资源 / 待办 / 开发者 / 关于），手机上要滑好几屏才能找到某一项。这里
 * 把每张卡片（`anchor`）与卡片里的每一行（`item.id`，即 DOM 上已有的
 * `#settings-*` 锚点）登记成一份索引，供两种导航共用：
 *
 * - **桌面（lg+）**：左侧吸附的竖向分区栏，命中分区时展开该项下的设置行；
 * - **手机 / Android**：顶部吸附的搜索框 + 横向分区胶囊，随时可跳。
 *
 * 两边共用同一份索引与同一套搜索匹配逻辑，不会各自漂移。
 */

const GeneralIcon = createMorphIcon(SlidersHorizontal);
const NetworkIcon = createMorphIcon(Globe);
const LauncherIcon = createMorphIcon(Gamepad2);
const AppearanceIcon = createMorphIcon(Palette);
const SystemResourceIcon = createMorphIcon(Activity);
const TodoIcon = createMorphIcon(ListChecks);
const DeveloperIcon = createMorphIcon(Code);
const AboutIcon = createMorphIcon(Info);
const SearchIcon = createMorphIcon(Search);

type NavIcon = typeof GeneralIcon;

/** 一条设置项：`id` 必须与页面上真实存在的 DOM 锚点一致。 */
export interface SettingsItem {
  /** DOM 锚点 id（`#settings-...`） */
  id: string;
  /** 标签的 i18n key（复用设置行自身的文案） */
  labelKey: string;
  /** 额外的搜索关键词：英文 / 技术词 / 同义词，便于「proxy」「下载」这类检索 */
  keywords?: string[];
}

/** 一张设置卡片（分区）。 */
export interface SettingsSection {
  id: string;
  /** 卡片本身的 DOM 锚点 id */
  anchor: string;
  labelKey: string;
  icon: NavIcon;
  items: SettingsItem[];
}

/** 平台门控：标题栏 / 关闭行为仅桌面、游戏启动仅 Windows、更新入口 iOS 无。 */
export interface SettingsSectionFlags {
  supportsLauncher: boolean;
  supportsTray: boolean;
  supportsUpdateChecks: boolean;
}

/**
 * 按平台能力生成分区索引。
 *
 * 与页面上真实渲染的卡片严格对应：`supportsLauncher` 为假时不登记
 * 「游戏启动」；`supportsTray` 为假时不登记「关闭窗口时 / 托盘显示用户」
 * （这两行在移动端整段 `{supportsTray && ...}` 隐藏，登记进来会跳到空处）。
 */
export function buildSettingsSections({
  supportsLauncher,
  supportsTray,
  supportsUpdateChecks,
}: SettingsSectionFlags): SettingsSection[] {
  const sections: SettingsSection[] = [
    {
      id: "general",
      anchor: "settings-general",
      labelKey: "settings.general.title",
      icon: GeneralIcon,
      items: [
        {
          id: "settings-language",
          labelKey: "settings.general.language",
          keywords: ["language", "语言", "english", "chinese", "中文", "i18n"],
        },
        {
          id: "settings-refresh-on-switch",
          labelKey: "settings.general.refresh_on_switch",
          keywords: ["refresh", "刷新", "switch", "账户", "account", "api"],
        },
        {
          id: "settings-lazy-load",
          labelKey: "settings.general.lazy_load",
          keywords: ["lazy", "懒加载", "内存", "memory", "performance", "性能"],
        },
        {
          id: "settings-wiki-detail-preload",
          labelKey: "settings.general.wiki_detail_preload",
          keywords: ["wiki", "预加载", "preload", "启动", "startup", "角色"],
        },
        ...(supportsTray
          ? [
              {
                id: "settings-close-action",
                labelKey: "settings.general.close_action",
                keywords: ["close", "关闭", "托盘", "tray", "窗口", "window"],
              },
              {
                id: "settings-tray-user",
                labelKey: "settings.general.tray_user",
                keywords: ["tray", "托盘", "用户", "user", "角色"],
              },
            ]
          : []),
      ],
    },
    {
      id: "network",
      anchor: "settings-network",
      labelKey: "settings.network.title",
      icon: NetworkIcon,
      items: [
        {
          id: "settings-proxy-enable",
          labelKey: "settings.general.proxy_enable",
          keywords: ["proxy", "代理", "vpn", "网络", "network", "开关"],
        },
        {
          id: "settings-proxy-protocol",
          labelKey: "settings.general.proxy_protocol",
          keywords: ["http", "socks5", "协议", "protocol"],
        },
        {
          id: "settings-proxy-host",
          labelKey: "settings.general.proxy_host",
          keywords: ["host", "port", "主机", "端口", "地址", "address"],
        },
        {
          id: "settings-proxy-exclude",
          labelKey: "settings.general.proxy_exclude",
          keywords: ["exclude", "排除", "直连", "bypass"],
        },
        {
          id: "settings-proxy-auth",
          labelKey: "settings.general.proxy_auth",
          keywords: ["auth", "认证", "用户名", "密码", "password", "username"],
        },
        {
          id: "settings-proxy-remote-dns",
          labelKey: "settings.general.proxy_remote_dns",
          keywords: ["dns", "socks5h", "解析", "污染"],
        },
        {
          id: "settings-proxy-import-system",
          labelKey: "settings.general.proxy_import_system",
          keywords: ["system", "系统", "导入", "import", "读取", "pac"],
        },
      ],
    },
    ...(supportsLauncher
      ? [
          {
            id: "game-launch",
            anchor: "settings-game-launch",
            labelKey: "settings.game_launch.title",
            icon: LauncherIcon,
            items: [
              {
                id: "settings-cancel-behavior",
                labelKey: "launcher.cancel_download_behavior",
                keywords: ["cancel", "取消", "下载", "download"],
              },
              {
                id: "settings-dx11",
                labelKey: "settings.game_launch.dx11",
                keywords: ["dx11", "dx12", "启动", "launch", "显卡"],
              },
              {
                id: "settings-download-threads",
                labelKey: "settings.game_launch.download_threads",
                keywords: ["thread", "线程", "下载", "download", "速度"],
              },
              {
                id: "settings-download-resume",
                labelKey: "settings.game_launch.download_resume",
                keywords: ["resume", "断点", "续传", "下载", "download"],
              },
              {
                id: "settings-verify-threads",
                labelKey: "settings.game_launch.verify_threads",
                keywords: ["verify", "校验", "线程", "thread"],
              },
              {
                id: "settings-bg-media",
                labelKey: "settings.game_launch.bg_media",
                keywords: ["background", "背景", "视频", "video", "图片", "image"],
              },
              {
                id: "settings-silent-launch",
                labelKey: "settings.game_launch.silent_launch_title",
                keywords: ["silent", "静默", "启动", "命令", "command", "steam"],
              },
            ],
          },
        ]
      : []),
    {
      id: "appearance",
      anchor: "settings-appearance",
      labelKey: "settings.appearance.title",
      icon: AppearanceIcon,
      items: [
        {
          id: "settings-theme-mode",
          labelKey: "settings.appearance.theme_mode",
          keywords: ["theme", "主题", "模式", "dark", "light", "深色", "浅色", "夜间"],
        },
        {
          id: "settings-theme-color",
          labelKey: "settings.appearance.theme_color",
          keywords: ["color", "颜色", "配色", "accent", "色板"],
        },
        {
          id: "settings-background-image",
          labelKey: "settings.appearance.bg_image",
          keywords: ["background", "背景", "壁纸", "wallpaper", "模糊", "blur", "透明度"],
        },
      ],
    },
    {
      id: "system-resource",
      anchor: "settings-system-resource",
      labelKey: "settings.system_resource.title",
      icon: SystemResourceIcon,
      items: [
        {
          id: "settings-sys-refresh",
          labelKey: "settings.system_resource.refresh",
          keywords: ["refresh", "刷新", "频率", "interval"],
        },
        {
          id: "settings-sys-unit",
          labelKey: "settings.system_resource.unit",
          keywords: ["unit", "单位", "字节", "byte", "bit"],
        },
        {
          id: "settings-sys-rotate",
          labelKey: "settings.system_resource.rotate",
          keywords: ["rotate", "翻页", "轮播", "切换"],
        },
        {
          id: "settings-sys-precision",
          labelKey: "settings.system_resource.precision",
          keywords: ["precision", "精度", "小数"],
        },
        {
          id: "settings-sys-thresholds",
          labelKey: "settings.system_resource.thresholds",
          keywords: ["threshold", "阈值", "告警", "alert", "温度"],
        },
        {
          id: "settings-sys-sparklines",
          labelKey: "settings.system_resource.sparklines",
          keywords: ["sparkline", "曲线", "历史", "history", "图表"],
        },
        {
          id: "settings-sys-accent",
          labelKey: "settings.system_resource.accent",
          keywords: ["accent", "主题色", "颜色", "color"],
        },
        {
          id: "settings-sys-template",
          labelKey: "settings.system_resource.template",
          keywords: ["template", "模板", "指标", "metric", "卡片组"],
        },
      ],
    },
    {
      id: "todo",
      anchor: "settings-todo",
      labelKey: "settings.todo.title",
      icon: TodoIcon,
      items: [
        {
          id: "settings-todo-sort",
          labelKey: "settings.todo.sort_mode",
          keywords: ["sort", "排序", "待办", "todo"],
        },
        {
          id: "settings-todo-hide-completed",
          labelKey: "settings.todo.hide_completed",
          keywords: ["hide", "隐藏", "已完成", "completed"],
        },
        {
          id: "settings-todo-priority",
          labelKey: "settings.todo.priority",
          keywords: ["priority", "优先级"],
        },
        {
          id: "settings-todo-due",
          labelKey: "settings.todo.due",
          keywords: ["due", "截止", "日期", "deadline"],
        },
        {
          id: "settings-todo-color",
          labelKey: "settings.todo.color",
          keywords: ["color", "颜色"],
        },
        {
          id: "settings-todo-icon",
          labelKey: "settings.todo.icon",
          keywords: ["icon", "图标"],
        },
      ],
    },
    {
      id: "developer",
      anchor: "settings-developer",
      labelKey: "settings.developer.title",
      icon: DeveloperIcon,
      items: [
        {
          id: "settings-developer-enable",
          labelKey: "settings.developer.enable",
          keywords: ["developer", "开发者", "调试", "debug"],
        },
      ],
    },
    {
      id: "about",
      anchor: "settings-about",
      labelKey: "settings.update.about_section",
      icon: AboutIcon,
      items: [
        ...(supportsUpdateChecks
          ? [
              {
                id: "settings-update-channel",
                labelKey: "settings.update_channel.title",
                keywords: ["channel", "通道", "测试版", "preview", "stable", "更新"],
              },
              {
                id: "settings-update-source",
                labelKey: "settings.update_source.title",
                keywords: ["source", "源", "github", "镜像", "mirror", "更新"],
              },
            ]
          : []),
        {
          id: "settings-update-versions",
          labelKey: "settings.update.app_version",
          keywords: ["version", "版本", "tauri", "平台", "platform"],
        },
        {
          id: "settings-license",
          labelKey: "settings.update.license",
          keywords: ["license", "许可", "agpl", "开源"],
        },
        {
          id: "settings-credits",
          labelKey: "settings.update.open_source_credits",
          keywords: ["credits", "致谢", "鸣谢", "open source", "开源"],
        },
      ],
    },
  ];

  return sections;
}

/** 命中一条设置项（携带它所属分区，用于显示「分区 · 设置项」）。 */
export interface SettingsSearchHit {
  section: SettingsSection;
  item: SettingsItem;
}

/**
 * 找到某个元素**真正**的滚动祖先。
 *
 * 不能写死 `closest("main")`：宽屏下设置页是「标题固定 + 右侧列内部滚动」，
 * 真正的滚动容器是右侧那一列 `<div>`，而 `<main>` 自己已经没有滚动余量了。
 * 用它算「当前分区」会把所有分区的顶边都当成相对 `<main>` 顶端，滚到底时
 * 每个分区都满足条件、高亮永远停在最后一个。
 *
 * 从元素向上逐层看 `overflow-y` 计算值：`auto`/`scroll` 且**确实可滚**
 * （`scrollHeight > clientHeight`）才算数。后一条很重要 —— 内容不足时
 * 容器虽然声明了 `overflow-y: auto`，但滚不动，不能作为滚动基准。
 */
function findScrollContainer(from: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = from.parentElement;
  while (el && el !== document.body) {
    const oy = getComputedStyle(el).overflowY;
    if (
      (oy === "auto" || oy === "scroll") &&
      el.scrollHeight > el.clientHeight + 1
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}


/**
 * 归一化检索文本：转小写并压掉空白与常见分隔符。
 *
 * 这样「下载 线程」「download-threads」「DownloadThreads」三种写法都能命中
 * 同一个 `keywords` 词条 —— 手机上打字常带空格或直接连写。
 */
function normalize(value: string) {
  return value.toLowerCase().replace(/[\s\-_/·]+/g, "");
}

/**
 * 在索引里搜索设置项。
 *
 * 只返回**设置项**级别的命中（分区标签也参与匹配）：命中分区标签时该分区下
 * 的设置项会一并命中（例如搜「外观」会列出主题模式 / 主题色 / 背景图片），
 * 因为用户想找的通常是分区里的某一项，而不是分区卡片本身。
 */
export function searchSettings(
  sections: SettingsSection[],
  query: string,
  translate: (key: string) => string,
): SettingsSearchHit[] {
  const needle = normalize(query);
  if (!needle) return [];

  const hits: SettingsSearchHit[] = [];
  for (const section of sections) {
    const sectionMatches = normalize(translate(section.labelKey)).includes(needle);
    for (const item of section.items) {
      const haystack = normalize(
        [
          sectionMatches ? "" : translate(section.labelKey),
          translate(item.labelKey),
          ...(item.keywords ?? []),
        ].join(" "),
      );
      if (sectionMatches || haystack.includes(needle)) {
        hits.push({ section, item });
      }
    }
  }
  return hits;
}

/**
 * 平滑滚动到某个锚点并短暂高亮它。
 *
 * 高亮由 CSS 类完成（`settings-anchor-flash`，见 globals.css）：直接操作
 * classList 而不是让 React 重渲染 —— 锚点分散在 5 个子组件里，加 state
 * 就得把「当前高亮项」透传下去，收益远小于这一行。
 */
export function jumpToSettingAnchor(anchorId: string) {
  const el = document.getElementById(anchorId);
  if (!el) return;

  // 先立刻高亮、再滚动：`scrollIntoView({behavior:"smooth"})` 在长距离滚动时
  // 要几百毫秒，高亮若等滚动结束才加，用户会先看到「什么都没发生」。
  el.classList.remove("settings-anchor-flash");
  // 强制重排：连续点同一项时动画要能重新播放
  void el.offsetWidth;
  el.classList.add("settings-anchor-flash");
  window.setTimeout(() => el.classList.remove("settings-anchor-flash"), 1500);

  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * 跟踪当前滚动到的分区。
 *
 * 用 rAF 节流的 scroll 监听而不是 IntersectionObserver：设置分区高度差异极大
 * （「关于」可能有三屏高，而「开发者」只有一行），IO 的可见比例算出来的
 * 「当前分区」会在长分区里跳来跳去。这里按「最后一条顶边越过阈值的分区」
 * 判定，滚动过程中高亮只会顺序前进/后退。
 *
 * `scroll` 事件不冒泡，但捕获阶段能拿到内部滚动容器（`<main overflow-y-auto>`）
 * 的事件 —— 与设置页原本关闭语言下拉的写法一致。
 *
 * `navRef` 只由**窄屏吸附条**传入：它是复在内容上方的一条实底栏，判定阈值
 * 必须让开它的高度，否则分区标题被压在栏下时就已经算「到达」。宽屏的分区栏
 * 在左侧、不遮挡内容列，不传即可（阈值退化为 `<main>` 顶边 + 16px）。
 * 窄屏条在宽屏下是 `display:none`，`offsetHeight` 自然为 0，不需要额外判断。
 */
export function useActiveSettingsSection(anchorIds: string[]): {
  active: string;
  navRef: React.RefObject<HTMLDivElement | null>;
} {
  const [active, setActive] = useState(anchorIds[0] ?? "");
  const navRef = useRef<HTMLDivElement>(null);
  const key = anchorIds.join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return;

    let raf = 0;

    const compute = () => {
      raf = 0;
      const first = document.getElementById(ids[0]);
      const scroller = first ? findScrollContainer(first) : null;
      // 分区标题「刚好滑到吸附条下方」时算到达：偏移量取实测的滚动容器顶边
      // 加上吸附条高度（窄屏 104px，宽屏吸附条在侧栏、内容列不受遮挡 → 0）。
      // 用实测值而不是写死常量，是因为窄屏那条在搜索有内容时会长高。
      const scrollerTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const navHeight = navRef.current?.offsetHeight ?? 0;
      const threshold = scrollerTop + navHeight + 16;

      let next = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= threshold) next = id;
      }

      // 滚到底：最后一个分区再矮也要选中它，否则底部会出现「高亮停在上一项」
      if (scroller) {
        const rest =
          scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        if (rest < 8) next = ids[ids.length - 1];
      }

      setActive((prev) => (prev === next ? prev : next));
    };

    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [key]);

  return { active, navRef };
}

/**
 * 搜索框。
 *
 * 用 `type="text"` + `enterKeyHint="search"` 而不是 `type="search"`：
 * Android WebView 会给 `type=search` 再画一个原生清除按钮，和这里的
 * 清除按钮叠在一起（两个 ×）。`autoCorrect/autoCapitalize` 关掉，
 * 避免手机输入法把设置名首字母自动大写后匹配不上。
 */
function SettingsSearchField({
  value,
  onChange,
  size = "md",
}: {
  value: string;
  onChange: (value: string) => void;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();

  return (
    <div className="relative" data-settings-search>
      <GlassInput
        size={size}
        type="text"
        value={value}
        placeholder={t("settings.nav.search_placeholder")}
        aria-label={t("settings.nav.search_placeholder")}
        startContent={<SearchIcon size={15} />}
        endContent={null}
        className="pr-10"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="search"
        onValueChange={onChange}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("settings.nav.clear")}
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted active:bg-foreground/10"
        >
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  );
}

/** 搜索结果列表（桌面侧栏与手机吸附条共用）。 */
function SettingsSearchResults({
  hits,
  onJump,
  className,
}: {
  hits: SettingsSearchHit[];
  onJump: (itemId: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  if (hits.length === 0) {
    return (
      <p className={clsx("px-3 py-6 text-center text-sm text-muted", className)}>
        {t("settings.nav.no_results")}
      </p>
    );
  }

  return (
    <ul className={clsx("space-y-0.5", className)}>
      {hits.map(({ section, item }) => {
        const Icon = section.icon;
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onJump(item.id)}
              /*
               * 手机上一行至少 44px 高（HIG / WCAG 2.5.8）：搜索结果是密集列表，
               * 若按桌面 32px 排，滑到目标那一下很容易点到相邻项。
               */
              className="flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors active:bg-foreground/10 sm:min-h-9 lg-hoverable"
            >
              <Icon size={15} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">
                  {t(item.labelKey)}
                </span>
                <span className="block truncate text-[11px] text-muted">
                  {t(section.labelKey)}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 桌面（lg+）左侧吸附分区栏。 */
export function SettingsSideNav({
  sections,
  activeAnchor,
  query,
  onQueryChange,
  onJumpItem,
  onJumpSection,
}: {
  sections: SettingsSection[];
  activeAnchor: string;
  query: string;
  onQueryChange: (value: string) => void;
  onJumpItem: (itemId: string) => void;
  onJumpSection: (sectionAnchor: string) => void;
}) {
  const { t } = useTranslation();
  const hits = useMemo(
    () => searchSettings(sections, query, t),
    [sections, query, t],
  );
  const activeSection = sections.find((s) => s.anchor === activeAnchor);

  return (
    /*
     * 宽屏下左栏**整体静止**（不参与滚动）。
     *
     * 之前用 `sticky` 让它跟着页面滚时吸附，但设置页现在是「标题固定 +
     * 只有右侧列滚动」的满高布局：滚动容器是右侧那一列，左栏根本不在它的
     * 滚动流里，`sticky` 既无意义又会让样式意图含糊。这里改成普通块级，
     * 高度由网格行（stretch）决定，配合 `h-full` 让面板吃满。
     */
    /*
     * `lg:flex-1 lg:min-h-0`：宽屏下本组件被包在一个 `lg:flex lg:flex-col`
     * 的网格项里（见 settings.tsx 的左栏容器），必须是 flex 子项才能拿到
     * 确定高度，内部那个 `h-full` 才解析得出来。
     */
    <aside className="hidden lg:block lg:min-h-0 lg:flex-1">
      {/*
       * 竖向 flex，`h-full` 取满可用高度。
       *
       * `min(620px, calc(100dvh - 8rem))` 是**上限**：列很高时面板不至于被
       * 拉到贴窗口底边（底部始终留一段间隙）；列变矮时它跟着收。
       * 搜索框与底部提示 `shrink-0`、导航 `min-h-0 flex-1`：内容超出由导航
       * 内部滚动消化，面板高度不变。
       */}
      <div className="flex h-full max-h-[min(620px,calc(100dvh-8rem))] flex-col gap-2.5">
        <div className="shrink-0">
          <SettingsSearchField value={query} onChange={onQueryChange} />
        </div>

        {/*
         * 玻璃宿主与滚动容器**必须分层**，且 nav 是 flex 列。
         *
         * ① 材质层：`.lg-material` 的 `::before` 是 `position:absolute; inset:0`，
         *    相对宿主定位、**不随内容滚动**。若把 `lg-material` 与
         *    `overflow-y-auto` 写在同一个元素上，滚动时材质留在原地而内容滚走，
         *    露出宿主自身的透明底（之前那道竖着的断层）。外层只负责玻璃/圆角/
         *    裁切，内层负责滚动，材质才始终铺满可见区域。
         *
         * ② 高度链：内层滚动容器用 `min-h-0 flex-1` 而非 `h-full`。
         *    `height:100%` 要求父级有**确定高度**，而 nav 的高度来自 flex 分配，
         *    百分比在个别 WebView 上会解析成 auto —— 内层跟着内容长高，
         *    `overflow-y` 就永远不触发滚动。
         *
         * ③ 滚动条：内层标 `data-no-ovs`。`@/utils/overlayScrollbar` 会给每个
         *    `overflow-y:auto` 的元素自动打 `data-ovs`，而
         *    `[data-ovs]::-webkit-scrollbar { width:8px }` 会把全局隐藏的滚动条
         *    恢复出来。这里不需要可见的条：溢出能滚，但看不到条。
         */}
        <nav
          aria-label={t("settings.nav.sections")}
          className="lg-material flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-separator/70"
        >
          {/*
           * `data-no-ovs` 必须落在**真正的滚动容器**上：`overlayScrollbar`
           * 是逐个元素扫描 `overflow-y` 的，标在只负责玻璃的外层 `<nav>`
           * 上不起作用（外层是 `overflow-hidden`，本来就不会被接管）。
           */}
          <div
            data-no-ovs
            className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scroll-touch p-1.5"
          >
            {query ? (
              <SettingsSearchResults hits={hits} onJump={onJumpItem} />
            ) : (
              <ul className="space-y-0.5">
                {sections.map((section) => {
                  const Icon = section.icon;
                  const active = section.anchor === activeAnchor;
                  return (
                    <li key={section.id}>
                      <button
                        type="button"
                        onClick={() => onJumpSection(section.anchor)}
                        aria-current={active ? "true" : undefined}
                        className={clsx(
                          "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition-colors",
                          active
                            ? "bg-primary/10 font-medium text-primary-text"
                            : "text-muted lg-hoverable hover:text-foreground",
                        )}
                      >
                        <Icon size={16} className="shrink-0" />
                        <span className="truncate">{t(section.labelKey)}</span>
                      </button>

                      {/* 当前分区展开成员：既有「我在哪」的定位感，也能一跳到底 */}
                      {active && section.items.length > 1 && (
                        <ul className="mb-1 ml-4 mt-0.5 space-y-0.5 border-l border-separator/60 pl-1.5">
                          {section.items.map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => onJumpItem(item.id)}
                                className="block w-full truncate rounded-lg px-2 py-1.5 text-left text-xs text-muted lg-hoverable hover:text-foreground"
                              >
                                {t(item.labelKey)}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </nav>

        {!query && activeSection && (
          <p className="shrink-0 px-1 text-[11px] leading-relaxed text-muted/70">
            {t("settings.nav.search_hint")}
          </p>
        )}
      </div>
    </aside>
  );
}

/**
 * 手机 / Android 顶部吸附条：搜索框 + 横向分区胶囊。
 *
 * 与抽卡页分类栏同一套定位思路（`sticky top: 0` 贴住 `<main>` 的滚动视口，
 * 由 `position: sticky` 原生吸附）。区别是本条还要盖住从下方滚过的内容，
 * 所以用**实底** `bg-background` 而不是半透明玻璃：手机上分区标题是加粗的
 * 深色字，半透明底挡不住（抽卡页的分类栏也是这么处理的）。
 */
export function SettingsMobileNav({
  sections,
  activeAnchor,
  query,
  onQueryChange,
  onJumpItem,
  onJumpSection,
  navRef,
}: {
  sections: SettingsSection[];
  activeAnchor: string;
  query: string;
  onQueryChange: (value: string) => void;
  onJumpItem: (itemId: string) => void;
  onJumpSection: (sectionAnchor: string) => void;
  navRef?: React.Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const hits = useMemo(
    () => searchSettings(sections, query, t),
    [sections, query, t],
  );
  const chipRowRef = useRef<HTMLDivElement>(null);

  // 滚动过程中当前分区会变化：把对应胶囊横向带到中间，别让它停在屏幕外
  const revealActiveChip = useCallback(() => {
    const row = chipRowRef.current;
    if (!row) return;
    const chip = row.querySelector<HTMLElement>('[aria-current="true"]');
    if (!chip) return;
    const target = chip.offsetLeft - row.clientWidth / 2 + chip.offsetWidth / 2;
    row.scrollTo({
      left: Math.max(0, target),
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    revealActiveChip();
  }, [activeAnchor, revealActiveChip]);

  return (
    <div
      ref={navRef}
      // 贴住 `<main>` 的滚动视口：`sticky top-0` 的偏移基准是滚动容器的
      // padding box，而 `<main>` 本身已让开了顶部安全区与移动端顶栏。
      className="sticky top-0 z-20 -mx-3 mb-4 mt-4 border-b border-separator/50 bg-background px-3 pb-2 pt-2 sm:-mx-4 sm:px-4 lg:hidden"
    >
      <SettingsSearchField value={query} onChange={onQueryChange} />

      {query ? (
        // 搜索结果：`data-no-ovs` 同样不要可见滚动条（全局已隐藏），超出直接滚。
        // `max-h` 用 dvh 而非 vh：手机键盘弹起时视口变矮，用 vh 会顶出屏幕。
        <div
          data-no-ovs
          className="mt-1.5 max-h-[45dvh] overflow-y-auto overflow-x-hidden scroll-touch"
        >
          <SettingsSearchResults hits={hits} onJump={onJumpItem} />
        </div>
      ) : (
        <div
          ref={chipRowRef}
          data-no-ovs
          className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5 scroll-touch"
        >
          {sections.map((section) => {
            const Icon = section.icon;
            const active = section.anchor === activeAnchor;
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onJumpSection(section.anchor)}
                aria-current={active ? "true" : undefined}
                className={clsx(
                  // 胶囊至少 36px 高、带横向内边距：手指点按面积比文字本身大一圈
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition-colors",
                  active
                    ? "border-primary/50 bg-primary/15 text-primary-text"
                    : "border-separator/60 text-muted active:bg-foreground/10",
                )}
              >
                <Icon size={14} className="shrink-0" />
                <span className="whitespace-nowrap">
                  {t(section.labelKey)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

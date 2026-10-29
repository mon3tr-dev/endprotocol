# 设置面板与系统集成组件 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## `src/components/network-settings.tsx`
**职责**：设置页「网络」分区的完整表单——自定义代理的启用开关、HTTP/SOCKS5 协议单选、主机/端口、排除主机、可选认证（用户名+密码）、SOCKS5 专属的远程 DNS 解析开关、从系统代理一键读取、自动嗅探本地代理、连通性测试与重置。**代理关闭时所有子选项与操作按钮都不显示**；字段变更后 **自动保存**（500ms 防抖），无需手动点「保存」；**开启代理时弹出警告对话框**（说明可能影响 API 可用性，可勾选「不再提示」）。
**导出**：`NetworkSettings`（其余 `Field`、`isValidPort`、`Notice`、`AUTOSAVE_DEBOUNCE_MS` 为模块内私有）。
**主要依赖**：`react`、`react-i18next`、`@tauri-apps/api/core`（`isTauri`）、`@/components/ui/glass`（`GlassAlertDialogCompound as GlassAlertDialog`/`GlassButton`/`GlassChip`/`GlassInput`/`GlassRadioGroup`/`GlassSkeleton`/`GlassSwitch`）、`@/components/ui/app-icon`（`CheckIcon`/`CloseIcon`/`GlobeIcon`/`LoadingIcon`）、`@/components/ui/settings-row`（`SettingsDivider`）、`@/utils/proxyService`、`@/utils/logger`（`logError`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `Notice`（type） | 32 | `{ tone: "success" \| "danger" \| "info"; text: string }`，操作后的行内反馈 |
| `isValidPort(port)` | 36-38 | 端口合法性：整数且 1-65535 |
| `AUTOSAVE_DEBOUNCE_MS` | 41 | `500`，自动保存防抖间隔（毫秒） |
| `NetworkSettings`（export） | 49-658 | 主组件，无 props |
| `Field`（私有） | 661-685 | 字段外壳：标题 + 必填/可选徽标 + 控件 |

**内部结构**：
- 1-31 行：导入区（含 `GlassAlertDialogCompound` 别名导入）。
- 32-41 行：`Notice` 类型、`isValidPort`、`AUTOSAVE_DEBOUNCE_MS`。
- 50-62 行：状态（`config`/`loading`/`saving`/`testing`/`importing`/`autoDetecting`/`notice`/`pacUrl`/`showEnableWarning`/`dontShowEnableWarning`）与 `noticeTimer`/`autosaveTimer` 两个 ref。
- 64-73 行：`showNotice`（4s 自动消失）。
- 75-79 行：挂载清理（同时清理 notice 与 autosave 定时器）。
- 81-96 行：挂载 effect——`getProxySettings()` 读取配置并 `normalizeProxyConfig` 收敛。
- 93-109 行：`persist`——`saveProxySettings()`，失败时行内提示 + `logError`（`silent` 为真时不弹成功提示）。
- 111-121 行：`patch`——更新 state 并**启动 500ms 防抖自动保存**（合并 `normalizeProxyConfig` 后 `persist(..., {silent:true})`）。
- 123-131 行：`handleTypeChange`（协议切换时若端口仍是旧协议默认值则同步为新协议默认端口）。
- 133-143 行：`handleToggle`——**开启时若未勾选「不再提示」则弹警告并暂停落盘**；关闭时直接静默落盘。
- 145-149 行：`confirmEnable`——勾选「不再提示」、关闭警告、正式落盘 `enabled: true`。
- 151-192 行：`handleImportSystem`——`readSystemProxy()`；禁用/空主机时提示「未找到代理」，PAC 脚本时把 `pac_url` 展示给用户；成功则填入表单并落盘。
- 194-216 行：`handleAutoDetect`——`autoDetectProxy()` 嗅探本地常用端口，成功填充协议/主机/端口并落盘。
- 218-245 行：`handleTest`——先校验主机/端口，再 `testProxyConnection(config)`，成功提示状态码与耗时。
- 247-253 行：`handleReset`——回到默认值（保留当前协议与其默认端口）并落盘。
- 255-267 行：`handleSave`——启用状态下校验主机/端口后 `normalizeProxyConfig` 落盘。
- 269-275 行：`protocolOptions`（HTTP / SOCKS5，文案复用 `settings.general.proxy_type_*`）。
- 277-298 行：`loading` 时的骨架屏。
- 300-598 行：渲染——总开关（始终显示）+ **可展开区域**（容器始终挂载，用 `grid-template-rows` 在 `0fr` 与 `1fr` 之间做 300ms 高度过渡 + `opacity` 淡入淡出 + 内层 `overflow-hidden` 裁切；上间距也用 `paddingTop: enabled ? 24 : 0` 同步过渡，收起时不残留空白与分隔线）包裹的全部子项：协议 `GlassRadioGroup`、主机+端口两列、**排除主机**输入、认证区、SOCKS5 专属「远程 DNS 解析」开关（**本身也是 `0fr ↔ 1fr` 展开动画，仅在 SOCKS5 时展开**）、系统代理读取 + 自动嗅探两个按钮、PAC 提示（`0fr ↔ 1fr` 淡入）；操作区（保存/测试/重置 + notice）位于同一展开区域内。
- 599-655 行：**开启代理警告对话框**（`GlassAlertDialog`，结构为 `Backdrop` → `Container` → `Dialog` 嵌套）——标题 `proxy_enable_warning_title`、正文 `proxy_enable_warning_body`（可能影响 API 可用性）、「不再提示」复选框（`dontShowEnableWarning`）、取消（`cancelEnable` → 保持关闭并静默落盘）与确认（`confirmEnable` → 置 `enabled: true` 并落盘）按钮。

**备注**：
- **invoke 命令名**：`get_proxy_settings`、`save_proxy_settings`（参数 `{ config }`，返回保存后的配置）、`read_system_proxy`、`test_proxy_connection`（参数 `{ config, url }`）、`auto_detect_proxy`（无参，返回嗅探到的配置）——均经 `@/utils/proxyService` 封装；`clear_proxy_settings` 由服务提供但本组件未使用（重置即写入默认配置）。
- **配置键**：`proxy_config`（结构 `{enabled, type, host, port, username, password, remoteDns, exclude}`，由后端 `ConfigService` 持久化；保存后同步刷新后端全局代理缓存并把 `exclude` 写入 `no_proxy`，后续所有 HTTP 请求即时生效）。
- **自动保存**：主机/端口/协议/排除主机/认证/远程 DNS 的每次变更都会在 500ms 后静默落盘；「保存」按钮保留给需要显式确认的场景。
- **i18n key 前缀**：`settings.network.title/desc`（卡标题，在 settings.tsx）与 `settings.network.proxy_*`（`saved`/`save_failed`/`import_*`/`invalid_*`/`test_*`/`auto_detect*`/`enable_warning_title`/`enable_warning_body`/`enable_dont_show`）；控件文案在 `settings.general.proxy_*`（`proxy_enable*`/`proxy_protocol*`/`proxy_type_*`/`proxy_host*`/`proxy_port*`/`proxy_exclude*`/`proxy_auth*`/`proxy_username*`/`proxy_password*`/`proxy_remote_dns*`/`proxy_socks5_only`/`proxy_import_system*`/`proxy_import_action`/`proxy_auto_detect`/`proxy_pac_notice`/`proxy_test*`）、`common.save`/`common.reset`/`common.cancel`/`common.confirm`。
- **无 window 事件、无 emit/listen**；反馈只走组件内 `notice`。
- **必填/可选标注**：协议、主机、端口标注「必选/必填」；排除主机、用户名、密码标注「可选」；远程 DNS 带「仅 SOCKS5」徽标且选中 SOCKS5 时才出现。
- **「不再提示」的作用域**：当前为组件内状态，页面刷新后重置（如需永久记忆应改为写入配置键）。

## `src/components/appearance-settings.tsx`
**职责**：外观设置面板，集中管理主题模式（浅色/深色/跟随系统）、主题色（预设 + 自定义色阶）、窗口背景图（选择/删除/透明度/模糊）与毛玻璃清晰度，并实时写入 CSS 变量与持久化配置。主题色板与应用函数已抽到 `@/utils/theme`（与 `main.tsx`、`theme-switch.tsx`、`tray-panel.tsx` 共用），本文件只保留取色器专用的色彩空间转换。
**导出**：`AppearanceSettings`；并 re-export `getAllColors`、`findColorByName`（来自 `@/utils/theme`，兼容旧引用，仓库内仍无调用方）。未导出：`hexToHsl`/`hslToHex`/`hexToRgb`/`rgbToHex`/`hexToHsv`/`hsvToHex`、`useDragArea`、`generateColorScale`、`applyThemeModeLocal`（`applyThemeMode` 的本地别名）、`dispatchThemeChange`。
**主要依赖**：`react`（含 `createPortal`）、`react-i18next`、`@tauri-apps/api/core`（`isTauri`/`invoke`）、`@tauri-apps/api/event`（`emit`）、`@/components/ui/settings-row`（`SettingsDivider`）、`@/components/ui/slider`（`Slider`）、`@/components/screen-color-picker`（`ScreenColorPicker`）、`@/utils/configService`（`getConfig`/`setConfig`）、`@/utils/theme`（`DEFAULT_GLASS_CLARITY`、`DEFAULT_THEME_COLOR`、`PRESET_COLORS`、`applyGlassClarity`、`applyThemeColor`、`applyThemeMode`、`getAllColors` 及类型 `ThemeColor`/`ThemeMode`）、`@/utils/platform`（`isWindowsPlatform`）、`morphicons/react`（`MorphIcon`）、`lucide`（`Sun`/`Moon`/`Monitor`/`Check`/`Plus`/`Pencil`/`Trash2`/`Pipette`/`ImagePlus`/`X`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `export { findColorByName, getAllColors }` | 44 | 从 `@/utils/theme` 原样再导出，保持旧导入路径可用 |
| `hexToHsl(hex)` | 47-64 | HEX → HSL（度/百分比取整） |
| `hslToHex(h,s,l)` | 66-78 | HSL → HEX |
| `hexToRgb(hex)` | 80-87 | HEX → `{r,g,b}` |
| `rgbToHex(rgb)` | 89-92 | `{r,g,b}` → HEX |
| `hexToHsv(hex)` | 94-109 | HEX → HSV |
| `hsvToHex(h,s,v)` | 111-131 | HSV → HEX |
| `useDragArea(onPosition)` | 133-178 | 指针拖拽 hook，返回 `{ref, onPointerDown, onPointerMove, onPointerUp, onPointerCancel}`，回调归一化 0-1 的 `(left, top)` |
| `generateColorScale(hex)` | 180-197 | 由单色生成 50-900 色阶（500 为原色，foreground 固定白） |
| `AppearanceSettings`（export） | 199-1304 | 主组件，无 props；内部状态与处理函数见下表 |
| `applyThemeModeLocal` | 1306 | `applyThemeMode` 的本地别名（旧函数已删，行为不变） |
| `dispatchThemeChange()` | 1308-1310 | 派发 window `CustomEvent("themeChange")` |

**内部结构**：
- 1-42 行：导入（React hooks、`createPortal`、i18n、Tauri `invoke`/`isTauri`/`emit`、`SettingsDivider`、`Slider`、`ScreenColorPicker`、`getConfig`/`setConfig`、`@/utils/theme`、`MorphIcon`、lucide 图标）。
- 44 行：`findColorByName` / `getAllColors` 的兼容 re-export。
- 47-131 行：六组颜色空间转换纯函数（HSL/RGB/HSV ↔ HEX）。
- 133-178 行：`useDragArea` 拖拽 hook（用于取色面板）。
- 180-197 行：`generateColorScale` 色阶生成。
- 199-239 行：组件状态声明（主题模式/颜色/自定义色、取色器显隐与坐标、Hex/RGB 草稿、编辑中的颜色、右键菜单、屏幕取色开关、背景图路径/预览/透明度/模糊、玻璃清晰度、文件输入 ref）。默认值 `DEFAULT_BG_IMAGE_OPACITY`/`DEFAULT_BG_BLUR` 仍为组件内常量，`DEFAULT_GLASS_CLARITY` 改为从 `@/utils/theme` 导入。
- 241-326 行：取色器交互——`pickerHex` → RGB 草稿同步、`applyHex`、饱和度/亮度与色相拖拽回调、RGB 输入处理、`repositionPicker` 浮层定位（面板按 264×460 预估并做上下翻转）、草稿同步 effect、布局 effect、resize/scroll 监听。
- 328-386 行：`loadConfig`——并行读取 7 个配置键，应用 CSS 变量，调用 `invoke("read_image_file")` 读取背景图字节并生成 objectURL 写入 `--bg-image`。
- 388-402 行：监听 window `themeChange`，重新拉取主题配置以保持高亮同步。
- 404-421 行：主题色/模式应用 effect（`applyThemeColor` + `applyThemeModeLocal`）；`system` 模式下监听 `prefers-color-scheme` 变化并 `emit("theme-changed", "system")`。
- 423-438 行：取色器点击外部/滚动关闭（屏幕取色打开时不关闭）。
- 440-467 行：`handleModeChange`（写配置、派发事件、淡出淡入切换）、`handleColorChange`。
- 469-585 行：`convertToWebP`、背景图选择/删除、背景图透明度与模糊的修改与重置、玻璃清晰度修改与重置（均写 CSS 变量 + 配置键；清晰度还额外 `emit("theme-changed", themeModeRef.current)` 广播给其他窗口，供托盘浮层实时跟随）。
- 578-685 行：`handleSaveCustom`（新增/编辑自定义色）、`handleDeleteCustom`（删除并回退到 `PRESET_COLORS[0]`）、`openPicker`/`closePicker`、`handleScreenPick`、`handlePickFromScreen`（Tauri 走原生截图覆盖层，浏览器走 `EyeDropper`）。
- 687-708 行：`isLoading` 时返回 `null`；`modeOptions` 三选项（浅/深/系统，含图标）；计算当前 HSV。
- 710-738 行：主题模式分段按钮 UI。
- 740-1146 行：主题色区块——预设色行、自定义色行与右键菜单入口、新增按钮、取色器 portal（SV 面板、色相条、预览 + Hex 输入、屏幕取色按钮、RGB 输入、名称输入、取消/保存按钮）、自定义色右键菜单 portal、`ScreenColorPicker` portal。
- 1148-1263 行：背景图区块——隐藏 file input、预览与移除按钮、不透明度滑杆、模糊滑杆、无图时的虚线选择按钮。
- 1265-1297 行：毛玻璃清晰度滑杆 + 重置按钮。
- 1306-1310 行：文件末尾的 `applyThemeModeLocal` 别名与 `dispatchThemeChange`。

**设置项/能力清单**：

| 能力 | 配置键 | 控件 | 行号 |
| --- | --- | --- | --- |
| 主题模式（浅色/深色/跟随系统） | `theme_mode` | 三段按钮组（`handleModeChange`） | 590-611，UI 863-888 |
| 系统深色变化跟随 | `theme_mode`（读） | `matchMedia` 监听 + `emit` | 562-571 |
| 主题色预设（6 色） | `theme_color` | 圆形色块按钮（`handleColorChange`） | 613-617，UI 903-937 |
| 自定义主题色新增 | `theme_custom_colors` + `theme_color` | 「+」按钮 + 取色器弹层 + 保存 | 748-764，UI 977-985 / 1226-1231 |
| 自定义主题色编辑 | `theme_custom_colors` | 右键菜单「编辑」+ 取色器 | 733-746，菜单 1261-1275 |
| 自定义主题色删除 | `theme_color`（回退 indigo）+ `theme_custom_colors` | 右键菜单「删除」 | 766-778，菜单 1276-1282 |
| 取色器（SV 面板 / 色相条 / Hex 输入 / RGB 输入 / 名称输入） | 草稿态，保存时并入 `theme_custom_colors` | portal 弹层 + 拖拽 + 受控输入 | 面板 987-1236，交互 401-431 |
| 屏幕取色（Windows Tauri 截图放大镜 / 支持 EyeDropper 的浏览器） | —（结果进入取色器草稿） | `Pipette` 按钮 + `ScreenColorPicker` | 811-835，按钮 1159-1172，portal 1288-1295；Tauri macOS/Linux 隐藏 |
| 背景图选择/替换（WebP 转码后保存） | `bg_image_path` | 隐藏 file input + 预览按钮 | 644-666，input 1311-1318，预览 1323-1331 |
| 背景图移除 | `bg_image_path`（置 null） | 预览图右上角 X | 668-678，按钮 1333-1342 |
| 背景图不透明度（0-1） | `bg_image_opacity` | `Slider` + 重置按钮 | 680-697，UI 1345-1371 |
| 背景图模糊（0-40px） | `bg_blur` | `Slider` + 重置按钮 | 699-713，UI 1373-1399 |
| 毛玻璃清晰度（0-100） | `glass_clarity` | `Slider` + 重置按钮；改动会 `emit("theme-changed")` 让托盘浮层实时跟随 | 570-585，UI 1288-1303 |

**备注**：
- `invoke` 命令：`read_image_file`（516，参数 `{ path }`）、`save_background_image`（650，参数 `{ data }`，返回保存路径）、`delete_background_image`（670）。
- Tauri `emit` 事件：`theme-changed`（567、594）。
- window 事件：监听 `themeChange`（550）、派发 `themeChange`（593，由 1459-1461 的 `dispatchThemeChange` 封装；另在 616、741、761、776 调用）；另有原生 `resize`/`scroll`/`mousedown`/`matchMedia` 监听。本文件**没有** `listen(...)`。
- 配置键（经 `@/utils/configService`）：`theme_mode`、`theme_color`、`theme_custom_colors`、`bg_image_path`、`bg_image_opacity`、`bg_blur`、`glass_clarity`。
- 写入的 CSS 变量：`--glass-blur`、`--glass-surface-opacity`、`--glass-strong-opacity`、`--glass-field-opacity`、`--primary-50`…`--primary-900`、`--primary`、`--primary-foreground`、`--bg-image-opacity`、`--bg-blur`、`--bg-image`。
- 默认值常量：背景图透明度 0.5（383）、背景模糊 16（385）、玻璃清晰度 55（386）、默认取色 `#6366f1`（356/791）、自定义色命名前缀 `custom-${Date.now()}`（748）。

## `src/components/language-switch.tsx`
**职责**：顶栏语言切换下拉（English/中文），带搜索、旗帜图标与选中校验，切换后写入持久化配置。
**导出**：`LanguageSwitch`（另有导出的 `LanguageSwitchProps` 接口与未导出的 `USFlag`、`CNFlag` 内联 SVG 组件）。
**主要依赖**：`react`、`react-dom`（`createPortal`）、`react-i18next`（`i18n`）、`@/components/ui/glass`（`GlassInput`）、`@/utils/configService`（`setConfig`）、`morphicons/react`（`MorphIcon`）、`lucide`（`ChevronDown`、`Check`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `USFlag` | 12-26 | 美国国旗内联 SVG（`w-6 h-4`） |
| `CNFlag` | 28-40 | 中国国旗内联 SVG |
| `LanguageSwitchProps`（export） | 42-45 | `{ compact?: boolean }`——`compact` 为真时仅显示旗帜、隐藏文字标签与下拉箭头（供折叠侧边栏使用） |
| `LanguageSwitch`（export） | 47-187 | 下拉切换组件，`compact` 默认 `false` |

**内部结构**：
- 43-49 行：`i18n`、开关/搜索状态、`wrapperRef`/`buttonRef`/`menuRef`、`dropdownPos` 浮层坐标。
- 51-57 行：硬编码语言列表（`en`/`zh`，含 `label`/`code`/`flag`）与当前选中项回退逻辑。
- 60-74 行：点击外部与滚动关闭浮层的 effect。
- 76-81 行：`handleLanguageChange`——`i18n.changeLanguage` + `setConfig("app.language", ...)` + 复位搜索。
- 83-87 行：`filteredLanguages` 按 label/code 过滤。
- 89-100 行：`handleToggle` 计算浮层初始位置（按钮下方 +4px，宽度取 `max(220, 按钮宽)`）。
- 103-118 行：渲染后按菜单实际高度/视口二次校准（下方放不下则翻到上方，左右各留 8px）。
- 120-178 行：渲染——触发按钮（123-136，旗帜 + 文案 + 旋转箭头）、portal 菜单（139-176，含搜索框 147-152、可滚动列表 154-173，选中项显示 `Check`）。

**备注**：无 `invoke`、无 `listen`、无 `emit`；配置键 `app.language`；window/document 事件：`mousedown`、`scroll`（capture）。语言列表当前仅 2 项且写死在组件内。

## `src/components/theme-switch.tsx`
**职责**：顶栏/侧边栏主题快捷切换按钮，只在浅色与深色之间切换（不进入「跟随系统」），与设置页通过 `themeChange` 事件双向同步。
**导出**：`ThemeSwitch`、`ThemeSwitchProps`。
**主要依赖**：`react`（`FC`）、`morphicons/react`（`MorphIcon`）、`lucide`（`Sun`、`Moon`）、`@/utils/configService`（`getConfig`、`setConfig`）、`@tauri-apps/api/event`（`emit`）、`@/utils/theme`（`applyThemeMode`、`isSystemDark` 及类型 `ThemeMode`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ThemeSwitchProps`（export interface） | 8-10 | `className?: string` |
| `resolveEffective(mode)` | 13-16 | `system` 解析为当前实际生效的浅/深（旧 `getSystemDark` 已由 `@/utils/theme` 的 `isSystemDark` 取代） |
| `ThemeSwitch`（export） | 18-108 | 圆形切换按钮 |

**内部结构**：
- 19-21 行：`isMounted`、`themeMode`、`btnRef` 状态。
- 23-32 行：初始化——读 `theme_mode`、应用主题、置 `isMounted`。
- 35-44 行：监听 window `themeChange` 回读配置并应用（与设置页双向同步）。
- 47-56 行：`system` 模式下监听系统深浅变化，应用并 `emit("theme-changed", "system")`。
- 59-83 行：`toggleTheme`——解析当前有效模式，浅↔深切换，写 `theme_mode`、派发 `themeChange`、`emit("theme-changed", ...)`，再做 170ms 淡出 → 应用 → 40ms 淡入。
- 85-107 行：未挂载时渲染占位 `div`；否则渲染带 `Sun`/`Moon` 图标的按钮（含 `aria-label`）。

**备注**：`invoke`：无；`listen`：无；Tauri `emit`：`theme-changed`（52、66）；window 事件：监听 `themeChange`（42）、派发 `themeChange`（65）；配置键 `theme_mode`（读 25/37，写 64）。主题的浅/深应用函数与 `isSystemDark` 均来自 `@/utils/theme`（占位 `div` 注释里已没有本地 `applyThemeMode` 实现）。

## `src/components/game-launch-settings.tsx`
**职责**：游戏启动相关设置组（取消下载行为 / DX11 启动 / 下载线程数 / 断点续传 / 校验线程数 / 启动界面背景媒体）；这些字段由 `GameLaunchSettingsFields` 统一渲染，设置页与游戏行动面板的「游戏设置」弹窗共用。静默启动命令、`--dx11` 选项、Windows `.lnk` 快捷方式在独立弹窗 `QuickLaunchModal`；Steam 第三方游戏条目的参数调整再套一层独立弹窗 `SteamShortcutModal`。已不再支持 `--close-after-launch`（该开关与相关文案一并移除）。
**导出**：`GameLaunchSettings`、`GameLaunchSettingsFields`、`QuickLaunchModal`、`SteamShortcutModal`、`CANCEL_BEHAVIOR_KEY`、`VERIFY_THREADS_KEY`、`DOWNLOAD_THREADS_KEY`、`DOWNLOAD_RESUME_KEY`、`DX11_KEY`、`GAME_LAUNCH_SYNC_EVENT`、`readCancelBehavior`、`readVerifyThreads`、`readDownloadThreads`、`readDownloadResume`、`readDx11`、`persistGameLaunchSetting`、`setDx11Setting`。
**主要依赖**：`react`、`react-i18next`、`@tauri-apps/api/core`（`invoke` 读图标字节）、`@/components/ui/glass`（`GlassButton`、`GlassSwitch`、`GlassInput`）、`@/components/ui/slider`（`Slider`）、`@/components/ui/settings-row`（`SettingsDivider`）、`@/components/ui/modal`（`GlassModalCompound`）、`@/components/icons`（`TerminalIcon`/`ExternalLinkIcon`/`GamepadIcon`）、`@/stores/launcherMode`、`@/utils/launcherService`（静默启动 + Steam IPC）、`@/utils/configService`（`setConfig`）、`@/utils/platform`、`@tauri-apps/plugin-opener`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CANCEL_BEHAVIOR_KEY`（export） | 37 | localStorage 键 `launcher_cancel_behavior` |
| `VERIFY_THREADS_KEY`（export） | 38 | localStorage 键 `launcher_verify_threads` |
| `DOWNLOAD_THREADS_KEY`（export） | 39 | localStorage 键 `launcher_download_threads` |
| `DOWNLOAD_RESUME_KEY`（export） | 40 | localStorage 键 `launcher_download_resume` |
| `DX11_KEY`（export） | 41 | localStorage 键 `launcher_dx11` |
| `GAME_LAUNCH_SYNC_EVENT`（export） | 42 | window 事件名 `game-launch-settings-sync` |
| `readCancelBehavior()`（export） | 47-53 | 读取消行为，默认 `"ask"` |
| `readVerifyThreads()`（export） | 55-62 | 读线程数并夹取 1-32，默认 12 |
| `readDownloadThreads()`（export） | 64-78 | 读下载线程数并夹取 1-32，默认 8 |
| `readDownloadResume()`（export） | 80-86 | 读断点续传开关，默认 `true`（仅显式 `"false"` 时关闭） |
| `readDx11()`（export） | 88-94 | 读 DX11 开关，默认 `false` |
| `persistGameLaunchSetting(key, value)`（export） | 96-101 | 写 localStorage 并广播 `GAME_LAUNCH_SYNC_EVENT` |
| `setDx11Setting(value)`（export） | 104-107 | DX11 开关：写 localStorage（界面同步）+ `setConfig("launcher_dx11", value)`（后端静默启动读取） |
| `GameLaunchSettingsFields`（export） | 113-354 | 共享设置字段（取消下载行为 / DX11 / 下载线程数 / 断点续传 / 校验线程数 / 背景媒体，分隔线分隔）；监听同步事件与 `subscribeGameBgMode`，任意一处修改立即广播 |
| `GameLaunchSettings`（export） | 360-394 | 设置页分区：`GameLaunchSettingsFields` + 静默启动入口（打开 `QuickLaunchModal`） |
| `QuickLaunchModal`（export） | 399-636 | 独立弹窗；props：`onClose: () => void`；左栏「启动选项」只剩 DX11 一个 `GlassSwitch` |
| 命令加载 effect | 409-430 | `syncSilentLaunchConfig()` 同步游戏路径/渠道/DX11 到 app config，再取基础命令（`baseCommand`） |
| `dx11` state | 402 | 从 `readDx11()` 初始化；监听 `GAME_LAUNCH_SYNC_EVENT`（432-436）；切换调用 `setDx11Setting`（444-447） |
| 派生 `launchCommand` | 440-442 | `baseCommand` + 开启时追加 ` --dx11` |
| `handleCopyCommand` | 449-466 | 复制当前命令到剪贴板；成功仅触发 icon morph（Copy→Check）3 秒；失败经 `addMessage`（warn，tag `quick-launch-command`） |
| `handleCreateShortcut` | 468-500 | `createGameShortcut({dx11})`；成功后消息带「打开所在文件夹」动作 |
| `SteamShortcutModal` 挂载 | 634 | 由 `steamOpen` 控制，`onClose` 只关闭该子弹窗（父弹窗保持打开） |
| `IconPreview`（私有） | 639-672 | 用 `invoke("read_image_file")` 读 `.ico` 字节并转 blob URL 预览；失败回退 `GamepadIcon` 占位 |
| `SteamShortcutModal`（export） | 682 起 | Steam 条目参数弹窗；props：`onClose: () => void`（见下） |

**`SteamShortcutModal` 内部结构**：
- 挂载时 `syncSilentLaunchConfig()` → `getSteamShortcutDefaults()` 填充全部默认值；加载失败进消息队列（tag `quick-launch-steam`）。
- 字段：①「名字」`GlassInput`（默认「明日方舟：终末地」）；②「图标」左侧预览 + 路径文本（附一行说明：已从 `Endfield.exe` 提取 / 提取失败已回退 exe / 未找到游戏需自选）+ 右侧「选择…」（`pickSteamIcon`）、「从 exe 提取…」（`pickSteamIconSource` → `extractSteamIcon`）；③「DX11」`GlassSwitch`，切换同时写 localStorage 与后端配置；④分隔线后是 Overlay 提示区（按后端 `is_elevated` 选 `steam_overlay_hint` 或 `steam_overlay_hint_elevated`）+ 两个复选框：「创建以管理员身份启动 Steam 的快捷方式」（勾选后提交时弹保存对话框）、「将开始菜单中的 Steam 提升为管理员运行」（`start_menu_shortcut_count` 为 0 时禁用并显示 `*_none` 文案）。
- 提交：`addSteamShortcut({name, iconPath, dx11, createAdminShortcut, elevateStartMenu})` → 成功消息 `steam_created_title/body`（提示重启 Steam），有 `admin_shortcut` 时附带「打开所在文件夹」动作，然后 `onClose()`；失败进消息队列。
- backdrop `z-[320]`（高于父弹窗的 `z-[300]`），容器 `size="md"`。

**内部结构**（`QuickLaunchModal`）：
- Body 为左右两栏：左栏（`sm:w-56`，`justify-center items-center text-center`，右侧竖分隔线）顶部为「启动选项」小标题（`launch_options`），其下只剩 DX11 开关（标题/描述 + `GlassSwitch`）；右栏由 `divide-y` 在板块间划分割线，每个板块以左侧图标开篇——①「启动命令」（`TerminalIcon`）：单行截断（`truncate`）的 code 条 + 条内右端复制按钮为同一 `MorphIcon`（`Copy`/`Check` 间切换，成功保持 3 秒）；②「Windows 快捷方式」（`ExternalLinkIcon`）；③「Steam 第三方游戏」（`GamepadIcon`），按钮改为打开 `SteamShortcutModal`（不再直接执行添加）。所有完成/失败反馈进全局消息队列。backdrop `z-[300]`，容器 `size="lg"`。
- 两个打开入口：设置页「静默启动」区块内按钮，以及游戏行动面板汉堡菜单的「游戏设置」项。
- `.lnk` 与 Steam 条目的启动命令为 `--silent --launch-game`，按开关追加 `--dx11`；游戏目录、渠道与 DX11 设置同步到后端 `ConfigService`。

**备注**：通过 `launcherService` 调用 `get_game_launch_command` / `create_game_shortcut` / `steam_shortcut_defaults` / `pick_steam_icon` / `pick_steam_icon_source` / `extract_steam_icon` / `add_steam_shortcut`，并用 `set_config` 同步 `launcher_install_path` / `launcher_channel` / `launcher_dx11`；图标预览额外 `invoke("read_image_file")`。剪贴板使用浏览器 Clipboard API。localStorage 键：`launcher_cancel_behavior`、`launcher_verify_threads`、`launcher_download_threads`、`launcher_download_resume`、`launcher_dx11`、`launcher_install_path`、`launcher_channel`；window 事件：`game-launch-settings-sync`。下载线程数与断点续传由下载调用方（`game-action-panel.tsx`）在发起安装/预下载时读取并透传后端。文案位于 `settings.game_launch.*` 与 `launcher.*`。

## `src/components/in-app-browser.tsx`
**职责**：应用内嵌浏览器覆盖层——玻璃工具栏（后退/前进/刷新/外部打开/地址栏/关闭）+ **窗口控制组**（最小化/最大化-还原/关闭，接管被覆盖的标题栏）+ 加载进度条 + **原生子 Webview**（Tauri `new Webview()`，用于加载被 `X-Frame-Options` / CSP 禁止内嵌的站点），非 Tauri 环境降级为沙箱 `iframe`。开合与地址由 `@/stores/inAppBrowser` 状态驱动。
**导出**：`InAppBrowser`。
**主要依赖**：`react`、`react-i18next`、`@tauri-apps/api/core`（`isTauri`/`invoke`）、`@tauri-apps/api/webview`（`Webview`）、`@tauri-apps/api/dpi`（`LogicalPosition`/`LogicalSize`）、`@tauri-apps/api/window`（`getCurrentWindow`）、`@tauri-apps/api/event`（`listen`）、`@tauri-apps/plugin-opener`（`openUrl`）、`@/utils/logger`、`@/utils/configService`（`getConfig`）、`@/components/close-confirm-dialog`、`@/components/ui/app-icon`（`MinimizeIcon`/`MaximizeIcon`/`RestoreIcon`/`CloseIcon`）、`@/components/icons`（`ExternalLinkIcon`）、`@/stores/inAppBrowser`（`isBrowserOpen`、`getInAppBrowserUrl`、`closeInAppBrowser`、`subscribeInAppBrowser`）、`@/utils/browserViewService`（`browserGoBack`/`browserGoForward`/`browserReload`/`browserNavigate`/`browserCurrentUrl`、`BrowserPageLoadPayload`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `WEBVIEW_LABEL_PREFIX` | 36 | 子 Webview label 前缀，后端 `on_page_load` 按此前缀过滤转发事件 |
| `webviewSeq` | 39 | label 递增序列，避免新旧实例撞 label |
| `WEBVIEW_BACKGROUND` | 49 | 创建参数里的原生层底色（RGBA 元组，白色不透明）：未绘制区须与站点色调一致，否则深色底配深色字不可读 |
| `WebviewHandle`（接口） | 52-56 | `{ webview, settled }`；`settled` 在 `tauri://created` / `tauri://error` 任一落定后 resolve |
| `InAppBrowser`（export） | 58-601 | 无 props；未打开时返回 `null` |

**内部结构**：
- 64-80 行：`containerRef`（占位容器）、`toolbarRef`（玻璃工具栏，用于量出原生层不得越过的下沿）、`handleRef`（Webview 句柄）、`iframeRef`（降级分支）。
- 47 行：`TOOLBAR_MIN_HEIGHT = 44`（`h-11` 逻辑像素），量不到工具栏时的兜底下限。
- 73-101 行：窗口控制状态 `isMaximized`，`checkMaximizedState` 读 `getCurrentWindow().isMaximized()`，并监听 `tauri://resize` / `tauri://move` 同步图标。
- 103-108 行：读配置键 `close_action`（`ask`/`minimize_to_tray`/`close`）。
- 110-156 行：`handleWindowMinimize` → `invoke("minimize_window")`；`handleWindowMaximize` → `invoke("toggle_maximize_window")` + 100ms 后 `checkMaximizedState`；`handleWindowClose` 按 `closeAction` 分支（`ask` → 弹 `CloseConfirmDialog`，否则 `minimize_to_tray` / `app_quit`）。
- 161-190 行：store 订阅；浏览器已打开时再次跳转走 `navigateHandle`（就地导航，保留实例与浏览历史）。
- 224-242 行：`measureBounds`——**创建与同步共用的唯一测量入口**，用 `getBoundingClientRect()` 换算逻辑坐标，并把 y 钳制在工具栏下沿之上（`Math.max(rect.top, toolbarBottom)`）。原生子 Webview 永远画在 DOM 之上、z-index 无效，一旦它的 y 落进工具栏区域，工具栏就直接看不见，所以宁可底部少画几像素也不越线；量不到工具栏时退回 `TOOLBAR_MIN_HEIGHT` 硬下限而非不裁剪。
- 244-258 行：`syncBounds`——把 `measureBounds` 的结果写回 `setPosition`/`setSize`，并 debug 记录实际矩形（工具栏遮挡类问题的唯一线索）。
- 271-315 行：`createWebview`——`new Webview(getCurrentWindow(), label, { url, ...measureBounds(), backgroundColor, focus: false })`，并把 `once("tauri://created"/"tauri://error")` 包成 `settled`。`focus: false` 避免原生层夺走主窗口焦点导致工具栏按钮点不动。
- 325-338 行：`destroyWebview`——先等 `settled` 再 `close()`，防止创建未完成时关闭失败泄漏原生层；带实例身份校验，异步竞态下不误关新实例。
- 344-365 行：生命周期 effect——`isOpen` 转 true 创建、转 false（关闭/挂起）销毁；`ResizeObserver` + `window resize` 双通道同步尺寸。
- 370-376 行：`loading` 变化时再同步一次。loading 条是占位容器的**兄弟节点**，出现/收起会改变容器的 `top`；`ResizeObserver` 只在尺寸变化时触发，位置变化不触发，故显式补一次。
- 378-412 行：`listen("browser://page-load")` 驱动 loading 与地址栏回填，并在 `started`/`finished` 两个时机各 `syncBounds()` 一次（加载完成时布局可能已变化：loading 条收起、页面撑出滚动条）。
- 420-428 行：`syncUrlFromWebview` 在地址栏点击时回读真实地址（补 SPA `pushState` 不触发 on_page_load 的盲区）。
- 432-490 行：`handleBack`/`handleForward`/`handleRefresh`/`handleOpenExternal`（非 Tauri 回落到 `iframe.contentWindow`）。
- 496 行：`!isOpen` 时返回 `null`。
- 505-568 行：玻璃工具栏（`ref={toolbarRef}`）。**布局保持在 Webview 区域之外**（原生层会覆盖 DOM），空白区即窗口拖拽区（`WebkitAppRegion: drag`）；按钮区显式 `no-drag`。窗口控制组在 `isTauri()` 时渲染。
- 626-630 行：`loading` 时的顶部脉冲进度条。
- 637-648 行：占位容器 `div ref={containerRef}`；`!isTauri()` 时在容器内渲染降级 `iframe`（`sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads"`，`onLoad` 关闭 loading）。

**备注**：`invoke` 命令（见 [../backend/commands.md](../backend/commands.md)）：`browser_go_back`、`browser_go_forward`、`browser_reload`、`browser_navigate`、`browser_current_url`（经 `@/utils/browserViewService` 包装）；窗口控制走 `minimize_window`、`toggle_maximize_window`、`minimize_to_tray`、`app_quit`；`listen` 事件：`browser://page-load`（后端 `lib.rs` 的 `on_page_load` 桥接）；配置键：`close_action`；无 `postMessage` 依赖。开合状态仍来自 `@/stores/inAppBrowser` 的订阅。地址栏导航不改写浏览器 history（仅 store + Webview）。原生层会覆盖 DOM，因此高于浏览器区域的浮层（标题栏消息浮窗 z-[10005]、弹窗 z-[100]/z-[200]）在浏览器打开时会不可见，属已知取舍。

> ⚠️ 窗口控制必须走 app command（`minimize_window` / `toggle_maximize_window`），**不能**改用 `plugin:window|*` 前端 API：后者受 capability 作用域约束（子 webview 会继承 `main` 的 ACL），且 `is-maximized` 等 getter 在本项目 capability 下未授权（实测报 `window.is-maximized not allowed`）。app command 不经 capabilities 授权，行为稳定。

## `src/components/tray-panel.tsx`
**职责**：系统托盘悬浮面板——头部右上角展示**游戏账号等级**徽标，下方是当前用户的头像/昵称/理智（含自然回复倒计时）、每日活跃、每周事务、通行证五项数据，并提供「显示窗口」「退出」两个操作。视觉与主界面统一：`glass-native` 原生磨砂层（背景真透明、不再叠 CSS blur）、主题色圆点 + 全大写字距品牌标题、`glass` 风格的细进度条、`MorphIcon` 图标、全量 i18n 文案。
**导出**：`TrayPanel` 。（内部组件 `MetricRow`、`Avatar` 不导出）
**主要依赖**：`react`（`useCallback`/`useEffect`/`useMemo`/`useState`）、`react-i18next`、`@tauri-apps/api/core`（`invoke`）、`@tauri-apps/api/window`（`getCurrentWindow`）、`@tauri-apps/api/event`（`listen`）、`@/utils/imageLoader`（`Img`）、`@/utils/logger`、`@/utils/theme`（`loadTheme`）、`@/utils/trayService`（`TrayUserInfo` 类型）、`morphicons/react`（`MorphIcon`）、`morphicons`（`IconInput` 类型）、`lucide`（`ArrowUpRight`、`CalendarDays`、`CircleUserRound`、`Power`、`Ticket`、`Trophy`、`Zap`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TrayUserInfo`（type import） | 9 | 不再在本文件声明，直接从 `@/utils/trayService` 复用，与后端 `tray.rs` 的 `TrayUserInfo` 保持单一来源 |
| `STAMINA_REFILL_SECONDS` | 23 | 432（6 分钟/点），与 `cards/account-progress` 的 `REFILL_INTERVAL` 一致 |
| `pad2` / `formatCountdown` | 25 / 30 | 秒数 → `HH:MM:SS`；`formatCountdown` 取代了旧的 `formatRecoveryTime`（旧实现返回 `"已满"` 中文字面量） |
| `clampPercent(value, max)` | 38 | 进度百分比，`max<=0` 时返回 0 |
| `MetricRow`（内部组件） | 47-102 | props：`icon: IconInput`、`label`、`current`、`max`、`hint?`、`valueText?`；图标胶囊 + 标签 + 数值 + 细进度条（满值时转 success 色） |
| `Avatar`（内部组件） | 105-134 | props：`src`、`alt`、`className`；图片失败时回退为首字母，不留空洞 |
| `TrayPanel`（export） | 136-384 | 面板主体，无 props |
| 理智推算 `stamina`（`useMemo`） | 195-234 | 用 `maxTs` + 432s 速率实时回算当前理智与「回满 / 下次回复」倒计时，而非停留在上次同步的静态值 |

**内部结构**：
- 137-139 行：`userInfo`、每秒 tick 的 `now`。
- 141-148 行：`loadUserInfo`——`invoke<TrayUserInfo | null>("get_tray_user_info")`，失败走 `logger.warn`。
- 150-182 行：mount effect——初始加载、`listen("tray-user-info-updated")` 更新数据、`getCurrentWindow().onFocusChanged`（获得焦点时刷新时间基准并重拉数据 + `loadTheme()`，失焦即 `win.hide()`）、1 秒定时器；清理时依次解绑。
- 184-189 行：派生值（`hasUser`、`accountLevel`（右上角徽标）、`maxStamina`/`maxTs`）；236-241 行：每日/每周/通行证当前与上限。
- 243-254 行：`handleShowMain`——`invoke("show_main_window")`，失败记日志并隐藏自身窗口。
- 256-262 行：`handleQuit`——`invoke("app_quit")`，失败记日志（旧实现回退调用不存在的 `getCurrentWindow().app.exit(0)`，已移除）。
- 264-383 行：渲染——品牌头部（主题色圆点 + `tray.title` + **账号等级徽标** 277-281）、用户概览（头像/昵称/理智倒计时/大号理智数字 285-313）、四个 `MetricRow`（理智 316-328、每日活跃 329-334、每周事务 335-340、通行证 341-346）、未选用户空状态（350-362）、底部操作区（显示窗口 367-373、退出 374-380）。

**备注**：
- `invoke` 命令：`get_tray_user_info`、`show_main_window`、`app_quit`。
- `listen` 事件：`tray-user-info-updated`（payload 为 `TrayUserInfo`）。
- 窗口事件：`getCurrentWindow().onFocusChanged`（获得焦点刷新、失焦隐藏）。
- **右上角徽标显示 `accountLevel`（游戏账号等级，来自 `char_detail` 的 `base.level`），不是通行证等级**；通行证等级只在下方 `tray.battle_pass` 那一行 `MetricRow` 里以 `bpCurLevel/bpMaxLevel` 呈现。徽标条件是 `hasUser && accountLevel > 0`，取不到等级时不显示，避免误呈现「等级 0」。数据由 `src/utils/trayService.ts` 组装。
- 无 `emit`、无配置键；文案全部走 i18n 命名空间 `tray.*`（`tray.title`/`stamina`/`daily_activity`/`weekly`/`battle_pass`/`level`/`full`/`recover_in`/`next_refill`/`no_user`/`no_user_hint`/`show_window`/`quit`），已不再硬编码中文。
- 主题色 / 玻璃清晰度由入口 `src/tray-panel.tsx` 统一注入（见 [entry_and_app.md](entry_and_app.md)），组件内只用语义化 token（`bg-primary`、`bg-default-100` 等），因此会跟随用户的自定义主题色。
- **透明策略**：窗口本身启用系统级 Acrylic（`lib.rs::create_full_windows` 的 `.effect(Effect::Acrylic)`），桌面磨砂由系统负责；面板根节点用 `.glass-native`（`backdrop-filter: none`），只压一层 `--surface` 渐变做可读性补偿，避免「模糊的模糊」把文字糊掉。窗口不设 `.shadow(true)`，否则透明边缘会出现灰色底板；托盘页 `html[data-window="tray-panel"]` 同时去掉 `body` 默认的 `rgba(255,255,255,.33)` 底色。
- **透明度跟随设置**：不写死数值，由设置页「毛玻璃清晰度」（配置键 `glass_clarity`）驱动。`applyGlassClarity()` 同时产出 `--glass-native-opacity`（38%–92%）与 `--glass-native-base`（12%–38%）；清晰度调低→更透，调高→更实。面板每次获得焦点时调一次 `loadTheme()` 重读，因此改完设置再弹出即生效；设置页拖动清晰度滑块还会 `emit("theme-changed")`，面板开着时也能实时跟随。
- 面板尺寸须与 `src-tauri/src/lib.rs::create_full_windows` 的 `inner_size(288, 376)` 保持一致；`tray.rs` 的 `PANEL_WIDTH`/`PANEL_HEIGHT` 仅作为取不到真实窗口尺寸时的定位回退。

## `src/components/update-dialog.tsx`
**职责**：应用更新对话框——打开时检查更新（或恢复进行中的下载状态），展示当前/最新版本、更新渠道、发布日期与 Markdown 风格更新日志，并提供下载按钮与进度提示。
**导出**：`UpdateDialog`（`UpdateDialogProps` 接口定义于同文件 17-20 行但未加 `export`，仅在文件内可见）。
**主要依赖**：`react`、`react-i18next`、`@/components/ui/button`（`GlassButton`）、`@/components/ui/modal`（`GlassModalCompound`）、`@/components/ui/skeleton`（`GlassSkeleton`）、`@/utils/updateService`（`checkForUpdate`、`downloadUpdate`、`getChannel`、`getCurrentUpdateInfo`、`getIsDownloading`、`UpdateCheckResult`、`ChangelogStatus`、`UpdateChannel`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `UpdateDialogProps`（interface） | 17-20 | `isOpen: boolean`、`onOpenChange: (open: boolean) => void` |
| `UpdateDialog`（export） | 22-340 | 对话框主体 |

**内部结构**：
- 25-31 行：`result`、`isChecking`、`isDownloading`、`changelogStatus`、`changelog`、`channel`（默认 `"stable"`）状态。
- 34-80 行：`isOpen` 变化时的 effect——下载中则用 `getIsDownloading()`/`getCurrentUpdateInfo()` 恢复状态并补拉日志（40-59）；否则执行 `checkForUpdate()` 并用 `cancelled` 标记防止竞态（61-79）。
- 82-90 行：`handleDownload`——调用 `downloadUpdate()`，`finally` 复位 `isDownloading`。
- 92-94 行：`handleClose`。
- 96-175 行：`renderChangelog`——`loading` 显示骨架屏（97-106）、`failed`/`unavailable` 显示警告条（108-131）、`success` 按行渲染 `#`/`##`/`- ` 层级（133-172）。
- 177-247 行：`renderVersionInfo`——检查中显示骨架（178-201）；有更新时展示当前版本、最新版本、渠道、发布日期四格（205-246）。
- 249-339 行：`GlassModal` 结构——Backdrop（254）、Header（257-292，含下载图标、标题、版本箭头/骨架）、Body（294-312，版本信息 + 下载中旋转提示 299-308 + 日志）、Footer（314-334，下载中仅一个禁用按钮，否则「稍后」+「下载更新」）。
- 250-253 行：`onOpenChange` 直接透传（下载中允许关闭，下载在后台继续）。

**备注**：本文件不直接 `invoke`/`listen`/`emit`，也不直接读写配置键——所有 Tauri 交互（含更新检查/下载/渠道）封装在 `@/utils/updateService`。window 事件：无。涉及的 `localStorage`/事件均由该 service 内部管理。i18n 键：`settings.update.update_available/checking/current_version/latest_version/channel/release_date/changelog_failed/downloading/downloading_install/later/download_update`、`settings.update_channel.stable/preview`。

## `src/components/system-resource-settings.tsx`
**职责**：全局设置页「系统资源卡片」分区，配置新增系统资源卡片/卡片组时的默认值。
**导出**：`SystemResourceSettings`。
**主要依赖**：`@/utils/systemResourceService`（`getSystemResourceDefaults`/`setSystemResourceDefaults`）、`@/types/system-resource`（`METRIC_ORDER`/`METRIC_CATALOG`/`REFRESH_PRESETS`/`DEFAULT_SYSTEM_RESOURCE_DEFAULTS`）、`@/components/cards/system-resource/color-picker`（预设/自定义色）、`@/components/ui/{settings-row,glass}`。

**配置项**：默认刷新频率、默认单位制式、默认精度、**默认自动翻页间隔**、默认告警阈值（warn/critical）、默认是否显示曲线、默认主题色（预设色/自定义色）、默认卡片组模板（指标多选）。任一改动即时 `setSystemResourceDefaults(patch)` 写入配置键 `system_resource_defaults`。（卡片尺寸由卡片自身的三档预设决定，不再作为全局默认值。）

**备注**：新增卡片/卡片组时由 `dashboard.tsx` + `buildDefaultCardSettings` 读取该配置键；卡片级配置可覆盖全局默认值。i18n 键：`settings.system_resource.*`，选项文案复用 `card:system_resource_*`。

## `src/components/todo-settings.tsx`
**职责**：全局设置页「To-Do 卡片」分区。
**导出**：`TodoSettings`。
**主要依赖**：`@/utils/todoDefaults`（`getTodoDefaults`/`setTodoDefaults`）、`@/types/todo`（`DEFAULT_TODO_DEFAULTS`/`TODO_COLORS`/`TODO_ICONS`）、`@/components/cards/todo/todo-icon`（图标标识渲染）、`@/components/ui/{settings-row,glass}`。

**配置项**：默认排序方式、默认是否隐藏已完成、默认优先级体系（是否启用）、默认是否开启截止时间、默认卡片颜色、默认图标；写入配置键 `todo_defaults`。

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
**职责**：外观设置面板，集中管理主题模式（浅色/深色/跟随系统）、主题色（预设 + 自定义色阶）、窗口背景图（选择/删除/透明度/模糊）与毛玻璃清晰度，并实时写入 CSS 变量与持久化配置。
**导出**：`getAllColors`、`findColorByName`、`AppearanceSettings`（另有未导出的 `ThemeMode`、`ThemeColor`、`PRESET_COLORS`、多个颜色转换函数、`useDragArea`、`generateColorScale`、`applyThemeColor`、`applyGlassClarity`、`applyThemeModeLocal`、`dispatchThemeChange`）。
**主要依赖**：`react`（含 `createPortal`）、`react-i18next`、`@tauri-apps/api/core`（`isTauri`/`invoke`）、`@tauri-apps/api/event`（`emit`）、`@/components/ui/settings-row`（`SettingsDivider`）、`@/components/ui/slider`（`Slider`）、`@/components/screen-color-picker`（`ScreenColorPicker`）、`@/utils/configService`（`getConfig`/`setConfig`）、`@/utils/platform`（`isWindowsPlatform`）、`morphicons/react`（`MorphIcon`）、`lucide`（`Sun`/`Moon`/`Monitor`/`Check`/`Plus`/`Pencil`/`Trash2`/`Pipette`/`ImagePlus`/`X`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ThemeMode`（type） | 31 | `"light" \| "dark" \| "system"` 主题模式字面量类型 |
| `applyGlassClarity(clarity)` | 33-45 | 将 0-100 清晰度换算为模糊/不透明度，写入 `--glass-blur`、`--glass-surface-opacity`、`--glass-strong-opacity`、`--glass-field-opacity` |
| `ThemeColor`（interface） | 47-63 | `name`/`label`/`colors`（50-900 十级 + `foreground`） |
| `PRESET_COLORS` | 65-168 | 6 组内置主题色：indigo、blue、emerald、rose、amber、slate |
| `hexToHsl(hex)` | 170-187 | HEX → HSL（度/百分比取整） |
| `hslToHex(h,s,l)` | 189-201 | HSL → HEX |
| `hexToRgb(hex)` | 203-210 | HEX → `{r,g,b}` |
| `rgbToHex(rgb)` | 212-215 | `{r,g,b}` → HEX |
| `hexToHsv(hex)` | 217-232 | HEX → HSV |
| `hsvToHex(h,s,v)` | 234-254 | HSV → HEX |
| `useDragArea(onPosition)` | 256-301 | 指针拖拽 hook，返回 `{ref, onPointerDown, onPointerMove, onPointerUp, onPointerCancel}`，回调归一化 0-1 的 `(left, top)` |
| `generateColorScale(hex)` | 303-320 | 由单色生成 50-900 色阶（500 为原色，foreground 固定白） |
| `applyThemeColor(colors)` | 322-336 | 写入 `--primary-50`…`--primary-900`、`--primary`、`--primary-foreground` |
| `getAllColors(customColors)`（export） | 338-340 | 预设色 + 自定义色合并列表 |
| `findColorByName(name, customColors)`（export） | 342-347 | 按 `name` 查找颜色（仓库内暂无调用方） |
| `AppearanceSettings`（export） | 349-1450 | 主组件，无 props；内部状态与处理函数见下表 |
| `applyThemeModeLocal(mode)` | 1452-1457 | 按模式/系统深色切换 `<html>` 的 `dark` class |
| `dispatchThemeChange()` | 1459-1461 | 派发 window `CustomEvent("themeChange")` |

**内部结构**：
- 1-30 行：导入（React hooks、`createPortal`、i18n、Tauri `invoke`/`isTauri`/`emit`、`SettingsDivider`、`Slider`、`ScreenColorPicker`、`getConfig`/`setConfig`、`MorphIcon`、lucide 图标）。
- 31-45 行：`ThemeMode` 类型与 `applyGlassClarity`。
- 47-168 行：`ThemeColor` 接口与 `PRESET_COLORS` 常量数据。
- 170-254 行：六组颜色空间转换纯函数（HSL/RGB/HSV ↔ HEX）。
- 256-301 行：`useDragArea` 拖拽 hook（用于取色面板）。
- 303-347 行：色阶生成、主题色变量应用、两个导出工具函数。
- 349-389 行：组件状态声明（主题模式/颜色/自定义色、取色器显隐与坐标、Hex/RGB 草稿、编辑中的颜色、右键菜单、屏幕取色开关、背景图路径/预览/透明度/模糊、玻璃清晰度、默认值常量、文件输入 ref）。
- 391-476 行：取色器交互——`pickerHex` → RGB 草稿同步（391-394）、`applyHex`（396-399）、饱和度/亮度与色相拖拽回调（401-420）、RGB 输入处理（422-431）、`repositionPicker` 浮层定位（433-456，面板按 264×460 预估并做上下翻转）、草稿同步 effect（458-462）、布局 effect（464-466）、resize/scroll 监听（468-476）。
- 478-536 行：`loadConfig`——并行读取 7 个配置键，应用 CSS 变量，调用 `invoke("read_image_file")` 读取背景图字节并生成 objectURL 写入 `--bg-image`。
- 538-552 行：监听 window `themeChange`，重新拉取主题配置以保持高亮同步。
- 554-571 行：主题色/模式应用 effect；`system` 模式下监听 `prefers-color-scheme` 变化并 `emit("theme-changed", "system")`。
- 573-588 行：取色器点击外部/滚动关闭（屏幕取色打开时不关闭）。
- 590-617 行：`handleModeChange`（写配置、派发事件、淡出淡入切换）、`handleColorChange`。
- 619-726 行：`convertToWebP`、背景图选择/删除、背景图透明度与模糊的修改与重置、玻璃清晰度修改与重置（均写 CSS 变量 + 配置键）。
- 728-835 行：`handleSaveCustom`（新增/编辑自定义色）、`handleDeleteCustom`（删除并回退到 indigo）、`openPicker`/`closePicker`、`handleScreenPick`、`handlePickFromScreen`（Tauri 走原生截图覆盖层，浏览器走 `EyeDropper`）。
- 837-858 行：`isLoading` 时返回 `null`；`modeOptions` 三选项（浅/深/系统，含图标）；计算当前 HSV。
- 860-888 行：主题模式分段按钮 UI。
- 890-1296 行：主题色区块——预设色行（903-937）、自定义色行与右键菜单入口（939-976）、新增按钮（977-985）、取色器 portal（987-1236：SV 面板 1006-1050、色相条 1052-1097、预览 + Hex 输入 1099-1173、屏幕取色按钮 1159-1172、RGB 输入 1175-1209、名称输入 1211-1217、取消/保存按钮 1219-1232）、自定义色右键菜单 portal（1243-1286）、`ScreenColorPicker` portal（1288-1295）。
- 1298-1413 行：背景图区块——隐藏 file input（1311-1318）、预览与移除按钮（1320-1343）、不透明度滑杆（1345-1371）、模糊滑杆（1373-1399）、无图时的虚线选择按钮（1401-1412）。
- 1415-1447 行：毛玻璃清晰度滑杆 + 重置按钮。
- 1452-1461 行：文件末尾的 `applyThemeModeLocal` 与 `dispatchThemeChange`。

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
| 毛玻璃清晰度（0-100） | `glass_clarity` | `Slider` + 重置按钮 | 715-726，UI 1417-1447 |

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
**主要依赖**：`react`（`FC`）、`morphicons/react`（`MorphIcon`）、`lucide`（`Sun`、`Moon`）、`@/utils/configService`（`getConfig`、`setConfig`）、`@tauri-apps/api/event`（`emit`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ThemeMode`（type） | 7 | `"light" \| "dark" \| "system"` |
| `ThemeSwitchProps`（export interface） | 9-11 | `className?: string` |
| `getSystemDark()` | 13-15 | 读取 `prefers-color-scheme: dark` |
| `applyThemeMode(mode)` | 17-21 | 切换 `<html>` 的 `dark` class |
| `resolveEffective(mode)` | 24-27 | `system` 解析为当前实际生效的浅/深 |
| `ThemeSwitch`（export） | 29-111 | 圆形切换按钮 |

**内部结构**：
- 30-32 行：`isMounted`、`themeMode`、`btnRef` 状态。
- 34-43 行：初始化——读 `theme_mode`、应用主题、置 `isMounted`。
- 46-55 行：监听 window `themeChange` 回读配置并应用（与设置页双向同步）。
- 58-67 行：`system` 模式下监听系统深浅变化，应用并 `emit("theme-changed", "system")`。
- 70-94 行：`toggleTheme`——解析当前有效模式，浅↔深切换，写 `theme_mode`、派发 `themeChange`、`emit("theme-changed", ...)`，再做 170ms 淡出 → 应用 → 40ms 淡入。
- 96-110 行：未挂载时渲染占位 `div`；否则渲染带 `Sun`/`Moon` 图标的按钮（含 `aria-label`）。

**备注**：`invoke`：无；`listen`：无；Tauri `emit`：`theme-changed`（63、77）；window 事件：监听 `themeChange`（53）、派发 `themeChange`（76）；配置键 `theme_mode`（读 36/48，写 75）。未使用的 `btnRef` 仅绑定在按钮上。

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
**职责**：应用内嵌浏览器覆盖层——玻璃工具栏（前进/后退/刷新/地址栏/关闭）+ 加载进度条 + 沙箱 `iframe`，开合与地址由 `@/stores/inAppBrowser` 状态驱动。
**导出**：`InAppBrowser`。
**主要依赖**：`react`、`@/stores/inAppBrowser`（`isBrowserOpen`、`getInAppBrowserUrl`、`closeInAppBrowser`、`navigateInAppBrowser`、`subscribeInAppBrowser`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `InAppBrowser`（export） | 10-167 | 无 props；未打开时返回 `null` |

**内部结构**：
- 11-15 行：`isOpen`/`url`/`inputValue`/`loading` 状态与 `iframeRef`。
- 17-26 行：订阅 store，变化时同步开关、地址、输入框并置 `loading=true`。
- 28-30 行：`url` 变化时同步输入框。
- 32-34 行：`handleClose` 调 `closeInAppBrowser()`。
- 36-50 行：`handleBack`/`handleForward` 尝试操作 `iframe.contentWindow.history`，跨域异常静默忽略。
- 52-57 行：`handleRefresh` 重设 `iframe.src = url` 并置加载中。
- 59-69 行：`handleNavigate`——去空格、无协议自动补 `https://`，写 store 并置加载中。
- 71-76 行：回车触发导航。
- 78 行：`!isOpen` 时返回 `null`。
- 81-147 行：玻璃工具栏（后退 85-94、前进 97-106、刷新 109-118、地址栏 121-134、关闭 137-146，图标为内联 SVG）。
- 150-154 行：`loading` 时的顶部脉冲进度条。
- 157-164 行：`iframe`（`sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals allow-downloads"`，`onLoad` 关闭 loading）。

**备注**：无 `invoke`、无 `listen`、无 `emit`、无配置键；开合状态完全来自 `@/stores/inAppBrowser` 的订阅。注意：前进/后退依赖同源，跨域时静默失败；地址栏导航不改写浏览器 history（仅 store + iframe）。

## `src/components/tray-panel.tsx`
**职责**：系统托盘悬浮面板——展示当前用户（头像/昵称/等级）、理智、每日活跃、每周事务、通行证四项进度与理智恢复倒计时，并提供「显示窗口」「退出」两个操作。
**导出**：`TrayPanel`。
**主要依赖**：`react`、`@tauri-apps/api/core`（`invoke`）、`@tauri-apps/api/window`（`getCurrentWindow`）、`@tauri-apps/api/event`（`listen`）、`@/utils/imageLoader`（`Img`）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `TrayUserInfo`（interface） | 7-20 | `roleId`、`nickname`、`avatar`、`curStamina`/`maxStamina`/`maxTs`、`dailyActivation`/`maxDailyActivation`、`weeklyScore`/`weeklyTotal`、`bpCurLevel`/`bpMaxLevel` |
| `formatRecoveryTime(maxTs)` | 22-30 | 秒级时间戳 → `HH:MM:SS` 倒计时，已到点返回 `"已满"` |
| `StatItem`（内部组件） | 32-70 | props：`icon: ReactNode`、`label: string`、`cur: number`、`max: number`、`recovery?: string`；渲染进度条与百分比 |
| `TrayPanel`（export） | 72-231 | 面板主体，无 props |

**内部结构**：
- 73-74 行：`userInfo`、每秒 tick 的 `now`（用于倒计时刷新）。
- 76-83 行：`loadUserInfo`——`invoke("get_tray_user_info")`，失败静默。
- 85-106 行：mount effect——初始加载、`listen("tray-user-info-updated")` 更新数据、`getCurrentWindow().onFocusChanged` 失焦即 `win.hide()`、1 秒定时器；清理时依次解绑。
- 108-112 行：派生值（`hasUser`、当前/上限体力、恢复倒计时）。
- 114-121 行：`handleShowMain`——`invoke("show_main_window")`，失败则隐藏自身窗口。
- 123-129 行：`handleQuit`——`invoke("app_quit")`，失败则 `getCurrentWindow().app.exit(0)`。
- 131-207 行：渲染头部（ENDPROTOCOL 标题）、用户区（头像/昵称/Lv、分隔线、四个 `StatItem`：理智 169-175、每日活跃 176-181、每周事务 182-187、通行证 188-193）或未选用户占位（196-203）。
- 205-228 行：分隔线与菜单按钮（显示窗口 210-218、退出 219-227，均内联 SVG 图标）。

**备注**：
- `invoke` 命令：`get_tray_user_info`（78）、`show_main_window`（116）、`app_quit`（125）。
- `listen` 事件：`tray-user-info-updated`（88，payload 为 `TrayUserInfo`）。
- 窗口事件：`getCurrentWindow().onFocusChanged`（93，失焦隐藏）。
- 无配置键、无 `emit`；文案（"理智"、"每日活跃"、"每周事务"、"通行证"、"未选择用户"、"显示窗口"、"退出"、"已满"）为硬编码中文，未走 i18n。

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

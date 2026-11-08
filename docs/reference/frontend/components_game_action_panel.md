# 游戏操作面板 game-action-panel.tsx — 功能参考

> 逐行精读源码生成。行号仅用于快速定位，可能滞后于当前代码（本文件已在多处漂移，例如 `ButtonProgressRing` 实际在 110 行），定位符号时请以符号名为准。

**文件职责**：Windows 游戏启动器主操作面板，聚合「定位游戏目录 → 检测渠道 → 安装/更新/校验/修复/预载 → 启动/停止游戏 → 切换渠道」全流程，并提供下载进度浮层、确认对话框、磁盘空间预检、累计游戏运行时长徽章与设置入口。仅 Windows 的 dashboard 游戏模式会挂载该组件；Linux/macOS 不显示游戏入口。渠道列表同时承载《明日方舟：终末地》与《明日方舟》，按 `GAME_ORDER` / `GAME_CHANNELS` 分组渲染。

**导出**：`GameActionPanel`（接受可选 props `game`，见下）；类型 `GameActionPanelProps`。

**主要依赖**：
- 项目内：`@/components/ui/modal`（`GlassAlertDialogCompound`、`GlassModalCompound`）、`@/components/ui/button`（`GlassButton`）、`@/components/ui/elapsed-time`（`ElapsedTime`，累计时长平滑显示）、`@/utils/launcherService`（全部 Tauri 后端调用与事件订阅的封装）、`@/utils/messageStore`（`addMessage`）、`@/components/game-launch-settings`（`QuickLaunchModal`、`GameLaunchSettingsFields`、`readDownloadThreads`、`readDownloadResume`、`readDx11`、`setDx11Setting`、`GAME_LAUNCH_SYNC_EVENT`）、`@/components/ui/settings-row`（`SettingsDivider`）。
- 第三方：React（`useState`/`useEffect`/`useLayoutEffect`/`useRef`/`useCallback`）、`react-dom`（`createPortal`）、`react-i18next`（`useTranslation`）。Tauri API 不直接引用，全部经 `launcherService` 间接调用。

## 内部结构总览

| 区间 | 内容 |
| --- | --- |
| 1–47 | import：React 钩子（含 `ReactNode`）、Portal、i18n、UI 组件、launcherService 全量接口、messageStore、启动设置弹窗 |
| 70–90 | 4 个 localStorage 键常量（70–73）+ 面板统一按钮风格常量 `PILL_BASE`/`PILL_INTERACTIVE`/`PILL_TEXT`（86–90：底色走 `.lg-media-chip` 玻璃 + `lg-hairline` 细边，文字白色系；交互态在 `PILL_INTERACTIVE` 上叠加 `lg-media-chip-interactive`（给媒体层胶囊设 1.08/0.94 两档提亮强度）+ `lg-glass-interactive`（把 brightness 加在 `::before` 玻璃层上）——**宿主不得带 `filter`**，否则按钮一悬停就从毛玻璃退化成半透明色，理由见 [types_locales_styles.md](types_locales_styles.md) 的「backdrop root 约束」） |
| 93–347 | 本文件内部工具与子组件：`formatEta`(93)、`ButtonProgressRing`(110)、`DownloadArrowIcon`(183，下载/安装中按钮里的「下落箭头」图标)、`ProgressFlyout`(211)、`DownloadProgressBody`(236)、`DiskSpaceBar`(284) || 349–3131 | `GameActionPanel` 组件声明与 30+ 个 useState / useRef 初始化（含 `dx11`、`carouselIndex` 状态，与设置页同步） |
| 301–387 | 确认对话框状态、`activeOp`/`progress`/`preparing`/`switching`/`switchProgress`/`switchTarget` 派生值 |
| 340–440 | 渠道持久化、状态查询 `checkStatus`、渠道自动检测 effect、静默刷新 `refreshStatus`、游戏运行 3 秒轮询；累计时长 5 秒轮询 `refreshPlaytime`（平滑补间见 `ElapsedTime`） |
| 441–545 | 进度事件订阅 effect（下载/校验/预下载/切换速度计算、完成态清理） |
| 548–588 | 菜单浮层外部点击/滚动关闭 effect |
| 590–980 | 业务处理器：定位、安装、渠道选择、渠道切换、启动、更新、校验、取消、预下载确认/开始/取消、杀进程 |
| 982–1006 | 阶段标志派生（含 `preloading`/`preloadPercent`/`busyWithDownload`） |
| 1008–1044 | 三个 `useLayoutEffect`（主按钮浮层 / 预下载浮层 / 菜单浮层定位） |
| 1046–1254 | 主按钮文案 `getButtonLabel`、标签变更触发动效（`animate-fade-in`，现已纯位移、无淡入）、图标 `getButtonIcon` |
| 1256–1373 | 主按钮点击分发 `handleButtonClick`、确认回调 `handleConfirmAction` |
| 1376–1552 | JSX 操作行：累计时长徽章（操作行首个子元素，位于开始游戏按钮左侧）+ 主操作按钮 + 预下载按钮（预下载/预下载中/已预下载）+ 预下载进度浮层、汉堡菜单按钮；DX11 快捷勾选（`@/components/ui/checkbox` 的方形 `Checkbox`，`[&>span]:rounded-[4px]` 收小圆角，与设置页 `launcher_dx11` 同步）**绝对定位悬浮于主按钮下方**（`absolute left-[5px] top-full`，不参与操作行布局、不把按钮顶起，且与按钮左边缘对齐）；右上角状态栏（绝对定位在内容层右上角，1545–1578，纵向堆叠：服务器指示徽章 + 检测中指示，点击渠道徽章开切服对话框） |
| 1554–1880 | 主按钮进度浮层（Portal）：准备/下载/校验/比较/修复/应用/切换 7 类进度展示 |
| 1882–1884 | 汉堡菜单按钮（启动设置入口已并入菜单，不再单独占位） |
| 1882–2060 | 汉堡菜单浮层（Portal）：游戏设置、启动设置、校验完整性、快速校验、清理临时文件、定位游戏 |
| 2062–2081 | `QuickLaunchModal`、`GameSettingsModal` 条件挂载（quickLaunchOpen 状态） |
| 2081–2423 | 通用确认对话框（5 种 confirmAction 分支 + 「不再提示」复选框） |
| 2426–2517 | **预下载确认对话框**：提示将占用的磁盘空间（复用 `DiskSpaceBar`），空间不足禁用确认 |
| 2520–2597 | 渠道选择对话框（首次安装、无法自动检测时）：按游戏分两组渲染，标题取 `launcher.game_group_{endfield,arknights}`，徽标取 `CHANNEL_SHORT` |
| 2600–2778 | 扫描结果 + 磁盘空间占用条对话框（同样复用 `DiskSpaceBar`） |
| 2781–2858 | 渠道切换：目标渠道选择对话框（候选来自 `switchableChannels(detectedChannel)`，两个游戏都返回候选——实测明日方舟官/B 服差异完整在清单里；含 `switch_channel_account_warning` 账号不互通提示） |
| 2861–2901 | 渠道切换确认对话框 |
| 2928–3012 | `GameSettingsModalProps` 接口与 `GameSettingsModal` 内部组件（未导出）：安装路径 + `GameLaunchSettingsFields` 共享设置，容器 `size="lg"`；`Dialog` 限制最大高度 `calc(100vh-3rem)` 并让 `Body` 内部滚动 |

## 组件与函数清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `STORAGE_BASE_CHANNEL` | 89 | `"launcher_channel"`（渠道的分区键；安装路径的分区键交给 `launcherService.persistInstallPath` / `persistDetectedInstall`） |
| `STORAGE_KEY_SKIP_STOP_CONFIRM` | 90 | `"launcher_skip_stop_confirm"`，停止游戏不再确认 |
| `formatEta` | 93–100 | 内部工具：剩余秒数 → `m:ss` / `h:mm:ss` |
| `ButtonProgressRing` | 110–181 | 内部组件：环绕主按钮/预下载按钮描边的百分比进度环，按按钮实测尺寸画胶囊路径（见「进度环形状」） |
| `DownloadArrowIcon` | 183–209 | 内部组件：下载/安装中按钮里的图标——静止托盘 + 循环向下滑出的箭头（`.launcher-download-arrow`，定义在 `globals.css`） |
| `ProgressFlyout` | 211–234 | 内部组件：进度浮层外壳（`createPortal` + 玻璃样式 + 边界翻转），安装/校验/预下载共用。材质为 `.lg-media-chip lg-hairline border`（媒体层：深 tint 固定、白字恒可读）——不能用 `.lg-regular`：浅色主题下半透白底会淹没内容里写死的 `text-white/*` 白字 |
| `DownloadProgressBody` | 236–282 | 内部组件：浮层里的下载型内容（已下载/总量、进度条、速度、剩余时间、当前文件） |
| `DiskSpaceBar` | 284–347 | 内部组件：磁盘占用三色条（已用/需要下载/下载后剩余），安装确认与预下载确认共用 |
| `GameActionPanel` | 349–3131 | 导出组件主体。props `{ game?: LauncherGame }`：传了就**钉死**在那个游戏上（整页推移时旧页要显示旧游戏的安装状态），不传则跟随全局 store 变化 |
| `GameActionPanelProps` | — | `{ game?: LauncherGame }` |
| `checkStatus` | 173–196 | `useCallback`：查询游戏状态并置 `statusReady` |
| `refreshStatus` | 241–252 | `useCallback`：静默刷新，供进度完成后调用 |
| `checkRunning` | 259–266 | `useCallback`：查询游戏是否在运行 |
| `refreshPlaytime` | 549–556 | `useCallback`：调 `getGamePlaytime` 刷新 `playtime` 快照；失败保留上一次快照。快照之间的平滑推进交由 `ElapsedTime` 内部按真实流逝时间补间 |
| `handleLocate` | 590–610 | 选择目录、持久化、检测渠道 |
| `startInstall` | 612–631 | 执行安装/更新：`installOrUpdate` 透传 `readDownloadThreads()` 与 `readDownloadResume()`，成功后自动做一次 quick 校验 |
| `handleInstall` | 633–681 | 首次安装编排（选目录 → 检测渠道 → 缓存续传/渠道选择） |
| `handleChannelSelected` | 683–717 | 渠道选定后并行扫描目录与磁盘空间，弹扫描结果 |
| `handleSwitchChannel` | 719–727 | 记录切换目标，转确认态（两个游戏的渠道均可达，候选由 `switchableChannels` 决定） |
| `handleConfirmSwitch` | 729–784 | 先查游戏进程（`checkGameRunning(detectedChannel)`，同游戏各渠道进程名相同），在跑发 warn 消息拦截；否则定位进度浮层坐标并执行渠道切换，失败发 urgent 消息 |
| `handleStart` | 820–876 | 启动游戏（无路径时先定位并检测渠道）；调用 `startGame(installPath, channel, readDx11())`，把返回结果按 `<token>: <detail>` 契约转成 `addMessage` 提示（失败 → urgent，回退 → warn） |
| `formatVerifyResult` | 881–908 | 解析校验结果 JSON，生成 i18n 文本与 info/warn 级别 |
| `handleUpdate` | 914–979 | 更新；优先安装官方补丁（`installPreload`）否则 `installOrUpdate`，两者均透传下载线程数与续传设置，成功后执行快速校验；失败分别提示更新或校验错误 |
| `handleVerify` | 981–1004 | 完整校验（线程数取 `launcher_verify_threads`，默认 12） |
| `handleQuickVerify` | 1006–1029 | 快速校验（`quick=true`） |
| `markDownloadCancelled` | 1254–1260 | `useCallback`：取消下载时立刻清按钮下载态（`cancellingRef=true`、`userCancelledRef=true`、`setLocalActiveOp(null)`、速度归零 + `speedRef` 重置）。`keep` / `delete` / 确认框三条取消路径统一走它，否则按钮会停在下滑的下载图标上 |
| `handleCancel` | 1262–1267 | 取消当前下载/校验：`markDownloadCancelled()` → `cancelDownload(installPath)` → `refreshStatus()` |
| `handlePreload` | 1042–1065 | 预下载官方预发布补丁分卷（**由确认框确认后调用**）：先置 `preloadProgress`（0/总量）并重置取消标志，调 `preloadDownload` 并透传下载线程数与续传设置；`finally` 清 `preloadProgress` + 刷新状态 |
| `handlePreloadCancel` | 1067–1075 | 取消预下载（点「预下载中/取消预下载」按钮触发）：按「取消下载行为」决定保留/删除分卷，不动主按钮状态 |
| `handlePreloadClick` | 1077–1087 | 点「预下载」按钮：拉取 `getDiskSpace` 并打开预下载确认框 |
| `updatePreloadFlyoutPos` | 1089–1101 | 依 `preloadBtnRef` 计算预下载进度浮层坐标（与主按钮同一套边界处理） |
| `handleKill` | 1221–1236 | 调 `killGame` 杀掉游戏进程后 `checkRunning` + `refreshPlaytime` 刷新运行态与时长；**失败不再静默**：`killGame` reject 时按 `<token>: <detail>`（token 见 `KILL_TOKEN_KEYS`）弹 `launcher.stop_failed_title` 消息（tag `stop-error`），说明需要管理员授权（`cancelled`）或进程被反作弊保护（`kill_failed`） |
| `handleToggleDx11` | 1147–1152 | 方形复选框点击处理：写入本地 `dx11` 状态并经 `setDx11Setting` 同步到 localStorage + `launcher_dx11` 后端配置，并派发 `GAME_LAUNCH_SYNC_EVENT` 让设置页实时同步 |
| `getButtonLabel` | 1050–1080 | 依状态返回主按钮文案（hover 时切为取消类文案；预下载不参与）。**状态还没查到时返回 `launcher.checking`（「检查状态中...」）而不是「安装游戏」**：`is_installed` 的默认值是 false，切换游戏后重新查状态的那一百多毫秒里，按钮会先闪一下「安装游戏」再跳回「启动游戏」 |
| `getButtonIcon` | 1084–1254 | 依状态返回 SVG 图标（旋转/暂停/下载/刷新/播放） |
| `handleButtonClick` | 1256–1299 | 主按钮统一分发：取消切换/停止/取消校验/取消下载/安装/更新/启动 |
| `handleConfirmAction` | 1301–1373 | 确认对话框回调，按 5 种 `confirmAction` 分支执行 |
| `GameSettingsModalProps` | 2928–2932 | 内部弹窗 props 类型：`initialPath`、`onClose`、`onSave(path)` |
| `GameSettingsModal` | 2934–3012 | 游戏设置弹窗：安装路径 + 浏览，分隔线后渲染 `GameLaunchSettingsFields`（取消下载行为 / DX11 启动 / 下载线程数 / 断点续传 / 校验线程数 / 背景媒体，与设置页实时同步）；`handleBrowse` 于 2942–2945；容器 `size="lg"`（720px）以避免控件换行；`Dialog` 为 `flex-col max-h-[calc(100vh-3rem)] overflow-hidden`，Header/Footer 固定、`Body` 为 `min-h-0 flex-1` 内部滚动 |

## 关键功能分区

**常量与状态初始化（47–166）**
4 个 localStorage 键常量 + 统一按钮风格常量 `PILL_BASE`/`PILL_INTERACTIVE`/`PILL_TEXT`（86–90，面板内所有胶囊按钮共用，与预下载按钮及左下 banner 同为 `.lg-media-chip` 玻璃层；运行/切换态的 `border-danger`/`text-danger` 用 `!` 强制覆盖基类）；状态包括：`channel`、`gameStatus`、`localActiveOp`、`installPath`、`detectedChannel`、`detecting`、`statusReady`、`flyoutOpen`、`hasTempFiles`、`settingsOpen`、`launchSettingsOpen`、`gameRunning`、`btnHovered`、`btnLabelKey`、`preloadProgress`、`downloadSpeed`、`channelSelectOpen`、`pendingInstallPath`、`scanResult`、`scanOpen`、`scanning`、`diskSpace`、`switchOpen`、`switchConfirmTarget`、`verifySpeed`、`progressFlyoutPos`、`menuFlyoutPos`、`confirmAction`、`confirmCheckbox`、`playtime`；refs：`prevBtnLabelRef`、`flyoutRef`、`btnRef`、`hamburgerRef`、`speedRef`、`verifySpeedRef`、`cancellingRef`、`menuFlyoutRef`。派生值 `activeOp`（132，本地事件优先于轮询值）、`progress`（133–147）、`preparing`（148）、`switching`（151）、`switchProgress`（152–164）、`switchTarget`（165）；安装相关派生值 `isInstalled`/`hasUpdate`/`hasPreload`/`preloadCompleted`（782–785）、`preloadTotalBytes`（744，提前声明供 `handlePreload` 依赖数组使用）、`preloading`/`preloadPercent`（787–795）、`busyWithDownload = isActionRunning || preloading`（811，用于禁用渠道徽章与菜单项）。

**状态查询与渠道自动检测（168–272）**
渠道写入 localStorage（168–170，**只写属于当前游戏的渠道**：`CHANNEL_GAME[channel] !== game` 时跳过，否则会把外来的渠道塞进本分区）；挂载时经 `restoreLaunchConfig` 从 app config 反向回灌 `launcher_install_path`/`launcher_channel` 到 localStorage 与 state（仅挂载一次，路径需存在才写——修复静默命令行启动后从托盘打开完整版时游戏面板显示「定位游戏」的问题；**回灌的渠道必须属于当前游戏**才采用）；`checkStatus` 触发 effect（254–256）；`detectChannel` effect（199–238，**每次都实打实问后端一遍，不用「路径 + 渠道」的本地缓存短路**）；`checkGameRunning` 每 3 秒轮询（268–272）。

**渠道识别的正确性约束（目录与渠道必须同属一个游戏）**
两个游戏的安装路径与渠道各存一份（`launcher_install_path[_arknights]` / `launcher_channel[_arknights]`）。分区里存的是「路径 + 渠道」一对，**两者必须指向同一个游戏**：错位时后端 `check_status` 拿错渠道去拼 exe 名（`Endfield.exe` / `Arknights.exe`），`is_installed` 恒为 false，界面就一直显示「安装游戏」而不会显示「启动游戏」。

三处曾经会让这一对错位，现在都被堵住：

1. **自动检测 effect 不再用缓存短路**（原来 `cachedPath === installPath && cachedChannel !== null` 就直接采用缓存渠道，根本不问后端）。缓存里的渠道可能属于另一个游戏，也可能目录早换了而缓存没更新——两种情况都会让渠道永久错位。现在每次都调 `detectChannel` 重新识别。
2. **`detectedChannel` 不再由缓存初始化**：它的含义是「这个目录**识别出来**是哪个渠道」，与「上次用哪个渠道」（缓存）不是一回事。切游戏时也只置 `null`，由上面的 effect 重新识别。
3. **落盘统一走 `launcherService.persistDetectedInstall` / `persistInstallPath`**：按**渠道的归属游戏**写分区（不是「面板当前看的那个游戏」），同时清掉另一个分区里指向同一目录的旧路径与那个「不属于自己」的渠道；localStorage 与后端 `app_config.json` 双写（后端那一份是静默启动 / 快捷方式的真正依据，只改 localStorage 会被下次启动的 `restoreLaunchConfig` 搬回旧值）。识别出的渠道属于另一个游戏时，调用方顺带 `setActiveGame(owner)` 把当前游戏切过去。

`handleLocate` / `handleInstall` / `handleStart`（选目录后的识别）与 `handleChannelSelected`（渠道选择框）都走同一条落盘路径；`handleConfirmSwitch`（换服）同理。`restoreLaunchConfig` 与 `syncSilentLaunchConfig` 各自再加一道「渠道属于该游戏」的校验，挡住外来渠道在配置往返中混进分区。

**累计游戏运行时长（401–407, 549–561, 1664–1676）**
后端在 EndProtocol 运行期间统计游戏在线时长。前端 `refreshPlaytime`（549）挂载时调用并每 5 秒轮询 `getGamePlaytime`，写入 `playtime` 快照（`GamePlaytime {total_seconds, session_seconds, running}`，`total_seconds` 不含当前会话）；派生值 `playtimeTotal = total_seconds + session_seconds`（405–407）即快照时刻的累计总时长。展示由 `@/components/ui/elapsed-time` 的 `ElapsedTime` 承担：组件内部用 `requestAnimationFrame` 按真实流逝时间推算秒数，仅在跨越整秒时更新 state（避免每帧重渲染），并按位渲染 `h:mm:ss`，某一位变化时该位单独播放上滑淡入（`.elapsed-digit`，CSS 定义在 `src/styles/globals.css`），因此每秒是「一位平滑滚动」而非整串硬跳；新快照到达时以已展示秒数为下限重新锚定，**数字只会前进不会回退**；`prefers-reduced-motion` 下退化为逐秒切换。`handleKill`（1238）杀进程后同步刷新。徽章位于操作行内、开始游戏按钮左侧（`flyoutRef` 容器首个子元素），仅以时钟图标 + `ElapsedTime` 显示累计总时长文本（**无文字标签、不展示本次会话**），并随运行实时增长；仅 `isInstalled && playtime` 时渲染。`running` 传参取自 `gameRunning`（3 秒轮询的运行态），而非 `playtime.running`（5 秒轮询），以便启动/停止后更快切换补间。**已移除**旧的 `playtimeTick` 每秒整数自增与 `formatPlaytime` 文本格式化函数。

**进度事件与速度计算（441–545）**
`onLauncherProgress`：`stage === "preloading"` 时只写 `preloadProgress` 并用 `speedRef` 差分算预下载速度；其余事件先清 `preloadProgress`，再写入 `localActiveOp`（`downloading`/`repairing` 算下载速度——采样窗口 1 秒并对窗口均值做指数平滑，见「速度采样与数字节流」、`verifying` 用 `getProcessReadBytes` 差分算校验速度、`completed`/`error` 清空并 500ms 后 `refreshStatus`）。`onSwitchProgress`：切换阶段同理（同样 1 秒窗口 + 平滑）。清理时解除两订阅。

**定位与安装（590–717）**
`handleLocate` 走 `browseFolder` + `detectChannel`；`handleInstall` 分三路：无路径 → 选目录后检测（有缓存弹 `resume-install`，检测失败弹渠道选择）、有路径但未检测到渠道 → 弹渠道选择、已检测 → 缓存续传或直接安装；`handleChannelSelected` 并行 `scanInstallDir` + `getDiskSpace`，失败则退回缓存判断流程。

**渠道切换（719–774, 2781–2901）**
选择器（2781）→ `handleSwitchChannel` 记录目标 → 确认框（2861）→ `handleConfirmSwitch` 计算浮层位置、调用 `switchChannel`、成功后同步 `channel`/`detectedChannel`/localStorage 并 `checkStatus`，失败经 `addMessage` 发 `switch-error` 紧急消息。切换中主按钮点击触发 `cancelSwitch`。右上角渠道徽章对两个游戏都可点击（终末地与明日方舟统一走同一入口）。

**启动 / 停止（776–804, 973–976, 1256–1299）**
`handleStart` → `startGame`（附带 `readDx11()`；启用时后端给游戏进程追加 `-force-d3d11`）。成功且带 `warning` 时提示 `launcher.launch_fallback_body`；失败时按 token 映射 `launcher.launch_err_*`。运行中点击主按钮：`launcher_skip_stop_confirm === "1"` 直接 `handleKill`，否则弹 `stop-game` 确认框（可勾选不再提示）。

**校验 / 修复 / 预载（881–1101, 2458–2549）**
`handleVerify`（完整）、`handleQuickVerify`（快速，菜单直连）、`startInstall` 与 `handleUpdate` 成功后自动 quick 校验；结果经 `formatVerifyResult` 转 `verify-result` 消息。官方补丁安装直接应用后进入快速校验，不先执行额外的全量 MD5 扫描。

预下载按钮（`hasPreload && isInstalled` 时显示）有三种形态，全部使用 `PILL_BASE`：

1. 未开始 → 「预下载」按钮：点击先走 `handlePreloadClick`（`getDiskSpace` + 预下载确认框，展示将占用的空间），确认后才调用 `handlePreload`；
2. 进行中（`preloadProgress` 非空）→ 「预下载中 N%」按钮，按钮周围显示从正上方开始顺时针环绕的百分比进度环；**鼠标悬停时文案切成「取消预下载」、按钮背景显示透明浅红，并弹出预下载进度浮层**（`ProgressFlyout` + `DownloadProgressBody`，与安装/校验同一外观，含已下载/总量、进度条、速度、剩余时间与「取消预下载」提示），点击触发 `handlePreloadCancel` 取消；
3. 已完成且不可直接安装 → 「已预下载」标记（`preload_completed`）；若 `preload_installable` 为 true 则不显示完成标记，主按钮显示更新图标并执行预下载安装。

预下载进度由 `launcher-progress` 事件里 `stage === "preloading"` 的事件写入 `preloadProgress`，**不写入 `localActiveOp`**：所以预下载期间主按钮保持「启动游戏」、主按钮浮层不弹出；收到任何非 `preloading` 的进度事件即清空 `preloadProgress`（后端操作串行，不会与安装/校验并发）。预下载期间 `busyWithDownload` 为真，渠道徽章、菜单里的校验/快速校验/清理临时文件被禁用，主按钮仅在「有更新（要发起安装）」时禁用。

当 `GameStatus.preload_installable` 为 true 时，后端将 `has_update` 置为 true。点击主更新按钮调用 `launcher_install_preload`：取到最新补丁信息后直接进入分卷下载阶段，并将同一份信息复用于安装流程，避免重复查询导致停留在「准备中」；复用或下载并校验分卷、后端使用 API 提供的 cd_key 解压并应用文件；安装完成后前端再执行快速校验与修复。分卷未下载时同样自动先下载。

**下载取消策略（1288–1405, 2113–2455）**
`launcher_cancel_behavior`：`keep` → 不带路径 `cancelDownload()`（保留文件）、`delete` → 带路径删除临时文件、`ask` → 弹 `cancel-download` 对话框（保留/删除两按钮）。预下载的取消按钮直接读同一设置（`keep` 保留分卷供续传，其余删除），不弹对话框。

**取消后按钮状态（曾经的「下载停了、按钮还在下载中」）**：后端收到取消标志后要过一会儿才真正退出，期间仍会推来若干 `downloading` 事件。三条取消路径（`keep` / `delete` / 确认框的「保留」或「删除」）现在**都**先调用 `markDownloadCancelled()` 立刻清掉 `localActiveOp` 与速度——此前只有 `delete` 走 `handleCancel()` 清状态，`keep` 与确认框两条都只置 `cancellingRef` 就返回，按钮于是永远停在下载图标上。同时进度订阅的取消过滤改为「只挡进行中的事件」：`completed` / `error` 终态必须放进来复位 `cancellingRef` 并清状态，否则取消一次之后所有后续进度事件都会被永久吞掉（后端在取消时确实会 emit `error` 终态）。切换进度（`onSwitchProgress`）同理。

**取消不该报成失败**：后端取消时 `install_or_update` 返回 `Err("Install cancelled")`，`handleUpdate` 原来会因此弹一条 urgent「更新失败」。现在 `markDownloadCancelled()` 同时把 `userCancelledRef` 置真（每次发起新任务——`startInstall` / `handleUpdate` / `handleVerify` / `handleQuickVerify` / `handlePreload`——开头复位为假），`handleUpdate` 的 `catch` 与 `!result.success` 两个分支、以及两个校验入口的「校验完成」消息都会据此跳过，用户自己点的取消不再产生错误提示。

**主按钮与进度浮层**
下载等长操作的主按钮周围显示从正上方开始顺时针环绕的百分比进度环（`stagePercent`：verifying/repairing 阶段分子取 `verified_bytes`，downloading/applying 阶段取 `downloaded`；checking/comparing 的 total 为 0 → 只剩淡轨道）；悬停取消下载或关闭游戏时，主按钮背景显示透明浅红。切换中主按钮同样显示该进度环（`switchPercent`：downloading 阶段 = 字节比；backing_up/moving 阶段 = file_index/file_count，后端把它们复用进 downloaded/total；fetching/comparing 阶段 total 为 0 → 无可见弧线）。按钮 hover 时计算 `progressFlyoutPos`（另见按钮定位 effect）；浮层经 `ProgressFlyout`（`createPortal` 到 `document.body`）挂出，按 `preparing`/`isDownloading`/`isVerifying`/`isComparing`/`isRepairing`/`isApplying`/`switching` 分支渲染进度条、速度、ETA、当前文件与切换阶段文案（阶段 → 文案映射）。预下载**不进入**该浮层，而是用自己的浮层实例（同为 `ProgressFlyout`，锚在预下载按钮上）。

**进度环形状**：进度环由 `ButtonProgressRing` 绘制，必须贴合按钮自身的胶囊轮廓。早期实现用 `preserveAspectRatio="none"` 的 `<ellipse>` 近似，椭圆被按按钮宽高非等比拉伸，越靠两端越向里收（44px 高、150px 宽的按钮在圆角起点处已内缩约 8px），画出来是一圈「橄榄形」、与按钮边缘对不上；现在组件用 `ResizeObserver` 量出 `svg`（`absolute inset-0`，即按钮 padding box）的实际尺寸，再按同一尺寸生成圆角矩形路径（`rx` = 高度一半即胶囊，笔画外沿留 1px 压在按钮 hairline 上），路径起点落在正上方中央，配合 `pathLength="100"` 归一化让 `strokeDashoffset = 100 - percent` 直接表示进度。按钮宽度会随文案变化（「安装中…」↔「取消下载」），尺寸变化时 `ResizeObserver` 触发重画。

**下载中按钮的图标与文案轮播**：进度环保留，环**里面**的转圈图标换成 `DownloadArrowIcon`——`isDownloading`/`isApplying` 阶段不再用 `animate-spin`，改为静止托盘 + 箭头循环下落（`.launcher-download-arrow`：`translateY` 由 -3px 走到 5px 并在末段淡出，1.15s 无限循环；`prefers-reduced-motion` 下由全局规则压成静止帧），悬停时仍是 ✕（点击取消）。文案在 `isDownloading` 时轮播三段：`launcher.downloading_percent`（「下载中 N%」）／`formatBytes(speed)/s`（还没测出速度时 `—`）／`launcher.remaining_time`（「剩余 m:ss」，无速度或已下完时 `—`），每 2.8 秒推进一段（`carouselIndex` + `setInterval`）；悬停暂停轮播并显示 `launcher.cancel_download`。**按钮宽度锁定**：三段文案、悬停文案与四条「宽度探针」（`downloadCarouselProbes`：`下载中 100%`、`999.99 MB/s`、`剩余 99:59:59`、`取消下载`）全部以 `invisible` 叠在同一个 grid 格子里（`col-start-1 row-start-1`），按钮宽度就等于其中最宽的一条，因此切换段落或悬停时尺寸都不变。切段时靠 `animate-fade-in`（纯位移）重播表达过渡。新增 i18n 键：`launcher.downloading_percent`、`launcher.remaining_time`（zh/en 同步）。

**速度采样与数字节流**：进度事件比人眼能读数字的频率高得多，直接跟着事件渲染会让速度和剩余时间一直乱跳。两层处理：① **速度**——采样窗口由 0.3 秒改为 **1 秒**，窗口均值再做一次指数平滑（`prev * 0.6 + instant * 0.4`），主进度（`stage === "downloading" | "repairing"`）与切服进度（`phase === "downloading"`）都走同一套；本地模拟（8 MB/s 带 ±30% 噪声、每 100ms 一个事件）里，稳态标准差由 0.86 MB/s 降到 0.34 MB/s，稳态极差由 3.7 MB/s 降到 1.2 MB/s，更新次数由 66 次/20s 降到 19 次/20s。② **按钮上的数字**——`buttonStatsRef` 在渲染期做 1 秒节流快照（只写 ref，不触发额外渲染），轮播三段文案（百分比、速度、剩余时间）都取这个快照，因此每个数字每秒最多变一次；进度环不走快照，仍按实时 `downloadPercent` 平滑推进。`markDownloadCancelled()` 会把 `speedRef` 一并重置，取消后重新下载不会带着旧窗口继续算。

**菜单与设置入口（1882–2060）**
汉堡按钮切换菜单浮层并即时 `hasDownloadCache` 刷新 `hasTempFiles`；菜单项：游戏设置（打开 `GameSettingsModal`，安装路径）、启动设置（直接打开独立的 `QuickLaunchModal`：静默启动命令 + 复制 + 创建快捷方式，以及再套一层 `SteamShortcutModal` 调整 Steam 条目参数）、校验完整性（`verify-confirm`）、快速校验、清理临时文件（`delete-temp`，需 `hasTempFiles`）、定位游戏。启动设置入口原先是最右侧的独立 ⚙ 按钮，现已并入该菜单；菜单里的校验/快速校验/清理项以 `busyWithDownload` 禁用（预下载进行中不可发起）。

**对话框族（2081–2901）**
通用确认框（2081，5 分支 + footer 按钮组合各不相同）、**预下载确认框（2426，`preload_confirm_title/desc` + `DiskSpaceBar`，空间不足禁用「开始预下载」）**、渠道选择框（2520，`ALL_CHANNELS` 列表 + `scanning` 指示）、扫描结果框（2600，同样用 `DiskSpaceBar` 画三色磁盘占用条，空间不足时禁用确认按钮并显示红色提示）、切换选择框（2781，当前渠道禁用并标注）、切换确认框（2861，`switch_confirm_desc` 插入 from/to 渠道名）。

**GameSettingsModal（2648–2728）**
非导出内部组件，安装路径文本框 + `browseFolder` 浏览，`onSave(path)` 回写 localStorage 并 `checkStatus`。

**备注**：

1. **invoke 命令名**（本文件无直接 `invoke()`，全部经 `launcherService` 封装；括号内为本文件调用点）：
   - `launcher_check_status`（186、257）
   - `launcher_install_or_update`（456、646）
   - `launcher_verify_and_repair`（459、696、721）
   - `launcher_cancel_download`（451、740、777、1086、1109、1111、1122）
   - `launcher_reset_download_cancel`（454、644、690、715、750）
   - `launcher_has_download_cache`（482、509、540、1632、2245）
   - `launcher_preload_download`（761）
   - `launcher_start_game`（635）
   - `launcher_browse_folder`（427、470、613、2410）
   - `launcher_check_game_running`（272）
   - `launcher_get_game_playtime`（531）
   - `launcher_kill_game`（1222，经 `killGame`；失败时按 token 弹提示）
   - `launcher_detect_channel`（231、433、476、619）
   - `launcher_scan_install_dir`（532）
   - `launcher_get_disk_space`（533）
   - `launcher_get_process_read_bytes`（320）
   - `launcher_switch_channel`（587）
   - `launcher_cancel_switch`（1062）
2. **listen 事件名**：`launcher-progress`（`onLauncherProgress`，286）；`launcher://switch-progress`（`onSwitchProgress`，357）。`launcherService` 中的 `launcher://progress`（`onProgress`）本文件**未使用**。
3. **props 清单**：
   - `GameActionPanel()`：props `{ game?: LauncherGame }`。传了 `game`（整页推移中的某一页）时**不跟随 store 变化** —— 否则新页一切换，旧页的面板也跟着换，两页就显示同一个游戏了。
   - `GameSettingsModal`：`initialPath: string`（初始安装路径）、`onClose: () => void`（关闭）、`onSave: (path: string) => void`（保存并触发状态刷新）。
   - `GameLaunchSettingsModal`：已从库中删除，「启动设置」入口直接挂 `QuickLaunchModal`（props 见 components_settings_panels.md）。
   - `GlassAlertDialog` / `GlassModal` / `GlassButton` 为其复合子组件提供的 `isOpen`、`onOpenChange`、`onPress`、`className`、`variant`、`status` 等 UI 属性。
4. **状态管理要点**：全部为组件内 `useState`，无全局 store；`localActiveOp`（事件实时）优先于 `gameStatus.active_operation`（轮询）；`cancellingRef` 在取消期间屏蔽后续**进行中**的进度事件（`completed`/`error` 终态例外，它负责复位该标志并清掉按钮下载态，见「取消后按钮状态」）；`userCancelledRef` 标记「本次任务是用户主动取消的」，用于跳过「更新失败」「校验完成」这类误报（见「取消不该报成失败」）；游戏运行态 3 秒轮询，累计时长为 5 秒轮询 `getGamePlaytime`，两次快照之间的平滑补间由 `ElapsedTime` 组件内部 `requestAnimationFrame` 完成；持久化键为 `launcher_install_path[_arknights]`、`launcher_channel[_arknights]`、`launcher_skip_stop_confirm`、`launcher_cancel_behavior[_arknights]`，另直接读 `launcher_verify_threads[_arknights]`（691–694、716–719）；`confirmAction` 为五值联合（`cancel-download`｜`stop-game`｜`resume-install`｜`delete-temp`｜`verify-confirm`）；880–884 在渲染期间比较文案并 `setBtnLabelKey` 以驱动 `animate-fade-in`（该类现已纯位移、无淡入）。安装路径与渠道的写入一律经 `launcherService.persistInstallPath` / `persistDetectedInstall`（localStorage + 后端 config 双写、按渠道归属游戏分区），本文件不再直接拼分区键。
5. **异常/待关注**：
   - `handleQuickVerify` 依赖数组（734）缺 `formatVerifyResult`，而 `handleVerify`（709）包含，存在闭包过期风险。
   - 扫描结果 `download_bytes === 0` 时确认按钮文案为 `launcher.start_game`（2120）但实际执行 `startInstall(false)`（2101），文案与行为不符。
   - 渠道检测 effect 依赖数组已改为 `[installPath, game]`（原先只有 `[installPath]`，读 `channel` 却没登记依赖）。
   - 保留多处 `console.log` 调试输出（190–205、580–601）。
   - 本文件**不含**公告/Banner/背景图逻辑（`getBanners`/`getAnnouncements`/`getBackgroundImage` 在 `launcherService` 中存在但未被本组件引入），相关功能位于其他页面组件。

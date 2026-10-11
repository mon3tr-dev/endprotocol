# 游戏操作面板 game-action-panel.tsx — 功能参考

> 逐行精读源码生成。行号基于当前工作区版本，仅用于快速定位。

**文件职责**：Windows 游戏启动器主操作面板，聚合「定位游戏目录 → 检测渠道 → 安装/更新/校验/修复/预载 → 启动/停止游戏 → 切换渠道」全流程，并提供下载进度浮层、确认对话框、磁盘空间预检与设置入口。仅 Windows 的 dashboard 游戏模式会挂载该组件；Linux/macOS 不显示游戏入口。

**导出**：`GameActionPanel`（无 props 的函数组件，行 52）。

**主要依赖**：
- 项目内：`@/components/ui/modal`（`GlassAlertDialogCompound`、`GlassModalCompound`）、`@/components/ui/button`（`GlassButton`）、`@/utils/launcherService`（全部 Tauri 后端调用与事件订阅的封装）、`@/utils/messageStore`（`addMessage`）、`@/components/game-launch-settings`（`GameLaunchSettingsModal`）。
- 第三方：React（`useState`/`useEffect`/`useLayoutEffect`/`useRef`/`useCallback`）、`react-dom`（`createPortal`）、`react-i18next`（`useTranslation`）。Tauri API 不直接引用，全部经 `launcherService` 间接调用。

## 内部结构总览

| 区间 | 内容 |
| --- | --- |
| 1–46 | import：React 钩子、Portal、i18n、UI 组件、launcherService 全量接口、messageStore、启动设置弹窗 |
| 47–50 | 4 个 localStorage 键常量 |
| 52–119 | `GameActionPanel` 组件声明与 30+ 个 useState / useRef 初始化 |
| 120–166 | 确认对话框状态、`activeOp`/`progress`/`preparing`/`switching`/`switchProgress`/`switchTarget` 派生值 |
| 168–272 | 渠道持久化、状态查询 `checkStatus`、渠道自动检测 effect、静默刷新 `refreshStatus`、游戏运行 3 秒轮询 |
| 275–379 | 进度事件订阅 effect（下载/校验/切换速度计算、完成态清理） |
| 382–405 | 菜单浮层外部点击/滚动关闭 effect |
| 407–740 | 业务处理器：定位、安装、渠道选择、渠道切换、启动、更新、校验、取消、预载、杀进程 |
| 742–796 | 阶段标志派生、两个 `useLayoutEffect`（进度浮层/菜单浮层定位） |
| 798–1002 | 主按钮文案 `getButtonLabel`、标签变更触发淡入、图标 `getButtonIcon` |
| 1004–1086 | 主按钮点击分发 `handleButtonClick`、确认回调 `handleConfirmAction` |
| 1088–1231 | JSX 常驻区：渠道徽章、检测中指示、预载按钮、预载完成标记、主操作按钮 |
| 1234–1533 | 进度浮层（Portal）：准备/下载/校验/比较/修复/应用/切换 7 类进度展示 |
| 1535–1611 | 汉堡菜单按钮、启动设置入口按钮 |
| 1613–1762 | 汉堡菜单浮层（Portal）：游戏设置、校验完整性、快速校验、清理临时文件、定位游戏 |
| 1765–1782 | `GameLaunchSettingsModal`、`GameSettingsModal` 条件挂载 |
| 1785–1932 | 通用确认对话框（5 种 confirmAction 分支 + 「不再提示」复选框） |
| 1935–2007 | 渠道选择对话框（首次安装、无法自动检测时） |
| 2010–2188 | 扫描结果 + 磁盘空间占用条对话框 |
| 2191–2268 | 渠道切换：目标渠道选择对话框 |
| 2271–2311 | 渠道切换确认对话框 |
| 2316–2398 | `GameSettingsModalProps` 接口与 `GameSettingsModal` 内部组件（未导出） |

## 组件与函数清单

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `STORAGE_KEY_INSTALL_PATH` | 47 | `"launcher_install_path"` |
| `STORAGE_KEY_CHANNEL` | 48 | `"launcher_channel"` |
| `STORAGE_KEY_SKIP_STOP_CONFIRM` | 49 | `"launcher_skip_stop_confirm"`，停止游戏不再确认 |
| `STORAGE_KEY_CANCEL_BEHAVIOR` | 50 | `"launcher_cancel_behavior"`，取值 `"ask"｜"keep"｜"delete"` |
| `GameActionPanel` | 52–2314 | 导出组件主体（无 props） |
| `checkStatus` | 173–196 | `useCallback`：查询游戏状态并置 `statusReady` |
| `refreshStatus` | 241–252 | `useCallback`：静默刷新，供进度完成后调用 |
| `checkRunning` | 259–266 | `useCallback`：查询游戏是否在运行 |
| `handleLocate` | 407–427 | 选择目录、持久化、检测渠道 |
| `startInstall` | 429–448 | 执行安装/更新，成功后自动做一次 quick 校验 |
| `handleInstall` | 450–498 | 首次安装编排（选目录 → 检测渠道 → 缓存续传/渠道选择） |
| `handleChannelSelected` | 500–534 | 渠道选定后并行扫描目录与磁盘空间，弹扫描结果 |
| `handleSwitchChannel` | 536–544 | 记录切换目标，转确认态 |
| `handleConfirmSwitch` | 546–591 | 定位进度浮层坐标并执行渠道切换，失败发 urgent 消息 |
| `handleStart` | 593–621 | 启动游戏（无路径时先定位并检测渠道） |
| `handleUpdate` | 623–632 | 执行更新 |
| `formatVerifyResult` | 635–666 | 解析校验结果 JSON，生成 i18n 文本与 info/warn 级别 |
| `handleVerify` | 668–691 | 完整校验（线程数取 `launcher_verify_threads`，默认 12） |
| `handleQuickVerify` | 693–716 | 快速校验（`quick=true`） |
| `handleCancel` | 718–724 | 取消当前下载/校验 |
| `handlePreload` | 726–735 | 预下载新版本资源 |
| `handleKill` | 737–740 | 杀掉游戏进程并刷新运行态 |
| `getButtonLabel` | 798–823 | 依状态返回主按钮文案（hover 时切为取消类文案） |
| `getButtonIcon` | 832–1002 | 依状态返回 SVG 图标（旋转/暂停/下载/刷新/播放） |
| `handleButtonClick` | 1004–1047 | 主按钮统一分发：取消切换/停止/取消校验/取消下载/安装/更新/启动 |
| `handleConfirmAction` | 1049–1086 | 确认对话框回调，按 5 种 `confirmAction` 分支执行 |
| `GameSettingsModalProps` | 2318–2322 | 内部弹窗 props 类型 |
| `GameSettingsModal` | 2324–2398 | 安装路径设置弹窗（`handleBrowse` 于 2332–2335） |

## 关键功能分区

**常量与状态初始化（47–166）**
4 个 localStorage 键常量；状态包括：`channel`、`gameStatus`、`localActiveOp`、`installPath`、`detectedChannel`、`detecting`、`statusReady`、`flyoutOpen`、`hasTempFiles`、`settingsOpen`、`launchSettingsOpen`、`gameRunning`、`btnHovered`、`btnLabelKey`、`preloadHovered`、`downloadSpeed`、`channelSelectOpen`、`pendingInstallPath`、`scanResult`、`scanOpen`、`scanning`、`diskSpace`、`switchOpen`、`switchConfirmTarget`、`verifySpeed`、`progressFlyoutPos`、`menuFlyoutPos`、`confirmAction`、`confirmCheckbox`；refs：`prevBtnLabelRef`、`flyoutRef`、`btnRef`、`hamburgerRef`、`speedRef`、`verifySpeedRef`、`cancellingRef`、`menuFlyoutRef`。派生值 `activeOp`（132，本地事件优先于轮询值）、`progress`（133–147）、`preparing`（148）、`switching`（151）、`switchProgress`（152–164）、`switchTarget`（165）。

**状态查询与渠道自动检测（168–272）**
渠道写入 localStorage（168–170）；`checkStatus` 触发 effect（254–256）；`detectChannel` effect（199–238，带取消标记与缓存命中短路，检测到不同渠道时回写 state 与 localStorage）；`checkGameRunning` 每 3 秒轮询（268–272）。

**进度事件与速度计算（275–379）**
`onLauncherProgress`（276–337）：写入 `localActiveOp`；`downloading`/`repairing` 用 `speedRef` 差分算下载速度；`verifying` 用 `getProcessReadBytes` 差分算校验速度；`completed`/`error` 清空并 500ms 后 `refreshStatus`。`onSwitchProgress`（339–373）：切换阶段同理。清理时解除两订阅（375–378）。

**定位与安装（407–534）**
`handleLocate` 走 `browseFolder` + `detectChannel`；`handleInstall` 分三路：无路径 → 选目录后检测（有缓存弹 `resume-install`，检测失败弹渠道选择）、有路径但未检测到渠道 → 弹渠道选择、已检测 → 缓存续传或直接安装；`handleChannelSelected` 并行 `scanInstallDir` + `getDiskSpace`，失败则退回缓存判断流程。

**渠道切换（536–591, 2191–2311）**
选择器（2191）→ `handleSwitchChannel` 记录目标 → 确认框（2271）→ `handleConfirmSwitch` 计算浮层位置、调用 `switchChannel`、成功后同步 `channel`/`detectedChannel`/localStorage 并 `checkStatus`，失败经 `addMessage` 发 `switch-error` 紧急消息。切换中主按钮点击触发 `cancelSwitch`（1005–1010）。

**启动 / 停止（593–621, 737–740, 1011–1017, 1060–1063）**
`handleStart` → `startGame`；运行中点击主按钮：`launcher_skip_stop_confirm === "1"` 直接 `handleKill`，否则弹 `stop-game` 确认框（可勾选不再提示）。

**校验 / 修复 / 预载（623–716, 726–735, 1656–1707）**
`handleVerify`（完整）、`handleQuickVerify`（快速，菜单直连）、`startInstall` 成功后自动 quick 校验；结果经 `formatVerifyResult` 转 `verify-result` 消息；`handlePreload` → `preloadDownload`，按钮显示条件为 `hasUpdate && hasPreload && !preloadCompleted`（1119）。

**下载取消策略（1018–1039, 1049–1076, 1785–1932）**
`launcher_cancel_behavior`：`keep` → 不带路径 `cancelDownload()`（保留文件）、`delete` → 带路径删除临时文件、`ask` → 弹 `cancel-download` 对话框（保留/删除两按钮）。

**主按钮（1171–1231）与进度浮层（1234–1533）**
按钮 hover 时计算 `progressFlyoutPos`（1175–1195，另见 763–774 布局重算）；浮层经 `createPortal` 挂到 `document.body`，按 `preparing`/`isDownloading`/`isVerifying`/`isComparing`/`isRepairing`/`isApplying`/`switching` 分支渲染进度条、速度、ETA、当前文件与切换阶段文案（1455–1467 阶段 → 文案映射）。

**菜单与设置入口（1535–1762, 1765–1782）**
汉堡按钮切换菜单浮层并即时 `hasDownloadCache` 刷新 `hasTempFiles`（1550–1552）；菜单项：游戏设置（打开 `GameSettingsModal`）、校验完整性（`verify-confirm`）、快速校验、清理临时文件（`delete-temp`，需 `hasTempFiles`）、定位游戏；最右侧独立按钮打开 `GameLaunchSettingsModal`。

**对话框族（1785–2311）**
通用确认框（1785，5 分支 + footer 按钮组合各不相同）、渠道选择框（1935，`ALL_CHANNELS` 列表 + `scanning` 指示）、扫描结果框（2010，三色磁盘占用条：已用/待下载/剩余，空间不足时禁用确认按钮并显示红色提示）、切换选择框（2191，当前渠道禁用并标注）、切换确认框（2271，`switch_confirm_desc` 插入 from/to 渠道名）。

**GameSettingsModal（2316–2398）**
非导出内部组件，安装路径文本框 + `browseFolder` 浏览，`onSave(path)` 回写 localStorage 并 `checkStatus`。

**备注**：

1. **invoke 命令名**（本文件无直接 `invoke()`，全部经 `launcherService` 封装；括号内为本文件调用点）：
   - `launcher_check_status`（186、247）
   - `launcher_install_or_update`（438、628）
   - `launcher_verify_and_repair`（441、678、703）
   - `launcher_cancel_download`（433、722、1032、1055、1057、1068）
   - `launcher_reset_download_cancel`（436、626、672、697、729）
   - `launcher_has_download_cache`（464、491、522、1551、2168）
   - `launcher_preload_download`（731）
   - `launcher_start_game`（617）
   - `launcher_browse_folder`（409、452、595、2333）
   - `launcher_check_game_running`（261）
   - `launcher_kill_game`（738）
   - `launcher_detect_channel`（220、415、458、601）
   - `launcher_scan_install_dir`（514）
   - `launcher_get_disk_space`（515）
   - `launcher_get_process_read_bytes`（302）
   - `launcher_switch_channel`（569）
   - `launcher_cancel_switch`（1008）
2. **listen 事件名**：`launcher-progress`（`onLauncherProgress`，276）；`launcher://switch-progress`（`onSwitchProgress`，339）。`launcherService` 中的 `launcher://progress`（`onProgress`）本文件**未使用**。
3. **props 清单**：
   - `GameActionPanel()`：无 props。
   - `GameSettingsModal`：`initialPath: string`（初始安装路径）、`onClose: () => void`（关闭）、`onSave: (path: string) => void`（保存并触发状态刷新）。
   - `GameLaunchSettingsModal`：`onClose: () => void`。
   - `GlassAlertDialog` / `GlassModal` / `GlassButton` 为其复合子组件提供的 `isOpen`、`onOpenChange`、`onPress`、`className`、`variant`、`status` 等 UI 属性。
4. **状态管理要点**：全部为组件内 `useState`，无全局 store；`localActiveOp`（事件实时）优先于 `gameStatus.active_operation`（轮询）；`cancellingRef` 在取消期间屏蔽后续进度事件；游戏运行态 3 秒轮询；持久化键为 `launcher_install_path`、`launcher_channel`、`launcher_skip_stop_confirm`、`launcher_cancel_behavior`，另直接读 `launcher_verify_threads`（673–676、698–701）；`confirmAction` 为五值联合（`cancel-download`｜`stop-game`｜`resume-install`｜`delete-temp`｜`verify-confirm`）；826–830 在渲染期间比较文案并 `setBtnLabelKey` 以驱动 `animate-fade-in`。
5. **异常/待关注**：
   - `preloadHovered`（86、1123–1124）只写不读，为死状态。
   - `handleQuickVerify` 依赖数组（716）缺 `formatVerifyResult`，而 `handleVerify`（691）包含，存在闭包过期风险。
   - 扫描结果 `download_bytes === 0` 时确认按钮文案为 `launcher.start_game`（2180）但实际执行 `startInstall(false)`（2166），文案与行为不符。
   - 渠道检测 effect（199–238）读取 `channel`（224）但依赖数组仅 `[installPath]`。
   - 保留多处 `console.log` 调试输出（179–195、562–583）。
   - 本文件**不含**公告/Banner/背景图逻辑（`getBanners`/`getAnnouncements`/`getBackgroundImage` 在 `launcherService` 中存在但未被本组件引入），相关功能位于其他页面组件。

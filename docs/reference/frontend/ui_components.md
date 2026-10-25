# 通用 UI 组件库 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 覆盖 `src/components/ui/` 全部 37 个文件（新增 `radio-group.tsx`） + `src/components/` 下 3 个基础文件（共 40 个），以及 `src/components/crash-report-host.tsx` 崩溃提示宿主。

## `src/components/ui/account-avatar.tsx`
**职责**：账户头像组件，图片加载失败时回退为首字母占位符，可选显示激活状态圆点。
**导出**：`AccountAvatar`
**主要依赖**：`@/utils/imageLoader`（`Img` 图片组件）、`clsx`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SIZE_CLASS` | account-avatar.tsx:12 | size → 宽高/字号映射（xs 32px ~ xl 80px） |
| `INDICATOR_SIZE` | account-avatar.tsx:20 | size → 指示点直径映射 |
| `AccountAvatar` | account-avatar.tsx:28 | 主组件。关键 props：`src`（可选图片地址）、`alt`（必填，兼作回退首字母来源）、`size`（`xs/sm/md/lg/xl`，默认 `md`）、`showActiveIndicator`（默认 `false`，右下角绿色圆点）、`className` |

**备注**：`onError` 时隐藏图片并把父节点文本设为 `alt` 首字母大写（account-avatar.tsx:50-55）；图片类名固定带 `avatar-feather`。

## `src/components/ui/alert.tsx`
**职责**：行内警示条，按 `status` 切换边框与指示点配色，复合组件结构（容器 + 指示点 + 内容 + 描述）。
**导出**：`Alert`、`GlassAlert`（`Alert` 的别名）、类型 `GlassAlertStatus`、`GlassAlertProps`
**主要依赖**：`react`（createContext/useContext）、`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassAlertStatus` | alert.tsx:4 | 类型：`default / success / warning / danger` |
| `GlassAlertProps` | alert.tsx:6 | 继承 `HTMLAttributes<HTMLDivElement>`，新增 `status` |
| `AlertCtx` | alert.tsx:10 | 内部 Context，向子件传递 status |
| `borderTone` / `dotTone` | alert.tsx:12 / alert.tsx:19 | status → 边框文字色 / 圆点色映射 |
| `Alert` | alert.tsx:26 | 根容器，`role="alert"`，毛玻璃背景；props：`status`（默认 `default`）、`className`、`children` |
| `Alert.Indicator` | alert.tsx:43 | 8px 圆点，颜色跟随 Context status；props：`className` |
| `Alert.Content` | alert.tsx:48 | 可伸缩内容区（`min-w-0 flex-1`） |
| `Alert.Description` | alert.tsx:52 | `text-sm` 段落文本 |
| `GlassAlert` | alert.tsx:60 | `Alert` 的别名导出 |

**备注**：子件通过 Context 自动继承 status，`Indicator` 无需再传色。

## `src/components/ui/app-icon.tsx`
**职责**：项目级图标注册表——把 lucide 图标包成带动效的 MorphIcon 组件；同时含一个独立的 `StatusDot` 实现。
**导出**：17 个图标组件 + `StatusDot`
**主要依赖**：`lucide`（注意包名是 `lucide` 而非 `lucide-react`）、`@/components/morph-icon`（`createMorphIcon`）、`clsx`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `RefreshIcon` | app-icon.tsx:23 | 刷新（RefreshCw） |
| `ChevronLeftIcon` | app-icon.tsx:24 | 左箭头 |
| `ChevronRightIcon` | app-icon.tsx:25 | 右箭头 |
| `ChevronDownIcon` | app-icon.tsx:26 | 下箭头（`select.tsx` 用作下拉指示） |
| `CloseIcon` | app-icon.tsx:27 | 关闭（X） |
| `PlusIcon` | app-icon.tsx:28 | 加号 |
| `EditIcon` | app-icon.tsx:29 | 编辑（Pencil） |
| `CheckIcon` | app-icon.tsx:30 | 勾选 |
| `SwitchIcon` | app-icon.tsx:31 | 切换（ArrowLeftRight） |
| `MinimizeIcon` | app-icon.tsx:32 | 最小化（Minus） |
| `MaximizeIcon` | app-icon.tsx:33 | 最大化（Square） |
| `RestoreIcon` | app-icon.tsx:34 | 还原（Copy） |
| `MenuIcon` | app-icon.tsx:35 | 菜单（汉堡） |
| `BellIcon` | app-icon.tsx:36 | 铃铛 |
| `LinkIcon` | app-icon.tsx:37 | 链接（Link2） |
| `UnlinkIcon` | app-icon.tsx:38 | 断开链接 |
| `InfoIcon` | app-icon.tsx:39 | 信息 |
| `GlobeIcon` | app-icon.tsx:40 | 地球（网络/从系统读取代理） |
| `LoadingIcon` | app-icon.tsx:41 | 加载圆环（`LoaderCircle`，配 `animate-spin` 使用） |
| `StatusDot` | app-icon.tsx:43 | 状态圆点。props：`tone`（`success/warning/danger/default`）、`pulse`（默认 `false`，`animate-ping` 光晕）、`size`（`sm 8px / md 12px / lg 16px`，默认 `md`）、`className` |

**备注**：与 `status-dot.tsx` 的 `StatusDot` 同名但 API 不同（此处支持 `size` 用 `pulse`，彼处固定 12px 用 `ping`），import 时注意路径。

## `src/components/ui/back-to-top.tsx`
**职责**：滚动容器的回到顶部悬浮球（Portal 到 body），默认显示滚动百分比，悬停切换为上箭头。
**导出**：`BackToTopFab`
**主要依赖**：`react-dom`（`createPortal`）、`@/lib/cn`、`morphicons/react`（`MorphIcon`）、`lucide`（`ArrowUp`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `BackToTopFab` | back-to-top.tsx:11 | props：`getContainer`（返回滚动容器的函数）、`className`。滚动超过 20% 显示（back-to-top.tsx:32）；点击平滑回顶（back-to-top.tsx:61） |

**备注**：用 `requestAnimationFrame` 轮询等待容器挂载（back-to-top.tsx:34-44）；固定定位 `bottom-6 right-6 z-[10003]`；文件头注释写"超过 50% 显示"，实际代码是 `p > 20`，以代码为准。

## `src/components/ui/badge.tsx`
**职责**：胶囊形标签（Chip/Badge），三维度变体：填充样式 x 尺寸 x 语义色。
**导出**：`Badge`、`GlassChip`（别名）、类型 `GlassChipTone`、`GlassChipProps`
**主要依赖**：`class-variance-authority`（cva）、`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassChipTone` | badge.tsx:4 | 语义色：`default/primary/success/warning/danger/accent` |
| `GlassChipProps` | badge.tsx:6 | 继承 `HTMLAttributes<HTMLSpanElement>` + cva VariantProps；`variant`（`soft/solid/outline`，默认 `soft`）、`size`（`sm/md/lg`，默认 `md`）、`color`（默认 `default`） |
| `badgeVariants` | badge.tsx:14 | cva 定义：基础类（`inline-flex rounded-full transition-all`）+ size 尺寸（sm h-5 / md h-6 / lg h-8） |
| `softTone` / `solidTone` / `outlineTone` | badge.tsx:45 / 54 / 63 | color → 三套填充/描边配色表 |
| `Badge` | badge.tsx:72 | 按 `variant` 选取配色表并合并类名渲染 `<span>` |
| `GlassChip` | badge.tsx:97 | `Badge` 别名（`status-badge.tsx` 经 glass 桶引用它） |

## `src/components/ui/button.tsx`
**职责**：按钮组件，提供基础版 `Button` 与增强版 `GlassButton`（loading / 图标-only / 前后置内容）。
**导出**：`Button`、`GlassButton`、`buttonVariants`、类型 `GlassButtonVariant`、`GlassButtonSize`、`GlassButtonProps`、`ButtonProps`
**主要依赖**：`react`（forwardRef）、`class-variance-authority`、`@/lib/utils`、`./spinner`（`GlassSpinner`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassButtonVariant` | button.tsx:6 | `primary/secondary/tertiary/outline/ghost/danger` |
| `GlassButtonSize` | button.tsx:7 | `sm/md/lg` |
| `GlassButtonProps` | button.tsx:9 | 关键 props：`variant`（默认 `secondary`）、`size`（默认 `md`）、`isIconOnly`（方形图标按钮）、`isDisabled`、`isLoading`（前置 spinner 并禁用）、`fullWidth`、`onPress`（点击回调）、`startContent`/`endContent`（前后插槽节点） |
| `buttonVariants` | button.tsx:22 | cva 变体表；基础类含 hover `scale-105`、active `scale-95`、focus ring、disabled 50% 透明 |
| `iconOnlySize` | button.tsx:55 | `isIconOnly` 时 sm=32 / md=36 / lg=40 的方形尺寸 |
| `ButtonProps` | button.tsx:61 | 基础按钮 props（原生 button attrs + variant/size） |
| `Button` | button.tsx:65 | forwardRef；`type` 默认 `"button"`，`variant` 默认 `secondary`、`size` 默认 `md` |
| `GlassButton` | button.tsx:96 | forwardRef；按下态 = `disabled 或 isDisabled 或 isLoading`；渲染顺序 spinner → startContent → children → endContent（button.tsx:132-135） |

**备注**：`GlassButtonProps` 与 `ButtonProps` 是两套 props 不可混用（前者用 `onPress`/`isXxx` 命名，后者是原生属性）。

## `src/components/ui/card.tsx`
**职责**：卡片容器族——可按压卡片 `GlassCard`、静态卡片 `Card` 及其标题/描述/内容/页脚子件。
**导出**：`Card`、`CardHeader`、`CardTitle`、`CardDescription`、`CardContent`、`CardFooter`、`GlassCard`
**主要依赖**：`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassCardProps` | card.tsx:3 | `isPressable`（渲染为 `<button>`）、`onPress`（点击回调）、`shadow`（`none/sm/md/lg`，默认 `none`） |
| `GlassCard` | card.tsx:9 | 毛玻璃卡（`glass-surface rounded-xl border`）；`isPressable=true` 时输出 `<button>` 并带 hover 抬升缩放动效（card.tsx:17-38），否则输出 `<div>` |
| `CardProps` | card.tsx:58 | 仅 `shadow` + 原生 div attrs |
| `Card` | card.tsx:62 | 静态毛玻璃卡（无 hover 位移动效） |
| `CardHeader` | card.tsx:79 | 头部容器 `p-6 space-y-1.5` |
| `CardTitle` | card.tsx:91 | `<h3>` 标题，`text-lg font-semibold` |
| `CardDescription` | card.tsx:109 | `<p>` 描述，`text-sm text-muted` |
| `CardContent` | card.tsx:121 | 内容区 `p-6 pt-0` |
| `CardFooter` | card.tsx:133 | 页脚 `flex items-center p-6 pt-0` |

## `src/components/ui/checkbox.tsx`
**职责**：自绘复选框（原生 input `sr-only` + 视觉 span），两套 API：`GlassCheckbox` 与 `Checkbox`。
**导出**：`Checkbox`、`GlassCheckbox`
**主要依赖**：`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassCheckboxProps` | checkbox.tsx:3 | 原生 input attrs（省略 `checked/onChange`）+ `isSelected`（选中态）、`onValueChange(selected)`、`onChange()`（无参，先于 onValueChange 触发） |
| `GlassCheckbox` | checkbox.tsx:10 | 选中时主色底 + 内联 SVG 勾（checkbox.tsx:41-49）；`children` 作为 label 文本 |
| `CheckboxProps` | checkbox.tsx:57 | `checked`、`onCheckedChange(checked)` |
| `Checkbox` | checkbox.tsx:63 | 视觉与 GlassCheckbox 相同，仅回调 API 不同 |

**备注**：两者都是受控组件（不传状态则始终未选中）；视觉方块固定 18x18。

## `src/components/ui/confirm-dialog.tsx`
**职责**：以 Promise 形式替代 `window.confirm` 的编程式确认弹窗（Host + 触发函数），另含开发者警告弹窗。
**导出**：`confirmDialog`、`ConfirmDialogHost`、`DevWarningDialog`
**主要依赖**：`@/components/ui/glass`（`GlassAlertDialog`、`GlassButton`、`GlassModal`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ConfirmTone` / `ConfirmOptions` | confirm-dialog.tsx:4 / 6 | `tone`：`primary/danger/warning`；选项含 `title`、`body`、`confirmText`（默认 "Confirm"）、`cancelText`（默认 "Cancel"） |
| `externalHandler` | confirm-dialog.tsx:14 | 模块级 handler 槽，Host 挂载时注入 |
| `confirmDialog` | confirm-dialog.tsx:17 | 任意位置调用，返回 `Promise<boolean>`；未挂载 Host 时静默 resolve(false) |
| `ConfirmDialogHost` | confirm-dialog.tsx:22 | 单例宿主：注册 handler（confirm-dialog.tsx:39-44）、渲染 `GlassModal` 复合结构；`tone` 为 danger 时确认键变 danger 变体（confirm-dialog.tsx:54） |
| `DevWarningDialog` | confirm-dialog.tsx:94 | 受控警告框（`isOpen/onOpenChange/onConfirm/title/body/confirmText/cancelText`），基于 `GlassAlertDialog` |

**备注**：必须在应用树中挂载一次 `ConfirmDialogHost`，否则 `confirmDialog()` 恒返回 `false`。

## `src/components/ui/empty-state.tsx`
**职责**：空状态占位（图标 + 标题 + 描述 + 操作按钮），内置不依赖外部库的用户图标 SVG。
**导出**：`EmptyState`、`EmptyStateUserIcon`
**主要依赖**：`clsx`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `EmptyStateProps` | empty-state.tsx:3 | `icon`、`title`（必填）、`description`、`action`（按钮节点）、`minHeight`（默认 `200`）、`className` |
| `EmptyState` | empty-state.tsx:14 | 垂直居中容器；图标固定渲染 56px、40% 透明、hover 放大（empty-state.tsx:31） |
| `EmptyStateUserIcon` | empty-state.tsx:47 | 24x24 用户轮廓 SVG，接受全部 `SVGProps`；被 `error-boundary.tsx`、`global-error-fallback.tsx` 复用 |

## `src/components/ui/error-boundary.tsx`
**职责**：类组件错误边界，捕获子树未捕获异常，写入崩溃日志并展示可重置的兜底 UI。
**导出**：`ErrorBoundary`
**主要依赖**：`react`（Component）、`react-i18next`（默认兜底文案）、`@/components/ui/glass`（`GlassButton`）、`./empty-state`（`EmptyStateUserIcon`）、`@/utils/crashReporting`（`reportCrash`）、`@/i18n`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ErrorFallbackRenderer` | error-boundary.tsx:8 | `(error, reset) => ReactNode`，`fallback` 支持节点或渲染函数 |
| `ErrorBoundaryProps` | error-boundary.tsx:10 | `children`、`fallback`（节点/函数）、`onError(error, info)` |
| `ErrorBoundary` | error-boundary.tsx:25 | `getDerivedStateFromError` 置错；`componentDidCatch` 调 `reportCrash({source:"react", fatal:true, stack: error.stack + componentStack})` 并转发 `onError`；`reset` 清除错误态 |
| `DefaultErrorFallback` | error-boundary.tsx:66 | 内部未导出：60vh 居中错误页 + 错误消息 + Reload 按钮调用 `onReset` |

**备注**：`Provider` 传入渲染函数 `(error) => <GlobalErrorFallback error={error} />`，因此根级错误展示完整诊断面板；默认兜底仅在单独使用 `ErrorBoundary` 时出现。

## `src/components/ui/global-alert.tsx`
**职责**：全局顶部浮层提示（toast 式 Alert），模块级发布/订阅，可在任意模块直接调用。
**导出**：`pushGlobalAlert`、`GlobalAlertHost`
**主要依赖**：`@/components/ui/glass`（`GlassAlert`）、`react`（useEffect/useState）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlobalAlertTone` / `GlobalAlertState` | global-alert.tsx:4 / 6 | tone：`success/danger/warning/default`；state 含自增 `id`、`message`、`duration` |
| `listeners` | global-alert.tsx:14 | 模块级 `Set` 订阅表 |
| `pushGlobalAlert` | global-alert.tsx:17 | `(tone, message, duration=3000)`，向所有 Host 广播 |
| `GlobalAlertHost` | global-alert.tsx:32 | 根布局挂载；按 `duration` 定时清除（带 id 校验避免旧定时器误清新消息，:38-40）；渲染为顶部居中固定浮层 `z-50` + `animate-slide-down` |

**备注**：同屏只显示最后一条 alert（新覆盖旧）；`z-50` 低于 modal 的 `z-[100]`，弹窗打开时提示会被遮挡。

## `src/components/ui/global-error-fallback.tsx`
**职责**：应用根级 ErrorBoundary 的整页兜底（全屏错误页 + 可能原因/建议 + 复制/导出/打开日志/重载/退出）。
**导出**：`GlobalErrorFallback`
**主要依赖**：`react`（useMemo）、`react-i18next`、`@tauri-apps/api/core`（`invoke("app_quit")`）、`@/components/crash-report-host`（`CrashDetails`/`CrashActionBar`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlobalErrorFallback` | global-error-fallback.tsx:11 | props：`error: Error`；用 `CrashReport` 包装后渲染 `CrashDetails` 与 `CrashActionBar`（primary=重新加载、危险按钮=退出应用） |

**备注**：导出诊断日志与打开日志目录由 `CrashActionBar` 统一实现；该组件位于 `Provider` 的 ErrorBoundary 外层兜底中，因此不依赖 `GlobalAlertHost`。

## `src/components/crash-report-host.tsx`
**职责**：全局崩溃/API 熔断提示宿主（约 356 行）。订阅 `crashReporting` 的当前报告，在应用内弹出阻塞/非阻塞 Modal，展示错误摘要、可能原因、建议、技术详情，并提供复制、导出诊断日志、打开日志目录、重试/重载/退出操作。
**导出**：`CrashDetails`、`CrashActionBar`、`CrashReportHost`。私有：`useCrashReportState`。
**主要依赖**：`react`、`react-i18next`、`react-router-dom`（`useNavigate`）、`@tauri-apps/api/core`（`reset_api_health`/`app_quit`）、`morphicons/react` + `lucide` 图标（含 `UserRound`）、`@/components/ui/glass`（`GlassAlert`/`GlassButton`）、`@/components/ui/modal`（`GlassModalCompound`）、`@/utils/diagnostics`、`@/utils/crashReporting`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `useCrashReportState`（私有） | :25 | 订阅崩溃报告并在挂载时 `loadPendingCrashReports()` |
| `CrashDetails` | :45 | 图标 + 摘要 + 时间 + 时钟偏差警示 + 数美设备指纹警示（`api.kind === "device_fingerprint"` 时用 `crash.api_fingerprint_body`）+ `diagnoseCrash` 的「可能原因/建议处理」+ 折叠技术详情（message/detail/stack/API health） |
| `CrashActionBar` | :129 | 复制报告、导出 zip 并 `revealItemInDir`、打开日志目录、可选关闭/退出、主操作按钮；底部内联状态文案 |
| `CrashReportHost` | :253 | 读取当前报告并渲染 `GlassModal`（`z-[150]`）；`fatal` 报告禁止背景关闭/Escape；API 报告额外提供「前往账户页」按钮（`useNavigate` 跳 `/account`），主按钮先 `reset_api_health` 再重载；关闭时确认崩溃报告路径 |

**备注**：挂载于 `src/provider.tsx` 的 `ErrorBoundary` 内。API 熔断报告（`source:"api"`）现为**非致命**：先调用 `startupProgress.abortStartup` 收起 Splash 让用户可继续进入应用，账户由 `accountAvailability` 标记为不可用（账户页展示「账号不可用 / 重新登录」），弹窗可关闭；修复后点「已修复，重试」清除后端 `BLOCKED` 状态并重载。数美设备指纹失败时提示重启电脑并同步时区。i18n 键前缀 `crash.*`（新增 `api_fingerprint_body`、`cause_fingerprint`、`suggestion_fingerprint`、`action_go_account`）。

## `src/components/ui/input-otp.tsx`
**职责**：OTP 验证码输入——隐藏真实 input 承担键盘与粘贴，可视格子从 Context 读取字符。
**导出**：`InputOTP`、`GlassInputOTP`（别名，均带 `.Group/.Slot/.Separator` 子件）
**主要依赖**：`react`（createContext/useContext/useRef）、`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassInputOTPProps` | input-otp.tsx:4 | `value`、`onChange(value)`、`onComplete(value)`（达到 maxLength 时触发）、`maxLength`（默认 6）、`isInvalid`（格子红边）、`aria-describedby`、`className`、`children` |
| `OTPCtx` | input-otp.tsx:15 | 向 Slot 传递 `{ value, isInvalid }` |
| `InputOTP` | input-otp.tsx:20 | 隐藏 input（`inputMode="numeric"` `autoComplete="one-time-code"`，:37-50），输入过滤为 `[0-9A-Za-z]`；点击容器聚焦（:35） |
| `InputOTP.Group` | input-otp.tsx:56 | 格子横排容器（`flex gap-2`） |
| `InputOTP.Slot` | input-otp.tsx:66 | 单格：props `index`、`className`；渲染 `value[index]`，`isInvalid` 时 danger 边框；固定 36x44 |
| `InputOTP.Separator` | input-otp.tsx:89 | "—" 分隔符 |
| `GlassInputOTP` | input-otp.tsx:99 | 同一函数的别名并重复挂载三个子件 |

**备注**：`InputOTP` 与 `GlassInputOTP` 行为完全一致。

## `src/components/ui/input.tsx`
**职责**：文本输入框，含增强版 `GlassInput`（尺寸/状态/前后插槽）与精简版 `Input`。
**导出**：`Input`、`GlassInput`
**主要依赖**：`react`（forwardRef）、`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassInputProps` | input.tsx:4 | `variant`（声明但未用于样式）、`size`（`sm h-8 / md h-9 / lg h-11`，默认 `md`）、`isDisabled`、`isInvalid`（danger 边框）、`isClearable`（声明但未实现）、`startContent`/`endContent`（绝对定位插槽，`pointer-events-none`）、`onValueChange(value)` |
| `GlassInput` | input.tsx:16 | 有插槽时外包 `relative` 容器并加 `pl-9/pr-9`（:52-53, :62-72）；同时触发原生 `onChange` 与 `onValueChange` |
| `InputProps` / `Input` | input.tsx:78 / 81 | 原生 input 直通版，`type` 默认 `text`，固定 `h-9 rounded-xl` |

**备注**：`variant` 与 `isClearable` 目前是死 props（未参与渲染逻辑）。

## `src/components/ui/kbd.tsx`
**职责**：键盘按键标签 `<kbd>`，提供键名到符号的缩写映射。
**导出**：`Kbd`、`GlassKbd`（别名，带 `.Abbr/.Content` 子件）
**主要依赖**：`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassKbdProps` | kbd.tsx:3 | 继承 `HTMLAttributes<HTMLElement>` |
| `KEY_SYMBOLS` | kbd.tsx:5 | 键名映射：command→⌘、control→⌃、option→⌥、shift→⇧、enter→↵、backspace→⌫、space→␣、up/down/left/right→箭头 |
| `Kbd` | kbd.tsx:19 | `<kbd>` 样式容器（10px 字号、边框底色） |
| `Kbd.Abbr` | kbd.tsx:34 | props：`keyValue`、`className`；`title` 保留原始键名，显示符号（无映射则原样显示） |
| `Kbd.Content` | kbd.tsx:45 | 纯文本包裹 span |

## `src/components/ui/label.tsx`
**职责**：表单标签 `<label>` 的统一样式。
**导出**：`Label`、`GlassLabel`
**主要依赖**：`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassLabelProps` | label.tsx:3 | 继承 `LabelHTMLAttributes<HTMLLabelElement>` |
| `Label` | label.tsx:5 | `text-sm font-medium text-foreground`；`GlassLabel`（:13）为别名 |

## `src/components/ui/link.tsx`
**职责**：链接 `<a>` 的基础样式（hover 变主色并轻微上浮）。
**导出**：`Link`、`GlassLink`
**主要依赖**：`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassLinkProps` | link.tsx:3 | 继承 `AnchorHTMLAttributes<HTMLAnchorElement>` |
| `Link` | link.tsx:5 | `inline-flex` + `hover:text-primary hover:-translate-y-0.5`；`GlassLink`（:21）为别名 |

## `src/components/ui/loading-block.tsx`
**职责**：三种加载占位——居中圆环大块、行内小 spinner、多行骨架列表。
**导出**：`LoadingBlock`、`LoadingInline`、`SkeletonList`
**主要依赖**：`@/components/ui/glass`（`GlassCard`、`GlassProgressCircle`、`GlassSpinner`）、`clsx`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `LoadingBlockProps` / `LoadingBlock` | loading-block.tsx:4 / 13 | `label`（环下方文案）、`minHeight`（默认 200）、`className`；`role="status"`，内含不定量圆环（GlassProgressCircle `isIndeterminate` lg） |
| `LoadingInline` | loading-block.tsx:39 | `label?`；sm 号 `current` 色 spinner + 文案，用于按钮/小区域 |
| `SkeletonListProps` / `SkeletonList` | loading-block.tsx:49 / 58 | `count`（行数）、`rowHeight`（默认 80）、`gap`（默认 5，注入 `rowGap`）、`className`；每行为 GlassCard + 头像圆 + 两行文字条 + 两个按钮条的脉冲占位，`aria-hidden` |

## `src/components/ui/modal.tsx`
**职责**：模态框全家桶——普通 `GlassModal` 与确认用 `GlassAlertDialog`，均为 Portal + 复合（compound）API。
**导出**：`GlassModal`、`GlassModalCompound`、`GlassAlertDialog`、`GlassAlertDialogCompound`、类型 `GlassModalProps`、`GlassAlertDialogProps`
**主要依赖**：`react`（createContext/forwardRef/useContext/useEffect）、`react-dom`（`createPortal`）、`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ModalProps` | modal.tsx:21 | `isOpen`、`onOpenChange(open)`、`children` |
| `ModalBackdropProps` | modal.tsx:27 | `isDismissable`（默认 true）、`variant`（声明但未被消费）、`className` |
| `ModalContainerProps` | modal.tsx:34 | `size`（`xs/sm/md/lg/xl/2xl/full`）、`placement`（`center/top/bottom`）、`scroll`（`inside/outside`，当前未参与渲染） |
| `CONTAINER_SIZES` | modal.tsx:44 | size→max-width：xs 360 / sm 400 / md 560 / lg 720 / xl 1100 / 2xl 1000 / full `calc(100vw-2rem)` |
| `GlassModal` | modal.tsx:54 | 打开时挂 Esc 关闭 + 锁定 body 滚动（:55-67），Portal 到 body 并提供 `close` Context；关闭时不渲染任何节点 |
| `Backdrop` | modal.tsx:77 | 全屏遮罩 `z-[100] bg-black/60 backdrop-blur`；`isDismissable` 时 mousedown 点击自身关闭 |
| `Container` | modal.tsx:94 | 定位与宽度容器，`placement` 决定上下对齐 |
| `Dialog` | modal.tsx:115 | `role="dialog" aria-modal="true"`，`animate-scale-in rounded-2xl bg-surface` |
| `Header` / `Heading` / `Body` / `Footer` | modal.tsx:130 / 134 / 138 / 149 | 结构分区；`Heading` 为 `h2 text-lg`；`Body` 是 forwardRef（displayName `GlassModalBody`）默认 `overflow-y-auto` 并支持 `onScroll` |
| `CloseTrigger` | modal.tsx:153 | 右上角 x 按钮，读 Context 关闭 |
| `GlassModalWithSub`（即 `GlassModalCompound`） | modal.tsx:174 / 194 | 挂载 8 个子件：`Backdrop/Container/Dialog/Header/Heading/Body/Footer/CloseTrigger` |
| `AlertDialogProps` / `GlassAlertDialog` | modal.tsx:201 / 209 | 与 GlassModal 同构（Esc + 锁滚动 + Portal） |
| `AlertDialogBackdrop` / `AlertDialogContainer` / `AlertDialogDialog` | modal.tsx:234 / 247 / 251 | 遮罩（不可点击关闭）、限宽 400px 容器、`role="alertdialog"` 面板 |
| `ICON_TONES` / `AlertDialogIcon` | modal.tsx:266 / 274 | 圆形图标底色（success/warning/danger/info/default），`status` 默认 `info`，内嵌感叹号 SVG |
| `AlertDialogHeader` / `Heading` / `Body` / `Footer` / `CloseTrigger` | modal.tsx:285 / 289 / 293 / 297 / 301 | 结构件；`CloseTrigger` 为绝对定位右上 x |
| `GlassAlertDialogWithSub`（即 `GlassAlertDialogCompound`） | modal.tsx:322 / 344 | 挂载 9 个子件（比 Modal 多一个 `Icon`） |

**内部结构**（modal.tsx 共 345 行）：

| 行号区间 | 内容 |
| --- | --- |
| 5-19 | GlassModal 用法注释（compound API 示例） |
| 21-52 | 三个接口定义 + size 到宽度映射表 |
| 54-195 | `GlassModal` 及其 8 个子件实现、复合类型断言、导出 |
| 197-207 | GlassAlertDialog 分隔注释 + 接口与 Context |
| 209-320 | `GlassAlertDialog` 及其 9 个子件实现 |
| 322-345 | 复合类型断言、子件挂载与导出 |

**备注**：`Container` 接收 `scroll` prop 但实现未使用；`Backdrop` 声明了 `variant` 却不消费（`confirm-dialog.tsx:61` 传 `variant="blur"` 无效）；`xl`(1100px) 比 `2xl`(1000px) 更宽，尺寸序列不单调。

## `src/components/ui/number-field.tsx`
**职责**：数字步进器（减号 / 数字输入 / 加号），通过 Context 共享取值与上下限。
**导出**：`NumberField`、`GlassNumberField`（别名，均带 `.Group/.DecrementButton/.IncrementButton/.Input`）
**主要依赖**：`react`（createContext/useContext）、`@/lib/utils`、`./input`（`GlassInput`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassNumberFieldProps` | number-field.tsx:5 | `value`（默认 0）、`onChange(value)`、`minValue`、`maxValue`、`aria-label`、`className`、`children` |
| `NumberFieldCtx` | number-field.tsx:15 | 传递 `{ value, min, max, onChange }` |
| `NumberField` | number-field.tsx:27 | 根容器 `role="group"`，`onChange` 缺省为空函数 |
| `NumberField.Group` | number-field.tsx:56 | 横排分组容器（与根重复一层相同样式） |
| `NumberField.DecrementButton` | number-field.tsx:70 | 减一；`value <= min` 时禁用（:78）；9x9 方钮内嵌减号 SVG |
| `NumberField.IncrementButton` | number-field.tsx:106 | 加一；`value >= max` 时禁用（:114） |
| `NumberField.Input` | number-field.tsx:142 | 基于 `GlassInput type="number"` 居中显示；NaN 回填 0（:153） |

**备注**：步长固定 1，无 `step` prop；输入非法值被归一为 0 而非保留空串。

## `src/components/ui/page-header.tsx`
**职责**：页面级页头（大标题 + 描述 + 右侧操作区），支持锚点 id 供站内搜索跳转。
**导出**：`PageHeader`
**主要依赖**：`clsx`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `PageHeaderProps` | page-header.tsx:3 | `title`（必填）、`description`、`actions`（右上按钮组）、`id`（锚点）、`className` |
| `PageHeader` | page-header.tsx:16 | `<header id>`；标题 `text-2xl lg:text-3xl font-bold`，移动端纵向、桌面横向两端对齐（:27） |

## `src/components/ui/progress.tsx`
**职责**：进度展示两件套——环形 `ProgressCircle`（含不定量加载态）与线性 `Meter`，均为 Context 驱动的复合组件。
**导出**：`ProgressCircle`、`Meter`、`GlassProgressCircle`（别名）、`GlassMeter`（别名）
**主要依赖**：`react`（createContext/useContext）、`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ProgressCtx` | progress.tsx:21 | 传递 `{ size, strokeWidth, value, isIndeterminate }` |
| `ProgressCircle` | progress.tsx:28 | 根组件。props：`isIndeterminate`（默认 false，动画旋转）、`size`（`sm 24 / md 32 / lg 40` 或数字，默认 `md`）、`value`（0-100 被 clamp）、`aria-label`、`className`；线宽自动 `max(2, round(px/10))`（:44）；输出 `role="progressbar"`，svg 整体 `-rotate-90` |
| `ProgressCircle.Track` | progress.tsx:72 | `<g>` 分组包裹 |
| `ProgressCircle.TrackCircle` | progress.tsx:82 | 底环（`text-separator`），半径 `(size-strokeWidth)/2` |
| `ProgressCircle.FillCircle` | progress.tsx:98 | 进度弧（`text-primary`），`strokeDashoffset` 按 value 计算；不定量时固定 75% 弧长 + `animate-spin`（:102, :116） |
| `GlassProgressCircle` | progress.tsx:132 | `ProgressCircle` 别名（`loading-block.tsx` 使用） |
| `MeterCtx` / `Meter` | progress.tsx:142 / 144 | 线性进度根：props `value`（clamp 0-100）、`aria-label`、`className`；`role="meter"` |
| `Meter.Output` | progress.tsx:170 | 百分比文本，默认 `sr-only` |
| `Meter.Track` | progress.tsx:177 | `h-2` 圆角轨道 |
| `Meter.Fill` | progress.tsx:191 | 主色填充，宽度 `value%`，500ms 过渡 |
| `GlassMeter` | progress.tsx:205 | `Meter` 别名 |

**备注**：圆环与进度条共用 `value` 语义（0-100），`isIndeterminate` 时 `aria-valuenow` 置空。

## `src/components/ui/section-card.tsx`
**职责**：设置/分区卡片——标题 + 描述 + 操作区 + 内容区的标准化外壳。
**导出**：`SectionCard`
**主要依赖**：`@/components/ui/glass`（`GlassCard`）、`clsx`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SectionCardProps` | section-card.tsx:4 | `id`（锚点）、`title`、`description`、`actions`（右侧按钮）、`padded`（默认 `true` 是否内边距）、`flush`（移除内边距用于自定义布局）、`className`、`children`（必填） |
| `SectionCard` | section-card.tsx:17 | 基于 `GlassCard`，hover 时 `shadow-md + scale 1.01`（:32）；有 title/actions 才渲染头行（:36）；内容区 padding 规则见 :57-63 |

**备注**：`padded` 与 `flush` 同时为 true 时以 `flush` 优先（内容 `p-0`，头行仍保留 padding）。

## `src/components/ui/select.tsx`
**职责**：自定义下拉选择器（Portal 定位菜单），提供 `GlassSelect` 与薄封装 `Select`。
**导出**：`Select`、`GlassSelect`、类型 `GlassSelectOption`、`GlassSelectProps`
**主要依赖**：`react`（useEffect/useRef/useState）、`react-dom`（`createPortal`）、`@/lib/utils`、`@/components/ui/app-icon`（`ChevronDownIcon`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassSelectOption` | select.tsx:6 | `{ value, label }` |
| `GlassSelectProps` | select.tsx:11 | `value`（可 null）、`options`、`onChange(value)`、`className`、`placeholder`、`maxMenuHeight`（默认 288）、`highlightSelected`（默认 false，选中项加粗） |
| `GlassSelect` | select.tsx:21 | 触发按钮 + fixed 定位菜单（`z-[9999]`，按下拉框底部 `top = rect.bottom + 4`，:56-59）；菜单宽度 `max(150, 触发器宽度)` |
| `SelectProps` / `Select` | select.tsx:128 / 138 | 薄封装：回调取 `onValueChange ?? onChange`；**两者都不传时直接返回 null（不渲染）**（:148） |

**备注**：打开状态下任意 document mousedown 或 window scroll（capture）都会关闭菜单（select.tsx:35-49）。

## `src/components/ui/settings-row.tsx`
**职责**：设置项行（左侧标题描述、右侧控件），及统一分隔线。
**导出**：`SettingsRow`、`SettingsDivider`
**主要依赖**：`clsx`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `SettingsRowProps` | settings-row.tsx:3 | `id`（锚点）、`title`（必填）、`description`、`control`（必填，右侧控件）、`className` |
| `SettingsRow` | settings-row.tsx:16 | 移动端纵向、桌面两端对齐；左区 `flex-1`，右区 `shrink-0` |
| `SettingsDivider` | settings-row.tsx:43 | `h-px bg-separator` 全宽线，`role="separator"` |

## `src/components/ui/skeleton.tsx`
**职责**：骨架屏占位块（脉冲动画）。
**导出**：`Skeleton`、`GlassSkeleton`
**主要依赖**：`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassSkeletonProps` | skeleton.tsx:3 | 继承 `HTMLAttributes<HTMLDivElement>`（自定宽高通过 `className`/`style`） |
| `Skeleton` | skeleton.tsx:5 | `aria-hidden` + `animate-pulse rounded-lg`；**仅当 className 不含 `bg-` 时才补默认 `bg-muted`**（:6, :12） |
| `GlassSkeleton` | skeleton.tsx:20 | 别名 |

## `src/components/ui/slider.tsx`
**职责**：基于 Radix 的滑块（轨道 + 范围 + 手柄），含内阴影玻璃质感样式。
**导出**：`Slider`
**主要依赖**：`@radix-ui/react-slider`（^1.4.7）、`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `Slider` | slider.tsx:5 | forwardRef 直通 `SliderPrimitive.Root` 全部 props（`value`/`min`/`max`/`step`/`onValueChange` 等 Radix 原生 API）；Thumb 自动继承根的 `aria-label`（:21）；displayName 取自 Radix Root |

**备注**：无自定义 props，样式常量写死在 Track/Range/Thumb 上；`value` 是 Radix 的数组形式。

## `src/components/ui/spinner.tsx`
**职责**：SVG 环形加载指示器。
**导出**：`Spinner`、`GlassSpinner`
**主要依赖**：`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassSpinnerProps` | spinner.tsx:3 | `size`（`sm 16 / md 24 / lg 32` 或数字，默认 `sm`）、`color`（`current/default/primary`，默认 `current`）、`className` |
| `colorMap` | spinner.tsx:9 | color → text 类映射 |
| `Spinner` | spinner.tsx:15 | `animate-spin` + 底圈 25% 透明 + 90% 透明弧线，`aria-hidden` |
| `GlassSpinner` | spinner.tsx:47 | 别名（`GlassButton` 的 `isLoading` 使用） |

## `src/components/ui/status-badge.tsx`
**职责**：账户同步状态徽标——把状态枚举映射为语义色 Chip。
**导出**：`StatusBadge`、`SYNC_STATUS_META`、类型 `StatusTone`、`StatusConfig`
**主要依赖**：`@/components/ui/glass`（`GlassChip`）、`clsx`、`@/types`（`AccountSyncStatus`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `StatusTone` | status-badge.tsx:5 | `success/warning/danger/default` |
| `StatusConfig` | status-badge.tsx:7 | `{ tone, label, showLed? }` |
| `SYNC_STATUS_META` | status-badge.tsx:13 | `AccountSyncStatus` → 配置：`HYTOKEN_EXPIRED`→danger/"EXPIRED"、`FAILED`→warning/"SYNC FAILED"、`SYNCING`→default/"SYNCING" |
| `StatusBadge` | status-badge.tsx:27 | props：`config`（StatusConfig）、`className`；渲染 `GlassChip size="sm" variant="soft"`，强制 `font-bold tracking-wider text-[10px] h-5` |

**备注**：`StatusConfig.showLed` 字段本文件未消费（仅作元数据，供其他组件决定是否画状态灯）。

## `src/components/ui/status-dot.tsx`
**职责**：独立的状态圆点（账号卡片用），带可选 ping 动画与 glow 阴影。
**导出**：`StatusDot`、类型 `StatusDotTone`
**主要依赖**：`clsx`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `StatusDotTone` | status-dot.tsx:3 | `success/danger/warning/default` |
| `StatusDotProps` | status-dot.tsx:5 | `tone`（必填）、`ping`（默认 `false`）、`className` |
| `TONE_STYLES` | status-dot.tsx:11 | tone → `{ dot, ping, shadow }` 三组类名；default 无 ping/shadow |
| `StatusDot` | status-dot.tsx:41 | 固定 12x12 圆点 + 可选 `animate-ping opacity-20` 覆盖层 |

**备注**：与 `app-icon.tsx:41` 的 `StatusDot` 是两个不同实现（此处 props 为 `ping`，彼处为 `pulse` + `size`）。

## `src/components/ui/switch.tsx`
**职责**：开关组件三件套——复合式 `GlassSwitch`（Root+Control+Thumb 分离）与一体式 `Switch`/`SwitchThumb`，均基于 Radix。
**导出**：`Switch`、`SwitchThumb`、`GlassSwitch`
**主要依赖**：`@radix-ui/react-switch`（^1.3.7）、`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassSwitchProps` | switch.tsx:5 | Radix Root props（省略 `onCheckedChange`）+ `isSelected`、`onValueChange(selected)`、`isDisabled` |
| `GlassSwitch` | switch.tsx:14 | `disabled 或 isDisabled` 时禁用；**未传 children 时默认渲染裸 `SwitchPrimitive.Thumb`（无轨道样式）**（:37），正常用法是传入 `GlassSwitch.Control` 包 `GlassSwitch.Thumb` |
| `GlassSwitch.Control` | switch.tsx:42 | 轨道：`h-6 w-11` 圆角，`group-data-[state=checked]` 时变主色 |
| `GlassSwitch.Thumb` | switch.tsx:63 | 手柄：白色 20x20，checked 时 `translate-x-[22px]` |
| `SwitchThumb` | switch.tsx:77 | forwardRef 的 Radix Thumb，样式同上但用 `data-[state=checked]`（无 group 前缀） |
| `Switch` | switch.tsx:93 | forwardRef 一体式 Root：轨道样式直接写在 Root 上，children 缺省渲染 `SwitchThumb`（:105） |

**备注**：两套 API 选一即可——`GlassSwitch`（分体，需显式组合 Control/Thumb）或 `Switch`（一体，零子件可用）。

## `src/components/ui/table.tsx`
**职责**：语义化表格复合组件（容器 + table + 表头/行/单元格）。
**导出**：`Table`、`GlassTable`（别名，带 7 个子件）
**主要依赖**：`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassTableProps` | table.tsx:3 | 通用 `{ className?, children? }` |
| `Table` | table.tsx:8 | 外层滚动容器（`w-full overflow-x-auto`） |
| `Table.ScrollContainer` | table.tsx:12 | 额外横向滚动容器 |
| `Table.Content` | table.tsx:16 | `<table>` 本体，支持 `aria-label`，`border-collapse text-sm` |
| `Table.Header` | table.tsx:32 | `<thead>` 并**自动包裹一层 `<tr>`**（:36），子件应直接写 `<Column>` |
| `Table.Column` | table.tsx:40 | `<th>`；`isRowHeader=true` 时 `scope="row"` 否则 `scope="col"` |
| `Table.Body` | table.tsx:51 | `<tbody>`，`divide-y divide-separator/60` |
| `Table.Row` | table.tsx:55 | `<tr>`，hover 背景 + 微缩放 |
| `Table.Cell` | table.tsx:59 | `<td>`，`px-4 py-2.5` |

**备注**：`Table.Header` 自带 `<tr>`，不要在其内部再写 `<tr>`。

## `src/components/ui/toggle-group.tsx`
**职责**：分段切换组（单选/多选胶囊组），基于 Radix ToggleGroup。
**导出**：`ToggleGroup`、`ToggleGroupItem`
**主要依赖**：`@radix-ui/react-toggle-group`（^1.1.19）、`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `ToggleGroup` | toggle-group.tsx:5 | forwardRef 直通 `ToggleGroupPrimitive.Root`（`type="single"/"multiple"`、`value`、`onValueChange` 等 Radix 原生 props）；外层胶囊容器样式 |
| `ToggleGroupItem` | toggle-group.tsx:21 | forwardRef 直通 `Item`；`data-[state=on]` 时主色底/字；首尾自动圆角（:28） |

## `src/components/ui/tooltip.tsx`
**职责**：纯 CSS 悬浮提示（group-hover 触发，绝对定位在触发元素上方），两套同构实现。
**导出**：`Tooltip`、`GlassTooltip`
**主要依赖**：`@/lib/utils`（`cn`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassTooltipProps` | tooltip.tsx:3 | 继承 `HTMLAttributes<HTMLSpanElement>`；声明了 `delay` 但实现未使用 |
| `GlassTooltip` | tooltip.tsx:7 | 触发容器 `group relative inline-flex` |
| `GlassTooltip.Content` | tooltip.tsx:15 | `role="tooltip"`，默认透明，`group-hover` 时显现并上浮 4px（:29） |
| `TooltipProps` / `Tooltip` | tooltip.tsx:40 / 42 | 同 GlassTooltip，容器类名改为 `peer/group` |
| `Tooltip.Content` | tooltip.tsx:50 | 除 `group-hover` 外还响应 `peer-focus-within`（键盘聚焦也显示，:65） |

**备注**：提示内容必须作为触发元素的兄弟节点（依赖 group/peer 选择器）；`delay` prop 无效（无延迟实现）。

## `src/components/ui/radio-group.tsx`
**职责**：原生单选组（radio group），不依赖 Radix ToggleGroup。用于「N 选一」且需要明确必选语义的场景（如设置页的网络代理协议 HTTP / SOCKS5）。
**导出**：`GlassRadioGroup`（`Object.assign` 复合组件，挂在 `GlassRadioGroup.Item` 上）、类型 `GlassRadioGroupProps`、`GlassRadioGroupItemProps`
**主要依赖**：`react`（Context/useRef/useMemo）、`@/lib/utils`（`cn`）。**不依赖** `@radix-ui/react-toggle-group`——Radix 的 `type` 只接受 `single`/`multiple` 与旧实现冲突。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassRadioGroupProps` | radio-group.tsx:4-19 | `value`（必填当前值）、`onValueChange?`、`children?`、`className?`、`isDisabled?`、`aria-label?`、`orientation?`（`horizontal`(默认)/`vertical`，仅影响方向键） |
| `GlassRadioGroupItemProps` | radio-group.tsx:21-26 | `value`（必填）、`children?`、`className?`、`isDisabled?` |
| `RadioGroupContext` | radio-group.tsx:28-38 | 内部 Context：`value`/`onValueChange`/`isDisabled`/`orientation`/`register`/`order` |
| `GlassRadioGroupRoot`（私有） | radio-group.tsx:47-147 | 根容器：`role="radiogroup"` + `aria-orientation`；←/→（纵向为 ↑/↓）轮转并聚焦下一项；注册表用 `Map` 保存各 item 的 DOM 节点 |
| `GlassRadioGroupItem`（私有） | radio-group.tsx:149-197 | 每项为原生 `<button role="radio" aria-checked>`，选中项 `tabIndex=0`、其余 `-1`（roving tabindex），重复点击不重复触发 `onValueChange`；左侧小圆点表达选中态 |
| `GlassRadioGroup`（export） | radio-group.tsx:199-201 | `Object.assign(GlassRadioGroupRoot, { Item: GlassRadioGroupItem })` |

**备注**：`GlassRadioGroup.Item` 必须在 `GlassRadioGroup` 内部使用（否则抛错「必须放在 GlassRadioGroup 内部」）；默认横向、整组宽度 `w-fit`，容器胶囊边框与 `ToggleGroup` 保持一致但内边距/字号更大（`h-8`、`text-sm`）以便承载协议名。

## `src/components/ui/glass/index.ts`
**职责**：玻璃拟态风格统一出口（barrel）：把各基础文件里的 `Glass*` 组件与类型再导出，供 `@/components/ui/glass` 一键引入。
**导出**：见下表（32 行导出语句）
**主要依赖**：同目录上级各模块（`../button`、`../radio-group`、`../modal` 等 20 个来源文件）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `GlassButton` + 4 个类型 | glass/index.ts:1 | 来自 `../button` |
| `GlassCard` + `GlassCardProps` | glass/index.ts:2 | 来自 `../card` |
| `GlassInput` + `GlassInputProps` | glass/index.ts:3 | 来自 `../input` |
| `GlassSwitch` + `GlassSwitchProps` | glass/index.ts:4 | 来自 `../switch` |
| `Slider` | glass/index.ts:5 | 来自 `../slider`（无 Glass 前缀） |
| `GlassCheckbox` + 类型 | glass/index.ts:6 | 来自 `../checkbox` |
| `GlassChip` + `GlassChipProps`、`GlassChipTone` | glass/index.ts:7 | 来自 `../badge` |
| `GlassSkeleton` + 类型 | glass/index.ts:8 | 来自 `../skeleton` |
| `GlassKbd` + 类型 | glass/index.ts:9 | 来自 `../kbd` |
| `GlassAlert` + `GlassAlertProps`、`GlassAlertStatus` | glass/index.ts:10 | 来自 `../alert` |
| `GlassTooltip` + 类型 | glass/index.ts:11 | 来自 `../tooltip` |
| `GlassLabel` + 类型 | glass/index.ts:12 | 来自 `../label` |
| `GlassLink` + 类型 | glass/index.ts:13 | 来自 `../link` |
| `GlassSpinner` + 类型 | glass/index.ts:14 | 来自 `../spinner` |
| `GlassProgressCircle`、`GlassMeter` | glass/index.ts:15 | 来自 `../progress` |
| `GlassTable` | glass/index.ts:16 | 来自 `../table` |
| `GlassNumberField` + 类型 | glass/index.ts:17 | 来自 `../number-field` |
| `GlassSelect` + `GlassSelectProps`、`GlassSelectOption` | glass/index.ts:18 | 来自 `../select` |
| `GlassRadioGroup` + `GlassRadioGroupProps`、`GlassRadioGroupItemProps` | glass/index.ts:19-23 | 来自 `../radio-group`（单选组，`GlassRadioGroup.Item` 复合用法） |
| `GlassInputOTP` + 类型 | glass/index.ts:24 | 来自 `../input-otp` |
| `GlassModal`、`GlassModalCompound`、`GlassAlertDialog`、`GlassAlertDialogCompound` + 2 类型 | glass/index.ts:25-32 | 来自 `../modal` |

**备注**：此桶**不含**无 Glass 前缀的组件（`Button`、`Input`、`Checkbox`、`Select`、`Table`、`Kbd` 等），也不含 `EmptyState`、`StatusBadge`、`LoadingBlock`、`ConfirmDialogHost` 等业务化组件——这些需直接从各自文件引入。

## `src/components/primitives.ts`
**职责**：tailwind-variants 定义的排版原语（渐变大标题、副标题）。
**导出**：`title`、`subtitle`
**主要依赖**：`tailwind-variants`（^3.2.2，`tv`）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `title` | primitives.ts:3 | 渐变文字标题。variants：`color`（violet/yellow/blue/cyan/green/pink/foreground 七种渐变）、`size`（sm/md/lg，默认 md）、`fullWidth`；compoundVariants 为所有 color 附加 `bg-clip-text text-transparent bg-gradient-to-b`（:27-40）。用法 `title({ color: "violet", size: "lg" })` |
| `subtitle` | primitives.ts:43 | 副标题 `text-lg lg:text-xl text-muted`；variant `fullWidth`（默认 `true`，`!w-full`） |

**备注**：渐变色值是硬编码十六进制（如 `#FF1CF7`），与主题 token 不联动。

## `src/components/icons.tsx`
**职责**：业务图标集合——品牌图标（内联 SVG）、lucide 图标的 MorphIcon 封装、以及 key 到图标的映射表 `CardIcon`。
**导出**：`Logo`、`DiscordIcon`、`TwitterIcon`、`GithubIcon`、29 个命名图标、3 个别名、`CardIcon`
**主要依赖**：`lucide`（^1.33.0，35 个图标）、`morphicons/react`（`MorphIcon`）、`@/components/morph-icon`（`createMorphIcon`、`IconSvgProps`）、`morphicons`（`IconInput` 类型）

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `Logo` | icons.tsx:43 | 品牌 Logo SVG（32x32 viewBox），props：`size`（默认 36）/`height` + 全部 SVGProps |
| `DiscordIcon` | icons.tsx:64 | 内联路径的 Discord 图标（createMorphIcon 接收路径数组） |
| `TwitterIcon` | icons.tsx:68 | Twitter/X 图标 |
| `GithubIcon` | icons.tsx:72 | GitHub 图标 |
| `MoonIcon`/`SunIcon`/`ComputerIcon`/`HeartIcon`/`SearchIcon`/`HomeIcon`/`ChartIcon`/`SettingsIcon`/`UsersIcon`/`ProjectsIcon`/`CalendarIcon`/`HelpIcon`/`DeveloperIcon`/`AccountIcon`/`StarIcon`/`GachaIcon`/`MedalIcon`/`BookmarkIcon`/`TagIcon`/`FolderIcon`/`BellIcon`/`PlusIcon`/`ChevronLeftIcon`/`EditIcon`/`TrashIcon` | icons.tsx:76-100 | lucide 图标（Moon/Sun/Monitor/Heart/Search/Home/BarChart3/Settings/Users/FolderOpen/Calendar/HelpCircle/Code/User/Star/Sparkles/Award/Bookmark/Tag/Folder/Bell/Plus/ChevronLeft/Pencil/Trash2）的 MorphIcon 封装 |
| `TerminalIcon`/`CopyIcon`/`ExternalLinkIcon`/`GamepadIcon` | icons.tsx:101-104 | lucide 图标（Terminal/Copy/ExternalLink/Gamepad2）的 MorphIcon 封装，用于游戏启动快捷弹窗的命令/快捷方式/Steam 板块 |
| `MoonFilledIcon`/`SunFilledIcon`/`HeartFilledIcon` | icons.tsx:106 | 上述三个图标的再导出别名 |
| `CARD_ICON_MAP` | icons.tsx:108 | 23 个 key（home/chart/users/star/heart/bookmark/tag/folder/calendar/bell/settings/account/search/developer/projects/file/map/satellite/award/user/help/factory/sprout）→ lucide 图标数据 |
| `CardIcon` | icons.tsx:134 | props：`iconKey`（必填）、`size`（默认 24）、`className` + SVGProps；**key 未命中映射时回退为纯文本 span 显示 key 本身**（:141）；渲染前剥离 `from/to/ref`（:142） |

**备注**：`PlusIcon`/`ChevronLeftIcon`/`EditIcon`/`BellIcon` 等名称与 `ui/app-icon.tsx` 中的同名导出重复，来自不同模块，import 时务必确认路径。

## `src/components/morph-icon.tsx`
**职责**：morphicons 的工厂函数——把 lucide/路径数据包成支持 `size` 属性、可转发 ref 的统一图标组件。
**导出**：`createMorphIcon`、类型 `IconSvgProps`、`MorphHandle`、`IconInput`
**主要依赖**：`morphicons/react`（`MorphIcon`、`MorphHandle`）、`morphicons`（`IconInput`）、`react`

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `MorphHandle` / `IconInput` | morph-icon.tsx:5 | 从 morphicons 包转出的类型（ref 句柄 / 图标输入数据） |
| `IconSvgProps` | morph-icon.tsx:7 | `React.SVGProps<SVGSVGElement>` + `size?: number` |
| `createMorphIcon` | morph-icon.tsx:11 | 入参 lucide 图标或路径数组；返回 `forwardRef<MorphHandle, IconSvgProps>` 组件，透传 `size/className/style` 及其余 SVG 属性，剥离 `from/to/ref`（:14）；`displayName` 固定为 `"MorphIcon"` |

**备注**：这是 `app-icon.tsx` 与 `icons.tsx` 全部图标的公共底座；图标切换动效由 `morphicons` 库内部提供。

---

## 附：跨文件注意点

1. **`StatusDot` 重名双实现**：`app-icon.tsx:41`（`pulse` + `size`）与 `status-dot.tsx:41`（`ping`，固定 12px）。
2. **图标导出重名**：`icons.tsx` 与 `app-icon.tsx` 均导出 `PlusIcon`、`ChevronLeftIcon`、`EditIcon`、`BellIcon`。
3. **死/无效 props**：`input.tsx` 的 `variant`、`isClearable`；`tooltip.tsx` 的 `delay`；`modal.tsx` 的 `Backdrop.variant` 与 `Container.scroll`；`badge.tsx` 的 cva `variant/color` 变体值为空串（实际配色由 tone 表决定）。
4. **注释与实现不符**：`back-to-top.tsx:8-9` 注释称超过 50% 显示，实际 `p > 20`（:32）。
5. **尺寸序列异常**：`modal.tsx:44-52` 中 `xl` 1100px 大于 `2xl` 1000px。
6. **层级风险**：`GlobalAlertHost` 为 `z-50`，modal/AlertDialog 遮罩为 `z-[100]`，Select 菜单 `z-[9999]`，BackToTop 为 `z-[10003]`。
7. **依赖包名**：图标库为 `lucide`（v1.33.0）而非常见的 `lucide-react`；动效图标为 `morphicons`（v1.7.0）。
8. **`GlassSelect` 关闭策略**：菜单打开时任意滚动（capture 阶段）都会关闭菜单（select.tsx:42）。
9. **`Select` 静默不渲染**：未提供 `onValueChange`/`onChange` 时返回 `null`（select.tsx:148）。
10. **`confirmDialog` 依赖 Host**：未挂载 `ConfirmDialogHost` 时永远 resolve `false`（confirm-dialog.tsx:18）。

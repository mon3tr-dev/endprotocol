# 前端服务与工具（B 组：更新/解析/图片/日志）— 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。

## `src/utils/updateService.ts`
**职责**：应用内更新服务。封装 Tauri updater 插件与 GitHub/镜像双源的版本检查、更新日志（changelog）获取与缓存、稳定/预览双频道切换、跨平台验签安装流程，并通过自定义订阅系统与消息中心向 UI 推送状态。

**导出**：类型 `UpdateChannel`、`UpdateSource`、`UpdateStatus`、`ChangelogStatus`、`UpdateErrorCode`、`UpdateInfo`、`ManualUpdate`、`UpdateCheckResult`、`RemoteVersionState`；函数 `getChannel`、`getSource`、`setChannel`、`initializeChannel`、`setSource`、`checkForUpdate`、`getCurrentUpdate`、`getCurrentUpdateInfo`、`getStatus`、`getIsDownloading`、`getDownloadProgress`、`getDownloadTotal`、`downloadUpdate`、`cancelDownload`、`openUpdateDialog`、`subscribeUpdateState`、`subscribeDownloadProgress`、`getRemoteVersion`、`subscribeRemoteVersion`、`fetchRemoteVersion`、`addUpdateMessage`、`checkAndNotify`、`addProgressMessage`、`updateProgressMessage`、`removeProgressMessage`。

**主要依赖**：`@tauri-apps/plugin-updater`（`check`/`Update`）、`@tauri-apps/api/core`（`invoke`）、`@tauri-apps/api/event`（`listen`）、`@tauri-apps/api/app`（动态 `getVersion`）、`@tauri-apps/plugin-process`（动态 `relaunch`）、`./platform`（区分 Windows 安装重启行为）、`@/i18n`、`./messageStore`、`@/components/ui/global-alert`、`./configService`、`./logger`。

### 导出符号表

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `UpdateChannel` | updateService.ts:14 | 类型：`"stable" \| "preview"` 更新频道 |
| `UpdateSource` | updateService.ts:16 | 类型：`"github" \| "mirror"` 下载/检查来源 |
| `UpdateStatus` | updateService.ts:18 | 类型：`idle/checking/available/not-available/error` |
| `ChangelogStatus` | updateService.ts:25 | 类型：`idle/loading/success/failed/unavailable` |
| `UpdateErrorCode` | updateService.ts:32 | 类型：`UPDATE_CHECK_FAILED` / `CHANGELOG_FETCH_FAILED` / `DOWNLOAD_FAILED` / `INSTALL_FAILED`（后三者在本文件中未被赋值） |
| `UpdateInfo` | updateService.ts:38 | 接口：`currentVersion/newVersion/date?/body?` |
| `ManualUpdate` | updateService.ts:46 | 预览/频道切换候选；安装通过 Tauri updater 按本机目标处理 |
| `UpdateCheckResult` | updateService.ts:53 | 接口：检查结果（`available/update/changelog/changelogStatus/status/errorCode?/errorMessage?`） |
| `getChannel` | updateService.ts:670 | 同步返回当前 `currentChannel`，无 IPC |
| `getSource` | updateService.ts:674 | 同步返回当前 `currentSource`，无 IPC |
| `setChannel` | updateService.ts:678 | 切换频道：持久化配置 → 清空缓存与状态 → `emitChange` → 自动调用 `checkForUpdate()` 并刷新消息中心 |
| `initializeChannel` | updateService.ts:739 | 启动时恢复频道与更新源配置，非法值回退默认（stable/github） |
| `setSource` | updateService.ts:757 | 持久化更新源 → 清缓存 → `emitChange` → 自动 `checkForUpdate()` 并刷新消息 |
| `checkForUpdate` | updateService.ts:807 | 核心检查入口：置 `status="checking"` → `performUpdateCheck()` → 回写状态并广播。预览频道会比较稳定版与预览版，endpoint updater 根据本机平台检查签名更新；更新日志按候选版本选择 |
| `getCurrentUpdate` | updateService.ts:819 | 返回缓存的 `Update` 或 `ManualUpdate` |
| `getCurrentUpdateInfo` | updateService.ts:823 | 返回最近一次的 `UpdateInfo` |
| `getStatus` | updateService.ts:827 | 返回 `UpdateStatus` |
| `getIsDownloading` | updateService.ts:831 | 返回下载中标记 |
| `getDownloadProgress` | updateService.ts:835 | 返回已下载字节数 |
| `getDownloadTotal` | updateService.ts:839 | 返回总字节数 |
| `downloadUpdate` | updateService.ts:843 | 下载并安装。预览/频道切换通过 `install_update_endpoint` 使用 Tauri updater 验签安装；稳定更新使用插件 `Update.download()`/`install()`；macOS/Linux 安装后 `relaunch()`。进度经 `addProgressMessage`/`updateProgressMessage` 展示，异常走 `pushGlobalAlert("danger", …)` |
| `cancelDownload` | updateService.ts:945 | 中止当前下载控制器、复位进度、移除进度消息、`emitChange()` |
| `openUpdateDialog` | updateService.ts:959 | 派发 `window` 自定义事件 `openUpdateDialog` |
| `subscribeUpdateState` | updateService.ts:972 | 注册状态监听（推入 `listeners`），返回退订函数 |
| `subscribeDownloadProgress` | updateService.ts:979 | 与 `subscribeUpdateState` 共用 `listeners` 数组 |
| `RemoteVersionState` | updateService.ts:987 | 遗留接口：远程版本状态（`version/date/body/checked/loading/error/hasUpdate`） |
| `getRemoteVersion` | updateService.ts:1014 | 返回模块内 `remoteState` 快照 |
| `subscribeRemoteVersion` | updateService.ts:1018 | 注册 `remoteListeners`，返回退订函数 |
| `fetchRemoteVersion` | updateService.ts:1025 | 防重入拉取：`checkForUpdate()` 后写入 `remoteState` 并 `emitRemoteChange()`；失败置 `error=true` |
| `addUpdateMessage` | updateService.ts:1063 | 向 messageStore 添加更新通知，动作派发 `openUpdateDialog` 事件 |
| `checkAndNotify` | updateService.ts:1090 | `initializeChannel()` + `checkForUpdate()`，有更新则 `addUpdateMessage` |
| `addProgressMessage` | updateService.ts:1100 | 创建带进度的 info 消息，以 `progressMessageId` 防重复 |
| `updateProgressMessage` | updateService.ts:1114 | 按 `progressMessageId` 更新消息 |
| `removeProgressMessage` | updateService.ts:1121 | 移除进度消息并清空 `progressMessageId` |

### 内部结构（行号区间）

| 区间 | 内容 |
| --- | --- |
| 15–79 | 类型定义与内部接口（`GitHubRelease`、`ChangelogCacheEntry`） |
| 81–117 | 常量（仓库/镜像基址/TTL）与模块级状态变量 |
| 120–182 | SemVer 解析/比较、`isPreviewChannel`、`stripVPrefix`、`channelFromVersion` |
| 184–226 | GitHub Release 列表与预览 release endpoint 解析 |
| 228–295 | changelog 缓存、频道切换判定与镜像 changelog URL |
| 297–534 | 更新解析：preview 检查稳定/预览清单；GitHub 频道切换加载对应 tag 的 `latest.json` 并按本机平台检查更新 |
| 536–601 | `fetchChangelog`：镜像 notes URL → GitHub Release body → `CHANGELOG.md` 附件 |
| 602–669 | `performUpdateCheck` 组装 `UpdateCheckResult` |
| 670–966 | 公共 API：频道/来源设置、检查、跨平台下载安装/取消、对话框事件 |
| 967–1062 | 订阅系统与遗留 `remoteState` API |
| 1063–1127 | 消息中心集成（更新提示与下载进度消息） |

**备注**：
- **Tauri invoke 命令**：`fetch_url`（:282、:347、:405、:554，代理 HTTP GET）、`check_update_endpoint`（:364、:447、:516，按本机平台检查受限清单）、`install_update_endpoint`（:884，updater 签名安装）；另经 `configService` 使用 `get_config`/`set_config`。
- **事件监听**：`listen("download-progress", …)`（:864）；自定义 window 事件 `openUpdateDialog`、`remoteVersionChanged`。
- **网络端点**：GitHub API Release 列表与 tag release；镜像稳定/预览清单；GitHub stable latest 与预览 tag 的 `latest.json`，以及 release `CHANGELOG.md` 附件。
- **缓存**：changelog 为模块内 `Map`，key = `changelog_cache_{channel}_{version}`，TTL 30000ms。
- **日志写入**：全部经 `./logger` 默认实例，模块标签传在第二个实参位置（见异常项）。
- **平台限定**：预览下载平台 key 硬编码 `windows-x86_64`（:363）。

## `src/utils/wikiTableParser.ts`
**职责**：解析 Wiki（文档树 `blockMap`/`rowIds`/`columnIds`/`cellMap`）数据的解析器（共 743 行）。按角色/技能名定位内容文档，把文本、内联富文本段、参数表、升级材料表转换为渲染用的 `WikiRenderedBlock[]`。

**导出**：类型/接口 `InlineSegment`、`WikiSkillParam`、`WikiTextBlock`、`WikiMaterialEntry`、`WikiRenderedBlock`；常量 `WIKI_COLOR_MAP`；函数 `extractCell`、`findContentIds`、`extractMaterialsFromDoc`、`getUpgradeMaterials`、`renderWikiBlocksFromIds`、`getWikiRenderedBlocks`。

**主要依赖**：`@/types/charDetail` 的 `WikiDocumentBlock`（无任何网络/IPC 调用，纯同步数据处理）。

### 导出符号表

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `InlineSegment` | wikiTableParser.ts:3 | 内联片段：`text/bold?/underline?/color?/isDefaultColor?` |
| `WikiSkillParam` | wikiTableParser.ts:11 | 表格参数行：`label/value/nextValue?/highlighted` |
| `WikiTextBlock` | wikiTableParser.ts:18 | 文本块：`kind: "heading3" \| "text"` + `segments` |
| `WikiMaterialEntry` | wikiTableParser.ts:23 | 材料项：`itemId/count/name?` |
| `WikiRenderedBlock` | wikiTableParser.ts:29 | 联合类型：`{kind:"text"}` / `{kind:"params"}` / `{kind:"materials"}` |
| `WIKI_COLOR_MAP` | wikiTableParser.ts:80 | 22 项语义色名（`light_text_*`/`light_function_*`/`light_rank_*`）→ 十六进制色值映射表 |
| `extractCell` | wikiTableParser.ts:126 | 输入 `cell`（含 `childIds`）与 `blockMap`；遍历各 block 的 `inlineElements`，拼接 `kind==="text"/"link"` 的文本与 `kind==="entry"` 的 `count`，检测 `color==="light_text_primary"` 得 `highlighted`，收集 `entry.id/count`；返回 `{text, highlighted, entries}` 或 `null`。纯内存运算 |
| `findContentIds` | wikiTableParser.ts:363 | 输入 `widgetCommonMap`、`documentMap`、`itemName`，返回 `{contentIds[], descriptionIds[]}`。阶段一：匹配 `tab.intro.name`（经 `normalizeName` 归一化，含全角→半角、希腊字母→拉丁、µ/μ→u），命中即返回；阶段二：扫描各 `tab.content` 文档标题（`heading3`）是否包含名称 |
| `extractMaterialsFromDoc` | wikiTableParser.ts:523 | 输入文档与 `colIdx`，定位含“升级材料”标题后的首张表，取 `rowIds[1]` 数据行与 `columnIds[colIdx]` 单元格，返回 `WikiMaterialEntry[]` |
| `getUpgradeMaterials` | wikiTableParser.ts:579 | 输入 `wikiItemDetail/itemName/skillLevel/itemType/_talentRank/toMax?/filterContentId?`，返回 `WikiMaterialEntry[]`。从 `wikiItemDetail.document`（或 `.data.item.document`/`.item.document`）取 `documentMap`+`widgetCommonMap` → `findContentIds` → 按 `LEVEL_TO_COLUMN_INDEX[skillLevel]` 取列；`toMax && itemType==="skill"` 时按 12 级上限逐级累加聚合（Map 按 `itemId` 求和） |
| `renderWikiBlocksFromIds` | wikiTableParser.ts:652 | 与 `getWikiRenderedBlocks` 相同的渲染逻辑，但直接接收已确定的 `contentIds/descriptionIds`（用于同名多形态技能），返回 `WikiRenderedBlock[]`；无网络调用 |
| `getWikiRenderedBlocks` | wikiTableParser.ts:692 | 主入口：`wikiItemDetail + itemName + skillLevel + itemType + talentRank?` → `findContentIds` → 先渲染描述文档（`colIdx=-1` 只取文本，仅 `itemType==="skill"`），再按等级列渲染内容文档 → `WikiRenderedBlock[]` |

### 输入/输出样例

- **输入（文档结构）**：`{ blockIds: string[], blockMap: { [id]: { kind: "text"|"heading3"|"table"|"horizontalLine", text?: { kind, inlineElements: [{kind:"text"|"link"|"entry", text:{text}, color, bold, underline, entry:{id,count}}] }, table?: { rowIds, columnIds, cellMap: { "rowId_colId": { childIds } }, rowMap } } } }`。
- **表格解析步骤**（`parseWikiTable` wikiTableParser.ts:240）：第 0 行作列头 → 从第 1 行起、第 0 列作行标签 → 逐列 `extractCell` 得 `{label,value,highlighted}`，并累积 `entries` → 输出 `{ grid[][], columnHeaders[], entryGrid? }`。
- **输出结构**：`WikiRenderedBlock[]`，例如 `[{kind:"text", data:{kind:"heading3", segments:[{text:"普通攻击", bold:true}]}}, {kind:"params", data:[{label:"倍率", value:"120%", highlighted:false}]}, {kind:"materials", data:[…]}]`。

### 内部结构（行号区间）

| 区间 | 内容 |
| --- | --- |
| 3–32 | 导出类型定义 |
| 34–78 | `GREEK_TO_LATIN` 表、微符号常量、`normalizeName` 归一化 |
| 80–118 | `WIKI_COLOR_MAP`、`LEVEL_TO_COLUMN_INDEX`（等级 1–12 → 列索引 1–12） |
| 120–238 | 单元格提取：`extractCell`/`extractCellText`/`extractCellSegments`/`extractInlineSegments`/`segmentsToPlainText` |
| 240–356 | `parseWikiTable`、`isMaterialTable`（硬编码首行 id `pDCwBZ`/`CjgdQD`）、`isHeadingBlock`、`docContainsName` |
| 363–409 | `findContentIds` 两阶段查找 |
| 414–517 | `renderDocumentBlocks`：块遍历、升级材料章节跳过、talentRank/等级列取值、材料表分流 |
| 523–644 | 材料提取（单文档 / 按等级聚合） |
| 652–743 | 两个渲染入口 |

**备注**：无 Tauri 命令、无 HTTP 端点、无缓存；全部为对传入 Wiki 数据对象的同步转换，硬编码常量包括材料表首行 id（:306）、中文关键词“技能升级材料”“升级材料”（:435、:541）、等级上限 12（:608）、描述列列头“描述”（:477）。

## `src/utils/imageCacheManager.ts`
**职责**：图片磁盘+内存缓存管理器（共 319 行）。以 blob URL 缓存本地/远程图片，支持引用计数、pin 保护、LRU 淘汰与延迟回收，并提供配套 React hooks。

**导出**：类型 `CacheMode`；单例 `cacheManager`（`ImageCacheManager` 实例，类本身未导出）；hooks `useImageRequest`、`usePinImages`。

**主要依赖**：`@tauri-apps/api/core`（`invoke`）、`react`（`useEffect`/`useRef`）。

### 导出符号表

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CacheMode` | imageCacheManager.ts:4 | 类型：`"smart" \| "manual"`（smart 不限条数/体积且保护引用项，manual 受限） |
| `cacheManager` | imageCacheManager.ts:288 | 单例。内部方法与 IPC：`getCacheDir` → `invoke("get_image_cache_dir")`（:36，Promise 缓存）；`load(path)`（:83）→ 本地路径 `invoke("read_image_file", {path})`（:102）转 Blob/`URL.createObjectURL`，`blob:`/`data:` 直接透传，`http(s)://` 转 `loadRemote`；`loadRemote`（:124）→ `invoke("download_image", {url, cacheDir, subDir:""})`（:137）+ `invoke("read_image_file")`（:142）。另有 `configure`/`getConfig`/`getStats`/`getEntries`/`request`/`release`/`pin`/`unpin`/`loadMultiple`/`evictInactive` 及私有 LRU `evictOne`/`evictFor`/`scheduleEviction`（20s 延迟回收） |
| `useImageRequest` | imageCacheManager.ts:290 | hook：按 `deps` 差量对新增路径 `cacheManager.request`、消失路径 `release`，卸载时释放全部 |
| `usePinImages` | imageCacheManager.ts:311 | hook：`paths.join(",")` 变化时 `pin`，清理时 `unpin` |

### 内部结构（行号区间）

| 区间 | 内容 |
| --- | --- |
| 1–32 | 导入、类型、常量（`SMART_MAX_ENTRIES=100`、`DEFAULT_MANUAL_MAX_SIZE_MB=100`）、类字段 |
| 34–81 | 缓存目录获取、配置读写、统计与生效上限（smart 模式为 `Infinity`） |
| 83–156 | `load` 与 `loadRemote`（含 in-flight 去重 `loading` Map） |
| 158–231 | 引用计数 `request/release`、`pin/unpin`、延迟淘汰定时器 |
| 233–265 | `evictOne`（smart 模式跳过受保护项）、`evictFor` |
| 267–319 | `loadMultiple`、`evictInactive`、单例与两个 hooks |

**备注**：invoke 命令仅三个：`get_image_cache_dir`、`read_image_file`（参数 `path`，返回 `number[]` 字节数组）、`download_image`（参数 `url`/`cacheDir`/`subDir`，返回本地路径）。磁盘缓存目录由后端命令决定，前端不感知具体路径。无 HTTP 直连（远程图一律经后端下载）；错误仅 `console.error`（:37），不写日志文件。

## `src/utils/imageLoader.tsx`
**职责**：懒加载图片组件 `Img`（共 86 行）。用 `IntersectionObserver`（rootMargin 400px 预取）延迟触发 `cacheManager.load`，未就绪时渲染占位 div，同时持有缓存引用防止 blob URL 被回收。

**导出**：组件 `Img`。

**主要依赖**：`./imageCacheManager`（`cacheManager`）、`react`（`useState`/`useEffect`/`useRef`）、`clsx`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `Img` | imageLoader.tsx:14 | props：`src` + `ImgHTMLAttributes` + `transparentPlaceholder?`。流程：`cacheManager.request([src])` → 建 `IntersectionObserver` 观察占位节点（IO 不可用则立即加载）→ 相交后 `cacheManager.load(src)` → `setResolvedSrc` → 渲染 `<img>`；卸载时 `disconnect` + `release([src])`。加载失败保持占位不报错 |

**备注**：无 Tauri 命令直调、无 HTTP 端点（全部委托给 `cacheManager`）；无缓存目录与日志写入。占位样式：默认 `bg-default-200 animate-pulse`，`transparentPlaceholder` 时 `bg-transparent`（:76–79）。

## `src/utils/skillDescParser.tsx`
**职责**：技能描述标记语言解析器（共 187 行）。把游戏内 `{param:format}` 占位符与 `<@ba.xxx>`/`<#ba.xxx>`/`<@tips.xxx>` 颜色标记转换为带内联样式的 HTML，并提供直接渲染的 React 组件。

**导出**：函数 `parseSkillDescription`；组件 `SkillDescription`。

**主要依赖**：无（无网络、无 IPC；仅正则字符串处理 + React）。

### 导出符号表

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `parseSkillDescription` | skillDescParser.tsx:128 | 参数 `(text: string, params?: Record<string,string>)`，返回 HTML 字符串。步骤：① `replaceParams` 替换占位符；② `\n` → `<br/>`；③ `<@ba.(\w+)>(.*?)</>` → `<span class="ba-tag ba-at-…" style="color…">`；④ `<#ba.…>` → `ba-hash-…`；⑤ `<@tips.…>` → `ba-tips-…`。未知名 tag 颜色回退 `#FFFFFF` |
| `SkillDescription` | skillDescParser.tsx:174 | React 组件，props `{description, params?, className?}`；内部调 `parseSkillDescription` 后用 `dangerouslySetInnerHTML` 输出到 `<div class="skill-description …">` |

### 输入/输出样例

- **输入**：`"对目标造成 {0.15:0%} 灼热伤害\n<@ba.fire>灼热</>，<#ba.consume>消耗 {talent_1+1:0} 层"`，`params = {"0.15":"0.15", "talent_1":"2"}`（实际以描述文本中的参数名为键）。
- **参数表达式**（`replaceParams` :69–120）：`{name:format}`、`{1-name:format}`（数字前缀回退查找）、`{100*name:format}`（乘法）、`{name+1:format}`（加法）；`format` 以 `%` 结尾则 ×100 取整加 `%`（`formatParamValue` :42），含 `.` 则按小数位数取精度，否则四舍五入为整数；参数缺失时原样保留。
- **输出**：`"对目标造成 15% 灼热伤害<br/><span class=\"ba-tag ba-at-fire\" style=\"color: #E74C3C; font-weight: bold;\">灼热</span>，…"`。

### 内部结构（行号区间）

| 区间 | 内容 |
| --- | --- |
| 7–34 | `TAG_COLORS`（`@ba.` 属性 7 项、`#ba.` 状态 13 项、`@tips.` 2 项） |
| 42–61 | `formatParamValue` 数值格式化 |
| 69–120 | `replaceParams` 占位符替换（含乘/加表达式与数字前缀回退） |
| 128–163 | `parseSkillDescription` 五步转换 |
| 168–187 | `SkillDescription` 组件 |

**备注**：无 Tauri 命令、无 HTTP 端点、无缓存、无日志。输出为 `dangerouslySetInnerHTML` 直插的 HTML（源自服务端描述文本，未做额外转义）。

## `src/utils/logger.ts`
**职责**：前端日志门面（共 173 行）。四级日志（DEBUG/INFO/WARN/ERROR）统一路由到控制台（带颜色 `%c` 样式）与 `localStorage` 持久化，内存环形缓冲区保留最近 5000 条，并可与后端日志合并输出。

**导出**：`enum LogLevel`、`interface LoggerConfig`、`interface LogEntry`、默认单例 `logger`、便捷函数 `logDebug`/`logInfo`/`logWarn`/`logError`（`class Logger` 本身未导出）。

**主要依赖**：无外部依赖；写入目标为浏览器 `console` 与 `localStorage`（key `app_logs`）。

### 导出符号表

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `LogLevel` | logger.ts:1 | 枚举 `DEBUG=0, INFO=1, WARN=2, ERROR=3` |
| `LoggerConfig` | logger.ts:15 | `{enableConsole, enableLocalStorage, minLevel, maxStorageSize}` |
| `LogEntry` | logger.ts:22 | `{timestamp, level, message, module, source:"frontend"\|"backend", data?}` |
| `logger`（default） | logger.ts:168 | `Logger` 单例，方法见下表 |
| `logDebug` / `logInfo` / `logWarn` / `logError` | logger.ts:170–173 | 分别代理 `logger.debug/info/warn/error` |

### 日志级别方法与写入目标

| 方法 | 位置 | 级别 | 写入目标 |
| --- | --- | --- | --- |
| `logger.debug(message, data?, module?)` | logger.ts:130 | DEBUG | ① 内存缓冲 `memoryBuffer`（上限 5000，超出裁剪头部）② `console.debug`（`%c` 青色 `#00BCD4` 样式前缀，受 `enableConsole`）③ `localStorage["app_logs"]`（上限 `maxStorageSize` 默认 1000 条，受 `enableLocalStorage` 且 `typeof window!=="undefined"`） |
| `logger.info(...)` | logger.ts:134 | INFO | 同上，`console.info`，绿色 `#4CAF50` |
| `logger.warn(...)` | logger.ts:138 | WARN | 同上，`console.warn`，橙色 `#FF9800` |
| `logger.error(...)` | logger.ts:142 | ERROR | 同上，`console.error`，红色 `#F44336` |
| `getLogs()` | logger.ts:146 | — | 返回 `memoryBuffer` 浅拷贝 |
| `getPersistedLogs()` | logger.ts:151 | — | 读取 `localStorage["app_logs"]` 中的持久化日志（上限 1000 条），供崩溃诊断导出跨重载使用 |
| `getAllLogs(backendLogs=[])` | logger.ts:155 | — | 后端日志 + 内存日志按 `timestamp.localeCompare` 合并排序（后端日志由调用方通过后端命令另行获取后传入，本文件不发命令） |
| `clearLogs()` | logger.ts:163 | — | 清空内存缓冲并 `localStorage.removeItem("app_logs")` |
| `updateConfig(config)` | logger.ts:168 | — | 合并更新运行时配置 |

### 内部结构（行号区间）

| 区间 | 内容 |
| --- | --- |
| 1–36 | 枚举、类型、默认配置（`minLevel: DEBUG`、`maxStorageSize: 1000`） |
| 38–128 | `Logger` 类：时间戳/颜色/`writeLog` 路由、localStorage 读写 |
| 130–164 | 级别方法与查询/清理/配置方法 |
| 166–173 | 单例与便捷函数 |

**备注**：**不写入文件，也不调用任何 Tauri 后端命令**；持久化仅 `localStorage`（key `app_logs`），控制台输出带时间戳 `[YYYY-MM-DD HH:mm:ss.mss] [LEVEL] [module]`。默认 `module` 为 `"frontend"`。跨模块调用约定为 `(message, data?, module?)`。

## `src/utils/overlayScrollbar.ts`
**职责**：悬浮覆盖式滚动条初始化器（共 37 行）。扫描文档中 `overflow-y: auto/scroll` 的元素并改为 `overflow-y: overlay`，加 `data-ovs` 标记防重复处理；用 `MutationObserver` 持续接管后续新增的可滚动节点。

**导出**：函数 `initOverlayScrollbar`。

**主要依赖**：浏览器 DOM API（`getComputedStyle`、`MutationObserver`、`requestAnimationFrame`），无 Tauri/网络依赖。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `initOverlayScrollbar` | overlayScrollbar.ts:24 | 幂等初始化（模块级 `inited` 标志 :22）：全量 `document.querySelectorAll("*")` 扫描并 `attach`；随后监听 `document.documentElement` 的 `childList+subtree` 变更，每次变更在 `requestAnimationFrame` 中重扫 |

### 内部结构（行号区间）

| 区间 | 内容 |
| --- | --- |
| 7–10 | `isScrollable`：仅处理 `overflow-y` 为 `auto`/`scroll` 的元素 |
| 12–20 | `attach`：写入 `style.overflowY = "overlay"` 并打 `data-ovs` 属性 |
| 22–37 | 初始化状态与 `MutationObserver` 守护 |

**备注**：无 Tauri 命令、无 HTTP 端点、无缓存、无日志写入；仅修改元素内联样式与 `data-ovs` 属性。

## `src/utils/startupProgress.ts`
**职责**：管理主窗口 Splash 的首屏启动进度；汇总初始化阶段以及显式跟踪的初始异步任务，并在任务静稳后完成进度动画、淡出静态 Splash。新增 45 秒超时看门狗与失败操作面板（导出诊断日志/打开日志目录/重新加载）。

**导出**：`armStartupTimeout`、`setStartupPhase`、`beginStartupTracking`、`trackStartupTask`、`failStartup`、`abortStartup`。

**主要依赖**：`@/i18n`、浏览器 DOM API（更新 `index.html` 中的 `#startup-splash*` 元素）；失败按钮点击时动态导入 `./diagnostics`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `STARTUP_TIMEOUT_MS` | startupProgress.ts:3 | 45 秒启动超时 |
| `armStartupTimeout` | startupProgress.ts:117 | 重置并启动 45 秒看门狗；超时后停止跟踪，按 `pendingTasks` 显示未完成请求数或通用卡死提示，并展示 Splash 操作按钮。`main.tsx` 在配置初始化前调用一次，覆盖 `invoke` 永不返回、React 未挂载的卡死场景 |
| `setStartupPhase` | startupProgress.ts:134 | 启动完成后忽略；单调更新当前进度（最高 94%）并设置本地化状态文案 |
| `beginStartupTracking` | startupProgress.ts:140 | React 挂载后开启任务计数，设定加载中/完成文案并重置超时看门狗 |
| `trackStartupTask` | startupProgress.ts:149 | 统计启动阶段 Promise；任务完成后不吞异常，并重置 650ms 静稳计时 |
| `finishWhenIdle`（私有） | startupProgress.ts:33 | 无待处理任务且持续静稳 650ms 后设为 100%、清理计时器、淡出并移除 Splash |
| `failStartup` | startupProgress.ts:166 | 关闭启动跟踪并在 Splash 错误面板显示初始化错误与详情 |
| `abortStartup` | startupProgress.ts:175 | 外部中止（API 熔断）时收起 Splash，让 React 崩溃弹窗可见 |

**备注**：启动进度由 `index.html` 提供纯静态 UI，因此 React 配置初始化之前也不会显示空白页；`showStartupFailure`（私有）把 `#startup-splash-error` 面板解除隐藏，按钮文案来自 `crash.*` i18n 键。超时/失败都不会一直卡住：超时面板可直接导出诊断日志或重新加载；API 熔断时由 `crashReporting` 调用 `abortStartup` 后弹出阻塞提示。

## `src/utils/crashReporting.ts`
**职责**：前端崩溃处理中枢（约 374 行）。安装 `error` / `unhandledrejection` 全局监听，接收后端 `app:crash` 与 API 熔断 `app:api-health` 事件，维护当前崩溃报告与订阅者；同时提供错因启发式判断、报告文本格式化与上次运行崩溃报告载入。

**导出**：类型 `CrashSource`、`ApiFailureKind`、`ApiHealthSnapshot`、`BackendCrashEvent`、`CrashReport`、`CrashDiagnosis`；函数 `subscribeCrashReports`、`getCurrentCrashReport`、`showCrashReport`、`dismissCrashReport`、`reportCrash`、`installCrashHandlers`、`loadPendingCrashReports`、`diagnoseCrash`、`formatCrashReport`。私有：`currentReport`、`reportCounter`、`listeners`、`lastSignature`、`handleApiBlocked`、`checkApiHealth`。

**主要依赖**：`@tauri-apps/api/core`（`invoke`）、`@tauri-apps/api/event`（`listen`）、`@/i18n`、`./logger`、`./diagnostics`、`./accountAvailability`（动态导入）。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `CrashReport`（interface） | :42-54 | `id`、`title`、`message`、`detail?`、`stack?`、`source`、`timestamp`、`fatal`、`api?`、`crashPaths?` |
| `reportCrash(input)` | :117 | 先 `logger.error("[Crash]...")`，相同来源+消息 2 秒内去重，然后写入当前报告并通知订阅者 |
| `installCrashHandlers()` | :166 | 幂等安装 `window.error` / `unhandledrejection`；`listen("app:api-health")`、`listen("app:crash")`；启动后 1.5s/6s 轮询 `get_api_health` 兜底 |
| `handleApiBlocked(snapshot)`（私有） | :135 | 动态调用 `startupProgress.abortStartup` 收起 Splash（**允许不获取账户数据也进入应用**），把账户标记为不可用（`accountAvailability.setAccountUnavailable`，原因由 `reasonFromApiKind` 映射），并生成**非致命** API 熔断报告（可关闭）；`kind === "device_fingerprint"` 时使用 `crash.api_fingerprint_body`（重启电脑 + 同步时区） |
| `loadPendingCrashReports()` | :230 | 启动时调用 `get_pending_crash_reports`，把最近一条报告包装成「上次运行异常退出」提示 |
| `diagnoseCrash(report)` | :250 | 依据 `api.kind`（`device_fingerprint` → `crash.cause_fingerprint` / `crash.suggestion_fingerprint`）、错误文本正则（sign/timestamp、网络、认证、权限、解析、5xx）返回 `causeKey` + `suggestionKeys`（i18n 键） |
| `formatCrashReport(report)` | :361 | 拼接时间、来源、消息、详细栈、API 状态与崩溃文件路径，供复制/导出 context 使用 |

**备注**：`CrashSource` 为 `window / unhandled-rejection / react / api / backend-panic / startup`；`ApiFailureKind` 含 `device_fingerprint`（数美设备指纹接口连续失败），`app:api-health` payload 与 `ApiHealthSnapshot` 对齐（后端 `snake_case`），`app:crash` payload 含 `report_path`。该模块本身不渲染 UI，由 `src/components/crash-report-host.tsx` 订阅展示。

## `src/utils/accountAvailability.ts`
**职责**：账户数据不可用的全局状态（约 145 行）。账户数据获取频繁失败时，应用仍可正常进入，但账户页/侧边栏据此展示「账号不可用」与「重新登录」；状态通过 `sessionStorage`（键 `account_unavailable_state`）跨页面与刷新保留，并提供订阅机制通知 UI 更新。

**导出**：类型 `AccountUnavailableReason`（`"auth" | "network" | "fingerprint" | "unknown"`）、`AccountAvailability`（`{ reason, message, since }`）；函数 `getAccountAvailability`、`loadAccountAvailability`、`setAccountUnavailable`、`clearAccountUnavailable`、`subscribeAccountAvailability`、`reasonFromApiKind`。

**主要依赖**：`./logger`（`logDebug` / `logError`）、浏览器 `sessionStorage`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `AccountUnavailableReason` / `AccountAvailability` | :11 / :13 | 原因字面量联合类型与状态结构（`message` 为最近一次失败详情，`since` 为首次标记时间） |
| `getAccountAvailability()` | :83 | 同步读取当前状态；首次调用会从 `sessionStorage` 恢复并做字段归一（非法 `reason` 归为 `unknown`） |
| `loadAccountAvailability()` | :89 | 确保已从 `sessionStorage` 恢复（返回 `Promise<void>`），供 `main.tsx` 在渲染前 `await` |
| `setAccountUnavailable(reason, message?)` | :102 | 标记不可用并持久化；`reason`+`message` 未变化时不重复通知；保留原始 `since` |
| `clearAccountUnavailable()` | :123 | 账户恢复可用（重新登录成功 / 刷新成功）时清空状态并持久化 |
| `subscribeAccountAvailability(listener)` | :133 | 注册状态变化回调，返回取消订阅函数 |
| `reasonFromApiKind(kind)` | :149 | 把后端 API 熔断 `kind` 映射为原因：`clock_skew`/`signature`/`device_fingerprint` → `fingerprint`（重启电脑+同步时区）、`auth` → `auth`、`network`/`server`/`parse` → `network`、其余 → `unknown` |

**备注**：写入方为 `src/utils/accountService.ts`（请求失败 / 成功时）与 `src/utils/crashReporting.ts`（`app:api-health` 事件、启动轮询）；读取方为 `src/pages/account.tsx`、`src/components/dashboard-sidebar.tsx`；`src/main.tsx` 在渲染前调用 `loadAccountAvailability`。i18n 键前缀 `settings.account.account_unavailable_*`。无 IPC 调用。

## `src/utils/diagnostics.ts`
**职责**：诊断导出与崩溃报告 IPC 封装（共 75 行）。收集内存与持久化日志（对 `data` 做循环引用/Error 安全序列化），调用 `export_diagnostics` 生成 zip，并提供文件定位、日志目录打开与崩溃报告确认。

**导出**：`BackendCrashReport`、`exportDiagnostics`、`revealDiagnostics`、`openLogDirectory`、`getPendingCrashReports`、`acknowledgeCrashReports`。私有：`sanitizeLogData`。

**主要依赖**：`@tauri-apps/api/core`（`invoke`）、`@tauri-apps/plugin-opener`（`revealItemInDir`）、`./logger`。

| 符号 | 位置 | 说明 |
| --- | --- | --- |
| `exportDiagnostics(context?)` | :17 | 合并 `logger.getPersistedLogs()` 与 `logger.getLogs()`（按时间戳/级别/模块/消息去重排序），`invoke("export_diagnostics", { frontendLogs, context })`；返回 zip 路径 |
| `sanitizeLogData(value)`（私有） | :37 | Error → `{name,message,stack}`；JSON 往返去除不可序列化/循环引用，失败回退 `String(value)` |
| `revealDiagnostics(path)` | :57 | `revealItemInDir(path)` 在文件管理器中定位 zip |
| `openLogDirectory()` | :62 | `invoke("get_log_dir")` 后 `revealItemInDir(dir)` |
| `getPendingCrashReports()` | :67 | `invoke("get_pending_crash_reports")` → `BackendCrashReport[]` |
| `acknowledgeCrashReports(paths)` | :71 | `invoke("ack_crash_reports", { paths })`；空数组直接返回 |

**备注**：导出 zip 由后端 `utils/diagnostics.rs` 组装，包含 `manifest.json`、`frontend-logs.json`、`backend-logs.txt`、`logs/app-*.log`、`logs/startup.log`、`crashes/crash-*.log`，不包含 `app_config.json`。调用方：`CrashReportHost`/`GlobalErrorFallback`/开发者页导出按钮/启动 Splash 失败面板（动态导入）。

## `src/utils/gachaIntervals.ts`
**职责**：统一计算角色/武器寻访中每个六星事件的间隔；各卡池独立计数，供统计卡片、六星间隔折线图、累计图与保底图共用。

**导出**：`GachaSixStarInterval`、`calculateGachaSixStarIntervals`。

| 符号 | 说明 |
| --- | --- |
| `GachaSixStarInterval` | 六星事件记录，包含原始记录、卡池 id/名称、池内六星序号、间隔抽数与是否来自赠送抽 |
| `calculateGachaSixStarIntervals` | 按 `gachaTs` 升序处理 draw 记录；普通抽计数；赠送抽若无六星则不计，若出六星则以此前普通抽及本次连续赠送组截至该六星的抽数构成一个事件间隔，并重置该池计数 |

**备注**：计数器以 `poolId` 独立维护。第一条可用记录作为卡池起点；若本地历史不完整，首个间隔不代表卡池完整历史。间隔值包含六星所在的那一抽。

## `src/utils/todoDefaults.ts`
**职责**：全局「To-Do 卡片」默认值的读写（配置键 `todo_defaults`）。
**导出**：`getTodoDefaults()`、`setTodoDefaults(patch)`。
**主要依赖**：`@/utils/configService`、`@/utils/logger`、`@/types/todo`（`DEFAULT_TODO_DEFAULTS`）。

**备注**：`getTodoDefaults` 读取失败回退内置默认；`setTodoDefaults` 为读-改-写合并保存。配置键：`todo_defaults`。

## `src/utils/todoTemplateService.ts`
**职责**：根据 To-Do 模板和全局默认值创建新列表。
**导出**：`createTodoListFromTemplate(templateId, translate)`。

## `src/utils/todoImportExport.ts`
**职责**：To-Do 列表的 Markdown / JSON 导入导出。
**导出**：`listToMarkdown(list)`、`parseMarkdownList(markdown)`、`listToJson(list)`、`parseJsonList(json)`、类型 `ParsedMarkdownList`。

| 符号 | 说明 |
| --- | --- |
| `listToMarkdown` | 输出 `# 标题`、描述与 `- [ ] 内容 !2 @YYYY-MM-DD #tag`；子事项缩进两格 `- [ ]`，备注以 `  > ` 前缀 |
| `parseMarkdownList` | 解析标题/描述/`- [x]` 事项，复用与 `cards/todo/quick-add.ts` 相同的 `!/@/#` 语法 |
| `listToJson` / `parseJsonList` | 完整字段 JSON 往返；`parseJsonList` 对缺省字段做规范化，解析失败返回 `null` |

**备注**：无 IPC、无事件；纯字符串处理，供 `pages/todo.tsx` 的导入导出按钮调用。

## `src/utils/platform.ts`
**职责**：同步判断当前 WebView/浏览器运行平台，供平台能力受限的 UI 做一致性门控。
**导出**：`isWindowsPlatform(): boolean`。
**主要依赖**：浏览器 `navigator.platform` 与 `navigator.userAgent`。

| 符号 | 说明 |
| --- | --- |
| `isWindowsPlatform` | 通过 `navigator.platform`（`Win*`）或 UA（`Windows`）判断 Windows；navigator 不存在时返回 `false` |

**备注**：当前用于限定 Windows 原生屏幕取色器和游戏启动器；不依赖 IPC、配置或第三方库。

# EndProtocol 内存优化报告

> 采样环境：Windows，debug 构建（`target/debug/endprotocol.exe`），前端为 `vite build` 生产产物（`--mode production` + `VITE_DEV_DECK=1`）。
> 采样时间：2026-11-06。
> 所有数字均为实测，脚本与原始 CSV 见文末「复现方式」。

---

## 0. 执行摘要

| 指标 | 优化前 | 优化后 | 变化 |
| --- | --- | --- | --- |
| **稳定态 Private Working Set（合计）** | **340.1 MB** | **278.9 MB** | **−61.2 MB（−18.0%）** |
| 稳定态 Working Set（合计） | 749.9 MB | 702.2 MB | −47.7 MB（−6.4%） |
| 空闲 PrivateWS（冷启动 25s） | 237.5 MB | 219.1 MB | −18.4 MB（−7.7%） |
| 操作序列后 PrivateWS | 381.2 MB | 352.6 MB | −28.6 MB（−7.5%） |
| renderer 进程 PrivateWS 合计（稳定态） | 171.8 MB | 117.8 MB | **−54.0 MB（−31.4%）** |
| 图片缓存 blob 条目（操作后） | 11 | 4 | −64% |

核心用户路径响应延迟**没有退化**（详见 §4）：常规导航各路径耗时与优化前持平或略优，唯一新增代价是「离开图片密集页超过 20 秒后重入」多花约 30 ms，远低于 200 ms 阈值。

本轮共落地 2 项优化（P0 图片缓存驱逐缺陷、P2 图片 IPC 载荷放大），评估后**主动放弃** 1 项（P1 托盘窗口延迟销毁），另记录 3 项剩余风险。

---

## 1. 度量方法

### 1.1 工具链

| 层 | 工具 | 说明 |
| --- | --- | --- |
| 分进程内存 | 自建 PowerShell 脚本（`measure.ps1`） | 按 **WebView2 user-data-dir** 精确归属进程树，避免把 Windows Shell / Copilot 的系统 WebView2 进程算进来 |
| JS 堆 | 自建 Node + CDP 脚本（`cdp.mjs` / `cycle.mjs` / `leakscan.mjs` / `drill.mjs`） | 经 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 连 WebView2 的 CDP |
| 堆快照 | `HeapProfiler.takeHeapSnapshot` | 采集前先 `HeapProfiler.collectGarbage`，确保对比的是**存活对象**而非未回收垃圾 |
| 实时曲线 | **tauri-plugin-devdeck 1.0.0**（仅 debug 构建注册） | 任务指定的度量插件；Rust 侧注册由 `#[cfg(debug_assertions)]` 门控，release 不注册、不建窗口 |

### 1.2 关于 devdeck

`tauri-plugin-devdeck` 在 crates.io / npm 上均为 1.0.0（2026-10-25 发布，下载量极低）。引入前已完整审计其源码（Rust 449 行 + 内嵌单文件页面）：

- 依赖仅 `serde_json` / `sysinfo` / `tauri` / `tokio`，无网络外发、无 shell、无注册表操作；
- 内嵌页面（940 KB）为 React + MUI + 内联 Inter 字体，**无任何外部 URL 引用**；
- 唯一的额外进程调用是 `reveal()`（用户主动点「Show in folder」时打开资源管理器），唯一的文件写入在 `app_path().app_log_dir()`（`devdeck.jsonl` / `devdeck-recordings/`）。

结论：可安全用于开发期度量。注册方式：

```rust
#[cfg(debug_assertions)]
let builder = builder.plugin(tauri_plugin_devdeck::init());
```

**未打开 deck 窗口时其运行时开销为零**（实测：注册前后空闲 PrivateWS 237.9 MB → 238.0 MB，同一量级）。

### 1.3 度量口径说明

Windows 上「RSS」有歧义，本报告同时给出两个口径：

- **Working Set**：含与其他进程共享的页面（DLL、字体、共享内存），多个 WebView2 渲染进程会把共享部分**重复计算**，故总和偏高；
- **Private Working Set**：本进程独享的物理内存，**更接近「这个应用真正多吃的内存」**，本报告以它作为主要判据。

### 1.4 场景定义（可复现）

| 代号 | 场景 | 定义 |
| --- | --- | --- |
| S1 | 空闲 | 冷启动后静置 25 s，无任何交互 |
| S2 | 典型操作序列 | 用 11 条路由各访问 3 轮（33 次导航，约 32 s） |
| S3 | 稳定态 | S2 结束后静置 45 s（跨过图片缓存的 20 s 延迟驱逐窗口） |

---

## 2. 步骤一：内存基线（优化前）

### 2.1 分进程基线

单位 MB。`Priv` = Private Working Set。

**S1 空闲（合计 Working Set 654.1 / PrivateWS 237.5）**

| 进程角色 | Working Set | Priv | 备注 |
| --- | --- | --- | --- |
| `endprotocol.exe`（Rust 主进程） | 77.3 | 32.1 | debug 构建（未优化，无 strip），含全部业务服务与 tokio 运行时 |
| `msedgewebview2` browser | 147.5 | 41.8 | WebView2 浏览器主进程，每应用一个 |
| renderer #1 | 154.0 | 71.2 | 主窗口 `index.html` 的渲染进程 |
| renderer #2 | 79.2 | 25.6 | `tray-panel.html` 的渲染进程（窗口 `visible(false)`，**常驻**） |
| gpu-process | 109.9 | 53.0 | 另计 GPU Dedicated 132.3 MB（Acrylic 磨砂 + 透明窗口的合成纹理） |
| utility:NetworkService | 43.0 | 7.7 | |
| utility:StorageService | 23.2 | 4.0 | |
| crashpad-handler | 20.0 | 2.1 | |

**S2 典型操作序列后（合计 820.8 / 381.2）**

| 进程角色 | Working Set | Priv |
| --- | --- | --- |
| `endprotocol.exe` | 84.3 | 36.6 |
| WebView2 browser | 158.0 | 46.7 |
| renderer（主窗口） | 207.1 | 110.0 |
| renderer（托盘面板） | 130.3 | 74.9 |
| gpu-process | 159.6 | 100.1 |
| Network / Storage | 43.4 / 23.9 | 7.4 / 3.7 |
| crashpad | 14.2 | 1.8 |

**S3 稳定态（合计 749.9 / 340.1）**

| 进程角色 | Working Set | Priv |
| --- | --- | --- |
| `endprotocol.exe` | 82.6 | 37.0 |
| WebView2 browser | 158.7 | 47.0 |
| renderer（主窗口） | 177.8 | 104.1 |
| renderer（托盘面板） | 120.6 | 67.7 |
| gpu-process | 129.4 | 71.1 |
| Network / Storage | 43.1 / 23.5 | 7.4 / 4.0 |
| crashpad | 14.2 | 1.8 |

> 两次 renderer 进程都随操作序列增长，说明**不能按「哪个 PID 是托盘面板」做简单归因** —— WebView2 每个 controller 独立起 renderer，但二者都会承载共享的图片解码/合成缓存。因此本报告按「renderer 合计」做归因，不做 PID 级归属猜测。

### 2.2 JS 堆基线（CDP）

| 场景 | usedJSHeapSize（GC 后） | DOM 元素 |
| --- | --- | --- |
| 空闲（主窗口 / 签到页） | 14.6 MB | 489 |
| 空闲（托盘面板） | 3.2 MB | 83 |
| 操作序列后（GC 后） | 15.1 MB | 1009 |

**未 GC 的瞬时值**在操作序列中会冲到 25–29 MB，GC 后回落到 15 MB。

### 2.3 关键判读：JS 堆不是问题，Blob 才是

| 实验 | 结果 | 结论 |
| --- | --- | --- |
| 单路由往返 4 次（每次回锚点 GC 后测量） | 全部路由 \|Δ\| ≤ 0.15 MB/轮 | **同一路由反复进入不泄漏** |
| 全路由循环 4 轮（每轮 GC 后测量） | 15.43 → 15.64 → 15.68 → 15.73 MB（Δ 0.21 / 0.04 / 0.05，收敛） | **JS 堆不构成持续泄漏** |
| 操作序列前后堆快照对比 | 节点数 148,322 → 285,035（**+136,713**），self size 9.56 → 20.22 MB | 大部分是**一次性懒加载**的页面模块（`code` / `InstructionStream` / `BytecodeArray`），属正常 |
| 操作序列前后 blob URL 计数 | 唯一 blob **6 → 14** | **图片缓存条目在只增不减** |

JS 堆（GC 后）只增长约 1 MB，而同一时间 **renderer 进程 PrivateWS 涨了 44–47 MB**。差额无法用 JS 堆解释 —— 指向 **Blob 存储**（`URL.createObjectURL` 的图片二进制）与合成缓存。这直接引出 P0。

---

## 3. 步骤二：分层归因与优化项

### 3.1 归因总表

| 层级 | 是否发现增长 | 证据 |
| --- | --- | --- |
| Rust 堆 | **否** | `endprotocol.exe` PrivateWS 在 S1/S2/S3 为 32.1 / 36.6 / 37.0 MB，波动 ≤ 5 MB，无单调趋势 |
| WebView renderer | **是** | renderer 合计 PrivateWS 96.8 → 184.9 → 171.8 MB；JS 堆仅 +1 MB，差额在 Blob / 合成层 |
| JS 堆 | 否（一次性加载除外） | §2.3 循环测试收敛 |
| 系统资源（GPU 纹理 / 句柄） | 瞬时峰值，稳定后回落 | GPU Dedicated 在导航过程中冲到 **412 MB**，稳定后回落至 86.6 MB；句柄数恒定在 4.3k 左右，无泄漏 |

### 3.2 优化项清单

#### OP-1（P0）图片缓存驱逐路径缺失 —— 已修复

| 项 | 内容 |
| --- | --- |
| **问题描述** | `imageCacheManager` 在默认 `smart` 模式下**没有任何驱逐路径**。 |
| **归因层级** | WebView renderer 进程（Blob 存储）；不计入 JS 堆 |
| **根因** | ① `getEffectiveMaxSizeBytes()` 在 smart 模式返回 `Infinity`，`evictFor()` 的体积条件永不成立；② `unpin()` 只从 `pinned` 集合里删 key，**不触发驱逐调度**。而 `useImageRequest` + `usePinImages` 同时用于同一批图片时，React 的清理顺序是「先 release、后 unpin」：`release()` 执行时图片仍 pinned，于是不调度驱逐；到 `unpin()` 时已既无引用也无 pin，却仍无人调度 —— 图片连同整个 blob 二进制永久驻留。③ `DashboardLayout` 被每个路由各自包裹（`App.tsx` 每条路由都写 `<DashboardLayout><XPage/></DashboardLayout>`），**每次导航都卸载并重建整个布局**，于是侧栏图片每轮导航都经历一次上述泄漏路径。 |
| **修改方案** | `src/utils/imageCacheManager.ts`：<br>① `unpin()` 在移除 pin 后，若该条目已无引用，补一次 `scheduleEviction()`；<br>② 新增 `SMART_MAX_SIZE_MB = 256` 作为 smart 模式的**兜底字节上限**（条目数仍不设硬限，避免正常浏览被踢缓存）；<br>③ `evictOne()` 改为返回 `boolean`，`evictFor()` 在「无可驱逐项」时立即 `break` —— 这是**必须同步做的安全修复**：一旦有了上限，若所有条目都被 pin/引用保护，原来的 `while` 会永远驱逐不动而**空转成死循环卡死界面**。 |
| **影响面** | 仅图片缓存内部策略。被 pin 的图片、正在视图中的图片行为不变；上限 256 MB 远高于正常浏览所需（实测磁盘缓存共 371 个文件 / 24.5 MB）。 |
| **风险等级** | **低**。唯一可感知变化：离开图片密集页 20 s 后重入，图片需重新读盘+解码，实测 +29.9 ms（见 §4）。 |
| **回滚方案** | `git checkout -- src/utils/imageCacheManager.ts`（该文件本轮只做了此项改动）。 |
| **验证数据** | blob 唯一条目 S2 后 **11 → 4**；稳定态 renderer 合计 PrivateWS **171.8 → 129.4 MB**（单此项）。 |

#### OP-2（P2）图片经 IPC 传输放大 12 倍 —— 已修复

| 项 | 内容 |
| --- | --- |
| **问题描述** | `read_image_file` 返回 `Vec<u8>`，Tauri 会把它序列化成 **JSON 数字数组**再过 IPC。 |
| **归因层级** | Rust 堆 + WebView renderer（瞬时峰值与 GC 压力，非稳态驻留） |
| **实测放大** | 缓存中最大的图片 583 KB：<br>→ IPC 上的 JSON 文本约 **2.3 MB**（每字节约 4 字符）<br>→ 前端 `JSON.parse` 后建的 `number[]` 约 **4.6 MB**（V8 中 8 字节/元素）<br>→ **合计约 12 倍于文件本身**。干员列表 / 徽章页一次加载数十张图，瞬时峰值可达百 MB 量级。 |
| **修改方案** | Rust：`pub fn read_image_file(path: String) -> Result<tauri::ipc::Response, String>`，用 `tauri::ipc::Response::new(bytes)` 走原始字节通道（前端直接拿到 `ArrayBuffer`）。<br>前端 5 处调用点同步把 `invoke<number[]>` 改为 `invoke<ArrayBuffer>`，其中 `imageCacheManager` 内的两处还必须把 `bytes.length` 改成 `bytes.byteLength`（`ArrayBuffer` 没有 `length`，漏改会让 `byteSize` 变成 `undefined`，进而 `totalSizeBytes` 变 `NaN`、**体积驱逐彻底失效**）。 |
| **影响面** | 5 个调用点（`imageCacheManager.ts` ×2、`appearance-settings.tsx`、`game-launch-settings.tsx`、`backgroundSettings.ts`）。返回值语义由 `number[]` 变 `ArrayBuffer`，消费方式（`new Uint8Array(bytes)`）不变。 |
| **风险等级** | **中低**。类型契约变更，但调用点少且集中；已回归验证。 |
| **回滚方案** | `git checkout -- src-tauri/src/commands/image.rs src/utils/imageCacheManager.ts src/utils/backgroundSettings.ts src/components/appearance-settings.tsx src/components/game-launch-settings.tsx` |
| **验证数据** | 签到页 19 张图 / 18 张 blob / **0 张损坏**；空闲 PrivateWS 237.5 → 219.1 MB（−18.4 MB）。 |

#### OP-3（P1）托盘面板窗口「隐藏保留」→ 延迟销毁 —— 评估后**不实施**

| 项 | 内容 |
| --- | --- |
| **现状** | `tray-panel` 窗口在 `create_full_windows()` 中以 `visible(false)` 预创建，常驻一个 renderer 进程；显示/隐藏只走 `show()` / `hide()`。 |
| **归因层级** | WebView renderer 进程 |
| **可回收量** | 该 renderer 稳定态约 **120.6 MB Working Set / 67.7 MB PrivateWS** |
| **验证过程** | ① 反复开关托盘面板 10 次（每次 show→700 ms→hide→700 ms）：PrivateWS 341.8 → 343.1 MB（**+1.3 MB，无阶梯式上升**）；② 当前 `show` 调用往返延迟 **平均 17.3 ms**（min 13.0 / max 20.3）。 |
| **不实施理由** | 销毁窗口后重新创建需要走 WebView2 初始化 + 页面加载，实测同类延迟量级为数百毫秒，**远超任务规定的「重开延迟增量 ≤ 200 ms」阈值**。托盘面板是高频交互入口（右键托盘图标即弹），把 <20 ms 的即时响应换成数百毫秒迟滞，属于可感知的体验退化，违背「不为降内存砍体验」的底线。且 10 次开关无泄漏，说明该窗口的常驻是**固定开销而非漏损**。 |
| **保留的替代方案** | 若后续确需回收，建议走「隐藏后启动 30–60 s idle timer，超时无交互再 `destroy()`」并配 generation token 防止旧 timer 销毁新建窗口 —— 但需先接受托盘面板重启延迟，建议做成用户可选项而非默认行为。 |

#### OP-4（P2）`build.removeUnusedCommands` —— 核查结论：未启用，且**不属于运行时内存优化**

| 项 | 内容 |
| --- | --- |
| **核查** | Tauri 2.x 确有该配置项，路径为 `build.removeUnusedCommands`（tauri-cli 2.4.0 引入，PR [#12890](https://github.com/tauri-apps/tauri/pull/12890)）。本项目 `tauri.conf.json` 未配置，即未启用。 |
| **为何不计入本任务** | 该选项移除 ACL 未授权/未使用的命令，主要收益是**二进制体积**与命令表冗余。如任务约束所述，Cargo profile 与二进制裁剪对运行时 RSS 影响有限，不应混入运行时内存收益。 |
| **建议** | 可低风险启用（属构建期裁剪），但应在「体积优化」议题下评估，本报告不计入内存数据。 |

#### OP-5（P2）`download_file` 已符合流式要求 —— 无需改动

`commands/updater.rs` 的下载实现已是 `while let Some(chunk) = stream.next().await { file.write_all(&chunk) }`，**内存恒定在单 chunk 大小**，符合任务给出的参考案例，无需改动。

`commands/image.rs` 的 `download_image` 是 `response.bytes().await` 整读后 `fs::write`。但图片体积有界（实测最大 583 KB）、且写盘后立即释放，收益有限，列为剩余风险（§5）。

#### OP-6（P3）多窗口 WebView 环境 —— 核查结论：已是单环境

| 项 | 内容 |
| --- | --- |
| **核查** | 全部窗口（`main` / `tray-panel` / `inapp-browser-*`）共用同一个 WebView2 环境，user-data-dir 均为 `%LOCALAPPDATA%\cn.msk-network.endprotocol\EBWebView`。**不存在「每个窗口一套 browser 进程树」的问题**。 |
| **子 Webview 销毁** | `in-app-browser.tsx` 的 `destroyWebview()` 会显式 `webview.close()`（原生层不会随 React 卸载消失），并有 `hide()` 兜底与 `settled` 竞态处理；`lib.rs` 的 `on_page_load` 只对 `inapp-browser-` 前缀转发事件。核查未发现残留子 webview。 |
| **结论** | 无优化空间（已是平台推荐形态）。 |

---

## 4. 前后对比

### 4.1 同流程同时点数据

| 场景 | 优化前 WS / Priv | 优化后 WS / Priv |
| --- | --- | --- |
| S1 空闲 | 654.1 / **237.5** | 636.4 / **219.1** |
| S2 操作序列后 | 820.8 / **381.2** | 787.1 / **352.6** |
| S3 稳定态 | 749.9 / **340.1** | 702.2 / **278.9** |

> S3 是本报告的核心指标：它排除了「刚操作完、合成层与 GC 尚未落定」的干扰，代表应用回到静置后的真实占用。

### 4.2 分层对比（稳定态）

| 层 | 优化前 Priv | 优化后 Priv | 变化 |
| --- | --- | --- | --- |
| Rust 主进程 | 37.0 | 35.8 | −1.2 |
| WebView2 browser | 47.0 | 41.7 | −5.3 |
| **renderer 合计** | **171.8** | **117.8** | **−54.0（−31.4%）** |
| gpu-process | 71.1 | 70.6 | −0.5 |
| Network + Storage | 11.4 | 11.2 | −0.2 |
| crashpad | 1.8 | 1.8 | 0 |
| **合计** | **340.1** | **278.9** | **−61.2（−18.0%）** |

收益集中在 renderer —— 与归因一致（Blob 缓存 + IPC 放大都作用在渲染进程）。

### 4.3 过程曲线

未 GC 的 JS 堆在操作序列中的逐轮值（drill，11 路由 × 3 轮）：

| 版本 | 第 1 轮末 | 第 2 轮末 | 第 3 轮末 | 形态 |
| --- | --- | --- | --- | --- |
| 优化前 | 13.97 MB | 25.79 MB | 25.89 MB | 抬升后**高位堆积** |
| 优化后 | 21.52 MB | 22.43 MB | 23.59 MB | **平稳**，无堆积 |

优化后第 1 轮偏高（图片首次加载），此后保持在低水位且不再累积。

---

## 5. 回归验证（体验未退化）

### 5.1 核心用户路径响应延迟

测量口径：从点击侧栏链接到页面 DOM 元素数连续 3 帧稳定（`requestAnimationFrame` 轮询），每条路径 3 次取平均。

| 核心路径 | 优化前 avg | 优化后 avg | 变化 |
| --- | --- | --- | --- |
| → 干员（图片最多） | 35.2 ms | 31.5 ms | −3.7 ms |
| → 抽卡记录（ECharts） | 34.0 ms | 32.7 ms | −1.3 ms |
| → 设置 | 97.6 ms | 68.9 ms | −28.7 ms |
| → 仪表板 | 37.1 ms | 34.5 ms | −2.6 ms |
| → 蚀刻章 | 31.7 ms | 31.6 ms | −0.1 ms |

**无路径变慢**；设置页优化后反而更快（缓存体积更小、GC 压力更低）。

### 5.2 优化的代价：冷缓存重入

唯一新增延迟来自 OP-1 的驱逐策略。测量方式：进入干员页 → 切走后**静置 30 秒**（跨过 20 s 驱逐窗口）→ 再进入。

| 版本 | 冷缓存重入耗时 |
| --- | --- |
| 优化前 | 51.8 ms |
| 优化后 | 81.7 ms |
| **增量** | **+29.9 ms** |

远低于任务设定的 200 ms 阈值，且只在「离开该页超过 20 秒」时发生；20 秒内的往返完全走内存缓存，无额外开销。

### 5.3 功能完整性

| 检查项 | 结果 |
| --- | --- |
| 签到页图片渲染 | 19 张 `<img>`，其中 18 张 blob，**损坏 0 张** |
| 干员页图片渲染 | 1 张 `<img>`，blob 1，损坏 0 张 |
| 界面视觉 | 截图核对：头像、奖励图标、背景立绘、磨砂效果全部正常 |
| 托盘面板开关 10 次 | PrivateWS 341.8 → 343.1 MB（+1.3 MB，无阶梯式上升） |

---

## 6. 剩余风险（未处理的可疑项）

| # | 项 | 归因层 | 为什么不动 |
| --- | --- | --- | --- |
| R1 | `download_image` 整读响应体后一次写盘（`response.bytes().await` → `fs::write`） | Rust 堆（瞬时） | 图片体积有界（实测磁盘缓存 371 个文件共 24.5 MB，单文件最大 583 KB），且写盘后立即释放，不构成稳态占用。改成流式写盘需引入 `bytes_stream` 与临时文件原子替换，复杂度换来的收益不足。 |
| R2 | GPU Dedicated 在页面切换中瞬时冲到 **412 MB** | 系统资源（GPU 纹理） | 稳定后自行回落至 86–88 MB，属 WebView2 合成层的正常行为。压低它需要关闭窗口 `Acrylic` 磨砂 / 透明效果 —— 那是用户正在使用的视觉功能，任务明令禁止为降内存砍功能。 |
| R3 | `DashboardLayout` 被每条路由重复包裹，每次导航整层重建 | JS 堆 / CPU | 这是可改的（改为嵌套路由 + `<Outlet/>` 让布局只挂载一次），但改动面覆盖 `App.tsx` 全部 11 条路由定义，属结构性重构；且实测它**不是内存泄漏源**（重建本身会被正确回收，真正的漏损路径已由 OP-1 堵住）。收益主要在 CPU 与瞬时峰值，建议单独立项评估。 |
| R4 | `utils/capture.rs` 的抓包会话把请求/响应体全量留在内存（`entries: Vec<CaptureEntry>`，含 `body: Option<Vec<u8>>`） | Rust 堆 | 该功能**默认关闭**（`capture_autostart` 默认 false），需用户在开发者页显式开启，属用户主动选择的诊断工具。开启长时间抓包确实会持续吃内存，建议在 UI 上加占用提示，但不属于默认路径的内存开销。 |

---

## 7. 改动清单

| 文件 | 改动 | 类别 |
| --- | --- | --- |
| `src/utils/imageCacheManager.ts` | OP-1 驱逐修复 + OP-2 返回值适配 | 优化 |
| `src-tauri/src/commands/image.rs` | OP-2 原始字节 IPC | 优化 |
| `src/utils/backgroundSettings.ts` | OP-2 返回值适配 | 优化 |
| `src/components/appearance-settings.tsx` | OP-2 返回值适配 | 优化 |
| `src/components/game-launch-settings.tsx` | OP-2 返回值适配 | 优化 |
| `src-tauri/Cargo.toml` | 引入 `tauri-plugin-devdeck` | 度量设施 |
| `src-tauri/src/lib.rs` | `#[cfg(debug_assertions)]` 注册 devdeck | 度量设施 |
| `src-tauri/capabilities/default.json` | 加 `devdeck:default` 与 `devdeck` 窗口 | 度量设施 |
| `src/main.tsx` | `VITE_DEV_DECK=1` / DEV 下启动 devdeck | 度量设施 |
| `docs/reference/frontend/utils_services_b.md` | 同步 `imageCacheManager` 符号与行号 | 文档 |
| `docs/reference/backend/commands.md` | 同步 `read_image_file` 签名与说明 | 文档 |

度量设施（devdeck）可按需保留或整体回滚，不影响 OP-1 / OP-2 的收益。

---

## 8. 复现方式

度量脚本位于 `%TEMP%\ep-perf\`：

| 脚本 | 用途 |
| --- | --- |
| `measure.ps1` | 按 user-data-dir 归属，采集进程树的分进程 Working Set / PrivateWS / Commit / GPU Dedicated / Handles |
| `cdp.mjs` | CDP 客户端：`list` / `memory` / `gc` / `nav` / `snapshot` / `analyze` / `eval` / `evalf` |
| `cycle.mjs` | 全路由循环 + 每轮 GC 后测量（区分一次性加载与持续泄漏） |
| `drill.mjs` | 操作序列驱动器（点击真实导航链接，记录每步 JS 堆 / DOM 元素数） |
| `leakscan.mjs` | 分路由往返泄漏定位 |
| `bench.ps1` | 标准化基准流程：重启 → 空闲 → 导航 N 轮 → 导航后 |

运行前置：以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 启动 `target\debug\endprotocol.exe`。

原始 CSV / 堆快照：`%TEMP%\ep-perf\*.csv`、`bench-*.heapsnapshot`。

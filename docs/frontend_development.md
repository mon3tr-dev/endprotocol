# 前端开发规范与拓展指南

> 定位现有实现请查 [README.md](README.md) 快速定位表，或 [reference/frontend/](reference/frontend/)（18 篇逐文件参考，含行号与 props 清单）。

## 1. 目录结构与文件定位

| 目录 | 内容 | 对应 reference 文档 |
| --- | --- | --- |
| `src/pages/` | 10 个页面（dashboard、account、char-select、characters、gacha-records、attendance、medals、todo、settings、developer） | [pages_*.md](reference/frontend/pages_core.md) |
| `src/layouts/` | dashboard / default 布局 | [pages_core.md](reference/frontend/pages_core.md) |
| `src/components/` | 弹窗、面板、侧栏、图表等大组件（约 28 个 tsx） | [components_dialogs.md](reference/frontend/components_dialogs.md)、[components_settings_panels.md](reference/frontend/components_settings_panels.md)、[components_sidebar_charts.md](reference/frontend/components_sidebar_charts.md)、[components_game_action_panel.md](reference/frontend/components_game_action_panel.md) |
| `src/components/ui/` | 36 个通用 UI 组件 + `glass/` | [ui_components.md](reference/frontend/ui_components.md) |
| `src/components/cards/` | 卡片系统：`registry/`、`base/`、`card-container.tsx`、`_template/` 与 11 张卡片（含 system-resource、todo） | [cards_core.md](reference/frontend/cards_core.md) 及各 `cards_*.md` |
| `src/utils/` | 18 个 IPC 封装与工具（account/config/cardConfig/dashboard/role/launcher/update/image/logger…） | [utils_services_a.md](reference/frontend/utils_services_a.md)、[utils_services_b.md](reference/frontend/utils_services_b.md) |
| `src/types/` | TypeScript 类型 | [types_locales_styles.md](reference/frontend/types_locales_styles.md) |
| `src/locales/{zh,en}/` | 国际化资源 | 同上 |
| `src/styles/globals.css` | 全局样式、主题变量、玻璃拟态类 | 同上 |
| `src/stores/`、`src/hooks/`、`src/lib/`、`src/config/` | 轻量状态、hooks、工具函数 | [entry_and_app.md](reference/frontend/entry_and_app.md) |

## 2. 开发规范

- **状态管理**: 优先使用 React Hooks (`useState`, `useEffect`)；跨窗口/轻量全局状态用 `src/stores/`（`inAppBrowser.ts`、`launcherMode.ts`）。
- **样式编写**: 使用 Tailwind CSS 原子类 + `src/components/ui/glass` 的玻璃组件；深色模式通过 `globals.css` 的 `.dark` 类切换。
- **国际化**: 用户可见文本必须通过 `useTranslation` 从 `locales/` 获取；卡片文案放各自的 `locales/{zh,en}.json`（合并进 `card` 命名空间）。
- **日志记录**: 使用 `src/utils/logger.ts` 的 `logger` / `logInfo` / `logError` / `logDebug`，**禁止 `console.log`**。
- **IPC 调用**: 页面/组件不直接散写 `invoke`，统一走 `src/utils/*Service.ts` 封装；需要新增命令时先在封装层加函数（含类型与错误兜底）。
- **错误处理**: 封装层统一 `try/catch` + `logError`，并明确失败时的返回值约定（空数组/`false`/`null`）。

## 3. 拓展位置与方法

### 3.1 新增仪表板卡片

卡片系统是**约定式自动发现**的，无需改核心代码（详见 [card_development.md](card_development.md)）：

1. 新建 `src/components/cards/<card-name>/`
2. 添加 `<card-name>.meta.json`（`id`、`name{zh,en}`、`description{zh,en}`、`icon`、`defaultSize`、`version`、可选 `allowMultiple`）
3. 添加 `index.tsx` 默认导出组件，props 用 `BaseCardProps`（`roleId/cardId/settings/isEditMode`）
4. 添加 `locales/{zh,en}.json`，组件内用 `t("card:key")`
5. 若有配置项，在 `src/types/card-settings.ts` 增加 settings 类型
6. 重启开发服务器，卡片自动进入「添加卡片」对话框（`getAvailableCards()`）

渲染由 `src/pages/dashboard.tsx:422` 的 `CardContainer` 统一负责（拖拽、编辑模式、右键菜单），
布局持久化走 `src/utils/dashboardConfig.ts`（配置键 `dashboard_tabs`），配置读写走 `src/utils/cardConfigService.ts`。

### 3.2 新增页面路由

1. 在 `src/pages/` 创建页面组件
2. 在 `src/App.tsx` 用 `React.lazy(() => import("@/pages/..."))` 声明页面组件，再用 `react-router-dom` 的 `<Route>` 注册（页面加载态由 `layouts/dashboard.tsx` 的 `<main>` 内 `Suspense` 兜底，勿在路由内重复包裹）
3. 如路由需可恢复，把路径加入 `App.tsx` 的 `ROUTES` 白名单
4. 导航入口：`src/components/dashboard-sidebar.tsx` 或 `navbar.tsx`（入口与侧栏结构见 [components_sidebar_charts.md](reference/frontend/components_sidebar_charts.md)）

> 打包：页面按路由懒加载；第三方库由 `vite.config.ts` 的 `build.rollupOptions.output.manualChunks` 拆成 `vendor-react`/`vendor-echarts`/`vendor-zrender`/`vendor-i18n`/`vendor-ui`/`vendor-dnd`/`vendor-tauri` 等 chunk，避免单个 chunk 超过 Vite 的 500 kB 告警阈值。引入 `echarts` 时务必用 `echarts/core` + 按需 `echarts.use(...)`，不要全量 `import * as echarts from "echarts"`。

### 3.3 新增后端命令调用

1. 在 `src/utils/` 对应服务文件（或新建 `xxxService.ts`）中封装 `invoke`
2. 定义请求参数与返回值的 TypeScript 类型（放 `src/types/` 或服务文件内）
3. `try/catch` 捕获异常并用 `logger` 记录，明确失败返回值
4. 同步在 [reference/ipc_index.md](reference/ipc_index.md) 与 `reference/frontend/utils_services_*.md` 补一行

### 3.4 新增通用 UI 组件

- 放 `src/components/ui/`，遵循现有组件的 props 风格（受控 `isOpen`/`onOpenChange`、`className` 合并用 `cn`）
- 复用 `glass/` 的视觉变量，支持深色模式
- 组件清单与 props 见 [ui_components.md](reference/frontend/ui_components.md)

## 4. 拓展流程示例：添加一个新的数据展示卡片

1. **需求分析**: 确定卡片展示的数据字段及来源（是否已有后端命令 → 查 [ipc_index.md](reference/ipc_index.md)）
2. **后端准备**: 若无命令，按 [backend_development.md](backend_development.md) 新增 command + service 方法
3. **前端实现**:
   - 复制 `src/components/cards/_template/` 并重命名，写 `meta.json` + `index.tsx` + `locales`
   - 数据获取用 `useCardData`（`src/components/cards/base/use-card-data.ts`）
   - 需要用户配置时走 `CardConfigService` 并在 `types/card-settings.ts` 补类型
   - 「添加卡片」对话框（`src/components/add-card-modal.tsx`）会自动收录，无需改代码
4. **测试验证**: 运行项目，测试卡片添加、数据显示、拖拽排序、配置保存与卡片删除后的配置清理

## 5. 改代码后的文档同步

改动涉及新增/重命名文件、导出符号或 IPC 命令时，同步更新对应的 `reference/*.md`（格式见 [README.md](README.md#5-文档维护约定)）。

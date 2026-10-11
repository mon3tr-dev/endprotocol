# Card 系统开发指南

> 定位现有实现请查：[reference/frontend/cards_core.md](reference/frontend/cards_core.md)（registry/loader、CardContainer、base 工具的行号级说明），
> 以及 [cards_character_list.md](reference/frontend/cards_character_list.md)、[cards_account_achievement.md](reference/frontend/cards_account_achievement.md)、[cards_attendance_domain_spaceship.md](reference/frontend/cards_attendance_domain_spaceship.md)（9 张原有卡片）、[cards_system_todo.md](reference/frontend/cards_system_todo.md)（系统资源 / To-Do 两类新卡片）的逐文件说明。

## 概述

Card 系统采用插件化架构，支持通过简单的文件约定自动发现和注册新卡片类型。开发者只需创建 2-3 个文件即可添加新的卡片类型，无需修改核心代码。

## 快速开始：3步创建新卡片

### 步骤1：创建卡片目录

在 `src/components/cards/` 下创建新目录，例如：

```
src/components/cards/my-new-card/
```

### 步骤2：创建元数据文件

创建 `[card-name].meta.json` 文件：

```json
{
  "id": "my_new_card",
  "name": {
    "zh": "我的新卡片",
    "en": "My New Card"
  },
  "description": {
    "zh": "这是一个示例卡片",
    "en": "This is a sample card"
  },
  "icon": "Target",
  "defaultSize": { "w": 3, "h": 2 },
  "version": "1.0.0",
  "allowMultiple": true
}
```

**字段说明：**

- `id`: 卡片唯一标识（小写字母和下划线）
- `name`: 多语言名称对象，至少包含 `zh` 和 `en`
- `description`: 多语言描述对象
- `icon`: 图标名称或图标类名；界面中使用图标组件，禁止使用 Emoji
- `defaultSize`: 默认网格尺寸 `{ w: 宽度, h: 高度 }`
- `version`: 卡片版本号（语义化版本）
- `allowMultiple`: 是否允许多个实例（可选，默认 `false`）
  - `true`: 用户可以添加多个此类型的卡片
  - `false`: 用户只能添加一个此类型的卡片

### 步骤3：创建卡片组件

创建 `index.tsx` 文件，导出默认组件：

```typescript
import { BaseCardProps } from "../registry/types";
import { CardWrapper } from "../base/card-wrapper";
import { useCardData } from "../base/use-card-data";

export default function MyNewCard({
  roleId,
  cardId,
  settings,
  isEditMode
}: BaseCardProps) {
  // 使用通用 Hook 加载数据（可选）
  const { data, isLoading, error } = useCardData({
    fetchData: async () => {
      // 你的数据获取逻辑
      return await someApiCall(roleId);
    }
  });

  // 加载状态
  if (isLoading) {
    return <div>加载中...</div>;
  }

  // 错误状态
  if (error) {
    return <div>加载失败</div>;
  }

  // 正常渲染
  return (
    <div className="p-4">
      <h3>我的卡片内容</h3>
      {/* 你的卡片 UI */}
    </div>
  );
}
```

**完成！** 新卡片会自动出现在"添加卡片"对话框中。

## 目录结构规范

```
src/components/cards/
├── registry/              # 注册表系统（不要修改）
│   ├── types.ts          # 类型定义
│   ├── loader.ts         # 自动发现加载器
│   └── index.ts          # 导出
├── base/                  # 基础工具（不要修改）
│   ├── card-wrapper.tsx  # 卡片包装器
│   ├── use-card-data.ts  # 数据加载 Hook
│   └── index.ts          # 导出
├── character-list/        # 示例：干员列表卡片
│   ├── character-list.meta.json
│   └── index.tsx
├── my-new-card/           # 你的新卡片
│   ├── my-new-card.meta.json
│   └── index.tsx
└── _template/             # 模板目录（参考用）
    ├── _template.meta.json
    └── index.tsx
```

## 组件接口说明

### BaseCardProps

所有卡片组件必须接收以下 props：

```typescript
interface BaseCardProps {
  roleId: string; // 当前角色ID
  cardId: string; // 卡片实例ID（UUID）
  settings: any; // 卡片配置对象
  isEditMode?: boolean; // 是否在编辑模式
}
```

### 返回值

组件必须返回一个 React 元素，建议使用 `<Card>` 组件包裹内容以保持视觉一致性。

## 高级功能

### 使用通用数据加载 Hook

`useCardData` 提供了统一的数据加载、错误处理和缓存机制：

```typescript
const { data, isLoading, error, refetch } = useCardData<MyDataType>({
  fetchData: async () => {
    const response = await fetch(`/api/data/${roleId}`);
    return response.json();
  },
  defaultValue: null, // 可选：默认值
  lazy: false, // 可选：是否懒加载（默认 false）
});
```

**特性：**

- 自动错误处理
- 防止重复请求
- 支持懒加载
- 提供 `refetch` 函数手动刷新

### 使用卡片包装器

`CardWrapper` 提供统一的错误边界和加载状态：

```typescript
import { CardWrapper } from "../base/card-wrapper";

export default function MyCard(props: BaseCardProps) {
  return (
    <CardWrapper>
      {/* 你的卡片内容 */}
    </CardWrapper>
  );
}
```

### 保存卡片配置

如果需要保存用户设置，可以使用 Tauri invoke：

```typescript
import { invoke } from "@tauri-apps/api/core";

// 保存配置
await invoke("save_card_settings", {
  cardId,
  settings: {
    /* 你的配置 */
  },
});

// 从 settings prop 读取配置
const mySetting = settings.myKey || defaultValue;
```

## 最佳实践

### 1. 性能优化

- 使用 `useCardData` 避免重复请求
- 大列表使用虚拟滚动
- 图片使用懒加载

### 2. 用户体验

- 始终提供加载状态
- 优雅处理错误
- 支持键盘导航
- 响应式设计

### 3. 国际化

- 所有文本使用 i18n
- meta 文件提供完整的多语言支持

```typescript
import { useTranslation } from "react-i18next";

const { t } = useTranslation();
<h3>{t("my_card.title")}</h3>
```

### 4. 样式规范

- 使用玻璃组件（`@/components/ui/glass`）保持视觉一致
- 遵循项目的颜色系统
- 支持深色模式

### 5. 类型安全

- 为数据定义 TypeScript 接口
- 避免使用 `any` 类型
- 充分利用类型推断

## 示例：完整卡片实现

```typescript
import { useState } from "react";
import { GlassButton, GlassCard } from "@/components/ui/glass";
import { useTranslation } from "react-i18next";
import { BaseCardProps } from "../registry/types";
import { useCardData } from "../base/use-card-data";
import { invoke } from "@tauri-apps/api/core";

interface MyData {
  title: string;
  count: number;
}

export default function ExampleCard({
  roleId,
  cardId,
  settings,
  isEditMode
}: BaseCardProps) {
  const { t } = useTranslation();
  const [count, setCount] = useState(settings.count || 0);

  const { data, isLoading } = useCardData<MyData>({
    fetchData: async () => {
      const result = await invoke("get_my_data", { roleId });
      return result as MyData;
    }
  });

  const handleUpdate = async () => {
    const newCount = count + 1;
    setCount(newCount);

    // 保存配置
    await invoke("save_card_settings", {
      cardId,
      settings: { ...settings, count: newCount }
    });
  };

  if (isLoading) {
    return <div>Loading...</div>;
  }

  return (
    <GlassCard className="p-4 glass-surface border border-separator/90">
      <h3>{data?.title || t("example.default_title")}</h3>
      <p>Count: {count}</p>
      {!isEditMode && (
        <GlassButton onPress={handleUpdate}>
          Increment
        </GlassButton>
      )}
    </GlassCard>
  );
}
```

## 调试技巧

### 1. 查看注册的卡片

在浏览器控制台运行：

```javascript
import { getAvailableCards } from "./components/cards/registry/loader";
console.log(getAvailableCards());
```

### 2. 检查元数据加载

确保 meta.json 文件格式正确，特别是：

- JSON 语法有效
- 必需字段都存在
- `id` 与其他卡片不冲突

### 3. 组件未显示？

检查清单：

- [ ] meta.json 文件名格式：`[card-name].meta.json`
- [ ] 组件文件名：`index.tsx`
- [ ] 组件使用 `export default`
- [ ] 组件接收 `BaseCardProps`
- [ ] 重启开发服务器（Vite 可能需要）

## 常见问题

### Q: 为什么我的卡片没有出现在添加对话框中？

A: 检查以下几点：

1. meta.json 文件是否存在且格式正确
2. index.tsx 是否使用默认导出
3. 卡片 ID 是否已存在于当前 dashboard 配置中
4. 尝试重启开发服务器

### Q: 如何更新卡片版本？

A: 修改 meta.json 中的 `version` 字段。未来可以基于版本号实现迁移逻辑。

### Q: 可以实现卡片间的通信吗？

A: 可以通过以下方式：

1. 使用 React Context
2. 使用事件总线（window.dispatchEvent）
3. 通过后端服务共享状态

### Q: 支持动态导入卡片组件吗？

A: 当前使用 `eager: true` 预加载所有卡片。如果卡片数量很多，可以改为懒加载，但需要修改 `loader.ts`。

## 附录：元数据字段完整说明

| 字段          | 类型    | 必需 | 默认值 | 说明                              |
| ------------- | ------- | ---- | ------ | --------------------------------- |
| id            | string  | ✓    | -      | 卡片唯一标识，小写字母和下划线    |
| name          | object  | ✓    | -      | 多语言名称，至少包含 zh 和 en     |
| description   | object  | ✓    | -      | 多语言描述                        |
| icon          | string  | ✓    | -      | 图标名称或图标类名                |
| defaultSize   | object  | ✓    | -      | 默认尺寸 { w: number, h: number } |
| version       | string  | ✓    | -      | 语义化版本号，如 "1.0.0"          |
| allowMultiple | boolean | ✗    | false  | 是否允许多个实例                  |

## 下一步

- 查看 `_template` 目录获取完整模板
- 参考 `character-list` 卡片了解实际实现（[cards_character_list.md](reference/frontend/cards_character_list.md)）
- 阅读 `registry/types.ts` 了解类型定义（[cards_core.md](reference/frontend/cards_core.md)）

## 附：关键实现位置速查

| 事项 | 位置 |
| --- | --- |
| 自动发现与注册 | `src/components/cards/registry/loader.ts`（`import.meta.glob`，`eager: true`） |
| 卡片类型定义（`CardMeta`/`BaseCardProps`/`CardModule`） | `src/components/cards/registry/types.ts` |
| 数据加载 Hook | `src/components/cards/base/use-card-data.ts` |
| 卡片渲染容器（拖拽/编辑模式/尺寸） | `src/components/cards/card-container.tsx`（由 `src/pages/dashboard.tsx:422` 调用） |
| 「添加卡片」对话框 | `src/components/add-card-modal.tsx`（`getAvailableCards()` 自动收录，无需登记） |
| 卡片配置读写 | `src/utils/cardConfigService.ts` → 命令 `get/save/remove_card_settings` → `commands/card_config.rs:9/26/66` |
| 布局与标签页持久化 | `src/utils/dashboardConfig.ts`、`src/utils/tabService.ts` → `set_config`（键 `dashboard_tabs`） |
| 卡片间事件 | `window.dispatchEvent(new CustomEvent("cardAction", {...}))` |
| 启动任务（`startup(roleId)`） | `src/cards/startup-service.ts` |
| 卡片 settings 类型 | `src/types/card-settings.ts` |
| 卡片 i18n 命名空间 | 各卡片 `locales/{zh,en}.json`，由 loader 扁平合并进 `card` 命名空间（同名 key 会互相覆盖） |

# 卡片配置系统

> 相关实现参考：[reference/frontend/utils_services_a.md](reference/frontend/utils_services_a.md)（`cardConfigService.ts` 逐函数说明）、
> [reference/backend/commands.md](reference/backend/commands.md)（`get/save/remove_card_settings` 的参数与合并逻辑）、
> [reference/frontend/types_locales_styles.md](reference/frontend/types_locales_styles.md)（`types/card-settings.ts` 全部类型）。

## 概述

卡片配置系统提供统一的配置管理机制，所有卡片的内部数据都通过此系统进行存储和读取。

## 配置结构

### app_config.json 结构

```json
{
  "account_token_user123": "...",
  "selected_account": "user123",
  "card_settings": {
    "uuid-1": {
      "selectedCharIds": ["char1", "char2", "char3"]
    },
    "uuid-2": {
      "customData": "..."
    }
  },
  "dashboard_config_role123": {
    "cards": [...],
    "lastUpdated": 1234567890
  }
}
```

### 配置层级

```
app_config.json
├── account_token_*          # 账户令牌
├── selected_account         # 当前选中账户
├── card_settings            # 卡片配置（新增）
│   ├── {cardId_1}           # 卡片1的配置
│   │   ├── selectedCharIds  # CharacterList 卡片特有
│   │   └── ...              # 其他配置项
│   ├── {cardId_2}           # 卡片2的配置
│   │   └── customData       # TestCard 卡片特有
│   └── ...
└── dashboard_config_*       # Dashboard 布局配置
```

## API 使用

### 前端 API

#### 1. CardConfigService

```typescript
import { CardConfigService } from "@/utils/cardConfigService";
import type { CharacterListCardSettings } from "@/types/card-settings";

// 获取配置
const settings =
  await CardConfigService.getCardSettings<CharacterListCardSettings>(cardId);

// 保存配置（合并更新）
await CardConfigService.saveCardSettings(cardId, {
  selectedCharIds: ["char1", "char2"],
});

// 更新单个字段
await CardConfigService.updateCardSetting(cardId, "selectedCharIds", ["char1"]);

// 删除配置
await CardConfigService.removeCardSettings(cardId);
```

#### 2. 类型定义

在 `src/types/card-settings.ts` 中定义卡片配置类型：

```typescript
export interface CharacterListCardSettings {
  selectedCharIds?: string[];
}

export interface TestCardSettings {
  customData?: any;
}

export type CardSettingsMap = {
  character_list: CharacterListCardSettings;
  test_card: TestCardSettings;
};
```

### 后端 API

#### Tauri Commands

```rust
// 获取卡片配置
#[tauri::command]
pub async fn get_card_settings(
    state: State<'_, Arc<Mutex<AccountService>>>,
    card_id: String,
) -> Result<Value, String>

// 保存卡片配置（合并更新）
#[tauri::command]
pub async fn save_card_settings(
    state: State<'_, Arc<Mutex<AccountService>>>,
    card_id: String,
    settings: Value,
) -> Result<bool, String>

// 删除卡片配置
#[tauri::command]
pub async fn remove_card_settings(
    state: State<'_, Arc<Mutex<AccountService>>>,
    card_id: String,
) -> Result<bool, String>
```

## 开发新卡片

### 步骤1：定义配置类型

在 `src/types/card-settings.ts` 中添加：

```typescript
export interface MyNewCardSettings {
  mySetting?: string;
  anotherSetting?: number;
}

export type CardSettingsMap = {
  // ...existing types
  my_new_card: MyNewCardSettings;
};
```

### 步骤2：使用配置服务

在卡片组件中：

```typescript
import { CardConfigService } from "@/utils/cardConfigService";
import type { MyNewCardSettings } from "@/types/card-settings";

export default function MyNewCard({ cardId, ... }: BaseCardProps) {
  const [mySetting, setMySetting] = useState<string>("");

  // 加载配置
  useEffect(() => {
    const loadSettings = async () => {
      const settings = await CardConfigService.getCardSettings<MyNewCardSettings>(cardId);
      setMySetting(settings.mySetting || "default");
    };
    loadSettings();
  }, [cardId]);

  // 保存配置
  const updateSetting = async (value: string) => {
    await CardConfigService.updateCardSetting(cardId, 'mySetting', value);
    setMySetting(value);
  };

  return (
    // ...your UI
  );
}
```

## 优势

### 1. 统一管理

- 所有卡片配置集中在 `card_settings` 对象下
- 清晰的配置层级结构
- 易于维护和调试

### 2. 类型安全

- TypeScript 类型定义
- 编译时检查
- IDE 智能提示

### 3. 灵活扩展

- 每个卡片独立配置
- 支持任意 JSON 结构
- 自动合并更新

## 最佳实践

### 1. 使用类型

始终为卡片配置定义 TypeScript 接口：

```typescript
// 好
const settings =
  await CardConfigService.getCardSettings<MyCardSettings>(cardId);

// 不推荐
const settings = await CardConfigService.getCardSettings(cardId);
```

### 2. 错误处理

配置读取失败时提供默认值：

```typescript
const settings =
  await CardConfigService.getCardSettings<MyCardSettings>(cardId);
const myValue = settings.myField ?? defaultValue;
```

### 3. 批量更新

需要更新多个字段时，使用 `saveCardSettings`：

```typescript
// 好 - 一次写入
await CardConfigService.saveCardSettings(cardId, {
  field1: value1,
  field2: value2,
  field3: value3,
});

// 不推荐 - 多次写入
await CardConfigService.updateCardSetting(cardId, "field1", value1);
await CardConfigService.updateCardSetting(cardId, "field2", value2);
await CardConfigService.updateCardSetting(cardId, "field3", value3);
```

### 4. 清理配置

卡片被删除时，**自动清理**其配置：

```typescript
// 在 dashboard.tsx 的 handleRemoveCard 中
await CardConfigService.removeCardSettings(cardId);
```

这确保了不会有孤立的配置数据留在 app_config.json 中。

## 迁移指南

### 重要提示

**系统已完全移除对旧格式的兼容**。如果您之前使用过旧版本的配置格式（`selected_char_ids_{cardId}`），需要手动迁移到新格式。

### 从旧格式迁移

旧格式（已废弃，不再支持）：

```
selected_char_ids_{cardId}: ["char1", "char2"]
```

新格式：

```
card_settings.{cardId}.selectedCharIds: ["char1", "char2"]
```

#### 手动迁移步骤

如果您的配置文件中还有旧格式的数据，请按以下步骤迁移：

1. **打开配置文件**
   - Windows: `%LOCALAPPDATA%\cn.msk-network.endprotocol\app_config.json`
   - macOS: `~/Library/Application Support/cn.msk-network.endprotocol/app_config.json`
   - Linux: `~/.local/share/cn.msk-network.endprotocol/app_config.json`

2. **查找旧配置**
   搜索所有以 `selected_char_ids_` 开头的键

3. **转换为新格式**

   ```json
   // 旧格式
   "selected_char_ids_uuid-123": ["char1", "char2"]

   // 转换为新格式
   "card_settings": {
     "uuid-123": {
       "selectedCharIds": ["char1", "char2"]
     }
   }
   ```

4. **删除旧配置**
   删除所有 `selected_char_ids_*` 键

5. **保存文件并重启应用**

#### 自动化迁移脚本（可选）

如果您有很多卡片需要迁移，可以运行以下 Node.js 脚本：

```javascript
const fs = require("fs");
const path = require("path");

// 配置文件路径
const configPath = path.join(
  process.env.LOCALAPPDATA || process.env.HOME,
  "cn.msk-network.endprotocol",
  "app_config.json",
);

// 读取配置
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// 创建 card_settings 对象
if (!config.card_settings) {
  config.card_settings = {};
}

// 迁移所有旧配置
Object.keys(config).forEach((key) => {
  if (key.startsWith("selected_char_ids_")) {
    const cardId = key.replace("selected_char_ids_", "");
    const charIds = config[key];

    // 创建或更新卡片配置
    if (!config.card_settings[cardId]) {
      config.card_settings[cardId] = {};
    }
    config.card_settings[cardId].selectedCharIds = charIds;

    // 删除旧配置
    delete config[key];

    console.log(`Migrated: ${key} -> card_settings.${cardId}.selectedCharIds`);
  }
});

// 保存配置
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
console.log("Migration complete!");
```

## 故障排查

### Q: 配置没有保存？

A: 检查以下几点：

1. cardId 是否正确
2. 是否有权限写入配置文件
3. 查看控制台日志确认调用成功

### Q: 配置读取为空？

A: 可能原因：

1. 配置尚未保存（首次使用）
2. cardId 不匹配
3. 配置类型定义不正确

### Q: 如何查看所有卡片配置？

A: 打开 `app_config.json` 文件，查找 `card_settings` 对象。

位置：

- Windows: `%LOCALAPPDATA%\cn.msk-network.endprotocol\app_config.json`
- macOS: `~/Library/Application Support/cn.msk-network.endprotocol/app_config.json`
- Linux: `~/.local/share/cn.msk-network.endprotocol/app_config.json`

## 关键实现位置速查

| 事项 | 位置 |
| --- | --- |
| 前端读写封装 | `src/utils/cardConfigService.ts`（`getCardSettings` / `saveCardSettings` 合并更新 / `updateCardSetting` 读-改-写 / `removeCardSettings`） |
| settings 类型定义 | `src/types/card-settings.ts`（`CardSettingsMap` 按卡片 `id` 映射） |
| 后端命令 | `src-tauri/src/commands/card_config.rs:9/26/66`，状态经 `State<Arc<Mutex<AccountService>>>` → `get_config_service()` |
| 存储键 | `app_config.json` 顶层 `card_settings.{cardId}`（点号路径，由 `ConfigService::get/set` 解析） |
| 合并语义 | `save_card_settings` 做对象浅合并后整体写回（`commands/card_config.rs:36`） |
| 卡片删除时清理 | `src/pages/dashboard.tsx` 的移除逻辑 → `CardConfigService.removeCardSettings(cardId)` |
| 配置文件位置 | 见上文「迁移指南 → 打开配置文件」各平台路径 |

### 新增卡片与全局默认值（2026-10）

- `CardSettingsMap` 现包含 `system_resource: SystemResourceCardSettings`（`types/system-resource.ts`）与 `todo: TodoCardSettings`（`{ listId }`）。
- 系统资源卡片的配置（指标列表、布局、刷新频率、阈值…）同样存于 `card_settings.{cardId}`，首次使用按全局默认值生成。
- 另有两个全局默认值配置键（非 `card_settings` 结构，直接由 `configService` 读写）：
  - `system_resource_defaults`：默认刷新频率/单位/显示/精度/布局/阈值/曲线/主题色/默认模板（`utils/systemResourceService.ts`）。
  - `todo_defaults`：默认排序/隐藏已完成/优先级/截止时间/颜色/图标（`utils/todoDefaults.ts`）。
- To-Do 列表数据独立存于 `todo_lists`（一个列表 = 一张卡片），与卡片的 `{ listId }` 解耦，因此页面/弹窗/卡片三处共享同一份数据。

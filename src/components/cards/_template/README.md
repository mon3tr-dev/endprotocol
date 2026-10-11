# 卡片开发模板

## 快速开始

1. **复制此目录**

   ```bash
   cp -r _template my-new-card
   ```

2. **重命名元数据文件**

   ```bash
   mv my-new-card/_template.meta.json my-new-card/my-new-card.meta.json
   ```

3. **编辑元数据文件**
   - 修改 `id` 为你的卡片标识（小写字母和下划线）
   - 修改 `name` 和 `description` 的多语言文本
   - 选择合适的图标名称
   - 设置 `defaultSize` 默认尺寸

4. **实现卡片组件**
   - 编辑 `index.tsx`
   - 删除模板代码和注释
   - 实现你的业务逻辑

5. **添加卡片本地化翻译**
   - 在卡片目录下创建 `locales/` 文件夹
   - 添加 `zh.json` 和 `en.json` 翻译文件
   - 翻译键会自动注册到 i18n 的 `card` 命名空间下
   - 在组件中使用 `t("card:key_name")` 访问翻译

6. **测试**
   - 重启开发服务器
   - 在"添加卡片"对话框中查看新卡片

## 文件说明

- `_template.meta.json`: 卡片元数据配置
- `index.tsx`: 卡片组件实现
- `locales/`: 卡片本地化翻译文件（可选）
  - `zh.json`: 中文翻译
  - `en.json`: 英文翻译
- `README.md`: 本说明文件（可选保留或删除）

## 本地化翻译

卡片的 UI 文本应放在卡片自己的 `locales/` 目录中，而非全局 `translation.json`。

**locales/zh.json 示例：**
```json
{
  "title": "我的卡片",
  "description": "卡片描述"
}
```

**在组件中使用：**
```tsx
const { t } = useTranslation();

// 使用 card: 前缀访问卡片本地化
<h3>{t("card:title")}</h3>
<p>{t("card:description")}</p>
```

翻译键在 `card` 命名空间下，使用 `t("card:key")` 访问。

## 注意事项

- 以 `_` 开头的目录不会被自动注册为卡片
- 确保 meta.json 中的 `id` 全局唯一
- 组件必须使用 `export default`
- 组件 Props 必须符合 `BaseCardProps` 接口

## 参考资源

- [完整开发指南](../../../docs/card_development.md)
- [类型定义](../registry/types.ts)
- [示例卡片](../character-list/)

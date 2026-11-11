// 卡片标签接口（支持多语言）
export interface CardTag {
  id: string;
  label: Record<string, string>;
}

// 卡片元数据接口
export interface CardMeta {
  id: string;              // 卡片类型唯一标识
  name: Record<string, string>;  // 多语言名称 {zh: "...", en: "..."}
  description: Record<string, string>;  // 多语言描述
  icon: string;            // 图标名称或图标类名，不使用 emoji
  defaultSize: { w: number; h: number };  // 默认网格尺寸
  version: string;         // 卡片版本
  allowMultiple?: boolean; // 是否允许多个实例（默认 false）
  tags?: CardTag[];         // 卡片标签（多语言），用于搜索和筛选
  /**
   * 该卡片支持的游戏。
   *
   * - 未声明：按「两个游戏都支持」处理（新卡片默认不阻塞用户）。
   * - `[]`（空数组）：与游戏无关（系统资源、待办），任何账户都能用。
   * - `["endfield"]` / `["arknights"]`：该游戏独占，另一个游戏的账户不能选它。
   *
   * 运行时以 `@/config/gameSupport` 的 `CARD_GAME_SUPPORT` 为准（那里是唯一
   * 真值表）；此字段让卡片目录本身自描述，便于新增卡片时对照。
   */
  supportedGames?: ("endfield" | "arknights")[];
}

// 卡片组件 Props 标准接口
export interface BaseCardProps {
  roleId: string;          // 角色ID
  cardId: string;          // 卡片实例ID
  settings: any;           // 卡片配置
  isEditMode?: boolean;    // 编辑模式标志
  /** 当前卡片网格宽度（列数，1 格 = 100px；由 CardContainer 传入） */
  w?: number;
  /** 当前卡片网格高度（行数） */
  h?: number;
}

// 卡片翻译资源（每个语言一个对象）
export interface CardLocales {
  [language: string]: Record<string, string>;
}

// 卡片模块导出接口
export interface CardModule {
  meta: CardMeta;
  component: React.ComponentType<BaseCardProps>;
  startup?: (roleId: string) => Promise<void>;
  locales?: CardLocales;   // 卡片本地化翻译资源
}

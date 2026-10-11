// 卡片配置类型定义

import type { SystemResourceCardSettings } from "./system-resource";

export type SortOrder = "rarity" | "name" | "level";

export type CharacterListDisplayMode = "single" | "double" | "triple";

/**
 * CharacterList 卡片配置
 */
export interface CharacterListCardSettings {
  selectedCharIds?: string[];  // 选中的角色ID列表
  sortOrder?: SortOrder;       // 排列顺序
  displayMode?: CharacterListDisplayMode;  // 显示模式
  roleId?: string;             // 自定义角色ID（独立于dashboard的defaultRoleId）
}

/**
 * Attendance 签到卡片配置
 */
export interface AttendanceCardSettings {
  selectedRoleId?: string;  // 选中的角色ID（作为签到账户）
}

/**
 * 蚀刻章卡片配置
 */
export interface AchievementCardSettings {
  selectedMedalIds?: string[];
  featuredMedalId?: string;
  useDisplayList?: boolean;
  roleId?: string;
}

/**
 * 账户信息卡片配置
 */
export interface AccountInfoCardSettings {
  roleId?: string;  // 自定义角色ID（独立于dashboard的defaultRoleId）
}

/**
 * 账户进度卡片配置
 */
export interface AccountProgressCardSettings {
  roleId?: string;  // 自定义角色ID（独立于dashboard的defaultRoleId）
}

/**
 * 区域(domain)信息卡片配置
 */
export interface DomainInfoCardSettings {
  roleId?: string;   // 自定义角色ID（独立于dashboard的defaultRoleId）
  domainId?: string; // 选中的区域ID（默认第一个）
}

/**
 * 帝江号(spaceship)卡片配置
 */
export interface SpaceshipCardSettings {
  roleId?: string;  // 自定义角色ID（独立于dashboard的defaultRoleId）
}

/**
 * TestCard 卡片配置（示例）
 */
export interface TestCardSettings {
  customData?: any;  // 自定义数据
}

/**
 * To-Do 卡片配置：绑定到一个列表
 */
export interface TodoCardSettings {
  listId?: string;
}

/**
 * 所有卡片配置的联合类型
 */
export type CardSettingsMap = {
  character_list: CharacterListCardSettings;
  attendance: AttendanceCardSettings;
  achievement: AchievementCardSettings;
  account_info: AccountInfoCardSettings;
  account_progress: AccountProgressCardSettings;
  domain_info: DomainInfoCardSettings;
  spaceship: SpaceshipCardSettings;
  test_card: TestCardSettings;
  system_resource: SystemResourceCardSettings;
  todo: TodoCardSettings;
  // 未来添加新卡片时在此注册
};

/**
 * 通用卡片配置接口
 */
export interface BaseCardSettings {
  [key: string]: any;
}

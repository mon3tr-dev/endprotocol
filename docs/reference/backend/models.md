# 后端数据模型 — 文件功能参考

> 逐文件精读源码生成。行号基于当前工作区版本，仅用于快速定位。
> 所有结构体均位于 `src-tauri/src/models/` 目录下，除特别说明外，容器级 serde 属性为 `#[serde(rename_all = "camelCase")]`（下文表格「serde」列只标注**字段级**属性）。

## `src-tauri/src/models/mod.rs`
**职责**：模型模块入口，仅做子模块声明，无任何类型定义。
**导出**：`pub mod account`（:1）、`pub mod char_detail`（:2）、`pub mod gacha`（:3）、`pub mod game`（:4）、`pub mod login`（:5）、`pub mod role`（:6）。

---

## `src-tauri/src/models/account.rs`
**职责**：账户相关数据模型——包含本地保存的完整/精简账户信息、森空岛（Skland）父级账户与用户资料的 API 反序列化结构，以及刷新/登录结果。文件共 175 行。
**导出**：`AccountSummary`、`SklandAccountInfo`、`SklandUserInfo`、`SklandGameInfo`、`SklandGameScore`、`SklandPendant`、`SklandBackground`、`SklandUserStats`、`AccountInfo`、`AccountRefreshResult`、`AccountLoginResult`；impl `AccountInfo::to_summary`。

### `struct AccountSummary`
- 位置：account.rs:6
- derive：`#[derive(Serialize, Deserialize, Clone, Debug)]`，容器 `#[serde(rename_all = "camelCase")]`
- 用途：Account 页面使用的精简账户信息（剥离凭证等敏感字段）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `id` | `String` | — | 角色 ID（源码注释标注为 roleId） |
| `avatar` | `String` | — | 头像地址 |
| `nickname` | `String` | — | 昵称 |
| `level` | `i32` | — | 等级 |
| `server` | `String` | — | 服务器名 |
| `status` | `String` | — | 在线状态：online/offline/loading |
| `sync_status` | `Option<String>` | — | 同步状态：SYNCING/FAILED/null |

### `struct SklandAccountInfo`
- 位置：account.rs:19
- derive：`#[derive(Serialize, Deserialize, Clone, Debug)]`，容器 `rename_all = "camelCase"`
- 用途：森空岛父级账户摘要，游戏角色通过 `user_id` 关联。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `user_id` | `String` | — | 森空岛用户 ID |
| `game_role_count` | `usize` | — | 关联的游戏角色数量 |
| `nickname` | `Option<String>` | `default` + `skip_serializing_if = "Option::is_none"` | 已缓存的森空岛昵称（来自 `GET /web/v1/user`，未获取过为 None） |
| `avatar` | `Option<String>` | `default` + `skip_serializing_if = "Option::is_none"` | 已缓存的森空岛头像地址，同上 |
| `phone` | `Option<String>` | `default` + `skip_serializing_if = "Option::is_none"` | 首次登录时记录的手机号（`account_token_{user_id}.phone`），供「重新登录」短信/密码方式自动填充；未记录为 None |

### `struct SklandUserInfo`
- 位置：account.rs:33
- derive：`#[derive(Serialize, Deserialize, Clone, Debug, Default)]`，容器 `#[serde(rename_all = "camelCase", default)]`（缺失字段走 Default）
- 用途：森空岛用户资料，对应 `GET /web/v1/user` 响应中的 `data.user`。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `id` | `String` | —（容器 default） | 用户 ID |
| `nickname` | `String` | —（容器 default） | 昵称 |
| `profile` | `String` | —（容器 default） | 个人简介 |
| `avatar` | `String` | —（容器 default） | 头像地址 |
| `avatar_code` | `i64` | —（容器 default） | 头像编号 |
| `background_code` | `i64` | —（容器 default） | 背景编号 |
| `is_creator` | `bool` | —（容器 default） | 是否创作者 |
| `status` | `i32` | —（容器 default） | 账户状态码 |
| `operation_status` | `i32` | —（容器 default） | 运营状态码 |
| `identity` | `i32` | —（容器 default） | 身份标识 |
| `kind` | `i32` | —（容器 default） | 用户类型 |
| `latest_ip_location` | `String` | —（容器 default） | 最近 IP 属地 |
| `moderator_status` | `i32` | —（容器 default） | 版主状态 |
| `moderator_change_time` | `i64` | —（容器 default） | 版主状态变更时间 |
| `gender` | `i32` | —（容器 default） | 性别 |
| `birthday` | `String` | —（容器 default） | 生日 |
| `hg_id` | `String` | —（容器 default） | 鹰角账号 ID |
| `show_id` | `String` | —（容器 default） | 展示 ID |
| `score_info_list` | `Vec<SklandGameScore>` | —（容器 default） | 各游戏社区等级/积分 |
| `pendant` | `Option<SklandPendant>` | `skip_serializing_if = "Option::is_none"` | 头像挂件 |
| `stats` | `Option<SklandUserStats>` | `skip_serializing_if = "Option::is_none"` | 对应 `data.userRts`，社区互动数据（关注/粉丝/获赞等） |
| `background` | `Option<SklandBackground>` | `skip_serializing_if = "Option::is_none"` | 对应 `data.background`，个人主页背景 |

### `struct SklandGameInfo`
- 位置：account.rs:68
- derive：`Serialize, Deserialize, Clone, Debug, Default`，容器 `rename_all = "camelCase", default`
- 用途：森空岛游戏基础信息，对应 `GET /web/v1/game` 响应中的 `data.list[].game`。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `game_id` | `i64` | —（容器 default） | 游戏 ID |
| `name` | `String` | —（容器 default） | 游戏名 |
| `icon_url` | `String` | —（容器 default） | 图标地址 |
| `background_url` | `String` | —（容器 default） | 背景图地址 |

### `struct SklandGameScore`
- 位置：account.rs:78
- derive：`Serialize, Deserialize, Clone, Debug, Default`，容器 `rename_all = "camelCase", default`
- 用途：森空岛用户在单个游戏下的等级/积分。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `game_id` | `i64` | —（容器 default） | 游戏 ID |
| `level` | `i32` | —（容器 default） | 社区等级 |
| `icon_url` | `String` | —（容器 default） | 等级图标 |
| `dark_mode_icon_url` | `String` | —（容器 default） | 深色模式图标 |
| `checked_days` | `i32` | —（容器 default） | 签到天数 |
| `score` | `i64` | —（容器 default） | 积分 |
| `game_name` | `String` | —（容器 default） | 游戏名 |
| `level_url` | `String` | —（容器 default） | 等级详情链接 |

### `struct SklandPendant`
- 位置：account.rs:92
- derive：`Serialize, Deserialize, Clone, Debug, Default`，容器 `rename_all = "camelCase", default`
- 用途：森空岛头像挂件。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `id` | `i64` | —（容器 default） | 挂件 ID |
| `icon_url` | `String` | —（容器 default） | 挂件图标 |
| `title` | `String` | —（容器 default） | 挂件标题 |
| `description` | `String` | —（容器 default） | 挂件描述 |

### `struct SklandBackground`
- 位置：account.rs:102
- derive：`Serialize, Deserialize, Clone, Debug, Default`，容器 `rename_all = "camelCase", default`
- 用途：森空岛个人主页背景。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `id` | `i64` | —（容器 default） | 背景 ID |
| `url` | `String` | —（容器 default） | 背景图地址 |
| `resource_kind` | `i32` | —（容器 default） | 资源类型 |

### `struct SklandUserStats`
- 位置：account.rs:111
- derive：`Serialize, Deserialize, Clone, Debug, Default`，容器 `rename_all = "camelCase", default`
- 用途：森空岛社区互动数据（`data.userRts`），接口以**字符串**返回数值，故全部字段为 `String`。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `liked` | `String` | —（容器 default） | 获赞数（字符串） |
| `collect` | `String` | —（容器 default） | 收藏数 |
| `comment` | `String` | —（容器 default） | 评论数 |
| `follow` | `String` | —（容器 default） | 关注数 |
| `fans` | `String` | —（容器 default） | 粉丝数 |
| `black` | `String` | —（容器 default） | 拉黑数 |
| `published` | `String` | `rename = "pub"`（容器 default） | 发布数，JSON 键为 `pub` |

### `struct AccountInfo`
- 位置：account.rs:125
- derive：`Serialize, Deserialize, Clone, Debug`，容器 `rename_all = "camelCase"`
- 用途：完整账户信息（含认证信息），本地持久化与命令返回的主结构。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `id` | `String` | — | 角色 ID（roleId） |
| `avatar` | `String` | — | 头像地址 |
| `nickname` | `String` | — | 昵称 |
| `level` | `i32` | — | 等级 |
| `server` | `String` | — | 服务器名 |
| `status` | `String` | — | online/offline/loading |
| `sync_status` | `Option<String>` | — | SYNCING/FAILED/null |
| `cred` | `Option<String>` | — | 认证凭证 cred |
| `token` | `Option<String>` | — | 认证 token |
| `user_id` | `Option<String>` | — | 森空岛 user_id |
| `server_id` | `Option<String>` | — | 服务器 ID |

**备注**：impl 块位于 account.rs:139。
- `pub fn to_summary(&self) -> AccountSummary` — account.rs:141：拷贝非敏感字段转换为精简版，移除 cred/token/user_id/server_id。

### `struct AccountRefreshResult`
- 位置：account.rs:157
- derive：`Serialize, Deserialize, Clone, Debug`，容器 `rename_all = "camelCase"`
- 用途：账户刷新命令的返回结果。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `success` | `bool` | — | 是否成功 |
| `error_message` | `Option<String>` | — | 失败原因 |
| `accounts` | `Vec<AccountInfo>` | — | 刷新后的账户列表 |
| `refresh_time` | `String` | — | 刷新时间字符串 |

### `struct AccountLoginResult`
- 位置：account.rs:167
- derive：`Serialize, Deserialize, Clone, Debug`，容器 `rename_all = "camelCase"`
- 用途：账户登录命令的返回结果（含可选角色列表与凭证）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `success` | `bool` | — | 是否成功 |
| `error_message` | `Option<String>` | — | 失败原因 |
| `account` | `Option<AccountInfo>` | — | 登录得到的账户 |
| `available_roles` | `Option<Vec<crate::models::role::RoleDisplayInfo>>` | — | 可选角色列表（跨模块引用 role.rs） |
| `cred` | `Option<String>` | — | 返回的 cred |
| `token` | `Option<String>` | — | 返回的 token |
| `user_id` | `Option<String>` | — | 返回的 user_id |

---

## `src-tauri/src/models/char_detail.rs`
**职责**：角色详情（干员档案）API 响应的反序列化模型，含两个自定义反序列化器（字符串数字转换、chars 解析容错）。文件共 304 行。
**导出**：`CharDetailResponse`、`CharDetailDataWrapper`、`CharDetailData`、`BaseInfo`、`MainMission`、`CharacterItem`、`TalentNodes`、`CharacterData`、`RarityInfo`、`ProfessionInfo`、`PropertyInfo`、`WeaponTypeInfo`、`SkillInfo`、`SkillForm`、`SkillTypeInfo`、`TalentInfo`、`BpSystem`、`DailyMission`、`WeeklyMission`。私有函数 `deserialize_string_to_i64`、`deserialize_chars_fallback`（`fn`，非 pub）。

### `struct CharDetailResponse`
- 位置：char_detail.rs:6
- derive：`Serialize, Deserialize, Clone, Debug`，容器 `rename_all = "camelCase"`
- 用途：角色详情接口的顶层响应包装（code/message/timestamp/data）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `code` | `i32` | — | 业务状态码 |
| `message` | `String` | — | 状态信息 |
| `timestamp` | `String` | — | 响应时间戳（字符串） |
| `data` | `CharDetailDataWrapper` | — | 数据体 |

### `struct CharDetailDataWrapper`
- 位置：char_detail.rs:16
- derive：同上
- 用途：数据包装器（`data.detail` 一层）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `detail` | `CharDetailData` | — | 详情数据 |

### `struct CharDetailData`
- 位置：char_detail.rs:23
- derive：同上
- 用途：角色详情主数据结构，聚合基础信息、干员列表、任务、通行证等模块。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `base` | `BaseInfo` | — | 玩家基础信息 |
| `chars` | `Vec<CharacterItem>` | `default` + `deserialize_with = "deserialize_chars_fallback"` | 干员列表；解析失败时降级为空数组 |
| `dungeon` | `Option<serde_json::Value>` | `default` | 秘境数据（未建模，原样保留） |
| `bp_system` | `Option<BpSystem>` | `default` | 战斗通行证系统 |
| `daily_mission` | `Option<DailyMission>` | `default` | 每日任务 |
| `weekly_mission` | `Option<WeeklyMission>` | `default` | 每周任务 |
| `space_ship` | `Option<serde_json::Value>` | `default` | 飞船数据（未建模） |
| `domain` | `Option<serde_json::Value>` | `default` | 域数据（未建模） |
| `quickaccess` | `Option<serde_json::Value>` | `default` | 快捷入口数据（未建模） |
| `config` | `Option<serde_json::Value>` | `default` | 配置数据（未建模） |
| `achieve` | `Option<serde_json::Value>` | `default` | 成就数据（未建模） |
| `current_ts` | `Option<i64>` | `default` + `deserialize_with = "deserialize_string_to_i64"` | 当前时间戳，接受数字或字符串 |

**备注**：自定义反序列化器：
- `fn deserialize_string_to_i64` — char_detail.rs:50：先把值读成 `serde_json::Value`，Number 直接取 i64，String 则 `parse::<i64>()`，其他类型报错。
- `fn deserialize_chars_fallback` — char_detail.rs:71：`Vec::<CharacterItem>::deserialize` 失败时经 `safe_eprintln!`（有控制台才写 stderr）警告并返回空数组，避免整包解析失败。

### `struct BaseInfo`
- 位置：char_detail.rs:96
- derive：同上
- 用途：基础玩家信息（角色概况、时间、计数）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `server_name` | `String` | — | 服务器名 |
| `role_id` | `String` | — | 角色 ID |
| `name` | `String` | — | 角色昵称 |
| `create_time` | `String` | — | 创建时间（字符串） |
| `save_time` | `String` | — | 存档时间（字符串） |
| `last_login_time` | `String` | — | 最近登录时间（字符串） |
| `exp` | `i64` | — | 经验值 |
| `level` | `i32` | — | 等级 |
| `world_level` | `i32` | — | 世界等级 |
| `gender` | `i32` | — | 性别 |
| `avatar_url` | `String` | — | 头像地址 |
| `main_mission` | `MainMission` | — | 主线任务 |
| `char_num` | `i32` | — | 干员数量 |
| `weapon_num` | `i32` | — | 武器数量 |
| `doc_num` | `i32` | — | 文档/档案数量 |

### `struct MainMission`
- 位置：char_detail.rs:117
- derive：同上
- 用途：主线任务信息。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `id` | `String` | — | 任务 ID |
| `description` | `String` | — | 任务描述 |

### `struct CharacterItem`
- 位置：char_detail.rs:125
- derive：同上；**全部字段均带 `#[serde(default)]`**
- 用途：干员项（API 返回格式，玩家侧养成数据）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `char_data` | `Option<CharacterData>` | `default` | 干员静态详情（嵌套） |
| `id` | `Option<String>` | `default` | 干员 ID |
| `level` | `Option<i32>` | `default` | 等级 |
| `evolve_phase` | `Option<i32>` | `default` | 进化/晋升阶段 |
| `potential_level` | `Option<i32>` | `default` | 潜能等级 |
| `user_skills` | `Option<serde_json::Value>` | `default` | 用户技能数据（未建模） |
| `body_equip` | `Option<serde_json::Value>` | `default` | 身体装备（未建模） |
| `arm_equip` | `Option<serde_json::Value>` | `default` | 臂部装备（未建模） |
| `first_accessory` | `Option<serde_json::Value>` | `default` | 第一饰品（未建模） |
| `second_accessory` | `Option<serde_json::Value>` | `default` | 第二饰品（未建模） |
| `weapon` | `Option<serde_json::Value>` | `default` | 装备武器（未建模） |
| `tactical_item` | `Option<serde_json::Value>` | `default` | 战术道具（未建模） |
| `wiki_item_id` | `Option<String>` | `default` | 图鉴条目 ID |
| `talent` | `Option<TalentNodes>` | `default` | 天赋节点 |

### `struct TalentNodes`
- 位置：char_detail.rs:159
- derive：同上
- 用途：干员天赋节点信息（分能力/战斗/制造/培养四类）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `latest_break_node` | `String` | — | 最新突破节点 |
| `attr_nodes` | `Vec<String>` | — | 能力天赋节点 ID 列表 |
| `latest_passive_skill_nodes` | `Vec<String>` | — | 战斗天赋节点 ID 列表 |
| `latest_factory_skill_nodes` | `Vec<String>` | — | 制造天赋节点 ID 列表 |
| `latest_spaceship_skill_nodes` | `Vec<String>` | — | 培养（飞船）天赋节点 ID 列表 |

### `struct CharacterData`
- 位置：char_detail.rs:170
- derive：同上；**全部字段均带 `#[serde(default)]`**
- 用途：干员详细静态数据（稀有度、职业、技能、天赋、立绘等）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `id` | `Option<String>` | `default` | 干员 ID |
| `name` | `Option<String>` | `default` | 干员名 |
| `avatar_sq_url` | `Option<String>` | `default` | 方形头像 |
| `avatar_rt_url` | `Option<String>` | `default` | 矩形头像 |
| `rarity` | `Option<RarityInfo>` | `default` | 稀有度（key/value 对） |
| `profession` | `Option<ProfessionInfo>` | `default` | 职业 |
| `property` | `Option<PropertyInfo>` | `default` | 属性/伤害类型 |
| `weapon_type` | `Option<WeaponTypeInfo>` | `default` | 武器类型 |
| `skills` | `Option<Vec<SkillInfo>>` | `default` | 技能列表 |
| `illustration_url` | `Option<String>` | `default` | 立绘地址 |
| `tags` | `Option<Vec<String>>` | `default` | 标签 |
| `ability_talents` | `Option<Vec<TalentInfo>>` | `default` | 能力天赋 |
| `combat_talents` | `Option<Vec<TalentInfo>>` | `default` | 战斗天赋 |
| `cultivation_talents` | `Option<Vec<TalentInfo>>` | `default` | 培养天赋 |

### `struct RarityInfo` / `struct ProfessionInfo` / `struct PropertyInfo` / `struct WeaponTypeInfo` / `struct SkillTypeInfo`
这五个结构体结构完全相同（key/value 二元组），分别位于：
- `RarityInfo` — char_detail.rs:204（稀有度）
- `ProfessionInfo` — char_detail.rs:212（职业）
- `PropertyInfo` — char_detail.rs:220（属性；同时被 `SkillInfo.property` 复用）
- `WeaponTypeInfo` — char_detail.rs:228（武器类型）
- `SkillTypeInfo` — char_detail.rs:265（技能类型）

derive 均为 `Serialize, Deserialize, Clone, Debug` + 容器 `rename_all = "camelCase"`。

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `key` | `String` | — | 机器可读键（枚举值） |
| `value` | `String` | — | 展示名 |

### `struct SkillInfo`
- 位置：char_detail.rs:236
- derive：`Serialize, Deserialize, Clone, Debug`，容器 `rename_all = "camelCase"`
- 用途：干员技能信息。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `id` | `String` | — | 技能 ID |
| `name` | `String` | — | 技能名 |
| `skill_type` | `SkillTypeInfo` | `rename = "type"` | 技能类型（JSON 键为 `type`） |
| `property` | `PropertyInfo` | — | 技能属性/伤害类型 |
| `icon_url` | `String` | — | 技能图标 |
| `desc` | `String` | — | 技能描述（含占位符） |
| `desc_params` | `serde_json::Value` | — | 描述参数（未建模） |
| `desc_level_params` | `serde_json::Value` | — | 各等级描述参数（未建模） |
| `forms` | `Vec<SkillForm>` | `default` | 多形态技能列表 |

### `struct SkillForm`
- 位置：char_detail.rs:253
- derive：同上
- 用途：技能形态（如「阵诀·智/阵诀·意」等多形态技能）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `form_type` | `String` | `rename = "type"` | 形态类型（JSON 键为 `type`） |
| `name` | `String` | — | 形态名 |
| `icon_url` | `String` | — | 形态图标 |
| `descs` | `Vec<String>` | `default` | 形态描述列表 |

### `struct TalentInfo`
- 位置：char_detail.rs:273
- derive：同上
- 用途：单条天赋信息（能力/战斗/培养天赋共用）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `id` | `String` | — | 天赋 ID |
| `name` | `String` | — | 天赋名 |
| `icon_url` | `String` | — | 天赋图标 |
| `desc` | `String` | — | 天赋描述 |
| `desc_params` | `Option<serde_json::Value>` | — | 描述参数（可为 null） |
| `locked_icon_url` | `String` | — | 未解锁状态图标 |

### `struct BpSystem`
- 位置：char_detail.rs:285
- derive：同上
- 用途：战斗通行证等级。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `cur_level` | `i32` | — | 当前等级 |
| `max_level` | `i32` | — | 最高等级 |

### `struct DailyMission`
- 位置：char_detail.rs:293
- derive：同上
- 用途：每日任务活跃度。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `daily_activation` | `i32` | — | 当日活跃度 |
| `max_daily_activation` | `i32` | — | 当日活跃度上限 |

### `struct WeeklyMission`
- 位置：char_detail.rs:301
- derive：同上
- 用途：每周任务积分。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `score` | `i32` | — | 当前周积分 |
| `total` | `i32` | — | 周积分上限/累计 |

---

## `src-tauri/src/models/gacha.rs`
**职责**：抽卡（寻访）数据模型——ef-webview 抽卡记录 API 的响应结构、本地持久化记录文件结构、同步结果与进度事件。文件共 217 行。
**导出**：`GachaApiResponse`、`GachaMetaData`、`GachaTab`、`GachaRecordData`、`GachaRecord`、`GachaWeaponRecordData`、`GachaWeaponRecord`、`SavedWeaponGachaData`、`SavedGachaData`、`GachaPoolInfo`、`GachaSyncResult`、`GachaSyncProgress`；impl `GachaTab`、impl `GachaRecord`、impl `GachaWeaponRecord`。依赖 `std::collections::HashMap`（:2）。

### `struct GachaApiResponse<T>`
- 位置：gacha.rs:7
- derive：`Serialize, Deserialize, Clone, Debug`，容器 `rename_all = "camelCase"`（泛型 `T` 需自身满足 serde bound）
- 用途：ef-webview 抽卡记录 API 的统一响应包装（`code = 0` 表示成功）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `code` | `i32` | — | 业务状态码 |
| `msg` | `String` | — | 状态信息（注意键名是 `msg`，不是 `message`） |
| `data` | `Option<T>` | — | 数据体，失败时为 None |

### `struct GachaMetaData`
- 位置：gacha.rs:16
- derive：同上
- 用途：`GET /api/record/char/meta` 的 `data`，卡池 Tab 列表。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `tabs` | `Vec<GachaTab>` | — | 卡池 Tab 列表 |
| `beginner_pull_count` | `Option<i32>` | `default` | 新手寻访次数 |

### `struct GachaTab`
- 位置：gacha.rs:25
- derive：同上
- 用途：单个卡池 Tab 定义，决定拉取记录时的请求参数。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `key` | `String` | — | Tab 键：`"special"` / `"joint:{poolId}"` / `"normal"` |
| `label` | `Option<String>` | `default` | 展示名 |
| `pool_type` | `String` | — | 请求记录时的 `pool_type` 参数 |
| `pool_id` | `Option<String>` | `default` | 请求记录时的 `pool_id` 参数（仅 joint 等有） |

**备注**：impl GachaTab（gacha.rs:37）
- `pub fn request_pool_id(&self) -> Option<&str>` — gacha.rs:39：返回 `pool_id.as_deref()`。

### `struct GachaRecordData`
- 位置：gacha.rs:52
- derive：同上
- 用途：`GET /api/record/char` 的 `data`（角色寻访记录分页结果）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `list` | `Vec<GachaRecord>` | `default` | 本页记录 |
| `has_more` | `bool` | — | 是否还有下一页 |

### `struct GachaRecord`
- 位置：gacha.rs:61
- derive：同上
- 用途：单条角色寻访记录。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `kind` | `String` | — | 类型：`draw`（寻访）/ `gift_intel_book`（赠礼） |
| `pool_id` | `String` | — | 卡池 ID |
| `pool_name` | `String` | — | 卡池名 |
| `name_text` | `String` | — | 物品/角色展示名（gift 时为「寻访情报书」等） |
| `char_id` | `Option<String>` | `default` | 干员 ID |
| `char_name` | `Option<String>` | `default` | 干员名 |
| `rarity` | `Option<i32>` | `default` | 稀有度 |
| `is_free` | `Option<bool>` | `default` | 是否免费获取 |
| `is_new` | `Option<bool>` | `default` | 是否首次获得 |
| `gacha_ts` | `String` | — | 抽卡时间，**毫秒时间戳但 API 返回字符串** |
| `seq_id` | `String` | — | 全局唯一序号，同时是翻页游标 |

**备注**：impl GachaRecord（gacha.rs:84）
- `pub fn is_draw(&self) -> bool` — gacha.rs:85：`kind == "draw"`。
- `pub fn is_gift(&self) -> bool` — gacha.rs:89：`kind == "gift_intel_book"`。
- `pub fn gacha_ts_ms(&self) -> Option<i64>` — gacha.rs:94：解析 `gacha_ts` 为 i64，失败返回 None。

### `struct GachaWeaponRecordData`
- 位置：gacha.rs:102
- derive：同上
- 用途：`GET /api/record/weapon` 的 `data`（武器寻访记录分页结果）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `list` | `Vec<GachaWeaponRecord>` | `default` | 本页记录 |
| `has_more` | `bool` | — | 是否还有下一页 |

### `struct GachaWeaponRecord`
- 位置：gacha.rs:111
- derive：同上
- 用途：单条武器寻访记录。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `kind` | `String` | — | 类型，实际恒为 `draw` |
| `pool_id` | `String` | — | 卡池 ID |
| `pool_name` | `String` | — | 卡池名 |
| `name_text` | `String` | — | 武器展示名 |
| `weapon_id` | `Option<String>` | `default` | 武器 ID |
| `weapon_name` | `Option<String>` | `default` | 武器名 |
| `weapon_type` | `Option<String>` | `default` | 武器类型 |
| `rarity` | `Option<i32>` | `default` | 稀有度 |
| `is_new` | `Option<bool>` | `default` | 是否首次获得 |
| `gacha_ts` | `String` | — | 抽卡时间（毫秒时间戳的字符串形式） |
| `seq_id` | `String` | — | 全局唯一序号/翻页游标 |

**备注**：impl GachaWeaponRecord（gacha.rs:134）
- `pub fn is_draw(&self) -> bool` — gacha.rs:135。
- `pub fn gacha_ts_ms(&self) -> Option<i64>` — gacha.rs:140。

### `struct SavedWeaponGachaData`
- 位置：gacha.rs:148
- derive：同上
- 用途：本地持久化的武器寻访数据，文件为 `gacha_records` 子目录下 `gacha_weapon_records_{userId}_{serverId}.json`。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `user_id` | `String` | — | 账户 user_id |
| `server_id` | `String` | — | 服务器 ID |
| `last_sync_time` | `Option<i64>` | `default` | 上次同步时间（毫秒） |
| `pools` | `HashMap<String, GachaPoolInfo>` | `default` | poolId → 卡池信息 |
| `records` | `Vec<GachaWeaponRecord>` | `default` | 全部记录，**从新到旧** |

### `struct SavedGachaData`
- 位置：gacha.rs:164
- derive：同上
- 用途：本地持久化的角色抽卡数据，文件为 `app_config.json` 同级目录下 `gacha_records_{userId}_{serverId}.json`。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `user_id` | `String` | — | 账户 user_id |
| `server_id` | `String` | — | 服务器 ID |
| `last_sync_time` | `Option<i64>` | `default` | 上次同步时间（毫秒） |
| `pools` | `HashMap<String, GachaPoolInfo>` | `default` | poolId → 卡池信息 |
| `records` | `Vec<GachaRecord>` | `default` | 全部记录，从新到旧 |

### `struct GachaPoolInfo`
- 位置：gacha.rs:180
- derive：同上
- 用途：卡池基础信息（缓存于本地记录文件的 `pools` 映射）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `pool_name` | `String` | — | 卡池名 |
| `pool_type` | `String` | — | 卡池类型（special/joint/normal 等） |

### `struct GachaSyncResult`
- 位置：gacha.rs:188
- derive：同上
- 用途：一次增量同步的汇总结果。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `user_id` | `String` | — | 账户 user_id |
| `server_id` | `String` | — | 服务器 ID |
| `synced_at` | `i64` | — | 同步完成时间（毫秒） |
| `new_records` | `i32` | — | 本次新增记录数 |
| `total_records` | `i32` | — | 合并后总记录数 |
| `per_tab_new` | `HashMap<String, i32>` | `default` | Tab key → 本次新增数 |

### `struct GachaSyncProgress`
- 位置：gacha.rs:205
- derive：同上
- 用途：增量同步进度，经 `gacha-sync-progress` 事件实时推送给前端。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `user_id` | `String` | — | 账户 user_id |
| `server_id` | `String` | — | 服务器 ID |
| `tab_index` | `usize` | — | 当前 Tab 索引（从 0 开始） |
| `tab_count` | `usize` | — | Tab 总数 |
| `tab_key` | `String` | — | 当前 Tab 的 key（special/joint:{poolId}/normal） |
| `page` | `i32` | — | 当前 Tab 已拉取页数 |
| `tab_fetched` | `usize` | — | 当前 Tab 本次新增记录数 |
| `total_fetched` | `usize` | — | 本次同步累计新增记录数 |
| `done` | `bool` | — | 是否已完成（最后一条进度事件为 true） |

---

## `src-tauri/src/models/game.rs`
**职责**：游戏启动器侧模型——渠道枚举与各渠道 API/参数映射、安装/校验/修复/切服进度、启动器 API 响应结构、清单与下载相关结构、公告/Banner/背景图结构。是 models 中最大的文件（499 行），**注意此文件多数结构体没有 `rename_all = "camelCase"`**（字段本身即 snake_case，或用显式 rename/alias 处理）。
**导出**：枚举 `GameChannel`、`ActiveOperation`、`InstallStage`；结构体 `OperationProgress`、`SwitchProgress`、`GameStatus`、`BatchProxyResponse`、`ProxyResponse`、`GetLatestGameRsp`、`PkgInfo`、`ManifestFile`、`RemotePackage`、`DownloadProgress`、`FilePlan`、`PayloadState`、`LauncherResult`、`BannerItem`、`AnnouncementItem`、`LauncherNoticeContent`、`BannerRsp`、`BannerRspItem`、`AnnouncementRsp`、`AnnouncementTab`、`AnnouncementApiItem`、`MainBgImageRsp`、`MainBgImageData`、`BackgroundMedia`、`FileScanResult`。

### `enum GameChannel`
- 位置：game.rs:5
- derive：`#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]`（可作 HashMap key）
- 用途：游戏渠道（服务器分支），并集中提供该渠道的所有 API 地址与登录参数。
- 变体（每个变体带显式 `#[serde(rename)]`）：

| 变体 | serde | 含义 |
| --- | --- | --- |
| `Official` | `rename = "official"` | 国服官服 |
| `Bilibili` | `rename = "bilibili"` | 国服 B 服 |
| `Global` | `rename = "global"` | 国际服 |
| `GooglePlay` | `rename = "google_play"` | 国际服 Google Play |

**备注**：impl GameChannel（game.rs:20），全部返回 `&'static str`：

| 方法 | 行号 | 职责 |
| --- | --- | --- |
| `as_str` | game.rs:21 | 返回与 serde rename 一致的字符串 |
| `api_url` | game.rs:31 | 启动器 API：国服 `launcher.hypergryph.com/api/proxy/batch_proxy`，国际服 `launcher.gryphline.com/...` |
| `web_api_url` | game.rs:43 | Web API（公告/背景图），路径多一段 `/web/` |
| `app_code` | game.rs:55 | appcode：国服 `6LL0KJuqHBVz33WK`，国际服 `YDUTE5gscDZ229CW` |
| `launcher_app_code` | game.rs:63 | launcher_appcode：国服 `abYeZZ16BPluCFyT`，国际服 `YDUTE5gscDZ229CW` |
| `channel` | game.rs:71 | 官服 1 / B服 2 / 国际服与 GooglePlay 均为 6 |
| `sub_channel` | game.rs:81 | 官服 1 / B服 2 / Global 6 / GooglePlay 802 |
| `seq` | game.rs:91 | 国服 5，国际服 3 |
| `executable_name` | game.rs:99 | 恒为 `"Endfield.exe"` |
| `process_name` | game.rs:104 | 恒为 `"Endfield.exe"`（`utils/process.rs` 的进程快照匹配与终止用） |

### `enum ActiveOperation`
- 位置：game.rs:121
- derive：`#[derive(Debug, Clone, Serialize, Deserialize)]`，容器 `#[serde(tag = "type")]`（内部标签枚举）
- 用途：当前活跃操作（统一管理安装/校验/切服状态），随 `GameStatus.active_operation` 返回给前端。
- 变体：

| 变体 | serde | 载荷类型 | 含义 |
| --- | --- | --- | --- |
| `Installing` | `rename = "installing"` | `OperationProgress` | 安装/下载中 |
| `Verifying` | `rename = "verifying"` | `OperationProgress` | 校验中 |
| `Repairing` | `rename = "repairing"` | `OperationProgress` | 修复中 |
| `Switching` | `rename = "switching"` | `SwitchProgress` | 切服中 |

### `struct OperationProgress`
- 位置：game.rs:134
- derive：`Debug, Clone, Serialize, Deserialize`（**无 rename_all**，键名即 snake_case）
- 用途：通用操作进度（安装/校验/修复共用）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `stage` | `String` | — | 阶段标识（对应 `InstallStage::as_str` 的取值） |
| `downloaded` | `u64` | — | 已下载字节数 |
| `total` | `u64` | — | 总字节数 |
| `current_file` | `Option<String>` | — | 当前处理文件 |
| `file_index` | `usize` | — | 当前文件序号 |
| `file_count` | `usize` | — | 文件总数 |
| `verified_bytes` | `u64` | `default` | 已校验字节数 |

### `struct SwitchProgress`
- 位置：game.rs:147
- derive：同上
- 用途：切服进度（含阶段名与渠道信息）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `phase` | `String` | — | 切服阶段 |
| `downloaded` | `u64` | — | 已下载字节 |
| `total` | `u64` | — | 总字节 |
| `current_file` | `Option<String>` | — | 当前文件 |
| `file_index` | `usize` | — | 当前文件序号 |
| `file_count` | `usize` | — | 文件总数 |
| `from_channel` | `String` | — | 源渠道 |
| `to_channel` | `String` | — | 目标渠道 |

### `struct GameStatus`
- 位置：game.rs:160
- derive：同上
- 用途：游戏安装状态（前端安装页主数据）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `is_installed` | `bool` | — | 是否已安装 |
| `has_update` | `bool` | — | 是否有可用更新 |
| `local_version` | `Option<String>` | — | 本地版本 |
| `remote_version` | `Option<String>` | — | 远端最新版本 |
| `has_preload` | `bool` | — | 是否有预下载资源 |
| `preload_version` | `Option<String>` | — | 预下载版本 |
| `preload_installable` | `bool` | `default` | 有 cd_key 且补丁可用于安装；此时 `has_update` 也为 true |
| `preload_total_bytes` | `u64` | `default` | 预下载分卷需下载的总字节数（无预下载时为 0） |
| `preload_completed` | `bool` | — | 预下载是否完成 |
| `active_operation` | `Option<ActiveOperation>` | `default` | 当前活跃操作（无则为 None） |

### `struct BatchProxyResponse`
- 位置：game.rs:179
- derive：同上
- 用途：启动器 `batch_proxy` 接口的顶层响应。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `proxy_rsps` | `Vec<ProxyResponse>` | — | 各子请求的响应集合 |

### `struct ProxyResponse`
- 位置：game.rs:184
- derive：同上
- 用途：单个子请求响应，按 `kind` 分派到对应 `*_rsp` 字段。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `kind` | `String` | — | 响应种类 |
| `get_latest_game_rsp` | `Option<GetLatestGameRsp>` | `rename`（同名） + `skip_serializing_if = "Option::is_none"` | 最新版本响应 |
| `get_banner_rsp` | `Option<BannerRsp>` | `rename`（同名） + `skip_serializing_if = "Option::is_none"` | Banner 响应 |
| `get_announcement_rsp` | `Option<AnnouncementRsp>` | `rename`（同名） + `skip_serializing_if = "Option::is_none"` | 公告响应 |
| `get_main_bg_image_rsp` | `Option<MainBgImageRsp>` | `rename`（同名） + `skip_serializing_if = "Option::is_none"` | 主界面背景图响应 |
| `get_sidebar_rsp` | `Option<SidebarRsp>` | `rename`（同名） + `skip_serializing_if = "Option::is_none"` | 右侧栏（社媒/工具）响应 |

### `struct GetLatestGameRsp`
- 位置：game.rs:197
- derive：同上
- 用途：最新游戏包信息（含预下载补丁包 `pre_patch`）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `version` | `String` | — | 最新版本号 |
| `pkg` | `Option<PkgInfo>` | `default` | 正式包信息 |
| `pre_patch` | `Option<PrePatch>` | `default` | 预下载补丁包（官方在正式发版前提供，只有请求里带上本地版本时才返回） |

**备注**：接口实际响应还包含 `action` / `request_version` / `patch` / `state` / `launcher_action` / `client_version` / `pkg.packs` 等字段；`pkg.cd_key` 会被读取供后端解密预下载包，不会通过前端 IPC 返回。

### `struct PkgInfo`
- 位置：game.rs:210
- derive：同上
- 用途：包地址信息（`pkg.file_path` 指向资源根目录，清单由 `{file_path}/game_files` 取得）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `file_path` | `String` | — | 包文件下载路径/URL |
| `cd_key` | `Option<String>` | `default` + `skip_serializing` | 官方预下载 ZIP 的解压密码，仅后端使用 |

### `struct PrePatch`
- 位置：game.rs:218
- derive：`Debug, Clone, Serialize, Deserialize, Default`
- 用途：预下载补丁包元数据（待发布版本的分卷压缩包）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `version` | `String` | `default` | 预下载目标版本（尚未正式发布的新版本） |
| `client_version` | `String` | `default` | 官方客户端上报的版本，实测与 `version` 相同 |
| `package_size` | `String` | `default` | 分卷下载总字节数（字符串数字，等于各分卷 `package_size` 之和） |
| `total_size` | `String` | `default` | 解压后总字节数（字符串数字） |
| `patches` | `Vec<PatchPart>` | `default` | 分卷列表（`.zip.001`、`.zip.002` … 顺序拼接为一个 ZIP） |

**备注**：`impl PrePatch` — game.rs:236；方法 `total_bytes(&self) -> u64` — game.rs:238，累加各分卷 `size()`。

### `struct PatchPart`
- 位置：game.rs:245
- derive：`Debug, Clone, Serialize, Deserialize, Default`
- 用途：预下载分卷条目。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `url` | `String` | `default` | CDN 地址（带 `auth_key` 查询串，过期后需重新请求 API） |
| `md5` | `String` | `default` | 分卷文件 MD5 |
| `package_size` | `String` | `default` | 分卷字节数（字符串数字） |

**备注**：`impl PatchPart` — game.rs:257；方法 `size(&self) -> u64` — game.rs:259，解析 `package_size`，失败按 0。

### `struct ManifestFile`
- 位置：game.rs:266
- derive：同上
- 用途：清单文件条目（解密后的 NDJSON 每行一条）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `path` | `String` | — | 相对路径 |
| `md5` | `String` | — | 文件 MD5 |
| `size` | `i64` | — | 文件字节数 |

### `struct RemotePackage`
- 位置：game.rs:274
- derive：同上
- 用途：远端游戏包信息（版本 + 资源地址，含预下载）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `version` | `String` | — | 版本号 |
| `resource_base_url` | `String` | — | 资源下载根地址 |
| `has_preload` | `bool` | — | 是否存在预下载 |
| `preload_version` | `Option<String>` | — | 预下载版本 |
| `preload_parts` | `Vec<PatchPart>` | — | 预下载分卷列表（顺序即拼接顺序） |
| `preload_total_bytes` | `u64` | — | 预下载分卷下载字节数之和 |
| `preload_expanded_bytes` | `u64` | — | API 提供的预下载解压后总字节数 |

### `struct DownloadProgress`
- 位置：game.rs:289
- derive：同上
- 用途：下载进度（与 `OperationProgress` 字段基本一致）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `downloaded` | `u64` | — | 已下载字节 |
| `total` | `u64` | — | 总字节 |
| `stage` | `String` | — | 阶段 |
| `current_file` | `Option<String>` | — | 当前文件 |
| `file_index` | `usize` | — | 当前文件序号 |
| `file_count` | `usize` | — | 文件总数 |
| `verified_bytes` | `u64` | `default` | 已校验字节 |

**备注**：手动实现 `impl Default for DownloadProgress` — game.rs:300，全字段置 0/空（stage 为 `String::new()`，current_file 为 `None`）。

### `enum InstallStage`
- 位置：game.rs:316
- derive：`Debug, Clone, Serialize, Deserialize, PartialEq, Eq`
- 用途：安装/更新阶段枚举，序列化为小写字符串。
- 变体（均带 `#[serde(rename)]`，rename 值与 `as_str` 一致）：

| 变体 | serde 值 | 含义 |
| --- | --- | --- |
| `Checking` | `checking` | 检查 |
| `Comparing` | `comparing` | 比对清单 |
| `Downloading` | `downloading` | 下载 |
| `Verifying` | `verifying` | 校验 |
| `Repairing` | `repairing` | 修复 |
| `Preloading` | `preloading` | 预下载（官方预发布补丁分卷，仅 `preload_download` 使用） |
| `Applying` | `applying` | 应用/落盘 |
| `Completed` | `completed` | 完成 |
| `Error` | `error` | 出错 |

**备注**：impl InstallStage — game.rs:338；`pub fn as_str(&self) -> &'static str` — game.rs:339，返回上表字符串。

### `struct FilePlan`
- 位置：game.rs:356
- derive：`#[derive(Debug, Clone)]` —— **不带 serde，不能直接序列化**
- 用途：清单比较结果，标记需要下载的文件及其可复用的本地来源。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `manifest` | `ManifestFile` | 无（不实现 serde） | 目标文件清单条目 |
| `source_path` | `Option<String>` | 无 | 本地已有且 MD5 匹配的文件路径（可复用） |

### `struct PayloadState`
- 位置：game.rs:363
- derive：`Debug, Clone, Serialize, Deserialize`
- 用途：持久化的资源包状态（写入本地状态文件）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `channel` | `String` | — | 渠道字符串 |
| `version` | `String` | — | 已安装版本 |
| `manifest_sha256` | `String` | — | 清单文件 SHA256 |
| `file_count` | `usize` | — | 文件总数 |
| `total_bytes` | `u64` | — | 总字节数 |
| `updated_at` | `String` | — | 更新时间字符串 |
| `preload_version` | `Option<String>` | `default` | 预下载版本 |
| `preload_completed` | `bool` | `default` | 预下载是否完成 |

### `struct LauncherResult`
- 位置：game.rs:378
- derive：同上
- 用途：安装/更新操作结果（命令返回值）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `success` | `bool` | — | 是否成功 |
| `message` | `String` | — | 结果描述。`launcher_start_game` 用 `<token>: <detail>` 形式（token 见 [commands.md](commands.md) 的 token 契约表），前端据此选 i18n 文案 |
| `version` | `Option<String>` | — | 成功后的版本号 |
| `warning` | `Option<String>` | `default` + `skip_serializing_if` | 非致命提示，格式同 `message`。目前只有「未找到签名有效的官方启动器、已回退到直接启动」（token `fallback`）会带上 |

### `struct BannerItem`
- 位置：game.rs:392
- derive：同上
- 用途：本地聚合后的 Banner 条目（给前端）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `image_url` | `String` | — | 图片地址 |
| `jump_url` | `String` | — | 跳转链接 |

### `struct AnnouncementItem`
- 位置：game.rs:399
- derive：同上
- 用途：本地聚合后的公告条目。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `category` | `String` | — | 所属 Tab/分类 |
| `title` | `String` | — | 标题 |
| `date` | `String` | — | 日期字符串 |
| `jump_url` | `String` | — | 跳转链接 |

### `struct LauncherNoticeContent`
- 位置：game.rs:409
- derive：同上
- 用途：公告页聚合内容（Banner + 公告列表 + 右侧栏条目）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `banners` | `Vec<BannerItem>` | — | Banner 列表 |
| `announcements` | `Vec<AnnouncementItem>` | — | 公告列表 |
| `sidebars` | `Vec<SidebarItem>` | — | 启动器右侧栏条目（社媒二维码 + 工具入口），由 `get_sidebar` 合并而来 |

### `struct SidebarItem`
- 位置：game.rs:421
- derive：同上
- 用途：**后端聚合后的**侧边栏条目（给前端）。官方数据把链接分散在条目自身与 `sidebar_labels[]` 两处，`GameLauncherService::parse_sidebars` 已合并成这一层扁平结构，前端不再处理分组。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `media` | `String` | — | 渠道标识（`Skland`/`Bilibili`/`Weibo`/`Taptap`/`Douyin`/`Xiaohongshu`/`Wechat`/`CS`/`SklandTool`），前端据此匹配本地图标 |
| `display_type` | `String` | — | 原样透传：`DisplayType_LIST`（单条链接）/ `DisplayType_GRID`（一组工具链接） |
| `title` | `String` | — | 悬停提示与二维码说明（`pic.description`，缺失时取 `sidebar_labels[0].content`） |
| `qr_url` | `String` | — | 二维码图片地址（`pic.url`，缺失时取 `sidebar_labels[0].pic_url`），空串表示无图 |
| `jump_url` | `String` | — | 点击打开的网页地址，空串表示只能扫码（如微信公众号） |
| `need_token` | `bool` | — | 官方是否要求带登录态（仅透传，当前前端未使用） |

### `struct SidebarRsp`
- 位置：game.rs:479
- derive：同上
- 用途：`get_sidebar_rsp` 响应体。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `sidebars` | `Vec<SidebarApiItem>` | `default` | 侧边栏原始条目列表 |

### `struct SidebarApiItem`
- 位置：game.rs:485
- derive：同上
- 用途：侧边栏 API 原始条目（含分组结构，仅后端解析用）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `media` | `String` | `default` | 渠道标识 |
| `display_type` | `String` | `default` | `DisplayType_LIST` / `DisplayType_GRID` |
| `pic` | `Option<SidebarPic>` | `default` | 二维码图片（`CS`、`SklandTool` 为 null） |
| `sidebar_labels` | `Vec<SidebarLabel>` | `default` | 子链接列表（`GRID` 有 6 条，`CS` 有 1 条） |
| `jump_url` | `String` | `default` | 条目自身跳转地址（社媒条目使用） |
| `need_token` | `bool` | `default` | 是否需要登录态 |

### `struct SidebarPic` / `struct SidebarLabel`
- 位置：game.rs:501 / game.rs:509
- derive：同上
- 用途：侧边栏条目的图片与子链接。`SidebarPic { url, description: Option<String> }`；`SidebarLabel { content, jump_url, pic_url, need_token }`（全部 `default`）。

### `struct BannerRsp`
- 位置：game.rs:415
- derive：同上
- 用途：Banner API 响应体。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `banners` | `Vec<BannerRspItem>` | `default` | Banner 列表 |

### `struct BannerRspItem`
- 位置：game.rs:421
- derive：同上
- 用途：Banner API 原始条目。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `url` | `String` | — | 图片地址 |
| `jump_url` | `String` | — | 跳转链接 |

### `struct AnnouncementRsp`
- 位置：game.rs:428
- derive：同上
- 用途：公告 API 响应体。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `tabs` | `Vec<AnnouncementTab>` | `default` + `alias = "tab_list"` | 公告 Tab 列表（兼容 `tab_list` 键） |

### `struct AnnouncementTab`
- 位置：game.rs:434
- derive：同上
- 用途：公告 API 中的分类 Tab。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `tab_name` | `String` | `alias = "tab_name"` + `alias = "tabName"` + `default` | Tab 名称 |
| `announcements` | `Vec<AnnouncementApiItem>` | `default` | 该 Tab 下的公告 |

### `struct AnnouncementApiItem`
- 位置：game.rs:442
- derive：同上
- 用途：公告 API 原始条目（字段宽松，多为 Option）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `content` | `String` | `default` | 公告正文 |
| `title` | `Option<String>` | `default` + `alias = "title"` | 标题 |
| `start_ts` | `Option<String>` | `default` + `alias = "startTs"` + `alias = "start_ts"` | 开始时间（字符串） |
| `jump_url` | `Option<String>` | `default` + `alias = "jumpUrl"` + `alias = "jump_url"` | 跳转链接 |

### `struct MainBgImageRsp`
- 位置：game.rs:455
- derive：同上
- 用途：主界面背景图 API 响应体。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `main_bg_image` | `Option<MainBgImageData>` | `rename = "main_bg_image"`（同名） + `default` | 背景图数据 |

### `struct MainBgImageData`
- 位置：game.rs:461
- derive：同上
- 用途：背景图数据（可含视频）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `url` | `String` | — | 图片地址 |
| `video_url` | `Option<String>` | `default` | 视频地址 |

### `struct BackgroundMedia`
- 位置：game.rs:469
- derive：同上
- 用途：启动器背景媒体，图片与视频一起返回，由前端按设置选择。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `image_url` | `Option<String>` | `default` | 背景图地址 |
| `video_url` | `Option<String>` | `default` | 背景视频地址 |

### `struct FileScanResult`
- 位置：game.rs:484
- derive：同上
- 用途：安装目录扫描结果（校验本地文件完整性统计）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `channel_detected` | `bool` | — | 是否识别出渠道 |
| `detected_channel` | `Option<String>` | — | 识别到的渠道字符串 |
| `total_files` | `usize` | — | 清单中的总文件数 |
| `valid_files` | `usize` | — | 已存在且完整的文件数 |
| `corrupted_files` | `usize` | — | 已存在但损坏的文件数 |
| `missing_files` | `usize` | — | 缺失文件数 |
| `existing_bytes` | `u64` | — | 已存在文件总字节 |
| `download_bytes` | `u64` | — | 需下载的总字节 |
| `corrupted_file_list` | `Vec<String>` | — | 损坏文件路径（最多 20 条） |
| `missing_file_list` | `Vec<String>` | — | 缺失文件路径（最多 20 条） |

---

## `src-tauri/src/models/login.rs`
**职责**：登录相关的请求/响应模型（密码登录、验证码、扫码登录）。文件共 52 行。
**导出**：`LoginRequest`、`SendCodeRequest`、`CodeLoginRequest`、`ScanLoginInfo`、`ScanStatus`。

### `struct LoginRequest`
- 位置：login.rs:6
- derive：`#[derive(Serialize, Deserialize, Clone, Debug)]`，容器 `rename_all = "camelCase"`
- 用途：密码登录请求体。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `phone` | `String` | — | 手机号 |
| `password` | `String` | — | 密码 |
| `expected_user_id` | `Option<String>` | `default` | 重新登录时的目标森空岛 userId；登录结果不一致时后端返回 `ACCOUNT_MISMATCH:<实际userId>` 且不保存凭证 |

### `struct SendCodeRequest`
- 位置：login.rs:14
- derive：同上
- 用途：发送验证码请求体。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `phone` | `String` | — | 手机号 |
| `code_type` | `i32` | `rename = "type"` | 验证码类型（JSON 键为 `type`） |

### `struct CodeLoginRequest`
- 位置：login.rs:23
- derive：同上
- 用途：验证码登录请求体。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `phone` | `String` | — | 手机号 |
| `code` | `String` | — | 短信验证码 |
| `expected_user_id` | `Option<String>` | `default` | 重新登录时的目标森空岛 userId（校验同 `LoginRequest`） |

### `struct ScanLoginInfo`
- 位置：login.rs:31
- derive：同上
- 用途：扫码登录信息（生成二维码所需）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `scan_id` | `String` | — | 扫码会话 ID |
| `scan_url` | `String` | — | 二维码指向的 URL |

### `struct ScanStatus`
- 位置：login.rs:39
- derive：同上
- 用途：扫码登录轮询状态。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `status` | `i32` | — | 100 = 未扫码，101 = 已扫码，0 = 登录成功（此时返回 `scan_code`） |
| `scan_code` | `Option<String>` | — | 登录成功时的扫码凭据 |
| `msg` | `Option<String>` | — | 提示信息（JSON 键为 `msg`） |

---

## `src-tauri/src/models/role.rs`
**职责**：角色/绑定相关模型——森空岛绑定列表的 API 响应结构、本地配置用的角色展示结构。文件共 71 行。
**导出**：`GameBinding`、`BindingInfo`、`RoleInfo`、`BindingResponse`、`BindingData`、`RoleDisplayInfo`。

### `struct GameBinding`
- 位置：role.rs:6
- derive：`#[derive(Serialize, Deserialize, Clone, Debug)]`，容器 `rename_all = "camelCase"`
- 用途：一个游戏（app）的绑定聚合。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `app_code` | `String` | — | 应用代码 |
| `app_name` | `String` | — | 应用/游戏名 |
| `binding_list` | `Vec<BindingInfo>` | — | 绑定列表 |
| `default_uid` | `Option<String>` | — | 默认 UID |

### `struct BindingInfo`
- 位置：role.rs:16
- derive：同上
- 用途：单个渠道绑定信息（含其下的角色列表）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `uid` | `String` | — | 账号 UID |
| `is_official` | `bool` | — | 是否官服绑定 |
| `is_default` | `bool` | — | 是否默认绑定 |
| `channel_master_id` | `String` | — | 渠道主 ID |
| `channel_name` | `String` | — | 渠道名 |
| `nick_name` | `String` | — | 绑定昵称 |
| `is_delete` | `bool` | — | 是否已删除 |
| `game_name` | `String` | — | 游戏名 |
| `game_id` | `i32` | — | 游戏 ID |
| `roles` | `Vec<RoleInfo>` | — | 该绑定下的角色列表 |
| `default_role` | `Option<RoleInfo>` | — | 默认角色 |

### `struct RoleInfo`
- 位置：role.rs:33
- derive：同上
- 用途：单个游戏角色信息（来自绑定列表接口）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `server_id` | `String` | — | 服务器 ID |
| `role_id` | `String` | — | 角色 ID |
| `nickname` | `String` | — | 角色昵称 |
| `level` | `i32` | — | 等级 |
| `is_default` | `bool` | — | 是否默认角色 |
| `is_banned` | `bool` | — | 是否被封禁 |
| `server_type` | `String` | — | 服务器类型 |
| `server_name` | `String` | — | 服务器名 |

### `struct BindingResponse`
- 位置：role.rs:47
- derive：同上
- 用途：绑定列表接口的顶层响应（code/message/timestamp/data）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `code` | `i32` | — | 业务状态码 |
| `message` | `String` | — | 状态信息 |
| `timestamp` | `String` | — | 响应时间戳（字符串） |
| `data` | `BindingData` | — | 数据体 |

### `struct BindingData`
- 位置：role.rs:56
- derive：同上
- 用途：绑定列表响应的数据体。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `list` | `Vec<GameBinding>` | — | 游戏绑定列表 |
| `server_default_binding` | `serde_json::Value` | — | 服务器默认绑定（未建模，原样保留） |

### `struct RoleDisplayInfo`
- 位置：role.rs:64
- derive：同上
- 用途：面向前端的角色展示信息（被 `account.rs::AccountLoginResult.available_roles` 复用）。
- 字段：

| 字段 | 类型 | serde | 含义 |
| --- | --- | --- | --- |
| `role_id` | `String` | — | 角色 ID |
| `user_id` | `String` | — | 账户 user_id |
| `server_id` | `String` | — | 服务器 ID |
| `nickname` | `String` | — | 昵称 |
| `level` | `i32` | — | 等级 |
| `avatar_url` | `String` | — | 头像地址 |

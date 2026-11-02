import { BaseCardProps } from "../registry/types";
import { useCardData } from "../base/use-card-data";
import { useTranslation } from "react-i18next";
import { GlassCard, GlassProgressCircle } from "@/components/ui/glass";
import logger from "@/utils/logger";

/**
 * 可选：卡片启动时调用的方法
 * 
 * 若卡片需要注册一个"App启动时自动执行"的任务（如自动签到），
 * 在此导出一个 async startup 函数。
 * 
 * 配合 CardStartupService.addTask 使用：
 * 1. 用户在设置中启用"启动时自动执行"后，
 *    调用 CardStartupService.addTask({ cardId, cardType: "my_card", params: {...} })
 * 2. App 启动时，CardStartupService.runAll() 会读取 config 中的任务列表，
 *    找到 cardType 匹配的任务，调用此函数
 * 3. 组件可通过 CardStartupService.subscribe(cardId, callback) 监听执行状态
 *
 * export async function startup(task: { cardId: string; cardType: string; params: Record<string, any> }) {
 *   const { someParam } = task.params;
 *   await doSomething(someParam);
 * }
 */

/**
 * 示例卡片组件
 *
 * 这是一个模板文件，复制此目录并修改以创建新卡片。
 *
 * 开发步骤：
 * 1. 复制整个 _template 目录为新名称（如 my-card）
 * 2. 重命名 meta.json 文件（如 my-card.meta.json）
 * 3. 修改 meta.json 中的 id、name、description 等字段
 * 4. 在此文件中实现你的卡片逻辑
 * 5. 可选：导出 startup 函数以注册启动时自动执行的任务
 */
export default function TemplateCard({
  roleId,
  cardId,
  settings,
  isEditMode,
}: BaseCardProps) {
  const { t } = useTranslation();

  // 示例：使用通用数据加载 Hook
  const { isLoading, error } = useCardData({
    fetchData: async () => {
      // TODO: 替换为你的数据获取逻辑
      logger.info("Loading data for role: " + roleId, "TemplateCard");

      // 模拟 API 调用
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            message: "Template Card Data",
            timestamp: Date.now(),
          });
        }, 500);
      });
    },
    lazy: false, // 设置为 true 可启用懒加载
  });

  // 示例：从 settings 读取配置
  const customSetting = settings.customKey || "default value";

  // 加载状态
  if (isLoading) {
    return (
      <GlassCard className="p-6  border border-separator/90 h-full w-full flex items-center justify-center">
        <GlassProgressCircle isIndeterminate size="md" aria-label="Loading" className="text-primary-text">
          <GlassProgressCircle.Track>
            <GlassProgressCircle.TrackCircle />
            <GlassProgressCircle.FillCircle />
          </GlassProgressCircle.Track>
        </GlassProgressCircle>
      </GlassCard>
    );
  }

  // 错误状态
  if (error) {
    return (
      <GlassCard className="p-6  border border-separator/90">
        <p className="text-danger-text text-center">
          {t("common.load_error") || "加载失败"}
        </p>
      </GlassCard>
    );
  }

  // 正常渲染
  return (
    <GlassCard className="p-6  border border-separator/90 h-full w-full">
      <div className="space-y-4">
        <h3 className="font-semibold text-foreground text-base">
          {t("template_card.title") || "Template Card"}
        </h3>

        <div className="text-sm text-muted">
          <p>Role ID: {roleId}</p>
          <p>Card ID: {cardId}</p>
          <p>Custom Setting: {String(customSetting)}</p>
        </div>

        {!isEditMode && (
          <div className="text-xs text-default-400 mt-4">
            {t("template_card.hint") || "Click to interact"}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

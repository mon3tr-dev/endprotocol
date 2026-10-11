import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { GlassSelect, GlassSwitch } from "@/components/ui/glass";
import { SettingsDivider } from "@/components/ui/settings-row";
import { TodoIcon } from "@/components/cards/todo/todo-icon";
import type { TodoDefaults, TodoSortMode } from "@/types/todo";
import { DEFAULT_TODO_DEFAULTS, TODO_COLORS, TODO_ICONS } from "@/types/todo";
import { getTodoDefaults, setTodoDefaults } from "@/utils/todoDefaults";

/**
 * 全局设置页「To-Do 卡片」分区。
 */
export function TodoSettings() {
  const { t } = useTranslation();
  const [defaults, setDefaults] = useState<TodoDefaults>(DEFAULT_TODO_DEFAULTS);

  useEffect(() => {
    void getTodoDefaults().then(setDefaults);
  }, []);

  const update = (patch: Partial<TodoDefaults>) => {
    setDefaults((prev) => ({ ...prev, ...patch }));
    void setTodoDefaults(patch);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.todo.sort_mode")}
          desc={t("settings.todo.sort_mode_desc")}
        />
        <GlassSelect
          value={defaults.sortMode}
          options={[
            { value: "manual", label: t("card:todo_sort_manual") },
            { value: "priority", label: t("card:todo_sort_priority") },
            { value: "due", label: t("card:todo_sort_due") },
            { value: "created", label: t("card:todo_sort_created") },
          ]}
          onChange={(v) => update({ sortMode: v as TodoSortMode })}
        />
      </div>

      <SettingsDivider />

      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.todo.hide_completed")}
          desc={t("settings.todo.hide_completed_desc")}
        />
        <GlassSwitch
          isSelected={defaults.hideCompleted}
          onValueChange={(v) => update({ hideCompleted: v })}
        >
          <GlassSwitch.Control>
            <GlassSwitch.Thumb />
          </GlassSwitch.Control>
        </GlassSwitch>
      </div>

      <SettingsDivider />

      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.todo.priority")}
          desc={t("settings.todo.priority_desc")}
        />
        <GlassSwitch
          isSelected={defaults.priorityEnabled}
          onValueChange={(v) => update({ priorityEnabled: v })}
        >
          <GlassSwitch.Control>
            <GlassSwitch.Thumb />
          </GlassSwitch.Control>
        </GlassSwitch>
      </div>

      <SettingsDivider />

      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.todo.due")}
          desc={t("settings.todo.due_desc")}
        />
        <GlassSwitch
          isSelected={defaults.dueEnabled}
          onValueChange={(v) => update({ dueEnabled: v })}
        >
          <GlassSwitch.Control>
            <GlassSwitch.Thumb />
          </GlassSwitch.Control>
        </GlassSwitch>
      </div>

      <SettingsDivider />

      <div className="flex items-center justify-between gap-4">
        <Label
          title={t("settings.todo.color")}
          desc={t("settings.todo.color_desc")}
        />
        <div className="flex items-center gap-1.5">
          {TODO_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={() => update({ color })}
              className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                defaults.color === color ? "border-foreground" : "border-transparent"
              }`}
              style={{ backgroundColor: color }}
              aria-label={color}
            />
          ))}
        </div>
      </div>

      <SettingsDivider />

      <div>
        <Label
          title={t("settings.todo.icon")}
          desc={t("settings.todo.icon_desc")}
        />
        <div className="flex flex-wrap gap-1.5 mt-2">
          {TODO_ICONS.map((icon) => (
            <button
              key={icon}
              type="button"
              onClick={() => update({ icon })}
              className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all hover:scale-110 ${
                defaults.icon === icon
                  ? "border-primary bg-primary/10"
                  : "border-separator"
              }`}
              aria-label={icon}
              aria-pressed={defaults.icon === icon}
            >
              <TodoIcon icon={icon} size={18} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Label({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-foreground">{title}</p>
      {desc && <p className="text-sm text-muted mt-0.5">{desc}</p>}
    </div>
  );
}
